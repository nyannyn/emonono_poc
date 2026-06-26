import Foundation
import AVFoundation
import CoreMedia
import Speech

// 移植自 nyannyn/ios-voice-agent（API 已對照 FluidInference/swift-scribe 校正，
// 並經 GitHub CI 在 Xcode 26.4.1 / iOS 26.4 SDK 編譯驗證通過）。

/// iOS 26+ 主力 STT 實作，使用 `SpeechAnalyzer` + `SpeechTranscriber`。
///
/// 這是語音備忘錄（Voice Memos）背後同一套 on-device 引擎的對外公開 API：
/// 完全在 app sandbox 內、不上傳伺服器、支援長音檔與即時串流、無單次時長上限。
@available(iOS 26.0, *)
final class SpeechAnalyzerTranscriber: SpeechTranscribing {

    private let locale: Locale
    private let audioEngine = AVAudioEngine()

    private var analyzer: SpeechAnalyzer?
    private var transcriber: SpeechTranscriber?
    private var inputContinuation: AsyncStream<AnalyzerInput>.Continuation?

    private var analyzerFormat: AVAudioFormat?
    private var converter: AVAudioConverter?

    private var recorder: AudioRecordingWriter?

    /// 把寫檔 + 格式轉換移出即時音訊執行緒的專用序列佇列。
    private let processingQueue = DispatchQueue(label: "expospeechanalyzer.processing")

    init(locale: Locale = Locale(identifier: "zh-TW")) {
        self.locale = locale
    }

    func requestAuthorization() async throws {
        let speechStatus = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard speechStatus == .authorized else { throw TranscriptionError.notAuthorized }

        let micGranted = await AVAudioApplication.requestRecordPermission()
        guard micGranted else { throw TranscriptionError.notAuthorized }
    }

    func startTranscription(recordingTo recordingURL: URL?) async throws -> AsyncThrowingStream<TranscriptUpdate, Error> {
        // 0. 解析裝置實際支援、與要求語系最相符的 Locale（容忍 zh-TW / zh_TW / zh-Hant-TW 差異）。
        let resolvedLocale = try await resolveSupportedLocale()

        // 1. 建立 transcriber，要求回報暫定(volatile)結果與每個 run 的時間範圍。
        let transcriber = SpeechTranscriber(
            locale: resolvedLocale,
            transcriptionOptions: [],
            reportingOptions: [.volatileResults],
            attributeOptions: [.audioTimeRange]
        )
        self.transcriber = transcriber

        // 2. 確認語系模型已安裝（含 reserve），未安裝則下載。
        try await ensureModelInstalled(for: transcriber, locale: resolvedLocale)

        // 3. 建立 analyzer，掛上 transcriber 模組。
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        self.analyzer = analyzer

        // 4. 取得 analyzer 偏好的音訊格式，準備麥克風→該格式的轉換器。
        let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber])
        self.analyzerFormat = analyzerFormat

        // 5. 準備音訊輸入串流，把（轉換後的）麥克風 buffer 餵進 analyzer，同步錄音。
        let (inputStream, continuation) = AsyncStream.makeStream(of: AnalyzerInput.self)
        self.inputContinuation = continuation
        try startAudioCapture(into: continuation, recordingTo: recordingURL)

        // 6. 啟動分析。
        try await analyzer.start(inputSequence: inputStream)

        // 7. 把 transcriber 的結果轉成我們的 TranscriptUpdate。
        return AsyncThrowingStream { streamContinuation in
            let task = Task {
                do {
                    for try await result in transcriber.results {
                        let plain = String(result.text.characters)
                        let start = result.text.runs
                            .compactMap { $0.audioTimeRange?.start.seconds }
                            .min()
                        streamContinuation.yield(
                            TranscriptUpdate(text: plain, isFinal: result.isFinal, startTime: start)
                        )
                    }
                    streamContinuation.finish()
                } catch {
                    streamContinuation.finish(throwing: error)
                }
            }
            streamContinuation.onTermination = { _ in task.cancel() }
        }
    }

    func finish() async {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        processingQueue.sync {
            recorder?.close()
            recorder = nil
        }
        inputContinuation?.finish()
        try? await analyzer?.finalizeAndFinishThroughEndOfInput()
        analyzer = nil
        transcriber = nil
        converter = nil
    }

    // MARK: - Private

    /// 解析出裝置實際支援、與要求語系最相符的 Locale。
    /// 直接字串比對 identifier 太脆（"zh-TW" vs "zh_TW" vs "zh-Hant-TW" 會誤判不支援），
    /// 改成正規化分隔符/大小寫後比對，再退讓用「語言+地區」「同語言」匹配。
    private func resolveSupportedLocale() async throws -> Locale {
        let supported = await SpeechTranscriber.supportedLocales
        if let match = Self.bestMatch(for: locale, in: supported) { return match }
        throw TranscriptionError.localeNotSupported(locale.identifier)
    }

    private func ensureModelInstalled(for transcriber: SpeechTranscriber, locale: Locale) async throws {
        let installed = await SpeechTranscriber.installedLocales
        let isInstalled = Self.bestMatch(for: locale, in: installed) != nil

        if !isInstalled {
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                try await request.downloadAndInstall()
            }
        }
        try await AssetInventory.reserve(locale: locale)
    }

    /// 容錯的語系匹配：正規化分隔符/大小寫 → 語言+地區 → 同語言（優先繁中 TW/HK/Hant）。
    private static func bestMatch(for requested: Locale, in pool: [Locale]) -> Locale? {
        func norm(_ id: String) -> String {
            id.replacingOccurrences(of: "_", with: "-").lowercased()
        }
        let target = norm(requested.identifier)
        if let exact = pool.first(where: { norm($0.identifier) == target }) { return exact }

        let reqLang = requested.language.languageCode?.identifier
        let reqRegion = requested.region?.identifier
        if reqRegion != nil,
           let m = pool.first(where: {
               $0.language.languageCode?.identifier == reqLang && $0.region?.identifier == reqRegion
           }) { return m }

        let sameLang = pool.filter { $0.language.languageCode?.identifier == reqLang }
        if let pref = sameLang.first(where: {
            let id = norm($0.identifier)
            return id.contains("tw") || id.contains("hant") || id.contains("hk")
        }) { return pref }
        return sameLang.first
    }

    private func startAudioCapture(
        into continuation: AsyncStream<AnalyzerInput>.Continuation,
        recordingTo recordingURL: URL?
    ) throws {
        let inputNode = audioEngine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)

        let targetFormat = analyzerFormat ?? inputFormat
        let converter = AVAudioConverter(from: inputFormat, to: targetFormat)
        self.converter = converter

        if let recordingURL {
            self.recorder = AudioRecordingWriter(url: recordingURL, inputFormat: inputFormat)
        }

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            guard let self else { return }
            guard let copy = buffer.deepCopy() else { return }
            self.processingQueue.async {
                self.recorder?.append(copy)
                if let converter, let output = self.convert(copy, using: converter, to: targetFormat) {
                    continuation.yield(AnalyzerInput(buffer: output))
                } else {
                    continuation.yield(AnalyzerInput(buffer: copy))
                }
            }
        }
        audioEngine.prepare()
        try audioEngine.start()
    }

    private func convert(
        _ buffer: AVAudioPCMBuffer,
        using converter: AVAudioConverter,
        to format: AVAudioFormat
    ) -> AVAudioPCMBuffer? {
        if format == buffer.format { return buffer }
        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }

        var fed = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        return (error == nil && output.frameLength > 0) ? output : nil
    }
}

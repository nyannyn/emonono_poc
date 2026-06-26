import ExpoModulesCore
import Foundation

// emonono 本地 Expo module：把 SpeechAnalyzerTranscriber（iOS 26 裝置端引擎）
// 包成 RN 介面。對外事件對齊 expo-speech-recognition 的習慣（result/audioend/error/end），
// 讓 useDeviceLiveTranscription 可以無痛切換引擎。

public class ExpoSpeechAnalyzerModule: Module {
    // 持有正在運作的 transcriber（iOS 26 才會有實體）；用 Any? 以避免類別層級的版本標註。
    private var engineBox: Any?
    private var consumeTask: Task<Void, Never>?
    private var currentRecordingURL: URL?

    public func definition() -> ModuleDefinition {
        Name("ExpoSpeechAnalyzer")

        Events("onResult", "onAudioEnd", "onError", "onEnd")

        Function("isAvailable") { () -> Bool in
            if #available(iOS 26.0, *) { return true } else { return false }
        }

        AsyncFunction("requestPermissions") { () async -> Bool in
            if #available(iOS 26.0, *) {
                do {
                    try await SpeechAnalyzerTranscriber().requestAuthorization()
                    return true
                } catch {
                    return false
                }
            }
            return false
        }

        AsyncFunction("start") { (locale: String, persist: Bool) async throws in
            guard #available(iOS 26.0, *) else {
                throw TranscriptionError.engineUnavailable
            }
            try await self.startAnalyzer(locale: locale, persist: persist)
        }

        AsyncFunction("stop") { () async in
            guard #available(iOS 26.0, *) else { return }
            await self.stopAnalyzer()
        }

        OnDestroy {
            self.consumeTask?.cancel()
        }
    }

    @available(iOS 26.0, *)
    private func startAnalyzer(locale: String, persist: Bool) async throws {
        // 若上一輪沒收乾淨，先停掉。
        await stopAnalyzer()

        let transcriber = SpeechAnalyzerTranscriber(locale: Locale(identifier: locale))
        self.engineBox = transcriber

        var url: URL? = nil
        if persist {
            url = FileManager.default.temporaryDirectory
                .appendingPathComponent("device-\(UUID().uuidString).m4a")
            self.currentRecordingURL = url
        }

        // 啟動序列若中途失敗（如 analyzer.start 丟錯），startAudioCapture 可能已把
        // audioEngine 起來、AVAudioSession 設成 active 並裝了 tap → 不回收的話麥克風會一直開著。
        // 失敗即 stopAnalyzer() 收回 engine + session，再把錯誤往上拋給 JS。
        let stream: AsyncThrowingStream<TranscriptUpdate, Error>
        do {
            stream = try await transcriber.startTranscription(recordingTo: url)
        } catch {
            await stopAnalyzer()
            throw error
        }
        self.consumeTask = Task { [weak self] in
            guard let self else { return }
            do {
                for try await update in stream {
                    self.sendEvent("onResult", [
                        "text": update.text,
                        "isFinal": update.isFinal,
                        "startTime": update.startTime as Any,
                    ])
                }
                self.sendEvent("onEnd", [:])
            } catch {
                self.sendEvent("onError", ["message": error.localizedDescription])
            }
        }
    }

    @available(iOS 26.0, *)
    private func stopAnalyzer() async {
        guard let transcriber = self.engineBox as? SpeechAnalyzerTranscriber else { return }
        await transcriber.finish()
        consumeTask?.cancel()
        consumeTask = nil
        if let url = self.currentRecordingURL {
            self.sendEvent("onAudioEnd", ["uri": url.absoluteString])
        }
        self.currentRecordingURL = nil
        self.engineBox = nil
    }
}

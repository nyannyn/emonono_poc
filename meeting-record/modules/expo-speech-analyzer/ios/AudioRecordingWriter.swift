import AVFoundation

// 移植自 nyannyn/ios-voice-agent。

/// 把 AVAudioEngine tap 取到的 PCM buffer 寫成 .m4a（AAC）錄音檔。
///
/// 與 STT 共用同一個 tap：錄「原始輸入格式」音訊（品質較好），STT 那邊另外做格式轉換，
/// 兩者互不影響。寫檔在序列佇列上進行（呼叫端保證），避免即時音訊執行緒被卡。
final class AudioRecordingWriter {
    let url: URL
    private var file: AVAudioFile?

    /// - Parameter inputFormat: tap 的輸入格式；錄音檔以相同取樣率/聲道數編碼，
    ///   確保 `write(from:)` 的 buffer 格式相容。
    init?(url: URL, inputFormat: AVAudioFormat) {
        self.url = url
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: inputFormat.sampleRate,
            AVNumberOfChannelsKey: inputFormat.channelCount,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue
        ]
        do {
            file = try AVAudioFile(forWriting: url, settings: settings)
        } catch {
            return nil
        }
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        try? file?.write(from: buffer)
    }

    func close() {
        file = nil
    }
}

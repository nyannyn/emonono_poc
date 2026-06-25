import Foundation

// 移植自 nyannyn/ios-voice-agent（已在 iOS 26 CI 編譯驗證），對齊其 STT 抽象介面。

/// 一段轉錄結果。`isFinal` 為 false 表示這是會被後續更新覆蓋的暫定（volatile）結果，
/// 為 true 表示已定稿（finalized），可安全 append 進逐字稿。
struct TranscriptUpdate: Equatable {
    let text: String
    let isFinal: Bool
    /// 相對於 session 起點的時間戳（秒），若引擎未提供則為 nil。
    let startTime: TimeInterval?
}

/// STT 引擎抽象。讓上層不在意底層是 iOS 26 SpeechAnalyzer 還是舊的 SFSpeechRecognizer。
protocol SpeechTranscribing: AnyObject {
    func requestAuthorization() async throws
    func startTranscription(recordingTo recordingURL: URL?) async throws -> AsyncThrowingStream<TranscriptUpdate, Error>
    func finish() async
}

/// 轉錄相關錯誤。
enum TranscriptionError: Error, LocalizedError {
    case notAuthorized
    case localeNotSupported(String)
    case engineUnavailable
    case assetInstallationFailed

    var errorDescription: String? {
        switch self {
        case .notAuthorized: return "未取得語音辨識或麥克風權限"
        case .localeNotSupported(let id): return "不支援的語系：\(id)"
        case .engineUnavailable: return "語音辨識引擎不可用"
        case .assetInstallationFailed: return "語系模型下載失敗"
        }
    }
}

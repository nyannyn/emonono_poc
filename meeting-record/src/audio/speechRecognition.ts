// expo-speech-recognition 的安全載入層。
//
// 為什麼存在：expo-speech-recognition 的 ExpoSpeechRecognitionModule.js 在「import 當下」就
// 呼叫 requireNativeModule("ExpoSpeechRecognition")（不存在會直接 throw）。這個檔在 App 啟動的
// import 樹裡（AppNavigator → LiveRecordingView → useDeviceLiveTranscription），所以只要該原生
// 模組在這個 build 沒被連結（版本不符 / autolink 失敗 / Expo Go），整個 JS bundle 會在啟動就
// 掛掉 → 白屏（連 ErrorBoundary 都來不及，因為錯在 import 期）。
//
// 對策：用 require + try/catch 把載入包起來（對齊本專案 modules/expo-speech-analyzer 的 guard
// 寫法），原生模組不存在時降級成 null / no-op，讓 app 照常啟動、只是裝置端 expo 引擎辨識不可用。

type SpeechRecognitionNS = typeof import('expo-speech-recognition');

let mod: SpeechRecognitionNS | null = null;
try {
  // 刻意用 require（非 static import）才能被 try/catch 接住 import 期的 native module 例外。
  mod = require('expo-speech-recognition');
} catch {
  mod = null;
}

/** 這個 build 是否真的連結了 ExpoSpeechRecognition 原生模組。 */
export const isSpeechRecognitionAvailable = mod != null;

/** 原生模組；不可用時為 null，呼叫端須先判斷（或用 ?. ）。 */
export const ExpoSpeechRecognitionModule: SpeechRecognitionNS['ExpoSpeechRecognitionModule'] | null =
  mod?.ExpoSpeechRecognitionModule ?? null;

/** 事件 hook；不可用時為 no-op，維持呼叫端 hook 呼叫順序一致（rules of hooks）。 */
const noopEvent = (() => {}) as SpeechRecognitionNS['useSpeechRecognitionEvent'];
export const useSpeechRecognitionEvent: SpeechRecognitionNS['useSpeechRecognitionEvent'] =
  mod?.useSpeechRecognitionEvent ?? noopEvent;

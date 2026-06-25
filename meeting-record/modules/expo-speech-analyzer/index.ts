// iOS 26 SpeechAnalyzer 裝置端轉譯的 JS 介面（本地 Expo module）。
//
// 為什麼存在：emonono 原本的裝置端轉譯走 expo-speech-recognition，底層是舊的
// SFSpeechRecognizer（長錄音要靠重啟接段、時間戳精度沒保證）。本模組改用 iOS 26
// 的 SpeechAnalyzer/SpeechTranscriber（語音備忘錄同款引擎）：長錄音原生穩定、
// 精準逐句時間戳。僅 iOS 26+；其餘平台/版本仍由 expo-speech-recognition 接手。
//
// 只能在 EAS dev build 跑（原生模組，Expo Go 沒有 → isAvailable() 會回 false）。

import { requireNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

export interface AnalyzerResult {
  /** 目前這段文字。 */
  text: string;
  /** true=已定稿（可 append）；false=暫定（會被覆蓋）。 */
  isFinal: boolean;
  /** 相對 session 起點的秒數時間戳；引擎未提供則為 null。 */
  startTime: number | null;
}

// Expo Go / 尚未 build 時原生模組不存在 → 不讓 require 直接 throw 害整個 app 掛掉。
let Native: any = null;
try {
  Native = requireNativeModule('ExpoSpeechAnalyzer');
} catch {
  Native = null;
}

/** iOS 26+ 且原生模組已連結時才為 true。否則呼叫端應退回 expo-speech-recognition。 */
export function isAvailable(): boolean {
  try {
    return !!Native && Native.isAvailable() === true;
  } catch {
    return false;
  }
}

/** 要求語音辨識 + 麥克風權限。回傳是否全部授權。 */
export function requestPermissions(): Promise<boolean> {
  if (!Native) return Promise.resolve(false);
  return Native.requestPermissions();
}

/**
 * 開始即時裝置端轉譯。
 * @param locale BCP-47 語系（如 "zh-TW" / "en-US"）
 * @param persist 是否把音訊持久化成 .m4a（結束時由 onAudioEnd 吐 uri）
 */
export function start(locale: string, persist: boolean): Promise<void> {
  if (!Native) return Promise.reject(new Error('ExpoSpeechAnalyzer 原生模組不可用'));
  return Native.start(locale, persist);
}

/** 停止轉譯、釋放資源；若有 persist 會接著發 onAudioEnd。 */
export function stop(): Promise<void> {
  if (!Native) return Promise.resolve();
  return Native.stop();
}

export function addResultListener(cb: (r: AnalyzerResult) => void): EventSubscription {
  return Native.addListener('onResult', cb);
}
export function addAudioEndListener(cb: (e: { uri: string }) => void): EventSubscription {
  return Native.addListener('onAudioEnd', cb);
}
export function addErrorListener(cb: (e: { message: string }) => void): EventSubscription {
  return Native.addListener('onError', cb);
}
export function addEndListener(cb: () => void): EventSubscription {
  return Native.addListener('onEnd', cb);
}

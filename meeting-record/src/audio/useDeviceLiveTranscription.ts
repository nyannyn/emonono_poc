// 裝置端即時轉譯 hook（iOS Apple Speech / Android on-device）。
// 介面對齊原生 repo 的 SpeechTranscribing：吐出 final（已定稿，append）與 partial（暫定）。
// 100% on-device（requiresOnDeviceRecognition）→ 免費、離線、音訊不離開手機。
//
// 注意：這是原生模組，需 EAS dev build，Expo Go 不能用。

import { useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

// 中文（台灣）軟體工程會議常見英文技術名詞，餵給辨識器當 contextualStrings 提升準度
const TECH_TERMS = [
  'API', 'SDK', 'Expo', 'React Native', 'TypeScript', 'WebSocket', 'VAD',
  'Whisper', 'LLM', 'prompt', 'token', 'chunk', 'buffer', 'stream',
  'async', 'UI', 'debug', 'commit', 'merge', 'deploy',
];

export interface DeviceTranscription {
  /** 已定稿的逐句（可安全 append）。 */
  lines: string[];
  /** 目前正在辨識、會被覆蓋的暫定文字。 */
  partial: string;
  /** 是否正在聆聽。 */
  listening: boolean;
  /** 錯誤訊息（null = 無）。 */
  error: string | null;
  /** 持久化的音檔 uri 列表（每次 audioend 一個），stop 後可 concat 成整段。 */
  audioUris: string[];
  start: (lang: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

export function useDeviceLiveTranscription(): DeviceTranscription {
  const [lines, setLines] = useState<string[]>([]);
  const [partial, setPartial] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioUrisRef = useRef<string[]>([]);
  const [audioUris, setAudioUris] = useState<string[]>([]);

  // 使用者是否仍想聆聽（用於 continuous 在舊 iOS 自動結束時重啟）
  const wantRef = useRef(false);
  const langRef = useRef('zh-TW');

  const beginRecognition = () => {
    ExpoSpeechRecognitionModule.start({
      lang: langRef.current,
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: true,
      addsPunctuation: true,
      contextualStrings: TECH_TERMS,
      recordingOptions: { persist: true },
    });
  };

  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results[0]?.transcript ?? '';
    if (!text) return;
    if (e.isFinal) {
      setLines((prev) => [...prev, text.trim()]);
      setPartial('');
    } else {
      setPartial(text);
    }
  });

  useSpeechRecognitionEvent('audioend', (e) => {
    if (e.uri) {
      audioUrisRef.current = [...audioUrisRef.current, e.uri];
      setAudioUris(audioUrisRef.current);
    }
  });

  useSpeechRecognitionEvent('error', (e) => {
    // no-speech 在會議停頓很常見，不當錯誤；其餘才顯示
    if (e.error === 'no-speech') return;
    setError(e.message || e.error);
  });

  useSpeechRecognitionEvent('end', () => {
    // continuous 在舊 iOS / Android 仍可能自行結束；只要使用者沒按停止就重啟
    if (wantRef.current) {
      try {
        beginRecognition();
      } catch {
        wantRef.current = false;
        setListening(false);
      }
    } else {
      setListening(false);
    }
  });

  const start = async (lang: string) => {
    setError(null);
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) throw new Error('語音辨識 / 麥克風權限被拒');
    // zh / en / auto → BCP-47
    langRef.current = lang === 'en' ? 'en-US' : 'zh-TW';
    wantRef.current = true;
    setListening(true);
    beginRecognition();
  };

  const stop = () => {
    wantRef.current = false;
    ExpoSpeechRecognitionModule.stop();
  };

  const reset = () => {
    setLines([]);
    setPartial('');
    setError(null);
    audioUrisRef.current = [];
    setAudioUris([]);
  };

  return { lines, partial, listening, error, audioUris, start, stop, reset };
}

// 裝置端即時轉譯 hook（iOS Apple Speech / Android on-device）。
// 介面對齊原生 repo 的 SpeechTranscribing：吐出 final（已定稿，append）與 partial（暫定）。
// 100% on-device → 免費、離線、音訊不離開手機。
//
// 雙引擎：
//   - iOS 26+：本地原生模組 expo-speech-analyzer（Apple SpeechAnalyzer，語音備忘錄同款引擎）。
//     長錄音原生穩定、附精準逐句時間戳（startTime）。
//   - 其餘（iOS 17–25 / Android）：expo-speech-recognition（SFSpeechRecognizer），
//     靠 end 事件自動重啟接段。
// SpeechAnalyzer.isAvailable() 在 Expo Go / 尚未 dev build 時回 false → 自動退回 expo-speech-recognition。
//
// 注意：兩條路都是原生模組，需 EAS dev build，Expo Go 不能用裝置端辨識。

import { useEffect, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import * as SpeechAnalyzer from '../../modules/expo-speech-analyzer';

// 中文（台灣）軟體工程會議常見英文技術名詞，餵給辨識器當 contextualStrings 提升準度
// （目前僅 expo-speech-recognition 路徑使用；SpeechAnalyzer 路徑暫未支援詞彙偏置）
const TECH_TERMS = [
  'API', 'SDK', 'Expo', 'React Native', 'TypeScript', 'WebSocket', 'VAD',
  'Whisper', 'LLM', 'prompt', 'token', 'chunk', 'buffer', 'stream',
  'async', 'UI', 'debug', 'commit', 'merge', 'deploy',
];

export interface DeviceTranscription {
  /** 已定稿的逐句（可安全 append）。 */
  lines: string[];
  /** 與 lines 平行的逐句起始時間戳（秒）；引擎未提供則為 null。 */
  timestamps: (number | null)[];
  /** 目前正在辨識、會被覆蓋的暫定文字。 */
  partial: string;
  /** 是否正在聆聽。 */
  listening: boolean;
  /** 錯誤訊息（null = 無）。 */
  error: string | null;
  /** 持久化的音檔 uri 列表（每次 audioend 一個），stop 後可 concat 成整段。 */
  audioUris: string[];
  /** 目前使用的引擎，方便 UI 顯示／除錯。 */
  engine: 'analyzer' | 'expo';
  start: (lang: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

export function useDeviceLiveTranscription(): DeviceTranscription {
  const [lines, setLines] = useState<string[]>([]);
  const [timestamps, setTimestamps] = useState<(number | null)[]>([]);
  const [partial, setPartial] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioUrisRef = useRef<string[]>([]);
  const [audioUris, setAudioUris] = useState<string[]>([]);

  // 引擎只決定一次（isAvailable 是靜態的）。iOS 26+ 走 SpeechAnalyzer，否則 expo。
  const engineRef = useRef<'analyzer' | 'expo'>(
    SpeechAnalyzer.isAvailable() ? 'analyzer' : 'expo',
  );

  // 使用者是否仍想聆聽（用於 expo 路徑在自動結束時重啟）
  const wantRef = useRef(false);
  const langRef = useRef('zh-TW');

  // 共用的結果處理：final → append + 時間戳；partial → 覆蓋暫定文字。
  const pushFinal = (text: string, startTime: number | null) => {
    const t = text.trim();
    if (!t) return;
    setLines((prev) => [...prev, t]);
    setTimestamps((prev) => [...prev, startTime]);
    setPartial('');
  };

  const pushAudioUri = (uri?: string | null) => {
    if (!uri) return;
    audioUrisRef.current = [...audioUrisRef.current, uri];
    setAudioUris(audioUrisRef.current);
  };

  // ── expo-speech-recognition 路徑（永遠註冊，但只在該引擎啟動時才會收到事件）──
  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results[0]?.transcript ?? '';
    if (!text) return;
    if (e.isFinal) {
      pushFinal(text, null);
    } else {
      setPartial(text);
    }
  });

  useSpeechRecognitionEvent('audioend', (e) => {
    pushAudioUri(e.uri);
  });

  useSpeechRecognitionEvent('error', (e) => {
    // no-speech 在會議停頓很常見，不當錯誤；其餘才顯示
    if (e.error === 'no-speech') return;
    setError(e.message || e.error);
  });

  useSpeechRecognitionEvent('end', () => {
    if (engineRef.current !== 'expo') return;
    // continuous 在舊 iOS / Android 仍可能自行結束；只要使用者沒按停止就重啟
    if (wantRef.current) {
      try {
        beginExpoRecognition();
      } catch {
        wantRef.current = false;
        setListening(false);
      }
    } else {
      setListening(false);
    }
  });

  // ── SpeechAnalyzer 路徑（iOS 26+，命令式事件訂閱）──
  useEffect(() => {
    if (engineRef.current !== 'analyzer') return;
    const subs = [
      SpeechAnalyzer.addResultListener((r) => {
        if (r.isFinal) {
          pushFinal(r.text, r.startTime);
        } else {
          setPartial(r.text);
        }
      }),
      SpeechAnalyzer.addAudioEndListener((e) => pushAudioUri(e.uri)),
      SpeechAnalyzer.addErrorListener((e) => setError(e.message)),
      SpeechAnalyzer.addEndListener(() => {
        // SpeechAnalyzer 是長錄音引擎，結束只發生在使用者按停止 → 不自動重啟。
        wantRef.current = false;
        setListening(false);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  const beginExpoRecognition = () => {
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

  const start = async (lang: string) => {
    setError(null);
    // zh / en / auto → BCP-47
    langRef.current = lang === 'en' ? 'en-US' : 'zh-TW';
    wantRef.current = true;
    setListening(true);

    if (engineRef.current === 'analyzer') {
      const granted = await SpeechAnalyzer.requestPermissions();
      if (!granted) {
        wantRef.current = false;
        setListening(false);
        throw new Error('語音辨識 / 麥克風權限被拒');
      }
      await SpeechAnalyzer.start(langRef.current, true);
      return;
    }

    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      wantRef.current = false;
      setListening(false);
      throw new Error('語音辨識 / 麥克風權限被拒');
    }
    beginExpoRecognition();
  };

  const stop = () => {
    wantRef.current = false;
    if (engineRef.current === 'analyzer') {
      SpeechAnalyzer.stop();
    } else {
      ExpoSpeechRecognitionModule.stop();
    }
  };

  const reset = () => {
    setLines([]);
    setTimestamps([]);
    setPartial('');
    setError(null);
    audioUrisRef.current = [];
    setAudioUris([]);
  };

  return {
    lines,
    timestamps,
    partial,
    listening,
    error,
    audioUris,
    engine: engineRef.current,
    start,
    stop,
    reset,
  };
}

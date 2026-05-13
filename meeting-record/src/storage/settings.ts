// 設定持久化 — 用 expo-secure-store

import * as SecureStore from 'expo-secure-store';

export type Mode = 'openai' | 'local';

export interface Settings {
  mode: Mode;

  // OpenAI 雲端
  openaiApiKey: string;
  openaiTranscriptionModel: string; // 預設 whisper-1
  openaiChatModel: string;          // 預設 gpt-4.1

  // 本地 Ollama + 本地 Whisper（之後 production 用）
  llmUrl: string;
  whisperUrl: string;
  username: string;
  password: string;
  model: string;

  // 共用
  language: 'zh' | 'en' | 'auto';

  // 上次成功用的 [speaker_X] → 姓名 對應，SpeakerMappingView 進入時預填
  lastSpeakerMapping: Record<string, string>;
}

const KEY = 'app.settings.v2';

export const DEFAULT_SETTINGS: Settings = {
  mode: 'openai',
  openaiApiKey: '',
  openaiTranscriptionModel: 'gpt-4o-transcribe-diarize',
  openaiChatModel: 'gpt-4.1',
  llmUrl: '',
  whisperUrl: '',
  username: '',
  password: '',
  model: 'gpt-oss',
  language: 'zh',
  lastSpeakerMapping: {},
};

export async function loadSettings(): Promise<Settings> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
}

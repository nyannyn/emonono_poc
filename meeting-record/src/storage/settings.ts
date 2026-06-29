// 設定持久化 — 用 expo-secure-store

import * as SecureStore from 'expo-secure-store';
import { HAS_MANAGED_PROXY } from '../config/features';

export type Mode = 'openai' | 'local';
// 'managed' = 走我們自架的 proxy（內建 key，使用者免設定）；'own' = 使用者自己的 OpenAI key
export type KeySource = 'managed' | 'own';

export interface Settings {
  mode: Mode;

  // key 來源：公開版預設 managed（走 proxy）；進階使用者可改 own 用自己的 key
  keySource: KeySource;

  // OpenAI 雲端
  openaiApiKey: string;
  openaiTranscriptionModel: string; // 預設 whisper-1
  openaiChatModel: string;          // 預設 gpt-4.1

  // 自訂 LLM 端點（mode='local'）：本地 Ollama 或免費雲端（Gemini/Groq，OpenAI 相容）
  llmUrl: string;
  whisperUrl: string;
  username: string;
  password: string;
  llmApiKey: string; // 免費雲端用 Bearer key；本地 Ollama 留空
  model: string;

  // Live 即時字幕的轉譯來源：'device' = iOS 裝置端（免費/離線）；'openai' = 雲端（較準）
  liveSttSource: 'device' | 'openai';

  // 整段錄音的預設轉譯來源：'device' = iOS 裝置端原生（免費/離線/不分講者）；
  // 'cloud' = 雲端分講者（OpenAI 或 Gemini）。有可分講者的雲端 key 時，每次轉譯前還會跳選單覆寫。
  recordSttSource: 'device' | 'cloud';

  // 共用
  language: 'zh' | 'en' | 'auto';

  // 上次成功用的 [speaker_X] → 姓名 對應，SpeakerMappingView 進入時預填
  lastSpeakerMapping: Record<string, string>;
}

const KEY = 'app.settings.v2';

export const DEFAULT_SETTINGS: Settings = {
  mode: 'openai',
  keySource: 'managed',
  openaiApiKey: '',
  openaiTranscriptionModel: 'gpt-4o-transcribe-diarize',
  openaiChatModel: 'gpt-4.1',
  llmUrl: '',
  whisperUrl: '',
  username: '',
  password: '',
  llmApiKey: '',
  model: 'gemini-2.0-flash',
  liveSttSource: 'device',
  recordSttSource: 'device',
  language: 'zh',
  lastSpeakerMapping: {},
};

// === 整段錄音 per-session 選單：偵測可用的雲端分講者供應商 ===
export type Diarizer = 'openai' | 'gemini';

/** llmUrl 是否指向 Gemini（generativelanguage）端點。 */
export function isGeminiEndpoint(url: string): boolean {
  return /generativelanguage\.googleapis\.com/i.test(url ?? '');
}

/** OpenAI 分講者可用：走 managed proxy（內建 key）或自備 OpenAI key。 */
export function hasOpenAiDiarization(s: Settings): boolean {
  return s.keySource === 'managed' || !!s.openaiApiKey.trim();
}

/** Gemini 分講者可用：mode='local' 且填了 Bearer key 且端點是 Gemini。 */
export function hasGeminiDiarization(s: Settings): boolean {
  return s.mode === 'local' && !!s.llmApiKey.trim() && isGeminiEndpoint(s.llmUrl);
}

/** 本次轉譯可選的雲端分講者供應商（Gemini 優先列，因免費）。空陣列 → 只有原生、不跳選單。 */
export function availableDiarizers(s: Settings): Diarizer[] {
  const out: Diarizer[] = [];
  if (hasGeminiDiarization(s)) out.push('gemini');
  if (hasOpenAiDiarization(s)) out.push('openai');
  return out;
}

export async function loadSettings(): Promise<Settings> {
  const raw = await SecureStore.getItemAsync(KEY);
  let s = DEFAULT_SETTINGS;
  if (raw) {
    try {
      s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      s = DEFAULT_SETTINGS;
    }
  }
  // 沒設 managed proxy 的 build（EXPO_PUBLIC_PROXY_URL 未設）：強制走自己的 key。
  // 否則 keySource 預設 'managed'，設定頁既不顯示切換鈕（需 HAS_MANAGED_PROXY）也不顯示
  // API Key 欄（managed 時隱藏）→ 使用者被鎖在 managed 卻無 proxy，測試連線與轉錄都會
  // 打到空的 base URL → Network request failed。
  if (!HAS_MANAGED_PROXY && s.keySource === 'managed') {
    s = { ...s, keySource: 'own' };
  }
  return s;
}

export async function saveSettings(s: Settings): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
}

// 公開（App Store）版功能旗標。
//
// 開發期內部功能（本地 Ollama LLM、Realtime WebSocket 串流）在送審版隱藏，
// 只露 OpenAI 雲端路徑，避免審查員看到半成品或外部 ngrok 端點。
//
// EXPO_PUBLIC_* 會在 build 時被 Expo 內聯成字面值。
// `expo start`（開發）不設此變數 → 全功能開啟；
// EAS production / preview profile 設 EXPO_PUBLIC_BUILD=1 → 公開版（內部功能隱藏）。
export const IS_PUBLIC_BUILD = process.env.EXPO_PUBLIC_BUILD === '1';

// 自架 OpenAI proxy（內建 key 路線）。值在 build 時由 EAS profile 的
// EXPO_PUBLIC_PROXY_URL / EXPO_PUBLIC_PROXY_TOKEN 內聯。開發期通常留空 → 直接走 BYO-key。
export const MANAGED_PROXY_URL = (process.env.EXPO_PUBLIC_PROXY_URL ?? '').replace(/\/$/, '');
export const MANAGED_PROXY_TOKEN = process.env.EXPO_PUBLIC_PROXY_TOKEN ?? '';
/** managed 路線是否已設定好（沒設 URL 時退回 BYO-key）。 */
export const HAS_MANAGED_PROXY = MANAGED_PROXY_URL.length > 0;

export const FEATURES = {
  /** 本地 Ollama LLM 模式（Settings 的 LLM 來源切換 + NotesView 比對）。 */
  localOllamaMode: !IS_PUBLIC_BUILD,
  /** Realtime WebSocket 串流轉譯（實驗）。 */
  realtimeStreaming: !IS_PUBLIC_BUILD,
};

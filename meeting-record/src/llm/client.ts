// LLMClient — 雙模式：OpenAI 雲端 (Bearer) / 本地 Ollama (Basic)
// STT 永遠走 OpenAI（部門 Ollama 端點無 STT）
// 模型若為 gpt-4o-transcribe-diarize，會自動把 [speaker_*] 標籤嵌入文字

import { File } from 'expo-file-system';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import { KeySource, Mode } from '../storage/settings';
import { cleanupChunks, splitWavIfNeeded } from '../audio/wavChunker';
import { autoMapSpeakers, prependVoiceprints } from '../audio/voiceprintMix';
import { Member } from '../storage/db';
import { MANAGED_PROXY_TOKEN, MANAGED_PROXY_URL } from '../config/features';
import { fetchWithTimeout, parseJsonSafe } from './http';

// 各類請求逾時：STT 上傳較久、chat 中等
const STT_TIMEOUT_MS = 300000; // 5 分鐘（大檔上傳 + 轉譯）
const CHAT_TIMEOUT_MS = 120000; // 2 分鐘

// === Gemini 分講者（CP1 實測驗證）===
// 走 Gemini 原生 generateContent + inline_data base64（非 OpenAI 相容端點，才能設 thinkingBudget）。
const GEMINI_DIARIZE_MODEL = 'gemini-2.5-flash'; // 免費層唯一可用；2.0-flash 免費額度=0
const GEMINI_CHUNK_MAX = 12 * 1024 * 1024;       // 每段 ≤12MB WAV → base64 <20MB inline 上限；切段亦避免長檔崩潰
// 非 WAV（如 iPhone 語音備忘錄 m4a）走 File API：裝置端無 ffmpeg 不能實體切段，
// 改成「整檔上傳一次 → 依時間窗多次請求」。單次塞長檔會在 ~27 分卡迴圈丟內容，故分窗。
const GEMINI_FILE_WINDOW_SEC = 12 * 60;          // 每窗 12 分鐘（CP1b 驗過 12 分穩定）
const GEMINI_WINDOW_TIMEOUT_MS = 540000;         // 單窗最長 9 分鐘（實測長音訊窗最久 ~6 分鐘）
const GEMINI_MAX_WINDOWS = 30;                   // 安全上限（~6 小時），避免取不到長度時無限請求
const GEMINI_DIARIZE_PROMPT = `請把這段會議錄音整理成「帶講者標註的逐字稿」（speaker diarization）。
要求：
1. 全程使用繁體中文輸出。
2. 每當說話者改變就另起一段，段首標講者標籤，格式固定為「Speaker N:」（N 為阿拉伯數字，從 1 起算）。同一個人沿用同一個編號。
3. 逐字照實轉錄（保留口語），但修正明顯的語音辨識錯誤並補上標點。
4. 技術名詞（NVMe、PCIe、SSD 等）保留英文。
5. 只輸出逐字稿本身，開頭不要任何前言或說明。`;

export const MEETING_NOTES_PROMPT = `你是一位專業的會議記錄整理員。請根據以下會議逐字稿，整理成一份完整的繁體中文會議記錄。

## 要求格式（Markdown）：

### 一、會議摘要
（3-5 句話概述本次會議的主要內容與結論）

### 二、行動項目
（條列所有需要跟進的事項，若有提及負責人請標註）

### 三、討論主題與重點
（依討論順序，列出各主題的重點摘要，每個主題獨立段落）

### 四、待釐清事項
（列出會議中尚未解決或需要進一步確認的問題，若無則寫「無」）

---

注意事項：
- 使用繁體中文撰寫
- 技術名詞保留英文
- 重點條列，清晰易讀

逐字稿如下：
---
{transcript}
---`;

export const SYSTEM_NOTES = '你是一位精通科技產業的專業會議記錄員，擅長整理繁體中文技術會議記錄。';

export interface ClientConfig {
  mode: Mode;
  // 'managed' → 走自架 proxy（內建 key）；'own' → 使用者自己的 OpenAI key
  keySource?: KeySource;
  // OpenAI
  openaiApiKey?: string;
  openaiTranscriptionModel?: string;
  openaiChatModel?: string;
  // Local / 自訂 OpenAI 相容端點（本地 Ollama 或免費雲端 Gemini/Groq）
  llmUrl?: string;
  whisperUrl?: string;
  username?: string;
  password?: string;
  llmApiKey?: string;
  model?: string;
}

export class LLMClient {
  constructor(private cfg: ClientConfig) {}

  private trim(u: string) {
    return u.replace(/\/$/, '');
  }

  // managed 模式：對外都打自架 proxy（OpenAI 相容），auth 用 app proxy token，
  // 真正的 OpenAI key 由 proxy 持有。否則直連 OpenAI、auth 用使用者自己的 key。
  private get managed() {
    return this.cfg.keySource === 'managed';
  }

  private openaiBase() {
    return this.managed ? this.trim(MANAGED_PROXY_URL) : 'https://api.openai.com';
  }

  private openaiAuth() {
    return `Bearer ${this.managed ? MANAGED_PROXY_TOKEN : this.cfg.openaiApiKey ?? ''}`;
  }

  private llmEndpoint() {
    if (this.cfg.mode === 'openai') {
      return {
        url: `${this.openaiBase()}/v1/chat/completions`,
        auth: this.openaiAuth(),
        model: this.cfg.openaiChatModel || 'gpt-4.1',
      };
    }
    return {
      url: `${this.trim(this.cfg.llmUrl ?? '')}/chat/completions`,
      // 有 API Key → Bearer（免費雲端 Gemini/Groq）；否則 Basic（本地 Ollama，留空也行）
      auth: this.cfg.llmApiKey
        ? `Bearer ${this.cfg.llmApiKey}`
        : `Basic ${btoa(`${this.cfg.username ?? ''}:${this.cfg.password ?? ''}`)}`,
      model: this.cfg.model || 'gemini-2.0-flash',
    };
  }

  private sttEndpoint() {
    return {
      url: `${this.openaiBase()}/v1/audio/transcriptions`,
      auth: this.openaiAuth(),
      model: this.cfg.openaiTranscriptionModel || 'whisper-1',
    };
  }

  /**
   * Transcribe 一個音檔。
   * - .wav 檔超過 24MB → 自動切段（splitWavIfNeeded）+ 多次呼叫 + concat
   * - 非 wav 檔超過 24MB → throw（Expo Go 沒 ffmpeg）
   */
  async transcribe(
    fileUri: string,
    opts: {
      language?: string;
      prompt?: string;
      temperature?: number;
      onProgress?: (done: number, total: number) => void;
    } = {},
  ): Promise<string> {
    let size = 0;
    try {
      size = new File(fileUri).size ?? 0;
    } catch {
      // 檔案 shared object 取不到 → 當小檔處理，讓伺服器決定
    }
    const MAX = 24 * 1024 * 1024;

    if (size > MAX && !fileUri.toLowerCase().endsWith('.wav')) {
      throw new Error(
        `音檔 ${(size / 1048576).toFixed(1)} MB 超過雲端轉錄單檔 25MB 上限。請改用 app 內錄音（不限長度，會自動分段），或上傳 25MB 以內的音檔。`,
      );
    }

    if (size > MAX) {
      const chunks = await splitWavIfNeeded(fileUri, MAX);
      const texts: string[] = [];
      for (const c of chunks) {
        opts.onProgress?.(c.index, c.total);
        texts.push(await this.transcribeOne(c.uri, opts.language, opts.prompt, opts.temperature));
      }
      cleanupChunks(chunks, fileUri);
      opts.onProgress?.(chunks.length, chunks.length);
      return texts.join(' ');
    }

    return this.transcribeOne(fileUri, opts.language, opts.prompt, opts.temperature);
  }

  private async transcribeOne(fileUri: string, language?: string, prompt?: string, temperature?: number): Promise<string> {
    const ep = this.sttEndpoint();
    const isDiarize = /diarize/i.test(ep.model);
    // 只有 whisper-1 完整支援 verbose_json；gpt-4o-transcribe / diarize 都只吃 json/text
    const isLegacyWhisper = /^whisper-1/i.test(ep.model);

    const buildForm = (fmt: string) => {
      const form = new FormData();
      form.append('file', {
        uri: fileUri,
        name: fileUri.split('/').pop() ?? 'audio.wav',
        type: fileUri.endsWith('.m4a') ? 'audio/m4a' : 'audio/wav',
      } as any);
      form.append('model', ep.model);
      form.append('response_format', fmt);
      if (language) form.append('language', language);
      // diarize 模型不吃 prompt（API 會回 400）
      if (prompt && !isDiarize) form.append('prompt', prompt);
      // temperature=0 減少幻覺；diarize 也不吃 temperature
      if (!isDiarize) form.append('temperature', String(temperature ?? 0));
      return form;
    };

    const post = async (form: FormData) =>
      fetchWithTimeout(ep.url, { method: 'POST', headers: { Authorization: ep.auth }, body: form }, STT_TIMEOUT_MS);

    // diarize 模型先試 diarized_json；不支援就退回 json
    if (isDiarize) {
      let res = await post(buildForm('diarized_json'));
      if (!res.ok) {
        const errText = await res.text();
        if (/response_format/i.test(errText)) {
          res = await post(buildForm('json'));
          if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
        } else {
          throw new Error(`STT ${res.status}: ${errText}`);
        }
      }
      return formatTranscript(await parseJsonSafe(res, 'STT 回應'));
    }

    // whisper-1 用 verbose_json 拿 segments；其它（gpt-4o-transcribe 等）只能 json
    const fmt = isLegacyWhisper ? 'verbose_json' : 'json';
    const res = await post(buildForm(fmt));
    if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
    return formatTranscript(await parseJsonSafe(res, 'STT 回應'));
  }

  // 從 llmUrl 取 origin（File/generateContent 用 Gemini 原生 base，非 OpenAI 相容路徑）
  private geminiOrigin(): string {
    const m = (this.cfg.llmUrl ?? '').match(/^(https?:\/\/[^/]+)/i);
    return m ? m[1] : 'https://generativelanguage.googleapis.com';
  }

  private geminiHeaders(): Record<string, string> {
    return { 'x-goog-api-key': this.cfg.llmApiKey ?? '' };
  }

  /** Gemini generateContent POST + 免費層 429 退避重試。res.ok 時原樣回傳（呼叫端負責讀 body）。 */
  private async geminiGenerate(body: unknown, timeoutMs: number, maxAttempts = 3): Promise<Response> {
    const url = `${this.geminiOrigin()}/v1beta/models/${GEMINI_DIARIZE_MODEL}:generateContent`;
    for (let attempt = 1; ; attempt++) {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.geminiHeaders() },
        body: JSON.stringify(body),
      }, timeoutMs);
      if (res.ok) return res;
      const errText = await res.text();
      if (res.status === 429 && attempt < maxAttempts) {
        const m = errText.match(/retry in ([\d.]+)s/i);
        const waitMs = Math.min(60000, m ? Math.ceil(parseFloat(m[1]) + 2) * 1000 : 30000);
        await sleep(waitMs);
        continue;
      }
      throw new Error(`Gemini STT ${res.status}: ${errText}`);
    }
  }

  private async geminiTextFrom(res: Response): Promise<string> {
    const data = await parseJsonSafe(res, 'Gemini 回應');
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p: any) => p?.text ?? '').join('').trim();
  }

  /** 單段音檔（base64）→ Gemini 帶 `Speaker N:` 標籤的原始逐字稿文字（WAV inline 路徑用）。 */
  private async geminiDiarizeInline(base64Audio: string, mimeType = 'audio/wav'): Promise<string> {
    const res = await this.geminiGenerate({
      contents: [{ parts: [
        { inline_data: { mime_type: mimeType, data: base64Audio } },
        { text: GEMINI_DIARIZE_PROMPT },
      ] }],
      generationConfig: {
        maxOutputTokens: 32768,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 }, // 必設：thinking 開會回空字串/重複迴圈（CP1 實證）
      },
    }, STT_TIMEOUT_MS);
    return this.geminiTextFrom(res);
  }

  /** 上傳音檔到 Gemini File API（resumable，邊讀邊傳不爆記憶體）→ 等到 ACTIVE，回 { name, uri }。 */
  private async geminiUploadFile(fileUri: string, mimeType: string, numBytes: number): Promise<{ name: string; uri: string }> {
    const origin = this.geminiOrigin();
    // 1) 起始 resumable session，從回應 header 取上傳 URL
    const start = await fetchWithTimeout(`${origin}/upload/v1beta/files`, {
      method: 'POST',
      headers: {
        ...this.geminiHeaders(),
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(numBytes),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'meeting-audio' } }),
    }, STT_TIMEOUT_MS);
    if (!start.ok) throw new Error(`Gemini File 上傳起始失敗 ${start.status}: ${await start.text()}`);
    const uploadUrl = start.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new Error('Gemini File API 未回傳上傳 URL');

    // 2) 上傳檔案 bytes + finalize（legacy uploadAsync 直接把檔案串流成 request body）
    const up = await uploadAsync(uploadUrl, fileUri, {
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    });
    if (up.status < 200 || up.status >= 300) throw new Error(`Gemini File 上傳失敗 ${up.status}: ${(up.body ?? '').slice(0, 200)}`);
    let meta: any;
    try { meta = JSON.parse(up.body); } catch { throw new Error(`Gemini File 上傳回應非 JSON：${(up.body ?? '').slice(0, 200)}`); }
    const file = meta?.file ?? meta;
    const name: string = file?.name;
    let uri: string = file?.uri;
    let state: string = file?.state;
    if (!name || !uri) throw new Error('Gemini File 上傳回應缺 name/uri');

    // 3) audio 需伺服器處理：輪詢到 ACTIVE
    const deadline = Date.now() + STT_TIMEOUT_MS;
    while (state === 'PROCESSING') {
      if (Date.now() > deadline) throw new Error('Gemini File 處理逾時');
      await sleep(2000);
      const g = await fetchWithTimeout(`${origin}/v1beta/${name}`, { headers: this.geminiHeaders() }, CHAT_TIMEOUT_MS);
      if (!g.ok) throw new Error(`Gemini File 狀態查詢失敗 ${g.status}`);
      const gd = await parseJsonSafe(g, 'Gemini File 狀態');
      state = gd?.state;
      if (gd?.uri) uri = gd.uri;
    }
    if (state !== 'ACTIVE') throw new Error(`Gemini File 處理失敗（state=${state ?? '未知'}）`);
    return { name, uri };
  }

  private async geminiDeleteFile(name: string): Promise<void> {
    await fetchWithTimeout(`${this.geminiOrigin()}/v1beta/${name}`, { method: 'DELETE', headers: this.geminiHeaders() }, CHAT_TIMEOUT_MS);
  }

  /** 對「已上傳的 File」只轉錄某時間窗（lo~hi 秒）。模型看得到整段 → 要求講者編號全段一致。 */
  private async geminiDiarizeWindow(fileRefUri: string, mimeType: string, loSec: number, hiSec: number, durSec: number): Promise<string> {
    const scope = `\n\n（這是一段較長錄音${durSec > 0 ? `，總長約 ${Math.round(durSec / 60)} 分鐘` : ''}。）請「只」輸出從 ${fmtClock(loSec)} 到 ${fmtClock(hiSec)} 這個時間區間的逐字稿，其餘時間忽略不要輸出。但講者編號要以「整段錄音」為準：同一個人不論在哪個區間都用同一個 Speaker 編號。每段講者標籤後、文字前加上該段在整段錄音中的絕對時間，格式 [MM:SS]。只輸出此區間逐字稿，不要任何前言或說明。`;
    const res = await this.geminiGenerate({
      contents: [{ parts: [
        { file_data: { mime_type: mimeType, file_uri: fileRefUri } },
        { text: GEMINI_DIARIZE_PROMPT + scope },
      ] }],
      generationConfig: {
        maxOutputTokens: 32768,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }, GEMINI_WINDOW_TIMEOUT_MS);
    return this.geminiTextFrom(res);
  }

  /**
   * Gemini 分講者轉錄。
   * - WAV（app 內錄）：切 ≤12MB 段 → 每段拼聲紋 inline 轉錄 → autoMap 反推姓名（CP1 驗證流程）。
   * - 非 WAV（如 iPhone 語音備忘錄 m4a，裝置端無 ffmpeg 不能切段）：見 transcribeNonWavViaFileApi。
   */
  async transcribeWithGeminiDiarized(
    fileUri: string,
    members: Member[],
    opts: { onProgress?: (done: number, total: number) => void } = {},
  ): Promise<string> {
    if (!fileUri.toLowerCase().endsWith('.wav')) {
      return this.transcribeNonWavViaFileApi(fileUri, opts);
    }

    const chunks = await splitWavIfNeeded(fileUri, GEMINI_CHUNK_MAX, GEMINI_CHUNK_MAX);
    const outParts: string[] = [];
    try {
      for (const c of chunks) {
        opts.onProgress?.(c.index, c.total);
        // 每段都拼聲紋首句，讓本段 diarize 結果能用 autoMapSpeakers 反推姓名（解跨段編號不一致）
        let chunkUri = c.uri;
        if (members.length > 0) {
          try { chunkUri = await prependVoiceprints(c.uri, members); } catch { chunkUri = c.uri; }
        }
        const b64 = await new File(chunkUri).base64();
        if (chunkUri !== c.uri) { try { new File(chunkUri).delete(); } catch { /* 清不掉忽略 */ } }

        let raw = await this.geminiDiarizeInline(b64);
        raw = collapseRepeats(raw);
        let text = formatTranscript({ text: raw });
        if (members.length > 0 && /\[speaker[_\s]?\w+\]/i.test(text)) {
          text = autoMapSpeakers(text, members).text;
        }
        outParts.push(text.trim());
      }
    } finally {
      cleanupChunks(chunks, fileUri);
    }
    opts.onProgress?.(chunks.length, chunks.length);
    return outParts.filter(Boolean).join('\n\n');
  }

  /**
   * 非 WAV（m4a 等）：上傳 File API 一次 → 依音檔長度切 12 分鐘時間窗逐窗轉錄 → 串接。
   * 裝置端無 ffmpeg 不能實體切段，改用「同一上傳、多窗請求」；每窗都把整段當 context，
   * 故可要求講者編號全段一致（實體切段做不到）。長度取不到時逐窗試到空窗為止。
   */
  private async transcribeNonWavViaFileApi(
    fileUri: string,
    opts: { onProgress?: (done: number, total: number) => void },
  ): Promise<string> {
    let numBytes = 0;
    try { numBytes = new File(fileUri).size ?? 0; } catch { /* 取不到讓伺服器決定 */ }
    const mime = geminiAudioMime(fileUri);
    const durSec = await audioDurationSec(fileUri);
    const totalWindows = durSec > 0
      ? Math.min(GEMINI_MAX_WINDOWS, Math.max(1, Math.ceil(durSec / GEMINI_FILE_WINDOW_SEC)))
      : GEMINI_MAX_WINDOWS;

    const { name, uri } = await this.geminiUploadFile(fileUri, mime, numBytes);
    const outParts: string[] = [];
    let done = 0;
    try {
      for (let i = 0; i < totalWindows; i++) {
        opts.onProgress?.(i, durSec > 0 ? totalWindows : i + 1);
        const lo = i * GEMINI_FILE_WINDOW_SEC;
        const hi = (i + 1) * GEMINI_FILE_WINDOW_SEC;
        let raw = await this.geminiDiarizeWindow(uri, mime, lo, hi, durSec);
        raw = collapseRepeats(raw);
        const text = formatTranscript({ text: raw }).trim();
        done = i + 1;
        // 長度未知時：非首窗的空窗代表已過結尾 → 收工（首窗不 break，避免偶發空回應整段失敗）
        if (durSec === 0 && i > 0 && stripForEmptyCheck(text).length < 4) break;
        if (text) outParts.push(text);
      }
    } finally {
      try { await this.geminiDeleteFile(name); } catch { /* 清不掉 48h 後自動過期 */ }
    }
    opts.onProgress?.(durSec > 0 ? totalWindows : done, durSec > 0 ? totalWindows : done);
    return outParts.filter(Boolean).join('\n\n');
  }

  async generateMeetingNotes(transcript: string): Promise<{ text: string; usage: TokenUsage }> {
    const ep = this.llmEndpoint();
    const prompt = MEETING_NOTES_PROMPT.replace('{transcript}', transcript);
    const t0 = Date.now();
    const res = await fetchWithTimeout(ep.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: ep.auth,
      },
      body: JSON.stringify({
        model: ep.model,
        messages: [
          { role: 'system', content: SYSTEM_NOTES },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    }, CHAT_TIMEOUT_MS);
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    const data = await parseJsonSafe(res, 'LLM 回應');
    const u = data?.usage ?? {};
    const input = u.prompt_tokens ?? u.input_tokens ?? 0;
    const output = u.completion_tokens ?? u.output_tokens ?? 0;
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      usage: {
        model: ep.model,
        input,
        output,
        total: u.total_tokens ?? input + output,
        elapsedMs: Date.now() - t0,
      },
    };
  }
}

export interface TokenUsage {
  model: string;
  input: number;
  output: number;
  total: number;
  elapsedMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 副檔名 → Gemini 接受的 audio mime。m4a/mp4 走 audio/mp4（File API 實測可吃）。 */
function geminiAudioMime(uri: string): string {
  const ext = uri.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'wav': return 'audio/wav';
    case 'mp3': return 'audio/mp3';
    case 'aac': return 'audio/aac';
    case 'flac': return 'audio/flac';
    case 'ogg': return 'audio/ogg';
    case 'aiff': case 'aif': return 'audio/aiff';
    default: return 'audio/mp4'; // m4a / mp4 / m4b / 未知 → 當 mp4 容器
  }
}

/** 秒 → "M:SS"（分鐘可超過 59，例如 720→"12:00"、3600→"60:00"；Gemini 實測能解讀）。 */
function fmtClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 去掉講者/時間標籤與空白，用來判斷一個窗是不是「空的」（已過錄音結尾）。 */
function stripForEmptyCheck(t: string): string {
  return t
    .replace(/\[speaker_\w+\]/gi, '')
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, '')
    .replace(/\s+/g, '');
}

/** 讀音檔長度（秒，無條件進位）。取不到回 0（呼叫端改用「逐窗試到空」）。 */
async function audioDurationSec(uri: string): Promise<number> {
  try {
    const { sound, status } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false }, null, true);
    const ms = status.isLoaded ? (status.durationMillis ?? 0) : 0;
    await sound.unloadAsync();
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
  } catch {
    return 0;
  }
}

/** Whisper / diarize 回應 → 統一文字格式，speaker 標籤都正規化成 [speaker_N]。 */
function formatTranscript(data: any): string {
  const segments: any[] = data?.segments ?? [];

  // Case 1: verbose_json 風格，segments 內有 speaker
  if (segments.length && segments.some((s) => s.speaker)) {
    let last = '';
    const out: string[] = [];
    for (const s of segments) {
      const sp = normalizeSpeakerLabel(String(s.speaker ?? 'unknown'));
      if (sp !== last) {
        out.push(`\n\n[${sp}]\n`);
        last = sp;
      }
      out.push(String(s.text ?? '').trim() + ' ');
    }
    return out.join('').trim();
  }

  // Case 2: segments 沒 speaker → 純 concat（用空白接，避免句子黏在一起）
  if (segments.length) {
    return segments.map((s) => (s.text ?? '').toString().trim()).filter(Boolean).join(' ').trim();
  }

  // Case 3: 只有 text。diarize 模型 + json 通常會把講者標在文字裡
  // 例如 "Speaker 1: 你好" / "[Speaker 1] ..." / "speaker_1: ..." → 統一成 [speaker_1]\n...
  let text = (data?.text ?? '').toString();
  text = text
    .replace(/\[\s*[Ss]peaker[_\s]?(\w+)\s*\]\s*:?\s*/g, '\n\n[speaker_$1]\n')
    .replace(/(^|\n|\.\s)\s*[Ss]peaker[_\s]?(\w+)\s*:\s*/g, '$1\n\n[speaker_$2]\n')
    .replace(/(^|\n)\s*\(\s*[Ss]peaker[_\s]?(\w+)\s*\)\s*:?\s*/g, '$1\n\n[speaker_$2]\n');
  return text.trim();
}

function normalizeSpeakerLabel(raw: string): string {
  // "Speaker 1" / "Speaker_1" / "speaker_1" / "1" → "speaker_1"
  const m = raw.match(/(\w+)$/);
  const tail = m ? m[1] : raw;
  return `speaker_${tail.toLowerCase()}`;
}

/** 收掉連續重複的短句（音訊 LLM 尾端每句「嗯。」重複迴圈幻覺）；保留前 maxKeep 句。 */
function collapseRepeats(text: string, maxKeep = 2, shortLen = 6): string {
  const out: string[] = [];
  let prev = '';
  let run = 0;
  for (const line of text.split('\n')) {
    const body = line.replace(/^\s*Speaker\s*\w+\s*:\s*/i, '').trim();
    if (body === prev && body.length <= shortLen) {
      run += 1;
      if (run >= maxKeep) continue;
    } else {
      prev = body;
      run = 0;
    }
    out.push(line);
  }
  return out.join('\n');
}

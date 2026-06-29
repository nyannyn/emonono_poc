// LLMClient — 雙模式：OpenAI 雲端 (Bearer) / 本地 Ollama (Basic)
// STT 永遠走 OpenAI（部門 Ollama 端點無 STT）
// 模型若為 gpt-4o-transcribe-diarize，會自動把 [speaker_*] 標籤嵌入文字

import { File } from 'expo-file-system';
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

  /** 單段音檔（base64 WAV）→ Gemini 帶 `Speaker N:` 標籤的原始逐字稿文字。 */
  private async geminiDiarizeInline(base64Audio: string): Promise<string> {
    const url = `${this.geminiOrigin()}/v1beta/models/${GEMINI_DIARIZE_MODEL}:generateContent`;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.cfg.llmApiKey ?? '',
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: 'audio/wav', data: base64Audio } },
            { text: GEMINI_DIARIZE_PROMPT },
          ],
        }],
        generationConfig: {
          maxOutputTokens: 32768,
          temperature: 0,
          thinkingConfig: { thinkingBudget: 0 }, // 必設：thinking 開會回空字串/重複迴圈（CP1 實證）
        },
      }),
    }, STT_TIMEOUT_MS);
    if (!res.ok) throw new Error(`Gemini STT ${res.status}: ${await res.text()}`);
    const data = await parseJsonSafe(res, 'Gemini 回應');
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p: any) => p?.text ?? '').join('').trim();
  }

  /**
   * Gemini 分講者轉錄（CP1 驗證流程）：切 ≤12MB WAV 段 → 每段拼聲紋 → inline 轉錄
   * → 正規化 [speaker_N] → autoMapSpeakers 反推姓名（跨段以姓名一致）→ 重複迴圈過濾 → 串接。
   * 僅支援 app 內錄的 WAV（裝置端無 ffmpeg，無法切段非 WAV 長檔）。
   */
  async transcribeWithGeminiDiarized(
    fileUri: string,
    members: Member[],
    opts: { onProgress?: (done: number, total: number) => void } = {},
  ): Promise<string> {
    if (!fileUri.toLowerCase().endsWith('.wav')) {
      let size = 0;
      try { size = new File(fileUri).size ?? 0; } catch { /* 取不到當小檔 */ }
      if (size > GEMINI_CHUNK_MAX) {
        throw new Error('Gemini 分講者目前只支援 app 內錄的 WAV（裝置端無法切段非 WAV 長檔）。請改用 app 內錄音，或改用 OpenAI 分講者。');
      }
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

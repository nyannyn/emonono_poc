// LLMClient — 雙模式：OpenAI 雲端 (Bearer) / 本地 Ollama (Basic)
// STT 永遠走 OpenAI（部門 Ollama 端點無 STT）
// 模型若為 gpt-4o-transcribe-diarize，會自動把 [speaker_*] 標籤嵌入文字

import { File } from 'expo-file-system';
import { Mode } from '../storage/settings';
import { cleanupChunks, splitWavIfNeeded } from '../audio/wavChunker';

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
  // OpenAI
  openaiApiKey?: string;
  openaiTranscriptionModel?: string;
  openaiChatModel?: string;
  // Local
  llmUrl?: string;
  whisperUrl?: string;
  username?: string;
  password?: string;
  model?: string;
}

export class LLMClient {
  constructor(private cfg: ClientConfig) {}

  private trim(u: string) {
    return u.replace(/\/$/, '');
  }

  private llmEndpoint() {
    if (this.cfg.mode === 'openai') {
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        auth: `Bearer ${this.cfg.openaiApiKey ?? ''}`,
        model: this.cfg.openaiChatModel || 'gpt-4.1',
      };
    }
    return {
      url: `${this.trim(this.cfg.llmUrl ?? '')}/chat/completions`,
      auth: `Basic ${btoa(`${this.cfg.username ?? ''}:${this.cfg.password ?? ''}`)}`,
      model: this.cfg.model || 'gpt-oss',
    };
  }

  private sttEndpoint() {
    return {
      url: 'https://api.openai.com/v1/audio/transcriptions',
      auth: `Bearer ${this.cfg.openaiApiKey ?? ''}`,
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
        `音檔 ${(size / 1048576).toFixed(1)} MB 超過 25MB 上限，且非 WAV 格式無法在 app 內切段。請改用 poc/transcribe_and_summarize.py（Python 端有 ffmpeg）。`,
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
      fetch(ep.url, { method: 'POST', headers: { Authorization: ep.auth }, body: form });

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
      return formatTranscript(await res.json());
    }

    // whisper-1 用 verbose_json 拿 segments；其它（gpt-4o-transcribe 等）只能 json
    const fmt = isLegacyWhisper ? 'verbose_json' : 'json';
    const res = await post(buildForm(fmt));
    if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
    return formatTranscript(await res.json());
  }

  async generateMeetingNotes(transcript: string): Promise<{ text: string; usage: TokenUsage }> {
    const ep = this.llmEndpoint();
    const prompt = MEETING_NOTES_PROMPT.replace('{transcript}', transcript);
    const t0 = Date.now();
    const res = await fetch(ep.url, {
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
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    const data = await res.json();
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

  // Case 2: segments 沒 speaker → 純 concat
  if (segments.length) {
    return segments.map((s) => (s.text ?? '').toString()).join('').trim();
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

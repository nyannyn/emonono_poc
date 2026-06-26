// 把成員聲紋首句拼到會議錄音前面，讓 Whisper diarize 看到「同一個聲音」自動歸成一組
// 加上 autoMapSpeakers：根據聲紋首句裡的「我是 ___」把 [speaker_X] 對應到成員姓名
// 串流版：concat 用 FileHandle 視窗複製，避免整段會議錄音與合併檔同時佔記憶體。

import { Directory, File, Paths } from 'expo-file-system';
import { Member } from '../storage/db';

const HEADER_SCAN_BYTES = 64 * 1024;
const COPY_WINDOW = 4 * 1024 * 1024; // 4MB 串流視窗

/** 正規 RIFF chunk walker：跳過 fmt / LIST / FLLR 等找 data（偶數對齊）。 */
function findDataChunk(bytes: Uint8Array): { dataStart: number; header: Uint8Array } {
  const isRiff =
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
  if (!isRiff) {
    const head = Array.from(bytes.slice(0, 4))
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '?')).join('');
    throw new Error(`非 WAV (頭: "${head}")，可能 iOS 錄成 AAC`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  let pos = 12; // 跳 "RIFF<size>WAVE"
  while (pos + 8 <= bytes.length) {
    const tag = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    const size = view.getUint32(pos + 4, true);
    if (tag === 'data') {
      return { dataStart: pos + 8, header: bytes.slice(0, pos + 8) };
    }
    pos += 8 + size;
    if (size % 2 === 1) pos += 1; // RIFF chunks 對齊到偶數
    if (pos < 0) break;
  }
  throw new Error(`WAV 沒有 data chunk (掃 ${bytes.length} bytes，最後 pos=${pos})`);
}

function rewriteHeader(header: Uint8Array, newDataLen: number): Uint8Array {
  const out = new Uint8Array(header);
  const view = new DataView(out.buffer);
  view.setUint32(4, out.length - 8 + newDataLen, true);
  view.setUint32(out.length - 4, newDataLen, true);
  return out;
}

interface Seg { uri: string; dataStart: number; dataLen: number; header: Uint8Array; }

/** 只讀檔頭解析 data 範圍，不讀整檔。 */
function readWavMeta(uri: string): Seg {
  const f = new File(uri);
  const size = f.size ?? 0;
  if (size <= 0) throw new Error('檔案大小為 0');
  const fh = f.open();
  try {
    fh.offset = 0;
    const headScan = fh.readBytes(Math.min(HEADER_SCAN_BYTES, size));
    const { dataStart, header } = findDataChunk(headScan);
    return { uri, dataStart, dataLen: size - dataStart, header };
  } finally {
    fh.close();
  }
}

/** 把多個同格式 WAV 串成一檔，壞段自動跳過，回傳新檔 URI（在 cache）。串流複製避免 OOM。 */
export async function concatWavs(uris: string[]): Promise<string> {
  if (uris.length === 0) throw new Error('沒有檔案可串');

  const segs: Seg[] = [];
  let skipped = 0;
  let firstError = '';
  for (const uri of uris) {
    try {
      segs.push(readWavMeta(uri));
    } catch (e: any) {
      skipped += 1;
      if (!firstError) firstError = String(e?.message ?? e);
    }
  }

  if (segs.length === 0) throw new Error(`所有 ${uris.length} 段都讀不出 WAV → ${firstError}`);
  if (segs.length === 1 && skipped === 0) return segs[0].uri;

  const totalLen = segs.reduce((s, w) => s + w.dataLen, 0);
  const newHeader = rewriteHeader(segs[0].header, totalLen);

  const dir = new Directory(Paths.cache, 'wav_combined');
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `combined_${Date.now()}.wav`);
  dest.create();

  const out = dest.open();
  try {
    let writePos = 0;
    out.offset = writePos;
    out.writeBytes(newHeader);
    writePos += newHeader.length;

    for (const seg of segs) {
      const fh = new File(seg.uri).open();
      try {
        let remaining = seg.dataLen;
        let readPos = seg.dataStart;
        while (remaining > 0) {
          const n = Math.min(COPY_WINDOW, remaining);
          fh.offset = readPos;
          const buf = fh.readBytes(n);
          if (buf.length === 0) break; // 防呆，避免無限迴圈
          out.offset = writePos;
          out.writeBytes(buf);
          readPos += buf.length;
          writePos += buf.length;
          remaining -= buf.length;
        }
      } finally {
        fh.close();
      }
    }
  } finally {
    out.close();
  }
  return dest.uri;
}

/**
 * 把 selected 成員的前 N 句聲紋串到 meetingUri 前面。回傳合併後 URI。
 * 用 2 句而非 1 句：給 diarize 更多語音特徵、降低同人被判成兩個 speaker 的機率。
 */
export async function prependVoiceprints(meetingUri: string, members: Member[]): Promise<string> {
  const SAMPLES_PER_MEMBER = 2;
  const samples: string[] = [];
  for (const m of members) {
    try {
      const paths: string[] = JSON.parse(m.voiceprint_paths ?? '[]');
      for (let i = 0; i < Math.min(SAMPLES_PER_MEMBER, paths.length); i++) {
        if (paths[i]) samples.push(paths[i]);
      }
    } catch {
      // bad json, skip
    }
  }
  if (samples.length === 0) return meetingUri;
  return concatWavs([...samples, meetingUri]);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 自動把 [speaker_X] 對應到成員姓名。
 * 策略：
 *   1. 姓名 contains：speaker 對話文本若包含成員姓名（聲紋首句會說名字）→ 直接對應
 *   2. 位置式 fallback：剩下 unmapped 的 speaker 按「在 transcript 內第一次出現的順序」配給剩下未用的成員
 *      （前提是 prependVoiceprints 順序 = members 順序，speaker 出現順序也對應）
 */
export function autoMapSpeakers(
  transcript: string,
  members: Member[],
): { text: string; mapping: Record<string, string>; ambiguous: string[] } {
  // 找 speaker 第一次出現順序
  const ordered: string[] = [];
  const seen = new Set<string>();
  const re = /\[(speaker[_\s]?\w+)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(transcript)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      ordered.push(m[1]);
    }
  }

  const mapping: Record<string, string> = {};
  const ambiguous: string[] = [];
  const used = new Set<string>();

  // 1) 姓名 contains
  for (const sp of ordered) {
    const segRe = new RegExp(`\\[${escapeRegex(sp)}\\]([^\\[]+)`, 'gi');
    const allText = [...transcript.matchAll(segRe)].map((x) => x[1]).join(' ').slice(0, 400);
    let best: { name: string; pos: number } | null = null;
    for (const member of members) {
      if (used.has(member.name)) continue;
      const idx = allText.toLowerCase().indexOf(member.name.toLowerCase());
      if (idx >= 0 && (!best || idx < best.pos)) best = { name: member.name, pos: idx };
    }
    if (best) {
      mapping[sp] = best.name;
      used.add(best.name);
    }
  }

  // 2) 位置式 fallback
  for (const sp of ordered) {
    if (mapping[sp]) continue;
    const next = members.find((mem) => !used.has(mem.name));
    if (next) {
      mapping[sp] = next.name;
      used.add(next.name);
    } else {
      ambiguous.push(sp);
    }
  }

  let result = transcript;
  for (const [sp, name] of Object.entries(mapping)) {
    result = result.replace(new RegExp(`\\[${escapeRegex(sp)}\\]`, 'gi'), `[${name}]`);
  }
  return { text: result, mapping, ambiguous };
}

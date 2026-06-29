// WAV 檔案切段：把 >24MB 的 LinearPCM WAV 拆成多個小段檔（給 OpenAI Whisper 25MB 上限用）
// 只適用 WAV（PCM 是 fixed-rate 可按 byte 切；AAC/m4a 是 frame-based 切會破）
// 串流版：用 FileHandle 視窗讀取，避免把整個長檔一次塞進記憶體（長會議會 OOM）。

import { Directory, File, Paths } from 'expo-file-system';

const TARGET_CHUNK_BYTES = 22 * 1024 * 1024; // 22MB 安全餘裕
const HEADER_SCAN_BYTES = 64 * 1024;          // 讀檔頭找 data chunk 的視窗（WAV header 很小）

export interface WavChunk {
  uri: string;
  bytes: number;
  durationSec: number;
  index: number;
  total: number;
}

/** 在 header 找 "data" 標籤位置（iOS 錄的 WAV header 不一定是標準 44 bytes，可能多 FLLR / fact chunks）。 */
function findDataChunk(bytes: Uint8Array): { dataStart: number; header: Uint8Array } {
  for (let i = 12; i < Math.min(bytes.length - 8, 2000); i++) {
    if (bytes[i] === 0x64 && bytes[i + 1] === 0x61 && bytes[i + 2] === 0x74 && bytes[i + 3] === 0x61) {
      const dataStart = i + 8;
      return { dataStart, header: bytes.slice(0, dataStart) };
    }
  }
  throw new Error('WAV header 找不到 "data" chunk');
}

/** 重寫 header 內的 RIFF size 與 data size，套到新切段的 dataLen。 */
function rewriteHeader(header: Uint8Array, chunkDataLen: number): Uint8Array {
  const out = new Uint8Array(header); // copy
  const view = new DataView(out.buffer);
  view.setUint32(4, out.length - 8 + chunkDataLen, true); // RIFF total size
  view.setUint32(out.length - 4, chunkDataLen, true);     // data chunk size
  return out;
}

/** 從 header 讀 byteRate (offset 28, uint32 LE)。 */
function readByteRate(header: Uint8Array): number {
  if (header.length < 32) return 0;
  return new DataView(header.buffer, header.byteOffset + 28, 4).getUint32(0, true);
}

function safeSize(uri: string): number {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

/**
 * 若檔案 ≤ maxBytes：回傳 [{uri 原檔, total: 1}]（不切）
 * 若 > maxBytes：串流拆成多個 .wav 寫到 cache，回傳 chunk 列表
 */
export async function splitWavIfNeeded(
  uri: string,
  maxBytes = 24 * 1024 * 1024,
  targetChunkBytes = TARGET_CHUNK_BYTES,
): Promise<WavChunk[]> {
  const totalSize = safeSize(uri);
  if (totalSize === 0 || totalSize <= maxBytes) {
    return [{ uri, bytes: totalSize, durationSec: 0, index: 0, total: 1 }];
  }

  const fh = new File(uri).open();
  try {
    // 只讀檔頭視窗找 data chunk 起點，不讀整檔
    fh.offset = 0;
    const headScan = fh.readBytes(Math.min(HEADER_SCAN_BYTES, totalSize));
    const { dataStart, header } = findDataChunk(headScan);
    const byteRate = readByteRate(header);
    const dataLen = totalSize - dataStart;

    const tmpDir = new Directory(Paths.cache, 'wav_chunks');
    if (!tmpDir.exists) tmpDir.create({ intermediates: true });

    // 對齊 16-bit mono = 2 bytes / sample；確保切點不切在 sample 中間
    const chunkBodyMax = Math.max(2, Math.floor((targetChunkBytes - header.length) / 2) * 2);
    const totalChunks = Math.ceil(dataLen / chunkBodyMax);
    const chunks: WavChunk[] = [];
    const ts = Date.now();

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkBodyMax;
      const bodyLen = Math.min(chunkBodyMax, dataLen - start);
      fh.offset = dataStart + start;
      const body = fh.readBytes(bodyLen);
      const newHeader = rewriteHeader(header, body.length);
      const out = new Uint8Array(newHeader.length + body.length);
      out.set(newHeader, 0);
      out.set(body, newHeader.length);

      const chunkFile = new File(tmpDir, `chunk_${ts}_${i}.wav`);
      chunkFile.write(out);
      chunks.push({
        uri: chunkFile.uri,
        bytes: out.length,
        durationSec: byteRate > 0 ? body.length / byteRate : 0,
        index: i,
        total: totalChunks,
      });
    }
    return chunks;
  } finally {
    fh.close();
  }
}

export function cleanupChunks(chunks: WavChunk[], originalUri: string) {
  for (const c of chunks) {
    if (c.uri === originalUri) continue;
    try {
      new File(c.uri).delete();
    } catch {
      // ignore
    }
  }
}

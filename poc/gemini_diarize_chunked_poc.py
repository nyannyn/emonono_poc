# CP1b PoC — Gemini 長會議「切段 → 逐段轉錄 → 拼接」可行性驗證
#
# CP1 已證單段 ~15 分鐘品質可接受（gemini-2.5-flash + thinking 關閉）。
# 本腳本驗證「完整長會議版」的最大剩餘風險：
#   1. 把整場 68 分鐘切成多段、逐段轉，能否「全程覆蓋」不漏內容（單次塞長檔會崩、丟內容）。
#   2. 每段都穩定 finish=STOP、不再崩成重複迴圈。
#   3. 免費層 rate limit（2.5-flash）跑 6 段連續請求扛不扛得住、要不要退避。
#   4. 重複迴圈/幻覺後處理是否能把殘留的「嗯。」loop 收掉。
#
# 跨段「Speaker N 對不上人」不在此驗證 —— app 端用既有 prependVoiceprints + autoMapSpeakers
# 以聲紋反推姓名解決（與 OpenAI diarize 同機制），這裡只驗轉錄覆蓋與穩定度。
#
# 執行：
#   "C:/Users/Ella/Downloads/gemini-speech-to-text-python-generator/venv/Scripts/python.exe" \
#       poc/gemini_diarize_chunked_poc.py [audio_path]

import math
import os
import re
import subprocess
import sys
import tempfile
import time

from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai.errors import ClientError

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

AUDIO_FILE = r"C:\Users\Ella\Downloads\gemini-speech-to-text-python-generator\Ai team討論.m4a"
MODEL = "gemini-2.5-flash"      # 免費層唯一可用且關 thinking 後堪用的
CHUNK_SEC = 720                 # 12 分鐘（CP1 驗過 15 分鐘 OK，留安全邊際）
OVERLAP_SEC = 10               # 段間重疊，避免切在句中漏字
MAX_OUTPUT_TOKENS = 32768
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

load_dotenv()
FALLBACK_ENV = r"C:\Users\Ella\Downloads\gemini-speech-to-text-python-generator\.env"
if not os.environ.get("GEMINI_API_KEY") and os.path.exists(FALLBACK_ENV):
    load_dotenv(FALLBACK_ENV)
API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    print("[錯誤] 找不到 GEMINI_API_KEY")
    sys.exit(1)

DIARIZE_PROMPT = """請把這段會議錄音整理成「帶講者標註的逐字稿」（speaker diarization）。

要求：
1. 全程使用繁體中文輸出。
2. 每當說話者改變就另起一段，段首標講者標籤，格式固定為「Speaker N:」（N 為阿拉伯數字，從 1 起算）。同一個人整段沿用同一個編號。
3. 講者標籤後、文字前，加上該段開始時間，格式 [MM:SS]。
4. 逐字照實轉錄（保留口語），但修正明顯的語音辨識錯誤並補上標點。
5. 技術名詞（NVMe、PCIe、SSD、firmware 等）保留英文。
6. 只輸出逐字稿本身，開頭不要任何前言或說明。
"""


def ffprobe_duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nk=1:nw=1", path],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    return float(r.stdout.strip())


def extract_chunk(src, start, dur, out):
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(start), "-t", str(dur), "-i", src,
         "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", out],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )


def collapse_repeats(text, max_keep=2, short_len=6):
    """把連續重複的短句（如每秒一句「嗯。」）收掉，只保留前 max_keep 句。"""
    out, prev, run = [], None, 0
    removed = 0
    for line in text.splitlines():
        body = re.sub(r"^\s*Speaker\s*\w+\s*:\s*(\[\d+:\d+\]\s*)?", "", line).strip()
        if body == prev and len(body) <= short_len:
            run += 1
            if run >= max_keep:
                removed += 1
                continue
        else:
            prev, run = body, 0
        out.append(line)
    return "\n".join(out), removed


def transcribe_chunk(client, chunk_path):
    cfg = types.GenerateContentConfig(
        max_output_tokens=MAX_OUTPUT_TOKENS,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )
    f = client.files.upload(file=chunk_path)
    while f.state.name == "PROCESSING":
        time.sleep(2)
        f = client.files.get(name=f.name)

    attempt = 0
    while True:
        attempt += 1
        try:
            t0 = time.time()
            resp = client.models.generate_content(
                model=MODEL, contents=[f, DIARIZE_PROMPT], config=cfg,
            )
            elapsed = time.time() - t0
            break
        except ClientError as e:
            if getattr(e, "code", None) == 429 and attempt <= 3:
                m = re.search(r"retry in ([\d.]+)s", str(e))
                wait = math.ceil(float(m.group(1))) + 2 if m else 60
                print(f"    [429] 免費層限流，等 {wait}s 後重試（第 {attempt} 次）…")
                time.sleep(wait)
                continue
            raise
    try:
        client.files.delete(name=f.name)
    except Exception:
        pass

    text = resp.text or ""
    cand = resp.candidates[0] if resp.candidates else None
    fr = getattr(cand, "finish_reason", None)
    um = getattr(resp, "usage_metadata", None)
    out_tok = getattr(um, "candidates_token_count", None) if um else None
    return text, str(fr), out_tok, elapsed


def speaker_count(text):
    return len(set(re.findall(r"(?im)^\s*Speaker\s*(\w+)\s*:", text)))


def main():
    audio = sys.argv[1] if len(sys.argv) > 1 else AUDIO_FILE
    if not os.path.exists(audio):
        print(f"[錯誤] 找不到音檔：{audio}")
        sys.exit(1)

    client = genai.Client(api_key=API_KEY)
    duration = ffprobe_duration(audio)
    stride = CHUNK_SEC - OVERLAP_SEC
    n = math.ceil(duration / stride)

    print("=" * 64)
    print("CP1b — Gemini 切段長會議轉錄可行性")
    print(f"音檔：{os.path.basename(audio)}  總長 {duration/60:.1f} 分鐘")
    print(f"切 {n} 段（每段 {CHUNK_SEC/60:.0f} 分、重疊 {OVERLAP_SEC}s）；模型 {MODEL}（thinking 關）")
    print("=" * 64)

    tmpdir = tempfile.mkdtemp(prefix="cp1b_")
    pieces = []
    total_t0 = time.time()
    ok = 0
    for i in range(n):
        start = i * stride
        dur = min(CHUNK_SEC, duration - start)
        if dur <= 0:
            break
        chunk_path = os.path.join(tmpdir, f"chunk_{i:02d}.mp3")
        extract_chunk(audio, start, dur, chunk_path)
        mm = f"{int(start//60):02d}:{int(start%60):02d}"
        print(f"[{i+1}/{n}] {mm} 起 {dur/60:.1f} 分 … ", end="", flush=True)
        try:
            text, fr, out_tok, elapsed = transcribe_chunk(client, chunk_path)
        except Exception as e:
            print(f"失敗：{e}")
            pieces.append(f"\n=== chunk {i+1} ({mm}) 失敗 ===\n")
            continue
        clean, removed = collapse_repeats(text)
        spk = speaker_count(clean)
        looped = removed > 20
        status = "OK" if (fr.endswith("STOP") and len(clean) > 50 and not looped) else "⚠"
        print(f"{status} finish={fr} out={out_tok} {elapsed:.0f}s 講者{spk}人 "
              f"{len(clean)}字 收掉重複{removed}行")
        if status == "OK":
            ok += 1
        pieces.append(f"\n=== chunk {i+1}  [{mm} +{dur/60:.0f}m] finish={fr} 講者{spk} ===\n{clean}")

    out_path = os.path.join(OUTPUT_DIR, "gemini_diarize_chunked_full.txt")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("".join(pieces))

    print("-" * 64)
    print(f"完成 {ok}/{n} 段 OK，總耗時 {(time.time()-total_t0)/60:.1f} 分鐘")
    print(f"拼接稿已存：{out_path}")
    print("（人工抽查：每段時間範圍是否都有真實內容、有無漏段或殘留迴圈）")


if __name__ == "__main__":
    main()

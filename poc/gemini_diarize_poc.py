# CP1 PoC — Gemini 原生 File API 分講者品質驗證
#
# 目的：拿一段多人 zh-TW 會議錄音，走 Gemini File API（上傳→輪詢→generate_content），
# 用 prompt 要求 speaker diarization，驗證：
#   1. 講者切分是否正確（同一個人整場是否同一編號、有沒有把一個人拆成兩個 / 把兩個人併一個）
#   2. 繁中逐字稿準度
#   3. 整場 30 分鐘一次處理的耗時與 token 用量
#
# 路線選擇：使用者已決定 app 走「原生 File API」（非 OpenAI 相容 inline），
# 故本 PoC 直接驗證 File API 路徑。輸出標籤用「Speaker N:」對齊 app 端
# src/llm/client.ts 的 formatTranscript（會正規化成 [speaker_N]）與 voiceprintMix 的 autoMapSpeakers。
#
# 執行（用已裝好 google-genai 的 venv）：
#   "C:/Users/Ella/Downloads/gemini-speech-to-text-python-generator/venv/Scripts/python.exe" \
#       poc/gemini_diarize_poc.py [model]
# model 預設 gemini-2.5-flash；可傳 gemini-2.0-flash 比較。

import os
import re
import subprocess
import sys
import tempfile
import time

from dotenv import load_dotenv
from google import genai
from google.genai import types

# Windows 主控台輸出繁中避免 UnicodeEncodeError
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# --- 設定 ---
AUDIO_FILE = r"C:\Users\Ella\Downloads\gemini-speech-to-text-python-generator\Ai team討論.m4a"
DEFAULT_MODEL = "gemini-2.5-flash"
FALLBACK_MODEL = "gemini-2.0-flash"  # 已知可用（batch_transcribe.py 證明過）
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

# Gemini key：先 env，再 poc/.env，最後退回 Downloads 既有 .env（已含 GEMINI_API_KEY）
load_dotenv()
FALLBACK_ENV = r"C:\Users\Ella\Downloads\gemini-speech-to-text-python-generator\.env"
if not os.environ.get("GEMINI_API_KEY") and os.path.exists(FALLBACK_ENV):
    load_dotenv(FALLBACK_ENV)

API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    print("[錯誤] 找不到 GEMINI_API_KEY（env / poc/.env / Downloads/.env 都沒有）")
    sys.exit(1)

DIARIZE_PROMPT = """請把這段會議錄音整理成「帶講者標註的逐字稿」（speaker diarization）。

要求：
1. 全程使用繁體中文輸出。
2. 每當說話者改變就另起一段，段首標講者標籤，格式固定為「Speaker N:」（N 為阿拉伯數字，從 1 起算）。同一個人整場必須沿用同一個編號。
3. 講者標籤後、文字前，加上該段開始時間，格式 [MM:SS]。
4. 逐字照實轉錄（保留口語），但修正明顯的語音辨識錯誤並補上標點。
5. 技術名詞（NVMe、PCIe、SSD、firmware 等）保留英文。
6. 只輸出逐字稿本身，開頭不要任何前言或說明。
"""


def prepare_audio(path):
    """轉成 Gemini 確定支援的格式 + 純 ASCII 檔名。
    必要性：(1) google-genai 會把檔名塞進 HTTP header，中文檔名讓 httpx 以 ascii 編碼失敗；
    (2) m4a 是 AAC-in-MP4，未必在 Gemini 支援清單。mono 16k mp3：語音辨識足夠、更小、上傳更快。"""
    tmp = os.path.join(tempfile.gettempdir(), "cp1_gemini_audio.mp3")
    print(f"轉檔（ffmpeg → mono 16k mp3）：{os.path.basename(path)}")
    cmd = ["ffmpeg", "-y", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", tmp]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg 轉檔失敗：{r.stderr[-500:]}")
    print(f"  轉檔完成（{os.path.getsize(tmp) / 1048576:.1f} MB）")
    return tmp


def upload_and_wait(client, path):
    print(f"上傳音檔到 Gemini File API：{os.path.basename(path)} "
          f"({os.path.getsize(path) / 1048576:.1f} MB)")
    t0 = time.time()
    f = client.files.upload(file=path)
    print(f"  已上傳：{f.name}，等待伺服器處理…")
    while f.state.name == "PROCESSING":
        time.sleep(3)
        f = client.files.get(name=f.name)
    if f.state.name == "FAILED":
        raise RuntimeError("File API 處理失敗")
    print(f"  檔案就緒（{time.time() - t0:.1f}s）")
    return f


def diarize(client, model, audio_file):
    print(f"產生分講者逐字稿（model={model}）…")
    # 2.5 系列是 thinking 模型：轉錄這種任務 thinking 反而吃掉輸出預算（曾整段回空）。
    # 關掉 thinking（budget=0）並給足 max_output_tokens，讓它純做轉錄。
    cfg = types.GenerateContentConfig(max_output_tokens=32768)
    if "2.5" in model:
        cfg.thinking_config = types.ThinkingConfig(thinking_budget=0)
    t0 = time.time()
    resp = client.models.generate_content(
        model=model,
        contents=[audio_file, DIARIZE_PROMPT],
        config=cfg,
    )
    elapsed = time.time() - t0
    return resp, elapsed


def speaker_stats(text):
    labels = re.findall(r"(?im)^\s*Speaker\s*(\w+)\s*:", text)
    distinct = sorted(set(labels), key=lambda x: (len(x), x))
    return len(labels), distinct


def main():
    # argv[1] = model（預設 gemini-2.5-flash）；argv[2] = 音檔路徑（預設整場 68 分鐘樣本）
    model = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MODEL
    audio_path = sys.argv[2] if len(sys.argv) > 2 else AUDIO_FILE
    client = genai.Client(api_key=API_KEY)

    if not os.path.exists(audio_path):
        print(f"[錯誤] 找不到音檔：{audio_path}")
        sys.exit(1)

    print("=" * 64)
    print("CP1 — Gemini File API 分講者品質驗證")
    print(f"音檔：{os.path.basename(audio_path)}")
    print("=" * 64)

    local_audio = prepare_audio(audio_path)
    audio_file = upload_and_wait(client, local_audio)

    try:
        resp, elapsed = diarize(client, model, audio_file)
    except Exception as e:
        # 主模型不可用 → 退回已知可用模型
        if model != FALLBACK_MODEL:
            print(f"[警告] {model} 失敗（{e}），改用 {FALLBACK_MODEL} 重試")
            model = FALLBACK_MODEL
            resp, elapsed = diarize(client, model, audio_file)
        else:
            raise
    finally:
        try:
            client.files.delete(name=audio_file.name)
        except Exception:
            pass
        if local_audio != AUDIO_FILE:
            try:
                os.remove(local_audio)
            except Exception:
                pass

    text = resp.text or ""
    turns, distinct = speaker_stats(text)
    um = getattr(resp, "usage_metadata", None)

    # 診斷：空回應 / 截斷原因
    try:
        cand = resp.candidates[0]
        fr = getattr(cand, "finish_reason", None)
        print(f"[診斷] finish_reason={fr} prompt_feedback={getattr(resp, 'prompt_feedback', None)}")
        if um is not None:
            print(f"[診斷] thoughts_token_count={getattr(um, 'thoughts_token_count', None)}")
    except Exception as e:
        print(f"[診斷] 取 finish_reason 失敗：{e}")

    safe_model = model.replace(".", "_").replace("/", "_")
    stem = re.sub(r"[^A-Za-z0-9]+", "_", os.path.splitext(os.path.basename(audio_path))[0])[:24]
    out_path = os.path.join(OUTPUT_DIR, f"gemini_diarize_{safe_model}_{stem}.txt")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(text)

    print("\n" + "-" * 64)
    print(f"模型：{model}")
    print(f"耗時：{elapsed:.1f}s")
    if um is not None:
        print(f"token：in={getattr(um, 'prompt_token_count', '?')} "
              f"out={getattr(um, 'candidates_token_count', '?')} "
              f"total={getattr(um, 'total_token_count', '?')}")
    print(f"講者轉換段數：{turns}；偵測到的講者編號：{distinct}（共 {len(distinct)} 位）")
    print(f"逐字稿長度：{len(text)} 字元，已存：{out_path}")
    print("-" * 64)
    print("【前 1800 字預覽】")
    print(text[:1800])
    print("…（完整內容見上方檔案）" if len(text) > 1800 else "")


if __name__ == "__main__":
    main()

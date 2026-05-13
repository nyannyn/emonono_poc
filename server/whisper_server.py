"""
Whisper STT server — OpenAI-compatible /v1/audio/transcriptions.
跑在 Ollama 同一台機器上，透過 ngrok 對外。

Setup:
    pip install faster-whisper fastapi uvicorn python-multipart

Run:
    python whisper_server.py
    # 或自訂環境變數
    WHISPER_MODEL=medium WHISPER_DEVICE=cpu python whisper_server.py

Expose:
    ngrok http 8001
    （把 https://xxxx.ngrok.io 設定到 App 的 Whisper URL 欄位）
"""

import os
import tempfile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

# ─── 設定（可由環境變數覆寫） ───────────────────────────────────
MODEL_NAME = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
DEVICE = os.environ.get("WHISPER_DEVICE", "cuda")  # "cuda" or "cpu"
COMPUTE_TYPE = os.environ.get(
    "WHISPER_COMPUTE_TYPE",
    "float16" if DEVICE == "cuda" else "int8",
)
PORT = int(os.environ.get("PORT", "8001"))

app = FastAPI(title="Whisper STT (OpenAI-compatible)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

print(f"[whisper] loading model={MODEL_NAME} device={DEVICE} compute_type={COMPUTE_TYPE}")
whisper = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE)
print("[whisper] model loaded.")


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "device": DEVICE}


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form("whisper-1"),  # 接受但不使用，與 OpenAI client 相容
    language: str | None = Form(None),
    response_format: str = Form("json"),
    prompt: str | None = Form(None),
    temperature: float = Form(0.0),
):
    """OpenAI Audio Transcriptions 相容；回傳 {text, segments}"""
    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        data = await file.read()
        if not data:
            raise HTTPException(400, "empty file")
        tmp.write(data)
        tmp_path = tmp.name

    try:
        segs, info = whisper.transcribe(
            tmp_path,
            language=language,
            initial_prompt=prompt,
            beam_size=5,
            temperature=temperature,
            vad_filter=True,
        )
        segments = [
            {"start": s.start, "end": s.end, "text": s.text}
            for s in segs
        ]
        full_text = "".join(s["text"] for s in segments)
        if response_format == "verbose_json":
            return {
                "task": "transcribe",
                "language": info.language,
                "duration": info.duration,
                "text": full_text,
                "segments": segments,
            }
        return {"text": full_text, "segments": segments}
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)

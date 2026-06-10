"""
OpenAI 代理（managed key 路線）
================================
公開版 app 預設不要使用者自己貼 OpenAI key，而是打這支自架 proxy；真正的 OpenAI
API key 只存在這台伺服器，app 端帶的是一個「app token」（可被反編譯取得，僅搭配
下方的速率限制當第一道門檻，不是強安全邊界）。

轉發三條 OpenAI 相容路徑，app 的 LLMClient 直接當成 OpenAI 端點用：
  POST /v1/audio/transcriptions   （multipart，STT）
  POST /v1/chat/completions       （JSON，會議記錄整理）
  GET  /v1/models                 （設定頁「測試連線」用）
  GET  /health                    （存活檢查）

啟動：
  pip install fastapi "uvicorn[standard]" httpx
  OPENAI_API_KEY=sk-...  APP_PROXY_TOKEN=<自訂一串長亂碼>  python openai_proxy.py

部署後把網址填進 EAS build 的 EXPO_PUBLIC_PROXY_URL，token 填 EXPO_PUBLIC_PROXY_TOKEN。
"""

import os
import time
from collections import defaultdict, deque

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
APP_PROXY_TOKEN = os.environ.get("APP_PROXY_TOKEN", "")
OPENAI_BASE = os.environ.get("OPENAI_BASE", "https://api.openai.com")
PORT = int(os.environ.get("PORT", "8080"))

# 粗略的每 IP 速率限制：滑動視窗，預設 60 秒內最多 20 次請求。
RATE_WINDOW_SEC = int(os.environ.get("RATE_WINDOW_SEC", "60"))
RATE_MAX = int(os.environ.get("RATE_MAX", "20"))
_hits: "defaultdict[str, deque]" = defaultdict(deque)

app = FastAPI(title="meeting-record OpenAI proxy")


def _check_auth(authorization: str | None) -> None:
    if not APP_PROXY_TOKEN:
        raise HTTPException(500, "伺服器未設定 APP_PROXY_TOKEN")
    expected = f"Bearer {APP_PROXY_TOKEN}"
    if authorization != expected:
        raise HTTPException(401, "app token 不正確")


def _check_rate(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    dq = _hits[ip]
    while dq and now - dq[0] > RATE_WINDOW_SEC:
        dq.popleft()
    if len(dq) >= RATE_MAX:
        raise HTTPException(429, "請求過於頻繁，請稍後再試")
    dq.append(now)


def _openai_headers(extra: dict | None = None) -> dict:
    h = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    if extra:
        h.update(extra)
    return h


@app.get("/health")
async def health():
    return {"ok": True, "has_key": bool(OPENAI_API_KEY)}


@app.get("/v1/models")
async def models(request: Request, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    _check_rate(request)
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{OPENAI_BASE}/v1/models", headers=_openai_headers())
    return JSONResponse(status_code=r.status_code, content=r.json())


@app.post("/v1/chat/completions")
async def chat(request: Request, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    _check_rate(request)
    body = await request.body()
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{OPENAI_BASE}/v1/chat/completions",
            headers=_openai_headers({"Content-Type": "application/json"}),
            content=body,
        )
    return Response(status_code=r.status_code, content=r.content,
                    media_type=r.headers.get("content-type", "application/json"))


@app.post("/v1/audio/transcriptions")
async def transcriptions(request: Request, authorization: str | None = Header(default=None)):
    _check_auth(authorization)
    _check_rate(request)
    # 原樣轉發 multipart body（含檔案）與 content-type boundary
    body = await request.body()
    headers = _openai_headers({"Content-Type": request.headers.get("content-type", "")})
    async with httpx.AsyncClient(timeout=300) as client:
        r = await client.post(
            f"{OPENAI_BASE}/v1/audio/transcriptions", headers=headers, content=body
        )
    return Response(status_code=r.status_code, content=r.content,
                    media_type=r.headers.get("content-type", "application/json"))


if __name__ == "__main__":
    if not OPENAI_API_KEY:
        raise SystemExit("請設環境變數 OPENAI_API_KEY")
    if not APP_PROXY_TOKEN:
        raise SystemExit("請設環境變數 APP_PROXY_TOKEN（app 端帶的 token）")
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)

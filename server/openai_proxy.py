"""
OpenAI 代理（managed key 路線）
================================
公開版 app 預設不要使用者自己貼 OpenAI key，而是打這支自架 proxy；真正的 OpenAI
API key 只存在這台伺服器，app 端帶的是一個「app token」（可被反編譯取得，僅搭配
下方的速率限制 + 模型白名單 + 每日配額當第一道門檻，不是強安全邊界）。

轉發三條 OpenAI 相容路徑，app 的 LLMClient 直接當成 OpenAI 端點用：
  POST /v1/audio/transcriptions   （multipart，STT）
  POST /v1/chat/completions       （JSON，會議記錄整理）
  GET  /v1/models                 （設定頁「測試連線」用）
  GET  /health                    （存活檢查）

防濫用三道閘（token 外洩時限縮損失）：
  1. 模型白名單：只放行 app 實際會用的模型，擋掉 o1 等昂貴模型。
  2. per-IP + per-token 速率限制：滑動視窗。
  3. per-token 每日配額：超過回 429，計數持久化到檔案，重啟不歸零。

啟動：
  pip install fastapi "uvicorn[standard]" httpx
  OPENAI_API_KEY=sk-...  APP_PROXY_TOKEN=<自訂一串長亂碼>  python openai_proxy.py

部署後把網址填進 EAS build 的 EXPO_PUBLIC_PROXY_URL，token 填 EXPO_PUBLIC_PROXY_TOKEN。
"""

import json
import os
import time
from collections import defaultdict, deque
from datetime import date

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
APP_PROXY_TOKEN = os.environ.get("APP_PROXY_TOKEN", "")
OPENAI_BASE = os.environ.get("OPENAI_BASE", "https://api.openai.com")
PORT = int(os.environ.get("PORT", "8080"))

# 模型白名單：只放行 app 真正會用到的模型，其餘一律 400（擋 o1 等高價模型）。
# 可用 ALLOWED_MODELS 環境變數覆寫（逗號分隔）。
_DEFAULT_ALLOWED = (
    "whisper-1,"
    "gpt-4o-transcribe,gpt-4o-transcribe-diarize,gpt-4o-mini-transcribe,"
    "gpt-realtime-whisper,"
    "gpt-4.1,gpt-4.1-mini"
)
ALLOWED_MODELS = {
    m.strip() for m in os.environ.get("ALLOWED_MODELS", _DEFAULT_ALLOWED).split(",") if m.strip()
}

# 速率限制：滑動視窗，per-IP 與 per-token 各一套。
RATE_WINDOW_SEC = int(os.environ.get("RATE_WINDOW_SEC", "60"))
RATE_MAX = int(os.environ.get("RATE_MAX", "20"))               # per-IP
TOKEN_RATE_MAX = int(os.environ.get("TOKEN_RATE_MAX", "40"))   # per-token（同視窗）
_hits_ip: "defaultdict[str, deque]" = defaultdict(deque)
_hits_token: "defaultdict[str, deque]" = defaultdict(deque)

# 每日配額：per-token 每日請求上限，超過回 429。計數持久化避免重啟歸零。
DAILY_QUOTA = int(os.environ.get("DAILY_QUOTA", "1000"))
QUOTA_FILE = os.environ.get("QUOTA_FILE", "/tmp/proxy_quota.json")
_quota: dict = {}  # {"YYYY-MM-DD": {token: count}}


def _load_quota() -> None:
    global _quota
    try:
        with open(QUOTA_FILE, "r", encoding="utf-8") as f:
            _quota = json.load(f)
    except Exception:
        _quota = {}


def _save_quota() -> None:
    try:
        with open(QUOTA_FILE, "w", encoding="utf-8") as f:
            json.dump(_quota, f)
    except Exception:
        pass  # 持久化失敗不影響服務（計數仍在記憶體）


_load_quota()

app = FastAPI(title="meeting-record OpenAI proxy")


def _check_auth(authorization: str | None) -> str:
    if not APP_PROXY_TOKEN:
        raise HTTPException(500, "伺服器未設定 APP_PROXY_TOKEN")
    expected = f"Bearer {APP_PROXY_TOKEN}"
    if authorization != expected:
        raise HTTPException(401, "app token 不正確")
    return APP_PROXY_TOKEN


def _check_rate(request: Request, token: str) -> None:
    now = time.time()
    ip = request.client.host if request.client else "unknown"
    for key, store, limit in (
        (ip, _hits_ip, RATE_MAX),
        (token, _hits_token, TOKEN_RATE_MAX),
    ):
        dq = store[key]
        while dq and now - dq[0] > RATE_WINDOW_SEC:
            dq.popleft()
        if len(dq) >= limit:
            raise HTTPException(429, "請求過於頻繁，請稍後再試")
        dq.append(now)


def _check_quota(token: str) -> None:
    today = date.today().isoformat()
    # 只保留今天，順手清掉舊日期避免無限長大
    if today not in _quota:
        _quota.clear()
        _quota[today] = {}
    used = _quota[today].get(token, 0)
    if used >= DAILY_QUOTA:
        raise HTTPException(429, f"已達今日用量上限（{DAILY_QUOTA} 次），請明天再試")
    _quota[today][token] = used + 1
    _save_quota()


def _check_model(model: str | None) -> None:
    if not model:
        raise HTTPException(400, "請求缺少 model 欄位")
    if model not in ALLOWED_MODELS:
        raise HTTPException(400, f"不支援的 model：{model}")


def _extract_multipart_field(body: bytes, field: str) -> str | None:
    """從 multipart body 粗略取出某個表單欄位值（用來在轉發前檢查 model）。"""
    marker = f'name="{field}"'.encode()
    idx = body.find(marker)
    if idx < 0:
        return None
    start = body.find(b"\r\n\r\n", idx)
    if start < 0:
        return None
    start += 4
    end = body.find(b"\r\n", start)
    if end < 0:
        end = len(body)
    return body[start:end].decode("utf-8", "ignore").strip()


def _openai_headers(extra: dict | None = None) -> dict:
    h = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    if extra:
        h.update(extra)
    return h


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/v1/models")
async def models(request: Request, authorization: str | None = Header(default=None)):
    token = _check_auth(authorization)
    _check_rate(request, token)
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{OPENAI_BASE}/v1/models", headers=_openai_headers())
    return JSONResponse(status_code=r.status_code, content=r.json())


@app.post("/v1/chat/completions")
async def chat(request: Request, authorization: str | None = Header(default=None)):
    token = _check_auth(authorization)
    _check_rate(request, token)
    body = await request.body()
    try:
        model = json.loads(body).get("model")
    except Exception:
        raise HTTPException(400, "請求 body 不是合法 JSON")
    _check_model(model)
    _check_quota(token)
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
    token = _check_auth(authorization)
    _check_rate(request, token)
    # 原樣轉發 multipart body（含檔案）與 content-type boundary
    body = await request.body()
    _check_model(_extract_multipart_field(body, "model"))
    _check_quota(token)
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

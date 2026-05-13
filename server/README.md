# Whisper STT Server

OpenAI-compatible `/v1/audio/transcriptions` 端點，跑在 Ollama 同一台機器上。

## 1. 安裝

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install faster-whisper fastapi uvicorn python-multipart
```

faster-whisper 第一次跑會自動下載模型到 `~/.cache/huggingface/hub/`。

## 2. 選 Model

| Model | 大小 | 速度 (RTX 3090) | 中英準度 |
|---|---|---|---|
| `tiny` | ~75 MB | 極快 | 低 |
| `base` | ~150 MB | 很快 | 一般 |
| `small` | ~500 MB | 快 | 中 |
| `medium` | ~1.5 GB | 中 | 好 |
| `large-v3` | ~3 GB | 慢 | 最好 |
| `large-v3-turbo` | ~1.5 GB | 中 | 接近 large-v3 |

**推薦：**
- 有 GPU (≥6 GB VRAM)：`large-v3-turbo` (預設)
- 只有 CPU：`medium` + int8

## 3. 啟動

```bash
# 預設：large-v3-turbo + cuda + float16
python whisper_server.py

# CPU 模式
WHISPER_MODEL=medium WHISPER_DEVICE=cpu python whisper_server.py

# 自訂 port
PORT=9000 python whisper_server.py
```

啟動後會印 `[whisper] model loaded.`，listen 在 `0.0.0.0:8001`。

## 4. 對外（ngrok）

**選項 A — 另一條 tunnel：**
```bash
ngrok http 8001
```
把 `https://xxxx.ngrok.io` 設到 App 的 `Whisper URL` 欄位。

**選項 B — Caddy 反向代理共用一條 ngrok：**
在 Caddyfile 加：
```caddy
:8443 {
    handle_path /v1/audio/* {
        reverse_proxy localhost:8001
    }
    handle /v1/chat/* {
        reverse_proxy localhost:11434
    }
}
```
然後 `ngrok http 8443`。App 兩個 URL 欄位填同一個。

## 5. 測試

```bash
curl -F "file=@test.wav" \
     -F "language=zh" \
     https://YOUR_NGROK_URL/v1/audio/transcriptions
```

回應：
```json
{
  "text": "...",
  "segments": [{"start": 0.0, "end": 3.2, "text": "..."}]
}
```

`/health` 端點可以拿來確認服務在線。

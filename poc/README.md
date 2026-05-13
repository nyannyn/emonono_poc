# POC — Whisper + GPT-4.1 會議記錄產生器

獨立 Python 腳本，用 OpenAI 雲端服務驗證「整段錄完 → Whisper 轉錄 → GPT 整理會議記錄」流程，主要用來：
1. 驗證 prompt 整理品質
2. 比對 OpenAI Whisper 與本地 faster-whisper 的中文準度
3. 之後 iOS app 要不要走這條路的判斷依據

## Setup

```bash
pip install openai python-dotenv
# ffmpeg 也要裝（音檔超過 24MB 會自動壓縮）
# Windows: scoop install ffmpeg  或  choco install ffmpeg
```

複製 `.env.example` 為 `.env` 並填入 `OPENAI_API_KEY`：
```
OPENAI_API_KEY=sk-...
```

## Run

修改腳本頂部的 `AUDIO_FILE` 指到你的 .m4a / .mp3 / .wav 路徑，然後：

```bash
python transcribe_and_summarize.py
```

產出：
- `Ai_team_transcript.txt` — 逐字稿
- `Ai_team_會議記錄.md` — Markdown 格式會議記錄（含摘要 / 行動項目 / 討論重點 / 待釐清）

## 成本參考（OpenAI 公定價，~2026）

- Whisper：US$0.006 / 分鐘音檔（30 分鐘會議 ≈ $0.18）
- GPT-4.1：~$2.50 / M input + $10 / M output token（一場 30 分鐘會議整理 < $0.10）

一場 30 分鐘會議端到端跑完約 US$0.30（≈ NT$10）。

## 與 iOS app 的關係

目前 `meeting-record/` 內的 iOS app 是接「本地 Ollama + 本地 Whisper」管線。確認此 POC 流程效果好，可以決定要不要把 iOS app 改成這個簡化版（OpenAI 雲端 + 整段錄完才送）。

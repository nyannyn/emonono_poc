# 會議記錄

iOS 會議轉譯 app — Expo (React Native) + OpenAI STT + 雙模式 LLM（OpenAI 雲端 或 自架 Ollama）。

## 結構

```
app/
├── _design/                  Claude Design handoff（HTML/JSX 設計檔，參考用）
├── poc/                      Python POC（驗證 prompt / API 流程）
├── server/                   範例 faster-whisper FastAPI（本專案實際 STT 走 OpenAI 雲端，不部署）
├── meeting-record/           Expo (React Native + TypeScript) app  ← 主要程式碼
└── README.md
```

## 功能

- **錄音 / 上傳** → OpenAI STT → 顯示逐字稿 → LLM 整理會議記錄 → SQLite 持久化 → 歷史列表
- **即時字幕（Live）**：dB 偵測句末停頓自動切段送 `gpt-4o-transcribe`
- **即時字幕（Realtime）**：WebSocket 連 `gpt-realtime-whisper` + server VAD
- **講者分離**：`gpt-4o-transcribe-diarize` 自動加 `[speaker_*]` 標籤
- **聲紋註冊與自動對應**：成員聲紋首句拼到會議錄音前，diarize 後自動把 speaker 替換成姓名
- **多 LLM 比對**：NotesView 用另一個 mode（OpenAI ↔ Ollama）並列產生
- **Token 即時顯示**：NotesView 每段 notes 上方 mono badge 顯示 model / in / out / total / elapsed
- **音檔播放與匯出**：NotesView 內建播放器 + expo-sharing 匯出 wav

## 開發環境

| | |
|---|---|
| 平台 | Windows（開發） + iPhone iOS 17+（測試） |
| App 框架 | Expo SDK 54 + React Native 0.81 + React 19（TypeScript 5.9） |
| 測試方式 | Expo Go（App Store 免費）— 掃 QR 即時跑，不需 Mac / Apple Dev |
| STT | OpenAI 雲端（`whisper-1` / `gpt-4o-transcribe` / `-diarize` / `gpt-realtime-whisper`） |
| LLM | OpenAI GPT-4.1（雲端） **或** 自架 Ollama via ngrok（OpenAI 相容，Basic auth） |
| 設計 | Variation C「masthead + 大圓角 + 紙感暖白」（見 `_design/`） |

## 起跑

```bash
cd meeting-record
npm install
npx expo start         # LAN 模式（建議，iPhone/PC 同 WiFi）
# 或：npx expo start --tunnel  ← 慢且 ngrok 偶爾 503
```

iPhone 開 Expo Go → 掃 QR → 首次進 Settings 填 OpenAI API Key（按「測試連線」驗證）。

切到本地 Ollama 模式：Settings → LLM 模式 = `local`、填 Ollama URL + 帳密（Basic auth，不要把帳密寫在 URL）。

## 主要檔案

```
meeting-record/src/
├── llm/client.ts                 transcribe() + generateMeetingNotes(){text,usage}
├── audio/
│   ├── wavChunker.ts             WAV >24MB 自動切段
│   └── voiceprintMix.ts          RIFF chunk walker + 聲紋拼接 + autoMapSpeakers
├── screens/
│   ├── HomeView                  masthead + 開始錄音 / 上傳 / 歷史 / 成員
│   ├── RecordingView             錄音 → 與會者選擇 → 聲紋拼接 → diarize → autoMap
│   ├── LiveRecordingView         即時字幕（dB silence-detect 切段）
│   ├── RealtimeRecordingView     即時字幕（WebSocket + server VAD + incremental compaction）
│   ├── NotesView                 LLM 整理 + token badge + 音檔播放 + 標題編輯 + 多 LLM 比對
│   ├── MeetingsView              歷史列表 + 搜尋 + 長按刪除
│   ├── MembersView               成員管理
│   ├── VoiceprintRegisterView    聲紋註冊（5 句流程）
│   ├── SpeakerMappingView        [speaker_*] → 姓名 手動 mapping
│   └── SettingsView              key / mode / 模型 / 測試連線 / 清除資料
├── storage/
│   ├── db.ts                     SQLite: meetings + members
│   └── settings.ts               expo-secure-store
└── components/SimpleMarkdown.tsx 自寫 markdown 渲染（識別 [speaker_*]）
```

## 幻覺防護（Live）

1. 模型升級 `whisper-1` → `gpt-4o-transcribe`（幻覺率約 -22%）
2. `temperature=0`
3. 段內有聲比例 < 25% → 不送
4. 檔案 < 60KB（< ~1.9 秒）→ 不送
5. `HALLUCINATION_PATTERNS` 過濾（Amara / YouTube credits / 廣東話新聞 sign-off）+ 重複迴圈偵測

## 已知限制

- Expo Go 不支援背景錄音 — 開會請保持前景、螢幕亮（有 expo-keep-awake）
- ngrok URL 會變 — Settings 隨時改
- 真正流式錄音（長會議不掉段）需 EAS dev build + `@mykin-ai/expo-audio-stream` 或 `react-native-blob-util.appendFile`
- Node 20.13.1 會跳 EBADENGINE 警告（建議升 20.19.4+）

## 未來

- EAS dev build → 背景錄音、CallKit、真正 streaming
- Phase 10：升級 Native Swift（正式上架）

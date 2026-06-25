# TestFlight 自動發佈設定

CI 管道已鋪好（`eas.json`、`.github/workflows/testflight.yml`）。
剩下這些**只有帳號擁有者能做**，CI 代勞不了。

## 待辦（依序）

### 1. 辦 Apple Developer Program（$99/年）
[developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/)
需要 Apple ID + 信用卡 + 身分驗證，通常 1–3 天審核。

### 2. 註冊 Bundle Identifier
Apple Developer 後台 → Certificates, Identifiers & Profiles → **Identifiers** → 新增：
- Type: App IDs
- Bundle ID: `com.ella.meetingrecord`

### 3. App Store Connect 建立 App
[appstoreconnect.apple.com](https://appstoreconnect.apple.com) → My Apps → 新增：
- Bundle ID 選 `com.ella.meetingrecord`
- App Name: Speech-to-Text：AI 語音轉錄
- 建立後記下頁面 URL 裡的數字 App ID（例如 `6745XXXXXX`），填入 `eas.json` 的 `ascAppId`

### 4. 產 App Store Connect API Key（Admin 角色）
App Store Connect → Users and Access → Integrations → **App Store Connect API** → Generate API Key
- 角色選 **Admin**
- 下載 `.p8`（**只有一次機會**）
- 記下：**Key ID**、**Issuer ID**、你的 **Team ID**（10 碼，Membership 頁面）

### 5. 申請 Expo 帳號並取得 EXPO_TOKEN
[expo.dev](https://expo.dev) → 免費註冊 → Account Settings → **Access Tokens** → Create

### 6. 設 GitHub Secrets
本 repo Settings → Secrets and variables → Actions → 新增：

| Secret | 內容 |
|---|---|
| `EXPO_TOKEN` | Expo Access Token |
| `ASC_KEY_ID` | API key 的 Key ID |
| `ASC_ISSUER_ID` | Issuer ID |
| `ASC_KEY_P8_BASE64` | `.p8` 檔案 base64：`cat AuthKey_XXXX.p8 \| base64 -w 0`（WSL/Mac Terminal）|
| `APPLE_TEAM_ID` | 10 碼 Team ID（例如 `ABCD1234EF`）|

### 7. 首次上傳 TestFlight
Actions → **TestFlight** → Run workflow → lane 選 `beta`。
EAS Build 在雲端 macOS runner 打包（約 15–25 分鐘），完成後自動上傳 App Store Connect。

到 App Store Connect → TestFlight → 邀請自己的 Apple ID 安裝。

---

## 開發版（dev build）測試裝置端轉譯

iOS 26 的裝置端轉譯走本地原生模組 `modules/expo-speech-analyzer`（Apple SpeechAnalyzer）。
**原生模組 Expo Go 跑不了**，要先做一次 dev build 灌進真機才測得到（之後改 JS 不必重 build，
連同一個 dev client 即可熱更新）。

前置：Apple Developer 核准後（步驟 1）+ Expo 帳號（步驟 5）。手機需 **iOS 26+** 才會走
SpeechAnalyzer；iOS 25↓ 會自動退回 expo-speech-recognition（SFSpeechRecognizer）。

```bash
cd meeting-record
npm install
npm i -g eas-cli          # 若還沒裝
eas login                 # 用 Expo 帳號
eas device:create         # 註冊你的 iPhone UDID（會給一個安裝描述檔的連結，手機開一次）
eas build --profile development --platform ios   # 雲端打包 dev client，約 15–25 分鐘
```

build 完成 → 用手機掃 EAS 給的 QR 安裝 dev client → 回到電腦：

```bash
npx expo start --dev-client    # 手機開剛裝的 app，連這個 dev server
```

驗證點（Live 即時字幕畫面）：
- Settings 的「即時字幕來源」選裝置端 → 開始錄 → 有即時字幕＝引擎通。
- iOS 26 機器上 `useDeviceLiveTranscription` 回的 `engine` 會是 `'analyzer'`（可暫時 log 出來確認）。
- 長講一段（>2 分鐘）不中斷、停頓後接話不漏字＝SpeechAnalyzer 長錄音正常。
- `timestamps` 陣列與 `lines` 等長且有秒數＝精準時間戳就緒（之後可做逐句跳播）。

> 注意：首次在某語系（zh-TW）辨識時，SpeechAnalyzer 可能需先下載語系模型
> （`AssetInventory`），第一句會慢一點，屬正常。

---

## 注意事項

| 項目 | 說明 |
|---|---|
| Bundle ID | `app.json`、Identifiers、eas.json `ascAppId` 三處需一致 |
| 隱私政策 | App Store 正式審核**必須**提供 URL，TestFlight 可先跳過 |
| OpenAI API Key | 見下方「轉錄服務 / API Key」——公開版預設走自架 proxy，使用者免自備 |
| EAS Build 費用 | 免費方案每月 30 build，足夠初期使用 |
| `--no-wait` | build 提交後 workflow 立即結束，不佔用 GitHub Actions 時間；實際 build 在 EAS 後台跑 |

---

## 轉錄服務 / API Key（兩條都給）

設定頁「轉錄服務」切換，由 build 是否設 `EXPO_PUBLIC_PROXY_URL` 決定是否出現：

- **內建（免設定，預設）**：app 打自架 proxy（`server/openai_proxy.py`），真正的 OpenAI
  key 只在伺服器，使用者免貼 key。
- **自己的 API Key**：進階使用者直連 OpenAI，用自己的帳號。

### 部署 proxy（你的步驟）
`server/` 已備好 `Dockerfile` + `fly.toml` + `requirements.txt`。Fly.io 三行上線：
```bash
cd server
fly launch --no-deploy
fly secrets set OPENAI_API_KEY=sk-... APP_PROXY_TOKEN=<自訂長亂碼>
fly deploy
```
部署後把網址與 token 設給 EAS build（**token 是密鑰，別寫進 commit 的檔案**）：
```bash
eas env:create --name EXPO_PUBLIC_PROXY_URL   --value https://你的proxy.fly.dev --environment production --environment preview
eas env:create --name EXPO_PUBLIC_PROXY_TOKEN --value <同一串長亂碼> --environment production --environment preview --type secret
```
⚠️ app token 可被反編譯取得，不是強安全邊界。proxy（`server/openai_proxy.py`）已內建三道閘：
模型白名單（只放行 app 用的模型）、per-IP + per-token 滑動視窗限流、per-token 每日配額。
可用環境變數調整：`ALLOWED_MODELS`、`RATE_MAX`、`TOKEN_RATE_MAX`、`DAILY_QUOTA`、`QUOTA_FILE`。
Fly.io 上 `QUOTA_FILE` 預設寫 `/tmp`，重啟會清；要跨重啟保留請掛 Fly volume 指到該路徑。

---

## App 隱私 / 資料揭露（送審必填）

App Store 正式審核會要求「App 隱私」表單與隱私政策 URL。本 app 的資料流：

| 項目 | 說明 |
|---|---|
| **隱私政策 URL** | **必填**（你本人上線一頁靜態頁即可）。需說明：錄音音訊會上傳 OpenAI 做轉譯與摘要；不販售個資。 |
| **音訊** | 雲端模式：音訊上傳 OpenAI（內建 proxy 或使用者自備 key）做 STT / 摘要。裝置端 Live 模式：音訊不離開手機。 |
| **逐字稿 / 會議記錄** | 僅存本機 SQLite（`meetings.db`），不上雲、不同步。 |
| **API key / 帳密** | 存 iOS Keychain（expo-secure-store），不離開裝置。 |
| **追蹤** | 無第三方分析、無廣告 SDK、不做跨 app 追蹤 → App Privacy 選「Data Not Collected」對應項。 |
| **required-reason API** | 已在 `app.json` 的 `ios.privacyManifests` 宣告：FileTimestamp(C617.1)、UserDefaults(CA92.1)、DiskSpace(E174.1)。 |

App Store Connect →「App 隱私」表單對應勾選：音訊歸在「使用者內容（Audio Data）」，
用途為「App 功能（轉錄）」，不連結身分、不追蹤。

---

## 公開版功能旗標

`EXPO_PUBLIC_BUILD=1`（已設在 `eas.json` production / preview）會隱藏開發期內部功能：
本地 Ollama LLM 切換、NotesView「比對」、Realtime 串流入口，送審只露 OpenAI 雲端路徑。
`expo start` 開發版不設此旗標 → 全功能照常。邏輯在 `src/config/features.ts`。

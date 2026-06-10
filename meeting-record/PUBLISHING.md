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
⚠️ app token 可被反編譯取得，不是強安全邊界；proxy 已內建每 IP 速率限制當第一道門檻，
正式營運建議再加用量上限 / 每裝置額度。

---

## 公開版功能旗標

`EXPO_PUBLIC_BUILD=1`（已設在 `eas.json` production / preview）會隱藏開發期內部功能：
本地 Ollama LLM 切換、NotesView「比對」、Realtime 串流入口，送審只露 OpenAI 雲端路徑。
`expo start` 開發版不設此旗標 → 全功能照常。邏輯在 `src/config/features.ts`。

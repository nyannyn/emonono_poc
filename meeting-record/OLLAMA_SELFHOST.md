# 本地 Ollama 自架 + ngrok（會議記錄整理免費路線）

把「逐字稿 → 會議記錄整理」這步改用你**公司內網 PC** 上的 Ollama 跑，免費、不付 OpenAI；手機經 ngrok 連回 PC。

## TL;DR（先驗證網路，再下載大模型）

1. 先**只**裝 Ollama + ngrok，開隧道。
2. 從**手機**打 `/v1/models`，回 JSON = 公司網路通了（**這關卡決定整個計畫成敗**）。此時還不用下載 4.7GB 模型。
3. 通了再 `ollama pull qwen2.5:7b-instruct`。
4. 手機設定：LLM 來源=本地 Ollama、URL=`https://<隨機>.ngrok-free.app/v1`（**要加 `/v1`**）、帳密留空、模型=`qwen2.5:7b-instruct`。

## 硬體現實（這台公司 PC）

- i9-14900K CPU 很快；RAM 31.7GB 但**常只剩 ~9GB 可用**；Intel UHD 770 內顯 2GB 對 LLM **無用** → 純 CPU 跑、實際上限約 7B。
- 模型選 **`qwen2.5:7b-instruct`**（4.7GB、繁中強，已查證為有效 tag）。RAM 吃緊或嫌慢 → 退 **`qwen2.5:3b-instruct`**（1.9GB）。20B 等級（gpt-oss）RAM 不夠，別用。

## 步驟

### 1. 裝 Ollama（Windows）
- 到 <https://ollama.com/download/windows> 下載 `OllamaSetup.exe` 安裝（或 `winget install Ollama.Ollama`）。
- 裝完它會以背景服務在 `127.0.0.1:11434` 聽。確認：瀏覽器開 `http://localhost:11434` 顯示 `Ollama is running`。

### 2. 裝 ngrok + authtoken
- 到 <https://ngrok.com> 註冊、下載 ngrok。
- `ngrok config add-authtoken <你的token>`。

### 3. 開隧道（這步先不用管模型）
```
ngrok http 11434 --host-header="localhost:11434"
```
- `--host-header` **必要**：Ollama 會擋 Host 不是 localhost 的請求（防 DNS rebinding），不改寫經 ngrok 會回 403。
- **不要**加 `--basic-auth`（依你的決定，免帳密）。安全靠「隨機網址 + 只在用時開隧道」，**別領固定網域**。
- 看 ngrok 視窗：
  - `Session Status: online` ← **關鍵**：agent 成功穿過公司網路出去了（公司若攔 TLS，這裡會卡住、拿不到網址）。
  - `Forwarding https://xxxx.ngrok-free.app -> http://localhost:11434` ← 記下這個 https 網址。

### 4. ⛳ 連線關卡（plan 成敗在此，先過這關再繼續）
從**手機**測（用手機**行動網路**、別連公司 WiFi，才接近實際使用情境）：
- 最準（有 curl 工具時）：
  ```
  curl https://xxxx.ngrok-free.app/v1/models
  ```
  預期回 JSON（即使還沒下載模型也會是 `{"object":"list","data":[...]}`）。**回到 JSON = 通了。**
- 沒 curl：手機瀏覽器開同一個 `/v1/models` 網址。看到 JSON 或 ngrok 警告頁（「You are about to visit…」）**都算通**（警告頁是 ngrok 邊緣回的，代表連得到）。只有「連線逾時 / 無法連線」才是**不通**。
- ❗**不通**（ngrok 視窗一直連不上、或手機完全打不到）→ 公司網路擋了 ngrok。**先停**，回報現象，改連線方案（手機熱點當 PC 出口 / VPN / Cloudflare Tunnel 等）。

### 5. 通了 → 下載並測模型
```
ollama pull qwen2.5:7b-instruct
ollama run qwen2.5:7b-instruct "用一句話介紹你自己"
```
- 跑得出中文回應即可。再 `curl .../v1/models` 應看到 `qwen2.5:7b-instruct` 出現在清單。

### 6. 手機 app 設定
設定 → 「LLM 來源（會議記錄整理）」= **本地 Ollama**：
- **Ollama URL**：`https://xxxx.ngrok-free.app/v1`（**務必加 `/v1`**）
- **使用者名稱 / 密碼**：留空
- **模型名**：`qwen2.5:7b-instruct`（要和你 `ollama pull` 的 tag **完全一致**）
- 儲存。

## 疑難排解
- `Network request failed`：URL 漏了 `/v1`、ngrok 沒開、或網址打錯。
- `403 Forbidden`：ngrok 少了 `--host-header="localhost:11434"`。
- `404 model not found`：app 的「模型名」和 `ollama pull` 的 tag 不一致。
- 很慢 / 逾時：7B 在 CPU 上偏慢；換 `qwen2.5:3b-instruct`，或縮短逐字稿。app chat 逾時上限 120 秒（`src/llm/client.ts` 的 `CHAT_TIMEOUT_MS`）。
- **ngrok 每次重開網址會變** → 要回設定頁重填 Ollama URL（免費版沒固定網域；這也是「安全靠隨機網址」的取捨）。

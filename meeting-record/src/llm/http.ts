// 帶逾時 / 可取消的 fetch 封裝。
// RN 的 fetch 沒有內建逾時，網路卡住會無限轉圈；用 AbortController 加上限。

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`請求逾時（超過 ${Math.round(ms / 1000)} 秒未回應）`);
    this.name = 'TimeoutError';
  }
}

/**
 * fetch + 逾時。可額外串接外部 AbortSignal（例如 UI 的「取消」鈕）。
 * 逾時會丟 TimeoutError；外部取消則丟原生 AbortError。
 */
export async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  ms = 120000,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, ms);

  const onExternalAbort = () => ctrl.abort();
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort();
    else externalSignal.addEventListener('abort', onExternalAbort);
  }

  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e: any) {
    if (timedOut) throw new TimeoutError(ms);
    throw e;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

/** 安全解析 JSON：先讀文字再 parse，避免 proxy/ngrok 回非 JSON 時丟看不懂的錯。 */
export async function parseJsonSafe(res: Response, label = '回應'): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
    throw new Error(`${label}不是合法 JSON（可能是 proxy / ngrok 錯誤頁）：${snippet || '（空回應）'}`);
  }
}

// 診斷用：HTTP 非 2xx 時，把「哪個模式、打了哪個網址、用哪個模型、狀態碼意義」都帶進錯誤訊息，
// 而不是只丟裸 `LLM 404`。URL 只取 origin+pathname（去掉 query），避免外洩 ?key= 之類的祕密。
export interface HttpErrCtx {
  label: string; // 'LLM'、'STT'…（識別是哪段請求）
  url: string;
  model?: string;
  mode?: string; // 'openai' | 'local'
  keySource?: string; // 'managed' | 'own'
}

export async function httpError(res: Response, ctx: HttpErrCtx): Promise<Error> {
  const body = (await res.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ').trim();
  let where = ctx.url.split('?')[0];
  try {
    const u = new URL(ctx.url);
    where = u.origin + u.pathname;
  } catch {
    /* 非合法 URL（例如空 base）→ 用去掉 query 的原字串 */
  }
  const head = [
    `${ctx.label} ${res.status}`,
    ctx.mode ? `模式=${ctx.mode}${ctx.keySource ? '/' + ctx.keySource : ''}` : '',
    `端點=${where}`,
    ctx.model ? `模型=${ctx.model}` : '',
  ]
    .filter(Boolean)
    .join('，');
  const hint = httpHint(res.status, where);
  const tail = body ? `；伺服器回應：${body}` : '；伺服器無回應內容';
  return new Error(`${head}${hint ? '。' + hint : ''}${tail}`);
}

function httpHint(status: number, where: string): string {
  if (status === 404) {
    if (/generativelanguage\.googleapis\.com/i.test(where) && !/\/v1beta\/openai(\/|$)/.test(where))
      return 'Gemini 端點網址要設到 …/v1beta/openai（App 會自動補 /chat/completions），目前路徑不對';
    return '404＝端點路徑或模型名稱設錯（或這把 key 沒有該模型權限）';
  }
  if (status === 401 || status === 403) return '授權失敗：檢查 API Key 是否正確、有無權限';
  if (status === 429) return '額度／頻率限制（免費層配額可能用盡）';
  return '';
}

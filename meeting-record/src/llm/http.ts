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

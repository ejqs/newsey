import { UA, FETCH_TIMEOUT_MS, CRAWL } from "./config.js";

export async function httpGet(url, { timeoutMs = FETCH_TIMEOUT_MS, maxBytes = CRAWL.maxBodyBytes } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml,application/rss+xml,text/xml,text/plain;q=0.4,*/*;q=0.2",
      },
      redirect: "follow",
      credentials: "omit",
    });
    const len = Number(res.headers.get("content-length") || 0);
    if (len && len > maxBytes) {
      return {
        status: res.status,
        headers: res.headers,
        text: "",
        finalUrl: res.url,
        contentType: res.headers.get("content-type") || "",
        xRobotsTag: res.headers.get("x-robots-tag") || "",
        skipped: "too_large",
      };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const sliced = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(sliced);
    return {
      status: res.status,
      headers: res.headers,
      text,
      finalUrl: res.url,
      contentType: res.headers.get("content-type") || "",
      xRobotsTag: res.headers.get("x-robots-tag") || "",
    };
  } finally {
    clearTimeout(timer);
  }
}

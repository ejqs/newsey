const ASSET_EXT =
  /\.(?:css|js|mjs|map|png|jpe?g|gif|webp|svg|ico|bmp|tif|tiff|woff2?|ttf|eot|mp3|mp4|m4a|mov|avi|mkv|zip|gz|tgz|tar|rar|7z|exe|dmg|apk|pdf|doc|docx|xls|xlsx|ppt|pptx)$/i;

const LOGIN_RE =
  /\/(?:log-?in|sign-?in|sign-?up|register|subscribe|checkout|wp-login|account\/login|auth\/)(?:\/|$)/i;

const PERSONAL_PATH_RE = /\/(?:user|users|u|profile|people|member|members|account|settings|me)\b/i;

const PERSONAL_HOSTS = new Set([
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "reddit.com",
  "pinterest.com",
  "snapchat.com",
  "whatsapp.com",
  "messenger.com",
  "threads.net",
  "tumblr.com",
  "mastodon.social",
  "bsky.app",
  "youtube.com",
  "youtu.be",
]);

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_|igshid|spm|ref|ref_src)/i;

const ARTICLE_PATH_RE =
  /\/(?:news|world|article|articles|story|stories|politics|business|economy|science|health|climate|tech|technology|opinion|analysis|uk-news|us-news|international)\b/i;
const DATE_PATH_RE = /\/(?:19|20)\d{2}\/\d{1,2}\/\d{1,2}\//;
const INDEX_PATH_RE = /\/(?:tag|tags|topic|topics|category|categories|author|authors|search|live|video|videos|gallery)(?:\/|$)/i;

export function stripWww(host) {
  return String(host || "")
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

export function hostOf(url) {
  try {
    return stripWww(new URL(url).hostname);
  } catch {
    return "";
  }
}

function isPrivateHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }
  if (h === "::1" || h === "0.0.0.0") return true;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function isPersonalHost(host) {
  const h = stripWww(host);
  if (PERSONAL_HOSTS.has(h)) return true;
  for (const p of PERSONAL_HOSTS) {
    if (h.endsWith(`.${p}`)) return true;
  }
  return false;
}

export function canonicalize(url, base) {
  let u;
  try {
    u = base ? new URL(url, base) : new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
  params.sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of params) u.searchParams.append(k, v);
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.toString();
}

export function classifyUrl(url) {
  const canon = canonicalize(url);
  if (!canon) return { ok: false, reason: "invalid", url: null };
  let u;
  try {
    u = new URL(canon);
  } catch {
    return { ok: false, reason: "invalid", url: null };
  }
  if (u.username || u.password) return { ok: false, reason: "credentials", url: canon };
  if (isPrivateHost(u.hostname)) return { ok: false, reason: "private", url: canon };
  if (isPersonalHost(u.hostname)) return { ok: false, reason: "personal", url: canon };
  if (ASSET_EXT.test(u.pathname)) return { ok: false, reason: "asset", url: canon };
  if (LOGIN_RE.test(u.pathname)) return { ok: false, reason: "login", url: canon };
  if (PERSONAL_PATH_RE.test(u.pathname) && /\/(?:in|user|users|profile)\b/i.test(u.pathname)) {
    return { ok: false, reason: "personal", url: canon };
  }
  const path = u.pathname || "/";
  const isHome = path === "/" || path === "";
  const looksIndex = INDEX_PATH_RE.test(path) || isHome;
  const segs = path.split("/").filter(Boolean);
  const last = segs[segs.length - 1] || "";
  const longSlug = last.length >= 20 || (last.match(/-/g) || []).length >= 3;
  const looksArticle =
    !looksIndex &&
    (DATE_PATH_RE.test(path) ||
      /-\d{5,}(?:\/|$)/.test(path) ||
      (ARTICLE_PATH_RE.test(path) && longSlug) ||
      (segs.length >= 3 && longSlug));
  return {
    ok: true,
    reason: looksArticle ? "article_candidate" : looksIndex ? "index" : "page",
    url: canon,
    host: stripWww(u.hostname),
    path,
  };
}

export function isSitemapUrl(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return p.includes("sitemap") && (p.endsWith(".xml") || p.endsWith(".xml.gz") || p.includes("sitemap"));
  } catch {
    return false;
  }
}

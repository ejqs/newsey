const truthy = (v) => ["1", "true", "yes", "on"].includes(String(v || "").trim().toLowerCase());
const intEnv = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const CONTACT = process.env.CRAWL_CONTACT || "https://github.com/ejqs/newsey/issues";
export const UA = `RoseBot/0.2 (+https://github.com/ejqs/newsey; +${CONTACT})`;
export const PRODUCT_TOKEN = "rosebot";

export const FETCH_TIMEOUT_MS = intEnv("FETCH_TIMEOUT_MS", 20_000);
export const RSS_FLOOR_DELAY_MS = intEnv("FLOOR_DELAY_MS", 2000);
export const ROBOTS_TTL_HOURS = intEnv("ROBOTS_TTL_HOURS", 24);

export const CRAWL = {
  enabledEnv: truthy(process.env.CRAWL_ENABLED),
  floorDelayMs: intEnv("CRAWL_FLOOR_DELAY_MS", 5000),
  maxFetchesPerTick: intEnv("CRAWL_MAX_FETCHES_PER_TICK", 2),
  maxNonNewsFetchesPerTick: intEnv("CRAWL_MAX_NON_NEWS_FETCHES_PER_TICK", 0),
  maxUrlsPerHostPerTick: intEnv("CRAWL_MAX_URLS_PER_HOST_PER_TICK", 1),
  maxDepth: intEnv("CRAWL_MAX_DEPTH", 2),
  maxEnqueuePerPage: intEnv("CRAWL_MAX_ENQUEUE_PER_PAGE", 25),
  maxFrontier: intEnv("CRAWL_MAX_FRONTIER", 5000),
  maxSitemapUrls: intEnv("CRAWL_MAX_SITEMAP_URLS", 50),
  maxBodyBytes: intEnv("CRAWL_MAX_BODY_BYTES", 1_500_000),
  hostBackoffHours: intEnv("CRAWL_HOST_BACKOFF_HOURS", 6),
  extraSeeds: (process.env.CRAWL_SEEDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  extraNewsDomains: (process.env.CRAWL_NEWS_DOMAINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^www\./, ""))
    .filter(Boolean),
};

export function isTruthy(v) {
  return truthy(v);
}

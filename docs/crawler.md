# Ethical news crawler

**Updated:** 2026-09-21

Rose-bot can recursively **discover public URLs** and **scrape article text only from credible news hosts**. Discovery is broad; scraping is not. The crawler is **off by default**.

RSS ingest (`docs/hosting.md`) is unchanged and stays on. This crawler is an extra tick.

## Start / stop

The worker is `node server.js` (same process as RSS). Each tick (default 15 minutes) runs RSS, then crawl if enabled.

| How | Effect |
| --- | --- |
| **Default** | Off. `bot_settings.crawl_enabled=0` is written on first boot unless `CRAWL_ENABLED=1`. |
| **Turn on (env, first boot)** | Set `CRAWL_ENABLED=1` before the process starts (Railway variable, or local `.env`). Only used when the DB row is missing. |
| **Turn on (live)** | `POST /crawl` with `{"enabled": true}` and `ROSE_SERVICE_TOKEN` or a hashed admin API key (`bot:command`). Takes effect on the next tick; no restart. |
| **Turn off** | `POST /crawl` with `{"enabled": false}` (same token). Or set `crawl_enabled` to `0` in `bot_settings`. |
| **One-shot (operator)** | `npm run crawl-once` — one crawl tick even if disabled. Does **not** persist enabled. Still needs `DATABASE_URL`. |
| **Status** | `GET /crawl` and `GET /health` (`crawlEnabled`, `lastCrawlTick`). |

```bash
# live toggle (token required)
curl -sS -X POST "$BOT_URL/crawl" \
  -H "Authorization: Bearer $ROSE_SERVICE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"enabled": true}'

curl -sS "$BOT_URL/crawl"
```

Stop the whole bot as usual (Railway stop / `SIGTERM`). That also stops RSS.

## What it writes

Reuses the existing content model:

| Table | Role |
| --- | --- |
| `crawl_frontier` | Every gathered URL + status (`queued`, `recorded`, `scraped`, `skipped_robots`, …) |
| `host_robots` | Cached `robots.txt` per host (TTL 24h) |
| `bot_settings` | `crawl_enabled` |
| `articles` | Successfully scraped news text (same rows the public site lists) |
| `url_ledger` | Same “never fetch twice” ledger as RSS |
| `news_sources` | Matched by host; auto-inserted with `scrape_method=crawl` when an allowlisted publisher is not already registered |

Paused or `robots_disallow` sources: that host is not fetched.

## Credibility (conservative)

A URL is scraped **only if all of these hold**:

1. **Host allowlist** — built-in English newsrooms (`lib/credibility.js`), **or** a host already on `news_sources`, **or** `CRAWL_NEWS_DOMAINS` (comma-separated).
2. **Article signal** — `NewsArticle` / `og:type=article`, or a conservative article-like path (date path / long slug). Homepages and section indexes are crawled for links, not stored as articles.
3. **Ethics checks passed** (below).

Publisher JSON-LD on a random domain is **not** enough. Random pages are recorded in the frontier (`recorded`) and not fetched unless you raise the non-news budget.

Lookalike hosts (`bbc.com.evil.example`, `notbbc.co.uk`) do not match.

## Seeds and recursion

Each tick enqueues:

- `news_sources.base_url` for sources that are not paused / robots-blocked
- `CRAWL_SEEDS` (comma-separated absolute URLs)
- Up to five `Sitemap:` URLs from that host’s `robots.txt` (allowlisted hosts only)

From each fetched page, links are extracted (skipping `rel=nofollow` and page-level `nofollow`). Allowlisted links are `queued`. Other public links are `recorded` (gathered, not fetched) unless `CRAWL_MAX_NON_NEWS_FETCHES_PER_TICK > 0`.

Default depth is **2**. Default non-news fetches per tick is **0** (stay on news hosts). Raise that only if you intentionally want a few discovery hops off-site.

## Rate limits (safe defaults)

| Knob | Default | Meaning |
| --- | --- | --- |
| `CRAWL_ENABLED` | unset / false | Off |
| `CRAWL_MAX_FETCHES_PER_TICK` | `2` | Page fetches per 15-minute tick |
| `CRAWL_MAX_URLS_PER_HOST_PER_TICK` | `1` | At most one URL per host per tick |
| `CRAWL_FLOOR_DELAY_MS` | `5000` | Minimum gap between requests to the same host |
| `CRAWL_MAX_DEPTH` | `2` | Link hops from a seed |
| `CRAWL_MAX_NON_NEWS_FETCHES_PER_TICK` | `0` | Off-allowlist discovery fetches |
| `CRAWL_MAX_ENQUEUE_PER_PAGE` | `25` | New URLs kept from one page |
| `CRAWL_MAX_FRONTIER` | `5000` | Cap on gathered URLs |
| `CRAWL_MAX_SITEMAP_URLS` | `50` | `<loc>` entries per sitemap file |
| `CRAWL_HOST_BACKOFF_HOURS` | `6` | Backoff after 401/403/429 or fetch errors |
| `CRAWL_SEEDS` | empty | Extra seed URLs |
| `CRAWL_NEWS_DOMAINS` | empty | Extra allowlisted hosts |
| `CRAWL_CONTACT` | GitHub issues URL | Added to User-Agent |

Robots `Crawl-delay` and `Request-rate` increase the per-host gap (never below the floor).

## Ethics (always on — not configurable)

Identifies as:

`RoseBot/0.2 (+https://github.com/ejqs/newsey; +https://github.com/ejqs/newsey/issues)`

| Rule | Behavior |
| --- | --- |
| **robots.txt** | Fetched per host, cached 24h. Disallow / longest-match Allow / wildcards / `$` honored. Specific `User-agent: RoseBot` beats `*`. |
| **Crawl-delay / Request-rate** | Honored; floor 5s. |
| **Unreadable robots.txt** | 5xx or network error → **do not crawl that host** until TTL. 401/403 on robots.txt → treat as full disallow. 404 → no file, allow with floor delay. |
| **noindex / noarchive / none** | Meta robots and `X-Robots-Tag`. Body is not stored (`noarchive` is treated as do-not-retain). |
| **nofollow** | Page-level or `rel=nofollow` links are not followed. |
| **No login / paywall circumvention** | 401/403 skip + host backoff. Login/subscribe URL shapes skipped. `isAccessibleForFree: false` and obvious paywall markup skipped. No cookies, no credentials, no archive proxies. |
| **No personal / private** | Social hosts, `/user` `/profile` paths, localhost, RFC1918, credentialed URLs, non-http(s). |
| **No hammering** | 1 URL/host/tick, 2 fetches/tick, 5s+ delay, 6h backoff on 429/401/403. |
| **Public HTML only** | Skip assets, oversized bodies, non-HTML types (except sitemaps/feeds used for discovery). |

There is no switch to ignore robots.txt.

## Run locally

```bash
# crawler stays off unless you enable it
CRAWL_ENABLED=1 DATABASE_URL=postgres://… npm start

# or one tick without leaving it on
DATABASE_URL=postgres://… npm run crawl-once
```

`npm test` covers robots parsing, allowlisting, URL skips, and scrape policy (no live network).

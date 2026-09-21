import http from "node:http";
import crypto from "node:crypto";
import { openDb } from "./db.js";
import { jevGlobeTick, listGlobeCountries } from "./jev-globe.js";
import {
  bearerFromRequest,
  hashToken,
  hashesEqual,
  hasScope,
  parseToken,
  SCOPE_COMMAND,
  SCOPE_READ,
} from "./api-keys.js";
import { crawlEnabled, crawlStats, crawlTick, ensureCrawlSetting, setSetting } from "./crawler.js";
import { RSS_FLOOR_DELAY_MS, ROBOTS_TTL_HOURS } from "./lib/config.js";
import { htmlToText, parseFeed } from "./lib/html.js";
import { httpGet } from "./lib/http.js";
import { parseRobots, robotsAllows } from "./lib/robots.js";

const PORT = Number(process.env.PORT) || 43123;
const TICK_MS = Number(process.env.TICK_MS) || 15 * 60 * 1000;
const MAX_SOURCES = Number(process.env.MAX_SOURCES_PER_TICK) || 1;
const MAX_FETCHES = Number(process.env.MAX_FETCHES_PER_TICK) || 3;
const SOURCE_GAP_HOURS = Number(process.env.SOURCE_GAP_HOURS) || 6;
const FLOOR_DELAY_MS = RSS_FLOOR_DELAY_MS;
const ONCE = process.argv.includes("--once");
const CRAWL_ONCE = process.argv.includes("--crawl-once");

const SEEDS = [
  {
    name: "BBC World",
    base_url: "https://www.bbc.com",
    feed_url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    priority: 100,
  },
  {
    name: "NPR News",
    base_url: "https://www.npr.org",
    feed_url: "https://feeds.npr.org/1001/rss.xml",
    priority: 90,
  },
  {
    name: "The Guardian World",
    base_url: "https://www.theguardian.com",
    feed_url: "https://www.theguardian.com/world/rss",
    priority: 80,
  },
  {
    name: "Al Jazeera English",
    base_url: "https://www.aljazeera.com",
    feed_url: "https://www.aljazeera.com/xml/rss/all.xml",
    priority: 70,
  },
];

const nowIso = () => new Date().toISOString();
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
const countN = (row) => Number(row?.n ?? 0);

let db;

async function seedSources() {
  const n = countN(await db.get("SELECT COUNT(*) AS n FROM news_sources"));
  if (n > 0) return;
  const t = nowIso();
  for (const s of SEEDS) {
    await db.run(
      `INSERT INTO news_sources (
        name, base_url, feed_url, scrape_method, status, priority,
        next_eligible_at, articles_scraped_count, created_at, updated_at
      ) VALUES (?, ?, ?, 'rss', 'unknown', ?, ?, 0, ?, ?)`,
      s.name,
      s.base_url,
      s.feed_url,
      s.priority,
      t,
      t,
      t,
    );
  }
}

function robotsGroups(body) {
  return parseRobots(body).groups;
}

async function refreshRobots(source) {
  const ttl = source.robots_ttl_until ? Date.parse(source.robots_ttl_until) : 0;
  if (source.robots_body && ttl > Date.now()) return source;
  const origin = new URL(source.base_url).origin;
  try {
    const res = await httpGet(`${origin}/robots.txt`);
    const t = nowIso();
    const ttlUntil = new Date(Date.now() + ROBOTS_TTL_HOURS * 3600_000).toISOString();
    if (res.status === 401 || res.status === 403) {
      const deny = "User-agent: *\nDisallow: /\n";
      await db.run(
        `UPDATE news_sources SET robots_checked_at=?, robots_ttl_until=?, robots_body=?, status=?, last_error=?, updated_at=? WHERE id=?`,
        t,
        ttlUntil,
        deny,
        "robots_disallow",
        `robots HTTP ${res.status}`,
        t,
        source.id,
      );
      return { ...source, robots_body: deny, robots_ttl_until: ttlUntil, status: "robots_disallow" };
    }
    if (res.status >= 500) {
      return { ...source, robots_unavailable: true, last_error: `robots HTTP ${res.status}` };
    }
    if (res.status >= 400) {
      await db.run(
        `UPDATE news_sources SET robots_checked_at=?, robots_ttl_until=?, robots_body=?, updated_at=? WHERE id=?`,
        t,
        ttlUntil,
        "",
        t,
        source.id,
      );
      return { ...source, robots_body: "", robots_ttl_until: ttlUntil };
    }
    const groups = robotsGroups(res.text);
    const delay = groups.find((g) => g.crawlDelay != null)?.crawlDelay ?? null;
    await db.run(
      `UPDATE news_sources SET robots_checked_at=?, robots_ttl_until=?, robots_body=?, crawl_delay_seconds=?, updated_at=? WHERE id=?`,
      t,
      ttlUntil,
      res.text,
      delay,
      t,
      source.id,
    );
    return { ...source, robots_body: res.text, robots_ttl_until: ttlUntil, crawl_delay_seconds: delay };
  } catch (err) {
    const t = nowIso();
    await db.run(
      `UPDATE news_sources SET last_error=?, updated_at=? WHERE id=?`,
      `robots: ${err.message}`.slice(0, 400),
      t,
      source.id,
    );
    return { ...source, robots_unavailable: true, last_error: `robots: ${err.message}`.slice(0, 400) };
  }
}

function pathAllowed(source, url) {
  if (!source.robots_body) return { allowed: true, crawlDelay: source.crawl_delay_seconds };
  try {
    const u = new URL(url);
    return robotsAllows(parseRobots(source.robots_body), u.pathname + u.search);
  } catch {
    return { allowed: false, crawlDelay: null };
  }
}

async function rememberUrl(sourceId, url, outcome, note) {
  const t = nowIso();
  const row = await db.get("SELECT url FROM url_ledger WHERE url = ?", url);
  if (row) {
    if (outcome === "seen") {
      await db.run(`UPDATE url_ledger SET last_seen_at=? WHERE url=?`, t, url);
    } else {
      await db.run(
        `UPDATE url_ledger SET last_seen_at=?, outcome=?, note=? WHERE url=?`,
        t,
        outcome,
        note ?? null,
        url,
      );
    }
    return false;
  }
  await db.run(
    `INSERT INTO url_ledger (url, source_id, first_seen_at, last_seen_at, outcome, note) VALUES (?,?,?,?,?,?)`,
    url,
    sourceId,
    t,
    t,
    outcome,
    note ?? null,
  );
  return true;
}

async function markSource(source, patch) {
  const t = nowIso();
  const fields = { ...patch, updated_at: t };
  const keys = Object.keys(fields);
  await db.run(
    `UPDATE news_sources SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`,
    ...keys.map((k) => fields[k]),
    source.id,
  );
}

async function pickSources() {
  const t = nowIso();
  return db.all(
    `SELECT * FROM news_sources
     WHERE status IN ('ok','unknown') AND next_eligible_at <= ?
     ORDER BY priority DESC, COALESCE(last_success_at, '1970-01-01') ASC
     LIMIT ?`,
    t,
    MAX_SOURCES,
  );
}

async function scrapeTick() {
  const started = nowIso();
  let fetched = 0;
  const sources = await pickSources();
  if (!sources.length) {
    console.log(`[tick ${started}] no eligible sources`);
    return { started, fetched: 0, sources: 0 };
  }
  for (const raw of sources) {
    let source = await refreshRobots(raw);
    const t = nowIso();
    await markSource(source, { last_attempt_at: t });
    if (source.robots_unavailable) {
      await markSource(source, {
        last_error: source.last_error || "robots unavailable",
        next_eligible_at: new Date(Date.now() + ROBOTS_TTL_HOURS * 3600_000).toISOString(),
      });
      continue;
    }
    const feedCheck = pathAllowed(source, source.feed_url);
    if (!feedCheck.allowed) {
      await markSource(source, {
        status: "robots_disallow",
        last_error: "robots.txt disallows feed",
        next_eligible_at: new Date(Date.now() + ROBOTS_TTL_HOURS * 3600_000).toISOString(),
      });
      continue;
    }
    const delayMs = Math.max(FLOOR_DELAY_MS, (source.crawl_delay_seconds || 0) * 1000);
    try {
      const feedRes = await httpGet(source.feed_url);
      if (feedRes.status === 401 || feedRes.status === 403 || feedRes.status === 429) {
        await markSource(source, {
          status: "blocked",
          last_error: `feed HTTP ${feedRes.status}`,
          next_eligible_at: new Date(Date.now() + SOURCE_GAP_HOURS * 2 * 3600_000).toISOString(),
        });
        continue;
      }
      if (feedRes.status >= 500) {
        await markSource(source, {
          status: "broken",
          last_error: `feed HTTP ${feedRes.status}`,
          next_eligible_at: new Date(Date.now() + SOURCE_GAP_HOURS * 3600_000).toISOString(),
        });
        continue;
      }
      const items = parseFeed(feedRes.text);
      let ok = 0;
      for (const item of items) {
        if (fetched >= MAX_FETCHES) break;
        const isNew = await rememberUrl(source.id, item.url, "seen", "rss");
        if (!isNew) continue;
        const allow = pathAllowed(source, item.url);
        if (!allow.allowed) {
          await rememberUrl(source.id, item.url, "robots_disallow", "article path");
          continue;
        }
        await sleep(delayMs);
        try {
          const page = await httpGet(item.url);
          if (page.status >= 400) {
            await rememberUrl(source.id, item.url, "fetch_error", `HTTP ${page.status}`);
            if (page.status === 401 || page.status === 403 || page.status === 429) {
              await markSource(source, {
                status: "blocked",
                last_error: `article HTTP ${page.status}`,
                next_eligible_at: new Date(Date.now() + SOURCE_GAP_HOURS * 2 * 3600_000).toISOString(),
              });
              break;
            }
            continue;
          }
          const body = htmlToText(page.text) || htmlToText(item.desc) || item.title;
          const hash = crypto.createHash("sha256").update(body).digest("hex");
          const ts = nowIso();
          await db.run(
            `INSERT OR IGNORE INTO articles (
              source_id, url, title, body_text, published_at, scraped_at, content_hash,
              lang, raw_metadata, jev_status, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            source.id,
            item.url,
            item.title.slice(0, 500),
            body.slice(0, 100_000),
            item.published,
            ts,
            hash,
            "en",
            JSON.stringify({ feed: source.feed_url }),
            "skipped",
            ts,
            ts,
          );
          await rememberUrl(source.id, item.url, "fetched", null);
          ok += 1;
          fetched += 1;
        } catch (err) {
          await rememberUrl(source.id, item.url, "fetch_error", err.message.slice(0, 200));
        }
      }
      const next = new Date(Date.now() + SOURCE_GAP_HOURS * 3600_000).toISOString();
      const count = countN(await db.get("SELECT COUNT(*) AS n FROM articles WHERE source_id = ?", source.id));
      await markSource(source, {
        status: "ok",
        last_success_at: nowIso(),
        last_error: null,
        next_eligible_at: next,
        articles_scraped_count: count,
      });
      console.log(`[tick] ${source.name}: +${ok} articles, next ${next}`);
    } catch (err) {
      await markSource(source, {
        status: "broken",
        last_error: err.message.slice(0, 400),
        next_eligible_at: new Date(Date.now() + SOURCE_GAP_HOURS * 3600_000).toISOString(),
      });
      console.error(`[tick] ${source.name} failed:`, err.message);
    }
  }
  return { started, fetched, sources: sources.length };
}

let lastTick = null;
let lastCrawlTick = null;
let ticking = false;

async function runTick({ rss = true, crawl = true } = {}) {
  if (ticking) return lastTick;
  ticking = true;
  try {
    if (rss) {
      const scrape = await scrapeTick();
      const jev = await jevGlobeTick(db);
      lastTick = { ...scrape, jev };
    }
    if (crawl) lastCrawlTick = await crawlTick(db, { force: CRAWL_ONCE });
  } finally {
    ticking = false;
  }
  return lastTick;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function publicKey(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
  };
}

async function authorizeApiKey(req, neededScope) {
  const given = bearerFromRequest(req);
  const parsed = parseToken(given);
  if (!parsed) return { error: "unauthorized", status: 401 };
  const row = await db.get("SELECT * FROM api_keys WHERE id = ?", parsed.id);
  if (!row || row.revoked_at) return { error: "unauthorized", status: 401 };
  if (!hashesEqual(row.secret_hash, hashToken(given))) {
    return { error: "unauthorized", status: 401 };
  }
  if (neededScope && !hasScope(row.scopes, neededScope)) {
    return { error: "forbidden", status: 403, key: row };
  }
  await db.run("UPDATE api_keys SET last_used_at=? WHERE id=?", nowIso(), row.id);
  return { key: row };
}

async function requireApiKey(req, res, neededScope) {
  const result = await authorizeApiKey(req, neededScope);
  if (result.error) {
    json(res, result.status, { ok: false, error: result.error });
    return null;
  }
  return result.key;
}

const SOURCE_STATUSES = new Set(["ok", "paused", "unknown"]);

function sourceWriteFields(body) {
  const patch = {};
  if (body.name != null) {
    const name = String(body.name).trim();
    if (!name) return { error: "name is required" };
    patch.name = name;
  }
  if (body.base_url != null) {
    const baseUrl = String(body.base_url).trim();
    if (!baseUrl) return { error: "base_url is required" };
    patch.base_url = baseUrl;
  }
  if (body.feed_url != null) {
    const feedUrl = String(body.feed_url).trim();
    if (!feedUrl) return { error: "feed_url is required" };
    patch.feed_url = feedUrl;
  }
  if (body.scrape_method != null) {
    patch.scrape_method = String(body.scrape_method).trim() || "rss";
  }
  if (body.priority != null) {
    const priority = Number(body.priority);
    if (!Number.isFinite(priority)) return { error: "priority must be a number" };
    patch.priority = priority;
  }
  if (body.status != null) {
    const status = String(body.status).trim();
    if (!SOURCE_STATUSES.has(status)) return { error: "status must be ok, paused, or unknown" };
    patch.status = status;
  }
  return { patch };
}

async function listSources() {
  return db.all("SELECT * FROM news_sources ORDER BY priority DESC");
}

async function handleV1(req, res, url) {
  const path = url.pathname;

  if (req.method === "GET" && path === "/v1/status") {
    const key = await requireApiKey(req, res, SCOPE_READ);
    if (!key) return;
    json(res, 200, {
      ok: true,
      service: "rose-bot",
      product: "rose",
      engine: "postgres",
      key: publicKey(key),
      lastTick,
      lastCrawlTick,
      crawlEnabled: await crawlEnabled(db),
      ticking,
      articles: countN(await db.get("SELECT COUNT(*) AS n FROM articles")),
      sources: countN(await db.get("SELECT COUNT(*) AS n FROM news_sources")),
      globe: countN(await db.get("SELECT COUNT(*) AS n FROM article_geo_sentiment WHERE eligible = 1")),
    });
    return;
  }

  if (req.method === "GET" && path === "/v1/sources") {
    const key = await requireApiKey(req, res, SCOPE_READ);
    if (!key) return;
    json(res, 200, { ok: true, sources: await listSources() });
    return;
  }

  if (req.method === "POST" && path === "/v1/tick") {
    const key = await requireApiKey(req, res, SCOPE_COMMAND);
    if (!key) return;
    try {
      await readJson(req);
    } catch {
      json(res, 400, { ok: false, error: "invalid_json" });
      return;
    }
    if (ticking) {
      json(res, 409, { ok: false, error: "tick_in_progress", lastTick });
      return;
    }
    const tick = await runTick();
    json(res, 200, { ok: true, action: "tick", tick, crawl: lastCrawlTick });
    return;
  }

  if (req.method === "POST" && path === "/v1/sources") {
    const key = await requireApiKey(req, res, SCOPE_COMMAND);
    if (!key) return;
    let body;
    try {
      body = await readJson(req);
    } catch {
      json(res, 400, { ok: false, error: "invalid_json" });
      return;
    }
    const parsed = sourceWriteFields(body);
    if (parsed.error) {
      json(res, 400, { ok: false, error: parsed.error });
      return;
    }
    const name = parsed.patch.name;
    const baseUrl = parsed.patch.base_url;
    const feedUrl = parsed.patch.feed_url;
    if (!name || !baseUrl || !feedUrl) {
      json(res, 400, { ok: false, error: "name, base_url, and feed_url are required" });
      return;
    }
    const t = nowIso();
    const row = await db.get(
      `INSERT INTO news_sources (
        name, base_url, feed_url, scrape_method, status, priority,
        next_eligible_at, articles_scraped_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      RETURNING *`,
      name,
      baseUrl,
      feedUrl,
      parsed.patch.scrape_method || "rss",
      parsed.patch.status || "unknown",
      parsed.patch.priority ?? 0,
      t,
      t,
      t,
    );
    json(res, 201, { ok: true, action: "create_source", source: row });
    return;
  }

  const sourceMatch = path.match(/^\/v1\/sources\/(\d+)$/);
  if (req.method === "POST" && sourceMatch) {
    const key = await requireApiKey(req, res, SCOPE_COMMAND);
    if (!key) return;
    const id = Number(sourceMatch[1]);
    let body;
    try {
      body = await readJson(req);
    } catch {
      json(res, 400, { ok: false, error: "invalid_json" });
      return;
    }
    const parsed = sourceWriteFields(body);
    if (parsed.error) {
      json(res, 400, { ok: false, error: parsed.error });
      return;
    }
    const patch = parsed.patch;
    if (!Object.keys(patch).length) {
      json(res, 400, { ok: false, error: "no_fields" });
      return;
    }
    const existing = await db.get("SELECT * FROM news_sources WHERE id=?", id);
    if (!existing) {
      json(res, 404, { ok: false, error: "not_found" });
      return;
    }
    patch.updated_at = nowIso();
    const keys = Object.keys(patch);
    await db.run(
      `UPDATE news_sources SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`,
      ...keys.map((k) => patch[k]),
      id,
    );
    json(res, 200, {
      ok: true,
      action: "update_source",
      source: await db.get("SELECT * FROM news_sources WHERE id=?", id),
    });
    return;
  }

  json(res, 404, { ok: false, error: "not_found" });
}

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname === "/health" || url.pathname === "/") {
    if (req.method !== "GET") {
      json(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }
    json(res, 200, {
      ok: true,
      service: "rose-bot",
      product: "rose",
      engine: "postgres",
      lastTick,
      lastCrawlTick,
      crawlEnabled: await crawlEnabled(db),
      articles: countN(await db.get("SELECT COUNT(*) AS n FROM articles")),
      sources: countN(await db.get("SELECT COUNT(*) AS n FROM news_sources")),
      globe: countN(await db.get("SELECT COUNT(*) AS n FROM article_geo_sentiment WHERE eligible = 1")),
    });
    return;
  }
  if (url.pathname === "/articles") {
    if (req.method !== "GET") {
      json(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
    json(res, 200, {
      ok: true,
      articles: await db.all(
        `SELECT a.id, a.url, a.title, a.published_at, a.scraped_at, a.jev_status, s.name AS source
         FROM articles a JOIN news_sources s ON s.id = a.source_id
         ORDER BY a.id DESC LIMIT ?`,
        limit,
      ),
    });
    return;
  }
  if (url.pathname === "/globe") {
    if (req.method !== "GET") {
      json(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }
    json(res, 200, {
      ok: true,
      taxonomy_version: "rose-globe-2026-09-21",
      countries: await listGlobeCountries(db),
    });
    return;
  }
  if (url.pathname === "/crawl") {
    if (req.method === "GET") {
      json(res, 200, { ok: true, lastCrawlTick, ...(await crawlStats(db)) });
      return;
    }
    if (req.method === "POST") {
      const envToken = process.env.ROSE_SERVICE_TOKEN || "";
      const given = bearerFromRequest(req);
      const envOk = Boolean(envToken && given && given === envToken);
      if (!envOk) {
        const key = await requireApiKey(req, res, SCOPE_COMMAND);
        if (!key) return;
      }
      let enabled;
      const raw = await readBody(req);
      if (raw.trim()) {
        try {
          enabled = JSON.parse(raw).enabled;
        } catch {
          json(res, 400, { ok: false, error: "invalid_json" });
          return;
        }
      } else {
        enabled = url.searchParams.get("enabled") === "1" || url.searchParams.get("enabled") === "true";
      }
      await setSetting(db, "crawl_enabled", enabled ? "1" : "0");
      json(res, 200, { ok: true, enabled: await crawlEnabled(db) });
      return;
    }
    json(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  if (url.pathname === "/sources") {
    if (req.method !== "GET") {
      json(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }
    const envToken = process.env.ROSE_SERVICE_TOKEN || "";
    const given = bearerFromRequest(req);
    const envOk = Boolean(envToken && given && given === envToken);
    if (!envOk) {
      const auth = await authorizeApiKey(req, SCOPE_READ);
      if (auth.error) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
    }
    json(res, 200, { ok: true, sources: await listSources() });
    return;
  }
  if (url.pathname.startsWith("/v1/")) {
    await handleV1(req, res, url);
    return;
  }
  json(res, 404, { ok: false, error: "not_found" });
}

async function main() {
  db = await openDb();
  await seedSources();
  await ensureCrawlSetting(db);
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("request failed", err);
      if (!res.headersSent) json(res, 500, { ok: false, error: "internal" });
    });
  });
  server.listen(PORT, "0.0.0.0", async () => {
    console.log(`rose-bot listening on ${PORT} (${db.label}); crawl ${await crawlEnabled(db) ? "on" : "off"}`);
    try {
      if (CRAWL_ONCE && !ONCE) await runTick({ rss: false, crawl: true });
      else await runTick({ rss: true, crawl: true });
    } catch (err) {
      console.error("initial tick failed", err);
    }
    if (ONCE || CRAWL_ONCE) {
      server.close();
      await db.close();
      process.exit(0);
    }
    setInterval(() => {
      runTick().catch((err) => console.error("tick failed", err));
    }, TICK_MS);
  });
}

main().catch((err) => {
  console.error("boot failed", err);
  process.exit(1);
});

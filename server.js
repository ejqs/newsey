import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const PORT = Number(process.env.PORT) || 43123;
const UA = "RoseBot/0.1 (+https://github.com/ejqs/newsey)";
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : "./data");
const TICK_MS = Number(process.env.TICK_MS) || 15 * 60 * 1000;
const MAX_SOURCES = Number(process.env.MAX_SOURCES_PER_TICK) || 1;
const MAX_FETCHES = Number(process.env.MAX_FETCHES_PER_TICK) || 3;
const SOURCE_GAP_HOURS = Number(process.env.SOURCE_GAP_HOURS) || 6;
const ROBOTS_TTL_HOURS = Number(process.env.ROBOTS_TTL_HOURS) || 24;
const FETCH_TIMEOUT_MS = 20_000;
const FLOOR_DELAY_MS = 2000;
const ONCE = process.argv.includes("--once");

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

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "rose.sqlite"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(`
CREATE TABLE IF NOT EXISTS news_sources (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  feed_url TEXT,
  scrape_method TEXT NOT NULL DEFAULT 'rss',
  status TEXT NOT NULL DEFAULT 'unknown',
  robots_checked_at TEXT,
  robots_ttl_until TEXT,
  robots_body TEXT,
  crawl_delay_seconds INTEGER,
  last_success_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  next_eligible_at TEXT NOT NULL,
  articles_scraped_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS url_ledger (
  url TEXT PRIMARY KEY,
  source_id INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  note TEXT,
  FOREIGN KEY (source_id) REFERENCES news_sources(id)
);
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body_text TEXT NOT NULL,
  published_at TEXT,
  scraped_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  lang TEXT,
  raw_metadata TEXT,
  jev_status TEXT NOT NULL DEFAULT 'skipped',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES news_sources(id)
);
`);

const nowIso = () => new Date().toISOString();

function seedSources() {
  const insert = db.prepare(`
    INSERT INTO news_sources (
      name, base_url, feed_url, scrape_method, status, priority,
      next_eligible_at, articles_scraped_count, created_at, updated_at
    ) VALUES (?, ?, ?, 'rss', 'unknown', ?, ?, 0, ?, ?)
  `);
  const exists = db.prepare("SELECT id FROM news_sources WHERE feed_url = ?");
  const t = nowIso();
  for (const s of SEEDS) {
    if (!exists.get(s.feed_url)) {
      insert.run(s.name, s.base_url, s.feed_url, s.priority, t, t, t);
    }
  }
}
seedSources();

async function httpGet(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": UA, accept: "text/html,application/xml,application/rss+xml,text/xml,*/*" },
      redirect: "follow",
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, finalUrl: res.url };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRobots(body) {
  const lines = body.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  const groups = [];
  let cur = null;
  for (const line of lines) {
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      cur = { agents: [val.toLowerCase()], allow: [], disallow: [], crawlDelay: null };
      groups.push(cur);
    } else if (!cur) continue;
    else if (key === "allow") cur.allow.push(val);
    else if (key === "disallow") cur.disallow.push(val);
    else if (key === "crawl-delay") cur.crawlDelay = Number(val) || null;
  }
  return groups;
}

function robotsAllows(groups, pathname) {
  const ua = UA.toLowerCase();
  const match =
    groups.find((g) => g.agents.some((a) => a !== "*" && (ua.includes(a) || a.includes("rose")))) ||
    groups.find((g) => g.agents.includes("*"));
  if (!match) return { allowed: true, crawlDelay: null };
  const rules = [
    ...match.allow.map((p) => ({ p, allow: true })),
    ...match.disallow.map((p) => ({ p, allow: false })),
  ].sort((a, b) => b.p.length - a.p.length);
  for (const r of rules) {
    if (!r.p) continue;
    if (pathname.startsWith(r.p) || r.p === "/") {
      return { allowed: r.allow, crawlDelay: match.crawlDelay };
    }
  }
  return { allowed: true, crawlDelay: match.crawlDelay };
}

async function refreshRobots(source) {
  const ttl = source.robots_ttl_until ? Date.parse(source.robots_ttl_until) : 0;
  if (source.robots_body && ttl > Date.now()) return source;
  const origin = new URL(source.base_url).origin;
  try {
    const res = await httpGet(`${origin}/robots.txt`);
    const t = nowIso();
    const ttlUntil = new Date(Date.now() + ROBOTS_TTL_HOURS * 3600_000).toISOString();
    if (res.status >= 400) {
      db.prepare(
        `UPDATE news_sources SET robots_checked_at=?, robots_ttl_until=?, robots_body=?, updated_at=? WHERE id=?`,
      ).run(t, ttlUntil, "", t, source.id);
      return { ...source, robots_body: "", robots_ttl_until: ttlUntil };
    }
    const groups = parseRobots(res.text);
    const delay = groups.find((g) => g.crawlDelay != null)?.crawlDelay ?? null;
    db.prepare(
      `UPDATE news_sources SET robots_checked_at=?, robots_ttl_until=?, robots_body=?, crawl_delay_seconds=?, updated_at=? WHERE id=?`,
    ).run(t, ttlUntil, res.text, delay, t, source.id);
    return { ...source, robots_body: res.text, robots_ttl_until: ttlUntil, crawl_delay_seconds: delay };
  } catch (err) {
    const t = nowIso();
    db.prepare(`UPDATE news_sources SET last_error=?, updated_at=? WHERE id=?`).run(
      `robots: ${err.message}`.slice(0, 400),
      t,
      source.id,
    );
    return source;
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

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]).trim() : "";
}

function parseFeed(xml) {
  const items = [];
  const chunks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  for (const block of chunks) {
    let link = tag(block, "link");
    if (!link) {
      const href = block.match(/<link[^>]+href=["']([^"']+)["']/i);
      link = href ? href[1] : "";
    }
    if (!link) link = tag(block, "guid");
    const title = tag(block, "title") || "(untitled)";
    const published = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") || null;
    const desc = tag(block, "description") || tag(block, "summary") || tag(block, "content") || "";
    if (link && link.startsWith("http")) items.push({ url: link.split(" ").pop(), title, published, desc });
  }
  return items;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rememberUrl(sourceId, url, outcome, note) {
  const t = nowIso();
  const row = db.prepare("SELECT url FROM url_ledger WHERE url = ?").get(url);
  if (row) {
    if (outcome === "seen") {
      db.prepare(`UPDATE url_ledger SET last_seen_at=? WHERE url=?`).run(t, url);
    } else {
      db.prepare(`UPDATE url_ledger SET last_seen_at=?, outcome=?, note=? WHERE url=?`).run(
        t,
        outcome,
        note ?? null,
        url,
      );
    }
    return false;
  }
  db.prepare(
    `INSERT INTO url_ledger (url, source_id, first_seen_at, last_seen_at, outcome, note) VALUES (?,?,?,?,?,?)`,
  ).run(url, sourceId, t, t, outcome, note ?? null);
  return true;
}

function markSource(source, patch) {
  const t = nowIso();
  const fields = { ...patch, updated_at: t };
  const keys = Object.keys(fields);
  db.prepare(
    `UPDATE news_sources SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`,
  ).run(...keys.map((k) => fields[k]), source.id);
}

function pickSources() {
  const t = nowIso();
  return db
    .prepare(
      `SELECT * FROM news_sources
       WHERE status IN ('ok','unknown') AND next_eligible_at <= ?
       ORDER BY priority DESC, COALESCE(last_success_at, '1970-01-01') ASC
       LIMIT ?`,
    )
    .all(t, MAX_SOURCES);
}

async function scrapeTick() {
  const started = nowIso();
  let fetched = 0;
  const sources = pickSources();
  if (!sources.length) {
    console.log(`[tick ${started}] no eligible sources`);
    return { started, fetched: 0, sources: 0 };
  }
  for (const raw of sources) {
    let source = await refreshRobots(raw);
    const t = nowIso();
    markSource(source, { last_attempt_at: t });
    const feedCheck = pathAllowed(source, source.feed_url);
    if (!feedCheck.allowed) {
      markSource(source, {
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
        markSource(source, {
          status: "blocked",
          last_error: `feed HTTP ${feedRes.status}`,
          next_eligible_at: new Date(Date.now() + SOURCE_GAP_HOURS * 2 * 3600_000).toISOString(),
        });
        continue;
      }
      if (feedRes.status >= 500) {
        markSource(source, {
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
        const isNew = rememberUrl(source.id, item.url, "seen", "rss");
        if (!isNew) continue;
        const allow = pathAllowed(source, item.url);
        if (!allow.allowed) {
          rememberUrl(source.id, item.url, "robots_disallow", "article path");
          continue;
        }
        await sleep(delayMs);
        try {
          const page = await httpGet(item.url);
          if (page.status >= 400) {
            rememberUrl(source.id, item.url, "fetch_error", `HTTP ${page.status}`);
            if (page.status === 401 || page.status === 403 || page.status === 429) {
              markSource(source, {
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
          db.prepare(
            `INSERT OR IGNORE INTO articles (
              source_id, url, title, body_text, published_at, scraped_at, content_hash,
              lang, raw_metadata, jev_status, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).run(
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
          rememberUrl(source.id, item.url, "fetched", null);
          ok += 1;
          fetched += 1;
        } catch (err) {
          rememberUrl(source.id, item.url, "fetch_error", err.message.slice(0, 200));
        }
      }
      const next = new Date(Date.now() + SOURCE_GAP_HOURS * 3600_000).toISOString();
      const count = db.prepare("SELECT COUNT(*) AS n FROM articles WHERE source_id = ?").get(source.id).n;
      markSource(source, {
        status: "ok",
        last_success_at: nowIso(),
        last_error: null,
        next_eligible_at: next,
        articles_scraped_count: count,
      });
      console.log(`[tick] ${source.name}: +${ok} articles, next ${next}`);
    } catch (err) {
      markSource(source, {
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
let ticking = false;

async function runTick() {
  if (ticking) return lastTick;
  ticking = true;
  try {
    lastTick = await scrapeTick();
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (req.method !== "GET") {
    json(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  if (url.pathname === "/health" || url.pathname === "/") {
    json(res, 200, {
      ok: true,
      service: "rose",
      product: "newsey",
      lastTick,
      articles: db.prepare("SELECT COUNT(*) AS n FROM articles").get().n,
      sources: db.prepare("SELECT COUNT(*) AS n FROM news_sources").get().n,
    });
    return;
  }
  if (url.pathname === "/sources") {
    json(res, 200, { ok: true, sources: db.prepare("SELECT * FROM news_sources ORDER BY priority DESC").all() });
    return;
  }
  if (url.pathname === "/articles") {
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
    json(res, 200, {
      ok: true,
      articles: db
        .prepare(
          `SELECT a.id, a.url, a.title, a.published_at, a.scraped_at, a.jev_status, s.name AS source
           FROM articles a JOIN news_sources s ON s.id = a.source_id
           ORDER BY a.id DESC LIMIT ?`,
        )
        .all(limit),
    });
    return;
  }
  json(res, 404, { ok: false, error: "not_found" });
});

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`rose listening on ${PORT} (sqlite ${path.join(DATA_DIR, "rose.sqlite")})`);
  try {
    await runTick();
  } catch (err) {
    console.error("initial tick failed", err);
  }
  if (ONCE) {
    server.close();
    db.close();
    process.exit(0);
  }
  setInterval(() => {
    runTick().catch((err) => console.error("tick failed", err));
  }, TICK_MS);
});

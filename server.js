import http from "node:http";
import crypto from "node:crypto";
import { openDb } from "./db.js";

const PORT = Number(process.env.PORT) || 43123;
const UA = "RoseBot/0.1 (+https://github.com/ejqs/newsey)";
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
    const groups = parseRobots(res.text);
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

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (req.method !== "GET") {
    json(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  if (url.pathname === "/health" || url.pathname === "/") {
    json(res, 200, {
      ok: true,
      service: "rose-bot",
      product: "rose",
      engine: "postgres",
      lastTick,
      articles: countN(await db.get("SELECT COUNT(*) AS n FROM articles")),
      sources: countN(await db.get("SELECT COUNT(*) AS n FROM news_sources")),
    });
    return;
  }
  if (url.pathname === "/sources") {
    const token = process.env.ROSE_SERVICE_TOKEN || "";
    const given = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || req.headers["x-rose-token"] || "";
    if (!token || given !== token) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    json(res, 200, { ok: true, sources: await db.all("SELECT * FROM news_sources ORDER BY priority DESC") });
    return;
  }
  if (url.pathname === "/articles") {
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
  json(res, 404, { ok: false, error: "not_found" });
}

async function main() {
  db = await openDb();
  await seedSources();
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("request failed", err);
      if (!res.headersSent) json(res, 500, { ok: false, error: "internal" });
    });
  });
  server.listen(PORT, "0.0.0.0", async () => {
    console.log(`rose-bot listening on ${PORT} (${db.label})`);
    try {
      await runTick();
    } catch (err) {
      console.error("initial tick failed", err);
    }
    if (ONCE) {
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

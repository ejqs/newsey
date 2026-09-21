import crypto from "node:crypto";
import { CRAWL, ROBOTS_TTL_HOURS, isTruthy } from "./lib/config.js";
import { isNewsHost, pausedHostsFromRows, publisherForHost, sourceHostsFromRows } from "./lib/credibility.js";
import { httpGet } from "./lib/http.js";
import { parseRobots, pathAllowedFromBody } from "./lib/robots.js";
import { evaluatePage, shouldFetchUrl } from "./lib/policy.js";
import { classifyUrl, hostOf, stripWww } from "./lib/urls.js";

const nowIso = () => new Date().toISOString();
const countN = (row) => Number(row?.n ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const lastHostHit = new Map();

export async function getSetting(db, key) {
  const row = await db.get("SELECT value FROM bot_settings WHERE key = ?", key);
  return row?.value ?? null;
}

export async function setSetting(db, key, value) {
  const t = nowIso();
  await db.run(
    `INSERT INTO bot_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    String(value),
    t,
  );
}

export async function crawlEnabled(db) {
  const v = await getSetting(db, "crawl_enabled");
  if (v == null) return CRAWL.enabledEnv;
  return isTruthy(v);
}

export async function ensureCrawlSetting(db) {
  const v = await getSetting(db, "crawl_enabled");
  if (v == null) await setSetting(db, "crawl_enabled", CRAWL.enabledEnv ? "1" : "0");
}

function delayMsFor(robotsDelay, requestRateSeconds) {
  const fromRobots = Math.max(robotsDelay || 0, requestRateSeconds || 0) * 1000;
  return Math.max(CRAWL.floorDelayMs, fromRobots);
}

async function politeWait(host, ms) {
  const last = lastHostHit.get(host) || 0;
  const wait = last + ms - Date.now();
  if (wait > 0) await sleep(wait);
  lastHostHit.set(host, Date.now());
}

async function frontierCount(db) {
  return countN(await db.get("SELECT COUNT(*) AS n FROM crawl_frontier"));
}

async function enqueue(db, url, { from, depth, status, note }) {
  const classified = classifyUrl(url);
  if (!classified.ok || !classified.url) return false;
  const t = nowIso();
  const existing = await db.get("SELECT url FROM crawl_frontier WHERE url = ?", classified.url);
  if (existing) return false;
  const n = await frontierCount(db);
  if (n >= CRAWL.maxFrontier && status !== "queued") return false;
  if (n >= CRAWL.maxFrontier + 500) return false;
  await db.run(
    `INSERT INTO crawl_frontier (
      url, host, discovered_from, depth, status, note, next_eligible_at, enqueued_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (url) DO NOTHING`,
    classified.url,
    classified.host,
    from ?? null,
    depth,
    status,
    note ?? null,
    t,
    t,
    t,
  );
  return true;
}

async function markFrontier(db, url, patch) {
  const t = nowIso();
  const fields = { ...patch, updated_at: t };
  const keys = Object.keys(fields);
  await db.run(
    `UPDATE crawl_frontier SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE url=?`,
    ...keys.map((k) => fields[k]),
    url,
  );
}

async function rememberUrl(db, sourceId, url, outcome, note) {
  const t = nowIso();
  const row = await db.get("SELECT url FROM url_ledger WHERE url = ?", url);
  if (row) {
    await db.run(
      `UPDATE url_ledger SET last_seen_at=?, outcome=?, note=? WHERE url=?`,
      t,
      outcome,
      note ?? null,
      url,
    );
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

async function loadRobots(db, pageUrl) {
  const u = new URL(pageUrl);
  const host = stripWww(u.hostname);
  const origin = u.origin;
  const row = await db.get("SELECT * FROM host_robots WHERE host = ?", host);
  const ttl = row?.ttl_until ? Date.parse(row.ttl_until) : 0;
  if (row && ttl > Date.now()) return row;

  const robotsUrl = `${origin}/robots.txt`;
  const t = nowIso();
  const ttlUntil = new Date(Date.now() + ROBOTS_TTL_HOURS * 3600_000).toISOString();
  try {
    await politeWait(host, CRAWL.floorDelayMs);
    const res = await httpGet(robotsUrl);
    let robots_status = "ok";
    let body = res.text || "";
    let last_error = null;
    if (res.status === 401 || res.status === 403) {
      robots_status = "forbidden";
      body = "";
      last_error = `robots HTTP ${res.status}`;
    } else if (res.status >= 500) {
      robots_status = "unavailable";
      body = "";
      last_error = `robots HTTP ${res.status}`;
    } else if (res.status >= 400) {
      robots_status = "missing";
      body = "";
    }
    const parsed = body ? parseRobots(body) : { groups: [], sitemaps: [] };
    const delay = parsed.groups.find((g) => g.crawlDelay != null)?.crawlDelay ?? null;
    await db.run(
      `INSERT INTO host_robots (
        host, robots_body, robots_status, checked_at, ttl_until, crawl_delay_seconds, sitemaps, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (host) DO UPDATE SET
        robots_body = excluded.robots_body,
        robots_status = excluded.robots_status,
        checked_at = excluded.checked_at,
        ttl_until = excluded.ttl_until,
        crawl_delay_seconds = excluded.crawl_delay_seconds,
        sitemaps = excluded.sitemaps,
        last_error = excluded.last_error`,
      host,
      body,
      robots_status,
      t,
      ttlUntil,
      delay,
      JSON.stringify(parsed.sitemaps || []),
      last_error,
    );
    return {
      host,
      robots_body: body,
      robots_status,
      ttl_until: ttlUntil,
      crawl_delay_seconds: delay,
      sitemaps: JSON.stringify(parsed.sitemaps || []),
      last_error,
    };
  } catch (err) {
    await db.run(
      `INSERT INTO host_robots (
        host, robots_body, robots_status, checked_at, ttl_until, crawl_delay_seconds, sitemaps, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (host) DO UPDATE SET
        robots_status = excluded.robots_status,
        checked_at = excluded.checked_at,
        ttl_until = excluded.ttl_until,
        last_error = excluded.last_error`,
      host,
      "",
      "unavailable",
      t,
      ttlUntil,
      null,
      "[]",
      String(err.message || err).slice(0, 400),
    );
    return { host, robots_body: "", robots_status: "unavailable", ttl_until: ttlUntil, crawl_delay_seconds: null, sitemaps: "[]" };
  }
}

async function ensureSource(db, pageUrl, sources) {
  const host = hostOf(pageUrl);
  const match = sources.find((s) => {
    const hosts = [hostOf(s.base_url), hostOf(s.feed_url || "")].filter(Boolean);
    return hosts.some((h) => host === h || host.endsWith(`.${h}`) || h.endsWith(`.${host}`));
  });
  if (match) return match;
  const pub = publisherForHost(host, CRAWL.extraNewsDomains);
  const t = nowIso();
  const name = pub?.name || host;
  const base = `https://${new URL(pageUrl).hostname}`;
  await db.run(
    `INSERT INTO news_sources (
      name, base_url, feed_url, scrape_method, status, priority,
      next_eligible_at, articles_scraped_count, created_at, updated_at
    ) VALUES (?, ?, NULL, 'crawl', 'ok', 10, ?, 0, ?, ?)`,
    name,
    base,
    t,
    t,
    t,
  );
  return db.get("SELECT * FROM news_sources WHERE base_url = ? ORDER BY id DESC LIMIT 1", base);
}

async function seedFrontier(db, sources, extraDomains, sourceHosts) {
  for (const s of sources) {
    if (s.status === "paused" || s.status === "robots_disallow") continue;
    if (s.base_url) {
      await enqueue(db, s.base_url, { from: null, depth: 0, status: "queued", note: "source" });
    }
  }
  for (const seed of CRAWL.extraSeeds) {
    const allow = isNewsHost(seed, extraDomains, sourceHosts);
    await enqueue(db, seed, {
      from: null,
      depth: 0,
      status: allow || CRAWL.maxNonNewsFetchesPerTick > 0 ? "queued" : "recorded",
      note: "seed",
    });
  }
}

function pickCandidates(rows, { extraDomains, sourceHosts, paused, nonNewsLeft }) {
  const picked = [];
  const perHost = new Map();
  const sorted = [...rows].sort((a, b) => {
    const aNews = isNewsHost(a.url, extraDomains, sourceHosts) ? 0 : 1;
    const bNews = isNewsHost(b.url, extraDomains, sourceHosts) ? 0 : 1;
    if (aNews !== bNews) return aNews - bNews;
    return String(a.enqueued_at).localeCompare(String(b.enqueued_at));
  });
  for (const row of sorted) {
    if (picked.length >= CRAWL.maxFetchesPerTick) break;
    if (paused.has(row.host) || [...paused].some((h) => row.host === h || row.host.endsWith(`.${h}`))) {
      continue;
    }
    const allowlisted = isNewsHost(row.url, extraDomains, sourceHosts);
    const decision = shouldFetchUrl(row.url, {
      allowlisted,
      depth: Number(row.depth) || 0,
      maxDepth: CRAWL.maxDepth,
      fetchNonNews: !allowlisted && nonNewsLeft > 0,
    });
    if (!decision.fetch) continue;
    const n = perHost.get(row.host) || 0;
    if (n >= CRAWL.maxUrlsPerHostPerTick) continue;
    perHost.set(row.host, n + 1);
    if (!allowlisted) nonNewsLeft -= 1;
    picked.push({ row, allowlisted });
  }
  return picked;
}

async function enqueueLinks(db, links, { from, depth, extraDomains, sourceHosts }) {
  let n = 0;
  for (const link of links) {
    if (n >= CRAWL.maxEnqueuePerPage) break;
    const classified = classifyUrl(link);
    if (!classified.ok) {
      await enqueue(db, link, { from, depth: depth + 1, status: `skipped_${classified.reason}`, note: "discover" });
      continue;
    }
    const allowlisted = isNewsHost(classified.url, extraDomains, sourceHosts);
    const status = allowlisted || CRAWL.maxNonNewsFetchesPerTick > 0 ? "queued" : "recorded";
    const ok = await enqueue(db, classified.url, { from, depth: depth + 1, status, note: "link" });
    if (ok) n += 1;
  }
}

export async function crawlTick(db, { force = false } = {}) {
  const started = nowIso();
  await ensureCrawlSetting(db);
  const enabled = force || (await crawlEnabled(db));
  if (!enabled) return { started, enabled: false, fetched: 0, scraped: 0, skipped: 0 };

  const sources = await db.all("SELECT * FROM news_sources");
  const sourceHosts = sourceHostsFromRows(sources);
  const extraDomains = CRAWL.extraNewsDomains;
  const paused = new Set(pausedHostsFromRows(sources));

  await seedFrontier(db, sources, extraDomains, sourceHosts);

  const candidates = await db.all(
    `SELECT * FROM crawl_frontier
     WHERE status = 'queued' AND next_eligible_at <= ?
     ORDER BY enqueued_at ASC
     LIMIT 80`,
    nowIso(),
  );

  let nonNewsLeft = CRAWL.maxNonNewsFetchesPerTick;
  const picked = pickCandidates(candidates, { extraDomains, sourceHosts, paused, nonNewsLeft });

  let fetched = 0;
  let scraped = 0;
  let skipped = 0;

  for (const { row, allowlisted } of picked) {
    const depth = Number(row.depth) || 0;
    const classified = classifyUrl(row.url);
    if (!classified.ok) {
      await markFrontier(db, row.url, { status: `skipped_${classified.reason}`, note: classified.reason, last_attempt_at: nowIso() });
      skipped += 1;
      continue;
    }

    const robots = await loadRobots(db, classified.url);
    if (robots.robots_status === "unavailable" || robots.robots_status === "forbidden") {
      const next = robots.ttl_until;
      await markFrontier(db, row.url, {
        status: robots.robots_status === "forbidden" ? "skipped_robots" : "queued",
        note: robots.robots_status,
        next_eligible_at: next,
        last_attempt_at: nowIso(),
      });
      if (robots.robots_status === "unavailable") {
        await db.run(
          `UPDATE crawl_frontier SET next_eligible_at=?, note=? WHERE host=? AND status='queued'`,
          next,
          "robots_unavailable",
          row.host,
        );
      }
      skipped += 1;
      continue;
    }

    const allow = pathAllowedFromBody(robots.robots_body, classified.url);
    const wait = delayMsFor(allow.crawlDelay ?? robots.crawl_delay_seconds, allow.requestRateSeconds);
    if (!allow.allowed || allow.noindex) {
      await markFrontier(db, row.url, {
        status: "skipped_robots",
        note: allow.noindex ? "robots_noindex" : "disallow",
        last_attempt_at: nowIso(),
      });
      skipped += 1;
      continue;
    }

    try {
      const sitemaps = JSON.parse(robots.sitemaps || "[]");
      if (Array.isArray(sitemaps) && allowlisted) {
        for (const sm of sitemaps.slice(0, 5)) {
          await enqueue(db, sm, { from: classified.url, depth, status: "queued", note: "robots_sitemap" });
        }
      }
    } catch {
      /* ignore sitemap parse */
    }

    const existingArticle = await db.get("SELECT id FROM articles WHERE url = ?", classified.url);
    if (existingArticle) {
      await markFrontier(db, row.url, { status: "scraped", note: "already_in_articles", last_attempt_at: nowIso() });
      continue;
    }
    const led = await db.get("SELECT outcome FROM url_ledger WHERE url = ?", classified.url);
    if (led) {
      await markFrontier(db, row.url, {
        status: led.outcome === "fetched" ? "scraped" : `skipped_${led.outcome}`,
        note: "url_ledger",
        last_attempt_at: nowIso(),
      });
      continue;
    }
    await politeWait(row.host, wait);
    fetched += 1;
    try {
      const page = await httpGet(classified.url);
      const finalUrl = page.finalUrl || classified.url;
      const finalClass = classifyUrl(finalUrl);
      if (finalClass.reason === "login") {
        await markFrontier(db, row.url, { status: "skipped_login", note: `redirect ${page.status}`, last_attempt_at: nowIso() });
        skipped += 1;
        continue;
      }
      if (page.skipped === "too_large") {
        await markFrontier(db, row.url, { status: "error", note: "too_large", last_attempt_at: nowIso() });
        skipped += 1;
        continue;
      }
      if (page.status === 401 || page.status === 403 || page.status === 429) {
        const next = new Date(Date.now() + CRAWL.hostBackoffHours * 3600_000).toISOString();
        await db.run(
          `UPDATE crawl_frontier SET next_eligible_at=?, note=?, last_attempt_at=? WHERE host=? AND status='queued'`,
          next,
          `http_${page.status}`,
          nowIso(),
          row.host,
        );
        await markFrontier(db, row.url, {
          status: page.status === 429 ? "error" : "skipped_login",
          note: `HTTP ${page.status}`,
          last_attempt_at: nowIso(),
          next_eligible_at: next,
        });
        skipped += 1;
        continue;
      }

      const finalAllowlisted = isNewsHost(finalUrl, extraDomains, sourceHosts);
      const result = evaluatePage({
        url: finalClass.url || classified.url,
        status: page.status,
        contentType: page.contentType,
        html: page.text,
        xRobotsTag: page.xRobotsTag,
        allowlisted: finalAllowlisted,
        sitemapLimit: CRAWL.maxSitemapUrls,
      });

      await enqueueLinks(db, result.links || [], {
        from: classified.url,
        depth,
        extraDomains,
        sourceHosts,
      });

      if (result.storeArticle && result.article) {
        const source = await ensureSource(db, result.article.url, sources);
        if (!source || source.status === "paused") {
          await markFrontier(db, row.url, { status: "skipped_not_news", note: "no_source", last_attempt_at: nowIso() });
          skipped += 1;
          continue;
        }
        const hash = crypto.createHash("sha256").update(result.article.body_text).digest("hex");
        const ts = nowIso();
        await db.run(
          `INSERT OR IGNORE INTO articles (
            source_id, url, title, body_text, published_at, scraped_at, content_hash,
            lang, raw_metadata, jev_status, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          source.id,
          result.article.url,
          result.article.title.slice(0, 500),
          result.article.body_text.slice(0, 100_000),
          result.article.published_at,
          ts,
          hash,
          "en",
          JSON.stringify(result.article.raw_metadata),
          "skipped",
          ts,
          ts,
        );
        await rememberUrl(db, source.id, result.article.url, "fetched", "crawl");
        const count = countN(await db.get("SELECT COUNT(*) AS n FROM articles WHERE source_id = ?", source.id));
        await db.run(
          `UPDATE news_sources SET articles_scraped_count=?, last_success_at=?, updated_at=? WHERE id=?`,
          count,
          ts,
          ts,
          source.id,
        );
        await markFrontier(db, row.url, { status: "scraped", note: null, last_attempt_at: ts });
        scraped += 1;
        if (!sources.find((s) => s.id === source.id)) sources.push(source);
      } else {
        const status = result.skipReason ? `skipped_${result.skipReason}` : "fetched";
        await markFrontier(db, row.url, { status, note: result.kind || result.skipReason, last_attempt_at: nowIso() });
        if (result.skipReason) skipped += 1;
      }
    } catch (err) {
      await markFrontier(db, row.url, {
        status: "error",
        note: String(err.message || err).slice(0, 200),
        last_attempt_at: nowIso(),
        next_eligible_at: new Date(Date.now() + CRAWL.hostBackoffHours * 3600_000).toISOString(),
      });
      skipped += 1;
    }
  }

  const summary = { started, enabled: true, fetched, scraped, skipped, picked: picked.length, forced: force };
  console.log(
    `[crawl ${started}] fetched=${fetched} scraped=${scraped} skipped=${skipped} picked=${picked.length}${force ? " (forced)" : ""}`,
  );
  return summary;
}

export async function crawlStats(db) {
  const rows = await db.all("SELECT status, COUNT(*) AS n FROM crawl_frontier GROUP BY status");
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = countN(r);
  return {
    enabled: await crawlEnabled(db),
    frontier: countN(await db.get("SELECT COUNT(*) AS n FROM crawl_frontier")),
    byStatus,
    knobs: {
      maxFetchesPerTick: CRAWL.maxFetchesPerTick,
      maxNonNewsFetchesPerTick: CRAWL.maxNonNewsFetchesPerTick,
      maxDepth: CRAWL.maxDepth,
      floorDelayMs: CRAWL.floorDelayMs,
      maxFrontier: CRAWL.maxFrontier,
      extraSeeds: CRAWL.extraSeeds,
      extraNewsDomains: CRAWL.extraNewsDomains,
    },
  };
}

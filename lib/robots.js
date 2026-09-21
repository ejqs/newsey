import { PRODUCT_TOKEN } from "./config.js";

function parseLine(raw) {
  const line = raw.replace(/^\uFEFF/, "").replace(/#.*$/, "").trim();
  if (!line) return null;
  const idx = line.indexOf(":");
  if (idx < 0) return null;
  return {
    key: line.slice(0, idx).trim().toLowerCase(),
    val: line.slice(idx + 1).trim(),
  };
}

export function parseRobots(body) {
  const groups = [];
  const sitemaps = [];
  let agents = [];
  let rules = null;

  const flush = () => {
    if (!agents.length) return;
    groups.push({
      agents: agents.slice(),
      allow: rules?.allow ?? [],
      disallow: rules?.disallow ?? [],
      noindex: rules?.noindex ?? [],
      crawlDelay: rules?.crawlDelay ?? null,
      requestRateSeconds: rules?.requestRateSeconds ?? null,
    });
    agents = [];
    rules = null;
  };

  const ensureRules = () => {
    if (!rules) {
      rules = { allow: [], disallow: [], noindex: [], crawlDelay: null, requestRateSeconds: null };
    }
  };

  for (const raw of String(body || "").split(/\r?\n/)) {
    const parsed = parseLine(raw);
    if (!parsed) continue;
    const { key, val } = parsed;
    if (key === "user-agent") {
      if (rules) flush();
      agents.push(val.toLowerCase());
      continue;
    }
    if (key === "sitemap" && val) {
      sitemaps.push(val);
      continue;
    }
    if (!agents.length) continue;
    if (key === "allow") {
      ensureRules();
      if (val) rules.allow.push(val);
    } else if (key === "disallow") {
      ensureRules();
      if (val) rules.disallow.push(val);
    } else if (key === "noindex") {
      ensureRules();
      if (val) rules.noindex.push(val);
    } else if (key === "crawl-delay") {
      ensureRules();
      const n = Number(val);
      if (Number.isFinite(n) && n >= 0) rules.crawlDelay = n;
    } else if (key === "request-rate") {
      ensureRules();
      const m = val.match(/(\d+)\s*\/\s*(\d+)\s*s/i);
      if (m) {
        const count = Number(m[1]);
        const seconds = Number(m[2]);
        if (count > 0 && seconds > 0) rules.requestRateSeconds = seconds / count;
      }
    }
  }
  flush();
  return { groups, sitemaps };
}

function globToRegExp(pattern) {
  let end = false;
  let p = pattern;
  if (p.endsWith("$")) {
    end = true;
    p = p.slice(0, -1);
  }
  let out = "^";
  for (const ch of p) {
    if (ch === "*") out += ".*";
    else if ("\\^$+?.()|[]{}".includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(out + (end ? "$" : ""));
}

export function ruleMatches(pattern, pathAndQuery) {
  if (!pattern) return false;
  try {
    return globToRegExp(pattern).test(pathAndQuery);
  } catch {
    return pathAndQuery.startsWith(pattern);
  }
}

function uaSpecificity(ruleAgent, productToken) {
  const a = String(ruleAgent || "").toLowerCase();
  if (a === "*") return 1;
  if (!a) return 0;
  if (productToken === a || productToken.startsWith(a)) return 100 + a.length;
  return 0;
}

function pickGroups(groups, productToken) {
  let best = 0;
  const matched = [];
  for (const g of groups) {
    const spec = Math.max(0, ...g.agents.map((a) => uaSpecificity(a, productToken)));
    if (spec > best) {
      best = spec;
      matched.length = 0;
      matched.push(g);
    } else if (spec && spec === best) {
      matched.push(g);
    }
  }
  return matched;
}

export function robotsAllows(parsed, pathname, productToken = PRODUCT_TOKEN) {
  const groups = Array.isArray(parsed) ? parsed : parsed?.groups || [];
  const path = pathname || "/";
  const matched = pickGroups(groups, productToken);
  if (!matched.length) {
    return { allowed: true, crawlDelay: null, requestRateSeconds: null, noindex: false };
  }

  const rules = [];
  let crawlDelay = null;
  let requestRateSeconds = null;
  for (const g of matched) {
    if (g.crawlDelay != null) crawlDelay = Math.max(crawlDelay ?? 0, g.crawlDelay);
    if (g.requestRateSeconds != null) {
      requestRateSeconds = Math.max(requestRateSeconds ?? 0, g.requestRateSeconds);
    }
    for (const p of g.allow) rules.push({ p, allow: true, noindex: false });
    for (const p of g.disallow) rules.push({ p, allow: false, noindex: false });
    for (const p of g.noindex || []) rules.push({ p, allow: false, noindex: true });
  }

  rules.sort((a, b) => b.p.length - a.p.length || (a.allow === b.allow ? 0 : a.allow ? -1 : 1));

  let noindex = false;
  for (const r of rules) {
    if (!ruleMatches(r.p, path)) continue;
    if (r.noindex) noindex = true;
    return { allowed: r.allow, crawlDelay, requestRateSeconds, noindex };
  }
  return { allowed: true, crawlDelay, requestRateSeconds, noindex: false };
}

export function pathAllowedFromBody(robotsBody, url, productToken = PRODUCT_TOKEN) {
  if (!robotsBody) return { allowed: true, crawlDelay: null, requestRateSeconds: null, noindex: false };
  try {
    const u = new URL(url);
    return robotsAllows(parseRobots(robotsBody), u.pathname + u.search, productToken);
  } catch {
    return { allowed: false, crawlDelay: null, requestRateSeconds: null, noindex: false };
  }
}

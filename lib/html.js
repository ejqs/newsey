import { canonicalize, isSitemapUrl } from "./urls.js";

export function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

export function parseFeed(xml) {
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

function metaContent(html, attr, value) {
  const re = new RegExp(
    `<meta[^>]+(?:${attr}=["']${value}["'][^>]+content=["']([^"']+)["']|content=["']([^"']+)["'][^>]+${attr}=["']${value}["'])`,
    "i",
  );
  const m = html.match(re);
  return m ? (m[1] || m[2] || "").trim() : "";
}

export function parseMetaRobots(html, xRobotsTag = "") {
  const parts = [
    metaContent(html, "name", "robots"),
    metaContent(html, "name", "googlebot"),
    metaContent(html, "name", "googlebot-news"),
    String(xRobotsTag || ""),
  ]
    .join(",")
    .toLowerCase()
    .split(/[,\s]+/)
    .filter(Boolean);
  return {
    noindex: parts.includes("noindex"),
    noarchive: parts.includes("noarchive"),
    nofollow: parts.includes("nofollow"),
    none: parts.includes("none"),
  };
}

function jsonLdNodes(html) {
  const nodes = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const n of list) {
        if (n && Array.isArray(n["@graph"])) nodes.push(...n["@graph"]);
        else if (n) nodes.push(n);
      }
    } catch {
      /* ignore malformed json-ld */
    }
  }
  return nodes;
}

function typeList(node) {
  const t = node?.["@type"];
  return (Array.isArray(t) ? t : [t]).map((x) => String(x || "").toLowerCase());
}

export function publisherSignals(html) {
  const nodes = jsonLdNodes(html);
  const newsTypes = new Set(["newsarticle", "reportagenewsarticle", "analysisnewsarticle", "backgroundnewsarticle", "opinionnewsarticle", "reviewnewsarticle", "article"]);
  let newsArticle = false;
  let isAccessibleForFree = undefined;
  let title = "";
  let published = "";
  for (const n of nodes) {
    const types = typeList(n);
    if (types.some((t) => newsTypes.has(t))) {
      if (types.some((t) => t.includes("news") || t === "article")) newsArticle = true;
      if (n.headline) title = String(n.headline);
      if (n.datePublished) published = String(n.datePublished);
      if (n.isAccessibleForFree === false || n.isAccessibleForFree === "False" || n.isAccessibleForFree === "false") {
        isAccessibleForFree = false;
      }
      if (n.isAccessibleForFree === true) isAccessibleForFree = true;
    }
  }
  const ogType = metaContent(html, "property", "og:type").toLowerCase();
  const ogTitle = metaContent(html, "property", "og:title");
  const ogPub = metaContent(html, "property", "article:published_time");
  if (ogType === "article") newsArticle = true;
  return {
    newsArticle,
    ogArticle: ogType === "article",
    isAccessibleForFree,
    title: title || ogTitle || pageTitle(html),
    published: published || ogPub || null,
  };
}

export function pageTitle(html) {
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1]).replace(/\s+/g, " ").trim() : "";
}

export function looksPaywalled(html, signals) {
  if (signals?.isAccessibleForFree === false) return true;
  const s = String(html || "");
  if (/isaccessibleforfree["']?\s*:\s*false/i.test(s)) return true;
  if (/\b(?:piano-?paywall|paywall|subscribe-wall|regwall|login-wall|metered-paywall)\b/i.test(s)) {
    if (/subscribe to (?:continue|read)|already a subscriber|create (?:an )?account to (?:read|continue)/i.test(htmlToText(s).slice(0, 4000))) {
      return true;
    }
    if (/id=["'][^"']*(?:paywall|regwall|piano)/i.test(s) || /class=["'][^"']*(?:paywall|regwall|piano)/i.test(s)) {
      return true;
    }
  }
  return false;
}

function relNofollow(tagOpen) {
  return /\brel=["'][^"']*\bnofollow\b/i.test(tagOpen);
}

export function extractLinks(html, baseUrl, { skipNofollow = true } = {}) {
  const out = [];
  const seen = new Set();
  const add = (href, nofollow) => {
    if (skipNofollow && nofollow) return;
    const canon = canonicalize(href, baseUrl);
    if (!canon || seen.has(canon)) return;
    seen.add(canon);
    out.push(canon);
  };

  const aRe = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>/gi;
  let m;
  while ((m = aRe.exec(html))) {
    add(m[2], relNofollow(`${m[1]} ${m[3]}`));
  }

  const canon = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  if (canon) add(canon[1], false);

  return out;
}

export function extractSitemapLocs(xml, limit = 50) {
  const locs = [];
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const url = decode(m[1]).trim();
    if (url.startsWith("http")) locs.push(url);
    if (locs.length >= limit) break;
  }
  return locs;
}

export function isXmlSitemap(text, url) {
  if (isSitemapUrl(url)) return true;
  const s = String(text || "").slice(0, 400).toLowerCase();
  return s.includes("<urlset") || s.includes("<sitemapindex");
}

export function isFeedXml(text) {
  const s = String(text || "").slice(0, 400).toLowerCase();
  return s.includes("<rss") || s.includes("<feed") || s.includes("<rdf:rdf");
}

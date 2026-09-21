import { classifyUrl } from "./urls.js";
import { isNewsHost } from "./credibility.js";
import {
  extractLinks,
  extractSitemapLocs,
  htmlToText,
  isFeedXml,
  isXmlSitemap,
  looksPaywalled,
  parseFeed,
  parseMetaRobots,
  publisherSignals,
} from "./html.js";

export function shouldFetchUrl(url, { allowlisted, depth, maxDepth, fetchNonNews }) {
  const c = classifyUrl(url);
  if (!c.ok) return { fetch: false, reason: c.reason, classified: c };
  if (depth > maxDepth) return { fetch: false, reason: "depth", classified: c };
  if (!allowlisted && !fetchNonNews) return { fetch: false, reason: "not_news", classified: c };
  return { fetch: true, reason: allowlisted ? "news_host" : "discovery", classified: c };
}

export function evaluatePage({
  url,
  status,
  contentType = "",
  html = "",
  xRobotsTag = "",
  allowlisted,
  followLinks = true,
  sitemapLimit = 50,
}) {
  if (status === 401 || status === 403) {
    return { skipReason: "login", followLinks: false, storeArticle: false, links: [], article: null };
  }
  if (status === 429) {
    return { skipReason: "rate_limited", followLinks: false, storeArticle: false, links: [], article: null };
  }
  if (status >= 400) {
    return { skipReason: "http_error", followLinks: false, storeArticle: false, links: [], article: null };
  }

  const ct = contentType.toLowerCase();
  if (ct && !/html|xml|rss|atom|text\/plain/.test(ct)) {
    return { skipReason: "not_html", followLinks: false, storeArticle: false, links: [], article: null };
  }

  if (isXmlSitemap(html, url)) {
    const links = extractSitemapLocs(html, sitemapLimit);
    return { skipReason: null, followLinks: true, storeArticle: false, links, article: null, kind: "sitemap" };
  }
  if (isFeedXml(html)) {
    const links = parseFeed(html).map((i) => i.url);
    return { skipReason: null, followLinks: true, storeArticle: false, links, article: null, kind: "feed" };
  }

  const robots = parseMetaRobots(html, xRobotsTag);
  if (robots.none || robots.nofollow) followLinks = false;
  const links = followLinks ? extractLinks(html, url, { skipNofollow: true }) : [];

  if (robots.none || robots.noindex || robots.noarchive) {
    return {
      skipReason: robots.noarchive && !robots.noindex ? "noarchive" : "noindex",
      followLinks,
      storeArticle: false,
      links,
      article: null,
    };
  }

  const signals = publisherSignals(html);
  if (looksPaywalled(html, signals)) {
    return { skipReason: "paywall", followLinks: false, storeArticle: false, links: [], article: null };
  }

  const classified = classifyUrl(url);
  const articleLike = classified.reason === "article_candidate" || signals.newsArticle || signals.ogArticle;
  if (!allowlisted || !articleLike) {
    return { skipReason: allowlisted ? "not_article" : "not_news", followLinks, storeArticle: false, links, article: null };
  }

  const title = (signals.title || classified.url).slice(0, 500);
  const body = htmlToText(html);
  if (body.length < 400) {
    return { skipReason: "too_short", followLinks, storeArticle: false, links, article: null };
  }

  return {
    skipReason: null,
    followLinks,
    storeArticle: true,
    links,
    article: {
      url,
      title,
      body_text: body.slice(0, 100_000),
      published_at: signals.published,
      raw_metadata: {
        via: "crawl",
        newsArticle: signals.newsArticle,
        ogArticle: signals.ogArticle,
        allowlisted: true,
        host: classified.host,
      },
    },
  };
}

export function extraAllowlist(extraDomains, sourceHosts) {
  return (url) => isNewsHost(url, extraDomains, sourceHosts);
}

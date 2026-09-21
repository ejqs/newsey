import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePage, shouldFetchUrl } from "../lib/policy.js";

const articleHtml = (extra = "") => `<html><head>
<title>Election results arrive in swing state</title>
<meta property="og:type" content="article" />
<script type="application/ld+json">{"@type":"NewsArticle","headline":"Election results arrive in swing state","datePublished":"2026-09-21","isAccessibleForFree":true}</script>
</head><body><article><p>${"The commission certified the count. ".repeat(40)}</p>
<a href="/news/world-followup-story-that-is-long-enough">next</a>
<a href="https://twitter.com/someone">social</a>
${extra}</article></body></html>`;

test("does not fetch non-news when discovery is off", () => {
  const d = shouldFetchUrl("https://example.com/page", {
    allowlisted: false,
    depth: 0,
    maxDepth: 2,
    fetchNonNews: false,
  });
  assert.equal(d.fetch, false);
  assert.equal(d.reason, "not_news");
});

test("stores allowlisted news article and extracts links", () => {
  const r = evaluatePage({
    url: "https://www.bbc.com/news/world-europe-66881234",
    status: 200,
    contentType: "text/html",
    html: articleHtml(),
    allowlisted: true,
  });
  assert.equal(r.storeArticle, true);
  assert.ok(r.article.body_text.length > 400);
  assert.ok(r.links.some((l) => l.includes("followup")));
});

test("refuses to scrape without allowlist even if it looks like news", () => {
  const r = evaluatePage({
    url: "https://random-blog.example/news/world-europe-66881234",
    status: 200,
    contentType: "text/html",
    html: articleHtml(),
    allowlisted: false,
  });
  assert.equal(r.storeArticle, false);
  assert.equal(r.skipReason, "not_news");
});

test("honors noindex/noarchive and does not store", () => {
  const html = articleHtml(`<meta name="robots" content="noindex, noarchive" />`);
  const r = evaluatePage({
    url: "https://www.bbc.com/news/world-europe-66881234",
    status: 200,
    contentType: "text/html",
    html,
    allowlisted: true,
  });
  assert.equal(r.storeArticle, false);
  assert.equal(r.skipReason, "noindex");
});

test("honors X-Robots-Tag nofollow by not extracting links", () => {
  const r = evaluatePage({
    url: "https://www.bbc.com/news/world-europe-66881234",
    status: 200,
    contentType: "text/html",
    html: articleHtml(),
    xRobotsTag: "nofollow",
    allowlisted: true,
  });
  assert.equal(r.links.length, 0);
});

test("skips paywall and login responses", () => {
  const pay = evaluatePage({
    url: "https://www.ft.com/content/abcdef-long-article-slug-here",
    status: 200,
    contentType: "text/html",
    html: articleHtml(`<div id="paywall">Subscribe to continue reading this story</div>
    <script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>`),
    allowlisted: true,
  });
  assert.equal(pay.skipReason, "paywall");
  assert.equal(pay.storeArticle, false);

  const login = evaluatePage({
    url: "https://www.nytimes.com/2026/09/21/world/long-slug-here.html",
    status: 401,
    html: "",
    allowlisted: true,
  });
  assert.equal(login.skipReason, "login");
});

test("listing pages on a news host are not stored as articles", () => {
  const r = evaluatePage({
    url: "https://www.bbc.com/news",
    status: 200,
    contentType: "text/html",
    html: `<html><head><title>News</title></head><body>${"link ".repeat(200)}<a href="/news/world-europe-66881234">x</a></body></html>`,
    allowlisted: true,
  });
  assert.equal(r.storeArticle, false);
  assert.equal(r.skipReason, "not_article");
  assert.ok(r.links.length >= 1);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRobots, robotsAllows, ruleMatches } from "../lib/robots.js";

test("groups consecutive user-agents and prefers RoseBot over *", () => {
  const parsed = parseRobots(`
User-agent: *
Disallow: /private
Crawl-delay: 2

User-agent: Googlebot
User-agent: Bingbot
Disallow: /

User-agent: RoseBot
Allow: /news
Disallow: /search
Crawl-delay: 10
Sitemap: https://example.com/sitemap.xml
`);
  assert.equal(parsed.sitemaps[0], "https://example.com/sitemap.xml");
  const r = robotsAllows(parsed, "/search");
  assert.equal(r.allowed, false);
  assert.equal(r.crawlDelay, 10);
  assert.equal(robotsAllows(parsed, "/news/world").allowed, true);
});

test("longest match wins and Allow beats equal-length Disallow", () => {
  const parsed = parseRobots(`User-agent: *\nDisallow: /news\nAllow: /news/public\n`);
  assert.equal(robotsAllows(parsed, "/news/secret").allowed, false);
  assert.equal(robotsAllows(parsed, "/news/public/a").allowed, true);
});

test("wildcards and end anchor", () => {
  assert.equal(ruleMatches("/*.json$", "/foo.json"), true);
  assert.equal(ruleMatches("/*.json$", "/foo.json?x=1"), false);
  const parsed = parseRobots(`User-agent: *\nDisallow: /*.json$\n`);
  assert.equal(robotsAllows(parsed, "/api/data.json").allowed, false);
  assert.equal(robotsAllows(parsed, "/api/data.jsonl").allowed, true);
});

test("empty disallow is ignored; slash disallow blocks all", () => {
  const empty = parseRobots(`User-agent: *\nDisallow:\n`);
  assert.equal(robotsAllows(empty, "/anything").allowed, true);
  const all = parseRobots(`User-agent: *\nDisallow: /\n`);
  assert.equal(robotsAllows(all, "/news").allowed, false);
});

test("Noindex directive is treated as a block", () => {
  const parsed = parseRobots(`User-agent: *\nNoindex: /drafts\n`);
  const r = robotsAllows(parsed, "/drafts/a");
  assert.equal(r.allowed, false);
  assert.equal(r.noindex, true);
});

test("Request-rate is parsed", () => {
  const parsed = parseRobots(`User-agent: *\nRequest-rate: 1/5s\n`);
  const r = robotsAllows(parsed, "/");
  assert.equal(r.requestRateSeconds, 5);
});

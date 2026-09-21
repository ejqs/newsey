import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyUrl, canonicalize } from "../lib/urls.js";

test("drops tracking params and hash", () => {
  assert.equal(
    canonicalize("https://WWW.Example.com/a/?utm_source=x&b=1#frag"),
    "https://www.example.com/a?b=1",
  );
});

test("rejects private, login, personal, and assets", () => {
  assert.equal(classifyUrl("https://127.0.0.1/news").reason, "private");
  assert.equal(classifyUrl("https://192.168.0.4/x").reason, "private");
  assert.equal(classifyUrl("https://example.com/login").reason, "login");
  assert.equal(classifyUrl("https://example.com/subscribe/").reason, "login");
  assert.equal(classifyUrl("https://twitter.com/someone").reason, "personal");
  assert.equal(classifyUrl("https://www.facebook.com/foo").reason, "personal");
  assert.equal(classifyUrl("https://example.com/photo.jpg").reason, "asset");
  assert.equal(classifyUrl("mailto:hi@example.com").ok, false);
});

test("article candidates are conservative", () => {
  assert.equal(classifyUrl("https://www.bbc.com/").reason, "index");
  assert.equal(classifyUrl("https://www.bbc.com/news").reason, "page");
  assert.equal(
    classifyUrl("https://www.bbc.com/news/world-europe-66881234").reason,
    "article_candidate",
  );
  assert.equal(
    classifyUrl("https://www.theguardian.com/world/2026/sep/21/some-long-article-slug-here").reason,
    "article_candidate",
  );
  assert.equal(classifyUrl("https://www.bbc.com/news/topics/foo").reason, "index");
});

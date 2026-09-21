import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewsHost, publisherForHost } from "../lib/credibility.js";

test("allowlist matches aliases and subdomains, not lookalikes", () => {
  assert.equal(publisherForHost("www.bbc.co.uk")?.name, "BBC");
  assert.equal(publisherForHost("feeds.bbci.co.uk")?.name, "BBC");
  assert.equal(isNewsHost("https://www.npr.org/x"), true);
  assert.equal(isNewsHost("https://notbbc.co.uk/news"), false);
  assert.equal(isNewsHost("https://bbc.com.evil.example/news"), false);
});

test("registered sources and extra domains count as news hosts", () => {
  assert.equal(isNewsHost("https://citypaper.example/a", [], ["citypaper.example"]), true);
  assert.equal(isNewsHost("https://indie.example/a", ["indie.example"], []), true);
  assert.equal(isNewsHost("https://random.example/a", [], []), false);
});

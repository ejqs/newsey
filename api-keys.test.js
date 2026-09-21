import assert from "node:assert/strict";
import test from "node:test";
import {
  generateToken,
  hashToken,
  hashesEqual,
  hasScope,
  parseToken,
  TOKEN_RE,
} from "./api-keys.js";

test("generateToken matches rose_<id>_<secret> and hashes at rest", () => {
  const made = generateToken();
  assert.match(made.token, TOKEN_RE);
  assert.equal(made.prefix, `rose_${made.id}`);
  assert.equal(made.id.length, 16);
  assert.equal(hashToken(made.token), made.secretHash);
  assert.equal(made.secretHash.length, 64);
  assert.ok(!made.secretHash.includes(made.token));
});

test("parseToken accepts only the canonical shape", () => {
  const made = generateToken();
  const parsed = parseToken(made.token);
  assert.equal(parsed.id, made.id);
  assert.equal(parseToken("not-a-key"), null);
  assert.equal(parseToken(`rose_${made.id}`), null);
  assert.equal(parseToken(` ${made.token} `)?.id, made.id);
});

test("hashesEqual is length-safe", () => {
  const a = hashToken("rose_abc");
  assert.equal(hashesEqual(a, a), true);
  assert.equal(hashesEqual(a, hashToken("other")), false);
  assert.equal(hashesEqual(a, "zz"), false);
  assert.equal(hashesEqual("", ""), false);
});

test("hasScope splits on whitespace", () => {
  assert.equal(hasScope("bot:read bot:command", "bot:command"), true);
  assert.equal(hasScope("bot:read", "bot:command"), false);
});

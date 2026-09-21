import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { aggregateCountryTones, capColor, NET_TONE_THRESHOLD } from "./globe-aggregate.js";
import {
  interpretGlobeAnswers,
  mockFilenameForArticle,
  stage1Questions,
  stage2Questions,
} from "./jev-globe.js";
import { countriesInRegion } from "./countries.js";

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/jev-mock/${name}`, import.meta.url), "utf8"));
}

test("stage1 questions are noul + choice with none outcomes", () => {
  const q = stage1Questions();
  assert.equal(q.about_primary_country.type, "noul");
  assert.equal(q.region.type, "choice");
  assert.ok(q.region.criteria.none);
  assert.equal(q.country_sentiment.type, "choice");
  assert.deepEqual(Object.keys(q.country_sentiment.criteria).sort(), [
    "mixed",
    "negative",
    "not_applicable",
    "positive",
  ]);
});

test("stage2 country choice stays under 255 options and includes none", () => {
  for (const region of ["africa", "americas", "asia", "europe", "oceania"]) {
    const q = stage2Questions(region);
    const keys = Object.keys(q.primary_country.criteria);
    assert.ok(keys.includes("none"));
    assert.ok(keys.length <= 255);
    assert.ok(keys.length > 3);
    assert.equal(Object.keys(countriesInRegion(region)).length, keys.length);
  }
});

test("ukraine fixture maps to eligible negative UA", async () => {
  const raw = await fixture("globe-ukraine-negative.json");
  const row = interpretGlobeAnswers(raw.answers);
  assert.equal(row.eligible, 1);
  assert.equal(row.country_iso, "UA");
  assert.equal(row.sentiment, "negative");
  assert.equal(row.country_name, "Ukraine");
});

test("japan fixture maps to eligible positive JP", async () => {
  const raw = await fixture("globe-japan-positive.json");
  const row = interpretGlobeAnswers(raw.answers);
  assert.equal(row.eligible, 1);
  assert.equal(row.country_iso, "JP");
  assert.equal(row.sentiment, "positive");
});

test("canada mixed/low-confidence sentiment is blue, still plotted", async () => {
  const raw = await fixture("globe-canada-mixed.json");
  const row = interpretGlobeAnswers(raw.answers);
  assert.equal(row.eligible, 1);
  assert.equal(row.country_iso, "CA");
  assert.equal(row.sentiment, "mixed");
});

test("roundup fixture is not plotted", async () => {
  const raw = await fixture("globe-none.json");
  const row = interpretGlobeAnswers(raw.answers);
  assert.equal(row.eligible, 0);
  assert.equal(row.country_iso, null);
  assert.equal(row.sentiment, "none");
});

test("dateline-only: high region but low about-country noul is skipped", () => {
  const row = interpretGlobeAnswers({
    about_primary_country: { type: "noul", noul: 0.4 },
    region: {
      type: "choice",
      choice: "europe",
      probabilities: { europe: 0.8, none: 0.2 },
      confidence: 0.75,
    },
    primary_country: {
      type: "choice",
      choice: "FR",
      probabilities: { FR: 0.8, none: 0.2 },
      confidence: 0.7,
    },
    country_sentiment: {
      type: "choice",
      choice: "positive",
      probabilities: { positive: 0.7, negative: 0.1, mixed: 0.1, not_applicable: 0.1 },
      confidence: 0.6,
    },
  });
  assert.equal(row.eligible, 0);
  assert.equal(row.country_iso, null);
});

test("mock filename is conservative keyword match", () => {
  assert.equal(
    mockFilenameForArticle({ title: "Ukraine grid attacks continue", body_text: "" }),
    "globe-ukraine-negative.json",
  );
  assert.equal(
    mockFilenameForArticle({ title: "UN assembly hears many capitals", body_text: "Geneva dateline" }),
    "globe-none.json",
  );
});

test("aggregate: green/red/blue and strength from agreeing articles", () => {
  const tones = aggregateCountryTones([
    { country_iso: "UA", country_name: "Ukraine", sentiment: "negative", confidence: 0.8, eligible: 1 },
    { country_iso: "UA", country_name: "Ukraine", sentiment: "negative", confidence: 0.7, eligible: 1 },
    { country_iso: "JP", country_name: "Japan", sentiment: "positive", confidence: 0.75, eligible: 1 },
    { country_iso: "CA", country_name: "Canada", sentiment: "mixed", confidence: 0.3, eligible: 1 },
    { country_iso: "FR", country_name: "France", sentiment: "positive", confidence: 0.9, eligible: 0 },
  ]);
  const byIso = Object.fromEntries(tones.map((t) => [t.iso, t]));
  assert.equal(byIso.UA.tone, "negative");
  assert.equal(byIso.UA.articles, 2);
  assert.equal(byIso.JP.tone, "positive");
  assert.equal(byIso.CA.tone, "neutral");
  assert.ok(!byIso.FR);
  assert.ok(byIso.UA.strength > byIso.JP.strength);
  assert.ok(byIso.UA.net < -NET_TONE_THRESHOLD);
  assert.match(capColor("positive", 1), /^rgba\(22, 145, 72,/);
  assert.match(capColor("negative", 1), /^rgba\(186, 36, 36,/);
  assert.match(capColor("neutral", 1), /^rgba\(36, 96, 186,/);
});

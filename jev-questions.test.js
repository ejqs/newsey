import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stage1Questions, stage2Questions, analyzeArticle } from "./jev-globe.js";
import {
  SEED_QUESTIONS,
  buildQuestionMap,
  mergeExtraAnswers,
  partitionQuestions,
  stubAnswer,
  toSystemOneQuestion,
} from "./jev-questions.js";

test("seed includes globe questions plus hop-in and metadata", () => {
  const ids = SEED_QUESTIONS.map((q) => q.question_id);
  for (const id of [
    "about_primary_country",
    "region",
    "country_sentiment",
    "primary_country",
    "worth_hopping_into",
    "article_kind",
    "primary_topic",
  ]) {
    assert.ok(ids.includes(id), id);
  }
  const country = SEED_QUESTIONS.find((q) => q.question_id === "primary_country");
  assert.equal(country.depends_on, "region");
  assert.equal(country.criteria_source, "countries_in_region");
  const hop = SEED_QUESTIONS.find((q) => q.question_id === "worth_hopping_into");
  assert.equal(hop.type, "noul");
});

test("stage1 loads independent questions from data, including extras", () => {
  const q = stage1Questions();
  assert.equal(q.about_primary_country.type, "noul");
  assert.equal(q.worth_hopping_into.type, "noul");
  assert.equal(q.article_kind.type, "choice");
  assert.equal(q.primary_topic.type, "choice");
  assert.equal(q.primary_country, undefined);
});

test("a newly added question is asked without code changes", () => {
  const extra = {
    question_id: "keep_for_profiles",
    type: "noul",
    instructions: "Is this article worth keeping for entity profiles?",
    criteria: { true: "Keep.", false: "Drop." },
    enabled: 1,
    depends_on: null,
  };
  const q = stage1Questions([...partitionQuestions(SEED_QUESTIONS).independent, extra]);
  assert.equal(q.keep_for_profiles.type, "noul");
  assert.equal(q.keep_for_profiles.instructions, extra.instructions);
});

test("disabled questions are omitted", () => {
  const rows = SEED_QUESTIONS.map((q) =>
    q.question_id === "article_kind" ? { ...q, enabled: 0 } : q,
  );
  const q = stage1Questions(partitionQuestions(rows).independent);
  assert.equal(q.article_kind, undefined);
  assert.ok(q.worth_hopping_into);
});

test("primary_country criteria is filled from region at runtime", () => {
  const q = stage2Questions("europe");
  const keys = Object.keys(q.primary_country.criteria);
  assert.ok(keys.includes("UA"));
  assert.ok(keys.includes("none"));
  assert.ok(keys.length <= 255);
  assert.match(q.primary_country.instructions.question, /`europe`/);
});

test("toSystemOneQuestion only emits type, instructions, criteria", () => {
  const q = toSystemOneQuestion(SEED_QUESTIONS[0]);
  assert.deepEqual(Object.keys(q).sort(), ["criteria", "instructions", "type"]);
});

test("choice with too many options is skipped", () => {
  const huge = {
    question_id: "too_big",
    type: "choice",
    instructions: "Pick one.",
    criteria: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`k${i}`, "x"])),
    enabled: 1,
  };
  const map = buildQuestionMap([huge]);
  assert.equal(map.too_big, undefined);
});

test("analyzeArticle mock merges globe + extra taxonomy answers", async () => {
  const result = await analyzeArticle({
    title: "Ukraine grid attacks continue",
    body_text: "Kyiv remains the subject.",
  });
  assert.equal(result.mock, true);
  assert.equal(result.answers.country_sentiment.choice, "negative");
  assert.equal(result.answers.primary_country.choice, "UA");
  assert.equal(result.answers.worth_hopping_into.type, "noul");
  assert.equal(result.answers.article_kind.type, "choice");
  assert.ok(result.asked.includes("worth_hopping_into"));
});

test("stub and extra-fixture merge keep globe answers and TypeSafe shapes", async () => {
  const globe = JSON.parse(
    await readFile(new URL("./fixtures/jev-mock/globe-ukraine-negative.json", import.meta.url), "utf8"),
  );
  const extra = JSON.parse(
    await readFile(new URL("./fixtures/jev-mock/taxonomy-extra.json", import.meta.url), "utf8"),
  );
  const merged = mergeExtraAnswers(globe.answers, SEED_QUESTIONS, extra.answers);
  assert.equal(merged.country_sentiment.choice, "negative");
  assert.equal(merged.worth_hopping_into.type, "noul");
  assert.equal(typeof merged.worth_hopping_into.noul, "number");
  assert.equal(merged.article_kind.type, "choice");
  assert.ok(merged.article_kind.probabilities);
  assert.equal(merged.primary_topic.choice, "war_conflict");
  const unknown = {
    question_id: "brand_new",
    type: "score",
    instructions: "How dense is the reporting?",
    criteria: ["Thin", "Adequate", "Dense"],
    enabled: 1,
  };
  const withStub = mergeExtraAnswers(merged, [unknown], extra.answers);
  assert.equal(withStub.brand_new.type, "score");
  assert.ok(withStub.brand_new.legend);
  assert.ok(withStub.brand_new.probabilities);
  const noulStub = stubAnswer({ type: "noul" });
  assert.deepEqual(Object.keys(noulStub).sort(), ["noul", "type"]);
});

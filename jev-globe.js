import path from "node:path";
import { pathToFileURL } from "node:url";
import { countryName } from "./countries.js";
import { loadMockAnswers, systemOne, typesafeKey } from "./jev-client.js";
import { aggregateCountryTones } from "./globe-aggregate.js";
import {
  TAXONOMY_VERSION,
  buildQuestionMap,
  dependentSeedQuestions,
  independentSeedQuestions,
  listEnabledQuestions,
  mergeExtraAnswers,
  partitionQuestions,
} from "./jev-questions.js";

export { TAXONOMY_VERSION };
export const JEV_MODEL = "jev-latest";
export const ABOUT_COUNTRY_MIN = 0.7;
export const COUNTRY_CONFIDENCE_MIN = 0.45;
export const REGION_CONFIDENCE_MIN = 0.35;
export const SENTIMENT_CONFIDENCE_MIN = 0.4;
const BODY_CHARS = 6000;
const MAX_JEV = Number(process.env.MAX_JEV_PER_TICK) || 8;

export function stage1Questions(rows) {
  return buildQuestionMap(rows || independentSeedQuestions());
}

export function stage2Questions(region, rows) {
  return buildQuestionMap(rows || dependentSeedQuestions(), { region });
}

export function articleState(article) {
  const body = String(article.body_text || "").slice(0, BODY_CHARS);
  return {
    title: article.title || "",
    url: article.url || "",
    source: article.source_name || article.source || "",
    body,
  };
}

export function interpretGlobeAnswers(answers) {
  const about = Number(answers?.about_primary_country?.noul ?? 0);
  const region = answers?.region?.choice || "none";
  const regionConf = Number(answers?.region?.confidence ?? 0);
  const countryRaw = answers?.primary_country?.choice || "none";
  const countryConf = Number(answers?.primary_country?.confidence ?? 0);
  const sentimentRaw = answers?.country_sentiment?.choice || "not_applicable";
  const sentimentConf = Number(answers?.country_sentiment?.confidence ?? 0);

  const countryIso = countryRaw && countryRaw !== "none" ? String(countryRaw).toUpperCase() : null;
  const countryOk =
    about >= ABOUT_COUNTRY_MIN &&
    region !== "none" &&
    regionConf >= REGION_CONFIDENCE_MIN &&
    Boolean(countryIso) &&
    countryConf >= COUNTRY_CONFIDENCE_MIN;

  if (!countryOk) {
    return {
      country_iso: null,
      country_name: null,
      region: region === "none" ? null : region,
      sentiment: "none",
      confidence: Math.max(about, countryConf, regionConf),
      about_country: about,
      eligible: 0,
    };
  }

  let sentiment = "mixed";
  if (sentimentRaw === "positive" && sentimentConf >= SENTIMENT_CONFIDENCE_MIN) sentiment = "positive";
  else if (sentimentRaw === "negative" && sentimentConf >= SENTIMENT_CONFIDENCE_MIN) sentiment = "negative";
  else if (sentimentRaw === "not_applicable") sentiment = "mixed";

  return {
    country_iso: countryIso,
    country_name: countryName(countryIso),
    region,
    sentiment,
    confidence: Math.min(countryConf, sentimentConf || countryConf),
    about_country: about,
    eligible: 1,
  };
}

export function mockFilenameForArticle(article) {
  const text = `${article.title || ""} ${article.body_text || ""}`.toLowerCase();
  if (/\bukraine\b/.test(text)) return "globe-ukraine-negative.json";
  if (/\bjapan\b/.test(text)) return "globe-japan-positive.json";
  if (/\bcanada\b/.test(text)) return "globe-canada-mixed.json";
  return "globe-none.json";
}

function shouldRunStage2(answers) {
  const about = Number(answers?.about_primary_country?.noul ?? 0);
  const region = answers?.region?.choice || "none";
  const regionConf = Number(answers?.region?.confidence ?? 0);
  return about >= ABOUT_COUNTRY_MIN && region !== "none" && regionConf >= REGION_CONFIDENCE_MIN;
}

async function extraMockAnswers() {
  try {
    const extra = await loadMockAnswers("taxonomy-extra.json");
    return extra.answers || {};
  } catch {
    return {};
  }
}

export async function analyzeArticle(article, questionRows) {
  const rows = questionRows || [...independentSeedQuestions(), ...dependentSeedQuestions()];
  const { independent, dependent } = partitionQuestions(rows);
  const state = articleState(article);
  const asked = independent.concat(dependent).map((row) => row.question_id);
  if (!typesafeKey()) {
    const mock = await loadMockAnswers(mockFilenameForArticle(article));
    const extras = await extraMockAnswers();
    return {
      model: mock.model || JEV_MODEL,
      answers: mergeExtraAnswers(mock.answers, rows, extras),
      usage: mock.usage,
      mock: true,
      asked,
    };
  }
  const stage1QuestionsMap = stage1Questions(independent);
  if (!Object.keys(stage1QuestionsMap).length) {
    return {
      model: JEV_MODEL,
      answers: {},
      usage: { input_tokens: 0, output_tokens: 0 },
      mock: false,
      asked,
    };
  }
  const stage1 = await systemOne({
    state,
    model: JEV_MODEL,
    questions: stage1QuestionsMap,
  });
  let answers = { ...stage1.answers };
  let usage = { ...(stage1.usage || {}) };
  if (shouldRunStage2(stage1.answers)) {
    const region = stage1.answers.region.choice;
    const stage2Map = stage2Questions(region, dependent);
    if (Object.keys(stage2Map).length) {
      const stage2 = await systemOne({
        state,
        model: JEV_MODEL,
        questions: stage2Map,
      });
      answers = { ...answers, ...stage2.answers };
      usage = {
        input_tokens: (usage.input_tokens || 0) + (stage2.usage?.input_tokens || 0),
        output_tokens: (usage.output_tokens || 0) + (stage2.usage?.output_tokens || 0),
      };
    }
  }
  return {
    model: stage1.model || JEV_MODEL,
    answers,
    usage,
    mock: false,
    asked,
  };
}

export async function persistGlobeAnalysis(db, article, result) {
  const interpreted = interpretGlobeAnswers(result.answers);
  const ts = new Date().toISOString();
  const inputTokens = result.usage?.input_tokens ?? null;
  const asked = result.asked || Object.keys(result.answers || {});
  await db.run(
    `INSERT INTO jev_analyses (
      article_id, entity_key, claim_span, scope, taxonomy_version, model, answers, input_token_estimate, question_ids, created_at
    ) VALUES (?, ?, ?, 'article', ?, ?, ?, ?, ?, ?)
    ON CONFLICT (article_id, taxonomy_version, model) DO UPDATE SET
      answers = EXCLUDED.answers,
      input_token_estimate = EXCLUDED.input_token_estimate,
      question_ids = EXCLUDED.question_ids,
      created_at = EXCLUDED.created_at`,
    article.id,
    null,
    null,
    TAXONOMY_VERSION,
    result.model || JEV_MODEL,
    JSON.stringify(result.answers),
    inputTokens,
    JSON.stringify(asked),
    ts,
  );
  await db.run(
    `INSERT INTO article_geo_sentiment (
      article_id, country_iso, country_name, region, sentiment, confidence, about_country,
      eligible, taxonomy_version, model, analyzed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (article_id) DO UPDATE SET
      country_iso = EXCLUDED.country_iso,
      country_name = EXCLUDED.country_name,
      region = EXCLUDED.region,
      sentiment = EXCLUDED.sentiment,
      confidence = EXCLUDED.confidence,
      about_country = EXCLUDED.about_country,
      eligible = EXCLUDED.eligible,
      taxonomy_version = EXCLUDED.taxonomy_version,
      model = EXCLUDED.model,
      analyzed_at = EXCLUDED.analyzed_at`,
    article.id,
    interpreted.country_iso,
    interpreted.country_name,
    interpreted.region,
    interpreted.sentiment,
    interpreted.confidence,
    interpreted.about_country,
    interpreted.eligible,
    TAXONOMY_VERSION,
    result.model || JEV_MODEL,
    ts,
  );
  await db.run(
    `UPDATE articles SET jev_status = ?, updated_at = ? WHERE id = ?`,
    "done",
    ts,
    article.id,
  );
  return interpreted;
}

export async function jevGlobeTick(db, { limit } = {}) {
  const cap = limit ?? MAX_JEV;
  const questionRows = await listEnabledQuestions(db);
  if (!questionRows.length) {
    return { pending: 0, analyzed: 0, errors: 0, mock: !typesafeKey(), questions: 0 };
  }
  const pending = await db.all(
    `SELECT a.id, a.url, a.title, a.body_text, s.name AS source_name
     FROM articles a
     JOIN news_sources s ON s.id = a.source_id
     LEFT JOIN article_geo_sentiment g ON g.article_id = a.id
     WHERE g.article_id IS NULL
     ORDER BY a.id DESC
     LIMIT ?`,
    cap,
  );
  let analyzed = 0;
  let errors = 0;
  for (const article of pending) {
    try {
      const result = await analyzeArticle(article, questionRows);
      await persistGlobeAnalysis(db, article, result);
      analyzed += 1;
    } catch (err) {
      errors += 1;
      const ts = new Date().toISOString();
      await db.run(`UPDATE articles SET jev_status = ?, updated_at = ? WHERE id = ?`, "error", ts, article.id);
      console.error(`[jev-globe] article ${article.id} failed:`, err.message);
    }
  }
  return {
    pending: pending.length,
    analyzed,
    errors,
    mock: !typesafeKey(),
    questions: questionRows.length,
  };
}

export async function listGlobeCountries(db) {
  const rows = await db.all(
    `SELECT country_iso, country_name, sentiment, confidence, eligible
     FROM article_geo_sentiment
     WHERE eligible = 1 AND country_iso IS NOT NULL`,
  );
  return aggregateCountryTones(rows);
}

const isCli =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCli) {
  const { openDb } = await import("./db.js");
  const db = await openDb();
  try {
    const result = await jevGlobeTick(db);
    console.log("[jev-globe]", result);
  } finally {
    await db.close();
  }
}

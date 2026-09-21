import path from "node:path";
import { pathToFileURL } from "node:url";
import { countryName, countriesInRegion, regionCriteria } from "./countries.js";
import { loadMockAnswers, systemOne, typesafeKey } from "./jev-client.js";

export const TAXONOMY_VERSION = "rose-globe-2026-09-21";
export const JEV_MODEL = "jev-latest";
export const ABOUT_COUNTRY_MIN = 0.7;
export const COUNTRY_CONFIDENCE_MIN = 0.45;
export const REGION_CONFIDENCE_MIN = 0.35;
export const SENTIMENT_CONFIDENCE_MIN = 0.4;
const BODY_CHARS = 6000;
const MAX_JEV = Number(process.env.MAX_JEV_PER_TICK) || 8;

const ABOUT_INSTRUCTIONS = {
  question:
    "Is this article primarily about one sovereign country — its government, people, territory, economy, or policies as the main subject?",
  exclude:
    "Datelines, reporter location, bylines, and passing mentions of several countries do not count. International roundups with no single-country focus are no.",
  use: "Judge from `title` and `body`. Ignore `url` except as weak context.",
};

export function stage1Questions() {
  return {
    about_primary_country: {
      type: "noul",
      instructions: ABOUT_INSTRUCTIONS,
      criteria: {
        true: "One country is clearly the subject of the piece.",
        false: "No single country is the subject, or geography is only a dateline/bylines/roundup.",
      },
    },
    region: {
      type: "choice",
      instructions: {
        question:
          "If the article is mainly about one country, which world region is that country in? Choose `none` when there is no single-country subject.",
        exclude: "Do not pick a region from a dateline or correspondent location alone.",
      },
      criteria: regionCriteria(),
    },
    country_sentiment: {
      type: "choice",
      instructions: {
        question:
          "How does the article talk about that country as a whole (government, people, or prospects)?",
        note: "Judge tone toward the country, not toward one politician unless they stand in for the country. Use `not_applicable` if there is no primary country.",
      },
      criteria: {
        positive: "Net good: progress, success, praise, constructive or hopeful coverage of the country.",
        negative: "Net bad: crisis, failure, harm, condemnation, or bleak coverage of the country.",
        mixed: "Both good and bad in similar weight, or the tone is conflicted.",
        not_applicable: "No primary country, or the piece does not evaluate the country.",
      },
    },
  };
}

export function stage2Questions(region) {
  return {
    primary_country: {
      type: "choice",
      instructions: {
        question:
          "Which sovereign country is this article mainly about? Assume the country is in this region: `" +
          region +
          "`. Choose `none` if that is wrong or if the only geographic cues are a dateline, byline, or reporter location.",
      },
      criteria: countriesInRegion(region),
    },
  };
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

export async function analyzeArticle(article) {
  const state = articleState(article);
  if (!typesafeKey()) {
    const mock = await loadMockAnswers(mockFilenameForArticle(article));
    return {
      model: mock.model || JEV_MODEL,
      answers: mock.answers,
      usage: mock.usage,
      mock: true,
    };
  }
  const stage1 = await systemOne({
    state,
    model: JEV_MODEL,
    questions: stage1Questions(),
  });
  let answers = { ...stage1.answers };
  let usage = { ...(stage1.usage || {}) };
  if (shouldRunStage2(stage1.answers)) {
    const region = stage1.answers.region.choice;
    const stage2 = await systemOne({
      state,
      model: JEV_MODEL,
      questions: stage2Questions(region),
    });
    answers = { ...answers, ...stage2.answers };
    usage = {
      input_tokens: (usage.input_tokens || 0) + (stage2.usage?.input_tokens || 0),
      output_tokens: (usage.output_tokens || 0) + (stage2.usage?.output_tokens || 0),
    };
  }
  return {
    model: stage1.model || JEV_MODEL,
    answers,
    usage,
    mock: false,
  };
}

export async function persistGlobeAnalysis(api, article, result) {
  const interpreted = interpretGlobeAnswers(result.answers);
  const inputTokens = result.usage?.input_tokens ?? null;
  await api.upsertJevAnalysis({
    article_id: article.id,
    entity_key: null,
    claim_span: null,
    scope: "article",
    taxonomy_version: TAXONOMY_VERSION,
    model: result.model || JEV_MODEL,
    answers: result.answers,
    input_token_estimate: inputTokens,
  });
  await api.upsertGeoSentiment({
    article_id: article.id,
    country_iso: interpreted.country_iso,
    country_name: interpreted.country_name,
    region: interpreted.region,
    sentiment: interpreted.sentiment,
    confidence: interpreted.confidence,
    about_country: interpreted.about_country,
    eligible: interpreted.eligible,
    taxonomy_version: TAXONOMY_VERSION,
    model: result.model || JEV_MODEL,
  });
  await api.setJevStatus(article.id, "done");
  return interpreted;
}

export async function jevGlobeTick(api, { limit } = {}) {
  const cap = limit ?? MAX_JEV;
  const pending = await api.pendingGeo(cap);
  let analyzed = 0;
  let errors = 0;
  for (const article of pending) {
    try {
      const result = await analyzeArticle(article);
      await persistGlobeAnalysis(api, article, result);
      analyzed += 1;
    } catch (err) {
      errors += 1;
      await api.setJevStatus(article.id, "error");
      console.error(`[jev-globe] article ${article.id} failed:`, err.message);
    }
  }
  return { pending: pending.length, analyzed, errors, mock: !typesafeKey() };
}

export async function listGlobeCountries(api) {
  return api.globe();
}

const isCli =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCli) {
  const { openBackend } = await import("./backend.js");
  const api = await openBackend();
  try {
    const result = await jevGlobeTick(api);
    console.log("[jev-globe]", result);
  } finally {
    await api.close();
  }
}

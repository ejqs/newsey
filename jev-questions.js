import { countriesInRegion, regionCriteria } from "./countries.js";

/** Analysis run id — globe denormalization still keys off this version. */
export const TAXONOMY_VERSION = "rose-globe-2026-09-21";

export const QUESTION_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
export const QUESTION_TYPES = new Set(["choice", "score", "noul"]);

const ABOUT_INSTRUCTIONS = {
  question:
    "Is this article primarily about one sovereign country — its government, people, territory, economy, or policies as the main subject?",
  exclude:
    "Datelines, reporter location, bylines, and passing mentions of several countries do not count. International roundups with no single-country focus are no.",
  use: "Judge from `title` and `body`. Ignore `url` except as weak context.",
};

/**
 * Opinionated starter taxonomy as data. Boot inserts with ON CONFLICT DO NOTHING
 * so operator edits in jev_questions are not overwritten. Globe IDs stay the
 * shipped country+sentiment questions (rose-globe-2026-09-21).
 */
export const SEED_QUESTIONS = [
  {
    question_id: "about_primary_country",
    type: "noul",
    instructions: ABOUT_INSTRUCTIONS,
    criteria: {
      true: "One country is clearly the subject of the piece.",
      false: "No single country is the subject, or geography is only a dateline/bylines/roundup.",
    },
    criteria_source: null,
    depends_on: null,
    enabled: 1,
    sort_order: 10,
    notes: "Globe: is one sovereign country the subject?",
  },
  {
    question_id: "region",
    type: "choice",
    instructions: {
      question:
        "If the article is mainly about one country, which world region is that country in? Choose `none` when there is no single-country subject.",
      exclude: "Do not pick a region from a dateline or correspondent location alone.",
    },
    criteria: regionCriteria(),
    criteria_source: null,
    depends_on: null,
    enabled: 1,
    sort_order: 20,
    notes: "Globe: world region for the primary country.",
  },
  {
    question_id: "country_sentiment",
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
    criteria_source: null,
    depends_on: null,
    enabled: 1,
    sort_order: 30,
    notes: "Globe: good / bad / mixed tone toward that country.",
  },
  {
    question_id: "primary_country",
    type: "choice",
    instructions: {
      question:
        "Which sovereign country is this article mainly about? Assume the country is in this region: `{region}`. Choose `none` if that is wrong or if the only geographic cues are a dateline, byline, or reporter location.",
    },
    criteria: null,
    criteria_source: "countries_in_region",
    depends_on: "region",
    enabled: 1,
    sort_order: 40,
    notes: "Globe: ISO country. Criteria filled at runtime from the region answer (Choice max 255).",
  },
  {
    question_id: "worth_hopping_into",
    type: "noul",
    instructions: {
      question:
        "Is this article worth hopping into for a reader who wants a substantive news story rather than a brief, wire blurb, or filler?",
      use: "Judge from `title` and `body`.",
    },
    criteria: {
      true: "Worth opening: enough substance, stakes, or new information to read through.",
      false: "Skip: too thin, duplicative, promotional, or not worth the click.",
    },
    criteria_source: null,
    depends_on: null,
    enabled: 1,
    sort_order: 50,
    notes: "Whether a reader should hop into the piece.",
  },
  {
    question_id: "article_kind",
    type: "choice",
    instructions: "What kind of news article is this, based on `title` and `body`?",
    criteria: {
      breaking: "A new event being reported as it happens or just happened.",
      analysis: "Explains meaning, causes, or implications of events.",
      opinion: "Argument, editorial, or clearly labeled commentary.",
      profile: "Focuses on a person, organization, or place as the subject.",
      explainer: "Background or how-something-works for a general reader.",
      press_release: "Reads like an official announcement or handout.",
      other: "Does not fit the other kinds.",
    },
    criteria_source: null,
    depends_on: null,
    enabled: 1,
    sort_order: 60,
    notes: "Article metadata: form of the piece.",
  },
  {
    question_id: "primary_topic",
    type: "choice",
    instructions: "What is the primary topic of this article in `title` and `body`?",
    criteria: {
      politics: "Government, parties, or public policy not mainly an election.",
      elections: "Campaigns, votes, or electoral process.",
      economy: "Macro economy, markets, trade, or labor as the main subject.",
      business: "A company, industry, or corporate story.",
      tech: "Technology, computing, or platforms.",
      science: "Research or scientific findings.",
      health: "Medicine, public health, or disease.",
      climate: "Climate, environment, or extreme weather as the main subject.",
      war_conflict: "War, armed conflict, or military action.",
      crime_law: "Crime, courts, or legal process.",
      culture: "Arts, media, religion, or society.",
      sports: "Sporting events or athletes.",
      other: "Does not fit the other topics.",
    },
    criteria_source: null,
    depends_on: null,
    enabled: 1,
    sort_order: 70,
    notes: "Article metadata: primary topic.",
  },
];

export function parseJsonField(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function parseInstructions(raw) {
  if (raw == null) return "";
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw;
}

function interpolateRegion(value, region) {
  if (region == null || region === "") return value;
  const token = String(region);
  if (typeof value === "string") return value.replaceAll("{region}", token);
  if (Array.isArray(value)) return value.map((item) => interpolateRegion(item, token));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolateRegion(item, token)]),
    );
  }
  return value;
}

function asEnabled(row) {
  return Number(row?.enabled) !== 0;
}

export function partitionQuestions(rows) {
  const enabled = (rows || []).filter(asEnabled);
  return {
    independent: enabled.filter((row) => !row.depends_on),
    dependent: enabled.filter((row) => row.depends_on),
  };
}

export function independentSeedQuestions() {
  return partitionQuestions(SEED_QUESTIONS).independent;
}

export function dependentSeedQuestions() {
  return partitionQuestions(SEED_QUESTIONS).dependent;
}

/**
 * Map a jev_questions row to a TypeSafe System One question (api.md).
 * Only `type`, `instructions`, and `criteria` are sent.
 */
export function toSystemOneQuestion(row, { region } = {}) {
  const id = row?.question_id;
  if (!id || !QUESTION_ID_RE.test(id)) {
    throw new Error(`invalid question_id ${id}`);
  }
  const type = String(row.type || "").toLowerCase();
  if (!QUESTION_TYPES.has(type)) {
    throw new Error(`${id}: type must be choice, score, or noul`);
  }
  let instructions = interpolateRegion(parseInstructions(row.instructions), region);
  if (instructions == null || instructions === "") {
    throw new Error(`${id}: instructions required`);
  }
  let criteria = parseJsonField(row.criteria, undefined);
  if (row.criteria_source === "countries_in_region") {
    criteria = countriesInRegion(region || "none");
  }
  const question = { type, instructions };
  if (type === "noul") {
    if (criteria && typeof criteria === "object" && !Array.isArray(criteria)) {
      question.criteria = criteria;
    }
    return question;
  }
  if (type === "choice") {
    if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) {
      throw new Error(`${id}: choice criteria must be an object of options`);
    }
    const keys = Object.keys(criteria);
    if (keys.length < 1 || keys.length > 255) {
      throw new Error(`${id}: choice needs 1–255 options`);
    }
    question.criteria = criteria;
    return question;
  }
  if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10) {
    throw new Error(`${id}: score criteria must be an array of 2–10 levels`);
  }
  question.criteria = criteria;
  return question;
}

export function buildQuestionMap(rows, ctx = {}) {
  const questions = {};
  for (const row of rows || []) {
    try {
      questions[row.question_id] = toSystemOneQuestion(row, ctx);
    } catch (err) {
      console.error(`[jev-questions] skip ${row.question_id}:`, err.message);
    }
  }
  return questions;
}

/** TypeSafe answer shape when a mock fixture has no entry for a question. */
export function stubAnswer(row) {
  const type = String(row.type || "").toLowerCase();
  if (type === "noul") return { type: "noul", noul: 0.5 };
  if (type === "choice") {
    let criteria = parseJsonField(row.criteria, {});
    if (row.criteria_source === "countries_in_region") {
      criteria = { none: "No single country in this region is the subject." };
    }
    const keys = Object.keys(criteria || {});
    const first = keys[0] || "other";
    const probabilities = Object.fromEntries(keys.map((key) => [key, key === first ? 1 : 0]));
    if (!keys.length) probabilities[first] = 1;
    return { type: "choice", choice: first, probabilities, confidence: 0.2 };
  }
  const levels = parseJsonField(row.criteria, ["Low", "High"]);
  const list = Array.isArray(levels) && levels.length >= 2 ? levels : ["Low", "High"];
  const mid = Math.round((list.length - 1) / 2);
  const legend = Object.fromEntries(list.map((label, i) => [String(i), label]));
  const probabilities = Object.fromEntries(list.map((_, i) => [String(i), i === mid ? 1 : 0]));
  return { type: "score", score: mid, legend, probabilities, confidence: 0.2 };
}

export function mergeExtraAnswers(answers, rows, extraAnswers = {}) {
  const out = { ...(answers || {}) };
  for (const row of rows || []) {
    const id = row.question_id;
    if (!id || out[id]) continue;
    if (extraAnswers[id]) {
      out[id] = extraAnswers[id];
      continue;
    }
    out[id] = stubAnswer(row);
  }
  return out;
}

export async function listEnabledQuestions(db) {
  return db.all(
    `SELECT question_id, type, instructions, criteria, criteria_source, depends_on,
            enabled, sort_order, notes
     FROM jev_questions
     WHERE enabled = 1
     ORDER BY sort_order ASC, id ASC`,
  );
}

export async function seedJevQuestions(db) {
  const t = new Date().toISOString();
  for (const q of SEED_QUESTIONS) {
    await db.run(
      `INSERT INTO jev_questions (
        question_id, type, instructions, criteria, criteria_source, depends_on,
        enabled, sort_order, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (question_id) DO NOTHING`,
      q.question_id,
      q.type,
      typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions),
      q.criteria == null ? null : JSON.stringify(q.criteria),
      q.criteria_source || null,
      q.depends_on || null,
      q.enabled ?? 1,
      q.sort_order ?? 0,
      q.notes || null,
      t,
      t,
    );
  }
}

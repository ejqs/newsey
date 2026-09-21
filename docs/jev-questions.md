# Extendible Jev questions

**Updated:** 2026-09-21  
**Taxonomy run id:** `rose-globe-2026-09-21` (same as the shipped globe pass)

Jev questions are **rows in `jev_questions`**, not hardcoded TypeSafe payloads. Operators add, edit, or disable Choice / Score / Noul questions in rose-web-admin without a bot deploy. The next scrape tick loads **enabled** rows and fans them into one `POST /v1/systemone` call (plus the existing country stage-2 when needed).

Country + sentiment is not a special pipeline anymore: those four globe questions are seeded rows. Globe coloring still reads `article_geo_sentiment`, which is still written from the same answer keys.

## How a new question gets asked

1. Add (or enable) a row on `jev_questions` — admin **Questions** (`/questions`), or SQL.
2. Wait for the next scrape tick (or `npm run jev-once`).
3. rose-bot selects articles with **no** `article_geo_sentiment` row (new scrapes; analysis can lag).
4. It `SELECT`s `enabled = 1` questions, ordered by `sort_order`.
5. Independent questions go in **one** System One request with state `{ title, url, source, body }`.
6. If `primary_country` is still enabled and the globe country gates pass, a **second** request fills that Choice from the region (255-option limit). Other `depends_on` questions ride that stage.
7. Raw answers are stored on `jev_analyses.answers` (plus `question_ids`). Globe denormalization is unchanged.

Existing analyzed articles are **not** re-asked. New questions apply to newly scraped articles.

Disable a row (`enabled = 0`) to stop sending it. Boot seed uses `ON CONFLICT (question_id) DO NOTHING`, so operator edits are not overwritten.

## How to add a question

In **rose-web-admin** → Questions:

| Field | What |
| --- | --- |
| `question_id` | Code key, `[a-z][a-z0-9_]{0,63}`. Not sent to the model — put the full meaning in instructions. |
| `type` | `choice` · `score` · `noul` (TypeSafe primitives) |
| `instructions` | Plain string, or JSON object/array. Reference state with backticked paths (`title`, `body`). |
| `criteria` | JSON. Choice: `{ "option": "rubric", ... }` (1–255). Score: `["level0", "level1", ...]` (2–10). Noul: optional `{ "true": "...", "false": "..." }`. |
| `enabled` | Unchecked = skip on the next scrape. |
| `sort_order` | Display / stable order. |
| `depends_on` / `criteria_source` | Leave blank unless you need a follow-up. Globe `primary_country` uses `depends_on=region` and `criteria_source=countries_in_region`. |

Live Jev needs `TYPESAFE_API_KEY`. Empty key → do not call the API; merge `fixtures/jev-mock/globe-*.json` with `taxonomy-extra.json`. Unknown extra questions get a stub of the same answer **shape** (Noul / Choice / Score) so the persist path still works.

## Seeded questions

| ID | Type | Role |
| --- | --- | --- |
| `about_primary_country` | Noul | Globe: one country is the subject |
| `region` | Choice | Globe: world region |
| `country_sentiment` | Choice | Globe: positive / negative / mixed / not_applicable |
| `primary_country` | Choice | Globe: ISO in that region (stage 2) |
| `worth_hopping_into` | Noul | Worth opening as a substantive story |
| `article_kind` | Choice | Metadata: breaking / analysis / opinion / … |
| `primary_topic` | Choice | Metadata: politics / elections / war_conflict / … |

Taxonomy stays **opinionated**: labels are ours, edited deliberately. Extending the table is how new judgments land; do not invent labels at scrape time with a chat model.

## Tables

`jev_questions` — bot-owned, created on rose-bot boot. Admin reads/writes the same Postgres.

`jev_analyses` — additive `question_ids` JSON array of keys asked on that run. `answers` still holds the System One map. Globe `article_geo_sentiment` is unchanged.

See also: [`globe-country-sentiment.md`](./globe-country-sentiment.md), [`jev-skill.md`](./jev-skill.md).

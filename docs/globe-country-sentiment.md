# Globe: country + sentiment (Jev)

**Updated:** 2026-09-21  
**Taxonomy:** `rose-globe-2026-09-21`  
**Public UI:** [rose-web-public](https://github.com/ejqs/rose-web-public) (`react-globe.gl`)

Additive Jev pass. Scrapers still gather articles; this job does not change crawl, robots, or admin API-key UI.

## When it runs

After each scrape tick (and via `npm run jev-once`), rose-bot selects `articles` that have **no** `article_geo_sentiment` row, up to `MAX_JEV_PER_TICK` (default 8). Existing `jev_status=skipped` rows are eligible — the scrape INSERT is unchanged.

1. Build TypeSafe **state** `{ title, url, source, body }` (`body` truncated to 6k chars).
2. Call **Jev** (`POST /v1/systemone`, model `jev-latest`) with **enabled** `jev_questions` rows (country+sentiment plus hop-in and metadata; see [`jev-questions.md`](./jev-questions.md)).
3. Persist raw answers on `jev_analyses` and a denormalized row on `article_geo_sentiment`.
4. Set `articles.jev_status` to `done` (or `error` on failure).

If `TYPESAFE_API_KEY` is empty, **do not** call the hosted API. Load `fixtures/jev-mock/globe-*.json` (same Choice/Noul answer shape as the [HTTP API](https://docs.typesafe.ai/api.md)). Keyword match: Ukraine → negative fixture, Japan → positive, Canada → mixed, otherwise `globe-none.json`.

## Jev questions (conservative country)

These four IDs are **seeded `jev_questions` rows**, not the only taxonomy. Operators can add hop-in and metadata questions without a deploy ([`jev-questions.md`](./jev-questions.md)). Fan-out still uses **two** requests so the country Choice stays well under 255 options. Stage 2 is skipped when stage 1 says there is no country.

| ID | Type | Stage | Criteria |
| --- | --- | --- | --- |
| `about_primary_country` | Noul | 1 | Yes = one sovereign country is the **subject**. Datelines, bylines, reporter location, and multi-country roundups are no. |
| `region` | Choice | 1 | `africa` · `americas` · `asia` · `europe` · `oceania` · `none` |
| `country_sentiment` | Choice | 1 | `positive` · `negative` · `mixed` · `not_applicable` (tone **toward that country**, not a lone politician unless they stand in for the country) |
| `primary_country` | Choice | 2 | ISO 3166-1 alpha-2 codes in that region + `none` |

## Gates (code, not the model)

Plot an article only when **all** hold:

- `about_primary_country.noul >= 0.7`
- `region != none` and region confidence `>= 0.35`
- `primary_country != none` and country confidence `>= 0.45`

Otherwise `eligible=0` (stored so we do not re-ask). Sentiment `positive`/`negative` also need confidence `>= 0.4`; otherwise the plotted tone is **mixed**.

## Colors (public globe)

Aggregated in `globe-aggregate.js` (same formula as rose-web-public `lib/globe-tone.ts`).

Per country, over eligible rows:

- `net` = Σ (+confidence if positive, −confidence if negative, 0 if mixed)
- **Green** if `net > 0.35`
- **Red** if `net < -0.35`
- **Blue** otherwise (mixed, weak, or not enough signal)
- **Strength** (opacity / polygon height) = `(article_count / max_count) * (0.35 + 0.65 * mean_confidence)`, clamped 0.22–1. Globe fill α is `0.55 + 0.4 * strength` in `rgba(46,196,92)` / `rgba(220,50,50)` / `rgba(56,120,220)`.

## Tables (bot-owned)

`jev_analyses` — raw System One `answers` JSON, `taxonomy_version=rose-globe-2026-09-21`, `scope=article`. Additive `question_ids` lists which `jev_questions` were sent.

`article_geo_sentiment` — one row per article: `country_iso`, `sentiment`, `confidence`, `eligible`.

`jev_questions` — Choice / Score / Noul definitions loaded each tick. Globe IDs stay seeded. [`jev-questions.md`](./jev-questions.md).

`CREATE TABLE IF NOT EXISTS` on boot. No change to `news_sources` / `url_ledger` / article scrape columns.

## Ops

| | |
| --- | --- |
| `GET /globe` | Aggregated country tones |
| `GET /health` | includes `globe` = eligible country rows |
| `npm run jev-once` | Drain pending analyses |
| `npm run seed-globe-sample` | Insert six `example.invalid` articles and run the mock path (local/dev only) |
| `npm test` | Question shape, fixtures, gates, colors |

Local Postgres: `ssl` is off when `DATABASE_URL` is localhost (Railway still uses TLS).

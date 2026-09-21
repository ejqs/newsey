# Rose pipeline: scrape → Jev structure → profiles

**Product:** [Rose](./project-context.md) — Recursive Opinionated Search Engine  
**Audience:** Earlan  
**Status:** Mini scrape is live on Railway **rose**. Production DB is **Postgres**. **Jev questions are data** (`jev_questions`); globe country+sentiment is the seeded first slice plus hop-in and article metadata. Optional ethical crawler is in rose-bot and **off by default**.  
**Updated:** 2026-09-21

## Product loop

1. **Paced cron** scrapes a **small batch** of news URLs from registered sources (long-term completeness, not all at once).  
2. Store successfully scraped **articles**.  
3. Extract entity/claim candidates.  
4. **Jev** (opinionated taxonomy) writes **structured analyses** keyed to articles (and entities).  
5. Upsert / grow **entity profiles** over time; budgeted recursive deepen fills gaps.  
6. **Later:** user NL search → LLM plans queries against this DB (not live-crawl-first).

Jev does not fetch or write articles. Scrapers gather; Jev condenses; the DB is the product substrate.

---

## v0 database schema

Three tables Earlan locked. **Postgres** on Railway (bot, public, and admin). No SQLite.

### 1. `news_sources`

Registry of places we intend to scrape, plus **whether scraping still works**.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | PK | |
| `name` | text | Human label |
| `base_url` | text | Site or section root |
| `feed_url` | text null | RSS/Atom if any |
| `scrape_method` | text | e.g. `rss` · `html_list` · `sitemap` · `api` |
| `status` | enum | See **`source.status`** below |
| `robots_checked_at` | timestamptz null | Last robots.txt fetch |
| `robots_ttl_until` | timestamptz null | Re-check after this |
| `crawl_delay_seconds` | int null | From robots or our floor |
| `last_success_at` | timestamptz null | |
| `last_attempt_at` | timestamptz null | |
| `last_error` | text null | Short diagnostic |
| `priority` | int | Higher = more often eligible |
| `next_eligible_at` | timestamptz | Pacing: do not pick before this |
| `articles_scraped_count` | int | Running total |
| `created_at` / `updated_at` | timestamptz | |

#### `source.status` enum (starter)

| Status | Meaning | Cron behavior |
| --- | --- | --- |
| `ok` | Healthy; scrapes succeeding | Eligible for batch pick |
| `paused` | Manually paused | Never pick until unpaused |
| `robots_disallow` | robots.txt forbids our paths/UA | Never scrape; re-check robots on TTL |
| `blocked` | HTTP 401/403/429 / soft / CAPTCHA pattern | Back off; retry later with longer `next_eligible_at` |
| `broken` | Parse/selector failure or persistent 5xx | Alert; low-frequency retry or human fix |
| `unknown` | Not yet successfully scraped | Eligible once; promote to `ok` or failure status |

### 2. `articles`

Only rows for **successfully scraped** article content (failed fetches do not create article rows; they update source status / logs).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | PK | |
| `source_id` | FK → `news_sources` | |
| `url` | text unique | Canonical article URL |
| `title` | text | |
| `body_text` | text | Normalized plain text |
| `published_at` | timestamptz null | From feed/page if known |
| `scraped_at` | timestamptz | |
| `content_hash` | text | Dedupe / change detect |
| `lang` | text null | Optional |
| `raw_metadata` | json null | Author, section, etc. |
| `jev_status` | enum | `pending` · `done` · `skipped` · `error` |
| `created_at` / `updated_at` | timestamptz | |

### 3. `jev_analyses`

Structured Jev judgments. One row per **(subject, taxonomy_version, model)** analysis run — subject is usually an article; entity-scoped rows attach via nullable FKs.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | PK | |
| `article_id` | FK → `articles` | Always set for article-driven runs |
| `entity_key` | text null | Normalized mention / future entity id when entity-scoped |
| `claim_span` | text null | Optional claim text when claim-scoped |
| `scope` | enum | `article` · `entity_in_article` · `claim_in_article` · `deepen` |
| `taxonomy_version` | text | e.g. `rose-tax-2026-09-20` |
| `model` | text | Pinned Jev model id |
| `answers` | json | Map question_id → { type, choice/score/noul, probabilities, confidence } |
| `question_ids` | json null | Keys asked on this run (enabled `jev_questions`) |
| `input_token_estimate` | int null | |
| `created_at` | timestamptz | |

**Attachment rules**

- Article-level taxonomy (section A) → `scope=article`, `entity_key` null.  
- Entity-in-article (B) → `scope=entity_in_article`, same `article_id`, `entity_key` set.  
- Claim (C) → `scope=claim_in_article`, `claim_span` set.  
- Deepen decisions (D) → `scope=deepen`, usually after a fetch tied to an entity.

Later entity-profile tables can aggregate from `jev_analyses`; v0 can derive profiles with queries/views.

### 4. `article_geo_sentiment`

Denormalized globe row, one per article. Written by the additive Jev country+sentiment pass ([`globe-country-sentiment.md`](./globe-country-sentiment.md)). Not used by the scraper.

| Column | Type | Notes |
| --- | --- | --- |
| `article_id` | PK → `articles` | |
| `country_iso` | text null | ISO 3166-1 alpha-2 when eligible |
| `sentiment` | text | `positive` · `negative` · `mixed` · `none` |
| `eligible` | int | `1` = plot on the globe |
| `confidence` / `about_country` | float | From Jev |
| `taxonomy_version` / `model` / `analyzed_at` | text | |

### 5. `jev_questions`

Operator-editable TypeSafe questions. Loaded each Jev tick. Seeded on bot boot (`ON CONFLICT DO NOTHING`). Details: [`jev-questions.md`](./jev-questions.md).

| Column | Type | Notes |
| --- | --- | --- |
| `question_id` | text unique | System One map key |
| `type` | text | `choice` · `score` · `noul` |
| `instructions` | json | String or structured object |
| `criteria` | json null | Choice map, Score levels, optional Noul true/false |
| `depends_on` | text null | Follow-up after another answer (`region` for `primary_country`) |
| `criteria_source` | text null | `countries_in_region` fills ISO options at runtime |
| `enabled` | int | `0` = skip on the next scrape |

---

## Crawl policy: slow completeness

**Intent:** eventually scrape everything we care about; **each cron tick does a little**.

### Daily (or hourly) cron batch picker

1. Refresh robots for sources whose `robots_ttl_until` expired (or never checked).  
2. Set / keep `robots_disallow` when our UA+paths are forbidden; never enqueue those URLs.  
3. Select a **small set of sources** where:
   - `status IN ('ok', 'unknown')`
   - `next_eligible_at <= now()`
   - order by `priority DESC`, then oldest `last_success_at` / never-scraped first (fairness)  
4. Cap hard, e.g. **`max_sources_per_run = 3–10`**, **`max_article_fetches_per_run = 20–50`**, **`max_jev_articles_per_run = 20–50`**.  
5. Per source: discover a few new article URLs (feed items or list page), skip URLs already in `articles`, fetch only up to remaining budget.  
6. On success: insert `articles`, bump `last_success_at`, set `status=ok`, schedule `next_eligible_at = now() + max(crawl_delay, source_spacing)`.  
7. On failure: update `status` (`blocked` / `broken`), store `last_error`, exponential-ish backoff on `next_eligible_at`.  
8. Jev pass: pick `articles` with no `article_geo_sentiment` row (analysis can lag scrape). Load enabled `jev_questions`, write `jev_analyses` + `article_geo_sentiment`, set `jev_status=done`. See [`globe-country-sentiment.md`](./globe-country-sentiment.md) and [`jev-questions.md`](./jev-questions.md).

**Long-term completeness** = many small runs + fairness rotation across `news_sources`, not one giant crawl. New sources start `unknown` and trickle in.

Suggested spacing defaults (tunable):

| Knob | Starter default |
| --- | --- |
| Sources touched per run | 5 |
| Article fetches per run | 30 |
| Min gap between runs on same source | 6–24 h (plus robots `Crawl-delay`) |
| Robots re-check TTL | 24 h |
| Jev backlog drain per run | 30 articles |

---

## robots.txt handling

Mandatory before any HTML/list/article fetch for a host:

1. `GET https://{host}/robots.txt` (cache until `robots_ttl_until`).  
2. Parse Allow/Disallow for Rose’s user-agent (and `*` fallback).  
3. If target path disallowed → do not fetch; if the source’s primary method is fully disallowed → `status=robots_disallow`.  
4. Honor `Crawl-delay` when present; otherwise use Rose’s floor (e.g. 1–2 s between requests to same host).  
5. Sitemap URLs only if allowed; still pace sitemap expansion across days.  
6. Re-check on TTL or after repeated blocks (site policy may change).

RSS/API endpoints: still check robots for the host; if the feed URL is disallowed, mark `robots_disallow` and stop. Prefer licensed APIs when robots blocks scraping.

---

## Recursive crawler (optional, off by default)

Operator guide: [`crawler.md`](./crawler.md).

Extra tables (created by rose-bot): `bot_settings`, `host_robots`, `crawl_frontier`. Scraped bodies still go to `articles` + `url_ledger`. Credibility is an allowlist (known newsrooms + `news_sources` + `CRAWL_NEWS_DOMAINS`), not “any URL with article markup.” robots.txt is not optional: unread/forbidden robots.txt means do not fetch that host.

---

## End-to-end architecture

```
news_sources (status, next_eligible_at)
        │  cron: pick small batch + robots check
        ▼
   fetch article URLs (budgeted)
        ▼
   articles (successful scrapes only)
        ▼
   extract mentions
        ▼
   Jev (opinionated taxonomy)
        ▼
   jev_analyses ──► (later) entity profiles / query LLM
```

| Layer | Responsibility |
| --- | --- |
| **Scrapers** | robots-aware, paced fetches; update `news_sources.status` |
| **Extractors** | Candidate spans only |
| **Jev** | Structured answers into `jev_analyses` from enabled `jev_questions` |
| **DB** | `news_sources` · `articles` · `jev_analyses` · `jev_questions` · `article_geo_sentiment` (+ profiles later) |
| **Query LLM (later)** | NL → queries over structured rows |

---

## Opinionated Jev taxonomy (starter — edit as data)

Labels are **ours**. Do not invent runtime category strings via a chat model. Live questions live in **`jev_questions`** ([`jev-questions.md`](./jev-questions.md)). Seeded now: globe country+sentiment, `worth_hopping_into`, `article_kind`, `primary_topic`. Add the rest below from admin when you want them — no bot deploy.

### A. Article-level

| Question ID | Type | Criteria |
| --- | --- | --- |
| `article_kind` | Choice | `breaking` · `analysis` · `opinion` · `profile` · `explainer` · `press_release` · `other` |
| `primary_topic` | Choice | `politics` · `elections` · `economy` · `business` · `tech` · `science` · `health` · `climate` · `war_conflict` · `crime_law` · `culture` · `sports` · `other` |
| `geo_scope` | Choice | `local` · `national` · `international` · `unclear` |
| `time_orientation` | Choice | `past_event` · `ongoing` · `upcoming` · `timeless` |
| `newsworthiness` | Score | 1 skip → 5 historic |
| `source_quality` | Score | 1 unreliable → 5 primary/official |
| `keep_article` | Noul | Worth keeping for profiles? |

### B. Entity-in-article

| Question ID | Type | Criteria |
| --- | --- | --- |
| `entity_type` | Choice | `person` · `org` · `place` · `event` · `product` · `legislation` · `other` |
| `role_in_story` | Choice | `primary_actor` · `secondary` · `mentioned` · `source_quoted` · `affected` · `antagonist` · `other` |
| `centrality` | Score | 1 tangential → 5 subject-of-piece |
| `profile_worthy` | Noul | Maintain a durable profile? |
| `needs_disambiguation` | Noul | Ambiguous name? |

### C. Claim-in-article

| Question ID | Type | Criteria |
| --- | --- | --- |
| `claim_topic` | Choice | same as `primary_topic` |
| `modality` | Choice | `asserted` · `alleged` · `denied` · `hypothetical` · `forward_looking` |
| `supported_in_text` | Noul | Article discusses this claim? |
| `controversy` | Score | 1 settled → 5 core controversy |
| `attach_to_profiles` | Noul | Link into profiles? |

### D. Recursion / deepen

| Question ID | Type | Criteria |
| --- | --- | --- |
| `deepen_entity` | Noul | Fetch more for this profile? |
| `facet` | Choice | `bio_basics` · `timeline` · `recent_coverage` · `positions_stances` · `relationships` · `legal_filings` · `financials` · `local_angle` · `primary_sources` · `other` |
| `profile_gap` | Choice | `identity` · `recent_actions` · `relationships` · `stances` · `timeline` · `none` |
| `stop_entity_branch` | Noul | Diminishing returns? |
| `enough_for_today` | Noul | Stop deepen this cron tick? |

---

## Entity profiles (derived later)

Not a locked v0 table, but the accumulation target: aggregate `jev_analyses` + `articles` into canonical entities (aliases, topics, claims, facets). Recursive deepen still budgeted inside the same daily fetch caps.

---

## Query layer (later)

Example: “Presidential Elections 2028” → LLM maps to filters on `jev_analyses.answers` / topics / entities → return citations from `articles`. No live scrape as the main path.

---

## Recommended first slice

| Step | Deliverable |
| --- | --- |
| 1 | Create three tables; seed 2–5 `news_sources` |
| 2 | robots check + paced fetch → insert `articles` |
| 3 | Jev on pending articles → insert `jev_analyses` |
| 4 | CLI: list sources by status; list articles; show one analysis JSON |
| 5 | Optional: one deepen hop still inside fetch budget |

**Success:** after several cron ticks, sources rotate, article count grows gradually, analyses attach, and `robots_disallow` / `blocked` sources are skipped.

---

## Open choices for Earlan

1. **DB engine** for v0?  
2. **Seed source list**?  
3. Batch size defaults OK (5 sources / 30 fetches)?  
4. Start coding?

---

## References

- [Project context](./project-context.md)  
- [TypeSafe — System One & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)  
- [Jev API how-to](https://www.jevtypesafeai.com/how-to-use)  
- [Jev + AI SDK](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk)  

# Rose — project context

**Product:** **Rose** — Recursive Opinionated Search Engine  
**Owner:** Earlan  
**Status:** rose-bot is live on Railway **rose**. **rose-web-public** and **rose-web-admin** are separate repos. **Globe Jev** (country + sentiment) runs after each scrape tick when `TYPESAFE_API_KEY` is set; otherwise mock fixtures. Full article taxonomy is still later. GitHub: [`ejqs/newsey`](https://github.com/ejqs/newsey) (bot), [`ejqs/rose-web-public`](https://github.com/ejqs/rose-web-public), [`ejqs/rose-web-admin`](https://github.com/ejqs/rose-web-admin).  
**Updated:** 2026-09-21  
**Canonical repo:** https://github.com/ejqs/newsey (`main` `6449d05`)  
**Live:** https://rose-production-ac15.up.railway.app  
**PRs:** [#1](https://github.com/ejqs/newsey/pull/1) hosting docs, [#2](https://github.com/ejqs/newsey/pull/2) scrape service — both merged.

## One-line definition

Rose scrapes news **over the long term** (paced, robots-respecting), uses **Jev** (TypeSafe System One) with a **fixed, premeditated taxonomy** to turn unstructured articles into **structured records**, accumulates **entity profiles**, then later answers user questions by querying that structured store (an LLM chooses *what* to query — not live-crawl as the main path).

## Goals

1. **Ingest broadly but slowly** — eventually cover sources thoroughly; never blast everything in one run.
2. **Structure relentlessly** — every scraped article is reduced into opinionated, typed fields via Jev.
3. **Profiles accumulate** — for every entity seen, build/update a durable profile over time (recursive deepen fills profiles).
4. **Search the structure** — users ask things like “Presidential Elections 2028”; an LLM plans queries against the DB Rose already built.

## Non-goals (for now)

- Chatty article rewriting as the core product
- Live web crawl at query time as the primary answer path
- Ad-hoc / invent-as-you-go category labels from a generative model
- Scraping an entire source catalog in a single cron tick
- Ignoring robots.txt or polite crawl delays
- **Full Jev taxonomy later** — globe country+sentiment is the first live Jev slice; `jev_status` is `done` after that pass. LLM source-discovery is later

## Constraints

| Constraint | Detail |
| --- | --- |
| **Opinionated** | Taxonomy (Choice labels, Score rubrics, Noul questions) is designed by us and edited deliberately |
| **Jev’s job** | Unstructured text → structured, queryable judgments — does not generate prose or fetch URLs |
| **Gather vs judge** | Scrapers/fetchers/NER gather; Jev structures; app upserts DB rows |
| **Crawl pace** | Spread work over weeks/months; small batches per cron; “slow completeness” |
| **robots.txt** | Always fetch and honor robots.txt before scraping a host/path |
| **English only** | Seeded sources are English-language outlets; articles stored with `lang=en` |
| **No double-scrape** | Every article URL is written to `url_ledger` before fetch; existing URLs are never fetched again |
| **Recursion** | Deepen entities/claims only to enrich profiles, within daily budgets |
| **Query path (later)** | LLM → structured queries → Rose DB; scrape cron stays the freshness engine |

## Decisions locked in

| Decision | Choice |
| --- | --- |
| Product name | **Rose** (Recursive Opinionated Search Engine) |
| Decision model | TypeSafe **Jev** (globe country + sentiment now; full taxonomy later) |
| Opinionated | Fixed Jev taxonomy, not ad-hoc LLM labels |
| Primary loop (now) | Paced RSS scrape → store article text → Jev country/sentiment → public globe |
| **v0 database** | Railway **Postgres**, owned by **rose-backend**. Tables: **`news_sources`**, **`articles`**, **`url_ledger`**, **`jev_analyses`**, **`article_geo_sentiment`**, auth, `api_keys`. No SQLite. No Drizzle. |
| Crawl policy | Long-term completeness; **not** all-at-once |
| robots.txt | **Always respected**; blocked paths never scraped |
| Query model | Later: LLM plans queries over the structured DB |
| Apps | **rose-backend** owns schema + REST. **rose-bot** (this repo) scrapes via HTTP. **rose-web-admin** configures sources. **rose-web-public** lists articles + globe. |
| Build now? | **Yes** — bot + two Next.js apps |

Schema, statuses, and cron batching: [`jev-ai-fanout.md`](./jev-ai-fanout.md). Runtime: [`hosting.md`](./hosting.md). App split: [`web.md`](./web.md).

## rose-bot (this repo)

`npm start` → `node server.js`. Binds `process.env.PORT` (default `43123`). Node **22+**. **Requires `ROSE_BACKEND_URL` and `ROSE_BOT_TOKEN`.**

| Path | What |
| --- | --- |
| `GET /health` | 200 `{ ok: true, service: "rose-bot", engine: "rose-backend", lastTick, articles, sources }` |
| `GET /articles` | Recently stored articles (title, url, timestamps; no full body) |
| `GET /sources` | Token-gated (`ROSE_BOT_TOKEN`). Ops fields belong in rose-web-admin. |

### Pace

| Knob | Default |
| --- | --- |
| Tick | 15 minutes (`TICK_MS`) |
| Sources per tick | 1 (`MAX_SOURCES_PER_TICK`) |
| New article fetches per tick | 3 (`MAX_FETCHES_PER_TICK`) |
| Gap after a source is worked | 6 hours (`SOURCE_GAP_HOURS`) |
| robots.txt cache | 24 hours |
| Delay between requests | max(2s, Crawl-delay) |

### Seeds (`news_sources`)

English RSS only:

1. BBC World — `https://feeds.bbci.co.uk/news/world/rss.xml`
2. NPR News — `https://feeds.npr.org/1001/rss.xml`
3. The Guardian World — `https://www.theguardian.com/world/rss`
4. Al Jazeera English — `https://www.aljazeera.com/xml/rss/all.xml`

User-Agent: `RoseBot/0.1 (+https://github.com/ejqs/newsey)`.

Local and production call **rose-backend** via `ROSE_BACKEND_URL`. The bot exits if it is missing.

Source config after first seed: **rose-web-admin**. Public list: **rose-web-public**. Map: [`web.md`](./web.md).

## Hosting (Railway)

**Source of truth:** GitHub [`ejqs/newsey`](https://github.com/ejqs/newsey). Service **rose** is connected to **`ejqs/newsey@main`**.

| | |
| --- | --- |
| **GitHub (canonical)** | https://github.com/ejqs/newsey |
| **Project** | [newsey](https://railway.com/project/a257119d-74b0-462c-a6a7-38a7f1a28463) (`a257119d-74b0-462c-a6a7-38a7f1a28463`) |
| **Service** | [rose](https://railway.com/project/a257119d-74b0-462c-a6a7-38a7f1a28463/service/7b0a3f74-dcfe-4be8-85d7-39485f914de8?environmentId=4d6055df-ab41-4850-b0bd-06031800b11d) (`7b0a3f74-dcfe-4be8-85d7-39485f914de8`) |
| **Environment** | production (`4d6055df-ab41-4850-b0bd-06031800b11d`) |
| **Workspace** | ejqs (`f43c0117-46cb-439c-a5e3-0b21b8c8a0ef`) |
| **`TYPESAFE_API_KEY`** | Variable **exists** on rose. Required for live globe Jev. Empty → `fixtures/jev-mock/globe-*.json`. Paste from [console.typesafe.ai/keys](https://console.typesafe.ai/keys). |
| **`RAILPACK_NODE_VERSION`** | Set to `22` (matches `.node-version`). |
| **`ROSE_BACKEND_URL`** | Public URL of rose-backend |
| **`ROSE_BOT_TOKEN`** | Same secret as rose-backend |
| **Postgres** | [Postgres](https://railway.com/project/a257119d-74b0-462c-a6a7-38a7f1a28463/service/b3591f7b-2384-4576-ab2b-5ab81b37f99a?environmentId=4d6055df-ab41-4850-b0bd-06031800b11d) (`b3591f7b-2384-4576-ab2b-5ab81b37f99a`) — `DATABASE_URL` only on rose-backend |
| **Public URL** | https://rose-production-ac15.up.railway.app |
| **Latest deploy** | **SUCCESS** `714c88e4` (commit `6449d05`) |

## Jev agent skill (installed)

Official TypeSafe skill pack **`typesafe-ai`** from [typesafe-ai/skills](https://github.com/typesafe-ai/skills) (not the independent jevtypesafeai.com proxy).

| | |
| --- | --- |
| **Repo paths** | `.agents/skills/typesafe-ai/` (official `npx skills` install) and `.cursor/skills/typesafe-ai/` (same files, Cursor-native path) |
| **How to use** | Ask the agent to **use the TypeSafe skill**, or invoke `/typesafe-ai`. Fan-out Choice/Score/Noul in one System One call; read live docs at docs.typesafe.ai. |
| **Key** | Earlan sets **`TYPESAFE_API_KEY`** ([console keys](https://console.typesafe.ai/keys)). Until then, use repo `fixtures/jev-mock/` — do not call the hosted API. |
| **Repo doc** | `docs/jev-skill.md` (indexed from `docs/README.md`) |

## Open choices

1. **Taxonomy** — ship starter enums as-is, or edit before Jev is wired?
2. **LLM source-discovery** — later; seeds stay hand-picked until then.

## Doc map

See [`README.md`](./README.md).

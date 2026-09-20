# Rose — project context

**Product:** **Rose** — Recursive Opinionated Search Engine  
**Owner:** Earlan  
**Status:** Direction confirmed; docs only (no app build yet). **TypeSafe / Jev agent skill is installed.** GitHub repo exists; Origin inbound-mirrors it.  
**Updated:** 2026-09-21  
**GitHub (source of truth):** https://github.com/ejqs/newsey  
**Origin inbound mirror:** [ejqs/newsey](https://cursor.com/codebase/ejqs/newsey) — see [github-mirror.md](./github-mirror.md)

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

## Constraints

| Constraint | Detail |
| --- | --- |
| **Opinionated** | Taxonomy (Choice labels, Score rubrics, Noul questions) is designed by us and edited deliberately |
| **Jev’s job** | Unstructured text → structured, queryable judgments — does not generate prose or fetch URLs |
| **Gather vs judge** | Scrapers/fetchers/NER gather; Jev structures; app upserts DB rows |
| **Crawl pace** | Spread work over weeks/months; small batches per cron; “slow completeness” |
| **robots.txt** | Always fetch and honor robots.txt before scraping a host/path |
| **Recursion** | Deepen entities/claims only to enrich profiles, within daily budgets |
| **Query path (later)** | LLM → structured queries → Rose DB; scrape cron stays the freshness engine |

## Decisions locked in

| Decision | Choice |
| --- | --- |
| Product name | **Rose** (Recursive Opinionated Search Engine) |
| Decision model | TypeSafe **Jev** |
| Opinionated | Fixed Jev taxonomy, not ad-hoc LLM labels |
| Primary loop | Paced cron scrape → extract → Jev structure → upsert |
| **v0 database** | Three core tables: **`news_sources`** (incl. scrape status), **`articles`**, **`jev_analyses`** |
| Crawl policy | Long-term completeness; **not** all-at-once |
| robots.txt | **Always respected**; blocked paths never scraped |
| Query model | Later: LLM plans queries over the structured DB |
| Build now? | **No** — document first; coding is an open choice |

Schema, statuses, and cron batching: [`jev-ai-fanout.md`](./jev-ai-fanout.md).

## Hosting (Railway)

Created under Earlan’s **ejqs** workspace. Empty service — GitHub repo now exists but is **not yet connected** as the Railway source. No public domain (nothing to serve).

| | |
| --- | --- |
| **Project** | [newsey](https://railway.com/project/a257119d-74b0-462c-a6a7-38a7f1a28463) (`a257119d-74b0-462c-a6a7-38a7f1a28463`) |
| **Service** | [rose](https://railway.com/project/a257119d-74b0-462c-a6a7-38a7f1a28463/service/7b0a3f74-dcfe-4be8-85d7-39485f914de8?environmentId=4d6055df-ab41-4850-b0bd-06031800b11d) (`7b0a3f74-dcfe-4be8-85d7-39485f914de8`) |
| **Environment** | production (`4d6055df-ab41-4850-b0bd-06031800b11d`) |
| **Workspace** | ejqs (`f43c0117-46cb-439c-a5e3-0b21b8c8a0ef`) |
| **`TYPESAFE_API_KEY`** | Variable **exists** on rose, value **empty**. Paste the real key from [console.typesafe.ai/keys](https://console.typesafe.ai/keys). Do not invent one. |

**Next on Railway:** in the rose service, connect source `ejqs/newsey` (prefer a branch that has the app, not empty `main`). Railway GitHub App must have access to that repo.

**First deploy:** this tree is skill + docs, not a web app. Wait until Rose has an HTTP service that binds `PORT`, **or** add a tiny health server before connecting source (connecting GitHub starts a build that will fail today).

## Jev agent skill (installed)

Official TypeSafe skill pack **`typesafe-ai`** from [typesafe-ai/skills](https://github.com/typesafe-ai/skills) (not the independent jevtypesafeai.com proxy).

| | |
| --- | --- |
| **Repo paths** | `.agents/skills/typesafe-ai/` (official `npx skills` install) and `.cursor/skills/typesafe-ai/` (same files, Cursor-native path) |
| **How to use** | Ask the agent to **use the TypeSafe skill**, or invoke `/typesafe-ai`. Fan-out Choice/Score/Noul in one System One call; read live docs at docs.typesafe.ai. |
| **Key** | Earlan sets **`TYPESAFE_API_KEY`** ([console keys](https://console.typesafe.ai/keys)). Until then, use repo `fixtures/jev-mock/` — do not call the hosted API. |
| **Repo doc** | `docs/jev-skill.md` (indexed from `docs/README.md`) |

## Open choices

1. **Which DB engine** for v0 (SQLite vs Postgres vs other)?
2. **Which news sources** to seed `news_sources` first?
3. **Taxonomy** — ship starter enums as-is, or edit before code?
4. **Start coding next?** when Earlan greenlights.

## Doc map

See [`README.md`](./README.md).

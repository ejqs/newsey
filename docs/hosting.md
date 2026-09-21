# Hosting — GitHub + Railway

**Updated:** 2026-09-21

## GitHub

| App | Repo |
| --- | --- |
| **rose-bot** (this repo) | https://github.com/ejqs/newsey |
| **rose-backend** | https://github.com/ejqs/rose-backend |
| **rose-web-public** | https://github.com/ejqs/rose-web-public |
| **rose-web-admin** | https://github.com/ejqs/rose-web-admin |

Default branch: `main`. Do **not** commit `.env`.

App map: [`web.md`](./web.md).

## rose-bot (this repo)

`npm start` binds `PORT` (default `43123`). Node **22+**. Railpack uses `.node-version` (`22`).

**HTTP client of rose-backend.** `ROSE_BACKEND_URL` and `ROSE_BOT_TOKEN` are required. There is no `DATABASE_URL` on this process.

| Path | What |
| --- | --- |
| `GET /health` | 200 `{ ok, service: "rose-bot", engine: "rose-backend", lastTick, articles, sources, globe }` |
| `GET /articles` | Recently stored articles (no body) via backend |
| `GET /globe` | Aggregated country tones via backend |
| `GET /sources` | 401 unless bearer matches `ROSE_BOT_TOKEN` |

Each tick (default **15 minutes**): pick **1** eligible source (`status` in `ok`/`unknown`, `next_eligible_at`, rotate by priority / least-recent success), fetch RSS, record every item URL in `url_ledger` (never fetch a URL twice), honor `robots.txt`, fetch at most **3** new articles, wait ≥2s (or Crawl-delay) between requests, then set that source’s `next_eligible_at` **6 hours** later. `paused` is never picked.

English-only first-run seeds (only if `news_sources` is empty): BBC World, NPR News, The Guardian World, Al Jazeera English. After that, **rose-web-admin** owns source config.

Jev globe pass runs after each scrape tick (`jev-globe.js`). Live calls need `TYPESAFE_API_KEY`. Without it, mock fixtures. Details: [`globe-country-sentiment.md`](./globe-country-sentiment.md).

Local one-shot: `npm run scrape-once` (needs `ROSE_BACKEND_URL` + `ROSE_BOT_TOKEN`).

## Railway

Workspace **ejqs**. Project **newsey**. Shared **Postgres**.

| | |
| --- | --- |
| **Project dashboard** | https://railway.com/project/a257119d-74b0-462c-a6a7-38a7f1a28463 |
| **Service rose** (rose-bot) | https://railway.com/project/a257119d-74b0-462c-a6a7-38a7f1a28463/service/7b0a3f74-dcfe-4be8-85d7-39485f914de8?environmentId=4d6055df-ab41-4850-b0bd-06031800b11d |
| **rose-bot public URL** | https://rose-production-ac15.up.railway.app |
| `GET /health` | https://rose-production-ac15.up.railway.app/health |
| `RAILPACK_NODE_VERSION` | `22` |
| `TYPESAFE_API_KEY` | live Jev for globe; empty uses mock fixtures |
| `ROSE_BACKEND_URL` | Public URL of rose-backend |
| `ROSE_BOT_TOKEN` | Same secret as rose-backend |
| **Postgres** | [service](https://railway.com/project/a257119d-74b0-462c-a6a7-38a7f1a28463/service/b3591f7b-2384-4576-ab2b-5ab81b37f99a?environmentId=4d6055df-ab41-4850-b0bd-06031800b11d) (`b3591f7b-2384-4576-ab2b-5ab81b37f99a`) — **only rose-backend** gets `DATABASE_URL` |

`railway.json` start command is `node server.js` with healthcheck `GET /health`. `GET /health` includes `engine: "rose-backend"`. Counts come from rose-backend.

Web services (same project; they talk HTTP to rose-backend, not Postgres):

| Service | Source | URL |
| --- | --- | --- |
| **rose-web-public** (`c17d6837-15f2-4560-892c-e63cffc0c57b`) | `ejqs/rose-web-public@main` | https://rose-web-public-production.up.railway.app |
| **rose-web-admin** (`95f1dfde-4cc4-4cce-9451-400f54d58a2c`) | `ejqs/rose-web-admin@main` | https://rose-web-admin-production.up.railway.app |

Set bootstrap admin on **rose-backend** (`ROSE_BOOTSTRAP_ADMIN_EMAIL` / `PASSWORD`). Admin UI at `/login` talks to the backend.

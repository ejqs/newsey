# Hosting — GitHub + Railway

**Updated:** 2026-09-21

## GitHub

- **https://github.com/ejqs/newsey**
- Default branch: `main` (`6449d05` — PR [#2](https://github.com/ejqs/newsey/pull/2) merged)
- Do **not** commit `.env` or `data/*.sqlite`

## Mini scrape service

`npm start` binds `PORT` (default `43123`). Node **22+**. Railpack uses `.node-version` (`22`).

Engine: **Postgres** when `DATABASE_URL` is set (Railway rose). **SQLite** locally (`$DATA_DIR/rose.sqlite`).

| Path | What |
| --- | --- |
| `GET /health` | 200 `{ ok: true, articles, sources, lastTick }` |
| `GET /sources` | Seeded RSS sources and scrape status |
| `GET /articles` | Recently stored articles |

Each tick (default **15 minutes**): pick **1** eligible source (`next_eligible_at`, rotate by priority / least-recent success), fetch RSS, record every item URL in `url_ledger` (never fetch a URL twice), honor `robots.txt`, fetch at most **3** new articles, wait ≥2s (or Crawl-delay) between requests, then set that source’s `next_eligible_at` **6 hours** later.

English-only seeds: BBC World, NPR News, The Guardian World, Al Jazeera English.

Jev is **not** in this slice (`jev_status=skipped`). No `TYPESAFE_API_KEY` required.

Local SQLite file: `$DATA_DIR/rose.sqlite` (`DATA_DIR` or `/data` if present, else `./data`). Production stores the same tables in Railway **Postgres**.

Local one-shot: `npm run scrape-once`.

## Railway

Workspace **ejqs**. Service **rose** deploys from `ejqs/newsey` `main`. Latest deploy: **SUCCESS** (`714c88e4`, commit `6449d05`).

| | |
| --- | --- |
| **Public URL** | https://rose-production-ac15.up.railway.app |
| `GET /health` | https://rose-production-ac15.up.railway.app/health |
| Project dashboard | https://railway.com/project/a257119d-74b0-462c-a6a7-38a7f1a28463 |
| Service **rose** | https://railway.com/project/a257119d-74b0-462c-a6a7-38a7f1a28463/service/7b0a3f74-dcfe-4be8-85d7-39485f914de8?environmentId=4d6055df-ab41-4850-b0bd-06031800b11d |
| `RAILPACK_NODE_VERSION` | `22` |
| `TYPESAFE_API_KEY` | empty until Jev |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (private) |
| **Postgres** | [service](https://railway.com/project/a257119d-74b0-462c-a6a7-38a7f1a28463/service/b3591f7b-2384-4576-ab2b-5ab81b37f99a?environmentId=4d6055df-ab41-4850-b0bd-06031800b11d) (`b3591f7b-2384-4576-ab2b-5ab81b37f99a`) |

`railway.json` start command is `node server.js` with healthcheck `GET /health`. `GET /health` includes `engine: "postgres"` or `"sqlite"`.

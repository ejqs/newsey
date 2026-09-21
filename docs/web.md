# Rose apps

**Updated:** 2026-09-21

Three GitHub repos, one Postgres. **No rose-service.**

| App | Repo | Job |
| --- | --- | --- |
| **rose-bot** | [ejqs/newsey](https://github.com/ejqs/newsey) (this repo) | Paced RSS scrape plus optional ethical crawler. Reads `news_sources`, writes `articles`. |
| **rose-web-public** | [ejqs/rose-web-public](https://github.com/ejqs/rose-web-public) | Public globe (country sentiment) plus article list. Excerpt + link to original. Search later. Live: https://rose-web-public-production.up.railway.app |
| **rose-web-admin** | [ejqs/rose-web-admin](https://github.com/ejqs/rose-web-admin) | Control plane. Bot config (sources) and Jev questions. Live: https://rose-web-admin-production.up.railway.app |

```
visitor  →  rose-web-public  →  Postgres (read article_geo_sentiment + articles)
operator →  rose-web-admin   →  Postgres (auth, news_sources, api_keys, jev_questions)
rose-bot →  Postgres (read config and questions, write articles + jev_analyses; enforce API keys on /v1)
```

## Rules

- **Postgres only.** All three require `DATABASE_URL`. No SQLite.
- Admin is the only writer of bot config (`news_sources`, `jev_questions`). rose-bot seeds BBC / NPR / Guardian / Al Jazeera **only if `news_sources` is empty**. Jev question seeds insert **only when that `question_id` is missing**. The optional crawler may insert `scrape_method=crawl` sources when it first stores an allowlisted article.
- `status = paused` is never picked by the scrape tick or the crawler for that host.
- Public never shows full `body_text`. Admin can preview it.
- React Bits / shadcn live on **admin only**. Public is semantic HTML + Tailwind.

## rose-bot (this repo)

`npm start` → `node server.js`. Requires `DATABASE_URL`. Node **22+**.

| Path | What |
| --- | --- |
| `GET /health` | `{ ok, service: "rose-bot", engine: "postgres", lastTick, lastCrawlTick, crawlEnabled, articles, sources, globe, jev_questions }` |
| `GET /articles` | Recent titles (no body) |
| `GET /globe` | Aggregated country tones for the public globe |
| `GET /sources` | **401** unless `ROSE_SERVICE_TOKEN` or a hashed admin API key (`bot:read`) matches `Authorization: Bearer` / `X-Rose-Key` / `X-Rose-Token` |
| `GET /crawl` | Crawler on/off, frontier counts, knobs |
| `POST /crawl` | Enable/disable crawler. `ROSE_SERVICE_TOKEN` or admin API key (`bot:command`). Off by default. [`crawler.md`](./crawler.md) |
| `GET /v1/status` | API-key (`bot:read`): health + key metadata |
| `GET /v1/sources` | API-key (`bot:read`): source list |
| `POST /v1/tick` | API-key (`bot:command`): run one scrape tick (RSS + Jev + crawl if enabled) |
| `POST /v1/sources` | API-key (`bot:command`): create source |
| `POST /v1/sources/:id` | API-key (`bot:command`): update / pause source |

Live Railway service **rose**: `node server.js`, healthcheck `/health`. Command API: [`bot-command-api.md`](./bot-command-api.md). Keys are minted in rose-web-admin (`/keys`).

## Web apps

Both Next.js App Router. Railway start: `npm start` (`next start`). Health: `/health`.

**rose-web-admin** env extra: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. No public signup. First admin is seeded if that email is missing. API keys: `/keys` (hash at rest). No extra env for keys.

Auth tables (`user`, `session`, `account`, `verification`) are created by admin on first boot. `api_keys` is created by admin or rose-bot. Scrape tables are owned by rose-bot. Admin writes `jev_questions` (created on bot boot; admin also `CREATE TABLE IF NOT EXISTS` so the form works).

Live: https://rose-web-admin-production.up.railway.app and https://rose-web-public-production.up.railway.app.

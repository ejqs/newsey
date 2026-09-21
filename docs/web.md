# Rose apps

**Updated:** 2026-09-21

Four GitHub repos. **rose-backend** owns Postgres. The other three are HTTP clients.

| App | Repo | Job |
| --- | --- | --- |
| **rose-backend** | [ejqs/rose-backend](https://github.com/ejqs/rose-backend) | REST JSON, SQL migrations, auth, API keys. Only this process gets `DATABASE_URL`. |
| **rose-bot** | [ejqs/newsey](https://github.com/ejqs/newsey) (this repo) | Paced RSS scrape + Jev globe. Calls `ROSE_BACKEND_URL`. |
| **rose-web-public** | [ejqs/rose-web-public](https://github.com/ejqs/rose-web-public) | Public globe + article list. Excerpt + link to original. Live: https://rose-web-public-production.up.railway.app |
| **rose-web-admin** | [ejqs/rose-web-admin](https://github.com/ejqs/rose-web-admin) | Control plane. Sources / pause / API keys. Live: https://rose-web-admin-production.up.railway.app |

```
visitor  →  rose-web-public  →  rose-backend REST
operator →  rose-web-admin   →  rose-backend REST (session)
rose-bot →  rose-backend REST (ROSE_BOT_TOKEN)
rose-backend → Postgres
```

## Rules

- **Postgres only on rose-backend.** Clients use `ROSE_BACKEND_URL`. No SQLite. No Drizzle.
- Admin is the only writer of bot config. rose-bot seeds BBC / NPR / Guardian / Al Jazeera **only if `news_sources` is empty**.
- `status = paused` is never leased to the scrape tick.
- Public never gets full `body_text`. Admin can preview it.
- React Bits / shadcn live on **admin only**. Public is semantic HTML + Tailwind.

## rose-bot (this repo)

`npm start` → `node server.js`. Requires `ROSE_BACKEND_URL` and `ROSE_BOT_TOKEN`. Node **22+**.

| Path | What |
| --- | --- |
| `GET /health` | `{ ok, service: "rose-bot", engine: "rose-backend", lastTick, articles, sources, globe }` — counts from the backend |
| `GET /articles` | Recent titles (no body) via backend |
| `GET /globe` | Aggregated country tones via backend |
| `GET /sources` | **401** unless bearer matches `ROSE_BOT_TOKEN` (or legacy `ROSE_SERVICE_TOKEN`) |

Live Railway service **rose**: `node server.js`, healthcheck `/health`.

Backend contract: [ejqs/rose-backend docs](https://github.com/ejqs/rose-backend/blob/main/docs/README.md).

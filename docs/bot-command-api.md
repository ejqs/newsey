# Bot command API (API keys)

**Updated:** 2026-09-21

rose-web-admin mints keys; **this process** (rose-bot) enforces them and runs commands. Secrets are never stored: `api_keys.secret_hash` is `sha256` of the full token (`rose_<16-hex-id>_<64-hex-secret>`).

Table `api_keys` is created on bot boot if missing (same DDL as admin).

## Auth

```
Authorization: Bearer <secret>
```

or `X-Rose-Key: <secret>` (or `X-Rose-Token`).

| Scope | Endpoints |
| --- | --- |
| `bot:read` | `GET /v1/status`, `GET /v1/sources` (also accepted on legacy `GET /sources`) |
| `bot:command` | `POST /v1/tick`, `POST /v1/sources`, `POST /v1/sources/:id`, `POST /crawl` |

Admin-issued keys get both scopes. Revoked keys (`revoked_at` set) return 401. Wrong scope returns 403.

## Endpoints

Base (live): `https://rose-production-ac15.up.railway.app`

### `GET /v1/status`

```json
{
  "ok": true,
  "service": "rose-bot",
  "key": { "id": "…", "name": "rose/newsey", "prefix": "rose_…", "scopes": "bot:read bot:command" },
  "lastTick": { "started": "…", "fetched": 0, "sources": 0 },
  "ticking": false,
  "articles": 12,
  "sources": 4
}
```

### `GET /v1/sources`

`{ "ok": true, "sources": [ … ] }` — same rows as `news_sources`.

### `POST /v1/tick`

Runs one scrape tick in this process. Body optional (`{}`). **409** `{ "ok": false, "error": "tick_in_progress" }` if a tick is already running.

```json
{ "ok": true, "action": "tick", "tick": { "started": "…", "fetched": 3, "sources": 1 } }
```

### `POST /v1/sources`

Create a source. JSON:

```json
{
  "name": "Example",
  "base_url": "https://example.com",
  "feed_url": "https://example.com/rss.xml",
  "scrape_method": "rss",
  "priority": 50,
  "status": "unknown"
}
```

`name`, `base_url`, `feed_url` required. **201** `{ "ok": true, "action": "create_source", "source": { … } }`.

### `POST /v1/sources/:id`

Update any of: `name`, `base_url`, `feed_url`, `scrape_method`, `priority`, `status` (`ok` | `paused` | `unknown`).

```bash
curl -sS -X POST https://rose-production-ac15.up.railway.app/v1/sources/1 \
  -H "Authorization: Bearer $ROSE_BOT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"paused"}'
```

## Example (status + tick)

```bash
export ROSE_BOT_URL=https://rose-production-ac15.up.railway.app
export ROSE_BOT_API_KEY='rose_<id>_<secret>'

curl -sS "$ROSE_BOT_URL/v1/status" -H "Authorization: Bearer $ROSE_BOT_API_KEY"

curl -sS -X POST "$ROSE_BOT_URL/v1/tick" \
  -H "Authorization: Bearer $ROSE_BOT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Config

| Var | Required | Role |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | Shared Postgres with admin; `api_keys` + scrape tables |
| `ROSE_SERVICE_TOKEN` | no | Legacy static bearer for `GET /sources` and `POST /crawl`. Prefer hashed admin keys. |

No env var holds the admin-minted secret. Generate keys in rose-web-admin at `/keys`.

Minting UI: [rose-web-admin `docs/api-keys.md`](https://github.com/ejqs/rose-web-admin/blob/main/docs/api-keys.md) (after that PR lands).

# Rose (Newsey)

**Rose** is a Recursive Opinionated Search Engine: paced, robots-respecting news ingest, then **Jev** (TypeSafe System One) turns articles into structured records.

This repo is **rose-bot**. Globe **Jev** (country + sentiment) runs after each scrape tick. Two other repos:

- [rose-web-public](https://github.com/ejqs/rose-web-public) — globe + article list
- [rose-web-admin](https://github.com/ejqs/rose-web-admin) — bot configuration (control plane)

```bash
# Requires DATABASE_URL (Postgres). No SQLite.
npm start        # PORT (default 43123). GET /health  GET /articles  GET /globe  GET /crawl  /v1/* (API keys)
npm run scrape-once
npm run crawl-once   # one crawl tick; crawler is off by default in npm start
npm test         # Jev globe gates + api-keys + crawler policy/robots checks
```

Requires **Node 22+**. Crawler on/off and robots rules: [docs/crawler.md](docs/crawler.md).

## Jev skill (installed)

Official skill from [typesafe-ai/skills](https://github.com/typesafe-ai/skills) (`typesafe-ai`, MIT, upstream `v0.5.7` / commit `65a39f3`).

| Path | Why |
| --- | --- |
| `.agents/skills/typesafe-ai/` | Official Cursor install via `npx skills add` |
| `.cursor/skills/typesafe-ai/` | Same files, Cursor-native project skill path |
| `skills-lock.json` | Installer lockfile (content hash) |

Cursor loads both `.agents/skills/` and `.cursor/skills/` automatically. Ask agents to **use the TypeSafe skill**, or invoke `/typesafe-ai`.

Details: [docs/jev-skill.md](docs/jev-skill.md).

## API key

Jev calls need **`TYPESAFE_API_KEY`** from [TypeSafe console keys](https://console.typesafe.ai/keys). Copy `.env.example` to `.env` and set it.

Without a key, use [`fixtures/jev-mock/`](fixtures/jev-mock/) — do not call the hosted API. Globe country+sentiment uses `globe-*.json` on that path.

Country + sentiment pipeline: [docs/globe-country-sentiment.md](docs/globe-country-sentiment.md).

## Docs

Index: [docs/README.md](docs/README.md). App split: [docs/web.md](docs/web.md). Hosting: [docs/hosting.md](docs/hosting.md). Product: [docs/project-context.md](docs/project-context.md). Command API: [docs/bot-command-api.md](docs/bot-command-api.md).

GitHub: [ejqs/newsey](https://github.com/ejqs/newsey). Live bot: [rose-production-ac15.up.railway.app](https://rose-production-ac15.up.railway.app). Railway **rose**: [dashboard](https://railway.com/project/a257119d-74b0-462c-a6a7-38a7f1a28463).

## Refresh the skill

```bash
npx skills add typesafe-ai/skills --skill typesafe-ai --agent cursor --yes --copy
# then copy .agents/skills/typesafe-ai → .cursor/skills/typesafe-ai so the mirror stays in sync
```

# Rose (Newsey)

**Rose** is a Recursive Opinionated Search Engine: paced, robots-respecting news ingest, then **Jev** (TypeSafe System One) turns articles into structured records.

This repo is **Rose**: paced, robots-respecting RSS ingest into SQLite. **Jev is later.**

```bash
npm start   # PORT (default 43123). GET /health  GET /sources  GET /articles
```

Requires **Node 22+**. Tick every 15 minutes: one source, at most three new article URLs, six-hour gap per source. Every RSS URL is stored in `url_ledger` so it is never fetched twice. Seeds are English-language outlets only.

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

Without a key, use [`fixtures/jev-mock/`](fixtures/jev-mock/) — do not call the hosted API. The scrape service does not use this key.

## Docs

Index: [docs/README.md](docs/README.md). Hosting: [docs/hosting.md](docs/hosting.md). Product: [docs/project-context.md](docs/project-context.md).

GitHub: [ejqs/newsey](https://github.com/ejqs/newsey). Railway **rose**: [dashboard](https://railway.com/project/a257119d-74b0-462c-a6a7-38a7f1a28463).

## Refresh the skill

```bash
npx skills add typesafe-ai/skills --skill typesafe-ai --agent cursor --yes --copy
# then copy .agents/skills/typesafe-ai → .cursor/skills/typesafe-ai so the mirror stays in sync
```

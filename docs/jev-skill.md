# TypeSafe / Jev agent skill

**Installed** in this repo on 2026-09-20 so Cursor agents can design and call **Jev** (TypeSafe System One) correctly: one request, many typed questions; no invented API fields.

## What was installed

The **official** TypeSafe agent skill — not a third-party proxy.

| Item | Value |
| --- | --- |
| Upstream | [github.com/typesafe-ai/skills](https://github.com/typesafe-ai/skills) |
| Skill id | `typesafe-ai` |
| Release | `v0.5.7` (commit [`65a39f393687675ce170e6094757de20370365b9`](https://github.com/typesafe-ai/skills/commit/65a39f393687675ce170e6094757de20370365b9)) |
| License | MIT (copyright TypeSafe AI, 2026) — copies live next to `SKILL.md` |
| Official Cursor install | `npx skills add typesafe-ai/skills --skill typesafe-ai --agent cursor --yes --copy` |
| Docs | [docs.typesafe.ai/agent-skill](https://docs.typesafe.ai/agent-skill) |

### Paths in this repo

| Path | Role |
| --- | --- |
| [`.agents/skills/typesafe-ai/SKILL.md`](../.agents/skills/typesafe-ai/SKILL.md) | Official skills.sh / Cursor project install |
| [`.cursor/skills/typesafe-ai/SKILL.md`](../.cursor/skills/typesafe-ai/SKILL.md) | Same files, Cursor-native `.cursor/skills/` discovery |
| [`skills-lock.json`](../skills-lock.json) | Content hash from the installer |
| [`AGENTS.md`](../AGENTS.md) | Short pointer for future agents |

Cursor discovers project skills from `.agents/skills/` and `.cursor/skills/` ([Cursor skills docs](https://cursor.com/docs/skills.md)). Both copies are the same upstream `SKILL.md` so either path works.

## How future agents should use it

1. Read the skill (`/typesafe-ai` or “use the TypeSafe skill”).
2. Treat **live TypeSafe docs** as source of truth (`https://docs.typesafe.ai/…` with `.md` appended).
3. Fan out independent Choice / Score / Noul questions in **one** `POST https://api.typesafe.ai/v1/systemone` call.
4. Keep Rose taxonomy labels fixed (product docs), not ad-hoc chat labels.
5. If `TYPESAFE_API_KEY` is unset, use the mock fixture — do not guess response shapes.

Example prompt:

> Using the TypeSafe skill, design the Jev questions for pending `articles` and map answers into `jev_analyses`.

## API key (Earlan)

The skill itself needs no secret. **Live Jev calls** do.

| Variable | Required for | Where to get it |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Hosted `POST /v1/systemone` (Bearer) | [console.typesafe.ai/keys](https://console.typesafe.ai/keys) |

Copy [`.env.example`](../.env.example) → `.env` and paste the key. Optional: `TYPESAFE_ENDPOINT` (default `https://api.typesafe.ai`).

Do not commit `.env`. Keep keys server-side; never log them.

## Local / mock fallback

Until the key is set, agents and tests should treat [`fixtures/jev-mock/article-analysis.json`](../fixtures/jev-mock/article-analysis.json) as a canned System One response for a single article (Choice / Score / Noul shapes from the [HTTP API](https://docs.typesafe.ai/api.md)). Globe questions use [`fixtures/jev-mock/globe-ukraine-negative.json`](../fixtures/jev-mock/globe-ukraine-negative.json) and sibling `globe-*.json` files. Extra taxonomy (hop-in, metadata) uses [`fixtures/jev-mock/taxonomy-extra.json`](../fixtures/jev-mock/taxonomy-extra.json), merged onto the globe fixture.

Rules when the key is missing:

- Do **not** call `api.typesafe.ai`.
- Do **not** invent extra request or response fields.
- Map mock `answers` into `jev_analyses.answers` the same way a live response would be mapped.
- Globe country+sentiment mocks: `fixtures/jev-mock/globe-*.json` (see [`globe-country-sentiment.md`](./globe-country-sentiment.md)).
- Extra seeded questions: `fixtures/jev-mock/taxonomy-extra.json`. Operator-added questions without a fixture get a stub of the same answer shape.

## What was skipped (not official TypeSafe)

| Artifact | Why skipped |
| --- | --- |
| [jevtypesafeai.com/agent-skill](https://jevtypesafeai.com/agent-skill) and `https://jevtypesafeai.com/skill/SKILL.md` | Independent hosted proxy (`JEV_API_KEY` / `jv_live_…`). The site says it is **not TypeSafe AI**. |
| Claude Code plugin (`claude plugin marketplace add typesafe-ai/skills`) | Official, but Claude Code–only. This repo is Cursor. |
| [burnigtm/jev-mcp](https://glama.ai/mcp/servers/burnigtm/jev-mcp) | Unofficial MCP server, not TypeSafe’s skill pack. |

## Refresh

```bash
npx skills add typesafe-ai/skills --skill typesafe-ai --agent cursor --yes --copy
cp -a .agents/skills/typesafe-ai/. .cursor/skills/typesafe-ai/
```

Or replace both skill directories from [skills/typesafe-ai](https://github.com/typesafe-ai/skills/tree/main/skills/typesafe-ai) on GitHub.

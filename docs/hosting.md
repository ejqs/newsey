# Hosting — GitHub + Railway

**Updated:** 2026-09-21

This repo is skill + product docs, not a deployable web app yet.

## GitHub

Live at **https://github.com/ejqs/newsey** (public). All branches are on GitHub.

Local `origin` is GitHub. Two-way sync with Cursor Origin is the inbound mirror **`ejqs/newsey`** — see [github-mirror.md](./github-mirror.md).

Do **not** commit `.env`.

## Railway

Workspace **ejqs**. Project and empty service already exist. GitHub is **not** connected (repo missing). No `*.up.railway.app` domain yet.

| | |
| --- | --- |
| Project dashboard | https://railway.com/project/a257119d-74b0-462c-a6a7-38a7f1a28463 |
| Service **rose** | https://railway.com/project/a257119d-74b0-462c-a6a7-38a7f1a28463/service/7b0a3f74-dcfe-4be8-85d7-39485f914de8?environmentId=4d6055df-ab41-4850-b0bd-06031800b11d |
| Project ID | `a257119d-74b0-462c-a6a7-38a7f1a28463` |
| Service ID | `7b0a3f74-dcfe-4be8-85d7-39485f914de8` |
| Environment | production `4d6055df-ab41-4850-b0bd-06031800b11d` |

### After the GitHub repo exists

1. Install / authorize the **Railway GitHub App** for `ejqs/newsey` if prompted.
2. On service **rose**, set source to `ejqs/newsey` (default branch, usually `main`). Connecting a repo **starts a build immediately**.
3. Open Variables and paste **`TYPESAFE_API_KEY`** from [console.typesafe.ai/keys](https://console.typesafe.ai/keys). The variable name is already present with an empty value — do not invent a key.
4. Generate a Railway domain only once something listens on `PORT`.

### First deploy

Wait until Rose has an HTTP app (or add a tiny health server). Connecting GitHub to this docs-only tree will fail Railpack detection. A first slice that can deploy: any process that binds `process.env.PORT` and returns 200 on `/health`.

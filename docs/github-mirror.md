# Git remotes and GitHub two-way sync

**Updated:** 2026-09-21

GitHub is the source of truth. Cursor Origin is an inbound mirror, so PRs and git refs sync both ways.

## Remotes (this clone)

| Remote | URL | Role |
| --- | --- | --- |
| `origin` | https://github.com/ejqs/newsey.git | Fetch and push. Source of truth. |
| `cursor-origin` | https://origin.cursor.com/ejqs/newsey.git | Cursor inbound mirror of the GitHub repo. |

Push to `origin` (GitHub). Origin updates after GitHub accepts the push. A push to `cursor-origin` also lands on GitHub.

## What is synced

Inbound mirror **`ejqs/newsey`** ⇄ GitHub **`ejqs/newsey`**.

Status: `inbound`. Branches that must match:

- `main`
- `cursor/github-railway-5d4a`
- `cursor/install-jev-skill-7ef1`

PRs sync in both directions. GitHub Issues and GitHub Actions do not.

## Check sync

```bash
origin repo mirror status -R ejqs/newsey
git ls-remote --heads origin
git ls-remote --heads cursor-origin
```

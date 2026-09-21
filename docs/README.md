# Rose docs index

Prefer this folder over chat history.

| Doc | Purpose |
| --- | --- |
| [project-context.md](./project-context.md) | Goals, constraints, locked decisions, Jev skill, **GitHub + Railway URLs** |
| [web.md](./web.md) | Three apps: rose-bot, rose-web-public, rose-web-admin. Postgres only. No rose-service |
| [bot-command-api.md](./bot-command-api.md) | API keys from admin; `GET/POST /v1/*` to command the bot |
| [jev-ai-fanout.md](./jev-ai-fanout.md) | Pipeline, v0 schema (`news_sources` / `articles` / `url_ledger` / `jev_analyses` / `jev_questions`), pacing, robots.txt, taxonomy |
| [globe-country-sentiment.md](./globe-country-sentiment.md) | Additive Jev pass: primary country + good/bad/mixed; public globe colors |
| [jev-questions.md](./jev-questions.md) | Questions as data: add/edit/disable Choice/Score/Noul; hop-in + metadata seeds |
| [crawler.md](./crawler.md) | Recursive URL discovery + credible-news scrape: on/off, seeds, rate limits, robots/ethics |
| [hosting.md](./hosting.md) | rose-bot on Railway, Postgres, GitHub + dashboard links |
| [jev-skill.md](./jev-skill.md) | Official TypeSafe / Jev agent skill: paths, API key, mock fallback |

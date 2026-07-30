# Engineering Intelligence · GitHub

Premium, multi-page Engineering Intelligence Dashboard driven by live GitHub data — single source of truth for CTOs, EMs, PMs, QA, DevOps and Developers.

Frontend: HTML + Tailwind (CDN) + Chart.js + Lucide, hash-routed sidebar SPA.
Backend: Node.js/Express service layer for GitHub REST/GraphQL, in-memory TTL cache, single-flight, webhook receiver, SSE stream for real-time UI updates.

## Run

```bash
cd github-engineering-intelligence
cp .env.example .env       # then edit token & scope
npm install
npm start                  # http://localhost:8788
```

Or explore without any GitHub credentials:

```
http://localhost:8788/?demo=1
```

## Auth

- **Personal Access Token** (classic): scopes `repo` (read), `read:org`, `read:user`. Set `GITHUB_TOKEN`.
- **Fine-grained PAT**: Repository access to the targeted repos with read permissions for Actions, Checks, Commit statuses, Contents, Deployments, Issues, Metadata, Pull requests; Org read for Members.
- **Scope** — comma-separated list. Either `owner/repo` pairs, or an org name (pulls its most recently pushed repos).

## Pages (sidebar)

1. **Executive Overview** — 18 KPI cards (incl. DORA), trend arrows, top-developer chart.
2. **Live Activity** — real-time engineering timeline.
3. **Git Activity Analytics** — commits vs deploys, merge-time distribution, commit heatmap.
4. **Contributors** — developer performance cards.
5. **Commits** — full commit explorer; click a row for diff drawer.
6. **Pull Requests** — Kanban (Draft/Open/Review/Approved/Merged/Closed) + full table.
7. **Branches** — every branch per repo, protected/env badges.
8. **Features** — feature registry with progress bar & risk score. Click for drilldown.
9. **Feature Lifecycle** — Backlog → Development → Code Review → Testing → UAT → Production rail.
10. **Releases**, **Deployments**, **Environments**, **Environment Comparison**, **Missing Features**, **Notifications**, **Audit Log**, **Smart Insights**, **Repositories & Health**.

## Real-time

- SSE at `/api/events` — the UI subscribes and refreshes whenever a webhook fires.
- Point GitHub webhooks to `POST /api/webhooks/github` with these events: `push`, `pull_request`, `pull_request_review`, `deployment_status`, `workflow_run`, `release`. Set `GITHUB_WEBHOOK_SECRET`.
- Baseline auto-refresh every `CLIENT_REFRESH_SECONDS` (default 60s) as a fallback.

## Architecture

```
server/
  index.js
  config.js
  routes/api.js
  services/
    githubService.js      # REST paginator, aggregator, feature registry, DORA, env diff
    webhookService.js     # signature verify + SSE broadcast
    cache.js              # TTL + single-flight
    demoData.js           # deterministic synthetic dataset
public/
  index.html, config.html
  css/styles.css
  js/
    app.js                # boot + shell + refresh loop
    api.js                # fetch wrappers (+ SSE)
    router.js             # hash router + page registry
    pages.js              # every section page
    palette.js            # Ctrl+K command palette
    drawer.js             # feature/commit drilldown
    charts.js             # Chart.js helpers
    utils.js              # formatters, CSV, PDF
```

## Notes

- All GitHub calls are cached server-side (`CACHE_TTL_SECONDS`, default 60s) with single-flight de-dup.
- Rate limiting is honored (`x-ratelimit-*`) with waits + retries; 401 auth errors surface a banner.
- Scope is hard-capped at 30 repos per snapshot for performance; adjust `resolveRepos()` if you need more.
- The feature registry infers stage/env from issue↔commit↔PR↔deployment links (`#123` mentions in commit messages/PR titles).
- DORA metrics (Lead Time, Deploy Frequency, Change Failure Rate, MTTR) are computed from PRs and Deployments.
- Repo health score = build success + issue backlog − stale branches − open PR volume (bounded).

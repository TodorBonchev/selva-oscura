# Deploy

| Piece | Host | Project | Root | Notes |
|---|---|---|---|---|
| Browser client | Vercel | **`selva-oscura`** (team `stotna`) | `client/` | Production. Git-connected to `main`; `client/vercel.json` drives the build (`npm install` → `npm run build` → `dist`, SPA rewrite, immutable `/assets`). |
| Game server | Railway | `selva-oscura` → service `game-server` | `server/` | `npm start`; `/health`. Migrations in `server/migrations/` run on boot (additive). |

## Vercel

Production client is **`selva-oscura`** (team `stotna`): Root Directory `client`, so it
reads `client/vercel.json`. Every push to `main` builds Production at
`https://selva-oscura-murex.vercel.app` (plus any custom domain).

A stray duplicate project named `client` (Root Directory `.`) used to fail every git
deploy; it was deleted on 2026-10-05. The root `vercel.json` still sets
`"git": { "deploymentEnabled": false }` as a safety net if anyone recreates a
repo-root project.

For CLI deploys from this machine:

```bash
cd client && vercel link --project selva-oscura --scope stotna
```

`VITE_GAME_SERVER_URL` (Railway URL) is set on the `selva-oscura` project; the client
also accepts `?server=` for testing.

## Railway

Push to `main` deploys `game-server` (client-only commits are skipped by its watch paths). Health:

```bash
curl -s https://game-server-production-b9f9.up.railway.app/health
```

`DATABASE_URL` comes from the Railway Postgres plugin. `LINK_SALT` (optional) salts the
soft anti-alt hashes (`server/src/link.mjs`); default salt is used when unset.

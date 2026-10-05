# Deploy

| Piece | Host | Project | Root | Notes |
|---|---|---|---|---|
| Browser client | Vercel | **`selva-oscura`** (team `stotna`) | `client/` | Production. Git-connected to `main`; `client/vercel.json` drives the build (`npm install` → `npm run build` → `dist`, SPA rewrite, immutable `/assets`). |
| Game server | Railway | `selva-oscura` → service `game-server` | `server/` | `npm start`; `/health`. Migrations in `server/migrations/` run on boot (additive). |

## Vercel: `selva-oscura` vs `client`

There are two Vercel projects in the team that point at this repo:

- **`selva-oscura`** — the real one. Root Directory `client`, so it reads
  `client/vercel.json`. Every push to `main` builds and goes to Production
  (`https://selva-oscura-murex.vercel.app` plus any custom domain).
- **`client`** — a stray duplicate, created by running `vercel` *inside* `client/`
  (that left `client/.vercel/project.json` linked to it). Its Root Directory is the repo
  root `.`, where there is no app, so every git push produced a failed Production
  deployment (4–6 s, `Error`).

Fix in the repo: the root `vercel.json` sets `"git": { "deploymentEnabled": false }`.
Only a project whose Root Directory is the repo root reads that file — i.e. the stray
`client` project — so its git builds stop; `selva-oscura` (root `client/`) is untouched.

Optional dashboard clean-up (not done from the repo — it is a settings change on
Vercel): disconnect Git from, or delete, the `client` project. Locally, re-link the
`client/` folder to the right project before any CLI deploy:

```bash
cd client && vercel link --project selva-oscura --scope stotna   # or run `vercel` from the repo root
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

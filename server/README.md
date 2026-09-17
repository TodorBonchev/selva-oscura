# selva-oscura-server

Authoritative multiplayer game server (Slice 1).

## Responsibilities

- Combat resolution, pack/boss AI, drop rolls, quest completion
- Integer **Ash** ledger (Phase 1 custody, **in-memory** for Slice 1)
- Off-chain auction house (list / buy / bid)
- Cap tracking (daily quest, boss hourly, first-clear per canto)
- Pending Ash grants from `event_type` via `remaining * p[event]` — never an arbitrary amount
- **Devnet vault PDA:** spec-only — credits `pendingAsh` locally; see `GET /emits`

## Protocol

WebSocket path: `/ws` (JSON). See `shared/game-core/src/protocol.ts`.

Rooms: `inferno_01` (Dark Wood hub), `inferno_05` (Lust).

## Run locally

```bash
cd server && npm install && npm start
# PORT default 8080; content from ./content (bundled) or CONTENT_ROOT
```

- `GET /health`
- `GET /ah`
- `GET /emits`
- `WS /ws`

## Docker / Railway

Dockerfile assumes build context = `server/` (bundled `content/` + `vendor/`).

```bash
# from server/
docker build -t selva-oscura-server .
```

After editing monorepo `content/`, run `scripts/sync-content.sh` from repo root before deploy.

Port from `PORT` env (8080). Keep `/health`.

## Slice 1 notes

- No Postgres yet — state resets on restart.
- Custom authoritative rooms over `ws` (Colyseus-class trust model without the dependency).

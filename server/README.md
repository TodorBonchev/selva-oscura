# selva-oscura-server

Authoritative multiplayer game server.

## Responsibilities

- Combat resolution, pack/boss AI, drop rolls, quest completion
- Integer **Ash** ledger (Phase 1 custody)
- Off-chain auction house
- Cap tracking (daily quest, boss hourly, first-clear per canto)
- Calls vault `emit` with `event_type` only — never an arbitrary payout amount

## Stack lean

- Colyseus-class rooms (one room per canto instance)
- Postgres for characters, items, AH, Ash balances
- Solana client for Devnet/mainnet vault emit + claim relay

## Slice 1 rooms

- `inferno_01` — Dark Wood hub
- `inferno_05` — Lust (packs + one boss)

## Fly.io (stub)

Deployable health stub (`index.mjs`) listens on port 8080:

- `GET /health` — JSON health check
- `WS /ws` — echo placeholder

Config: `fly.toml` (`app = selva-oscura`, `primary_region = fra`).
Set `DATABASE_URL` via `fly secrets set` (never commit it).

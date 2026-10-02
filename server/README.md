# selva-oscura-server

Authoritative multiplayer game server (Slice 1).

## Responsibilities

- Combat resolution, pack/boss AI, drop rolls, quest completion
- Integer **Ash** ledger (Phase 1 custody — **Postgres** when `DATABASE_URL` is set, else in-memory)
- Off-chain auction house (list / buy / bid)
- Cap tracking (daily quest, boss hourly, first-clear per canto)
- Pending Ash grants from `event_type` via `remaining * p[event]` — never an arbitrary amount
- **Devnet vault PDA:** spec-only — credits `pendingAsh` locally; see `GET /emits`

## Protocol

WebSocket path: `/ws` (JSON). See `shared/game-core/src/protocol.ts`.

Rooms: `inferno_01` (Dark Wood hub), `inferno_05` (Lust), `inferno_06` (Gluttony), `inferno_07` (Avarice), `inferno_31` (Pozzo dei Giganti, arena). The hub's west exit (`← Pozzo dei Giganti (PvP)`) enters the arena with no clear required. `inferno_31` does not wrap: moves, dashes, and shoves clamp to the wall.

### Consensual PvP

Player→player damage only happens in the arena free-for-all, or between the two fighters of a duel whose phase is `fight`. Hub duels are casual (Elo K=20). Arena `pvp_queue` pairs a ranked 1v1 (K=32) on the north ring. A downed pilgrim is not killed: no Ash or item loss, no PvE death wake.

Client → server: `duel_challenge`, `duel_respond`, `duel_cancel`, `pvp_queue`, `pvp_leaderboard`. An `attack` whose `targetId` is another player in the room is a PvP swing (windup, then a cone check).

Server → client: `duel_invite`, `duel_pending`, `duel_declined`, `duel_state`, `pvp_windup`, `pvp_down`, `pvp_kill`, `pvp_round`, `pvp_queue`, `pvp_leaderboard`. Invite `expiresIn` is seconds. Active duels ride the room snapshot as `duels`; the arena snapshot adds `arena`.

`GET /pvp/leaderboard` returns the top 20. Ratings and arena kills persist in `pvp_stats` (migration `004_pvp.sql`) when `DATABASE_URL` is set.

```bash
cd server && node scripts/pvp-regression.mjs   # or npm run test:pvp
```

`SELVA_PVP_ROUND_SEC` overrides the 180s arena round when `NODE_ENV` is not `production`.

### Levels and the skill tree

Characters go from level 1 to 50. XP is server-side (`grantXp` in `src/progression.mjs`). `xpToNext(L) = round(60·L^1.65 + 40·L)` (100 from 1→2). Four branches — Ira, Fede, Ombra, Fortezza — hold 24 skills. Every pilgrim starts with `gale_bolt`, `whirl_ward`, and `infernal_burst` at rank 1 (free) and loadout `[gale_bolt, whirl_ward, infernal_burst, null]`. Level L has `(L−1)` skill points. Old clients that only cast those three spells keep working.

Client → server: `skill_learn {skillId}`, `skill_loadout {slots}` (exactly four, `null` allowed), `skill_respec {}` (costs `200 × level` Ash; refused while downed or in a duel countdown/fight). `cast {spellId}` accepts any learned active in the loadout.

Server → client: `you.prog` on the snapshot (`level`, `xp`, `xpToNext`, `xpIntoLevel`, `points`, `ranks`, `loadout`, `cds`), remotes carry `lv`, `xp_gain`, `level_up`, `skill_result`, `spell_fx` (optional `hits`), `room.skillFx` for glyphs/shades/burns/vortexes. Arena board and leaderboard rows include `lv`.

Progress persists in `player_progress` (migration `005_progression.sql`) when `DATABASE_URL` is set. Existing characters with first-clears and no progress row are backfilled once (800 XP × canto tier).

```bash
cd server && node scripts/progression-regression.mjs   # or npm run test:levels
```

Self-play `--skills` spends points into a PvE build and puts `furious_cleave` on the loadout.

Map edges wrap around (torus): a move, dash or shove that crosses an edge continues from
the opposite side, and the move budget measures the shortest wrapped step (`src/wrap.mjs`).
Mobs, projectiles, hazards and loot stay inside the bounds.

Reconnect: clients send `hello` with a display `name`. The server restores the existing
character row (ash, pendingAsh, inventory, first-clears, quest flags) when that name
already exists (case-insensitive). A second `welcome` may be sent with the stable
`playerId` so the client updates.

## Persistence (Postgres / Neon)

Set `DATABASE_URL` (Neon requires SSL; connection strings with `sslmode=require` work).

On boot the server:

1. Connects with `pg` (node-postgres)
2. Runs idempotent SQL migrations from `migrations/`
3. Hydrates vault, players, inventory, AH listings, emit log, caps, PvP, and progression into memory

Meaningful writes are persisted: ash changes, loot grants, inventory location, AH
list/buy/bid (buy/bid use a DB transaction), emit grants, first-clear / daily caps,
vault remaining.

If `DATABASE_URL` is missing, the server logs a clear warning and runs fully in-memory
(local dev). State then resets on process restart.

### Schema (`migrations/001_init.sql`)

| Table | Purpose |
|---|---|
| `players` | id, name/display, ash, pending_ash, quest/cap fields |
| `inventory_items` | server-owned items (seed, rarity, affixes JSON, owner, location, soulbound) |
| `ah_listings` | item, seller, price_ash, bids JSON, highest bid, status |
| `first_clears` | per-player per-canto first clear |
| `emit_log` | public emit history |
| `emit_caps_global` | global boss hourly counter |
| `vault_state` | remaining ash/stelle mirror for the emit formula |
| `schema_migrations` | applied migration ids |
| `pvp_stats` (`004_pvp.sql`) | rating, peak, wins/losses/draws, kills/deaths, best streak, rounds won, cosmetic title |
| `player_progress` (`005_progression.sql`) | level, total xp, skill ranks JSON, loadout JSON, backfill flag, respec count |

### Migrate

Migrations also run automatically on server boot when `DATABASE_URL` is set.

One-shot against Neon (never echo the URL):

```bash
cd server
# Prefer --env-file so URL special chars are not expanded by the shell:
node scripts/migrate.mjs --env-file /path/to/selva-oscura-neon.env
```

Or: `DATABASE_URL=… npm run migrate`

## Run locally

Local playtests use the `dev` branch, a Postgres instance on this machine, and the client pointed at `http://127.0.0.1:8080`. Do not point that client at the Railway server.

```bash
cd server
npm install
npm run db
```

`npm run db` starts an embedded Postgres on port 5433 (data in `server/.pgdata`, gitignored), creates database `selva`, and writes `server/.env` if it is missing:

`postgresql://selva:selva_local@127.0.0.1:5433/selva`

Then:

```bash
npm start
```

The server reads `.env` only for variables that are not already set, runs migrations, and listens on 8080. `GET /health` should say `persistence: postgres`.

In `client/.env.local` (gitignored):

```
VITE_GAME_SERVER_URL=http://127.0.0.1:8080
```

Restart `npm run dev` in `client/` so Vite picks that up. Open `http://127.0.0.1:5173/`.

Omit `DATABASE_URL` only if you want a throwaway in-memory ledger.

- `GET /health` — includes `persistence: "postgres" | "memory"`
- `GET /ah`
- `GET /emits`
- `WS /ws`

## Self-play regression bot

`scripts/selfplay.mjs` plays the whole Slice 1 road through the real protocol —
Dark Wood (Guide, pyre, stash, AH, writ) → Lust → Gluttony → Avarice → Dark Wood —
checking sealed roads, first clears, loot, and that remote travel is refused, and
prints per-canto time / deaths / lowest HP / damage taken.

```bash
npm start                                   # in another terminal
node scripts/selfplay.mjs                   # one skilled run
node scripts/selfplay.mjs --style naive --runs 2   # melee + flask only
node scripts/selfplay.mjs --coop            # a party of two sharing rooms
```

Exits non-zero if any canto cannot be cleared.

## Postgres AH / melt regression

`npm run test:pg` (`scripts/pg-ah-regression.mjs`) starts its own server on
`PORT_TEST` (default 8091) and checks AH list / buy / cancel and bag melt across
restarts. It needs a **local** Postgres (`npm run db`) and refuses Neon/Railway/Supabase URLs.

```bash
DATABASE_URL=postgresql://selva:selva_local@127.0.0.1:5433/selva npm run test:pg
```

## Docker / Railway

Dockerfile assumes build context = `server/` (bundled `content/` + `vendor/` + `migrations/`).

```bash
# from server/
docker build -t selva-oscura-server .
```

After editing monorepo `content/`, run `scripts/sync-content.sh` from repo root before deploy.

Port from `PORT` env (8080). Keep `/health`.

Railway: set `DATABASE_URL` to the Neon connection string (already configured for
project `weathered-resonance-13759058` / database `selva`). Deploy watches `server/**`.

## Verify restart-safe state

1. Connect with `?name=TestHero`, earn ash / pick up loot / list on AH
2. Restart the server process
3. Reconnect with the same `name` — ash, inventory, pendingAsh, and active AH listings
   should match; `/health` should report `persistence: "postgres"`

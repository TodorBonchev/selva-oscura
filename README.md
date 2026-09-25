# Selva Oscura

Browser persistent multiplayer ARPG set across the hundred cantos of Dante’s *Divina Commedia*. Loot is Diablo 2–style; economy is STELLE on Solana.

| | |
|---|---|
| **Game** | Selva Oscura |
| **Ticker** | STELLE |
| **Subunit** | Ash = 0.001 STELLE (fixed display mapping, never a second token) |
| **World** | Exactly 100 cantos — Inferno 34 + Purgatorio 33 + Paradiso 33 |
| **Hub** | Inferno I (Dark Wood) — hub, not circle-0 combat |

## Slice 1 — playable vertical

Dark Wood hub → Lust (Inferno V) packs + champion + boss `minos_gate` → server-side D2 loot → off-chain AH in integer Ash → pending Ash emits (`DailyQuest` | `ChampionPack` | `Boss` | `FirstClear`).

**Devnet vault PDA is spec-only in Slice 1** — emits credit `pendingAsh` on the server ledger (`GET /emits`). No mainnet mint / DEX.

### Play

| | |
|---|---|
| **Client (Vercel)** | Builds from `client/` → `dist` |
| **Game server (Railway)** | `https://game-server-production-b9f9.up.railway.app` |

Local client against local server:

```bash
# terminal 1
cd server && npm install && npm start   # :8080

# terminal 2
cd client && npm install
VITE_GAME_SERVER_URL=http://localhost:8080 npm run dev
# or open http://localhost:5173/?server=http://localhost:8080
```

Production client default: `VITE_GAME_SERVER_URL` → Railway URL above (override in Vercel env or `?server=`).

### Controls

Click / stick / WASD move · click foes or Attack · loot pickup · E / Interact · **I**/Inv · **H**/AH. Mobile (portrait or landscape): left virtual stick + right-thumb arc (Attack, spells, Dash, Flask, context **Use**). Bank items at the Dark Wood stash.

### Legal

- Dante’s poem is public domain. Use **original Italian** or a **public-domain translation only**.
- Do **not** name the game *La Divina Commedia* or *Dante’s Inferno*.
- Do **not** use modern translation text or assets from any other Dante game.

## Monorepo map

```
selva-oscura/
  docs/                 Phased plan, vault spec, architecture
  client/               Three.js 3D world (Vite → dist); DOM HUD
  server/               Authoritative game server (ws rooms)
  shared/game-core/     Shared types (Ash, EventType, rarity, …)
  content/              AI-readable cantos, drops, economy, style bible
  programs/stelle-vault/ Solana vault program (spec for builder)
  sim/                  Headless economy / season simulator
```

After editing `content/`, refresh the Railway-bundled copy:

```bash
server/scripts/sync-content.sh
```

## Start here

1. Locked decisions: [`PROJECT_BRIEF.md`](./PROJECT_BRIEF.md) — do not reopen token math.
2. Build order: [`docs/PHASED_PLAN.md`](./docs/PHASED_PLAN.md) — Slice 1 is the only honest months target.
3. Vault accounts + instructions: [`docs/VAULT_SPEC.md`](./docs/VAULT_SPEC.md) and [`programs/stelle-vault/README.md`](./programs/stelle-vault/README.md).
4. Architecture: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Launch rule (locked)

Do **not** put STELLE on a public DEX before three cantos are playable. Devnet vault first, then mainnet mint → fill vault PDA → lock vest → seed + lock LP → public dashboard.

## License

MIT — see [`LICENSE`](./LICENSE).

# Architecture — Selva Oscura

## Trust model

```
Browser client (untrusted)
    → Authoritative game server (combat, drops, quests, Ash ledger)
        → Pending Ash grants
            → Solana stelle-vault (300M PDA, emit-only)
                → claim / withdraw → player wallet
```

- Client never decides hits, loot, or quest completion.
- Vault program computes `payout = remaining * p[event_type]`; server passes event type + cap ids, **not** an amount.
- Players do **not** need SOL to walk, fight, or turn in a quest. Studio/relayer may pay settle/claim fees.

## Packages

| Path | Role |
|---|---|
| `client/` | Three.js 3D world (bronze-statue kit); DOM UI for AH / inventory |
| `server/` | Colyseus-class rooms — one room per canto instance |
| `shared/game-core/` | Ash integer types, EventType, ItemRarity, shared constants |
| `content/` | Cantos, drop tables, economy JSON, style bible |
| `programs/stelle-vault/` | Anchor/Solana program (builder-owned deploy) |
| `sim/` | Headless season / economy simulation |

## Persistence

- **Postgres:** characters, items (seed + affixes), AH listings, Ash balances, first-clear flags.
- **Solana:** STELLE mint movement only (deposit / withdraw / fat AH settlement / tournament buy-in).
- Items are **server objects**. Optional NFT receipt only when listed on-chain.

## Rooms

- One authoritative room per canto instance (hub Dark Wood; Lust; later each Inferno node).
- Inferno: hunt, packs, bosses, raw D2 loot.
- Purgatorio: group terraces, craft sinks (later slices).
- Paradiso: trials / PvP status — almost no trash loot (later).

## Money layers

1. **Server ledger** — integer Ash for play.
2. **Chain** — deposit, withdraw, large AH settlement, cup buy-in.
3. HUD may show Stelle and Ash as the same balance (÷1000).

## Open-source / audit posture

Open-source client + server for audit. Safety = verified program id + caps + public emit log + pause guardian. Builder mints SPL, deploys vault, owns PDAs personally.

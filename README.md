# Selva Oscura

Browser persistent multiplayer ARPG set across the hundred cantos of Dante’s *Divina Commedia*. Loot is Diablo 2–style; economy is STELLE on Solana.

| | |
|---|---|
| **Game** | Selva Oscura |
| **Ticker** | STELLE |
| **Subunit** | Ash = 0.001 STELLE (fixed display mapping, never a second token) |
| **World** | Exactly 100 cantos — Inferno 34 + Purgatorio 33 + Paradiso 33 |
| **Hub** | Inferno I (Dark Wood) — hub, not circle-0 combat |

## Legal

- Dante’s poem is public domain. Use **original Italian** or a **public-domain translation only**.
- Do **not** name the game *La Divina Commedia* or *Dante’s Inferno*.
- Do **not** use modern translation text or assets from any other Dante game.

## Monorepo map

```
selva-oscura/
  docs/                 Phased plan, vault spec, architecture
  client/               Browser client (Phaser lean, isometric 2D)
  server/               Authoritative game server
  shared/game-core/     Shared types (Ash, EventType, rarity, …)
  content/              AI-readable cantos, drops, economy, style bible
  programs/stelle-vault/ Solana vault program (spec for builder)
  sim/                  Headless economy / season simulator
```

## Start here

1. Locked decisions: [`PROJECT_BRIEF.md`](./PROJECT_BRIEF.md) — do not reopen token math.
2. Build order: [`docs/PHASED_PLAN.md`](./docs/PHASED_PLAN.md) — Slice 1 is the only honest months target.
3. Vault accounts + instructions: [`docs/VAULT_SPEC.md`](./docs/VAULT_SPEC.md) and [`programs/stelle-vault/README.md`](./programs/stelle-vault/README.md).
4. Architecture: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Launch rule (locked)

Do **not** put STELLE on a public DEX before three cantos are playable. Devnet vault first, then mainnet mint → fill vault PDA → lock vest → seed + lock LP → public dashboard.

## Token buckets (locked, summary)

| Bucket | % | Notes |
|---|---|---|
| Play vault | 30% (300M) | PDA, emit-only, no owner withdraw |
| Founder | 20% (200M) | Vesting: 0% TGE, 12-mo cliff, 36–48 mo linear |
| Liquidity + market | ~15–20% | Builder-seeded DEX; LP locked/burned |
| Treasury / ops | ~15% | Multisig |
| Community / testers / leftover | rest | Closed alpha, first-clears, buffer |

Builder mints the SPL token, deploys the vault program, and owns the PDAs personally.

## License

MIT — see [`LICENSE`](./LICENSE).

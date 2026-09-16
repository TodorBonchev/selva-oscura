# Project brief — Selva Oscura / STELLE (LOCKED)

Continue from locked decisions. Do not reopen settled token math unless the builder changes it.
Builder will mint the SPL token, deploy the vault program, and own the PDAs personally.
First deliverable: phased build plan + repo/file layout for a browser persistent ARPG, AI-readable content, and a Solana vault — not a new brainstorm.

## What it is
Browser persistent multiplayer ARPG (Diablo 2 loot + shared AH + PvP cups), not WoW-scale MMO at v1. World graph = exactly 100 cantos of Dante’s Divine Comedy (Inferno 34 + Purgatorio 33 + Paradiso 33). Inferno I (Dark Wood) is the hub, not “circle 0 combat.”

Play split by canticle:
- Inferno: hunt, packs, bosses, raw D2 loot
- Purgatorio: group terraces, craft, identify, repair sinks
- Paradiso: trials / spheres / PvP status — almost no trash loot

Legal: poem is public domain. Do NOT name the game La Divina Commedia or Dante’s Inferno. Use original Italian or a PD translation only; no modern translation text; no assets from other Dante games.

## Names (preferred)
- Game: Selva Oscura (alts: The Hundred Cantos, Contrapasso)
- Coin ticker: STELLE (not CANTO)
- Subunit: Ash = 0.001 STELLE, fixed, never a second token / never an AMM between them
- HUD may show `12.847 Stelle` and `12,847 Ash` as the same balance

## Tokenomics (locked)
Mint 1,000,000,000 STELLE (hard cap), decimals such that 1 STELLE = 1,000 Ash (3 display decimals; 6 on-chain with UI mapping is fine).

| Bucket | % | Tokens | Where |
|---|---|---|---|
| Play vault | 30% | 300M | PDA, emit-only, no owner withdraw |
| Founder | 20% | 200M | Vesting: 0% at TGE, 12-month cliff, 36–48 months linear |
| Liquidity + market | ~15–20% | — | DEX pool seeded by builder; LP locked/burned |
| Treasury / ops | ~15% | — | Multisig |
| Community / testers / leftover | rest | — | Closed alpha, first-clears, buffer |

No liquid founder bag at launch. Vest and vault addresses published before any public sale.

Emission (disinflation of *new* coins):
- Vault remaining R, start R = 300_000_000
- Eligible events only: daily quest, champion pack, boss, first-clear — NEVER every trash kill
- payout = R * p[event_type], then R -= payout
- Starting p to tune: daily quest 1e-7, champion 1e-7–5e-7, boss 5e-7, first-clear 2e-6
- Caps: 1 daily quest emit/player/day; per-player and global hourly boss caps; first-clear once per canto per account
- Optional: max ~0.01% of remaining vault per UTC day globally

Burns (real deflation): AH tax ~6% (half burn / half treasury), identify/reroll, unique repair slice, withdraw 1–2%, tournament entry 50% prize / 35% burn / 15% treasury.

Two-layer money:
- Server ledger in integer Ash for play
- Chain for deposit / withdraw / fat AH settlement / tournament buy-in
- Players do not need SOL to walk, fight, or turn in a quest
- Studio or relayer pays settle/claim fees

Launch sequence: do NOT put STELLE on a public DEX before three cantos are playable. Devnet vault first. Then mainnet mint → fill vault PDA → lock vest → seed + lock LP → public dashboard.

## Items / AH / PvP
- D2-style: Normal / Magic / Rare / Set / Unique / season Canto-Unique
- Items are server objects (seed + affixes). Optional NFT receipt only when listed on-chain
- Unbound rares trade on global AH for STELLE. Season uniques soulbound
- No fiat loot boxes
- PvP: solo + 3v3; Inferno blood arenas, Purgatorio rated, Paradiso weekly cup

## Architecture
Browser client → authoritative game server → pending Ash grants
→ Solana vault program (300M PDA)
→ claim/withdraw → player wallet

- Client untrusted. Server decides combat, drops, quest completion
- Vault instructions: emit (game authority), claim, pause (separate guardian key)
- Program computes payout from event_type + remaining; server cannot choose arbitrary amount
- Phase 1 custody (balance on server, withdraw button). Phase 2 daily Merkle. Phase 3 on-chain AH receipts only if needed
- Authority: server key + hardware pause key; later 2-of-3. p changes only via long timelock
- Open-source client + server for audit. Safety = verified program id + caps + public emit log + pause

Tech leaning: Phaser or Three + DOM UI for AH/inventory; Colyseus-class authoritative rooms (one room per canto instance); Postgres for chars/items/AH; Solana only for STELLE movement.

## AI / content pipeline (required)
Every canto is JSON:
- content/cantos/inferno_05.json (geo, packs, bosses, drop table ids)
- drop tables, affix pools, economy/burns.json, style/bible.md
- Headless: sim season --days 90 --players 4000 --seed 42
- Art from one style bible (Doré etching, bone/gold). 12 circle kits. Inferno red-black, Purgatory marble-dawn, Paradiso white-gold

## Scope / slices
0. JSON schema + sim + style bible + 1 canto mock
1. Dark Wood + Lust (Inf V) + one boss. D2 loot. Off-chain AH. Devnet vault only
2. Full Inferno (34 nodes), Ash economy, bot density
3. Mainnet STELLE + vault + vest + locked LP + global AH + burns
4. Purgatorio + craft sinks
5. Solo + 3v3
6. Paradiso trials + seasonal uniques

Slice 1 is the only honest “months” target.

## Open (not locked)
- Isometric 2D vs low-poly 3D (lean 2D)
- Exact p table after a sim
- Final title if not Selva Oscura
- Exact treasury / LP / community leftover % inside non-vault, non-vest remainder

## What to create NOW (this task)
1. Phased plan + monorepo layout (client/, server/, shared/game-core, content/cantos, programs/stelle-vault, sim/)
2. Specify vault program accounts + emit constraints (builder implements the program)
3. Draft inferno_01 + inferno_05 JSON schemas and a drop-table example
4. Style bible prompts for Imagine
5. Do NOT design 100 zones or a public token launch first

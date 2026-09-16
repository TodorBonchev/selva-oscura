# Phased plan — Selva Oscura / STELLE

Immutable constraints from `PROJECT_BRIEF.md`. Slice 1 is the only honest “months” target. Lean **isometric 2D** (Phaser). No 100-zone design pass. No public DEX-first launch.

---

## Slice 0 — Content foundation

**Goal:** AI-readable content pipeline + style bible + one canto mock + headless sim stub.

**Depends on:** nothing (repo bootstrap).

**Deliverables**
- JSON schemas for cantos and drop tables
- `inferno_01` (Dark Wood hub) mock + style bible + Imagine prompts
- Economy JSON (`burns.json`, `emit_rates.json`) from locked numbers
- `shared/game-core` types (Ash integer, EventType, ItemRarity)
- `sim/` package stub that can load content and print a dry-run summary

**Exit criteria**
- [ ] Schemas validate `inferno_01.json` and at least one drop table
- [ ] Style bible documents Doré etching / bone-gold + three canticle palettes + 12 circle kits
- [ ] Emit rates and burns match locked brief (no invented token math)
- [ ] `sim` package installs and runs a no-op or dry-run against content paths
- [ ] No playable client required

---

## Slice 1 — First playable (honest months target)

**Goal:** Dark Wood hub + Lust (Inferno V) + one boss. D2-style loot. Off-chain AH. Devnet vault only.

**Depends on:** Slice 0 exit.

**Deliverables**
- Lean isometric Phaser client: hub navigation, Lust instance, one boss encounter
- Authoritative server rooms (Colyseus-class) for hub + Lust
- D2 loot pipeline (Normal → Unique) from drop tables; server-owned item objects
- Off-chain auction house (server ledger in integer Ash)
- Devnet `stelle-vault`: emit / claim / pause; payout from `event_type` + remaining
- Content: `inferno_01` + `inferno_05` live; first-clear emit wired once

**Exit criteria**
- [ ] Player can enter Dark Wood, travel to Lust, clear packs, kill the one boss
- [ ] Loot drops resolve server-side; inventory + off-chain AH list/bid in Ash
- [ ] Eligible emits only: DailyQuest | ChampionPack | Boss | FirstClear (caps enforced)
- [ ] Devnet vault: PDA holds mock 300M; `emit` computes `remaining * p[event]`; server cannot pass arbitrary amount
- [ ] Pause key separate from game authority; claim moves pending Ash → wallet on Devnet
- [ ] **No** public mainnet mint, **no** public DEX listing, **no** 100-canto design
- [ ] Slice duration is the only schedule commitment treated as “months”

---

## Slice 2 — Full Inferno + Ash economy

**Depends on:** Slice 1 exit.

**Deliverables**
- All 34 Inferno canto nodes (content + rooms); bot density for sparse populations
- Ash economy live end-to-end in Phase 1 custody (server balance + withdraw button)
- Tuned `p` table after sim runs (`sim season --days 90 …`)

**Exit criteria**
- [ ] 34 Inferno nodes traversable with packs/bosses as content specifies
- [ ] Bot fillers keep instances alive without faking player counts in UI
- [ ] Daily/hourly/first-clear caps hold under load tests
- [ ] Sim report accepted for p-table before mainnet

---

## Slice 3 — Mainnet STELLE + global AH + burns

**Depends on:** Slice 2 exit **and** ≥3 cantos playable (launch rule).

**Deliverables**
- Mainnet mint 1B STELLE; fill vault PDA 300M; founder vest locked; LP seeded + locked/burned
- Global AH settlements that touch chain for fat trades; burn sinks live
- Public dashboard: vault remaining, emit log, vest addresses

**Exit criteria**
- [ ] Vault emit-only verified on mainnet; no owner withdraw path
- [ ] Vest: 0% TGE, 12-mo cliff, 36–48 mo linear — addresses published
- [ ] AH tax / identify / repair / withdraw / tournament burn splits match `content/economy/burns.json`
- [ ] Public DEX only after this slice’s playable bar, not before

---

## Slice 4 — Purgatorio + craft sinks

**Depends on:** Slice 3 exit.

**Deliverables**
- Purgatorio terrace graph (33); group content; craft / identify / repair sinks
- Marble-dawn palette and terrace kits from style bible

**Exit criteria**
- [ ] Craft/identify/repair burn Ash on server ledger and settle burns per economy JSON
- [ ] Group terrace content playable without Inferno trash-loot density

---

## Slice 5 — PvP (solo + 3v3)

**Depends on:** Slice 4 exit (or Slice 3 if PvP arenas share Inferno blood maps — product call, not locked).

**Deliverables**
- Solo + 3v3; Inferno blood arenas; rated ladder scaffolding toward Purgatorio rated

**Exit criteria**
- [ ] Matchmaking + cup entry fees split per burns.json (50% prize / 35% burn / 15% treasury)
- [ ] No fiat loot boxes; season uniques remain soulbound

---

## Slice 6 — Paradiso + seasonal uniques

**Depends on:** Slice 5 exit.

**Deliverables**
- Paradiso trials / spheres; weekly cup; seasonal Canto-Unique items
- White-gold palette; almost no trash loot

**Exit criteria**
- [ ] Trials and weekly cup live; seasonal uniques drop and bind correctly
- [ ] Content pipeline supports season reset without vault math changes

---

## Dependency graph (summary)

```
0 → 1 → 2 → 3 → 4 → 5 → 6
         └───── launch rule: ≥3 cantos before public DEX (enforced at 3)
```

## Out of scope for all slices until explicitly unlocked

- Reopening mint size, vault %, Ash ratio, or emit formula
- Designing all 100 zones before Slice 1 ships
- Public DEX-first token launch
- NFT-izing every item (receipts optional when listed on-chain only)

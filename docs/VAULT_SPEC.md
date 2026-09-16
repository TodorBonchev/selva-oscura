# STELLE vault program — specification

Builder implements and deploys this program. Studio does not reopen token math. This doc is the contract for accounts, instructions, and constraints.

## Purpose

Hold the **300,000,000 STELLE** play vault (30% of 1B hard-cap mint). **Emit-only**: no owner withdraw. Payouts for eligible play events are computed on-chain from remaining balance and locked `p[event_type]`. Players claim to their wallet. Phase 1 = server custody of play balances with an explicit withdraw/claim path.

## Units

| Layer | Unit | Rule |
|---|---|---|
| On-chain SPL | STELLE (mint decimals; 6 on-chain with UI mapping is fine) | Hard cap 1_000_000_000 |
| Display / server ledger | **Ash** = integer; `1 STELLE = 1_000 Ash` | Never a second mint; never an AMM Ash↔STELLE |
| HUD | May show `12.847 Stelle` and `12,847 Ash` as the **same** balance | Mapping only |

Server ledger is always **integer Ash**. Vault emits STELLE (or base units); claim path converts for display via Ash mapping.

---

## Accounts

### Config (PDA)

Seeds: `["stelle_vault_config", mint.key()]` (exact seeds chosen by builder; document in IDL).

| Field | Type | Notes |
|---|---|---|
| `authority` | Pubkey | Game/server authority — may call `emit` |
| `guardian` | Pubkey | **Separate** pause key — may call `pause` / `unpause` only |
| `mint` | Pubkey | STELLE mint |
| `vault_token` | Pubkey | Token account (PDA) holding remaining play supply |
| `remaining` | u64 | Mirrored remaining base units (must match token account after emits) |
| `paused` | bool | When true, `emit` and optionally `claim` blocked per policy |
| `p_daily_quest` | u64 | Fixed-point rate (see Rate encoding) |
| `p_champion_pack` | u64 | |
| `p_boss` | u64 | |
| `p_first_clear` | u64 | |
| `p_authority` | Pubkey | Who may propose `p` changes |
| `p_timelock_seconds` | i64 | Long timelock before `p` updates apply |
| `pending_p_*` / `p_eta` | … | Pending rates + activation timestamp |
| `bumps` | u8… | PDA bumps |

### Vault token account (PDA)

ATA or token account owned by the vault PDA. Initial fill: **300_000_000 STELLE** (in mint base units). **No instruction** may transfer out except `emit`→pending and `claim`→player (or combined emit-claim if designed that way). **No** `withdraw_authority` / owner skim.

### Pending claim (per player, PDA or escrow)

Seeds e.g. `["stelle_pending", config, player]`.

| Field | Type | Notes |
|---|---|---|
| `owner` | Pubkey | Player wallet |
| `amount` | u64 | Accrued claimable base units |
| `last_emit_slot` | u64 | Audit / replay aid |

Phase 1 may keep most balance server-side and only push to pending on withdraw request; the program must still never accept an arbitrary payout amount from the server.

### Optional: emit log / event accounts

Prefer Anchor events + indexer. If on-chain ring buffer is used, document size and overwrite policy. Public emit log is part of safety story.

---

## Rate encoding

`payout = remaining * p[event_type] / P_SCALE` (integer math; floor).

Starting targets from brief (tune via sim; changes only through timelock):

| EventType | Starting p (approx) | Notes |
|---|---|---|
| `DailyQuest` | 1e-7 | Cap: 1 emit / player / day |
| `ChampionPack` | 1e-7 … 5e-7 | Pack clear of champion density |
| `Boss` | 5e-7 | Per-player + global hourly caps |
| `FirstClear` | 2e-6 | Once per canto per account |

`P_SCALE` example: `1_000_000_000_000` (1e12) so `p_boss = 500_000` ≈ 5e-7. Builder picks scale; document in IDL. Optional global: max ~0.01% of remaining vault per UTC day.

**Server cannot pass arbitrary amount.** Instruction takes `event_type` (+ ids for cap checks); program reads `remaining` and `p[*]`.

---

## Instructions

### `initialize`

- Create config + vault token PDA; set authority, guardian, initial `p_*`, timelock.
- Transfer or receive initial **300M** into vault token account; set `remaining`.

### `emit`

**Signer:** `authority` (game server key).  
**Blocked if:** `paused`.

Args (conceptual):
- `event_type`: `DailyQuest | ChampionPack | Boss | FirstClear`
- `player`: beneficiary wallet
- Cap proof fields as needed (canto id for FirstClear, day bucket, hour bucket) — server supplies **identifiers**, not amounts.

Effects:
1. Load `p` for `event_type`.
2. `payout = remaining * p / P_SCALE` (if 0, no-op or error).
3. Enforce caps (see below); fail if exceeded.
4. `remaining -= payout`; debit vault token account into pending (or direct claim escrow).
5. Emit event for public log.

### `claim`

**Signer:** player (or relayer with player auth — studio may pay fees).

Transfer `pending.amount` to player ATA; zero pending. Phase 1 custody: server initiates withdraw → `emit` or credit-pending then player `claim`.

### `pause` / `unpause`

**Signer:** `guardian` only (hardware key). Authority cannot pause. Guardian cannot emit.

### `propose_p_change` / `apply_p_change`

**Signer:** `p_authority` (may equal authority or multisig later).  
Propose new `p_*`; store with `Clock::unix_timestamp + p_timelock_seconds`. `apply_p_change` only after ETA. No instant p edits.

### Authority rotation (later)

Document 2-of-3 path; Phase 1 may be single server key + hardware pause.

---

## Caps (must enforce; where noted may be server+chain)

| Cap | Rule |
|---|---|
| Daily quest | ≤ 1 emit / player / UTC day |
| Boss | Per-player hourly + global hourly caps |
| First clear | Once per canto id per account |
| Optional daily vault | ≤ ~0.01% of remaining per UTC day globally |

Chain should enforce what it can (first-clear bitmap / daily buckets); server enforces the rest but **cannot** inflate amount.

---

## EventType enum (shared with `shared/game-core`)

```
DailyQuest = 0
ChampionPack = 1
Boss = 2
FirstClear = 3
```

Never emit on trash kills.

---

## Custody phases

| Phase | Behavior |
|---|---|
| **1 (this slice track)** | Balance on server (Ash). Withdraw button → pending → claim. |
| **2** | Daily Merkle roots for batch claims (optional). |
| **3** | On-chain AH receipts only if needed. |

---

## Safety checklist

- [ ] Verified program id published
- [ ] Caps + public emit log
- [ ] Pause via separate guardian
- [ ] No owner withdraw instruction
- [ ] p changes timelocked
- [ ] Vest + vault addresses published before any public sale

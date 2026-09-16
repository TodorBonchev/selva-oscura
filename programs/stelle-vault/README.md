# stelle-vault (Solana program)

Emit-only PDA vault for the **300M STELLE** play allocation. Builder mints the SPL token, deploys this program, and owns the PDAs personally.

Full account/instruction contract: [`../../docs/VAULT_SPEC.md`](../../docs/VAULT_SPEC.md).

## Accounts (summary)

| Account | Role |
|---|---|
| `Config` PDA | authority, guardian, mint, remaining, `p[event]`, timelock, paused |
| `VaultToken` PDA | Holds remaining play STELLE; debit only via emit→pending |
| `PendingClaim` PDA | Per-player claimable balance |
| Player ATA | Destination for `claim` |

## Instructions (summary)

| Ix | Signer | Behavior |
|---|---|---|
| `initialize` | deployer | Create PDAs; set p + timelock; vault filled with 300M |
| `emit` | game `authority` | `payout = remaining * p[event_type]`; caps; credit pending |
| `claim` | player (or relayer) | Pending → player ATA |
| `pause` / `unpause` | `guardian` only | Separate hardware key |
| `propose_p_change` / `apply_p_change` | `p_authority` | Long timelock before rates apply |

## Hard rules

- **No owner withdraw.** Emit-only.
- Server passes `EventType` (`DailyQuest | ChampionPack | Boss | FirstClear`), **not** an amount.
- Phase 1 custody: server Ash ledger + withdraw → claim.
- Ash display mapping (`÷1000`) is UI/server only — not a second mint.

## Status

Spec-only in this deliverable. No Anchor sources until builder implements.

# selva-oscura-sim

Headless economy / season simulator.

## Intended CLI (Slice 0 stub → Slice 2 real)

```bash
npx sim season --days 90 --players 4000 --seed 42
```

Loads `content/economy/emit_rates.json`, `burns.json`, canto/drop refs, and projects vault remaining `R` under `payout = R * p[event]` with caps.

## Slice 0 exit

Package installs; dry-run loads content paths and prints a summary. No need for full Monte Carlo until Slice 2 p-table lock.

# @selva-oscura/game-core

Shared types and constants for client, server, and sim.

## Locked conventions

- **Ash** is always an **integer** (never float). `1 STELLE = 1000 Ash`.
- **EventType** drives vault emits: DailyQuest, ChampionPack, Boss, FirstClear only.
- **ItemRarity** follows D2-style tiers including seasonal Canto-Unique.

Import from here instead of duplicating enums in client or vault IDL mappings.

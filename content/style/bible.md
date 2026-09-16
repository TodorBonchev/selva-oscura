# Style bible — Selva Oscura

Single visual system for all cantos. Art direction: **Gustave Doré etching** filtered through a **bone / gold** UI metal. Not anime, not AAA PBR realism, not borrowed frames from other Dante games.

## Legal (non-negotiable)

- Poem text: **Italian original** or a **public-domain translation** only.
- No modern copyrighted translation prose in-game.
- No assets, screenshots, meshes, audio, or UI chrome from any other Dante game.
- Game title is **Selva Oscura** (not *La Divina Commedia*, not *Dante’s Inferno*).

## Master look

| Axis | Direction |
|---|---|
| Line | Doré: dense cross-hatch, dramatic shafts of light, engraved contour |
| Metal | Bone ivory + aged gold (UI frames, item borders, STELLE/Ash HUD) |
| Camera | Lean **isometric 2D** (Slice 1); readable silhouettes over spectacle |
| Motion | Wind / ash particles sparse; never arcade neon |

## Canticle palettes

| Canticle | Palette id | Colors | Mood |
|---|---|---|---|
| Inferno | `inferno_red_black` | Crimson, pitch, ember ochre, scorched bone | Hunt, packs, bosses, raw D2 loot |
| Purgatorio | `purgatorio_marble_dawn` | Cool marble, rose dawn, soft gold | Terraces, craft, identify, repair |
| Paradiso | `paradiso_white_gold` | White light, pale gold, faint azure | Trials, spheres, status — almost no trash loot |
| Hub (Inf I) | `hub_bone_gold` | Bone, muted gold, fog grey-green | Dark Wood hub — **not** circle-0 combat art |

## Twelve circle kits

Use one kit id per combat circle / major band. Hub uses `hub_dark_wood` outside this list.

| # | Kit id | Canticle band | Notes |
|---|---|---|---|
| 1 | `circle_01_limbo` | Inferno | Soft grey hatch, classical shades |
| 2 | `circle_02_lust` | Inferno | Gale streaks, red-black ribbons (Lust / Inf V) |
| 3 | `circle_03_gluttony` | Inferno | Mire, heavy rain hatch |
| 4 | `circle_04_avarice` | Inferno | Rolling weights, gold-on-black irony |
| 5 | `circle_05_wrath` | Inferno | Styx murk, silhouette brawls |
| 6 | `circle_06_heresy` | Inferno | Burning tombs, ember windows |
| 7 | `circle_07_violence` | Inferno | Blood river / wood / sand variants |
| 8 | `circle_08_fraud` | Inferno | Malebolge ditches, pouches of dark |
| 9 | `circle_09_treachery` | Inferno | Ice, cobalt-black, still air |
| 10 | `kit_purgatorio_terraces` | Purgatorio | Shared terrace marble-dawn with ledge variants |
| 11 | `kit_paradiso_spheres` | Paradiso | Concentric light rings, sparse props |
| 12 | `kit_arena_blood_cup` | Cross | Inferno blood arenas + cup chrome |

## UI chrome

- Frames: bone inset, gold corner finials, etched tick marks.
- Rarity borders: Normal bone → Magic blue hatch → Rare yellow → Set green → Unique gold flare → Canto-Unique white-gold seal.
- Currency: show Stelle and Ash as the **same** balance (`12.847 Stelle` ≡ `12,847 Ash`).
- AH / inventory: DOM overlay allowed; match bone/gold; no fiat loot-box storefront language.

## Audio / copy tone (light)

- Sparse; prefer Italian epigraphs and original game copy.
- No meme VO; contrapasso read as dread and measure, not slapstick.

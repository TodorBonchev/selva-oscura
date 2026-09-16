# selva-oscura-client

Browser client for Selva Oscura.

## Stack lean

- **Phaser** (isometric 2D lean — preferred over low-poly 3D for Slice 1)
- DOM overlays for auction house, inventory, and STELLE/Ash HUD
- Talks only to the authoritative game server; never trusted for combat or drops

## Scope by slice

| Slice | Client bar |
|---|---|
| 0 | Not required |
| 1 | Dark Wood hub + Lust navigation, packs, one boss, loot UI, off-chain AH shell, Devnet claim button |
| 2+ | Full Inferno map graph, bots visible as entities, withdraw UX |

## Package

See `package.json`. No playable game loop in this bootstrap — stubs only until Slice 1 implementation.

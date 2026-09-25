# selva-oscura-client

Three.js 3D client for Selva Oscura Slice 1. Server protocol is unchanged.

## Connect

Default production game server:

```
https://game-server-production-b9f9.up.railway.app
```

Override locally:

```bash
# env
VITE_GAME_SERVER_URL=http://localhost:8080 npm run dev

# or query string
http://localhost:5173/?server=http://localhost:8080&name=Virgil
```

## Controls

| Input | Action |
|---|---|
| Click / tap ground · WASD · **virtual stick** | Move (server-authoritative) |
| Click / tap mob / boss | Attack |
| Click / tap loot | Pick up |
| Click / tap POI · **E** · **Interact** button | Interact (Guide, Stash, AH, Daily, exits) |
| **I** · **Inv** button | Toggle inventory |
| **H** · **AH** button | Toggle auction house (+ browse refresh) |
| **Attack** button (tap or hold) | Attack nearest foe in range |

### Mobile / narrow screens (HUD v2)

`WorldApp.resize()` sets `body.hud-compact` (phones / coarse pointer) and `body.hud-landscape` (compact + landscape); the phone layout lives in the "HUD v2" block at the end of `styles.css`.

- **Portrait:** thin two-row vitals (canto + Ash, HP + MP); objective line, foe plate and toasts in a left column; minimap on the right. Camera pitch ≈43° with the hero near centre so the bottom third belongs to the thumbs.
- **Landscape:** one-line vitals strip, minimap top-right, camera pitch ≈41°.
- **Left thumb:** virtual stick bottom-left (drag to move; release stops at once). Inv / AH seals sit above it.
- **Right thumb arc** around a large Attack seal (hold to keep swinging): inner ring Gale · Dash · Burst, outer ring Use · Ward · Flask. **Use** shows a context verb (Talk, Kneel, Ring, Claim, Take, Stash, Trade, Writ) and is held to travel through a road.
- Compass arrows stay in the open band between vitals and thumbs. Trees between the camera and the hero (or overhanging the lens) fade out.
- Inventory / AH open as sheets (portrait: tall bottom sheet; landscape: two-column card) and hide the thumbs while open. Interacting with the Dark Wood stash opens the bag in bank mode (Bank / Withdraw).
- Safe-area insets are respected (`viewport-fit=cover`); the game root uses `touch-action: none`.

Desktop still supports WASD / I / H / E; the stick stays hidden on fine-pointer wide viewports. Nothing in the server protocol changes for mobile.

## Movement smoothing

Local player uses **client-side prediction** (joystick / WASD / tap updates a render position immediately) with soft **reconciliation** toward server snapshots. Remote players and mobs are **exponentially smoothed** between snapshots. Entities are drawn from render positions, not raw snapshot coords. Server tick ~15 Hz; dirty snapshots ~12.5 Hz. Client move sends stay throttled (~40 ms).

## Slice 1 visuals

**Doré art kit** (`public/assets/dore/`): Gustave Doré–inspired engraving sprites stamped into the Phaser world.

| Entity | Asset |
|---|---|
| Player | `player.png` |
| POI guide / stash / AH / quest | `poi_guide.png`, `poi_stash.png`, `poi_ah.png`, `poi_quest.png` |
| Exit / portal | `exit_portal.png` |
| Mob / champion | `mob_whirl.png` / `mob_champion.png` |
| Boss | `boss_judge.png` |
| Loot | `loot_gem.png` (tinted by rarity) |
| Ground | `hub_ground.png` (`inferno_01`) · `lust_ground.png` (`inferno_05`) |

Sprites preload in `WorldScene`; display sizes are contained (`setDisplaySize`) for iso readability. Soft shadows, HP bars, labels, particles, and movement prediction stay. If a Doré texture fails to load, the client falls back to the previous procedural Graphics silhouettes. A light hatch overlay still sits on the ground stamp. See `manifest.json` in that folder for the kit inventory.


## Build (Vercel)

```bash
cd client && npm install && npm run build
# outputs static assets to client/dist
```

`vercel.json` sets `outputDirectory: dist`. Set `VITE_GAME_SERVER_URL` in the Vercel project if the Railway URL changes.

## 3D world

The world is Three.js (y-up). Server planar `(x, y)` maps to world `(x, 0, y)`. Characters are original bronze-statue meshes with generated Doré albedos under `public/assets/tex/`. Image-to-GLB is not enabled on the current xAI team; swapping a `.glb` in later is a drop-in at `makeByKind`.

### Hero rig

The player (and every remote player) is the procedural pilgrim in `src/world/hero.ts`: ivory robe, crimson mantle and hood, laurel, sword and buckler. Each gear slot's pieces are tagged so `gearLook.ts` shows only what is equipped, and parts are merged per joint and material to keep draw calls low on phones. `anim.ts` drives it: a foot-planted walk/run, a diagonal forehand cut keyed to the attack windup, and the portal channel pose. `fx.ts` draws the matching swoosh. Remote players stride at their tracked speed and face where they walk. The Guide uses the same rig in a slate/umber scholar palette, holding a lantern staff and turning to face you.

The dev-only character studio is not bundled. Run `npm run dev`, then open `http://localhost:5173/tools/char-studio.html`. It renders the hero bare and geared from three angles and at phone scale. Query options: `anim=idle|walk|attack`, `t=<ms>`, `u=<attack phase 0–1>`, `slash=0`, `hide=<joint names>` and `who=guide`.

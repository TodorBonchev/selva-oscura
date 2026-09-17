# selva-oscura-client

Phaser isometric 2D client for Selva Oscura Slice 1.

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

### Mobile / narrow screens

- **Virtual joystick** (bottom-left): shown on touch, coarse pointer, or ≤640px width. Drag to move; release to stop. Uses the same rate-limited `socket.move` path as WASD.
- Stick captures its own pointer events so world picking ignores stick drags. Tap-to-move still works on empty ground **outside** the stick zone; while the stick is active, continuous move wins over destination taps.
- Bottom **action bar** sits to the **right of the stick** (Inv · AH · Interact · Attack) so thumbs don’t collide. Attack is slightly larger; hold Attack to keep swinging at the nearest foe.
- HUD help switches to stick-oriented hints under ~640px / coarse pointer.
- Inventory & AH panels become full-width bottom sheets with larger tap targets (~44px) and close buttons.
- Camera zooms out on compact UI (`0.65` phones / `0.72` wider tablets) with soft follow so hub POIs stay readable while stick-driving.
- Entity tap hit-radius is larger on compact UI; Phaser `pointerdown` works for touch (no hover-only controls).
- Safe-area insets are respected for notched phones (`viewport-fit=cover`). Game root uses `touch-action: none` to block browser scroll/zoom over the canvas.

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

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
| Click / tap ground · WASD | Move (server-authoritative) |
| Click / tap mob / boss | Attack |
| Click / tap loot | Pick up |
| Click / tap POI · **E** · **Interact** button | Interact (Guide, Stash, AH, Daily, exits) |
| **I** · **Inv** button | Toggle inventory |
| **H** · **AH** button | Toggle auction house (+ browse refresh) |
| **Attack** button | Attack nearest foe in range |

### Mobile / narrow screens

- Bottom **action bar** (Inv · AH · Interact · Attack) is always available; keyboard chords are optional.
- HUD help switches to tap-oriented hints under ~640px / coarse pointer.
- Inventory & AH panels become full-width bottom sheets with larger tap targets (~44px) and close buttons.
- Camera zooms out slightly (`0.7`) so hub POIs stay visible with the player; follow-player is unchanged.
- Entity tap hit-radius is larger on compact UI; Phaser `pointerdown` works for touch (no hover-only controls).
- Safe-area insets are respected for notched phones (`viewport-fit=cover`).

Desktop still supports WASD / I / H / E. Nothing in the server protocol changes for mobile.

## Build (Vercel)

```bash
cd client && npm install && npm run build
# outputs static assets to client/dist
```

`vercel.json` sets `outputDirectory: dist`. Set `VITE_GAME_SERVER_URL` in the Vercel project if the Railway URL changes.

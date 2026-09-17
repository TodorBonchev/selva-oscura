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
| Click ground / WASD | Move (server-authoritative) |
| Click mob / boss | Attack |
| Click loot | Pick up |
| Click POI / E | Interact (Guide, Stash, AH, Daily, exits) |
| I | Toggle inventory |
| H | Toggle auction house |

## Build (Vercel)

```bash
cd client && npm install && npm run build
# outputs static assets to client/dist
```

`vercel.json` sets `outputDirectory: dist`. Set `VITE_GAME_SERVER_URL` in the Vercel project if the Railway URL changes.

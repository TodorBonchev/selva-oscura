import http from "node:http";
import { WebSocketServer } from "ws";
import crypto from "node:crypto";
import { World } from "./src/room.mjs";
import { PROTOCOL_VERSION } from "./vendor/constants.mjs";
import * as ah from "./src/ah.mjs";
import { getEmitLog, vault, resolvePlayerForSession } from "./src/ledger.mjs";
import { initDb, runMigrations, dbEnabled, closeDb } from "./src/db.mjs";
import { hydrateFromDb } from "./src/ledger.mjs";

const PORT = Number(process.env.PORT || process.env.FLY_PORT || 8080);
const startedAt = new Date().toISOString();
const world = new World();

const sockets = new WeakMap(); // ws -> { playerId, name }

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = req.url?.split("?")[0] || "/";
  if (url === "/health" || url === "/") {
    const body = JSON.stringify({
      ok: true,
      service: "selva-oscura-server",
      status: "slice1",
      protocol: PROTOCOL_VERSION,
      startedAt,
      rooms: ["inferno_01", "inferno_05"],
      vaultRemainingAsh: vault.remainingAsh,
      persistence: dbEnabled() ? "postgres" : "memory",
      note: "Devnet vault PDA is spec-only; emits credit pendingAsh on server ledger",
    });
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(body);
    return;
  }
  if (url === "/ah") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ listings: ah.getListings() }));
    return;
  }
  if (url === "/emits") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ log: getEmitLog(), vault }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not_found" }));
});

const wss = new WebSocketServer({ server, path: "/ws" });

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

wss.on("connection", (ws) => {
  const playerId = crypto.randomUUID();
  sockets.set(ws, { playerId, name: null });

  send(ws, {
    type: "welcome",
    playerId,
    protocol: PROTOCOL_VERSION,
    server: "selva-oscura-server",
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      send(ws, { type: "error", code: "bad_json", message: "Invalid JSON" });
      return;
    }
    const meta = sockets.get(ws);
    void handleMessage(ws, meta, msg).catch((err) => {
      console.error("[ws] handler error", err.message);
      send(ws, { type: "error", code: "internal", message: "Server error" });
    });
  });

  ws.on("close", () => {
    const meta = sockets.get(ws);
    if (meta) world.leave(meta.playerId);
  });
});

async function handleMessage(ws, meta, msg) {
  const { playerId } = meta;

  switch (msg.type) {
    case "hello": {
      meta.name = (msg.name || `Wanderer-${playerId.slice(0, 4)}`).slice(0, 24);
      const { player, restored } = await resolvePlayerForSession(
        playerId,
        meta.name
      );
      if (player.id !== meta.playerId) {
        // Drop any transient room join under the ephemeral session id
        world.leave(meta.playerId);
        meta.playerId = player.id;
        send(ws, {
          type: "welcome",
          playerId: player.id,
          protocol: PROTOCOL_VERSION,
          server: "selva-oscura-server",
        });
      }
      const room = world.ensureJoin(ws, meta.playerId, meta.name, "inferno_01");
      room.pushSnapshot(meta.playerId);
      const greet = restored
        ? `Welcome back, ${meta.name}. Ash and inventory restored.`
        : "Dark Wood. WASD/click to move. Click foes to strike. E near POIs.";
      room.toast(ws, "info", greet);
      break;
    }
    case "ping": {
      send(ws, { type: "pong", t: Date.now() });
      break;
    }
    case "move": {
      const room = world.getRoom(playerId);
      if (!room) return;
      room.handleMove(playerId, Number(msg.x), Number(msg.y));
      break;
    }
    case "attack": {
      const room = world.getRoom(playerId);
      if (!room) return;
      room.handleAttack(playerId, String(msg.targetId));
      break;
    }
    case "cast": {
      const room = world.getRoom(playerId);
      if (!room) return;
      room.handleCast(
        playerId,
        String(msg.spellId || ""),
        msg.aimX != null ? Number(msg.aimX) : undefined,
        msg.aimY != null ? Number(msg.aimY) : undefined
      );
      break;
    }
    case "interact": {
      const room = world.getRoom(playerId);
      if (!room) return;
      const result = room.handleInteract(playerId, String(msg.targetId));
      if (result?.travel) {
        world.travel(playerId, result.travel, ws, meta.name);
      }
      break;
    }
    case "travel": {
      world.travel(playerId, String(msg.toCanto), ws, meta.name);
      break;
    }
    case "pickup": {
      const room = world.getRoom(playerId);
      if (!room) return;
      await room.handlePickup(playerId, String(msg.lootId));
      break;
    }
    case "ah_browse": {
      send(ws, { type: "ah_listings", listings: ah.getListings() });
      break;
    }
    case "ah_list": {
      const r = await ah.listItem(playerId, String(msg.itemId), Number(msg.priceAsh));
      if (!r.ok) {
        send(ws, { type: "error", code: r.reason, message: `AH list failed: ${r.reason}` });
      } else {
        send(ws, {
          type: "toast",
          level: "info",
          text: `Listed ${r.listing.item.name} for ${r.listing.priceAsh} Ash`,
        });
        send(ws, { type: "ah_listings", listings: ah.getListings() });
        world.getRoom(playerId)?.pushSnapshot(playerId);
      }
      break;
    }
    case "ah_buy": {
      const r = await ah.buy(playerId, String(msg.listingId));
      if (!r.ok) {
        send(ws, { type: "error", code: r.reason, message: `AH buy failed: ${r.reason}` });
      } else {
        send(ws, {
          type: "toast",
          level: "loot",
          text: `Bought ${r.item.name} for ${r.paidAsh} Ash (tax ${r.taxAsh})`,
        });
        send(ws, { type: "ah_listings", listings: ah.getListings() });
        world.getRoom(playerId)?.pushSnapshot(playerId);
      }
      break;
    }
    case "ah_bid": {
      const r = await ah.bid(playerId, String(msg.listingId), Number(msg.bidAsh));
      if (!r.ok) {
        send(ws, { type: "error", code: r.reason, message: `AH bid failed: ${r.reason}` });
      } else {
        send(ws, { type: "toast", level: "info", text: `Bid ${msg.bidAsh} Ash placed` });
        send(ws, { type: "ah_listings", listings: ah.getListings() });
        world.getRoom(playerId)?.pushSnapshot(playerId);
      }
      break;
    }
    case "claim_daily": {
      const room = world.getRoom(playerId);
      room?.tryDaily(playerId);
      break;
    }
    case "equip": {
      const room = world.getRoom(playerId);
      if (!room) return;
      await room.handleEquip(playerId, String(msg.itemId));
      break;
    }
    case "unequip": {
      const room = world.getRoom(playerId);
      if (!room) return;
      await room.handleUnequip(
        playerId,
        msg.itemId ? String(msg.itemId) : null,
        msg.slot ? String(msg.slot) : null
      );
      break;
    }
    case "salvage_bag": {
      const room = world.getRoom(playerId);
      if (!room) return;
      await room.handleSalvage(playerId);
      break;
    }
    default:
      send(ws, { type: "error", code: "unknown_type", message: `Unknown: ${msg.type}` });
  }
}

// Tick loop ~15 Hz for aggro / cooldowns; snapshots gated at ~12.5 Hz when dirty
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.2, (now - last) / 1000);
  last = now;
  world.tick(dt);
}, 66);

async function boot() {
  await initDb();
  if (dbEnabled()) {
    await runMigrations();
    await hydrateFromDb();
    await ah.hydrateListings();
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`selva-oscura slice1 listening on ${PORT}`);
    console.log(`content rooms: inferno_01 (hub), inferno_05 (Lust)`);
    console.log(
      `persistence: ${dbEnabled() ? "postgres" : "memory (set DATABASE_URL for durable state)"}`
    );
  });
}

boot().catch((err) => {
  console.error("[boot] failed", err.message);
  process.exit(1);
});

async function shutdown() {
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

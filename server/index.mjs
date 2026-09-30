import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import crypto from "node:crypto";

/** Fill missing env vars from server/.env. Existing process env (Railway) wins. */
function loadLocalEnv() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}
loadLocalEnv();
import { World } from "./src/room.mjs";
import { noteClientRtt, noteServerRtt } from "./src/telegraph.mjs";
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
      rooms: ["inferno_01", "inferno_05", "inferno_06", "inferno_07"],
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

/**
 * Heartbeat: a ws ping every HEARTBEAT_MS. The echo times the round trip on the
 * server's own clock (telegraph dodge grace trusts no client report beyond it), and a
 * socket silent for HEARTBEAT_DEAD_MS (a phone that switched networks without a close)
 * is terminated, so its session is freed instead of lingering.
 */
const HEARTBEAT_MS = 2000;
const HEARTBEAT_DEAD_MS = 20000;

wss.on("connection", (ws) => {
  const playerId = crypto.randomUUID();
  sockets.set(ws, { playerId, name: null, chain: Promise.resolve() });
  ws._hb = { sentAt: 0, seenAt: Date.now() };
  ws.on("pong", () => {
    const hb = ws._hb;
    const now = Date.now();
    hb.seenAt = now;
    if (hb.sentAt) {
      noteServerRtt(ws, now - hb.sentAt);
      hb.sentAt = 0;
    }
  });

  send(ws, {
    type: "welcome",
    playerId,
    protocol: PROTOCOL_VERSION,
    server: "selva-oscura-server",
  });

  ws.on("message", (raw) => {
    ws._hb.seenAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      send(ws, { type: "error", code: "bad_json", message: "Invalid JSON" });
      return;
    }
    const meta = sockets.get(ws);
    // a socket whose pilgrim was handed to a newer connection drives nothing
    if (meta.stale) return;
    // Serialize per-socket handlers so async hello cannot race travel/move
    // (otherwise DEV __selvaTravel mid-boot can leave HUD on one canto and meshes on hub).
    meta.chain = meta.chain
      .then(() => handleMessage(ws, meta, msg))
      .catch((err) => {
        console.error("[ws] handler error", err.message);
        send(ws, { type: "error", code: "internal", message: "Server error" });
      });
  });

  ws.on("close", () => {
    const meta = sockets.get(ws);
    if (!meta || meta.stale) return;
    // Only the socket that still owns the session leaves: a reconnect that beat this
    // close has the pilgrim now (index hello hands it over)
    const room = world.getRoom(meta.playerId);
    const sess = room?.sessions.get(meta.playerId);
    if (sess && sess.ws !== ws) return;
    world.leave(meta.playerId);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients) {
    const hb = ws._hb;
    if (!hb) continue;
    if (now - hb.seenAt > HEARTBEAT_DEAD_MS) {
      ws.terminate();
      continue;
    }
    if (hb.sentAt) continue; // still waiting on the last echo
    hb.sentAt = now;
    try {
      ws.ping();
    } catch {
      /* closing */
    }
  }
  world.pruneResumes(now);
}, HEARTBEAT_MS);

/** Refresh purses of other pilgrims an AH trade paid or refunded (seller, outbid bidder). */
function pushTouched(ids, self) {
  for (const id of ids || []) {
    if (id !== self) world.getRoom(id)?.pushSnapshot(id);
  }
}

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
      // Reconnect before the old socket's close arrived (a phone switching networks):
      // hand the live session to this socket — same room, place, HP — and retire the
      // old one, whose late close must not tear the pilgrim down
      const live = world.getRoom(meta.playerId);
      const liveSess = live?.sessions.get(meta.playerId);
      if (liveSess && liveSess.ws !== ws) {
        const old = liveSess.ws;
        const oldMeta = sockets.get(old);
        if (oldMeta) oldMeta.stale = true;
        liveSess.ws = ws;
        try {
          old.close(4000, "replaced");
        } catch {
          /* already gone */
        }
        live.pushSnapshot(meta.playerId);
        if (live.canto?.role === "combat") live.toast(ws, "info", "Connection restored — right where you stood.");
        break;
      }
      const room = world.resumeOrHub(ws, meta.playerId, meta.name);
      room.pushSnapshot(meta.playerId);
      const midCombat = room.cantoId !== "inferno_01" && room.canto?.role === "combat";
      const greet = midCombat
        ? null
        : restored
          ? `Welcome back, ${meta.name}. Ash and inventory restored.`
          : "Welcome, pilgrim — speak with the Guide.";
      if (greet) room.toast(ws, "info", greet);
      break;
    }
    case "ping": {
      // The client echoes its own clock (c) to measure the round trip, and reports the
      // last one (rtt): telegraphs give laggy players that long to dodge (telegraph.mjs)
      if (msg.rtt != null) noteClientRtt(ws, msg.rtt);
      send(ws, { type: "pong", t: Date.now(), c: Number.isFinite(Number(msg.c)) ? Number(msg.c) : undefined });
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
      // combo: the client's swing in its 3-hit chain (2 = overhead finisher)
      room.handleAttack(playerId, String(msg.targetId), Number(msg.combo) || 0);
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
      // DEV client may set bypassGates for __selvaTravel playtest jumps.
      // Real portal interact path never sets it — require_clear stays enforced.
      const bypassGates =
        Boolean(msg.bypassGates) && process.env.NODE_ENV !== "production";
      world.travel(playerId, String(msg.toCanto), ws, meta.name, { bypassGates });
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
        pushTouched(r.touched, playerId);
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
        pushTouched(r.touched, playerId);
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
        pushTouched(r.touched, playerId);
      }
      break;
    }
    case "ah_cancel": {
      const r = await ah.cancelListing(playerId, String(msg.listingId));
      if (!r.ok) {
        send(ws, { type: "error", code: r.reason, message: `AH cancel failed: ${r.reason}` });
      } else {
        send(ws, {
          type: "toast",
          level: "info",
          text: `Cancelled listing: ${r.listing.item.name}`,
        });
        send(ws, { type: "ah_listings", listings: ah.getListings() });
        world.getRoom(playerId)?.pushSnapshot(playerId);
        pushTouched(r.touched, playerId);
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
    case "stash_put":
    case "stash_take": {
      const room = world.getRoom(playerId);
      if (!room) return;
      await room.handleStash(playerId, String(msg.itemId), msg.type === "stash_take" ? "take" : "put");
      break;
    }
    case "salvage_bag": {
      const room = world.getRoom(playerId);
      if (!room) return;
      await room.handleSalvage(playerId);
      break;
    }
    case "sip": {
      const room = world.getRoom(playerId);
      if (!room) return;
      room.handleSip(playerId);
      break;
    }
    case "dash": {
      const room = world.getRoom(playerId);
      if (!room) return;
      room.handleDash(playerId, Number(msg.x), Number(msg.y));
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
    console.log(`content rooms: inferno_01 (hub), inferno_05 (Lust), inferno_06 (Gluttony), inferno_07 (Avarice)`);
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

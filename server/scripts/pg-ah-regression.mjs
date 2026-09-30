#!/usr/bin/env node
/**
 * Postgres-path regression for AH list / buy / cancel and bag melt across restarts.
 * Spawns its own game server on PORT_TEST (default 8091) against DATABASE_URL
 * (use `npm run db` local Postgres — never point this at prod).
 *
 *   DATABASE_URL=postgresql://selva:selva_local@127.0.0.1:5433/selva node scripts/pg-ah-regression.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import WebSocket from "ws";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DATABASE_URL;
if (!url || /neon\.tech|railway|rlwy|supabase/i.test(url)) {
  console.error("Set DATABASE_URL to a LOCAL Postgres (npm run db)");
  process.exit(2);
}
const port = Number(process.env.PORT_TEST || 8091);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = new pg.Client({ connectionString: url });
await db.connect();

let srv = null;
async function startServer() {
  srv = spawn(process.execPath, ["index.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATABASE_URL: url, NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.logs = "";
  srv.stdout.on("data", (d) => (srv.logs += d));
  srv.stderr.on("data", (d) => (srv.logs += d));
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    if (srv.logs.includes("listening on")) return;
    if (srv.exitCode != null) break;
  }
  throw new Error("server did not start:\n" + srv.logs);
}
async function stopServer() {
  if (!srv) return;
  const s = srv;
  srv = null;
  s.kill("SIGTERM");
  await new Promise((r) => (s.exitCode != null ? r() : s.on("exit", r)));
  return s.logs;
}

async function connect(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((r, j) => (ws.on("open", r), ws.on("error", j)));
  const c = { ws, name, snap: null, msgs: [], listings: [] };
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    c.msgs.push(m);
    if (m.type === "snapshot") c.snap = m;
    if (m.type === "ah_listings") c.listings = m.listings;
  });
  ws.send(JSON.stringify({ type: "hello", name }));
  for (let i = 0; i < 100 && !c.snap?.room?.you; i++) await sleep(50);
  if (!c.snap?.room?.you) throw new Error("no snapshot for " + name);
  c.id = c.snap.room.you.id;
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = async (pred, label, ms = 4000) => {
    const from = c.msgs.length;
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hit = c.msgs.slice(from).find(pred);
      if (hit) return hit;
      await sleep(30);
    }
    throw new Error(`${name}: timeout ${label}`);
  };
  return c;
}
const result = (m) =>
  (m.type === "error" && /^AH |ah_/.test(String(m.message || m.code))) ||
  (m.type === "toast" && /Listed|Bought|Cancel|Melted|melt/i.test(m.text || ""));

const tag = Date.now().toString(36);
async function seedBag(ownerId, n) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = `reg_${tag}_${ownerId.slice(0, 4)}_${i}`;
    await db.query(
      `INSERT INTO inventory_items (id, owner_id, location, name, rarity, affixes, base_id, slot)
       VALUES ($1,$2,'inventory',$3,'magic','["+3 dmg"]'::jsonb,'road_pike','weapon')`,
      [id, ownerId, `Reg Pike ${i}`]
    );
    ids.push(id);
  }
  return ids;
}

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
};

try {
  await startServer();
  let A = await connect(`RegSeller${tag}`.slice(0, 24));
  let B = await connect(`RegBuyer${tag}`.slice(0, 24));
  const aId = A.id, bId = B.id;
  A.ws.close(); B.ws.close();
  await stopServer();
  const aItems = await seedBag(aId, 4);
  await seedBag(bId, 1);

  // Round 1: list + buy, then restart
  await startServer();
  A = await connect(A.name); B = await connect(B.name);
  A.send({ type: "ah_list", itemId: aItems[0], priceAsh: 100 });
  let r = await A.wait(result, "list1");
  check(r.type === "toast", "list #1", r.text || r.message);
  A.send({ type: "ah_browse" });
  await A.wait((m) => m.type === "ah_listings", "browse");
  const L1 = A.listings.find((l) => l.item?.id === aItems[0]);
  B.send({ type: "ah_buy", listingId: L1?.id });
  r = await B.wait(result, "buy1");
  check(r.type === "toast", "buy #1", r.text || r.message);
  A.ws.close(); B.ws.close();
  await stopServer();

  // Round 2: restart with zero active listings (prod state) — new ids must not
  // collide with the sold history rows
  await startServer();
  A = await connect(A.name); B = await connect(B.name);
  A.send({ type: "ah_list", itemId: aItems[2], priceAsh: 300 });
  r = await A.wait(result, "list3");
  check(r.type === "toast", "list after restart (0 active)", r.text || r.message);
  A.send({ type: "ah_list", itemId: aItems[1], priceAsh: 200 });
  r = await A.wait(result, "list2");
  check(r.type === "toast", "second list after restart", r.text || r.message);
  A.ws.close(); B.ws.close();
  await stopServer();

  // Round 3: hydrate active listings, cancel, list again, melt
  await startServer();
  A = await connect(A.name); B = await connect(B.name);
  A.send({ type: "ah_list", itemId: aItems[3], priceAsh: 400 });
  r = await A.wait(result, "list4");
  check(r.type === "toast", "list after 2nd restart", r.text || r.message);

  // Cancel (if supported) the listing made before restart
  A.send({ type: "ah_browse" });
  await A.wait((m) => m.type === "ah_listings", "browse2");
  const L2 = A.listings.find((l) => l.item?.id === aItems[1]);
  check(Boolean(L2), "pre-restart listing hydrated", L2?.id);
  check(L2?.item?.slot === "weapon" || L2?.item?.baseId === "road_pike", "hydrated listing keeps base/slot");
  // Buyer bids (escrow), then the seller cancels: escrow must come back in DB + memory
  const ashOf = async (id) => Number((await db.query("SELECT ash FROM players WHERE id=$1", [id])).rows[0].ash);
  const bAsh0 = await ashOf(bId);
  B.send({ type: "ah_bid", listingId: L2?.id, bidAsh: 250 });
  r = await B.wait((m) => (m.type === "toast" && /^Bid/.test(m.text)) || m.type === "error", "bid");
  check(r.type === "toast", "bid", r.text || r.message);
  check((await ashOf(bId)) === bAsh0 - 250, "bid escrow debited in DB");
  A.send({ type: "ah_cancel", listingId: L2?.id });
  r = await A.wait((m) => result(m) || (m.type === "error"), "cancel");
  check(r.type === "toast", "cancel listing", r.text || r.message);
  check((await ashOf(bId)) === bAsh0, "escrow refunded in DB on cancel");
  await sleep(100);
  B.send({ type: "ah_browse" });
  await sleep(200);
  check(Number(B.snap.room.you.ash) === bAsh0, "escrow refunded in memory", `${B.snap.room.you.ash} vs ${bAsh0}`);

  // Buyer melts a bag containing the item bought through the AH
  const bBag = B.snap.room.you.inventory.filter((i) => !i.equipSlot).map((i) => i.id);
  check(bBag.includes(aItems[0]), "bought item in buyer bag");
  B.send({ type: "salvage_bag" });
  r = await B.wait((m) => m.type === "toast" && /melt/i.test(m.text), "melt");
  check(/^Melted/.test(r.text), "melt bag with AH-bought item", r.text);
  const left = await db.query(
    "SELECT id FROM inventory_items WHERE owner_id = $1 AND location = 'inventory'",
    [bId]
  );
  check(left.rowCount === 0, "melted rows gone from DB", `${left.rowCount} left`);
  const hist = await db.query("SELECT status FROM ah_listings WHERE seller_id = $1", [aId]);
  check(hist.rows.some((h) => h.status === "sold"), "sold history kept", hist.rows.map((h) => h.status).join(","));

  // Seller melts (cancelled item back in bag)
  A.send({ type: "salvage_bag" });
  r = await A.wait((m) => m.type === "toast" && /melt/i.test(m.text), "melt A");
  check(/^Melted/.test(r.text), "seller melt after cancel", r.text);
  A.ws.close(); B.ws.close();
  const logs = await stopServer();
  const errs = logs.split("\n").filter((l) => /failed|error/i.test(l));
  check(errs.length === 0, "no server errors", errs.join(" | "));
} catch (err) {
  console.error("ERROR", err.message);
  if (srv) console.error(srv.logs);
  failures++;
} finally {
  await stopServer();
  await db.end();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);

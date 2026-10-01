#!/usr/bin/env node
/**
 * Consensual PvP regression. Spawns its own server on PORT_TEST (default 8097).
 *
 *   cd server && node scripts/pvp-regression.mjs
 *   DATABASE_URL=postgresql://selva:selva_local@127.0.0.1:5433/selva node scripts/pvp-regression.mjs
 *
 * Refuses DATABASE_URL hosts that look like Neon / Railway / Supabase.
 * Memory mode (no DATABASE_URL) skips the restart persistence case.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { itemStatBonus } from "../src/loot.mjs";
import { pvpDamage } from "../src/pvp.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT_TEST || 8097);
const dbUrl = process.env.DATABASE_URL || "";
const remoteDb = /neon\.tech|railway|rlwy|supabase/i.test(dbUrl);
if (dbUrl && remoteDb) {
  console.error("Refusing non-local DATABASE_URL (neon/railway/supabase)");
  process.exit(2);
}
const dotenvPath = path.join(root, ".env");
if (!dbUrl && fs.existsSync(dotenvPath)) {
  console.error("Memory run would still load server/.env — move it aside first");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
};

function sumGear(items) {
  const s = { dmg: 0, maxHp: 0, armor: 0 };
  for (const it of items) {
    const b = itemStatBonus(it);
    s.dmg += b.dmg;
    s.maxHp += b.maxHp;
    s.armor += b.armor;
  }
  return s;
}

/** Time until HP hits 0 if the attacker swings every 0.42s (first land at 0.12s). */
function ttk(attacker, target, roll, pattern) {
  const maxHp = 130 + target.maxHp;
  let hp = maxHp;
  let swings = 0;
  const hits = [];
  while (hp > 0 && swings < 80) {
    const kind = pattern[swings % pattern.length];
    let raw = 22 + attacker.dmg + roll;
    if (kind === "finisher") raw = Math.round(raw * 1.3);
    const dmg = pvpDamage(raw, {
      attackerGear: attacker,
      targetGear: target,
      targetMaxHp: maxHp,
      kind,
    });
    hits.push(dmg);
    hp -= dmg;
    swings++;
  }
  const time = +(0.12 + (swings - 1) * 0.42).toFixed(2);
  return { swings, time, hit: hits[0], maxHp };
}

function printTtk() {
  const starter = sumGear([
    { slot: "weapon", rarity: "normal", affixes: [] },
    { slot: "armor", rarity: "normal", affixes: [] },
  ]);
  const aff4 = ["a", "b", "c", "d"];
  const best = sumGear([
    { slot: "weapon", rarity: "canto_unique", affixes: ["fixed_legendary"] },
    { slot: "gloves", rarity: "canto_unique", affixes: ["fixed_legendary"] },
    { slot: "helm", rarity: "rare", affixes: aff4 },
    { slot: "armor", rarity: "rare", affixes: aff4 },
    { slot: "boots", rarity: "rare", affixes: aff4 },
    { slot: "offhand", rarity: "rare", affixes: aff4 },
  ]);
  console.log("TTK gear starter", starter, "best", best);
  const light = ["melee"];
  const fin = ["melee", "melee", "finisher"];
  for (const roll of [0, 2, 5]) {
    const ss = ttk(starter, starter, roll, light);
    const bs = ttk(best, starter, roll, light);
    const bf = ttk(best, starter, roll, fin);
    console.log(
      `TTK roll=${roll} starter-vs-starter light ${ss.time}s (${ss.swings} hits of ${ss.hit}, hp ${ss.maxHp})` +
        ` | best-vs-starter light ${bs.time}s (${bs.swings}x${bs.hit})` +
        ` | best-vs-starter finisher-chain ${bf.time}s (${bf.swings} hits)`
    );
  }
  const mid = ttk(starter, starter, 2, light);
  const geared = ttk(best, starter, 0, light);
  check(mid.time >= 4 && mid.time <= 7, "TTK starter-vs-starter light (roll 2) in 4–7s", `${mid.time}s`);
  check(geared.time >= 2.5, "TTK best-vs-starter light (roll 0) ≥ 2.5s", `${geared.time}s`);
}

function eloDelta(ra, rb, score, K, mult) {
  const expected = 1 / (1 + 10 ** ((rb - ra) / 400));
  return Math.round(K * mult * (score - expected));
}

printTtk();

let srv = null;
async function startServer() {
  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "test",
    SELVA_PVP_ROUND_SEC: "20",
  };
  if (dbUrl) env.DATABASE_URL = dbUrl;
  else delete env.DATABASE_URL;
  srv = spawn(process.execPath, ["index.mjs"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.logs = "";
  srv.stdout.on("data", (d) => (srv.logs += d));
  srv.stderr.on("data", (d) => (srv.logs += d));
  for (let i = 0; i < 120; i++) {
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
  await new Promise((res, rej) => {
    ws.on("open", res);
    ws.on("error", rej);
  });
  const c = { ws, name, snap: null, msgs: [], id: null };
  ws.on("message", (d) => {
    let m;
    try {
      m = JSON.parse(String(d));
    } catch {
      return;
    }
    c.msgs.push(m);
    if (m.type === "snapshot") c.snap = m;
  });
  ws.send(JSON.stringify({ type: "hello", name }));
  for (let i = 0; i < 100 && !c.snap?.room?.you; i++) await sleep(50);
  if (!c.snap?.room?.you) throw new Error("no snapshot for " + name);
  c.id = c.snap.room.you.id;
  c.send = (m) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(m));
  };
  return c;
}

async function wait(c, pred, label, ms = 8000, from = 0) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = c.msgs.slice(from).find(pred);
    if (hit) return hit;
    await sleep(30);
  }
  const tail = c.msgs.slice(-6).map((m) => m.type + (m.duel?.phase ? ":" + m.duel.phase : "") + (m.reason ? ":" + m.reason : "")).join(", ");
  throw new Error(`${c.name}: timeout ${label} (recent ${tail})`);
}

async function waitGear(c) {
  for (let i = 0; i < 80; i++) {
    const you = c.snap?.room?.you;
    if (you && you.gearStats?.dmg >= 6 && you.maxHp >= 138) return you;
    await sleep(50);
  }
  throw new Error(`${c.name} gear did not settle ${JSON.stringify(c.snap?.room?.you?.gearStats)} hp ${c.snap?.room?.you?.maxHp}`);
}

async function go(c, canto) {
  const from = c.msgs.length;
  c.send({ type: "travel", toCanto: canto, bypassGates: true });
  await wait(c, (m) => m.type === "snapshot" && m.room?.cantoId === canto, `travel ${canto}`, 5000, from);
  c._px = c.snap.room.you.x;
  c._py = c.snap.room.you.y;
}

async function stepToward(c, tx, ty) {
  const you = c.snap?.room?.you;
  if (!you) {
    await sleep(50);
    return;
  }
  if (c._px == null || Math.hypot(you.x - c._px, you.y - c._py) > 0.9) {
    c._px = you.x;
    c._py = you.y;
  }
  const dx = tx - c._px;
  const dy = ty - c._py;
  const d = Math.hypot(dx, dy);
  if (d < 0.15) {
    await sleep(50);
    return;
  }
  const step = Math.min(0.4, d);
  c._px += (dx / d) * step;
  c._py += (dy / d) * step;
  c.send({ type: "move", x: +c._px.toFixed(3), y: +c._py.toFixed(3) });
  await sleep(50);
}

async function walkTo(c, x, y, timeout = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const you = c.snap?.room?.you;
    if (you && Math.hypot(you.x - x, you.y - y) <= 0.8) return;
    await stepToward(c, x, y);
  }
  const you = c.snap?.room?.you;
  throw new Error(`${c.name} stuck at ${you?.x},${you?.y} wanted ${x},${y}`);
}

function other(c, id) {
  return (c.snap?.room?.players || []).find((p) => p.id === id) || null;
}

function ratingOf(c) {
  return c.snap?.room?.you?.pvp?.rating ?? 1200;
}

async function pollRating(c, expect, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (ratingOf(c) === expect) return true;
    await sleep(40);
  }
  return ratingOf(c) === expect;
}

let lastChal = 0;
async function challenge(from, to) {
  const gap = 4200 - (Date.now() - lastChal);
  if (lastChal && gap > 0) await sleep(gap);
  lastChal = Date.now();
  const fromIdx = to.msgs.length;
  from.send({ type: "duel_challenge", targetId: to.id });
  return wait(to, (m) => m.type === "duel_invite" && m.fromId === from.id, "invite", 4000, fromIdx);
}

async function accept(from, to) {
  const fromIdx = from.msgs.length;
  to.send({ type: "duel_respond", fromId: from.id, accept: true });
  return wait(
    from,
    (m) => m.type === "duel_state" && m.duel?.phase === "countdown",
    "countdown",
    4000,
    fromIdx
  );
}

const RIVAL = "Rating unchanged: you have met this rival too often today.";
const NO_GLORY = "No glory in the same shade twice.";

async function run() {
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
  check(Array.isArray(health.rooms) && health.rooms.includes("inferno_31"), "(8) /health lists inferno_31", JSON.stringify(health.rooms));
  check(!health.rooms?.includes?.("inferno_99"), "(8) health rooms are real cantos");

  const tag = Date.now().toString(36);
  let A = await connect(`A${tag}`);
  let B = await connect(`B${tag}`);
  let C = await connect(`C${tag}`);
  await waitGear(A);
  await waitGear(B);
  await waitGear(C);

  const exits = (A.snap.room.entities || []).filter((e) => e.kind === "exit");
  check(
    exits.some((e) => e.toCanto === "inferno_31" && String(e.label || "").includes("Pozzo dei Giganti")),
    "(8) hub exit to inferno_31"
  );
  check(!exits.some((e) => e.toCanto === "inferno_07"), "(8) hub has no inferno_07 exit");
  check(exits.some((e) => e.toCanto === "inferno_05"), "(8) Lust exit still present");

  // (1) hub: player attack does nothing
  {
    const hpA = A.snap.room.you.hp;
    const hpB = B.snap.room.you.hp;
    const from = A.msgs.length;
    for (let i = 0; i < 8; i++) {
      A.send({ type: "attack", targetId: B.id, combo: 0 });
      await sleep(40);
    }
    await sleep(400);
    const dmg = A.msgs.slice(from).filter((m) => m.type === "combat" && m.attackerId === A.id && m.damage > 0 && m.targetId === B.id);
    check(dmg.length === 0, "(1) hub attack deals no player damage", `msgs ${dmg.length}`);
    check(A.snap.room.you.hp === hpA && B.snap.room.you.hp === hpB, "(1) hub HP unchanged");
  }

  await go(A, "inferno_05");
  await go(B, "inferno_05");
  await go(C, "inferno_05");
  await sleep(200);
  {
    const hpB = B.snap.room.you.hp;
    const from = A.msgs.length;
    for (let i = 0; i < 6; i++) {
      A.send({ type: "attack", targetId: B.id, combo: 0 });
      await sleep(40);
    }
    await sleep(350);
    const dmg = A.msgs.slice(from).filter((m) => m.type === "combat" && m.attackerId === A.id && m.damage > 0 && m.targetId === B.id);
    check(dmg.length === 0, "(1) inferno_05 attack deals no player damage");
    check(B.snap.room.you.hp === hpB, "(1) inferno_05 target HP unchanged", `hp ${B.snap.room.you.hp} was ${hpB}`);
    const fromD = A.msgs.length;
    A.send({ type: "duel_challenge", targetId: B.id });
    const dec = await wait(A, (m) => m.type === "duel_declined", "hub_only", 3000, fromD);
    check(dec.reason === "hub_only", "(1) duel_challenge in inferno_05 refused", dec.reason);
  }
  await go(A, "inferno_01");
  await go(B, "inferno_01");
  await go(C, "inferno_01");

  // (7) ranked first, while B and C are still 1200 → K=32 ±16
  await go(B, "inferno_31");
  await go(C, "inferno_31");
  {
    const fromB = B.msgs.length;
    B.send({ type: "pvp_queue", join: true });
    await sleep(150);
    C.send({ type: "pvp_queue", join: true });
    const started = await wait(
      B,
      (m) => m.type === "duel_state" && m.duel?.ranked && m.duel?.phase === "countdown",
      "ranked countdown",
      4000,
      fromB
    );
    check(started.duel.a === B.id || started.duel.b === B.id, "(7) ranked duel pairs the queued players");
    const fromOver = B.msgs.length;
    B.send({ type: "duel_cancel" });
    const over = await wait(B, (m) => m.type === "duel_state" && m.duel?.phase === "over", "ranked over", 4000, fromOver);
    check(over.duel.reason === "forfeit" && over.duel.winnerId === C.id, "(7) ranked forfeit", `${over.duel.reason} winner ${over.duel.winnerId}`);
    const dC = over.duel.ratingDelta?.[C.id];
    const dB = over.duel.ratingDelta?.[B.id];
    check(dC === 16 && dB === -16, "(7) ranked K=32 delta ±16", `C ${dC} B ${dB}`);
    await sleep(1800);
    check(await pollRating(C, 1216), "(7) winner rating 1216", String(ratingOf(C)));
    check(await pollRating(B, 1184), "(7) loser rating 1184", String(ratingOf(B)));
  }
  await go(B, "inferno_01");
  await go(C, "inferno_01");
  await sleep(200);

  // (2) decline + immediate rechallenge
  {
    const fromA = A.msgs.length;
    const fromC = C.msgs.length;
    A.send({ type: "duel_challenge", targetId: C.id });
    lastChal = Date.now();
    const inv = await wait(C, (m) => m.type === "duel_invite" && m.fromId === A.id, "invite C", 4000, fromC);
    check(!!inv, "(2) duel invite delivered");
    C.send({ type: "duel_respond", fromId: A.id, accept: false });
    const dec = await wait(A, (m) => m.type === "duel_declined" && m.reason === "declined", "declined", 3000, fromA);
    check(dec.reason === "declined", "(2) duel decline → duel_declined");
    const from2 = A.msgs.length;
    A.send({ type: "duel_challenge", targetId: C.id });
    const again = await wait(A, (m) => m.type === "duel_declined", "rechallenge", 3000, from2);
    check(again.reason === "declined_recently", "(2) re-challenge within 30s refused", again.reason);
  }

  // (3) + (5) full duel, bystander
  {
    const ra = ratingOf(A);
    const rb = ratingOf(B);
    await challenge(A, B);
    const fromCount = A.msgs.length;
    await accept(A, B);
    const t0 = Date.now();
    while (Date.now() - t0 < 1600) {
      A.send({ type: "attack", targetId: B.id, combo: 0 });
      C.send({ type: "attack", targetId: B.id, combo: 0 });
      await sleep(50);
    }
    const early = A.msgs.slice(fromCount).filter((m) => m.type === "combat" && m.damage > 0);
    check(early.length === 0, "(3) no damage during countdown", `combat ${early.length}`);
    check(B.snap.room.you.hp === B.snap.room.you.maxHp, "(3) HP full through countdown");
    const fightFrom = A.msgs.length;
    const byFrom = C.msgs.length;
    const stopAt = Date.now() + 20000;
    let over = null;
    while (Date.now() < stopAt) {
      A.send({ type: "attack", targetId: B.id, combo: 0 });
      C.send({ type: "attack", targetId: B.id, combo: 0 });
      over = A.msgs.slice(fightFrom).find((m) => m.type === "duel_state" && m.duel?.phase === "over");
      if (over) break;
      await sleep(50);
    }
    check(!!over && over.duel.reason === "down" && over.duel.winnerId === A.id, "(3) phase over, winner by down", over ? `${over.duel.reason} ${over.duel.winnerId}` : "none");
    const byDmg = C.msgs.slice(byFrom).filter((m) => m.type === "combat" && m.attackerId === C.id && m.damage > 0);
    const byWind = A.msgs.slice(fightFrom).filter((m) => m.type === "pvp_windup" && m.id === C.id);
    check(byDmg.length === 0 && byWind.length === 0, "(5) bystander attack on a duelist does nothing", `dmg ${byDmg.length} wind ${byWind.length}`);
    const dA = eloDelta(ra, rb, 1, 20, 1);
    const dB = eloDelta(rb, ra, 0, 20, 1);
    check(over?.duel?.ratingDelta?.[A.id] === dA && over?.duel?.ratingDelta?.[B.id] === dB, "(3) hub rating delta", `got ${over?.duel?.ratingDelta?.[A.id]}/${over?.duel?.ratingDelta?.[B.id]} want ${dA}/${dB} from ${ra}/${rb}`);
    await sleep(1800);
    const fullA = A.snap.room.you.hp === A.snap.room.you.maxHp;
    const fullB = B.snap.room.you.hp === B.snap.room.you.maxHp;
    check(fullA && fullB, "(3) both restored to full HP", `${A.snap.room.you.hp}/${A.snap.room.you.maxHp} ${B.snap.room.you.hp}/${B.snap.room.you.maxHp}`);
    check(await pollRating(A, ra + dA) && (await pollRating(B, rb + dB)), "(3) ratings moved", `${ratingOf(A)} ${ratingOf(B)}`);
  }

  // (4) ring forfeit
  {
    const ra = ratingOf(A);
    const rb = ratingOf(B);
    await challenge(A, B);
    await accept(A, B);
    const from = A.msgs.length;
    await walkTo(A, 64, 56);
    let over = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      over = A.msgs.slice(from).find((m) => m.type === "duel_state" && m.duel?.phase === "over");
      if (over) break;
      A.send({ type: "move", x: 64, y: 56 });
      await sleep(100);
    }
    check(over?.duel?.reason === "ring" && over?.duel?.winnerId === B.id, "(4) ring forfeit", over ? `${over.duel.reason} w ${over.duel.winnerId}` : "none");
    const dB = eloDelta(rb, ra, 1, 20, 0.5);
    const dA = eloDelta(ra, rb, 0, 20, 0.5);
    check(over?.duel?.ratingDelta?.[B.id] === dB && over?.duel?.ratingDelta?.[A.id] === dA, "(4) ring rating mult 0.5", `got ${over?.duel?.ratingDelta?.[A.id]}/${over?.duel?.ratingDelta?.[B.id]} want ${dA}/${dB}`);
    await walkTo(A, 64, 72);
    await sleep(400);
  }

  // (4) disconnect forfeit
  {
    const ra = ratingOf(A);
    const rb = ratingOf(B);
    const bId = B.id;
    const bName = B.name;
    await challenge(A, B);
    await accept(A, B);
    const from = A.msgs.length;
    B.ws.close();
    const over = await wait(A, (m) => m.type === "duel_state" && m.duel?.phase === "over", "disconnect over", 4000, from);
    check(over.duel.reason === "disconnect" && over.duel.winnerId === A.id, "(4) disconnect forfeit", `${over.duel.reason} ${over.duel.winnerId}`);
    const dA = eloDelta(ra, rb, 1, 20, 0.25);
    const dB = eloDelta(rb, ra, 0, 20, 0.25);
    check(over.duel.ratingDelta?.[A.id] === dA && over.duel.ratingDelta?.[B.id] === dB, "(4) disconnect rating mult 0.25", `got ${over.duel.ratingDelta?.[A.id]}/${over.duel.ratingDelta?.[B.id]} want ${dA}/${dB}`);
    await sleep(300);
    B = await connect(bName);
    check(B.id === bId, "(4) reconnect keeps player id", `${B.id} vs ${bId}`);
    check(await pollRating(B, rb + dB), "(4) disconnected rating persisted in memory", String(ratingOf(B)));
    await sleep(400);
  }

  // (7) diminishing returns — 4th A-B rated match
  {
    const ra = ratingOf(A);
    const rb = ratingOf(B);
    await challenge(A, B);
    await accept(A, B);
    const fromA = A.msgs.length;
    const fromB = B.msgs.length;
    A.send({ type: "duel_cancel" });
    const over = await wait(A, (m) => m.type === "duel_state" && m.duel?.phase === "over", "fourth over", 4000, fromA);
    check(over.duel.reason === "forfeit", "(7) fourth match forfeited", over.duel.reason);
    await sleep(200);
    const toastA = A.msgs.slice(fromA).some((m) => m.type === "toast" && m.text === RIVAL);
    const toastB = B.msgs.slice(fromB).some((m) => m.type === "toast" && m.text === RIVAL);
    check(toastA && toastB, "(7) diminishing-returns toast", `A ${toastA} B ${toastB}`);
    check((over.duel.ratingDelta?.[A.id] || 0) === 0 && (over.duel.ratingDelta?.[B.id] || 0) === 0, "(7) rating delta 0");
    check(ratingOf(A) === ra && ratingOf(B) === rb, "(7) ratings unchanged", `${ratingOf(A)}/${ratingOf(B)} vs ${ra}/${rb}`);
  }

  // (6) arena FFA
  await go(A, "inferno_31");
  await go(B, "inferno_31");
  await walkTo(A, 48, 50);
  await walkTo(B, 48, 50);
  {
    // Start the two-kill streak inside a fresh round window.
    for (let i = 0; i < 50; i++) {
      const ends = A.snap?.room?.arena?.round?.endsAt || 0;
      if (ends - Date.now() >= 18500) break;
      A.send({ type: "move", x: A.snap.room.you.x, y: A.snap.room.you.y });
      B.send({ type: "move", x: B.snap.room.you.x, y: B.snap.room.you.y });
      await sleep(400);
    }
    const ends = A.snap?.room?.arena?.round?.endsAt || 0;
    check(ends - Date.now() >= 14000, "(6) arena round window", `${Math.round((ends - Date.now()) / 1000)}s left`);

    // Stand and swing. Moving during the windup makes the cone miss and the
    // second kill slips into the next round (another "Prima ferita!").
    async function swingUntil(pred, ms) {
      const from = A.msgs.length;
      const t = Date.now() + ms;
      while (Date.now() < t) {
        const vp = other(A, B.id);
        const you = A.snap?.room?.you;
        const hit = A.msgs.slice(from).find(pred);
        if (hit) return hit;
        if (vp && you && vp.hp > 0) {
          const d = Math.hypot(vp.x - you.x, vp.y - you.y);
          // Attack even while the last snapshot still says invuln: that flag
          // sticks until the next dirty snapshot, and the server ignores the swings.
          if (d > 3) await stepToward(A, vp.x, vp.y);
          else {
            A.send({ type: "attack", targetId: B.id, combo: 0 });
            await sleep(45);
          }
        } else {
          await stepToward(A, vp?.x ?? 48, vp?.y ?? 76);
        }
      }
      return A.msgs.slice(from).find(pred) || null;
    }

    const k0 = A.snap.room.you.pvp?.kills || 0;
    const fromKill = A.msgs.length;
    const fromDown = B.msgs.length;
    const t1 = Date.now() + 12000;
    let kill1 = null;
    while (Date.now() < t1 && !kill1) {
      A.send({ type: "attack", targetId: B.id, combo: 0 });
      await sleep(45);
      kill1 = A.msgs.slice(fromKill).find((m) => m.type === "pvp_kill" && m.victimId === B.id);
    }
    const down1 = B.msgs.slice(fromDown).find((m) => m.type === "pvp_down");
    check(!!kill1 && kill1.streak === 1 && kill1.firstBlood === true && kill1.announce === "Prima ferita!", "(6) first blood kill feed", kill1 ? `${kill1.announce} streak ${kill1.streak}` : "none");
    check(!!down1 && down1.killerId === A.id && down1.respawnIn === 3000 && (down1.total || 0) > 0 && down1.recap?.length > 0, "(6) pvp_down recap", down1 ? `total ${down1.total} in ${down1.respawnIn}` : "none");

    // Hit during the respawn invulnerability window.
    let poked = false;
    let hpWhile = null;
    const tPoke = Date.now() + 7000;
    while (Date.now() < tPoke && !poked) {
      const vp = other(A, B.id);
      const you = A.snap?.room?.you;
      if (vp && vp.hp >= (vp.maxHp || 1) && vp.pvp?.invuln && you) {
        const d = Math.hypot(vp.x - you.x, vp.y - you.y);
        if (d <= 2.6) {
          const fromP = A.msgs.length;
          A.send({ type: "attack", targetId: B.id, combo: 0 });
          await sleep(500);
          const leaked = A.msgs.slice(fromP).filter((m) => m.type === "combat" && m.targetId === B.id && m.damage > 0);
          hpWhile = other(A, B.id)?.hp;
          poked = leaked.length === 0 && hpWhile === (vp.maxHp || hpWhile);
          check(poked, "(6) attack during invulnerability deals no damage", `hp ${hpWhile} leaks ${leaked.length}`);
          break;
        }
        await stepToward(A, vp.x, vp.y);
      } else if (vp && vp.hp <= 0) {
        await stepToward(A, 48, 76);
      } else {
        await sleep(40);
      }
    }
    check(poked, "(6) reached the victim during invulnerability");

    const kill2 = await swingUntil((m) => m.type === "pvp_kill" && m.victimId === B.id, 12000);
    const feed = A.msgs
      .filter((m) => m.type === "pvp_kill" && m.victimId === B.id)
      .map((k) => `${k.streak}:${k.announce || "-"}:fb${!!k.firstBlood}`)
      .join(" | ");
    check(!!kill2 && kill2.streak === 2 && kill2.announce === "Doppio!" && !kill2.firstBlood, "(6) streak announce on 2 kills", kill2 ? `${kill2.announce} streak ${kill2.streak} fb ${kill2.firstBlood} [${feed}]` : `none [${feed}]`);

    const kill3 = await swingUntil((m) => m.type === "pvp_kill" && m.victimId === B.id && m.streak === 3, 16000);
    check(!!kill3 && kill3.streak === 3, "(6) third credited kill", kill3 ? `streak ${kill3.streak}` : "none");
    const killsAfter3 = A.snap.room.you.pvp?.kills;
    check(killsAfter3 === k0 + 3, "(6) killer kills == 3", String(killsAfter3));

    const from4 = A.msgs.length;
    const fromDown4 = B.msgs.length;
    const fromToast = A.msgs.length;
    const t4 = Date.now() + 16000;
    let down4 = null;
    while (Date.now() < t4 && !down4) {
      const vp = other(A, B.id);
      const you = A.snap?.room?.you;
      down4 = B.msgs.slice(fromDown4).find((m) => m.type === "pvp_down");
      if (down4) break;
      if (vp && you && vp.hp > 0 && Math.hypot(vp.x - you.x, vp.y - you.y) <= 3) {
        A.send({ type: "attack", targetId: B.id, combo: 0 });
        await sleep(45);
      } else {
        await stepToward(A, vp?.x ?? 48, vp?.y ?? 76);
      }
    }
    await sleep(400);
    const kill4 = A.msgs.slice(from4).find((m) => m.type === "pvp_kill" && m.victimId === B.id);
    const glory = A.msgs.slice(fromToast).filter((m) => m.type === "toast" && m.text === NO_GLORY);
    check(!!down4 && !kill4, "(6) anti-farm fourth down has no kill credit", `down ${!!down4} kill ${!!kill4}`);
    check(A.snap.room.you.pvp?.kills === k0 + 3, "(6) kills stay at 3", String(A.snap.room.you.pvp?.kills));
    check(glory.length === 1, "(6) no-glory toast once", String(glory.length));
  }

  // (9) leaderboard
  {
    const from = A.msgs.length;
    A.send({ type: "pvp_leaderboard" });
    const board = await wait(A, (m) => m.type === "pvp_leaderboard", "lb", 3000, from);
    const names = (board.top || []).map((r) => r.name);
    check(names.includes(A.name) && names.includes(B.name) && names.includes(C.name), "(9) ws leaderboard has the players", names.join(","));
    check(board.you && board.you.name === A.name, "(9) ws leaderboard you", board.you?.name);
    const http = await fetch(`http://127.0.0.1:${port}/pvp/leaderboard`).then((r) => r.json());
    const httpNames = (http.top || []).map((r) => r.name);
    check(httpNames.includes(A.name) && httpNames.includes(B.name), "(9) GET /pvp/leaderboard", httpNames.join(","));
  }

  const memo = {
    A: { id: A.id, name: A.name, rating: ratingOf(A), wins: A.snap.room.you.pvp?.wins || 0, kills: A.snap.room.you.pvp?.kills || 0 },
    B: { id: B.id, name: B.name, rating: ratingOf(B), wins: B.snap.room.you.pvp?.wins || 0, kills: B.snap.room.you.pvp?.kills || 0 },
    C: { id: C.id, name: C.name, rating: ratingOf(C), wins: C.snap.room.you.pvp?.wins || 0, kills: C.snap.room.you.pvp?.kills || 0 },
  };
  A.ws.close();
  B.ws.close();
  C.ws.close();
  await sleep(200);

  if (!dbUrl) {
    console.log("SKIP (10) persistence — no DATABASE_URL");
    return;
  }

  await stopServer();
  await startServer();
  const A2 = await connect(memo.A.name);
  const B2 = await connect(memo.B.name);
  const C2 = await connect(memo.C.name);
  check(A2.id === memo.A.id && B2.id === memo.B.id && C2.id === memo.C.id, "(10) same player ids after restart");
  check(ratingOf(A2) === memo.A.rating && (A2.snap.room.you.pvp?.wins || 0) === memo.A.wins && (A2.snap.room.you.pvp?.kills || 0) === memo.A.kills, "(10) A rating/wins/kills survived", `${ratingOf(A2)}/${A2.snap.room.you.pvp?.wins}/${A2.snap.room.you.pvp?.kills} want ${memo.A.rating}/${memo.A.wins}/${memo.A.kills}`);
  check(ratingOf(B2) === memo.B.rating && (B2.snap.room.you.pvp?.kills || 0) === memo.B.kills, "(10) B rating/kills survived", `${ratingOf(B2)} kills ${B2.snap.room.you.pvp?.kills}`);
  check(ratingOf(C2) === memo.C.rating && (C2.snap.room.you.pvp?.wins || 0) === memo.C.wins, "(10) C rating/wins survived", `${ratingOf(C2)} wins ${C2.snap.room.you.pvp?.wins}`);
  const http2 = await fetch(`http://127.0.0.1:${port}/pvp/leaderboard`).then((r) => r.json());
  check((http2.top || []).some((r) => r.name === memo.A.name), "(10) leaderboard after restart");
  A2.ws.close();
  B2.ws.close();
  C2.ws.close();
}

try {
  await startServer();
  await run();
} catch (err) {
  console.error("FAIL exception —", err?.stack || err);
  failures++;
  if (srv?.logs) console.error("--- server log tail ---\n" + srv.logs.slice(-4000));
} finally {
  await stopServer();
}

if (failures) {
  console.error(`FAILED ${failures} check(s)`);
  process.exit(1);
}
console.log("ALL PASS");

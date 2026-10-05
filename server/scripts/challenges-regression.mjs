#!/usr/bin/env node
/**
 * Daily / weekly challenges regression (cosmetic rewards only). Memory mode:
 * in-process units with a pinned clock, then a short over-the-wire check on its own
 * server (PORT_TEST, default 8099).
 *
 *   cd server && node scripts/challenges-regression.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT_TEST || 8099);
if (fs.existsSync(path.join(root, ".env"))) {
  console.error("Memory run would still load server/.env — move it aside first");
  process.exit(2);
}
delete process.env.DATABASE_URL;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
};

const chal = await import("../src/challenges.mjs");

function fakeWs() {
  return { readyState: 1, out: [], send(d) { this.out.push(JSON.parse(d)); } };
}
function fakeRoom(cantoId, role = "combat") {
  return {
    cantoId,
    canto: { role, geo: { bounds: { width: 160, height: 120 } } },
    sessions: new Map(),
    send(ws, m) { ws.send(JSON.stringify(m)); },
    toast(ws, level, text) { ws.send(JSON.stringify({ type: "toast", level, text })); },
    broadcast() {},
    markDirty() {},
    pushSnapshot() {},
  };
}
function addSess(room, id) {
  const s = { playerId: id, ws: fakeWs(), x: 1, y: 1, hp: 100, maxHp: 100 };
  room.sessions.set(id, s);
  return s;
}
const DAY = 86400000;
/** First UTC day on/after `from` whose daily uses event `ev`. */
function dayWith(ev, from = Date.UTC(2026, 9, 5, 12)) {
  for (let i = 0; i < 400; i++) {
    const t = from + i * DAY;
    if (chal.dailyChallenge(chal.dayKey(t)).ev === ev) return t;
  }
  return null;
}

// ---------- keys / resets ----------
{
  check(chal.weekKey(Date.UTC(2026, 9, 5)) === "2026-W41", "ISO week: Mon 2026-10-05 → W41");
  check(chal.weekKey(Date.UTC(2026, 9, 11, 23, 59)) === "2026-W41", "ISO week: Sun 23:59 UTC still W41");
  check(chal.weekKey(Date.UTC(2026, 9, 12)) === "2026-W42", "ISO week: Mon 00:00 UTC rolls to W42");
  check(chal.weekKey(Date.UTC(2027, 0, 1)) === "2026-W53", "ISO week: 2027-01-01 belongs to 2026-W53");
  check(chal.dayKey(Date.UTC(2026, 9, 5, 23, 59, 59)) === "2026-10-05", "UTC day key before midnight");
  check(chal.dayKey(Date.UTC(2026, 9, 6, 0, 0, 1)) === "2026-10-06", "UTC day key after midnight");
  const evs = new Set();
  for (let i = 0; i < 60; i++) evs.add(chal.dailyChallenge(chal.dayKey(Date.UTC(2026, 9, 1) + i * DAY)).ev);
  check(evs.has("mob_kill") || evs.has("heart_break"), "daily pool rotates PvE days in", [...evs].join(","));
  check(evs.has("arena_kill") || evs.has("duel_win"), "daily pool rotates arena days in");
  const bosses = new Set();
  for (let w = 1; w <= 8; w++) bosses.add(chal.weeklyBoss(`2026-W${String(w).padStart(2, "0")}`).bossId);
  check(bosses.size === 4, "weekly boss rotates through 4 bosses", [...bosses].join(","));
}

// ---------- PvE daily ----------
{
  chal._challengesReset();
  const t = dayWith("mob_kill");
  chal._setClock(() => t);
  const room = fakeRoom("inferno_05");
  const P = addSess(room, "pM");
  for (let i = 0; i < 39; i++) chal.challengesOnMobKill(room, "pM", { id: `m${i}`, kind: "mob", archetype: "whirl_shade" });
  let pay = chal.challengesPayload("pM");
  check(pay.daily.progress === 39 && !pay.daily.done, "mob daily: 39/40", `${pay.daily.progress}`);
  const hub = fakeRoom("inferno_01", "hub");
  addSess(hub, "pM");
  chal.challengesOnMobKill(hub, "pM", { id: "hx", kind: "mob", archetype: "whirl_shade" });
  const arena = fakeRoom("inferno_31", "arena");
  addSess(arena, "pM");
  chal.challengesOnMobKill(arena, "pM", { id: "ax", kind: "mob", archetype: "whirl_shade" });
  check(chal.challengesPayload("pM").daily.progress === 39, "mob daily: hub/arena kills do not count");
  chal.challengesOnMobKill(room, "pM", { id: "m40", kind: "mob", archetype: "whirl_shade" });
  pay = chal.challengesPayload("pM");
  check(pay.daily.done && pay.daily.progress === 40, "mob daily: complete at 40");
  check(P.ws.out.some((m) => m.type === "toast" && /Daily challenge complete/.test(m.text)), "mob daily: completion toast");
  check(pay.cosmetics.find((c) => c.id === "title:pit_regular")?.owned, "mob daily: Pit Regular title unlocked");
  check(pay.wearing.title === "title:pit_regular", "first title is worn automatically");
  check(chal.flairOf("pM")?.t === "Pit Regular", "flairOf carries the worn title");
  chal.challengesOnMobKill(room, "pM", { id: "m41", kind: "mob", archetype: "whirl_shade" });
  check(chal.challengesPayload("pM").totals.dailies === 1, "mob daily: counted once");
  // UTC midnight → new day, fresh progress
  chal._setClock(() => t + DAY);
  pay = chal.challengesPayload("pM");
  check(!pay.daily.done && pay.daily.progress === 0 && pay.day !== chal.dayKey(t), "daily resets at UTC midnight");
  check(pay.daily.resetsInMs > 0 && pay.daily.resetsInMs <= DAY, "daily resetsInMs within a day");
  // 7 dailies → Pit Veteran
  chal._challengesReset();
  let n = 0;
  for (let i = 0; i < 400 && n < 7; i++) {
    const ti = Date.UTC(2026, 9, 5, 12) + i * DAY;
    if (chal.dailyChallenge(chal.dayKey(ti)).ev !== "mob_kill") continue;
    chal._setClock(() => ti);
    for (let k = 0; k < 40; k++) chal.challengesOnMobKill(room, "pM", { id: `v${i}-${k}`, kind: "mob", archetype: "x" });
    n++;
  }
  check(chal.challengesPayload("pM").cosmetics.find((c) => c.id === "title:pit_veteran")?.owned, "7 dailies → Pit Veteran");
}

// ---------- heart daily ----------
{
  chal._challengesReset();
  const t = dayWith("heart_break");
  if (t != null) {
    chal._setClock(() => t);
    const room = fakeRoom("inferno_06");
    addSess(room, "pH");
    chal.challengesOnMobKill(room, "pH", { id: "h1", kind: "mob", archetype: "mire_heart" });
    chal.challengesOnMobKill(room, "pH", { id: "s1", kind: "mob", archetype: "mire_shade" });
    check(chal.challengesPayload("pH").daily.progress === 1, "heart daily: shades do not count, hearts do");
  }
}

// ---------- weekly boss race ----------
{
  chal._challengesReset();
  const t = Date.UTC(2026, 9, 5, 12);
  chal._setClock(() => t);
  const wk = chal.weekKey();
  const boss = chal.weeklyBoss(wk);
  const room = fakeRoom(boss.canto);
  const ids = ["r1", "r2", "r3", "r4"];
  for (const id of ids) addSess(room, id);
  // wrong boss / wrong canto never counts
  const other = fakeRoom(boss.canto === "inferno_05" ? "inferno_06" : "inferno_05");
  addSess(other, "r1");
  chal.challengesOnBossKill(other, { id: "minos_gate", kind: "boss" }, ["r1"]);
  check(!chal.challengesPayload("r1").weekly.done, "weekly: another canto's boss does not count");
  chal.challengesOnBossKill(room, { id: boss.bossId, kind: "boss" }, ["r1", "r2"]);
  chal.challengesOnBossKill(room, { id: boss.bossId, kind: "boss" }, ["r3"]);
  chal.challengesOnBossKill(room, { id: boss.bossId, kind: "boss" }, ["r4", "r1"]);
  const p1 = chal.challengesPayload("r1");
  const p4 = chal.challengesPayload("r4");
  check(p1.weekly.done && p1.weekly.rank === 1 && p1.weekly.finishers === 4, "weekly: rank 1 of 4, no double entry", `${p1.weekly.rank}/${p1.weekly.finishers}`);
  check(p4.weekly.rank === 4, "weekly: 4th finisher");
  check(p1.cosmetics.find((c) => c.id === "flair:laurel")?.owned && p1.cosmetics.find((c) => c.id === "title:weekly_victor")?.owned, "weekly: podium earns laurel + Weekly Victor");
  check(!p4.cosmetics.find((c) => c.id === "flair:laurel")?.owned, "weekly: 4th earns no laurel");
  check(p4.cosmetics.find((c) => c.id === boss.title)?.owned, "weekly: every finisher earns the boss title");
  check(chal.flairOf("r1")?.f === "laurel", "flairOf carries the worn flair");
  // next ISO week: fresh race
  chal._setClock(() => t + 7 * DAY);
  const n1 = chal.challengesPayload("r1");
  check(!n1.weekly.done && n1.weekly.finishers === 0 && n1.week !== wk, "weekly resets on Monday UTC");
  // wear / clear
  const W = room.sessions.get("r4");
  chal.handleFlairSet(room, W, "flair", "flair:laurel");
  check(W.ws.out.some((m) => m.type === "toast" && /not unlocked/.test(m.text)), "flair_set: refuses an unowned flair");
  chal.handleFlairSet(room, W, "title", null);
  check(chal.challengesPayload("r4").wearing.title === null, "flair_set: clears the title");
  chal.handleFlairSet(room, W, "title", boss.title);
  check(chal.challengesPayload("r4").wearing.title === boss.title, "flair_set: wears an owned title");
  chal.handleFlairSet(room, W, "flair", "title:pit_regular");
  check(chal.challengesPayload("r4").wearing.flair === null, "flair_set: a title is not a flair");
  // cosmetic only: payload has no stat/ash fields
  check(!JSON.stringify(chal.challengesPayload("r1")).match(/"(ash|xp|armor|damage)"/), "rewards are cosmetic only");
  chal._setClock(null);
  chal._challengesReset();
}

// ---------- over the wire ----------
let srv = null;
try {
  srv = spawn(process.execPath, ["index.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.logs = "";
  srv.stdout.on("data", (d) => (srv.logs += d));
  srv.stderr.on("data", (d) => (srv.logs += d));
  for (let i = 0; i < 120 && !srv.logs.includes("listening on"); i++) await sleep(100);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((res, rej) => {
    ws.on("open", res);
    ws.on("error", rej);
  });
  const msgs = [];
  ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
  ws.send(JSON.stringify({ type: "hello", name: `Ch${Date.now() % 1e5}` }));
  for (let i = 0; i < 100 && !msgs.some((m) => m.type === "snapshot"); i++) await sleep(50);
  ws.send(JSON.stringify({ type: "challenges_get" }));
  let got = null;
  for (let i = 0; i < 100 && !got; i++) {
    got = msgs.find((m) => m.type === "challenges");
    await sleep(30);
  }
  check(!!got?.daily?.text && got.daily.goal > 0, "ws: challenges_get → daily", got?.daily?.text);
  check(!!got?.weekly?.boss && /^\d{4}-W\d\d$/.test(got.week), "ws: weekly boss + ISO week", `${got?.weekly?.boss} ${got?.week}`);
  check(Array.isArray(got?.cosmetics) && got.cosmetics.every((c) => !c.owned), "ws: new pilgrim owns no cosmetics");
  ws.send(JSON.stringify({ type: "flair_set", kind: "title", id: "title:weekly_victor" }));
  let warn = null;
  for (let i = 0; i < 60 && !warn; i++) {
    warn = msgs.find((m) => m.type === "toast" && /not unlocked/.test(m.text || ""));
    await sleep(30);
  }
  check(!!warn, "ws: wearing a locked title is refused");
  ws.close();
} catch (err) {
  check(false, "ws section", err.message);
} finally {
  if (srv) {
    srv.kill("SIGTERM");
    await sleep(300);
    if (/TypeError|ReferenceError/.test(srv.logs)) check(false, "server log clean", srv.logs.split("\n").filter((l) => /Error/.test(l)).slice(0, 3).join(" | "));
  }
}
console.log(failures ? `FAILED ${failures} check(s)` : "ALL PASS");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/**
 * First-run onboarding regression: once-only, skippable, starter skill point.
 * Memory mode (spawns its own server on PORT_TEST, default 8096).
 *
 *   cd server && node scripts/onboarding-regression.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT_TEST || 8096);
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

// ---------- in-process units ----------
const prog = await import("../src/progression.mjs");
const fakeWs = () => ({ readyState: 1, out: [], send(d) { this.out.push(JSON.parse(d)); } });
const room = {
  cantoId: "inferno_01",
  canto: { role: "hub", geo: { bounds: { width: 160, height: 120 } } },
  sessions: new Map(),
  send(ws, m) { ws.send(JSON.stringify(m)); },
  toast(ws, level, text) { ws.send(JSON.stringify({ type: "toast", level, text })); },
  broadcast() {},
  markDirty() {},
  pushSnapshot() {},
};
const sess = (id) => {
  const s = { playerId: id, ws: fakeWs(), x: 20, y: 20, hp: 100, maxHp: 100 };
  room.sessions.set(id, s);
  return s;
};
{
  const T = sess("tT");
  const p0 = prog.getProgress("tT");
  check(p0.tutorialV === 0 && prog.progSnapshot("tT").tut === 0, "new pilgrim: tut 0");
  prog.handleTutorial(room, T, "xp");
  const lvl = prog.getProgress("tT").level;
  check(lvl >= 2 && prog.progSnapshot("tT").points >= 1, "starter XP → level 2 + a skill point", `lv ${lvl}`);
  check(prog.progSnapshot("tT").tut === 1, "after the grant: tut 1 (resume at the tree)");
  const xp1 = prog.getProgress("tT").xp;
  prog.handleTutorial(room, T, "xp");
  check(prog.getProgress("tT").xp === xp1, "starter XP is granted once");
  prog.handleTutorial(room, T, "done");
  check(prog.progSnapshot("tT").tut === 2, "done → tut 2 (never shown again)");
  prog.handleTutorial(room, T, "skip");
  prog.handleTutorial(room, T, "xp");
  check(prog.getProgress("tT").xp === xp1 && prog.progSnapshot("tT").tut === 2, "after done: skip/xp change nothing");

  // Skipping on the first card still leaves the newcomer their first point
  const S = sess("tS");
  prog.getProgress("tS");
  prog.handleTutorial(room, S, "skip");
  check(prog.progSnapshot("tS").tut === 2 && prog.getProgress("tS").level >= 2, "skip before the grant: tut 2 and still level 2");
  const xpS = prog.getProgress("tS").xp;
  prog.handleTutorial(room, S, "xp");
  check(prog.getProgress("tS").xp === xpS, "skip then xp: no second grant");

  // Garbage steps are ignored
  const G = sess("tG");
  prog.getProgress("tG");
  prog.handleTutorial(room, G, "levelup-please");
  check(prog.progSnapshot("tG").tut === 0 && prog.getProgress("tG").xp === 0, "unknown step ignored");
}

// ---------- over the wire ----------
let srv = null;
async function connect(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((res, rej) => {
    ws.on("open", res);
    ws.on("error", rej);
  });
  const c = { ws, name, snap: null, msgs: [] };
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    c.msgs.push(m);
    if (m.type === "snapshot") c.snap = m;
  });
  ws.send(JSON.stringify({ type: "hello", name }));
  for (let i = 0; i < 100 && !c.snap?.room?.you; i++) await sleep(50);
  c.send = (m) => ws.send(JSON.stringify(m));
  return c;
}
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
  const name = `Ob${Date.now() % 1e5}`;
  const a = await connect(name);
  check(a.snap.room.cantoId === "inferno_01", "ws: new pilgrim starts in the Dark Wood");
  check(a.snap.room.you.prog?.tut === 0, "ws: snapshot prog.tut 0");
  a.send({ type: "tutorial", step: "xp" });
  await sleep(500);
  check((a.snap.room.you.prog?.level || 1) >= 2 && (a.snap.room.you.prog?.points || 0) >= 1, "ws: tutorial xp → level 2 + point");
  a.send({ type: "tutorial", step: "done" });
  await sleep(400);
  check(a.snap.room.you.prog?.tut === 2, "ws: tutorial done");
  a.ws.close();
  await sleep(400);
  // Same name restores the same pilgrim: the card must not come back
  const b = await connect(name);
  check(b.snap.room.you.prog?.tut === 2, "ws: reconnect keeps tut 2 (once only)");
  b.ws.close();
} catch (err) {
  check(false, "ws section", err.message);
} finally {
  if (srv) {
    srv.kill("SIGTERM");
    await sleep(300);
  }
}
console.log(failures ? `FAILED ${failures} check(s)` : "ALL PASS");
process.exit(failures ? 1 : 0);

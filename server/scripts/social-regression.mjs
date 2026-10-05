#!/usr/bin/env node
/**
 * Parties, shared XP, arena spectator, soft anti-alt.
 * (Onboarding: scripts/onboarding-regression.mjs; challenges: scripts/challenges-regression.mjs.)
 * Memory mode only (spawns its own server on PORT_TEST, default 8098).
 *
 *   cd server && node scripts/social-regression.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT_TEST || 8098);
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
const party = await import("../src/party.mjs");
const prog = await import("../src/progression.mjs");
const pvp = await import("../src/pvp.mjs");
const link = await import("../src/link.mjs");

function fakeWs() {
  return { readyState: 1, out: [], send(d) { this.out.push(JSON.parse(d)); } };
}
function fakeRoom(cantoId, role = "combat") {
  const room = {
    cantoId,
    canto: { role, geo: { bounds: { width: 160, height: 120 } } },
    sessions: new Map(),
    send(ws, m) { ws.send(JSON.stringify(m)); },
    toast(ws, level, text) { ws.send(JSON.stringify({ type: "toast", level, text })); },
    broadcast() {},
    markDirty() {},
    pushSnapshot() {},
  };
  return room;
}
function addSess(room, id, x, y, extra = {}) {
  const s = { playerId: id, ws: fakeWs(), x, y, hp: 100, maxHp: 100, ...extra };
  room.sessions.set(id, s);
  return s;
}
{
  party._partyReset();
  const room = fakeRoom("inferno_05");
  const where = new Map();
  party.partyInit({ getRoom: (id) => where.get(id) || null, nameOf: (id) => `N-${id}`, levelOf: () => 1 });
  const A = addSess(room, "pA", 10, 10);
  const B = addSess(room, "pB", 70, 10); // 60 u away: outside the 30 u nearby share
  const C = addSess(room, "pC", 12, 10);
  const D = addSess(room, "pD", 14, 10);
  for (const id of ["pA", "pB", "pC", "pD"]) where.set(id, room);
  party.partyHandle("pA", { type: "party_invite", targetId: "pB" });
  check(B.ws.out.some((m) => m.type === "party_invite" && m.fromId === "pA"), "party: B receives invite");
  party.partyHandle("pB", { type: "party_respond", fromId: "pA", accept: true });
  const pv = A.ws.out.filter((m) => m.type === "party").pop();
  check(pv?.party?.members?.length === 2, "party: A+B formed", JSON.stringify(pv?.party?.members?.map((m) => m.id)));
  await sleep(2600); // invite cooldown
  party.partyHandle("pA", { type: "party_invite", targetId: "pC" });
  party.partyHandle("pC", { type: "party_respond", fromId: "pA", accept: true });
  await sleep(2600);
  party.partyHandle("pA", { type: "party_invite", targetId: "pD" });
  check(A.ws.out.some((m) => m.type === "toast" && /full/i.test(m.text)), "party: 4th invite refused (max 3)");
  check(party.partyMembers("pC").length === 3, "party: 3 members");
  // Shared XP: B is 60 u from the kill, C/D are near. D is not in the party.
  const mob = { id: "m1", kind: "mob", x: 11, y: 10, archetype: "lust_shade", hitBy: new Set(["pA"]) };
  const before = { A: prog.getProgress("pA").xp, B: prog.getProgress("pB").xp, D: prog.getProgress("pD").xp };
  prog.grantKillXp(room, "pA", mob);
  const base = prog.killXpValue(mob, "inferno_05");
  const gA = prog.getProgress("pA").xp - before.A;
  const gB = prog.getProgress("pB").xp - before.B;
  const gD = prog.getProgress("pD").xp - before.D;
  check(gB > 0, "shared XP: far party mate (60 u) shares the kill", `+${gB}`);
  check(gA === Math.round(base * 1.2), "shared XP: +10% per extra party member (2 mates → ×1.2)", `${gA} vs base ${base}`);
  check(gD === base, "shared XP: nearby non-member gets plain XP", `${gD}`);
  party.partyHandle("pB", { type: "party_leave" });
  check(party.partyMembers("pA").length === 2, "party: leave drops to 2");
  party.partyHandle("pA", { type: "party_kick", targetId: "pC" });
  check(party.partyIdOf("pA") === null, "party: kick last mate disbands");

  // Decline / expire free the inviter's pending lock (party_invite_result).
  party._partyReset();
  {
    const r2 = fakeRoom("inferno_05");
    const where2 = new Map();
    party.partyInit({ getRoom: (id) => where2.get(id) || null, nameOf: (id) => `N-${id}`, levelOf: () => 1 });
    const A2 = addSess(r2, "pA", 10, 10);
    const B2 = addSess(r2, "pB", 12, 10);
    where2.set("pA", r2);
    where2.set("pB", r2);
    party.partyHandle("pA", { type: "party_invite", targetId: "pB" });
    check(A2.ws.out.some((m) => m.type === "party_invite_result" && m.status === "pending" && m.targetId === "pB"), "party: pending ack on invite");
    A2.ws.out.length = 0;
    party.partyHandle("pB", { type: "party_respond", fromId: "pA", accept: false });
    check(A2.ws.out.some((m) => m.type === "party_invite_result" && m.status === "declined" && m.targetId === "pB"), "party: decline clears pending");
    check(A2.ws.out.some((m) => m.type === "toast" && /declined/i.test(m.text)), "party: decline toasts inviter");
  }
  party._partyReset();
  {
    const r3 = fakeRoom("inferno_05");
    const where3 = new Map();
    party.partyInit({ getRoom: (id) => where3.get(id) || null, nameOf: (id) => `N-${id}`, levelOf: () => 1 });
    const A3 = addSess(r3, "pA", 10, 10);
    addSess(r3, "pB", 12, 10);
    where3.set("pA", r3);
    where3.set("pB", r3);
    party.partyHandle("pA", { type: "party_invite", targetId: "pB" });
    A3.ws.out.length = 0;
    party.partyTick(Date.now() + 31_000);
    check(A3.ws.out.some((m) => m.type === "party_invite_result" && m.status === "expired" && m.targetId === "pB"), "party: expire clears pending");
  }

  // Spectator / anti-alt
  const arena = fakeRoom("inferno_31", "arena");
  const X = addSess(arena, "pX", 30, 30);
  const Y = addSess(arena, "pY", 31, 30);
  check(pvp.pvpCanHit(arena, X, Y), "arena: fighters can hit");
  pvp.pvpSpectate(arena, X, true);
  check(X.spectating === true, "spectate: on");
  check(!pvp.pvpCanHit(arena, X, Y) && !pvp.pvpCanHit(arena, Y, X), "spectate: cannot strike or be struck");
  check(pvp.pvpYou(arena, X)?.spec === true, "spectate: pvpYou.spec");
  await sleep(700);
  pvp.pvpSpectate(arena, X, false);
  check(!X.spectating, "spectate: off");
  X.ws._link = { ip: "aaa", dev: "d1" };
  Y.ws._link = { ip: "aaa", dev: "d2" };
  check(pvp.linkedPair(arena, "pX", "pY") === "ip", "anti-alt: same IP → ip link");
  Y.ws._link = { ip: "bbb", dev: "d1" };
  check(pvp.linkedPair(arena, "pX", "pY") === "dev", "anti-alt: same device → dev link");
  Y.ws._link = { ip: "bbb", dev: "d2" };
  check(pvp.linkedPair(arena, "pX", "pY") === null, "anti-alt: unrelated → none");
  const req = (headers, addr = "10.0.0.9") => ({ headers, socket: { remoteAddress: addr } });
  check(link.clientIp(req({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.1.1.1, 203.0.113.7" })) === "203.0.113.7", "anti-alt: X-Real-IP wins");
  check(link.clientIp(req({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" })) === "198.51.100.4", "anti-alt: right-most XFF hop (left is spoofable)");
  check(link.clientIp(req({})) === "10.0.0.9", "anti-alt: socket address fallback");
  check(link.linkFor(req({}, "127.0.0.1")).ip === null && link.linkFor(req({}, "::1")).ip === null, "anti-alt: loopback never links");
  const lk = link.linkFor(req({ "x-real-ip": "203.0.113.7" }));
  check(/^[0-9a-f]{16}$/.test(lk.ip) && !String(lk.ip).includes("203"), "anti-alt: only a salted hash is kept");
  check(link.deviceKey("short") === null && link.deviceKey("x".repeat(65)) === null, "anti-alt: device id length-checked");
  check(link.deviceKey("device-aaaa-1111") === link.deviceKey("device-aaaa-1111"), "anti-alt: device key stable");

}

// ---------- over the wire ----------
let srv = null;
async function startServer() {
  srv = spawn(process.execPath, ["index.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
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
async function connect(name, device) {
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
  ws.send(JSON.stringify({ type: "hello", name, device }));
  for (let i = 0; i < 100 && !c.snap?.room?.you; i++) await sleep(50);
  c.id = c.snap.room.you.id;
  c.send = (m) => ws.send(JSON.stringify(m));
  return c;
}
async function wait(c, pred, label, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = c.msgs.find(pred);
    if (hit) return hit;
    await sleep(30);
  }
  throw new Error(`${c.name}: timeout ${label}`);
}
try {
  await startServer();
  const a = await connect(`Sa${Date.now() % 1e5}`, "device-aaaa-1111");
  const b = await connect(`Sb${Date.now() % 1e5}`, "device-bbbb-2222");
  a.send({ type: "party_invite", targetId: b.id });
  const inv = await wait(b, (m) => m.type === "party_invite", "party invite");
  b.send({ type: "party_respond", fromId: inv.fromId, accept: true });
  const pm = await wait(a, (m) => m.type === "party" && m.party?.members?.length === 2, "party formed");
  check(pm.party.members.some((m) => m.id === b.id), "ws: party formed with names", pm.party.members.map((m) => m.name).join(","));
  for (const c of [a, b]) c.send({ type: "travel", toCanto: "inferno_31", bypassGates: true });
  await sleep(900);
  check(a.snap.room.cantoId === "inferno_31" && b.snap.room.cantoId === "inferno_31", "ws: both in arena");
  a.send({ type: "arena_spectate", on: true });
  await sleep(700);
  check(a.snap.room.you.pvp?.spec === true, "ws: spectate flag in own snapshot");
  const seen = (b.snap.room.players || []).some((p) => p.id === a.id);
  check(!seen, "ws: spectator hidden from other pilgrims");
  check((a.snap.room.players || []).some((p) => p.id === b.id), "ws: spectator still sees fighters");
  a.send({ type: "arena_spectate", on: false });
  await sleep(900);
  check(!a.snap.room.you.pvp?.spec && (b.snap.room.players || []).some((p) => p.id === a.id), "ws: back in the pit and visible");
  a.ws.close();
  b.ws.close();
} catch (err) {
  check(false, "ws section", err.message);
} finally {
  if (srv) {
    srv.kill("SIGTERM");
    await sleep(300);
    if (/Error|TypeError/.test(srv.logs) && process.env.SHOW_LOGS) console.log(srv.logs);
  }
}
console.log(failures ? `FAILED ${failures} check(s)` : "ALL PASS");
process.exit(failures ? 1 : 0);

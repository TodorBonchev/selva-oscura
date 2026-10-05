/**
 * Parties (2–3 pilgrims). Server-authoritative and in-memory: a party lives as long
 * as its members are online (a dropped member has PARTY_GRACE_MS to come back).
 * Members in the same room within PARTY_SHARE_RANGE share kill XP (progression.mjs).
 *
 * Client → server: party_invite {targetId}, party_respond {fromId, accept},
 *                  party_leave, party_kick {targetId}
 * Server → client: party_invite {fromId, fromName}, party {party|null},
 *                  party_invite_result {targetId, status}, toast via room
 *   status: pending | declined | expired | failed | accepted
 */

export const PARTY_MAX = 3;
export const PARTY_SHARE_RANGE = 60;
export const PARTY_XP_BONUS = 0.1; // per extra party member sharing the kill
const INVITE_MS = 30_000;
const INVITE_CD_MS = 2_500;
const PARTY_GRACE_MS = 90_000;

/** @type {Map<string, {id:string, leader:string, members:string[]}>} */
const parties = new Map();
/** playerId → partyId */
const partyOf = new Map();
/** targetId → Map<fromId, {partyId:string|null, at:number}> */
const invites = new Map();
const lastInvite = new Map();
const goneSince = new Map();
let seq = 0;
let getRoom = () => null;
let nameFn = () => null;
let levelFn = () => undefined;

export function partyInit(opts) {
  if (opts?.getRoom) getRoom = opts.getRoom;
  if (opts?.nameOf) nameFn = opts.nameOf;
  if (opts?.levelOf) levelFn = opts.levelOf;
}

function sessOf(pid) {
  const room = getRoom(pid);
  const s = room?.sessions?.get(pid);
  return s ? { room, s } : null;
}

function sendTo(pid, msg) {
  const hit = sessOf(pid);
  const ws = hit?.s?.ws;
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* closing */
  }
}

function toast(pid, level, text) {
  sendTo(pid, { type: "toast", level, text });
}

function nameOf(pid) {
  return nameFn(pid) || `Pilgrim-${String(pid).slice(0, 4)}`;
}

function view(party) {
  if (!party) return null;
  return {
    id: party.id,
    leader: party.leader,
    max: PARTY_MAX,
    members: party.members.map((id) => {
      const hit = sessOf(id);
      const s = hit?.s;
      return {
        id,
        name: nameOf(id),
        online: Boolean(s),
        canto: hit?.room?.cantoId || null,
        hp: s ? Math.max(0, Math.round(s.hp || 0)) : 0,
        maxHp: s ? Math.round(s.maxHp || 0) : 0,
        level: levelFn(id) || undefined,
      };
    }),
  };
}

function push(party) {
  const v = view(party);
  for (const id of party.members) sendTo(id, { type: "party", party: v });
}

export function partyIdOf(pid) {
  return partyOf.get(pid) || null;
}

export function partyMembers(pid) {
  const p = parties.get(partyOf.get(pid));
  return p ? p.members.slice() : [pid];
}

/** Party mates of `pid` (not `pid`) standing in `room`, alive, within range of (x, y). */
export function partyMatesNear(room, pid, x, y, range = PARTY_SHARE_RANGE) {
  const p = parties.get(partyOf.get(pid));
  if (!p || !room?.sessions) return [];
  const out = [];
  for (const id of p.members) {
    if (id === pid) continue;
    const s = room.sessions.get(id);
    if (!s || !(s.hp > 0)) continue;
    if (Math.hypot((s.x || 0) - x, (s.y || 0) - y) <= range) out.push(id);
  }
  return out;
}

function removeMember(pid, why) {
  const partyId = partyOf.get(pid);
  const p = parties.get(partyId);
  partyOf.delete(pid);
  goneSince.delete(pid);
  if (!p) return;
  p.members = p.members.filter((id) => id !== pid);
  sendTo(pid, { type: "party", party: null });
  if (p.members.length <= 1) {
    for (const id of p.members) {
      partyOf.delete(id);
      sendTo(id, { type: "party", party: null });
      toast(id, "info", why === "kick" ? "Party disbanded." : `${nameOf(pid)} left — party disbanded.`);
    }
    parties.delete(partyId);
    return;
  }
  if (p.leader === pid) p.leader = p.members[0];
  for (const id of p.members) toast(id, "info", `${nameOf(pid)} ${why === "kick" ? "was removed from" : "left"} the party.`);
  push(p);
}

function clearInvite(fromId, targetId, status) {
  sendTo(fromId, { type: "party_invite_result", targetId, status });
}

function invite(fromId, targetId) {
  if (!targetId || targetId === fromId) return;
  const now = Date.now();
  if (now - (lastInvite.get(fromId) || 0) < INVITE_CD_MS) {
    toast(fromId, "warn", "Wait a moment before inviting again.");
    clearInvite(fromId, targetId, "failed");
    return;
  }
  lastInvite.set(fromId, now);
  const target = sessOf(targetId);
  if (!target) {
    toast(fromId, "warn", "That pilgrim is not online.");
    clearInvite(fromId, targetId, "failed");
    return;
  }
  const mine = parties.get(partyOf.get(fromId));
  if (mine && mine.leader !== fromId) {
    toast(fromId, "warn", "Only the party leader can invite.");
    clearInvite(fromId, targetId, "failed");
    return;
  }
  if (mine && mine.members.length >= PARTY_MAX) {
    toast(fromId, "warn", `Party is full (${PARTY_MAX}).`);
    clearInvite(fromId, targetId, "failed");
    return;
  }
  if (partyOf.get(targetId)) {
    toast(fromId, "warn", mine && mine.members.includes(targetId) ? "Already in your party." : `${nameOf(targetId)} is already in a party.`);
    clearInvite(fromId, targetId, "failed");
    return;
  }
  let box = invites.get(targetId);
  if (!box) invites.set(targetId, (box = new Map()));
  box.set(fromId, { partyId: mine?.id || null, at: now });
  sendTo(targetId, { type: "party_invite", fromId, fromName: nameOf(fromId) });
  sendTo(fromId, { type: "party_invite_result", targetId, status: "pending" });
  toast(fromId, "info", `Party invite sent to ${nameOf(targetId)}.`);
}

function respond(targetId, fromId, accept) {
  const box = invites.get(targetId);
  const inv = box?.get(fromId);
  if (box) box.delete(fromId);
  if (!inv || Date.now() - inv.at > INVITE_MS) {
    if (accept) toast(targetId, "warn", "That invite has expired.");
    return;
  }
  if (!accept) {
    toast(fromId, "info", `${nameOf(targetId)} declined the party invite.`);
    clearInvite(fromId, targetId, "declined");
    return;
  }
  if (partyOf.get(targetId)) return toast(targetId, "warn", "Leave your current party first.");
  if (!sessOf(fromId)) return toast(targetId, "warn", "The inviter is no longer online.");
  let p = parties.get(partyOf.get(fromId));
  if (!p) {
    if (partyOf.get(fromId)) return;
    p = { id: `pt${++seq}`, leader: fromId, members: [fromId] };
    parties.set(p.id, p);
    partyOf.set(fromId, p.id);
  }
  if (p.members.length >= PARTY_MAX) return toast(targetId, "warn", "That party is full.");
  p.members.push(targetId);
  partyOf.set(targetId, p.id);
  invites.delete(targetId);
  clearInvite(fromId, targetId, "accepted");
  for (const id of p.members) toast(id, "info", `${nameOf(targetId)} joined the party. Kills nearby share XP.`);
  push(p);
}

/** Returns true when the message was a party message. */
export function partyHandle(pid, msg) {
  switch (msg?.type) {
    case "party_invite":
      invite(pid, String(msg.targetId || ""));
      return true;
    case "party_respond":
      respond(pid, String(msg.fromId || ""), Boolean(msg.accept));
      return true;
    case "party_leave":
      if (partyOf.get(pid)) removeMember(pid, "leave");
      return true;
    case "party_kick": {
      const p = parties.get(partyOf.get(pid));
      const t = String(msg.targetId || "");
      if (p && p.leader === pid && t !== pid && p.members.includes(t)) removeMember(t, "kick");
      return true;
    }
    case "party_get":
      sendTo(pid, { type: "party", party: view(parties.get(partyOf.get(pid))) });
      return true;
    default:
      return false;
  }
}

/** Every ~2 s: refresh member HP/canto, expire invites, drop long-gone members. */
export function partyTick(now = Date.now()) {
  for (const [tid, box] of invites) {
    for (const [fid, inv] of [...box]) {
      if (now - inv.at > INVITE_MS) {
        box.delete(fid);
        clearInvite(fid, tid, "expired");
      }
    }
    if (!box.size) invites.delete(tid);
  }
  for (const p of [...parties.values()]) {
    for (const id of p.members.slice()) {
      if (sessOf(id)) goneSince.delete(id);
      else if (!goneSince.has(id)) goneSince.set(id, now);
      else if (now - goneSince.get(id) > PARTY_GRACE_MS) removeMember(id, "leave");
    }
    if (parties.has(p.id)) push(p);
  }
}

/** Tests only. */
export function _partyReset() {
  parties.clear();
  partyOf.clear();
  invites.clear();
  lastInvite.clear();
  goneSince.clear();
}

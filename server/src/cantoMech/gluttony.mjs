/**
 * Gluttony (inferno_06) — the Mire. Canto VI: "Io sono al terzo cerchio, de la piova /
 * etterna, maladetta, fredda e greve… Grandine grossa, acqua tinta e neve / per l'aere
 * tenebroso si riversa; / pute la terra che questo riceve."
 *
 *  1. Mire + causeway (geo.causeway, gluttonyMire.mjs): off the old stones a pilgrim
 *     wades at mire_mul speed (a token-bucket move budget in adjustMove, the client
 *     predicts the same in moveFeel) and dashes dash_mul as far (dashScale). Armoured
 *     foes (champions, wardens — Cerbero too) are dragged by the mud as well; the mire's
 *     own shades and wisps are not. Stand still in deep mud and it closes on your feet
 *     (SINK: a small telegraph at your feet; still inside when it shuts → held).
 *  2. Sepolti — buried shades ("ombre che adona la greve pioggia"): packs flagged
 *     `buried` start out of the world as bubbling mounds (snapshot mech.bm/bb). A
 *     pilgrim within RISE_R wakes one: it rises with a GRAB telegraph (hit → rooted),
 *     then fights normally. Mounds are not entities, so nothing can target them and the
 *     bot never counts them; the Maw's fall stills the rest.
 *  3. Grandine grossa — hail volleys: every ~7 s each pilgrim gets 3–5 small circle
 *     telegraphs (one leads their stride), 1 s of warning, a light blow + short slow.
 *     Hail hits foes too: drag a pack under it. The storm hunts the traveller: its clock
 *     runs faster for a pilgrim on the road and slower in a close fight (the foes' blows
 *     are enough to read). And it answers the jaws: when the Maw or Cerbero opens on a
 *     pilgrim whose volley is due soon, it falls now (the skipped wait carries over — as
 *     many stones, only worse timed). A pilgrim the mire holds is never pelted.
 *  4. Triple Maw (Cerberus): three heads bite left → centre → right as staggered cone
 *     telegraphs; hugging him earns a gorge slam. Clods: clod POIs by the dais (and
 *     Cerbero's step) are grabbed with E (onInteract) and thrown by the next attack
 *     (onAttack): into a head during its open-mouth windup it chokes that throat for
 *     SILENCE_S (its bite is cancelled / skipped) and the Maw takes ×SILENCE_MUL while
 *     any throat is choked. The clod finds the jaw coming for the thrower (the open head
 *     whose cone covers them), else the one about to snap. A throw is a heave: the
 *     thrower's feet are planted for CLOD.heaveMs (a dash still breaks it). A throw is
 *     an attack packet with combo THROW_COMBO (3; melee swings are 0–2), so a blade
 *     swing in flight never spends the fistful.
 *     Phase 2 (≤50%), "le bocche aperse": all three jaws open at once with a longer
 *     reach, and "Fango" wisps crawl out of the mire to feed him (heal) unless cut down
 *     (at most FEED.spawns per phase). Plain damage always kills him.
 *     Cerbero (mid elite) wakes one head — a single bite cone — and teaches the clod.
 *
 * Wire (server → client; the client mech consumes these):
 *   glut_rise    { k, id, x, y, dur }        buried shade k rises (sent before its entity)
 *   glut_hail    { pts: [x, y, r, …], dur, crown? }  a volley's stones (the circles are
 *                                            telegraphs; crown: a ring with one gap)
 *   glut_bite    { id, head, dur }           a head starts its bite windup (0 L, 1 C, 2 R)
 *   glut_silence { id, head, dur }           a clod choked that throat
 *   glut_grab    { pid, id }                 a pilgrim scooped a clod
 *   glut_clod    { pid, x, y, tid, tx, ty, dur }   a thrown clod in the air (lands after dur ms)
 *   glut_feed    { id, boss, heal }          a Fango reached the Maw
 *   glut_sink    { x, y, dur }               (to that pilgrim) the mud closes on your feet
 * Telegraph kinds: hail, mire_grab (a rising shade's grab, a clod heap's snatch),
 * mire_sink, fango_burst, maw_bite_l/c/r, cerbero_bite (+ the core boss_slam).
 * Snapshot mech: { bv, bb, c, cw?, bm?, hs?, cs? } — see snapshotExtra.
 */
import { brake, chase, interruptAttack, pushMob, startAttack, walkTo } from "../mobAi.mjs";
import { pointInShape } from "../telegraph.mjs";
import { makeMire } from "./gluttonyMire.mjs";

/** Armoured foes the mud drags (shades and wisps are the mire's own). */
const MIRE_DRAGGED = new Set(["mire_champion", "mire_warden"]);
/** Walking speed the client predicts at (room PLAYER_WALK_SPEED). */
const WALK = 8;
/**
 * Move budget in the mire: each move packet may cover its own interval at the wade's
 * pace (× slack), plus at most BUCKET_CAP of saved-up slack. A late packet after a lag
 * spike carries its long interval with it, so it still passes; a stream of full-speed
 * steps (a client that ignores the mud) gets a stride's burst, then the wade.
 */
const BUCKET_CAP = 0.35;
const BUCKET_SLACK = 1.15;

/** Buried shades: wake radius and the rising grab. */
const RISE_R = 3.8;
/** The buried lie together: a rising shade wakes its fellows this near, a beat apart. */
const CHAIN_R = 10.5;
const CHAIN_BEAT = 0.3;
const GRAB = { radius: 3.8, windupMs: 800, rootMs: 800, dmg: 15 };

/**
 * The mire closes on a pilgrim who stands still in it: after STILL_S within ANCHOR_R of
 * one spot in deep mud, a small circle telegraph at their feet (kind mire_sink) — still
 * inside when it closes, they're held fast. Step out (or fight from the stones).
 */
const SINK = { stillS: 1.3, anchorR: 2.2, minDepth: 0.8, radius: 1.15, windupMs: 1000, rootMs: 1000, dmg: 7, cdS: 4.5 };

/** Hail volleys (seconds unless noted). */
const HAIL = {
  first: [7, 10],
  every: [6, 8],
  bossEvery: [5.5, 7],
  windupMs: 1000,
  dmg: 15,
  mobDmg: 15,
  slow: 0.6,
  slowMs: 700,
  r: [1.55, 1.95],
  /** no hail on the entrance landing (a wakened pilgrim is never pelted there) */
  spawnSafe: 13,
  /** lead the pilgrim's stride by this much: keep walking straight and it finds you */
  lead: 0.85,
  /**
   * A crown ("grandine a corona"): one stone on you and three around you, one side
   * left open — read the ring and step out through the gap.
   */
  crownP: 0.35,
  crownR: 2.9,
  /**
   * A pilgrim the mire holds (or held this recently, ms) is never pelted: their volley
   * waits, and stones already falling spare them — every stone must be dodgeable.
   */
  heldGraceMs: 500,
  /** a volley due within this many seconds falls with a biter's jaws opening on the pilgrim */
  syncS: 2.5,
  /** the clock's pace: a pilgrim on the road (on the move, no foe close) / at close
   * quarters with a foe (whose own blows are enough to read) */
  roadRate: 1.4,
  engagedRate: 0.65,
  engagedR: 6,
  /** co-op: pilgrims this close share one hail clock (a volley per knot per gap) */
  knotR: 6.5,
  knotGapMs: 5000,
};

/**
 * Triple Maw. His hide is thick (the room's 680 → MAW_HP); the choked throats are the
 * way in (×SILENCE_MUL), though plain blows always get there in the end.
 */
const MAW_HP = 800;
/**
 * The heads' reach covers most of the dais in front of him: backing out takes a dash;
 * a choked throat leaves its wedge of the fan safe (the way through).
 */
const BITE = { radius: 7.8, arc: 1.3, spread: 0.8, windup: 1.0, stagger: 0.36, recover: 1.2, dmgMul: 0.7 };
/**
 * Phase 2 — "le bocche aperse": all three jaws open at once and snap in turn, left →
 * centre → right (every cone is on the ground from the start; the fills land in order),
 * the necks stretched further: the fan reaches past where a pilgrim could wait out the
 * first phase's bites. Behind him, a choked throat's wedge, or a well-timed dash.
 */
const BITE_P2 = { windup: 0.8, stagger: 0.25, recover: 0.8, together: true, radius: 9.4, dmgMul: 0.8 };
const BITE_KINDS = ["maw_bite_l", "maw_bite_c", "maw_bite_r"];
/** Planar offset of each head's cone from the Maw's facing (L = model −x side). */
const HEAD_OFF = [-BITE.spread, 0, BITE.spread];
const MAW_SLAM = { shape: "circle", radius: 3.4, windup: 1.2, trigger: 3.6, recover: 1.35, kind: "boss_slam", dmgMul: 0.7 };
const SILENCE_S = 5;
const SILENCE_MUL = 1.5;
/**
 * Fango: phase 2 feeders. A feed heals `heal` of his life but never past `cap` (his open
 * wounds stay open), and once `drain` of his life has been fed the mire has no more to
 * give — so plain blows always finish him, fed or not.
 */
/** A Fango cut down bursts in a spray of filth a beat later (step out of it). */
const FANGO_BURST = { radius: 3.0, windupMs: 550, dmg: 12, slow: 0.6, slowMs: 900 };
/** (`spawns`: at most this many crawl out per phase 2 — cut down or not, the mire runs dry) */
const FEED = { every: [7, 9], per: 2, max: 4, spawns: 8, speed: 2.4, heal: 0.04, cap: 0.5, drain: 0.18, hp: 20, spawnR: [11.5, 13] };

/** Cerbero, one waking head. */
const CERB = { hpMul: 2.2, radius: 4.4, arc: 1.25, windup: 0.95, trigger: 3.8, recover: 1.15, dmgMul: 1.0 };

/**
 * Clods of mire. The mire does not give up its earth freely: scooping one sets its hands
 * closing on the taker — a grab telegraph at your feet with a full second of warning, so
 * a step or two out of it (wading, no dash needed) keeps the fistful free. Within
 * `biterR` of a biter it only drags at you (a slow, never a hold into the next bite).
 */
const CLOD = {
  range: 11,
  speed: 24,
  headDmg: 10,
  splatDmg: 6,
  mobDmg: 8,
  grabCdMs: 900,
  snatch: { radius: 1.6, windupMs: 1000, rootMs: 600, dmg: 12, biterR: 10, slow: 0.55, slowMs: 800 },
  /** the heave: a throw plants the thrower's feet this long (ms) — throw, then move */
  heaveMs: 300,
};
/** The attack packet's combo value that throws (melee swings are 0–2). */
const THROW_COMBO = 3;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r1 = (v) => Math.round(v * 10) / 10;

function nearestPilgrim(room, x, y) {
  let best = null;
  let bd = Infinity;
  for (const s of room.sessions.values()) {
    if (!(s.hp > 0)) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best ? { s: best, d: bd } : null;
}

function toastNear(room, x, y, r, level, text) {
  for (const s of room.sessions.values()) {
    if (Math.hypot(s.x - x, s.y - y) <= r) room.toast(s.ws, level, text);
  }
}

/** Every hold the mire puts on a pilgrim goes through here (the hail spares the held). */
function holdFast(room, s, ms) {
  s._glutHeldUntil = Math.max(s._glutHeldUntil || 0, Date.now() + ms);
  room.statusPlayer(s, { root: true, durMs: ms });
}

function heldRecently(s, now) {
  return now < (s._glutHeldUntil || 0) + HAIL.heldGraceMs;
}

/** A biter's jaws (the Maw's heads, Cerbero's) opening this moment on or by the pilgrim. */
function freshThreatOn(room, s) {
  const live = room.tele && room.tele.live;
  if (!live) return false;
  for (let i = 0; i < live.length; i++) {
    const t = live[i];
    if (t.kind !== "cerbero_bite" && !BITE_KINDS.includes(t.kind)) continue;
    if (t.durMs / 1000 - t.left > 0.2) continue;
    if (pointInShape(t, s.x, s.y, 1.0)) return true;
  }
  return false;
}

/** A live foe (mob or boss) within r of (x, y). */
function foeNear(room, x, y, r) {
  for (const e of room.entities.values()) {
    if ((e.kind !== "mob" && e.kind !== "boss") || !(e.hp > 0)) continue;
    if (Math.abs(e.x - x) < r && Math.abs(e.y - y) < r && Math.hypot(e.x - x, e.y - y) <= r) return true;
  }
  return false;
}

/** A live biter (the Maw, or Cerbero) within r of (x, y). */
function biterNear(room, x, y, r) {
  for (const e of room.entities.values()) {
    if (!(e.hp > 0) || e._dead || (e.id !== "triple_maw" && !e.cerbero)) continue;
    if (Math.hypot(e.x - x, e.y - y) <= r) return true;
  }
  return false;
}

// ——— buried shades ————————————————————————————————————————————————————

function rise(room, g, b, who) {
  b.up = true;
  g.bmask &= ~(1 << b.k);
  const e = b.e;
  const rx = b.x;
  const ry = b.y;
  e.x = rx;
  e.y = ry;
  e.homeX = rx;
  e.homeY = ry;
  e.sp = 0;
  e.kvx = 0;
  e.kvy = 0;
  e.hd = Math.atan2(who.y - ry, who.x - rx);
  // The client readies the rising body before its entity arrives, then the snapshot
  // builds the node, then the grab telegraph poses it (no frame of a standing shade)
  room.broadcast({ type: "glut_rise", k: b.k, id: e.id, x: +rx.toFixed(2), y: +ry.toFixed(2), dur: GRAB.windupMs });
  room.entities.set(e.id, e);
  room.pushAllSnapshots();
  const t = room.telegraph({
    attackerId: e.id,
    shape: "circle",
    x: rx,
    y: ry,
    // (a circle ignores dir; the shade's rise pose faces along it)
    dir: e.hd,
    radius: GRAB.radius,
    duration: GRAB.windupMs,
    kind: "mire_grab",
    // the mire's cold hands (tier-scaled like the shade's own blows)
    dmg: Math.round(GRAB.dmg * (room.mobAttackDamage(e) / 8)),
    onLand: (_r, tt) => {
      if (e.teleId === tt.id) {
        e.teleId = null;
        e.windupLeft = 0;
      }
      e.atkCd = Math.max(e.atkCd || 0, 0.75);
    },
    // the mire's hands close on your ankles (not on a dash)
    onHit: (r, tt, s) => {
      holdFast(r, s, GRAB.rootMs);
      return tt.dmg;
    },
  });
  e.teleId = t.id;
  e.windupLeft = GRAB.windupMs / 1000;
  e.windupMax = e.windupLeft;
  e.poise = 0;
  e.atkCd = e.windupLeft + 0.05;
  room.markDirty();
}

/** The Maw fell: the mire goes still (mounds sink for good, Fango dissolve). */
function stillTheMire(room, g) {
  for (const b of g.buried) b.up = true;
  g.bmask = 0;
  for (const e of [...room.entities.values()]) {
    if (!e._feeder) continue;
    room.entities.delete(e.id);
    room.broadcast({ type: "entity_removed", id: e.id });
  }
  room.markDirty();
}

// ——— hail ———————————————————————————————————————————————————————————————

function volley(room, s, phase2) {
  const b = room.canto.geo.bounds;
  const n = 3 + (Math.random() < 0.65 ? 1 : 0) + (phase2 ? 1 : 0);
  const pts = [];
  if (Math.random() < HAIL.crownP) {
    // the crown: centre on the pilgrim, three of four slots around, one left open
    pts.push(+s.x.toFixed(2), +s.y.toFixed(2), 1.6);
    const a0 = Math.random() * Math.PI * 2;
    const gap = Math.floor(Math.random() * 4);
    for (let k = 0; k < 4; k++) {
      if (k === gap) continue;
      const a = a0 + (k * Math.PI) / 2;
      pts.push(
        +clamp(s.x + Math.cos(a) * HAIL.crownR, 1.5, b.width - 1.5).toFixed(2),
        +clamp(s.y + Math.sin(a) * HAIL.crownR, 1.5, b.height - 1.5).toFixed(2),
        1.5
      );
    }
    dropVolley(room, pts, true, s.playerId);
    return;
  }
  const vx = s._glutVx || 0;
  const vy = s._glutVy || 0;
  const place = (x, y, r) => {
    x = clamp(x, 1.5, b.width - 1.5);
    y = clamp(y, 1.5, b.height - 1.5);
    for (let i = 0; i < pts.length; i += 3) {
      if (Math.hypot(pts[i] - x, pts[i + 1] - y) < pts[i + 2] + r - 0.35) return false;
    }
    pts.push(+x.toFixed(2), +y.toFixed(2), +r.toFixed(2));
    return true;
  };
  // one stone finds your stride, one the spot you stand on (either way: move, and
  // not in a straight line); the rest fence you in
  place(s.x + vx * HAIL.lead, s.y + vy * HAIL.lead, rand(HAIL.r[0], HAIL.r[1]));
  if (Math.hypot(vx, vy) * HAIL.lead > 1.6) place(s.x, s.y, rand(HAIL.r[0], HAIL.r[1]));
  for (let i = pts.length / 3; i < n; i++) {
    for (let tries = 0; tries < 10; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = rand(2.3, 5.2);
      if (place(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, rand(HAIL.r[0], HAIL.r[1]))) break;
    }
  }
  dropVolley(room, pts, false, s.playerId);
}

/**
 * The volley's stones as hail telegraphs (+ the visual stones for everyone). `pid`: the
 * pilgrim it fell for — a foe the hail kills is theirs (loot, bounty, pack lines), though
 * the blow on the wire is the hail's own.
 */
function dropVolley(room, pts, crown, pid) {
  for (let i = 0; i < pts.length; i += 3) {
    room.telegraph({
      attackerId: "mech:hail",
      shape: "circle",
      x: pts[i],
      y: pts[i + 1],
      radius: pts[i + 2],
      duration: HAIL.windupMs,
      kind: "hail",
      dmg: HAIL.dmg,
      onLand: (r, t) => {
        // grandine grossa falls on shade and pilgrim alike
        for (const e of [...r.entities.values()]) {
          if ((e.kind !== "mob" && e.kind !== "boss") || !(e.hp > 0) || e._dead) continue;
          if (Math.hypot(e.x - t.x, e.y - t.y) > (t.radius || 1) + 0.35) continue;
          r.damageMob(e, HAIL.mobDmg, pid || "mech:hail", { spellId: "hail", from: { x: t.x, y: t.y }, source: "mech:hail" });
        }
      },
      onHit: (r, t, sess) => {
        // held fast by the mire as the stones fell: they couldn't step out — spared
        if (heldRecently(sess, Date.now())) return 0;
        r.statusPlayer(sess, { slow: HAIL.slow, durMs: HAIL.slowMs });
        return t.dmg;
      },
    });
  }
  room.broadcast({ type: "glut_hail", pts, dur: HAIL.windupMs, crown: crown || undefined });
}

function tickSink(room, g, s, nowMs) {
  if (!g.mire || !(s.hp > 0)) {
    s._glutAnchor = null;
    return;
  }
  const a = s._glutAnchor;
  if (!a || Math.hypot(s.x - a.x, s.y - a.y) > SINK.anchorR) {
    s._glutAnchor = { x: s.x, y: s.y, t: nowMs };
    return;
  }
  if (nowMs - a.t < SINK.stillS * 1000 || nowMs < (s._glutSinkCd || 0)) return;
  if (g.mire.depth(s.x, s.y) < SINK.minDepth || s.iframes > 0) return;
  s._glutSinkCd = nowMs + SINK.windupMs + SINK.cdS * 1000;
  a.t = nowMs;
  room.telegraph({
    attackerId: "mech:mire",
    shape: "circle",
    x: s.x,
    y: s.y,
    radius: SINK.radius,
    duration: SINK.windupMs,
    kind: "mire_sink",
    dmg: SINK.dmg,
    onHit: (r, t, sess) => {
      holdFast(r, sess, SINK.rootMs);
      return t.dmg;
    },
  });
  room.send(s.ws, { type: "glut_sink", x: +s.x.toFixed(2), y: +s.y.toFixed(2), dur: SINK.windupMs });
}

function tickHail(room, s, dt, maw) {
  // woke at the entrance (a death): the fistful of mire is gone
  if (s._glutPx != null && Math.hypot(s.x - s._glutPx, s.y - s._glutPy) > 12) s._glutClod = false;
  // stride estimate (a hailstone leads it); teleports (dash, wake) are clamped out
  if (s._glutPx != null && dt > 0) {
    let vx = (s.x - s._glutPx) / dt;
    let vy = (s.y - s._glutPy) / dt;
    const sp = Math.hypot(vx, vy);
    if (sp > WALK) {
      vx = 0;
      vy = 0;
    }
    const k = Math.min(1, dt * 5);
    s._glutVx = (s._glutVx || 0) + (vx - (s._glutVx || 0)) * k;
    s._glutVy = (s._glutVy || 0) + (vy - (s._glutVy || 0)) * k;
  }
  s._glutPx = s.x;
  s._glutPy = s.y;
  if (!(s.hp > 0)) return;
  if (s._glutHailT == null) s._glutHailT = rand(HAIL.first[0], HAIL.first[1]);
  // the storm hunts the traveller: on the road its clock runs fast, at close quarters
  // with a foe it gives the fight room
  let rate = 1;
  if (foeNear(room, s.x, s.y, HAIL.engagedR)) rate = HAIL.engagedRate;
  else if (Math.hypot(s._glutVx || 0, s._glutVy || 0) > 2) rate = HAIL.roadRate;
  s._glutHailT -= dt * rate;
  // the storm answers the jaws: the Maw's or Cerbero's opening on you pulls a due volley
  // in (the skipped wait carries over to the next one)
  if (s._glutHailT > 0 && s._glutHailT <= HAIL.syncS && freshThreatOn(room, s)) {
    s._glutHailCarry = (s._glutHailCarry || 0) + s._glutHailT;
    s._glutHailT = 0;
  }
  if (s._glutHailT > 0) return;
  // held by the mire (or only just freed): the volley waits for their feet
  if (heldRecently(s, Date.now())) {
    s._glutHailT = 0.4;
    return;
  }
  const nearMaw = maw && Math.hypot(maw.x - s.x, maw.y - s.y) < 18;
  const every = nearMaw ? HAIL.bossEvery : HAIL.every;
  s._glutHailT = rand(every[0], every[1]) + (s._glutHailCarry || 0);
  s._glutHailCarry = 0;
  const sp = room.canto.geo.spawn;
  if (Math.hypot(s.x - sp.x, s.y - sp.y) < HAIL.spawnSafe || s.iframes > 0) return;
  // Co-op: a knot of pilgrims shares one storm — a volley just fell on a companion
  // close by (its stones fall on this pilgrim too), so this clock waits its turn
  const nowMs = Date.now();
  for (const o of room.sessions.values()) {
    if (o === s || !(o._glutVolleyAt > nowMs - HAIL.knotGapMs)) continue;
    if (Math.hypot(o.x - s.x, o.y - s.y) < HAIL.knotR) return;
  }
  s._glutVolleyAt = nowMs;
  volley(room, s, Boolean(nearMaw && maw.phase === 2));
}

// ——— Triple Maw ——————————————————————————————————————————————————————————

function mawState(e) {
  if (!e._maw) {
    // a fresh Maw (spawn or respawn): his own measure of life
    if (e.hp >= e.maxHp && e.maxHp < MAW_HP) {
      e.maxHp = MAW_HP;
      e.hp = MAW_HP;
    }
    e._maw = {
      heads: [0, 1, 2].map(() => ({ silence: 0, teleId: null })),
      seq: null,
      bites: 0,
      feedT: 2,
      feedToast: false,
    };
  }
  return e._maw;
}

function startHead(room, e, m, i) {
  const q = m.seq;
  // (phase 2: every jaw opens now, each snapping a stagger after the last)
  const windup = q.together ? q.windup + i * q.stagger : q.windup;
  const h = m.heads[i];
  // a choked throat can't bite
  if (h.silence > 0) return;
  const t = room.telegraph({
    attackerId: e.id,
    shape: "cone",
    x: e.x,
    y: e.y,
    dir: q.dir + HEAD_OFF[i],
    radius: q.radius,
    arc: BITE.arc,
    duration: windup * 1000,
    kind: BITE_KINDS[i],
    dmg: Math.round(room.mobAttackDamage(e) * q.dmgMul),
    extra: { head: i },
    onLand: (_r, tt) => {
      if (h.teleId === tt.id) h.teleId = null;
    },
  });
  h.teleId = t.id;
  room.broadcast({ type: "glut_bite", id: e.id, head: i, dur: Math.round(windup * 1000) });
}

function startSeq(room, e, m, target) {
  const p2 = e.phase === 2;
  const dir = Math.atan2(target.y - e.y, target.x - e.x);
  m.seq = {
    t: 0,
    dir,
    next: 0,
    windup: p2 ? BITE_P2.windup : BITE.windup,
    stagger: p2 ? BITE_P2.stagger : BITE.stagger,
    recover: p2 ? BITE_P2.recover : BITE.recover,
    together: p2 && BITE_P2.together,
    radius: p2 ? BITE_P2.radius : BITE.radius,
    dmgMul: p2 ? BITE_P2.dmgMul : BITE.dmgMul,
  };
  e.hd = dir;
  e.sp = 0;
  stepSeq(room, e, m, 0);
}

function stepSeq(room, e, m, dt) {
  const q = m.seq;
  q.t += dt;
  while (q.next < 3 && (q.together || q.t >= q.next * q.stagger)) startHead(room, e, m, q.next++);
  e.windupLeft = Math.max(0, 2 * q.stagger + q.windup - q.t);
  if (q.t >= 2 * q.stagger + q.windup + 0.05) {
    m.seq = null;
    e.windupLeft = 0;
    e.atkCd = q.recover;
    m.bites++;
  }
}

/** Leash reset / death: drop the bite sequence and any live head telegraphs. */
function endSeq(room, m) {
  m.seq = null;
  for (const h of m.heads) {
    if (h.teleId) room.cancelTelegraph(h.teleId, "leash");
    h.teleId = null;
  }
}

function enterPhase2(room, e, m) {
  e.phase = 2;
  e.phase2Toast = true;
  m.feedT = 0.8;
  m.fed = 0;
  m.spawned = 0;
  toastNear(room, e.x, e.y, 30, "warn", "«le bocche aperse» — stop the Fango feeding him");
}

function spawnFeeder(room, g, maw) {
  const b = room.canto.geo.bounds;
  const hx = maw.homeX ?? maw.x;
  const hy = maw.homeY ?? maw.y;
  const a = Math.random() * Math.PI * 2;
  const d = rand(FEED.spawnR[0], FEED.spawnR[1]);
  const id = `mob_glutfeed_${++g.feedSeq}`;
  const hp = Math.round(FEED.hp * 1.1);
  room.entities.set(id, {
    id,
    kind: "mob",
    name: "Fango",
    x: clamp(hx + Math.cos(a) * d, 2, b.width - 2),
    y: clamp(hy + Math.sin(a) * d, 2, b.height - 2),
    hp,
    maxHp: hp,
    champion: false,
    elite: false,
    dropTable: "inferno_pack_common",
    archetype: "mud_wisp",
    atkCd: 0,
    // a summoned add: the road-clear / pack-clear lines don't count it
    summoned: true,
    _feeder: maw.id,
  });
}

function tickFeeders(room, g, e, m, dt) {
  m.feedT -= dt;
  if (m.feedT > 0 || (m.fed || 0) >= e.maxHp * FEED.drain || (m.spawned || 0) >= FEED.spawns) return;
  m.feedT = rand(FEED.every[0], FEED.every[1]);
  let alive = 0;
  for (const x of room.entities.values()) if (x._feeder) alive++;
  const n = Math.min(FEED.per, FEED.max - alive, FEED.spawns - (m.spawned || 0));
  m.spawned = (m.spawned || 0) + Math.max(0, n);
  for (let i = 0; i < n; i++) spawnFeeder(room, g, e);
  if (n > 0) room.markDirty();
  if (n > 0 && !m.feedToast) {
    m.feedToast = true;
    toastNear(room, e.x, e.y, 30, "info", "Fango crawls out of the mire toward the Maw");
  }
}

function feed(room, maw, f) {
  room.entities.delete(f.id);
  room.broadcast({ type: "entity_removed", id: f.id });
  const before = maw.hp;
  maw.hp = Math.max(maw.hp, Math.min(maw.maxHp * FEED.cap, maw.hp + maw.maxHp * FEED.heal));
  const heal = Math.round(maw.hp - before);
  const m = mawState(maw);
  m.fed = (m.fed || 0) + heal;
  room.broadcast({ type: "glut_feed", id: f.id, boss: maw.id, heal });
  room.markDirty();
}

// ——— Cerbero ——————————————————————————————————————————————————————————————

function startCerbBite(room, e, target) {
  const dir = Math.atan2(target.y - e.y, target.x - e.x);
  const t = room.telegraph({
    attackerId: e.id,
    shape: "cone",
    x: e.x,
    y: e.y,
    dir,
    radius: CERB.radius,
    arc: CERB.arc,
    duration: CERB.windup * 1000,
    kind: "cerbero_bite",
    // a hound's jaws, not a champion's fist
    dmg: Math.round(room.mobAttackDamage(e) * CERB.dmgMul),
    extra: { head: 0 },
    onLand: (_r, tt) => {
      if (e.teleId !== tt.id) return;
      e.teleId = null;
      e.windupLeft = 0;
      e.atkCd = Math.max(e.atkCd || 0, CERB.recover);
      // the lunge of the jaws
      pushMob(e, Math.cos(tt.dir), Math.sin(tt.dir), 0.5);
    },
  });
  e.teleId = t.id;
  e.windupLeft = CERB.windup;
  e.windupMax = CERB.windup;
  e.poise = 0;
  e.hd = dir;
  e.atkCd = CERB.windup + 0.05;
  room.broadcast({ type: "glut_bite", id: e.id, head: 0, dur: Math.round(CERB.windup * 1000) });
  room.markDirty();
}

// ——— clods ——————————————————————————————————————————————————————————————————

function silence(room, e, head) {
  room.broadcast({ type: "glut_silence", id: e.id, head, dur: SILENCE_S * 1000 });
}

function landClod(room, sess, target) {
  if (!target || target._dead || !room.entities.has(target.id)) return "miss";
  const pid = sess.playerId;
  if (target.id === "triple_maw") {
    const m = mawState(target);
    // the jaw coming for the thrower takes it (the open head whose cone covers them) —
    // else the throat gaping soonest to close
    let best = -1;
    let bestLeft = Infinity;
    let covers = false;
    for (let i = 0; i < 3; i++) {
      const h = m.heads[i];
      const t = h.teleId ? room.tele.get(h.teleId) : null;
      if (!t) continue;
      const c = pointInShape(t, sess.x, sess.y, 0.3);
      if ((c && !covers) || (c === covers && t.left < bestLeft)) {
        covers = c;
        bestLeft = t.left;
        best = i;
      }
    }
    if (best >= 0) {
      const h = m.heads[best];
      room.cancelTelegraph(h.teleId, "silenced");
      h.teleId = null;
      h.silence = SILENCE_S;
      silence(room, target, best);
      room.damageMob(target, CLOD.headDmg, pid, { spellId: "clod" });
      if (!sess._glutChokeTip) {
        sess._glutChokeTip = true;
        room.toast(sess.ws, "emit", "«la gittò dentro a le bramose canne» — the Maw chokes");
      }
      return "head";
    }
    room.damageMob(target, CLOD.splatDmg, pid, { spellId: "clod" });
    if ((sess._glutSplatTips || 0) < 2) {
      sess._glutSplatTips = (sess._glutSplatTips || 0) + 1;
      room.toast(sess.ws, "info", "Too soon — throw while a maw gapes");
    }
    return "splat";
  }
  if (target.cerbero) {
    const tele = target.teleId ? room.tele.get(target.teleId) : null;
    if (tele && tele.kind === "cerbero_bite") {
      interruptAttack(room, target, 0.8, "silenced");
      target.cerbero.silence = SILENCE_S;
      silence(room, target, 0);
      room.damageMob(target, CLOD.headDmg, pid, { spellId: "clod" });
      if (!sess._glutCerbTip) {
        sess._glutCerbTip = true;
        room.toast(sess.ws, "emit", "Cerbero chokes on the mire — strike now");
      }
      return "head";
    }
    room.damageMob(target, CLOD.splatDmg, pid, { spellId: "clod" });
    if ((sess._glutSplatTips || 0) < 2) {
      sess._glutSplatTips = (sess._glutSplatTips || 0) + 1;
      room.toast(sess.ws, "info", "Too soon — throw while its jaws gape");
    }
    return "splat";
  }
  // a fistful of mud in any other face: a blow that breaks a lunge
  room.damageMob(target, CLOD.mobDmg, pid, { spellId: "clod", heavy: true, from: { x: sess.x, y: sess.y } });
  return "splat";
}

// ——— hooks ——————————————————————————————————————————————————————————————————

export default {
  init(room) {
    const g = {
      mire: makeMire(room.canto.geo),
      buried: [],
      mounds: [],
      bmask: 0,
      bv: ((room._glut && room._glut.bv) || 0) + 1,
      feedSeq: (room._glut && room._glut.feedSeq) || 0,
      cerb: null,
    };
    room._glut = g;
    for (const pack of room.canto.packs || []) {
      if (!pack.buried) continue;
      const members = [];
      for (const e of room.entities.values()) if (e.packId === pack.id && e.kind === "mob") members.push(e);
      members.forEach((e, i) => {
        const spot = Array.isArray(pack.spots) && pack.spots[i] ? pack.spots[i] : [e.x, e.y];
        room.entities.delete(e.id);
        e.x = Number(spot[0]);
        e.y = Number(spot[1]);
        e.homeX = e.x;
        e.homeY = e.y;
        const k = g.buried.length;
        if (k > 30) return;
        g.buried.push({ e, x: e.x, y: e.y, k, up: false });
        g.mounds.push(r1(e.x), r1(e.y));
        g.bmask |= 1 << k;
      });
    }
    const maw = room.entities.get("triple_maw");
    if (maw) mawState(maw);
    for (const e of room.entities.values()) {
      if (e.packId !== "glut_cerbero") continue;
      e.maxHp = Math.round(e.maxHp * CERB.hpMul);
      e.hp = e.maxHp;
      e.cerbero = { silence: 0 };
      g.cerb = e;
    }
  },

  tick(room, dt) {
    const g = room._glut;
    if (!g) return;
    let maw = null;
    for (const e of room.entities.values()) {
      if (e.kind === "boss") {
        if (e.id === "triple_maw") {
          maw = e;
          if (e._maw) for (const h of e._maw.heads) if (h.silence > 0) h.silence = Math.max(0, h.silence - dt);
        }
        continue;
      }
      if (e.kind !== "mob") continue;
      if (e.cerbero && e.cerbero.silence > 0) e.cerbero.silence = Math.max(0, e.cerbero.silence - dt);
      // the mud drags armour: last tick's stride shrinks to the mire's measure
      if (g.mire && MIRE_DRAGGED.has(e.archetype)) {
        if (e._gx != null) {
          const dx = e.x - e._gx;
          const dy = e.y - e._gy;
          if ((dx || dy) && Math.abs(dx) + Math.abs(dy) < 3) {
            const k = g.mire.mulAt(e.x, e.y);
            if (k < 1) {
              e.x = e._gx + dx * k;
              e.y = e._gy + dy * k;
              room.markDirty();
            }
          }
        }
        e._gx = e.x;
        e._gy = e.y;
      }
    }
    // Sepolti wake under a passing pilgrim — and those buried near it wake with it
    for (const b of g.buried) {
      if (b.up) continue;
      for (const s of room.sessions.values()) {
        if (!(s.hp > 0) || Math.hypot(s.x - b.x, s.y - b.y) > RISE_R) continue;
        rise(room, g, b, s);
        let beat = 0;
        for (const o of g.buried) {
          if (o.up || o.chained || Math.hypot(o.x - b.x, o.y - b.y) > CHAIN_R) continue;
          o.chained = true;
          beat += CHAIN_BEAT;
          room.schedule(beat, () => {
            if (!o.up && room._glut === g) rise(room, g, o, s);
          });
        }
        break;
      }
    }
    const nowMs = Date.now();
    for (const s of room.sessions.values()) {
      tickHail(room, s, dt, maw);
      tickSink(room, g, s, nowMs);
    }
  },

  snapshotExtra(room, sess) {
    const g = room._glut;
    if (!g || !sess) return undefined;
    const out = { bv: g.bv, bb: g.bmask, c: sess._glutClod ? 1 : 0 };
    // static per world: the mound spots and the causeway, once per arrival
    if (sess._glutBv !== g.bv) {
      sess._glutBv = g.bv;
      out.bm = g.mounds;
      if (g.mire) out.cw = g.mire.wire();
    }
    const maw = room.entities.get("triple_maw");
    const hs = maw && maw._maw ? maw._maw.heads : null;
    if (hs && (hs[0].silence > 0 || hs[1].silence > 0 || hs[2].silence > 0)) {
      out.hs = [r1(hs[0].silence), r1(hs[1].silence), r1(hs[2].silence)];
    }
    if (g.cerb && g.cerb.cerbero.silence > 0 && room.entities.has(g.cerb.id)) out.cs = r1(g.cerb.cerbero.silence);
    return out;
  },

  adjustMove(room, sess, from, to, dt) {
    const g = room._glut;
    if (!g || !g.mire) return to;
    // lenient at the edge: firm at either end of the step walks at full speed
    const m = Math.max(g.mire.mulAt(from.x, from.y), g.mire.mulAt(to.x, to.y));
    if (m >= 0.999) {
      sess._glutBucket = BUCKET_CAP;
      return to;
    }
    const refill = WALK * m * dt * BUCKET_SLACK;
    const b = Math.min(BUCKET_CAP + refill, (sess._glutBucket ?? BUCKET_CAP) + refill);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const d = Math.hypot(dx, dy);
    const allow = b + (sess.shoveAllow || 0);
    sess._glutBucket = Math.max(0, b - Math.min(d, allow));
    if (d <= allow || d < 1e-6) return to;
    const k = allow / d;
    return { x: from.x + dx * k, y: from.y + dy * k };
  },

  dashScale(room, sess) {
    const g = room._glut;
    return g && g.mire ? g.mire.dashAt(sess.x, sess.y) : 1;
  },

  onDamage(room, target, amount, _source) {
    if (target.playerId) return amount;
    if (target.id === "triple_maw" && target._maw) {
      const h = target._maw.heads;
      if (h[0].silence > 0 || h[1].silence > 0 || h[2].silence > 0) return amount * SILENCE_MUL;
    }
    if (target.cerbero && target.cerbero.silence > 0) return amount * SILENCE_MUL;
    return amount;
  },

  onKilled(room, e) {
    const g = room._glut;
    if (!g) return;
    // The core's pack / road lines count the foes in the world — the buried aren't in it
    if (e.kind === "mob" && !e._feeder && g.buried.length) {
      let buried = 0;
      let packBuried = false;
      for (const b of g.buried) {
        if (b.up) continue;
        buried++;
        if (e.packId && b.e.packId === e.packId) packBuried = true;
      }
      // its fellows still lie in the mud: the pack hasn't settled (the line comes with
      // the last of them; this corpse leaves the world right after this hook)
      if (packBuried) e.packId = null;
      if (buried > 0) {
        // the road line is the mire's while mounds still bubble (the core skips it)
        e.summoned = true;
        let mobs = 0;
        let bossUp = false;
        for (const o of room.entities.values()) {
          if (o !== e && o.kind === "mob" && o.hp > 0 && !o.summoned) mobs++;
          if (o.kind === "boss" && o.hp > 0) bossUp = true;
        }
        if (mobs === 0 && bossUp && !g.roadToast) {
          g.roadToast = true;
          // (the whole room's news, like the gate lines)
          for (const p of room.sessions.values()) {
            room.toast(p.ws, "emit", "The road is clear — only the mounds still bubble. Triple Maw waits.");
          }
        }
      }
    }
    if (e._feeder) {
      const fb = FANGO_BURST;
      room.telegraph({
        attackerId: "mech:fango",
        shape: "circle",
        x: e.x,
        y: e.y,
        radius: fb.radius,
        duration: fb.windupMs,
        kind: "fango_burst",
        dmg: Math.round(fb.dmg * 1.15),
        onHit: (r, t, s) => {
          r.statusPlayer(s, { slow: fb.slow, durMs: fb.slowMs });
          return t.dmg;
        },
      });
      return;
    }
    if (e.id === "triple_maw") {
      if (e._maw) endSeq(room, e._maw);
      stillTheMire(room, g);
    }
  },

  bossTick(room, e, dt) {
    if (e.id !== "triple_maw") return false;
    const g = room._glut;
    const m = mawState(e);
    const near = nearestPilgrim(room, e.x, e.y);
    if (!near) return false;
    const homeD = Math.hypot(e.x - e.homeX, e.y - e.homeY);
    if (room.tickBossLeash(e, near.d, homeD, dt)) {
      if (m.seq) endSeq(room, m);
      return true;
    }
    if (e.phase !== 2 && e.hp <= e.maxHp * 0.5) enterPhase2(room, e, m);
    if (e.phase === 2 && g) tickFeeders(room, g, e, m, dt);
    if (m.seq) {
      stepSeq(room, e, m, dt);
      brake(e, dt);
      return true;
    }
    if (e.teleId || e.staggerLeft > 0) {
      brake(e, dt);
      return true;
    }
    if (near.d < 14) {
      chase(room, e, near.s, dt);
      if (e.atkCd <= 0 && !(near.s.iframes > 0)) {
        if (near.d < MAW_SLAM.trigger && m.bites >= 2) {
          if (startAttack(room, e, near.s, near.d, Math.round(room.mobAttackDamage(e) * MAW_SLAM.dmgMul), MAW_SLAM)) m.bites = 0;
        } else if (near.d < (e.phase === 2 ? BITE_P2.radius : BITE.radius) - 0.4) {
          startSeq(room, e, m, near.s);
        }
        room.markDirty();
      }
    } else {
      brake(e, dt);
    }
    return true;
  },

  mobTick(room, e, dt) {
    if (e._feeder) {
      const maw = room.entities.get(e._feeder);
      if (!maw || !(maw.hp > 0)) {
        room.entities.delete(e.id);
        room.broadcast({ type: "entity_removed", id: e.id });
        room.markDirty();
        return true;
      }
      if (Math.hypot(maw.x - e.x, maw.y - e.y) <= 2.45) {
        feed(room, maw, e);
        return true;
      }
      walkTo(room, e, maw.x, maw.y, FEED.speed, dt);
      return true;
    }
    if (e.cerbero) {
      // one waking head: its bite replaces the champion slam; choked, it only follows
      if (e.cerbero.silence > 0) {
        e.atkCd = Math.max(e.atkCd || 0, 0.2);
        return false;
      }
      if (!e.teleId && !(e.staggerLeft > 0) && e.atkCd <= 0) {
        const near = nearestPilgrim(room, e.x, e.y);
        const homeD = Math.hypot(e.x - (e.homeX ?? e.x), e.y - (e.homeY ?? e.y));
        if (near && near.d <= CERB.trigger && !(near.s.iframes > 0) && homeD <= 11) startCerbBite(room, e, near.s);
      }
      return false;
    }
    return false;
  },

  onInteract(room, sess, e) {
    if (e.kind !== "poi" || e.poiKind !== "clod") return false;
    if (sess._glutClod) {
      room.toast(sess.ws, "info", "Your fist is already full of mire.");
      return true;
    }
    const now = Date.now();
    if ((sess._glutGrabAt || 0) + CLOD.grabCdMs > now) return true;
    sess._glutGrabAt = now;
    sess._glutClod = true;
    room.broadcast({ type: "glut_grab", pid: sess.playerId, id: e.id });
    // the mire's hands close where the thief stood: a second to wade clear
    const sn = CLOD.snatch;
    room.telegraph({
      attackerId: "mech:heap",
      shape: "circle",
      x: sess.x,
      y: sess.y,
      radius: sn.radius,
      duration: sn.windupMs,
      kind: "mire_grab",
      dmg: Math.round(sn.dmg * 1.15),
      onHit: (r, t, s) => {
        // (by the jaws a hold would feed you to the next bite: the mud only drags)
        if (biterNear(r, s.x, s.y, sn.biterR)) r.statusPlayer(s, { slow: sn.slow, durMs: sn.slowMs });
        else holdFast(r, s, sn.rootMs);
        return t.dmg;
      },
    });
    if (!sess._glutClodTip) {
      sess._glutClodTip = true;
      room.toast(sess.ws, "info", "«con piene le pugna» — throw it into a gaping maw");
    }
    room.markDirty();
    return true;
  },

  onAttack(room, sess, target, combo) {
    // (a blade swing is a blade swing: only the throw packet spends the fistful)
    if (!sess._glutClod || Number(combo) !== THROW_COMBO) return false;
    const d = Math.hypot(target.x - sess.x, target.y - sess.y);
    // out of a throw's reach: an ordinary swing (or "Too far"), the clod stays in hand
    if (d > CLOD.range) return false;
    sess._glutClod = false;
    // the heave: feet planted a beat (a longer hold already on them stands)
    const now = Date.now();
    const st = sess.status;
    if (!(st && st.root && st.until > now + CLOD.heaveMs)) room.statusPlayer(sess, { root: true, durMs: CLOD.heaveMs });
    const dur = clamp(d / CLOD.speed, 0.18, 0.5);
    const from = { x: sess.x, y: sess.y };
    room.broadcast({
      type: "glut_clod",
      pid: sess.playerId,
      x: +from.x.toFixed(2),
      y: +from.y.toFixed(2),
      tid: target.id,
      tx: +target.x.toFixed(2),
      ty: +target.y.toFixed(2),
      dur: Math.round(dur * 1000),
    });
    room.schedule(dur, () => landClod(room, sess, target));
    room.markDirty();
    return true;
  },
};

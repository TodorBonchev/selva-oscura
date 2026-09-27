/**
 * Avarice (inferno_07) canto mechanic — the processions of the weights and Plutus.
 * Hook contract: ./index.mjs. Geometry (pure, shared with the bot and mirrored on the
 * client): ./avariceProcession.mjs.
 *
 * 1) Processions. Two arcs of huge indestructible weights (hoarders north, wasters
 *    south) roll in unison on a fixed clock and clash where the road crosses the ring
 *    (W at t≡0, E at t≡T/2): a telegraphed shockwave (kind "ava_clash", 1.2 s ahead)
 *    hurts and throws everyone standing there; at the west clash (the road's gate) the
 *    coin spills a beat later over a wider ring ("ava_spill", warned together with the
 *    clash, so its whole area fills from the same moment); then the weights recoil and
 *    roll back. A weight that rolls over a pilgrim or a foe crushes it (contact
 *    "ava_roll", one procession blow per target per HIT_CD) and throws it out of the
 *    lane — luring a pack into a lane is a real tactic (the blow is the procession's:
 *    combat attackerId "mech:procession", the nearest pilgrim keeps the kill credit).
 *    A pilgrim's blow scales with the drum's speed (a creeping drum only nudges you off
 *    its lane) and a second roll-over within ROLL_REPEAT_S lands lighter. Plutus is no
 *    foe to crush: a drum that rolls into him breaks his windup, chips him and shoves
 *    him off the rails (railPlutus), so his fight is not fought standing on a lane.
 *    Contact is lag-fair: a pilgrim is judged against the weights where they stood
 *    when their last move was made (half their round trip earlier, capped).
 *    Positions are a pure function of the procession clock; the snapshot carries
 *    { t, T } (the phase now).
 * 2) Plutus ("Pape Satàn, pape Satàn aleppe!") — boss id hoard_crush. While a pilgrim
 *    fights him he calls coins: Fiorini rise from his hoard (two piles in the tip of the
 *    ring, beside the bell, west of the east clash — and spill from each east clash) and
 *    stream to him through the clash — biting (a wisp dart) whoever stands in
 *    their way; each one he swallows swells him (damage taken −6% a stack, up to 4; a wider
 *    slam, a bigger body) and, swollen, the hoard pulses around him ("plutus_pulse",
 *    radius and frequency grow with the coin); from BELL_BREAK_MIN coins (ripe for the
 *    bell) its ring burns whoever stands in it (a tick a second, combat { dot: true }). Ringing the Ledger Bell while he is
 *    swollen and near it breaks him like a sail when the mast snaps: a 4 s collapse,
 *    ×2 damage taken, the coin gone («Taci, maledetto lupo!») — and he falls toward
 *    the bell ("plutus_fall" cone): step aside after ringing. At ≤50% he hurls a great
 *    weight down a lane ("plutus_roll" line telegraph; the client rolls it). His dais
 *    holds the east clash: the weights' last run climbs onto it, so his fight keeps
 *    the procession's rhythm (weights through the lanes, the clash every T). He heals as
 *    every boss does (../bossMend.mjs): only when left alone, and slowly.
 * 3) The Counterweight (mid-elite, on the wasters' side where the road crosses their
 *    lane) charges down a lane ("cw_charge" line telegraph, then it rolls through)
 *    between its slams — the rollers' lesson. Its charge crushes foes in the lane too;
 *    poise breaks it; lured into the procession's lane, the weights crush it.
 * 4) Avarice fodder packs refill (48 s+, away from pilgrims); hearts / Counterweight /
 *    Warden / champion pair stay down until the room empties.
 * 5) The Ledger Bell (onBell) stills weights near the ringer and breaks a swollen Plutus.
 *    It hangs in the tip of the ring, between the two processions' last runs and west of
 *    the east clash: reaching it from his dais means timing the clash and the lanes —
 *    the bell's reward (his collapse) is bought with the processions' risk.
 *
 * Wire (server → client): telegraph kinds ava_clash / ava_spill / plutus_pulse /
 * plutus_roll / plutus_fall / cw_charge (extra { side? }; colours: the client registers
 * them); { type: "ava_sweep", id, x, y, dir, length, duration } the hurled weight's lane
 * ({ type: "ava_sweep_cancel", id } when the throw is cut short); { type: "ava_absorb",
 * id, x, y, inf } a coin swallowed and { type: "ava_sink", id } a coin sunk (the client
 * drops the Fiorino quietly — no kill beat; entity_removed follows); { type:
 * "ava_collapse", id, dur, fall } the bell broke him; { type: "ava_call", id, first } he
 * calls the coins. snapshotExtra → { t, T, inf?, col? }.
 */
import {
  PROC,
  GEO,
  arcPoint,
  weightsAt,
  untilClash,
  rollingAt,
} from "./avariceProcession.mjs";
import { brake, chase, unstick, walkTo, startAttack, bodyRadius, interruptAttack } from "../mobAi.mjs";
import { dodgeGrace } from "../telegraph.mjs";

export const PLUTUS_ID = "hoard_crush";

/** Procession damage to pilgrims (× canto tier) and to foes (flat). */
const ROLL_DMG = 40;
const CLASH_DMG = 20;
const MOB_ROLL_DMG = 70;
const MOB_CLASH_DMG = 90;
/** A weight only crushes while it rolls with some speed (not in its rest / recoil). */
const ROLL_MIN_SPEED = 2.2;
/**
 * The blow scales with the drum's speed: a creeping weight (under ROLL_SOFT_SPEED, just
 * after a recoil) only nudges you out of the lane; full weight from ROLL_FULL_SPEED.
 */
const ROLL_SOFT_SPEED = 4.0;
const ROLL_FULL_SPEED = 7.2;
const ROLL_MIN_SHARE = 0.4;
/** A second roll-over within this many seconds lands at ROLL_REPEAT_MUL (no pile-ons). */
const ROLL_REPEAT_S = 12;
const ROLL_REPEAT_MUL = 0.4;
/**
 * Plutus is no weight: a drum that rolls into him staggers him (his windup broken), chips
 * him and shoves him off the rails — his fight is not fought standing on a lane.
 */
const PLUTUS_RAIL_STAGGER = 1.2;
const PLUTUS_RAIL_DMG = 45;
const PLUTUS_RAIL_CD = 2.5;
/** Weight footprint seen from above: half length along its roll, half thickness. */
const ROLL_HALF_L = PROC.R;
const ROLL_HALF_W = 0.72;
/** A pilgrim's body pad for the footprint test. */
const PLAYER_PAD = 0.35;
/** One procession blow per target per this many seconds (roll or clash). */
const HIT_CD = 1.2;
/**
 * The west clash spills coin: an outer ring that lands SPILL_LAG after the weights meet.
 * It is warned with the clash (one fill from the same moment, the clash circle inside
 * it), so stepping clear of the whole ring in time is always possible. (Not at the east
 * clash: that is Plutus's arena, and his melee ring would sit in it.)
 */
const SPILL_OUT = 2.6;
const SPILL_LAG = 0.45;
const SPILL_DMG = 13;
/** Rolling-weight contact: judge a laggy pilgrim this far back (≤ s), see lagOf. */
const LAG_CAP = 0.16;

/** Plutus. */
const INFLATE_MAX = 4;
const INFLATE_DR = 0.06;
const BELL_BREAK_MIN = 2;
const BELL_REACH = 15;
const COLLAPSE_SEC = 4;
const COLLAPSE_MULT = 2;
/** He falls where the bell struck him from: a cone toward the bell. */
const FALL_R = 5.5;
const FALL_ARC = 1.45;
const FALL_MS = 650;
const FALL_DMG = 18;
const CALL_EVERY = 6.5;
/** His first call comes this soon after a pilgrim engages him. */
const FIRST_CALL = 0.6;
const ENGAGE_R = 16;
const FEEDER_SPEED = 4.4;
const FEEDER_HP = 38;
/** A Fiorino darts at a pilgrim this close to its flight. */
const FEEDER_BITE = 3.4;
/** Within this of Plutus a Fiorino rushes in (no bite), and he swallows it at FEEDER_SWALLOW. */
const FEEDER_RUSH = 5;
const FEEDER_SWALLOW = 2.6;
/**
 * His hoard: two coin piles in the tip of the ring, flanking the Ledger Bell between the
 * processions' last runs. The Fiorini rise there and stream to him through the east
 * clash — cut them down between the weights, or let the clash grind them.
 */
const PILES = [
  { x: 120.5, y: 48.2 },
  { x: 120.5, y: 53.2 },
];
/** Swollen with coin, the hoard pulses around him (radius grows with every coin). */
const PULSE_WIND = 0.6;
const PULSE_BASE_R = 2.3;
const PULSE_R_PER = 0.45;
const PULSE_DMG = 4;
const PULSE_DMG_PER = 0.5;
/**
 * Swollen, the ring of his hoard burns whoever stands in it (a tick a second): the
 * price of fighting him close while he holds coin — cut the Fiorini down, break him
 * with the bell, or strike from range.
 */
const AURA_DMG = 4.0;
const AURA_DMG_PER = 0.15;
const AURA_PAD = 0.4;
const PLUTUS_SLAM = 8;
const ROLL_EVERY = 7.5;
const ROLL_LEN = 22;
const ROLL_W = 3.0;
const ROLL_WIND = 1.3;
const ROLL_SWEEP_DMG = 12;
const MOB_SWEEP_DMG = 80;

/** Counterweight charge. */
const CW_PACK = "ava_counterweight";
const CW_CHARGE_EVERY = 5.5;
const CW_WIND = 0.9;
const CW_W = 2.6;
const CW_DMG = 15;

/** Fodder refill: these packs never come back while the room is occupied. */
const NO_RESPAWN = new Set(["ava_hoard_heart", CW_PACK, "ava_ledger_warden", "ava_champion_pair", "ava_plutus_coins"]);

let feederSeq = 0;
const _pt = { x: 0, y: 0, tx: 1, ty: 0 };

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function tierDmg(room, base) {
  return Math.round(base * room.tierDmg());
}

/** Mech state on the room (reset by init). */
function st(room) {
  return room._ava || init(room);
}

function init(room) {
  room._ava = {
    t0: Date.now(),
    /** Absolute clock (s) of the clash each side last warned for. */
    warned: [-1, -1],
    /** target id → clock (s) before which the procession cannot hit it again */
    cd: new Map(),
    /** pilgrim id → clock (s) of their last roll-over (a quick second one is lighter) */
    rolled: new Map(),
    /** weight records (weightsAt): now, and a laggy pilgrim's view */
    ws: [],
    wsLag: [],
    /** fodder refills { packId, at, x, y } */
    refills: [],
    refillStagger: 0,
  };
  return room._ava;
}

function clock(room) {
  return (Date.now() - st(room).t0) / 1000;
}

/** Nearest living pilgrim to (x,y) within r (credit for a lured crush). */
function nearestPlayer(room, x, y, r) {
  let best = null;
  let bd = r;
  for (const s of room.sessions.values()) {
    if (!(s.hp > 0)) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/**
 * How far back (s) to judge a pilgrim against the rolling weights: their position is
 * the last move packet, made while their screen showed the weights about half a round
 * trip + a move beat earlier (the client draws them on the server's clock). Bots report
 * no round trip: 0.
 */
function lagOf(s) {
  const g = dodgeGrace(s);
  return g > 0 ? Math.min(LAG_CAP, g / 2 + 0.015) : 0;
}

function isCrushable(e) {
  return e && e.kind === "mob" && !e._dead && e.hp > 0 && !String(e.archetype || "").endsWith("_heart");
}

/** Is (x,y) inside weight w's footprint, grown by pad? Returns the signed across offset or null. */
function footprint(w, x, y, pad) {
  const dx = x - w.x;
  const dy = y - w.y;
  const along = dx * w.tx + dy * w.ty;
  if (Math.abs(along) > ROLL_HALF_L + pad) return null;
  const across = -dx * w.ty + dy * w.tx;
  if (Math.abs(across) > ROLL_HALF_W + pad) return null;
  return across;
}

/**
 * Crush a foe with procession / lane damage. The nearest pilgrim keeps the credit (loot,
 * bounty — they lured it there), but the blow is the hazard's (`source`): their client
 * shows it as the world's, not their swing (no hit-stop, no combo), and the foe
 * flinches away from the weight.
 */
function crushMob(room, e, dmg, fromX, fromY, spellId, source) {
  const credit = nearestPlayer(room, e.x, e.y, 18);
  room.damageMob(e, dmg, credit ? credit.playerId : null, {
    spellId,
    heavy: true,
    from: { x: fromX, y: fromY },
    source,
  });
}

/** Foes along a line (lane attacks crush what they roll over). */
function crushLine(room, x, y, dir, len, width, dmg, spellId, source, skipId) {
  const ux = Math.cos(dir);
  const uy = Math.sin(dir);
  for (const e of [...room.entities.values()]) {
    if (!isCrushable(e) || e.id === skipId) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const along = dx * ux + dy * uy;
    if (along < -0.5 || along > len + 0.5) continue;
    const across = -dx * uy + dy * ux;
    if (Math.abs(across) > width / 2 + bodyRadius(e, room.cantoId) * 0.6) continue;
    crushMob(room, e, dmg, e.x - ux - uy * Math.sign(across || 1), e.y - uy + ux * Math.sign(across || 1), spellId, source);
  }
}

// ——— processions ————————————————————————————————————————————————————————

/** One procession blow per target per HIT_CD (a clash and a roll never stack). */
function procHit(A, id, now) {
  if ((A.cd.get(id) || 0) > now) return false;
  A.cd.set(id, now + HIT_CD);
  return true;
}

function warnClash(room, A, side, left) {
  const c = side === 0 ? PROC.W : PROC.E;
  const onHit = (r, tt, s) => (procHit(A, s.playerId, clock(r)) ? tt.dmg : 0);
  // The west clash spills coin a beat later over a wider ring — warned now, with the
  // clash: both fills start together, so the whole area reads from the first moment
  if (side === 0) {
    room.telegraph({
      attackerId: "mech:procession",
      shape: "ring",
      x: c.x,
      y: c.y,
      inner: PROC.CLASH_R - 0.3,
      radius: PROC.CLASH_R + SPILL_OUT,
      duration: (left + SPILL_LAG) * 1000,
      kind: "ava_spill",
      dmg: tierDmg(room, SPILL_DMG),
      extra: { side },
      onHit,
    });
  }
  room.telegraph({
    attackerId: "mech:procession",
    shape: "circle",
    x: c.x,
    y: c.y,
    radius: PROC.CLASH_R,
    duration: left * 1000,
    kind: "ava_clash",
    dmg: tierDmg(room, CLASH_DMG),
    extra: { side },
    onLand: (r) => {
      // the shockwave crushes foes standing in it (not the pillars, not Plutus)
      for (const e of [...r.entities.values()]) {
        if (!isCrushable(e)) continue;
        const d = Math.hypot(e.x - c.x, e.y - c.y);
        if (d > PROC.CLASH_R + bodyRadius(e, r.cantoId) * 0.5) continue;
        crushMob(r, e, MOB_CLASH_DMG, c.x, c.y, "ava_clash", "mech:procession");
      }
      // east clashes shake Fiorini loose from both processions' last weights: they
      // stream to Plutus from a dozen steps out (time to cut them down)
      if (side === 1) {
        const p = r.entities.get(PLUTUS_ID);
        if (p && p.engaged && !(p.collapseLeft > 0)) {
          for (let k = 0; k < 2; k++) {
            arcPoint(k, GEO.L - 9, _pt);
            spawnFeeder(r, _pt.x, _pt.y);
          }
        }
      }
    },
    onHit,
    onResolve: (r, tt, hits) => {
      for (const s of hits) {
        if (!(s.hp > 0) || s.iframes > 0) continue;
        let dx = s.x - c.x;
        let dy = s.y - c.y;
        const l = Math.hypot(dx, dy);
        if (l < 0.2) {
          dx = -1;
          dy = 0;
        } else {
          dx /= l;
          dy /= l;
        }
        const push = Math.max(1.2, PROC.CLASH_R + 0.8 - l);
        r.shovePlayer(s, dx * push, dy * push, 260);
      }
    },
  });
}

/** A rolling weight ran over a pilgrim: the blow (by the drum's speed), then thrown out of the lane. */
function rollOver(room, A, s, w, across, now) {
  if (!procHit(A, s.playerId, now)) return;
  const side = across >= 0 ? 1 : -1;
  const fwd = Math.sign(w.vx * w.tx + w.vy * w.ty) || 1;
  if (w.speed < ROLL_SOFT_SPEED) {
    // a creeping drum only nudges you off its lane
    const out = ROLL_HALF_W + PLAYER_PAD + 0.6 - Math.abs(across);
    if (out > 0.05) room.shovePlayer(s, -w.ty * side * out, w.tx * side * out, 220);
    return;
  }
  const share = clamp((w.speed - ROLL_MIN_SPEED) / (ROLL_FULL_SPEED - ROLL_MIN_SPEED), ROLL_MIN_SHARE, 1);
  const last = A.rolled.get(s.playerId);
  const repeat = last != null && now - last < ROLL_REPEAT_S ? ROLL_REPEAT_MUL : 1;
  A.rolled.set(s.playerId, now);
  const taken = room.hitPlayer(s, { id: "mech:procession", kind: "mech" }, tierDmg(room, ROLL_DMG * share * repeat), {
    teleKind: "ava_roll",
  });
  if (!(taken > 0) || !(s.hp > 0) || s.iframes > 0) return;
  // thrown out of the lane, a little along the roll
  const out = ROLL_HALF_W + PLAYER_PAD + 1.5 - Math.abs(across);
  const dx = -w.ty * side * out + w.tx * fwd * 0.7;
  const dy = w.tx * side * out + w.ty * fwd * 0.7;
  room.shovePlayer(s, dx, dy, 240);
}

/** A drum rolled into Plutus: his windup broken, a chip of his life, shoved off the rails. */
function railPlutus(room, A, p, w, across, now) {
  if ((p._railAt || -1e9) > now - PLUTUS_RAIL_CD) return;
  p._railAt = now;
  if (p.teleId || p.windupLeft > 0) interruptAttack(room, p, PLUTUS_RAIL_STAGGER, "weight");
  else p.staggerLeft = Math.max(p.staggerLeft || 0, PLUTUS_RAIL_STAGGER * 0.6);
  const side = across >= 0 ? 1 : -1;
  const out = ROLL_HALF_W + bodyRadius(p, room.cantoId) * 0.6 + 1.2 - Math.abs(across);
  if (out > 0) room.shoveMob(p, -w.ty * side * out, w.tx * side * out);
  crushMob(room, p, PLUTUS_RAIL_DMG, p.x + w.ty * side * 2, p.y - w.tx * side * 2, "ava_roll", "mech:procession");
}

function tickProcession(room, dt) {
  const A = st(room);
  const t = clock(room);
  // Clash warnings: a telegraph fills over the last WARN seconds before each clash
  for (let side = 0; side < 2; side++) {
    const left = untilClash(t, side);
    if (left > PROC.WARN || left < 0.05) continue;
    const at = Math.round((t + left) * 1000);
    if (A.warned[side] === at) continue;
    A.warned[side] = at;
    warnClash(room, A, side, left);
  }
  const now = t;
  // Contact, pilgrims: each judged against the weights as their screen showed them when
  // they last moved (lagOf) — a near miss on screen is a miss here
  for (const s of room.sessions.values()) {
    if (!(s.hp > 0) || s.iframes > 0) continue;
    const tl = t - lagOf(s);
    if (!rollingAt(tl)) continue;
    const ws = weightsAt(tl, A.wsLag);
    for (const w of ws) {
      if (w.speed < ROLL_MIN_SPEED) continue;
      const across = footprint(w, s.x, s.y, PLAYER_PAD);
      if (across == null) continue;
      rollOver(room, A, s, w, across, now);
      break;
    }
  }
  // Contact, foes (the server's own clock): a rolling weight crushes what it rolls over
  if (rollingAt(t)) {
    const ws = weightsAt(t, A.ws);
    const p = room.entities.get(PLUTUS_ID);
    if (p && p.hp > 0 && !p._dead && !(p.collapseLeft > 0)) {
      const pad = bodyRadius(p, room.cantoId) * 0.5;
      for (const w of ws) {
        if (w.speed < ROLL_SOFT_SPEED) continue;
        const across = footprint(w, p.x, p.y, pad);
        if (across == null) continue;
        railPlutus(room, A, p, w, across, now);
        break;
      }
    }
    for (const e of room.entities.values()) {
      if (!isCrushable(e)) continue;
      const pad = bodyRadius(e, room.cantoId) * 0.8;
      for (const w of ws) {
        if (w.speed < ROLL_MIN_SPEED) continue;
        const across = footprint(w, e.x, e.y, pad);
        if (across == null) continue;
        if (!procHit(A, e.id, now)) break;
        const side = across >= 0 ? 1 : -1;
        crushMob(room, e, MOB_ROLL_DMG, e.x + w.ty * side * 2, e.y - w.tx * side * 2, "ava_roll", "mech:procession");
        break;
      }
    }
  }
  // forget stale cooldowns now and then (ids of the dead / departed)
  if (A.cd.size > 80) {
    for (const [k, v] of A.cd) if (v < now) A.cd.delete(k);
  }
  if (A.rolled.size > 40) {
    for (const [k, v] of A.rolled) if (v < now - ROLL_REPEAT_S) A.rolled.delete(k);
  }
  void dt;
}

// ——— Plutus ————————————————————————————————————————————————————————————

function spawnFeeder(room, x, y) {
  let n = 0;
  for (const e of room.entities.values()) if (e.feed) n++;
  if (n >= 6) return null;
  feederSeq += 1;
  const id = `mob_fiorino_${feederSeq}`;
  const e = {
    id,
    kind: "mob",
    name: "Fiorino",
    x,
    y,
    hp: FEEDER_HP,
    maxHp: FEEDER_HP,
    packId: "ava_plutus_coins",
    champion: false,
    elite: false,
    // (a called coin, not a pack: a pinch of base metal at most — no farm beside him)
    dropTable: "avarice_fiorino",
    archetype: "coin_wisp",
    atkCd: 0.6,
    feed: true,
    // (a mechanic's add: no "pack cleared" / "road is clear" lines — room.onEntityKilled)
    summoned: true,
    homeX: x,
    homeY: y,
  };
  room.entities.set(id, e);
  room.markDirty();
  return e;
}

/** A Fiorino leaves the world without dying (swallowed / sunk): the client drops it quietly. */
function removeFeeder(room, e, msg) {
  // (a dart still winding up leaves with it)
  room.tele.cancelBy(e.id, "gone");
  e.teleId = null;
  room.entities.delete(e.id);
  room.broadcast(msg);
  room.broadcast({ type: "entity_removed", id: e.id });
  room.markDirty();
}

/**
 * A feeder drifts to Plutus and is swallowed (returns true: default AI skipped). Greed
 * bites the hand that reaches for it: a pilgrim in its way gets a coin dart (the wisp
 * dart telegraph) before it flies on.
 */
function tickFeeder(room, e, dt) {
  const p = room.entities.get(PLUTUS_ID);
  if (!p || !(p.hp > 0)) {
    // nothing to feed: the coin sinks back into the ground
    removeFeeder(room, e, { type: "ava_sink", id: e.id });
    return true;
  }
  if (e.teleId || e.staggerLeft > 0) {
    brake(e, dt);
    return true;
  }
  // the last stretch to his maw it no longer stops to bite: at his side, the coin is his
  const toP = Math.hypot(p.x - e.x, p.y - e.y);
  if (e.atkCd <= 0 && toP > FEEDER_RUSH) {
    let near = null;
    let nd = FEEDER_BITE;
    for (const s of room.sessions.values()) {
      if (!(s.hp > 0) || s.iframes > 0) continue;
      const d = Math.hypot(s.x - e.x, s.y - e.y);
      if (d < nd) {
        nd = d;
        near = s;
      }
    }
    if (near && startAttack(room, e, near, nd, room.mobAttackDamage(e))) {
      e.atkCd = Math.max(e.atkCd, 0.28 + 1.6);
      room.markDirty();
      return true;
    }
  }
  // In the ring's tip it runs down the middle and out through the east clash (between
  // the two processions' last runs — never along a lane), then on to him
  const viaE = p.x > PROC.E.x && e.x < PROC.E.x - 1.5;
  walkTo(room, e, viaE ? PROC.E.x : p.x, viaE ? PROC.E.y : p.y, FEEDER_SPEED, dt);
  if (Math.hypot(p.x - e.x, p.y - e.y) < FEEDER_SWALLOW) {
    if (!(p.collapseLeft > 0)) p.inflate = Math.min(INFLATE_MAX, (p.inflate || 0) + 1);
    removeFeeder(room, e, { type: "ava_absorb", id: e.id, x: +e.x.toFixed(2), y: +e.y.toFixed(2), inf: p.inflate || 0 });
  }
  return true;
}

function plutusSlam(room, p, target, targetD) {
  const inf = p.inflate || 0;
  const p2 = p.phase === 2;
  const radius = (p2 ? 3.9 : 3.2) * (1 + 0.06 * inf);
  const windup = p2 ? 1.0 : 1.4;
  // (his threat is the pattern — coin, pulses, the hurled weight — not a heavier fist)
  const dmg = tierDmg(room, p2 ? PLUTUS_SLAM * 1.15 : PLUTUS_SLAM);
  return startAttack(room, p, target, targetD, dmg, { radius, windup, trigger: 2.6 + inf * 0.15 });
}

function plutusRoll(room, p, target) {
  const dir = Math.atan2(target.y - p.y, target.x - p.x);
  const x = p.x - Math.cos(dir) * 1.5;
  const y = p.y - Math.sin(dir) * 1.5;
  const t = room.telegraph({
    attackerId: p.id,
    shape: "line",
    x,
    y,
    dir,
    length: ROLL_LEN,
    width: ROLL_W,
    duration: ROLL_WIND * 1000,
    kind: "plutus_roll",
    dmg: tierDmg(room, ROLL_SWEEP_DMG),
    onLand: (r, tt) => {
      if (p.teleId === tt.id) {
        p.teleId = null;
        p.windupLeft = 0;
      }
      if (p.sweepId === tt.id) p.sweepId = null;
      p.atkCd = Math.max(p.atkCd || 0, 0.9);
      crushLine(r, tt.x, tt.y, tt.dir, tt.length, tt.width, MOB_SWEEP_DMG, "plutus_roll", "mech:procession");
    },
    onResolve: (r, tt, hits) => {
      for (const s of hits) {
        if (!(s.hp > 0) || s.iframes > 0) continue;
        const dx = s.x - tt.x;
        const dy = s.y - tt.y;
        const across = -dx * Math.sin(tt.dir) + dy * Math.cos(tt.dir);
        const side = across >= 0 ? 1 : -1;
        r.shovePlayer(s, Math.cos(tt.dir) * 1.6 - Math.sin(tt.dir) * side * 1.4, Math.sin(tt.dir) * 1.6 + Math.cos(tt.dir) * side * 1.4, 260);
      }
    },
  });
  // (the client rolls the weight down the lane on the fill's clock)
  room.broadcast({ type: "ava_sweep", id: t.id, x: +x.toFixed(2), y: +y.toFixed(2), dir: +dir.toFixed(3), length: ROLL_LEN, duration: ROLL_WIND * 1000 });
  // (cut short — bell, leash, death — the client sinks the drum: tickPlutus / onKilled)
  p.sweepId = t.id;
  p.teleId = t.id;
  p.windupLeft = ROLL_WIND;
  p.windupMax = ROLL_WIND;
  p.hd = dir;
  p.atkCd = ROLL_WIND + 0.05;
  p.rollCd = ROLL_EVERY;
  return t;
}

/** Swollen with coin: the hoard pulses around him (a telegraphed ring of burning gold). */
function plutusPulse(room, p) {
  const inf = p.inflate || 0;
  // (not his arm — the hoard itself: no attack pose, and it dies with him)
  const t = room.telegraph({
    attackerId: "mech:hoard",
    shape: "circle",
    x: p.x,
    y: p.y,
    radius: PULSE_BASE_R + PULSE_R_PER * inf,
    duration: PULSE_WIND * 1000,
    kind: "plutus_pulse",
    dmg: tierDmg(room, PULSE_DMG + PULSE_DMG_PER * inf),
    onHit: (r, tt) => (p.hp > 0 && !p._dead && !(p.collapseLeft > 0) ? tt.dmg : 0),
  });
  p.pulseCd = Math.max(2.6, 4.4 - 0.4 * inf);
  return t;
}

function resetPlutus(p) {
  p.pulseCd = 3;
  p.inflate = 0;
  p.collapseLeft = 0;
  p.engaged = false;
  p.callCd = 1.2;
  p.rollCd = 3;
  p.called = false;
}

/**
 * Plutus's leash and mend are every boss's (room.tickBossLeash, ../bossMend.mjs): dragged
 * off his dais he walks home keeping his wounds; left alone ~20 s he counts his coin and
 * knits slowly. Walking home he lets his coin go and forgets whoever engaged him. Knit
 * back past half he stops hurling weights (phase 2 re-arms); knit whole his fight resets.
 */
function plutusLeash(room, p, nearestD, homeD, dt) {
  const walking = room.tickBossLeash(p, nearestD, homeD, dt);
  if (p.phase === 2 && p.hp > p.maxHp * 0.5) {
    p.phase = undefined;
    p.phase2Toast = false;
  }
  if (walking) p.windupLeft = 0;
  return walking;
}

/** His hurled weight's throw was cut short (bell, leash, death): sink the client's drum. */
function sweepCancelled(room, p) {
  if (!p.sweepId || room.tele.get(p.sweepId)) return;
  room.broadcast({ type: "ava_sweep_cancel", id: p.sweepId });
  p.sweepId = null;
}

function tickPlutus(room, p, dt) {
  if (p.inflate == null) resetPlutus(p);
  sweepCancelled(room, p);
  let nearest = null;
  let nearestD = 999;
  for (const s of room.sessions.values()) {
    if (!(s.hp > 0)) continue;
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d < nearestD) {
      nearestD = d;
      nearest = s;
    }
  }
  if (p.homeX == null) {
    p.homeX = p.x;
    p.homeY = p.y;
  }
  const homeD = Math.hypot(p.x - p.homeX, p.y - p.homeY);
  if (plutusLeash(room, p, nearestD, homeD, dt)) {
    p.engaged = false;
    return true;
  }
  if (p.collapseLeft > 0) {
    p.collapseLeft = Math.max(0, p.collapseLeft - dt);
    brake(p, dt);
    if (p.collapseLeft <= 0) {
      p.atkCd = Math.max(p.atkCd || 0, 0.6);
      room.markDirty();
    }
    return true;
  }
  p.engaged = nearestD < ENGAGE_R;
  if (p.rollCd > 0) p.rollCd -= dt;
  // swollen ripe (the coin the bell can break him at), the ring of his hoard burns
  // whoever stands in it (the ring drawn around him is exactly its edge, and throbs
  // once it burns): a tick a second, no hit-stop on the client (dot). One coin only
  // glows — a long fight beside him no longer bleeds a pilgrim who never finds the bell
  const inf = p.inflate || 0;
  p.auraAcc = (p.auraAcc || 0) + dt;
  if (p.auraAcc >= 1) {
    p.auraAcc = 0;
    if (inf >= BELL_BREAK_MIN) {
      const r = PULSE_BASE_R + PULSE_R_PER * inf + AURA_PAD;
      const dmg = tierDmg(room, AURA_DMG + AURA_DMG_PER * inf);
      for (const s of room.sessions.values()) {
        if (!(s.hp > 0) || s.iframes > 0) continue;
        if (Math.hypot(s.x - p.x, s.y - p.y) > r) continue;
        room.hitPlayer(s, p, dmg, { teleKind: "plutus_hoard", dot: true });
      }
    }
  }
  // the hoard pulses while he is swollen (independent of his own blows)
  if ((p.inflate || 0) >= 1 && p.engaged) {
    p.pulseCd = (p.pulseCd ?? 3) - dt;
    if (p.pulseCd <= 0) plutusPulse(room, p);
  } else if (p.pulseCd != null && p.pulseCd < 1.2) {
    p.pulseCd = 1.2;
  }
  // Phase 2: the hoard answers with rolling weights
  if (p.hp <= p.maxHp * 0.5 && p.phase !== 2) {
    p.phase = 2;
    p.phase2Toast = true;
    p.rollCd = Math.min(p.rollCd, 1.5);
    for (const s of room.sessions.values()) {
      room.toast(s.ws, "warn", "Plutus hurls the hoard — step out of the rolling weight's lane");
    }
  }
  // He calls the coins while someone fights him
  if (p.engaged) {
    // (the first call comes the moment he is engaged: every fight sees him swell)
    p.callCd = (p.callCd ?? FIRST_CALL) - dt;
    if (p.callCd <= 0) {
      p.callCd = CALL_EVERY;
      for (const pile of PILES) spawnFeeder(room, pile.x, pile.y);
      room.broadcast({ type: "ava_call", id: p.id, first: !p.called || undefined });
      p.called = true;
    }
  }
  if (p.teleId || p.staggerLeft > 0) {
    brake(p, dt);
    return true;
  }
  if (!nearest || nearestD >= 14) {
    brake(p, dt);
    return true;
  }
  chase(room, p, nearest, dt);
  unstick(p, nearestD > 3.2, dt);
  if (p.atkCd <= 0 && !(nearest.iframes > 0)) {
    if (p.phase === 2 && p.rollCd <= 0 && nearestD > 2.2 && nearestD < 13) plutusRoll(room, p, nearest);
    else if (plutusSlam(room, p, nearest, nearestD)) room.markDirty();
  }
  return true;
}

/**
 * Ledger Bell: stills nearby foes (as every bell) and breaks a swollen Plutus. A toll
 * that answers nothing (Plutus not swollen enough, no foe near) costs only a short
 * breath, not the full 18 s — the bell is never wasted on a misread.
 */
function ringBell(room, sess, poi) {
  const p = room.entities.get(PLUTUS_ID);
  let broke = false;
  if (p && p.hp > 0 && Math.hypot(p.x - poi.x, p.y - poi.y) <= BELL_REACH) {
    if ((p.inflate || 0) >= BELL_BREAK_MIN && !(p.collapseLeft > 0)) {
      broke = true;
      p.collapseLeft = COLLAPSE_SEC;
      p.inflate = 0;
      if (p.teleId) {
        room.cancelTelegraph(p.teleId, "still");
        p.teleId = null;
        p.windupLeft = 0;
      }
      // «…tal cadde a terra la fiera crudele»: he falls toward the bell — whoever
      // stands where he lands is crushed (telegraphed; step aside after ringing)
      const fdir = Math.atan2(poi.y - p.y, poi.x - p.x);
      room.telegraph({
        attackerId: p.id,
        shape: "cone",
        x: p.x,
        y: p.y,
        dir: fdir,
        radius: FALL_R,
        arc: FALL_ARC,
        duration: FALL_MS,
        kind: "plutus_fall",
        dmg: tierDmg(room, FALL_DMG),
        onResolve: (r, tt, hits) => {
          for (const s of hits) {
            if (!(s.hp > 0) || s.iframes > 0) continue;
            r.shovePlayer(s, Math.cos(tt.dir) * 1.4, Math.sin(tt.dir) * 1.4, 240);
          }
        },
      });
      room.broadcast({ type: "ava_collapse", id: p.id, dur: COLLAPSE_SEC * 1000, fall: FALL_MS });
      for (const s of room.sessions.values()) room.toast(s.ws, "emit", "«Taci, maledetto lupo!» — Plutus falls like a sail");
    }
  }
  let stilled = 0;
  for (const mob of room.entities.values()) {
    if (mob.kind !== "mob" || mob.feed) continue;
    if (String(mob.archetype || "").endsWith("_heart")) continue;
    if (Math.hypot(sess.x - mob.x, sess.y - mob.y) > 13.5) continue;
    mob.stunLeft = 3.4;
    stilled++;
  }
  sess.bellCd = broke || stilled > 0 ? 18 : 2;
  if (!broke) {
    const near = p && p.hp > 0 && Math.hypot(p.x - poi.x, p.y - poi.y) <= BELL_REACH && !(p.collapseLeft > 0);
    const line = stilled
      ? `peso — the Ledger Bell stills ${stilled} · 3.4s measure`
      : near
        ? `The bell tolls — Plutus holds too little coin yet (${Math.floor(p.inflate || 0)}/${BELL_BREAK_MIN})`
        : "peso — the Ledger Bell tolls; no weight answers.";
    room.toast(sess.ws, stilled ? "emit" : "info", line);
  }
  if (stilled > 0 || broke) room.tryDaily(sess.playerId, "ava_daily_ledger", { quiet: true });
  return true;
}

// ——— Counterweight ————————————————————————————————————————————————————————

function tickCounterweight(room, e, dt) {
  if (e.chargeCd == null) e.chargeCd = 2.5;
  if (e.chargeCd > 0) e.chargeCd -= dt;
  if (e.teleId || e.staggerLeft > 0 || e.atkCd > 0 || e.chargeCd > 0) return false;
  let nearest = null;
  let nd = 999;
  for (const s of room.sessions.values()) {
    if (!(s.hp > 0)) continue;
    const d = Math.hypot(s.x - e.x, s.y - e.y);
    if (d < nd) {
      nd = d;
      nearest = s;
    }
  }
  if (!nearest || nd < 3.6 || nd > 11 || nearest.iframes > 0) return false;
  const homeD = e.homeX == null ? 0 : Math.hypot(e.x - e.homeX, e.y - e.homeY);
  if (homeD > 13) return false;
  const dir = Math.atan2(nearest.y - e.y, nearest.x - e.x);
  const len = Math.min(13, nd + 3.5);
  const t = room.telegraph({
    attackerId: e.id,
    shape: "line",
    x: e.x,
    y: e.y,
    dir,
    length: len,
    width: CW_W,
    duration: CW_WIND * 1000,
    kind: "cw_charge",
    dmg: tierDmg(room, CW_DMG),
    onLand: (r, tt) => {
      if (e.teleId !== tt.id) return;
      e.teleId = null;
      e.windupLeft = 0;
      e.atkCd = Math.max(e.atkCd || 0, 1.15);
      const b = r.canto.geo.bounds;
      const end = Math.max(0, tt.length - 1.2);
      e.dart = {
        fx: e.x,
        fy: e.y,
        tx: clamp(tt.x + Math.cos(tt.dir) * end, 1.5, b.width - 1.5),
        ty: clamp(tt.y + Math.sin(tt.dir) * end, 1.5, b.height - 1.5),
        t: 0,
        dur: 0.45,
      };
      e.hd = tt.dir;
      e.sp = 0;
      crushLine(r, tt.x, tt.y, tt.dir, tt.length, tt.width, 45, "cw_charge", e.id, e.id);
    },
    onResolve: (r, tt, hits) => {
      for (const s of hits) {
        if (!(s.hp > 0) || s.iframes > 0) continue;
        const dx = s.x - tt.x;
        const dy = s.y - tt.y;
        const across = -dx * Math.sin(tt.dir) + dy * Math.cos(tt.dir);
        const side = across >= 0 ? 1 : -1;
        r.shovePlayer(s, Math.cos(tt.dir) * 1.2 - Math.sin(tt.dir) * side * 1.3, Math.sin(tt.dir) * 1.2 + Math.cos(tt.dir) * side * 1.3, 240);
      }
    },
  });
  e.teleId = t.id;
  e.windupLeft = CW_WIND;
  e.windupMax = CW_WIND;
  e.poise = 0;
  e.hd = dir;
  e.atkCd = CW_WIND + 0.05;
  e.chargeCd = CW_CHARGE_EVERY;
  room.markDirty();
  return true;
}

// ——— fodder refill (Avarice packs come back while the room is occupied) ——————————

function scheduleRefill(room, e) {
  if (!e.packId || NO_RESPAWN.has(e.packId)) return;
  const A = st(room);
  for (const e2 of room.entities.values()) {
    if (e2 !== e && e2.packId === e.packId && e2.kind === "mob" && !e2._dead) return;
  }
  if (A.refills.some((r) => r.packId === e.packId)) return;
  const pack = (room.canto.packs || []).find((p) => p.id === e.packId);
  if (!pack) return;
  A.refillStagger += 1;
  const delay = 48 + (Number(pack.count) || 1) * 6 + A.refillStagger * 4.5 + Math.random() * 10;
  A.refills.push({ packId: e.packId, at: clock(room) + delay, x: e.x, y: e.y });
}

function tickRefills(room) {
  const A = st(room);
  if (!A.refills.length) return;
  const now = clock(room);
  let w = 0;
  for (const r of A.refills) {
    if (now < r.at) {
      A.refills[w++] = r;
      continue;
    }
    let near = false;
    for (const s of room.sessions.values()) {
      if (Math.hypot(s.x - r.x, s.y - r.y) < 14) near = true;
    }
    if (near) {
      r.at = now + 8 + Math.random() * 6;
      A.refills[w++] = r;
      continue;
    }
    const pack = (room.canto.packs || []).find((p) => p.id === r.packId);
    if (!pack) continue;
    let alive = 0;
    for (const e of room.entities.values()) if (e.packId === r.packId && e.kind === "mob") alive++;
    if (alive > 0) continue;
    room.spawnPackMembers(pack);
    room.markDirty();
    for (const s of room.sessions.values()) {
      if (Math.hypot(s.x - r.x, s.y - r.y) < 36) room.toast(s.ws, "info", "contrapeso — weights return to the measure");
    }
  }
  A.refills.length = w;
}

// ——— hooks ——————————————————————————————————————————————————————————————

export default {
  init(room) {
    init(room);
  },

  tick(room, dt) {
    tickProcession(room, dt);
    tickRefills(room);
  },

  snapshotExtra(room) {
    const t = clock(room);
    const out = { t: +(((t % PROC.T) + PROC.T) % PROC.T).toFixed(3), T: PROC.T };
    const p = room.entities.get(PLUTUS_ID);
    if (p && p.hp > 0) {
      if (p.inflate > 0) out.inf = +p.inflate.toFixed(2);
      if (p.collapseLeft > 0) out.col = +p.collapseLeft.toFixed(2);
    }
    return out;
  },

  onDamage(room, target, amount, source) {
    if (target && target.id === PLUTUS_ID && source && source.kind === "player") {
      if (target.collapseLeft > 0) return amount * COLLAPSE_MULT;
      const inf = target.inflate || 0;
      if (inf > 0) return Math.max(1, amount * (1 - INFLATE_DR * inf));
    }
    return amount;
  },

  onBell(room, sess, poi) {
    return ringBell(room, sess, poi);
  },

  onKilled(room, e) {
    if (e.id === PLUTUS_ID) {
      // his coins scatter: the Fiorini still streaming to him sink back
      for (const f of [...room.entities.values()]) {
        if (f.feed) removeFeeder(room, f, { type: "ava_sink", id: f.id });
      }
      // (the kill cancelled his throw: room.onEntityKilled → cancelBy)
      sweepCancelled(room, e);
      resetPlutus(e);
      return;
    }
    scheduleRefill(room, e);
  },

  onBossReset(room, e) {
    // knit whole: his coin, calls and hurled weights all start over
    if (e.id === PLUTUS_ID) resetPlutus(e);
  },

  bossTick(room, boss, dt) {
    if (boss.id !== PLUTUS_ID) return false;
    return tickPlutus(room, boss, dt);
  },

  mobTick(room, e, dt) {
    if (e.feed) return tickFeeder(room, e, dt);
    if (e.packId === CW_PACK) return tickCounterweight(room, e, dt);
    return false;
  },
};

/**
 * Lust (inferno_05) — "La bufera infernal, che mai non resta, / mena li spirti con la
 * sua rapina; / voltando e percotendo li molesta." See ./index.mjs for the hook contract.
 *
 * 1) The storm (per room, server-authoritative): calm → warning (1.2 s) → gust. Each
 *    warning turns the wind 30–60°, biased to stay along the east-west road. During a
 *    gust pilgrims drift downwind (the client predicts it; adjustMove budgets it; idle
 *    connections are pushed here), shades / wisps / the lovers are carried, and a foe
 *    dashed against a windbreak or the map edge is hurt and stunned ("percotendo").
 *    The lee of a windbreak (lustGeo.inLee) cancels the push.
 * 2) Windbreaks (geo.windbreaks): solid rock islands for pilgrims (adjustMove,
 *    adjustDash) and foes (afterMobs).
 * 3) Paolo & Francesca ("questi, che mai da me non fia diviso"): the champion pair is
 *    tethered while both live within reach — blows are shared (and partly absorbed),
 *    the bond knits them, one's cleave is echoed by the other, the gust carries them.
 *    Part them: a gust (the one you strike holds its ground), a dash through the bond
 *    (cut for 4 s), or luring. Both slain within 4 s: "Amor condusse noi ad una
 *    morte" — a bonus drop.
 * 4) Minos ("cignesi con la coda tante volte / quantunque gradi vuol che giù sia
 *    messa"): coils his tail N times — a cascade of N rings, inner to outer — and for
 *    N ≥ 2 sweeps the sentence (a fan of N lines at his target, each soul judged once)
 *    after which a judging gust throws the damned toward the edge — the more coils,
 *    the harsher the sentence. Wounded (≤50%): the
 *    storm quickens and a flock of shades comes "a schiera larga e piena", once; while
 *    it lives it shields him (blows land at 20%).
 * 5) "percotendo": early in each gust the storm hurls grit along the wind at every
 *    exposed pilgrim (a line telegraph, cut short by the first rock) — shelter or step
 *    across the wind.
 *
 * Wire (see also client/src/world/cantoMech/lust.ts):
 *   snapshot.mech = { phase: "calm"|"warn"|"gust", left (ms), dirX, dirY, strength,
 *                     judged?: 1, wb?: [x, y, r, …] (first snapshots + every 64th),
 *                     lov?: [idA, idB, state 0 apart | 1 bound | 2 cut],
 *                     mw?: 1 (Minos shielded by his flock) }
 *   { type: "lust_storm", phase, left, dirX, dirY, judged? }   phase changes
 *   { type: "lust_slam", id, x, y, dmg }                       a foe dashed on rock/edge
 *   { type: "lust_tether", state: "bind"|"snap"|"cut", a, b, x?, y? }
 *   { type: "lust_coil", id, n, ms: [landing ms of each ring] }  Minos coils
 *   telegraph kinds "minos_coil" (circle, then rings), "minos_sentence" (line) and
 *   "bufera_strike" (line from upwind, attacker "mech:bufera", cut short at a rock)
 */
import { rollDrops } from "../loot.mjs";
import { bodyRadius, brake, chase, startAttack } from "../mobAi.mjs";
import {
  DASH_DOWNWIND,
  LOVER_DRIFT,
  MOB_DRIFT,
  PLAYER_DRIFT,
  PLAYER_PAD,
  STORM,
  UPWIND_MUL,
  gustEnvelope,
  inLee,
  pushOutOfRocks,
  segsCross,
  sweepRocks,
} from "./lustGeo.mjs";

const LOVERS_PACK = "lust_champion_pair";
const LOVER_NAMES = ["Paolo", "Francesca"];
/** Lovers are a mini-boss pair: a little tougher than a plain champion. */
const LOVER_HP = 165;
/** A lover's cleave (the pair strike as one, so each blow is lighter than a champion's). */
const LOVER_DMG = 8;
/** The partner follows a lover's cleave this much later, from its own side. */
const LOVER_ECHO = 0.28;
/** The bond holds within this reach; a broken bond re-forms inside BIND_RANGE. */
const TETHER_RANGE = 7;
const BIND_RANGE = 5.2;
/** While bound each lover takes this share of a blow (the rest is borne by love). */
const TETHER_SHARE = 0.38;
const TETHER_HEAL = 2;
const TETHER_CUT_MS = 4000;
const TOGETHER_MS = 4000;
/** A lover struck within this window digs in against the gust (the other drifts off). */
const HELD_MS = 1100;

const MINOS_ID = "minos_gate";
/** Minos is a two-phase fight (the room's BOSS_HP default is a single slam boss's). */
const MINOS_HP = 950;
/** While the borne flock lives, blows on Minos land at this share. */
const FLOCK_WARD = 0.2;
const FLOCK_PACK = "lust_minos_flock";
/** Carried foes only while a pilgrim is this near (idle packs huddle out of the wind). */
const CARRY_NEAR = 20;
/** Foes are never carried into the entrance hollow. */
const SPAWN_CALM = 12;

const CARRIED = new Set(["whirl_shade", "gale_wisp"]);

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

/** Angle distance from the east-west axis (0 = along the road, π/2 = across it). */
function axisDev(a) {
  const c = Math.abs(Math.cos(a));
  return Math.acos(Math.min(1, c));
}

function state(room) {
  return room._lust;
}

// ——— storm ——————————————————————————————————————————————————————————————

function stormWire(L) {
  return {
    phase: L.phase,
    left: Math.max(0, Math.round(L.left * 1000)),
    dirX: +L.wx.toFixed(3),
    dirY: +L.wy.toFixed(3),
    strength: +L.str.toFixed(2),
    judged: L.judged ? 1 : undefined,
  };
}

function broadcastStorm(room, L) {
  room.broadcast({ type: "lust_storm", ...stormWire(L) });
}

function setWind(L, ang) {
  L.ang = Math.atan2(Math.sin(ang), Math.cos(ang));
  L.wx = Math.cos(L.ang);
  L.wy = Math.sin(L.ang);
}

/** Turn the wind 30–60°, keeping it within ~60° of the east-west road. */
function turnWind(L) {
  const step = rand(Math.PI / 6, Math.PI / 3);
  const opts = [];
  for (const sgn of [1, -1]) {
    const a = L.ang + sgn * step;
    if (axisDev(a) <= Math.PI / 3 + 0.02) opts.push(a);
  }
  const a = opts.length ? opts[Math.floor(Math.random() * opts.length)] : L.ang + (axisDev(L.ang + step) < axisDev(L.ang - step) ? step : -step);
  setWind(L, a);
}

function minosFury(room, L) {
  const m = room.entities.get(MINOS_ID);
  if (!m || !(m.hp > 0) || m.hp > m.maxHp * 0.5) return false;
  for (const s of room.sessions.values()) {
    if (s.hp > 0 && Math.hypot(s.x - m.x, s.y - m.y) < 18) return true;
  }
  return false;
}

function enterPhase(room, L, phase, dur) {
  L.phase = phase;
  L.left = dur;
  L.dur = dur;
  L.t = 0;
  if (phase === "gust") {
    L.gustId++;
    L.strikeK = 0;
  }
  if (phase !== "gust") L.judged = false;
  L.str = 0;
  broadcastStorm(room, L);
  room.markDirty();
}

function tickStorm(room, L, dt) {
  L.left -= dt;
  L.t += dt;
  if (L.left <= 0) {
    if (L.phase === "calm") {
      if (L.keepWind) L.keepWind = false;
      else turnWind(L);
      enterPhase(room, L, "warn", STORM.warn);
    } else if (L.phase === "warn") {
      L.power = 1;
      enterPhase(room, L, "gust", rand(STORM.gustMin, STORM.gustMax));
    } else {
      const fury = minosFury(room, L);
      enterPhase(
        room,
        L,
        "calm",
        fury ? rand(STORM.furyCalmMin, STORM.furyCalmMax) : rand(STORM.calmMin, STORM.calmMax)
      );
    }
  }
  L.str = L.phase === "gust" ? gustEnvelope(L.t, L.left, L.power) : 0;
}

/** Minos's judging gust: the storm blows now, along `ang`, harder and shorter. */
function judgeGust(room, L, ang, dur, power) {
  setWind(L, ang);
  L.power = power;
  L.judged = true;
  enterPhase(room, L, "gust", dur);
}

// ——— pilgrims ————————————————————————————————————————————————————————————

/** Pilgrims whose client is not sending moves (idle tab, pinned) are pushed here. */
function driftIdlePlayers(room, L, dt) {
  if (L.str <= 0.02) return;
  const now = Date.now();
  const b = room.canto.geo.bounds;
  for (const s of room.sessions.values()) {
    if (!(s.hp > 0)) continue;
    if (s._lastMoveAt && now - s._lastMoveAt < 250) continue;
    if (inLee(L.wb, L.wx, L.wy, s.x, s.y)) continue;
    const k = PLAYER_DRIFT * L.str * dt;
    const p = L._p;
    p.x = clamp(s.x + L.wx * k, 0.5, b.width - 0.5);
    p.y = clamp(s.y + L.wy * k, 0.5, b.height - 0.5);
    pushOutOfRocks(L.wb, p, PLAYER_PAD);
    s.x = p.x;
    s.y = p.y;
    room.markDirty();
  }
}

// ——— foes ————————————————————————————————————————————————————————————————

function nearestSession(room, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const s of room.sessions.values()) {
    if (!(s.hp > 0)) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return { s: best, d: bestD };
}

function isLover(L, e) {
  return Boolean(L.lovers && (e.id === L.lovers.a || e.id === L.lovers.b));
}

function loverPartner(room, L, e) {
  const lv = L.lovers;
  if (!lv) return null;
  const pid = e.id === lv.a ? lv.b : e.id === lv.b ? lv.a : null;
  const p = pid ? room.entities.get(pid) : null;
  return p && p.hp > 0 && !p._dead ? p : null;
}

/**
 * Hurt a foe outside the player-blow path (the storm, the tether's shared share):
 * combat broadcast from "mech:<src>" (no hit-stop on anyone's screen), kill credit to
 * `creditId` (loot, pack lines).
 */
function hurtFoe(room, e, dmg, creditId, src) {
  if (!e || e._dead || !(e.hp > 0)) return 0;
  dmg = Math.max(0, Math.round(dmg));
  if (dmg <= 0) return 0;
  e.hp = Math.max(0, e.hp - dmg);
  room.broadcast({
    type: "combat",
    attackerId: `mech:${src}`,
    targetId: e.id,
    damage: dmg,
    targetHp: e.hp,
    spellId: src,
  });
  if (e.hp <= 0) room.onEntityKilled(creditId, e);
  room.markDirty();
  return dmg;
}

/** "percotendo": a carried foe dashed against rock or the edge of the circle. */
function slamFoe(room, L, e, x, y) {
  if (e._lustSlam === L.gustId) return;
  e._lustSlam = L.gustId;
  const lover = isLover(L, e);
  const dmg = lover ? 10 + e.maxHp * 0.1 : 9 + e.maxHp * 0.3;
  const who = nearestSession(room, e.x, e.y);
  room.broadcast({ type: "lust_slam", id: e.id, x: +x.toFixed(2), y: +y.toFixed(2), dmg: Math.round(dmg) });
  // (stunLeft breaks any windup in the room's AI pass and shows as stilled)
  e.stunLeft = Math.max(e.stunLeft || 0, lover ? 0.55 : 0.85);
  e.kvx = 0;
  e.kvy = 0;
  if (lover && L.lovers?.bound) shareBlow(room, L, e, dmg, who.s?.playerId || null, "gust");
  else hurtFoe(room, e, dmg, who.s?.playerId || null, "gust");
}

/**
 * "voltando e percotendo": early in each gust the storm hurls grit along the wind at
 * every exposed pilgrim — a line from upwind through where the drift will carry them,
 * cut short by the first windbreak in its path (the lee is safe). Step across the wind
 * or into a rock's lee.
 */
const STRIKE = { at: [0.2], windup: 0.8, len: 16, width: 1.5, dmg: 7, back: 9 };

function tickStrikes(room, L) {
  if (L.phase !== "gust" || L.judged) return;
  while (L.strikeK < STRIKE.at.length && L.t >= STRIKE.at[L.strikeK]) {
    L.strikeK++;
    const px = -L.wy;
    const py = L.wx;
    for (const s of room.sessions.values()) {
      if (!(s.hp > 0) || s.iframes > 0) continue;
      if (inLee(L.wb, L.wx, L.wy, s.x, s.y)) continue;
      // lead the drift a little, and never aim dead centre
      const lead = PLAYER_DRIFT * L.power * STRIKE.windup * 0.4;
      const off = (Math.random() - 0.5) * 0.9;
      const tx = s.x + L.wx * lead + px * off;
      const ty = s.y + L.wy * lead + py * off;
      const ox = tx - L.wx * STRIKE.back;
      const oy = ty - L.wy * STRIKE.back;
      const t = sweepRocks(L.wb, ox, oy, ox + L.wx * STRIKE.len, oy + L.wy * STRIKE.len, 0.2);
      const len = STRIKE.len * t;
      // a rock upwind already shields them
      if (len < STRIKE.back - 0.4) continue;
      room.telegraph({
        attackerId: "mech:bufera",
        shape: "line",
        x: ox,
        y: oy,
        dir: L.ang,
        length: len,
        width: STRIKE.width,
        duration: STRIKE.windup * 1000,
        kind: "bufera_strike",
        dmg: STRIKE.dmg,
        onHit: (r, tt, sess) => (inLee(L.wb, L.wx, L.wy, sess.x, sess.y) ? 0 : tt.dmg),
      });
    }
  }
}

/** Carry shades, wisps and the lovers downwind; slam them on rock and edge. */
function carryFoes(room, L, dt) {
  if (L.str <= 0.02) return;
  const b = room.canto.geo.bounds;
  const sp = room.canto.geo.spawn;
  const now = Date.now();
  const p = L._p;
  for (const e of room.entities.values()) {
    if (e.kind !== "mob" || !(e.hp > 0) || e._dead) continue;
    const lover = isLover(L, e);
    if (!lover && !CARRIED.has(e.archetype)) continue;
    if (e.dart) continue;
    if (lover && (e._lustHeldUntil || 0) > now) continue;
    if (nearestSession(room, e.x, e.y).d > CARRY_NEAR) continue;
    if (inLee(L.wb, L.wx, L.wy, e.x, e.y)) continue;
    const k = (lover ? LOVER_DRIFT : MOB_DRIFT) * L.str * dt;
    p.x = e.x + L.wx * k;
    p.y = e.y + L.wy * k;
    if (Math.hypot(p.x - sp.x, p.y - sp.y) < SPAWN_CALM) continue;
    let slam = false;
    const edge = 1.5;
    if (p.x < edge || p.x > b.width - edge || p.y < edge || p.y > b.height - edge) {
      p.x = clamp(p.x, edge, b.width - edge);
      p.y = clamp(p.y, edge, b.height - edge);
      slam = L.str > 0.5;
    }
    const rock = pushOutOfRocks(L.wb, p, bodyRadius(e, room.cantoId) * 0.85);
    if (rock) {
      // (carried into its face, not grazing along its side)
      const nx = rock.x - e.x;
      const ny = rock.y - e.y;
      const nl = Math.hypot(nx, ny) || 1;
      if (L.str > 0.5 && (nx * L.wx + ny * L.wy) / nl > 0.35) slam = true;
    }
    e.x = p.x;
    e.y = p.y;
    if (slam) slamFoe(room, L, e, p.x, p.y);
  }
  room.markDirty();
}

// ——— the lovers ————————————————————————————————————————————————————————————

function setupLovers(room, L) {
  const pair = [];
  for (const e of room.entities.values()) {
    if (e.kind === "mob" && e.packId === LOVERS_PACK) pair.push(e);
  }
  pair.sort((a, b) => (a.id < b.id ? -1 : 1));
  if (pair.length < 2) {
    L.lovers = null;
    return;
  }
  // "quei due che 'nsieme vanno": they wait side by side, not across the pack ring
  const anchor = (room.canto.packs || []).find((p) => p.id === LOVERS_PACK)?.anchor;
  for (let i = 0; i < 2; i++) {
    pair[i].name = LOVER_NAMES[i];
    pair[i].hp = LOVER_HP;
    pair[i].maxHp = LOVER_HP;
    if (anchor) {
      pair[i].x = anchor.x + (i === 0 ? -1.1 : 1.1);
      pair[i].y = anchor.y + (i === 0 ? 0.3 : -0.3);
    }
  }
  L.lovers = { a: pair[0].id, b: pair[1].id, bound: true, cutUntil: 0, fell: {}, healAcc: 0 };
}

function tetherMsg(room, L, st, x, y) {
  const lv = L.lovers;
  room.broadcast({
    type: "lust_tether",
    state: st,
    a: lv.a,
    b: lv.b,
    x: x != null ? +x.toFixed(2) : undefined,
    y: y != null ? +y.toFixed(2) : undefined,
  });
}

function tickLovers(room, L, dt) {
  const lv = L.lovers;
  if (!lv) return;
  const a = room.entities.get(lv.a);
  const b = room.entities.get(lv.b);
  const both = a && b && a.hp > 0 && b.hp > 0 && !a._dead && !b._dead;
  if (!both) {
    if (lv.bound) {
      lv.bound = false;
      room.markDirty();
    }
    return;
  }
  const now = Date.now();
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  if (lv.bound && d > TETHER_RANGE) {
    lv.bound = false;
    tetherMsg(room, L, "snap", (a.x + b.x) / 2, (a.y + b.y) / 2);
    room.markDirty();
  } else if (!lv.bound && now >= lv.cutUntil && d < BIND_RANGE) {
    lv.bound = true;
    tetherMsg(room, L, "bind");
    room.markDirty();
  }
  // Each lover's blow is lighter; while bound, the other answers it from its side
  for (const [e, o] of [[a, b], [b, a]]) {
    if (!e.teleId || e._lustTele === e.teleId) continue;
    e._lustTele = e.teleId;
    const t = room.tele.get(e.teleId);
    if (!t) continue;
    if (!t._lustEcho) t.dmg = Math.min(t.dmg, LOVER_DMG);
    if (!lv.bound || t._lustEcho || o.teleId || (o.stunLeft || 0) > 0 || (o.staggerLeft || 0) > 0) continue;
    const tgt = nearestSession(room, o.x, o.y);
    if (!tgt.s || tgt.d > 3.4 || tgt.s.iframes > 0) continue;
    const echo = startAttack(room, o, tgt.s, tgt.d, LOVER_DMG, { windup: 0.55 + LOVER_ECHO, trigger: 3.4 });
    if (echo) {
      echo._lustEcho = true;
      o._lustTele = echo.id;
    }
  }
  if (!lv.bound) return;
  // "Amor, ch'a nullo amato amar perdona": the bond knits them
  lv.healAcc += TETHER_HEAL * dt;
  if (lv.healAcc >= 1) {
    const h = Math.floor(lv.healAcc);
    lv.healAcc -= h;
    let changed = false;
    for (const e of [a, b]) {
      if (e.hp < e.maxHp) {
        e.hp = Math.min(e.maxHp, e.hp + h);
        changed = true;
      }
    }
    if (changed) room.markDirty();
  }
}

/** A blow on a bound lover: both bear a share (the rest is borne by love). */
function shareBlow(room, L, target, amount, creditId, src) {
  const partner = loverPartner(room, L, target);
  const share = Math.max(1, Math.round(amount * TETHER_SHARE));
  if (partner) hurtFoe(room, partner, share, creditId, "tether");
  hurtFoe(room, target, share, creditId, src);
  return share;
}

function cutTether(room, L, sess, x, y) {
  const lv = L.lovers;
  if (!lv || !lv.bound) return;
  lv.bound = false;
  lv.cutUntil = Date.now() + TETHER_CUT_MS;
  tetherMsg(room, L, "cut", x, y);
  if (sess) room.toast(sess.ws, "emit", "The bond is cut — strike them apart (4s)");
  room.markDirty();
}

function loverFell(room, L, e) {
  const lv = L.lovers;
  if (!lv) return;
  const now = Date.now();
  lv.fell[e.id] = now;
  lv.bound = false;
  const other = e.id === lv.a ? lv.b : lv.a;
  const otherAt = lv.fell[other];
  const nameOf = (id) => LOVER_NAMES[id === lv.a ? 0 : 1];
  if (otherAt && now - otherAt <= TOGETHER_MS) {
    // "Amor condusse noi ad una morte" — both fell together: a bonus drop
    const drops = rollDrops(e.dropTable || "inferno_pack_common", { champion: true, boss: false });
    let i = 0;
    for (const item of drops.slice(0, 2)) {
      L.lootSeq = (L.lootSeq || 0) + 1;
      const id = `loot_lovers_${L.lootSeq}_${now % 100000}`;
      const ang = (i++ / Math.max(1, drops.length)) * Math.PI * 2 + 0.6;
      const p = L._p;
      p.x = e.x + Math.cos(ang) * 1.3;
      p.y = e.y + Math.sin(ang) * 1.3;
      pushOutOfRocks(L.wb, p, 0.4);
      room.entities.set(id, { id, kind: "loot", name: item.name, x: p.x, y: p.y, item });
    }
    for (const s of room.sessions.values()) {
      if (Math.hypot(s.x - e.x, s.y - e.y) < 40) {
        room.toast(s.ws, "emit", "«Amor condusse noi ad una morte» — the lovers fall together");
      }
    }
    room.markDirty();
  } else if (!otherAt) {
    // (a shared blow may fell the other on this same swing: look a beat later)
    const ex = e.x;
    const ey = e.y;
    room.schedule(0.05, () => {
      const survivor = room.entities.get(other);
      if (!survivor || !(survivor.hp > 0) || lv.fell[other]) return;
      for (const s of room.sessions.values()) {
        if (Math.hypot(s.x - ex, s.y - ey) < 30) {
          room.toast(s.ws, "warn", `${nameOf(e.id)} falls — slay ${nameOf(other)} within 4s: «ad una morte»`);
        }
      }
    });
  }
}

// ——— Minos ————————————————————————————————————————————————————————————————

const MINOS = {
  /** first ring lands this long after the coil starts (s); each next ring later */
  firstLand: 1.15,
  firstLandP2: 0.9,
  ringGap: 0.55,
  ringGapP2: 0.42,
  /** ring k spans [inner_k, outer_k]; ring 1 is a full disc around him */
  ringW: 2.45,
  ring1: 3.6,
  ringDmg: 7,
  ringDmgP2: 9,
  sentenceLen: 13,
  sentenceW: 2.4,
  sentenceWind: 0.8,
  sentenceWindP2: 0.7,
  sentenceBase: 4,
  /** fan spacing (rad) and landing step (s) of the sweeping sentence */
  sentenceFan: 0.42,
  sentenceStep: 0.2,
  sentencePerCoil: 3,
  judgeGust: 1.2,
  judgePower: 1.25,
  recover: 2.0,
  recoverP2: 1.5,
  aggro: 14,
  engage: 9.5,
};

function minosState(e) {
  if (!e._minos) e._minos = { st: "chase", t: 0, next: 0.6, target: null, sentenceId: null, chorus: false, p2: false };
  return e._minos;
}

function coilCount(p2) {
  const r = Math.random();
  if (p2) return r < 0.35 ? 2 : 3;
  return r < 0.45 ? 1 : r < 0.9 ? 2 : 3;
}

function startCoil(room, L, e, ms) {
  const p2 = ms.p2;
  const n = coilCount(p2);
  ms.n = n;
  const first = p2 ? MINOS.firstLandP2 : MINOS.firstLand;
  const gap = p2 ? MINOS.ringGapP2 : MINOS.ringGap;
  const dmg = p2 ? MINOS.ringDmgP2 : MINOS.ringDmg;
  const lands = [];
  for (let k = 0; k < n; k++) {
    const land = first + k * gap;
    lands.push(Math.round(land * 1000));
    const outer = MINOS.ring1 + k * MINOS.ringW;
    const spec = {
      attackerId: e.id,
      shape: k === 0 ? "circle" : "ring",
      x: e.x,
      y: e.y,
      radius: outer,
      duration: land * 1000,
      kind: "minos_coil",
      dmg,
      extra: { coil: k + 1, of: n },
      onHit: (r, t, s) => {
        // the coil flings you outward a little
        const dx = s.x - t.x;
        const dy = s.y - t.y;
        const l = Math.hypot(dx, dy) || 1;
        r.shovePlayer(s, (dx / l) * 0.7, (dy / l) * 0.7, 200);
        return t.dmg;
      },
    };
    if (k > 0) spec.inner = outer - MINOS.ringW;
    room.telegraph(spec);
  }
  room.broadcast({ type: "lust_coil", id: e.id, n, ms: lands });
  ms.st = "coil";
  ms.t = 0;
  ms.until = first + (n - 1) * gap + 0.22;
  e.windupLeft = ms.until;
  e.windupMax = ms.until;
}

/**
 * The sentence: his arm sweeps a fan of N lines across the pilgrim (one per coil,
 * ~24° apart, landing 0.2 s apart from one side to the other); each soul is sentenced
 * once. Stand behind him, get out past its reach, or dash through.
 */
function startSentence(room, L, e, ms, target) {
  const p2 = ms.p2;
  const dir = Math.atan2(target.y - e.y, target.x - e.x);
  e.hd = dir;
  const wind = p2 ? MINOS.sentenceWindP2 : MINOS.sentenceWind;
  const n = Math.max(1, Math.min(3, ms.n || 2));
  const side = Math.random() < 0.5 ? 1 : -1;
  const dmg = MINOS.sentenceBase + MINOS.sentencePerCoil * n;
  const judged = new Set();
  let last = null;
  for (let k = 0; k < n; k++) {
    const a = dir + side * (k - (n - 1) / 2) * MINOS.sentenceFan;
    const final = k === n - 1;
    last = room.telegraph({
      attackerId: e.id,
      shape: "line",
      x: e.x,
      y: e.y,
      dir: a,
      length: MINOS.sentenceLen,
      width: MINOS.sentenceW,
      duration: (wind + k * MINOS.sentenceStep) * 1000,
      kind: "minos_sentence",
      // the more coils, the harsher the sentence ("quantunque gradi vuol che giù sia messa")
      dmg,
      extra: { line: k + 1, of: n },
      onLand: final
        ? (r) => {
            // the judging wind: along the sentence, toward the edge of the circle
            const m = r.entities.get(e.id);
            if (m && m.hp > 0) judgeGust(r, L, dir, MINOS.judgeGust + 0.15 * n, MINOS.judgePower + 0.1 * (n - 1));
          }
        : null,
      onHit: (r, tt, s) => {
        if (judged.has(s.playerId)) return 0;
        judged.add(s.playerId);
        r.shovePlayer(s, Math.cos(a) * 1.6, Math.sin(a) * 1.6, 260);
        return tt.dmg;
      },
    });
  }
  ms.st = "sentence";
  ms.t = 0;
  ms.until = wind + (n - 1) * MINOS.sentenceStep + 0.15;
  ms.sentenceId = last?.id || null;
  e.windupLeft = ms.until;
  e.windupMax = ms.until;
}

/** "a schiera larga e piena": the flock of borne shades, once, when Minos is wounded. */
function summonChorus(room, L, e) {
  const n = 5;
  // they come riding the wind: from upwind of the dais
  const base = L.ang + Math.PI;
  for (let i = 0; i < n; i++) {
    const a = base + (i - (n - 1) / 2) * 0.45;
    const p = L._p;
    p.x = e.x + Math.cos(a) * 9;
    p.y = e.y + Math.sin(a) * 9;
    const b = room.canto.geo.bounds;
    p.x = clamp(p.x, 2, b.width - 2);
    p.y = clamp(p.y, 2, b.height - 2);
    pushOutOfRocks(L.wb, p, 0.9);
    L.chorusSeq = (L.chorusSeq || 0) + 1;
    const id = `mob_lustflock_${L.chorusSeq}`;
    const hp = 45;
    room.entities.set(id, {
      id,
      kind: "mob",
      name: "Borne Shade",
      x: p.x,
      y: p.y,
      homeX: e.x,
      homeY: e.y,
      hp,
      maxHp: hp,
      packId: FLOCK_PACK,
      champion: false,
      elite: false,
      dropTable: "inferno_pack_common",
      archetype: "whirl_shade",
      atkCd: 0.9 + i * 0.2,
    });
  }
  for (const s of room.sessions.values()) {
    if (Math.hypot(s.x - e.x, s.y - e.y) < 40) {
      room.toast(s.ws, "warn", "«a schiera larga e piena» — a flock of shades shields Minos: scatter it");
    }
  }
  room.pushAllSnapshots();
}

function minosTick(room, L, e, dt) {
  let nearest = null;
  let nearestD = Infinity;
  for (const s of room.sessions.values()) {
    if (!(s.hp > 0)) continue;
    const d = Math.hypot(s.x - e.x, s.y - e.y);
    if (d < nearestD) {
      nearestD = d;
      nearest = s;
    }
  }
  if (!nearest) return false;
  if (e.homeX == null) {
    e.homeX = e.x;
    e.homeY = e.y;
  }
  const homeD = Math.hypot(e.x - e.homeX, e.y - e.homeY);
  const ms = minosState(e);
  if (!ms.hpSet) {
    // (a fresh Minos — first spawn or risen again — gets his own pool)
    ms.hpSet = true;
    const f = e.maxHp > 0 ? e.hp / e.maxHp : 1;
    e.maxHp = MINOS_HP;
    e.hp = Math.max(1, Math.round(MINOS_HP * f));
    room.markDirty();
  }
  if (room.tickBossLeash(e, nearestD, homeD, dt)) {
    ms.st = "chase";
    ms.next = 1;
    ms.p2 = false;
    return true;
  }
  if (!ms.p2 && e.hp <= e.maxHp * 0.5) {
    ms.p2 = true;
    e.phase = 2;
    if (!ms.chorus) {
      ms.chorus = true;
      summonChorus(room, L, e);
      // he rears up and calls the storm: the flock rides the next gust in
      if (ms.st === "chase") {
        ms.next = Math.max(ms.next, 2.2);
      }
      if (L.phase === "calm") {
        // (the flock waits upwind: this gust keeps the wind that brings it)
        L.left = Math.min(L.left, 0.3);
        L.keepWind = true;
      }
    }
  } else if (ms.p2 && e.hp > e.maxHp * 0.5) {
    // reset by the leash (full health again)
    ms.p2 = false;
    e.phase = undefined;
  }
  ms.t += dt;
  if (ms.next > 0) ms.next -= dt;
  switch (ms.st) {
    case "coil":
      brake(e, dt);
      if (ms.t >= ms.until) {
        e.windupLeft = 0;
        // sentence the nearest pilgrim (the one who stood closest to judgement); a
        // single coil needs no sentence
        const tgt = (ms.n || 1) >= 2 && nearestD < MINOS.sentenceLen + 2 ? nearest : null;
        if (tgt) startSentence(room, L, e, ms, tgt);
        else {
          ms.st = "chase";
          ms.next = MINOS.recover;
        }
      }
      return true;
    case "sentence":
      brake(e, dt);
      if (ms.t >= ms.until) {
        e.windupLeft = 0;
        ms.st = "chase";
        ms.next = ms.p2 ? MINOS.recoverP2 : MINOS.recover;
      }
      return true;
    default:
      break;
  }
  if (nearestD > MINOS.aggro) {
    brake(e, dt);
    return true;
  }
  chase(room, e, nearest, dt);
  if (ms.next <= 0 && nearestD < MINOS.engage && !(nearest.iframes > 0)) startCoil(room, L, e, ms);
  return true;
}

// ——— hooks ——————————————————————————————————————————————————————————————————

function parseWindbreaks(canto) {
  const raw = canto?.geo?.windbreaks;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((w) => ({ x: Number(w.x), y: Number(w.y), r: Number(w.r) || 1.5 }))
    .filter((w) => Number.isFinite(w.x) && Number.isFinite(w.y));
}

export default {
  init(room) {
    const wb = parseWindbreaks(room.canto);
    const L = {
      wb,
      wbWire: wb.flatMap((w) => [+w.x.toFixed(2), +w.y.toFixed(2), +w.r.toFixed(2)]),
      phase: "calm",
      left: STORM.firstCalm,
      dur: STORM.firstCalm,
      t: 0,
      ang: 0,
      wx: 1,
      wy: 0,
      str: 0,
      power: 1,
      judged: false,
      gustId: 0,
      lovers: null,
      flock: 0,
      strikeK: 0,
      _p: { x: 0, y: 0 },
    };
    setWind(L, (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.4, 0.4));
    room._lust = L;
    setupLovers(room, L);
    // Foes never start inside a rock (pack rings are random around the anchor)
    for (const e of room.entities.values()) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      const p = L._p;
      p.x = e.x;
      p.y = e.y;
      if (pushOutOfRocks(wb, p, bodyRadius(e, room.cantoId) + 0.1)) {
        e.x = p.x;
        e.y = p.y;
      }
    }
  },

  tick(room, dt) {
    const L = state(room);
    if (!L) return;
    tickStorm(room, L, dt);
    tickStrikes(room, L);
    let flock = 0;
    for (const e of room.entities.values()) if (e.packId === FLOCK_PACK && e.hp > 0) flock++;
    if (flock !== L.flock) {
      L.flock = flock;
      room.markDirty();
    }
    driftIdlePlayers(room, L, dt);
    carryFoes(room, L, dt);
    tickLovers(room, L, dt);
  },

  /** After every foe moved: nothing stands inside a windbreak. */
  afterMobs(room) {
    const L = state(room);
    if (!L || !L.wb.length) return false;
    let moved = false;
    const p = L._p;
    for (const e of room.entities.values()) {
      if ((e.kind !== "mob" && e.kind !== "boss") || !(e.hp > 0)) continue;
      p.x = e.x;
      p.y = e.y;
      if (pushOutOfRocks(L.wb, p, bodyRadius(e, room.cantoId) * 0.85)) {
        e.x = p.x;
        e.y = p.y;
        moved = true;
      }
    }
    return moved;
  },

  snapshotExtra(room, sess) {
    const L = state(room);
    if (!L) return undefined;
    const out = stormWire(L);
    if (sess) {
      sess._lustSnaps = (sess._lustSnaps || 0) + 1;
      if (sess._lustSnaps <= 3 || sess._lustSnaps % 64 === 0) out.wb = L.wbWire;
    }
    if (L.flock > 0) out.mw = 1;
    const lv = L.lovers;
    if (lv) {
      const a = room.entities.get(lv.a);
      const b = room.entities.get(lv.b);
      if (a && b) out.lov = [lv.a, lv.b, lv.bound ? 1 : Date.now() < lv.cutUntil ? 2 : 0];
    }
    return out;
  },

  adjustMove(room, sess, from, to, dt) {
    const L = state(room);
    if (!L) return to;
    const p = L._p;
    p.x = to.x;
    p.y = to.y;
    // Upwind budget: the gust caps how fast anyone walks into it (a token bucket, so
    // packet jitter never rubber-bands an honest client)
    const gusting = L.str > 0.05 && !inLee(L.wb, L.wx, L.wy, from.x, from.y);
    const rate = 8 * (gusting ? 1 - (1 - UPWIND_MUL) * L.str : 1) * 1.25 + 0.6;
    sess._lustUp = Math.min(0.9, (sess._lustUp ?? 0.9) + rate * dt);
    const up = -((p.x - from.x) * L.wx + (p.y - from.y) * L.wy);
    if (gusting && up > 0) {
      const allow = sess._lustUp + (sess.shoveAllow || 0);
      if (up > allow) {
        const cut = up - allow;
        p.x += L.wx * cut;
        p.y += L.wy * cut;
      }
      sess._lustUp = Math.max(0, sess._lustUp - Math.min(up, allow));
    }
    // Windbreaks are solid
    pushOutOfRocks(L.wb, p, PLAYER_PAD);
    return p;
  },

  /**
   * room.handleDash: the dash (from → to along dir) — farther downwind in a gust,
   * stopped at a rock's face; a dash through the lovers' bond cuts it.
   */
  adjustDash(room, sess, fromX, fromY, toX, toY, dx, dy) {
    const L = state(room);
    if (!L) return null;
    const b = room.canto.geo.bounds;
    let tx = toX;
    let ty = toY;
    if (L.str > 0.05 && !inLee(L.wb, L.wx, L.wy, fromX, fromY)) {
      const a = dx * L.wx + dy * L.wy;
      if (a > 0) {
        const extra = 5.5 * DASH_DOWNWIND * a * Math.min(1, L.str);
        tx = clamp(tx + dx * extra, 2, b.width - 2);
        ty = clamp(ty + dy * extra, 2, b.height - 2);
      }
    }
    const t = sweepRocks(L.wb, fromX, fromY, tx, ty, PLAYER_PAD);
    if (t < 1) {
      tx = fromX + (tx - fromX) * t;
      ty = fromY + (ty - fromY) * t;
    }
    const p = L._p;
    p.x = tx;
    p.y = ty;
    pushOutOfRocks(L.wb, p, PLAYER_PAD);
    // Through the bond: "questi, che mai da me non fia diviso" — until now
    const lv = L.lovers;
    if (lv?.bound) {
      const a = room.entities.get(lv.a);
      const c = room.entities.get(lv.b);
      if (a && c && segsCross(fromX, fromY, p.x, p.y, a.x, a.y, c.x, c.y)) {
        cutTether(room, L, sess, (a.x + c.x) / 2, (a.y + c.y) / 2);
      }
    }
    return { x: p.x, y: p.y };
  },

  onDamage(room, target, amount, source) {
    const L = state(room);
    if (!L || target.playerId) return amount;
    // the borne flock shields its Judge
    if (target.id === MINOS_ID && L.flock > 0) return Math.max(1, Math.round(amount * FLOCK_WARD));
    if (!L.lovers || !isLover(L, target)) return amount;
    if (source?.kind === "player") target._lustHeldUntil = Date.now() + HELD_MS;
    if (!L.lovers.bound || !(amount > 0)) return amount;
    const partner = loverPartner(room, L, target);
    if (!partner) return amount;
    const share = Math.max(1, Math.round(amount * TETHER_SHARE));
    hurtFoe(room, partner, share, source?.playerId || null, "tether");
    return share;
  },

  onKilled(room, e) {
    const L = state(room);
    if (!L) return;
    if (isLover(L, e)) loverFell(room, L, e);
    // loot never lands inside a rock
    const p = L._p;
    for (const o of room.entities.values()) {
      if (o.kind !== "loot") continue;
      if (Math.abs(o.x - e.x) > 3 || Math.abs(o.y - e.y) > 3) continue;
      p.x = o.x;
      p.y = o.y;
      if (pushOutOfRocks(L.wb, p, 0.35)) {
        o.x = p.x;
        o.y = p.y;
      }
    }
  },

  bossTick(room, boss, dt) {
    const L = state(room);
    if (!L || boss.id !== MINOS_ID) return false;
    return minosTick(room, L, boss, dt);
  },
};

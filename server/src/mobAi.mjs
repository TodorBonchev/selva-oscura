/**
 * Generic mob combat AI shared by every canto: movement with acceleration and a turn
 * rate, surround slots around the player (no stacking on the hero), soft mob spacing,
 * knockback impulses / stagger / poise, and windup attacks that resolve against a
 * ground telegraph (telegraph.mjs) instead of instant hits.
 *
 * Canto-specific behaviour stays in room.mjs (Avarice leash/aggro/weave/surge) or in
 * cantoMech/* hooks (mobTick / bossTick replace this AI for a mob when they return true).
 */

/** Attack shapes per archetype family. windup/recover in seconds, reach in world units. */
export const ATTACKS = {
  // Shades: a lunging claw swipe in front — step back or sideways out of the cone. It
  // starts while the shade is still closing (trigger > slot), and the lunge carries it in.
  swipe: { shape: "cone", windup: 0.4, radius: 3.0, arc: 1.95, trigger: 2.9, recover: 0.45, kind: "shade_swipe", lunge: 0.6 },
  // Wisps: coil, then dart along a short line (the wisp really moves along it)
  dart: { shape: "line", windup: 0.28, length: 4.8, width: 1.15, trigger: 4.2, minTrigger: 0.8, recover: 1.05, kind: "wisp_dart", dartDur: 0.16 },
  // Champions: overhead slam around them (Avarice weights raise their discs for it)
  champSlam: { shape: "circle", windup: 0.55, radius: 2.45, trigger: 2.5, recover: 1.05, kind: "champ_slam" },
  // Lust champions: wide wind cleave in front
  champCleave: { shape: "cone", windup: 0.55, radius: 3.2, arc: 2.5, trigger: 2.5, recover: 1.05, kind: "champ_cleave" },
  // Wardens: slow, heavy ground slam
  wardenSlam: { shape: "circle", windup: 0.7, radius: 2.75, trigger: 2.45, recover: 1.1, kind: "champ_slam" },
  // Bosses: the classic dais slam (Crush phase 2 overrides radius/windup in room.mjs)
  boss: { shape: "circle", windup: 1.4, radius: 3.2, trigger: 2.6, recover: 1.35, kind: "boss_slam" },
};

const WISPS = new Set(["gale_wisp", "mud_wisp", "coin_wisp", "sullen_wisp"]);
const WARDENS = new Set(["gale_warden", "mire_warden", "ledger_warden"]);
const SHADES = new Set(["whirl_shade", "mire_shade", "weight_shade", "wrath_shade"]);

export function isWisp(e) {
  return WISPS.has(e?.archetype);
}

/** Champion-class (slam windup, poise) — not the heart pillars, which never attack. */
export function isChampionClass(e) {
  return (
    e?.kind === "mob" &&
    (Boolean(e.champion) || e.archetype === "weight_champion" || e.archetype === "fury_champion")
  );
}

/** Which attack a mob uses (a canto mechanic may set e.attackProfile to override). */
export function attackFor(e) {
  if (e.attackProfile && ATTACKS[e.attackProfile]) return ATTACKS[e.attackProfile];
  if (e.kind === "boss") return ATTACKS.boss;
  const a = e.archetype || "";
  if (WISPS.has(a)) return ATTACKS.dart;
  if (WARDENS.has(a)) return ATTACKS.wardenSlam;
  if (a === "gale_champion") return ATTACKS.champCleave;
  if (isChampionClass(e)) return ATTACKS.champSlam;
  return ATTACKS.swipe;
}

/** Locomotion per family: top speed, accel (u/s²), turn rate (rad/s), surround radius. */
function moveBase(e) {
  const a = e.archetype || "";
  if (e.kind === "boss") return { speed: 2.2, accel: 3.2, turn: 2.2, slot: 2.3 };
  if (WISPS.has(a)) return { speed: 5.4, accel: 16, turn: 8, slot: 2.7 };
  if (WARDENS.has(a)) return { speed: 1.6, accel: 4, turn: 2.6, slot: 2.0 };
  const weight = a === "weight_shade" || a === "weight_champion";
  if (isChampionClass(e)) return { speed: weight ? 2.65 : 3.0, accel: 6.5, turn: 3.6, slot: 1.95 };
  return { speed: weight ? 2.65 : 3.0, accel: 9, turn: 5.5, slot: 1.75 };
}

/**
 * Wrath enrage sets e.enraged. Shades and champions move 25% faster while it
 * holds; a boss enrage is damage only (wrath.mjs).
 */
export function moveFor(e) {
  const loco = moveBase(e);
  if (e?.enraged && e.kind !== "boss") return { ...loco, speed: loco.speed * 1.25 };
  return loco;
}

/** Body radius for player collision and mob spacing. */
export function bodyRadius(e, cantoId) {
  const a = e.archetype || "";
  if (e.kind === "boss") return 1.8;
  if (a === "sullen_wisp") return 0.48;
  if (a === "wrath_shade") return 0.74;
  if (a === "fury_champion") return 1.05;
  if (a === "rage_heart") return 0.95;
  if (cantoId === "inferno_07") {
    // (Avarice weights are bulkier — the radii the weight collision always used)
    if (a === "coin_wisp") return 0.85;
    if (a === "weight_champion") return 1.35;
    if (a === "weight_shade") return 1.1;
  }
  if (a.endsWith("_heart")) return 0.9;
  if (WISPS.has(a)) return 0.55;
  if (WARDENS.has(a)) return 1.1;
  if (isChampionClass(e)) return 1.0;
  return 0.7;
}

/** Knockback distance (world units) a player blow gives, by weight class. */
export function knockbackFor(e, heavy) {
  if (e.kind === "boss" || (e.archetype || "").endsWith("_heart")) return 0;
  if (isChampionClass(e)) return heavy ? 0.3 : 0.1;
  return heavy ? 0.9 : 0.35;
}

/**
 * Poise: blows that land DURING a champion's windup build it — a plain blow or spell
 * +1, a finisher or a dash cut +POISE_HEAVY — and POISE_BREAK breaks the windup
 * (telegraph_cancel + stagger). It resets when a windup starts, so the break always
 * answers blows thrown into that windup: a finisher plus one more blow, or three
 * blows from a party.
 */
export const POISE_BREAK = 3;
export const POISE_HEAVY = 2;
const KB_RATE = 11; // impulse decay (1/s): the shove lands over ~0.2 s

/** Give a mob a knockback impulse of `dist` world units along (dx,dy). */
export function pushMob(e, dx, dy, dist) {
  const l = Math.hypot(dx, dy);
  if (!(l > 1e-4) || !(dist > 0)) return;
  // v0 = dist·KB_RATE: the exact decay in tickImpulse travels exactly `dist`
  e.kvx = (e.kvx || 0) + (dx / l) * dist * KB_RATE;
  e.kvy = (e.kvy || 0) + (dy / l) * dist * KB_RATE;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Integrate knockback / dart motion; returns true if the mob moved. */
export function tickImpulse(e, dt, bounds) {
  let moved = false;
  if (e.dart) {
    const d = e.dart;
    d.t += dt;
    const u = Math.min(1, d.t / d.dur);
    // ease-out: the lunge snaps forward and settles
    const k = 1 - (1 - u) * (1 - u);
    e.x = d.fx + (d.tx - d.fx) * k;
    e.y = d.fy + (d.ty - d.fy) * k;
    if (u >= 1) e.dart = null;
    moved = true;
  }
  if (e.kvx || e.kvy) {
    // exact integral of v·e^(−k·t) over the tick (explicit Euler overshot by ~1.4×)
    const f = Math.exp(-KB_RATE * dt);
    const g = (1 - f) / KB_RATE;
    e.x += e.kvx * g;
    e.y += e.kvy * g;
    e.kvx *= f;
    e.kvy *= f;
    if (Math.abs(e.kvx) + Math.abs(e.kvy) < 0.05) {
      e.kvx = 0;
      e.kvy = 0;
    }
    moved = true;
  }
  if (moved && bounds) {
    e.x = clamp(e.x, 1.5, bounds.width - 1.5);
    e.y = clamp(e.y, 1.5, bounds.height - 1.5);
  }
  return moved;
}

/**
 * Steer toward a desired planar velocity with acceleration and a turn rate (heading
 * `e.hd`, speed `e.sp`). A sharp change of course first brakes, then turns: mobs
 * carve and plant instead of snapping around.
 */
export function steer(e, wantX, wantY, loco, dt) {
  const wantSp = Math.hypot(wantX, wantY);
  if (e.hd == null) e.hd = wantSp > 0.01 ? Math.atan2(wantY, wantX) : 0;
  if (e.sp == null) e.sp = 0;
  let target = wantSp;
  if (wantSp > 0.01) {
    const diff = wrap(Math.atan2(wantY, wantX) - e.hd);
    const maxTurn = loco.turn * dt;
    e.hd = wrap(e.hd + clamp(diff, -maxTurn, maxTurn));
    // facing away from where it wants to go: bleed speed while turning
    const c = Math.cos(diff);
    if (c < 0.3) target = wantSp * Math.max(0, c + 0.2);
  }
  const dv = target - e.sp;
  const rate = dv > 0 ? loco.accel : loco.accel * 1.6;
  e.sp = clamp(e.sp + clamp(dv, -rate * dt, rate * dt), 0, loco.speed * 1.6);
  if (e.sp < 0.01) return false;
  e.x += Math.cos(e.hd) * e.sp * dt;
  e.y += Math.sin(e.hd) * e.sp * dt;
  return true;
}

/**
 * Chase `target` into a surround slot (≈loco.slot from the player on the mob's own
 * bearing) with soft spacing from other mobs, so a pack rings the hero instead of
 * stacking on it. opts: { speedMul, weave(e, sx, sy, dt) → [sx, sy] }.
 */
export function chase(room, e, target, dt, opts = {}) {
  const loco = moveFor(e);
  const speed = loco.speed * (opts.speedMul || 1);
  let bx = e.x - target.x;
  let by = e.y - target.y;
  let bl = Math.hypot(bx, by);
  if (bl < 0.15) {
    // on top of the player: pick a stable bearing from the id
    const a = (hashId(e.id) % 628) / 100;
    bx = Math.cos(a);
    by = Math.sin(a);
    bl = 1;
  }
  const slotX = target.x + (bx / bl) * loco.slot;
  const slotY = target.y + (by / bl) * loco.slot;
  let dx = slotX - e.x;
  let dy = slotY - e.y;
  const dl = Math.hypot(dx, dy);
  // arrive: ease into the slot instead of overshooting it
  const arrive = clamp(dl / 1.1, 0, 1);
  let vx = dl > 0.05 ? (dx / dl) * speed * arrive : 0;
  let vy = dl > 0.05 ? (dy / dl) * speed * arrive : 0;
  if (opts.weave && dl > 0.3) {
    const w = opts.weave(e, vx / (speed || 1), vy / (speed || 1), dt);
    if (w) {
      const s = Math.hypot(vx, vy);
      vx = w[0] * s;
      vy = w[1] * s;
    }
  }
  const sep = separation(room, e);
  vx += sep[0];
  vy += sep[1];
  let moved = false;
  // Personal space: crowded onto the pilgrim, it steps back without turning away
  const inner = loco.slot * 0.72;
  if (bl < inner) {
    const k = ((inner - bl) / inner) * 3.2 * dt;
    e.x += (bx / bl) * k;
    e.y += (by / bl) * k;
    moved = true;
  }
  return steer(e, vx, vy, { ...loco, speed }, dt) || moved;
}

/** Walk toward a point (leash home, mechanic waypoints) with the same locomotion. */
export function walkTo(room, e, x, y, speed, dt) {
  const loco = moveFor(e);
  const dx = x - e.x;
  const dy = y - e.y;
  const dl = Math.hypot(dx, dy);
  const arrive = clamp(dl / 1.2, 0, 1);
  const sp = speed ?? loco.speed;
  return steer(e, dl > 0.05 ? (dx / dl) * sp * arrive : 0, dl > 0.05 ? (dy / dl) * sp * arrive : 0, { ...loco, speed: sp }, dt);
}

/** Come to a stop (idle / windup). */
export function brake(e, dt) {
  if (!(e.sp > 0)) return false;
  return steer(e, 0, 0, moveFor(e), dt);
}

const _sep = [0, 0];
/** Soft spacing velocity away from overlapping mobs (every canto). */
export function separation(room, e) {
  _sep[0] = 0;
  _sep[1] = 0;
  const r0 = bodyRadius(e, room.cantoId);
  for (const o of room.entities.values()) {
    if (o === e || (o.kind !== "mob" && o.kind !== "boss")) continue;
    if (o.hp != null && o.hp <= 0) continue;
    const min = (r0 + bodyRadius(o, room.cantoId)) * 0.95;
    const dx = e.x - o.x;
    const dy = e.y - o.y;
    if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
    const d = Math.hypot(dx, dy);
    if (d >= min) continue;
    if (d < 1e-3) {
      const a = (hashId(e.id) % 628) / 100;
      _sep[0] += Math.cos(a) * 2;
      _sep[1] += Math.sin(a) * 2;
      continue;
    }
    const push = ((min - d) / min) * 3.2;
    _sep[0] += (dx / d) * push;
    _sep[1] += (dy / d) * push;
  }
  return _sep;
}

/**
 * Wedged mobs (wanting to move, making no progress for a while) sidestep; generic
 * so no pack can wall a corridor off for good.
 */
export function unstick(e, wanted, dt) {
  const lx = e._stuckX;
  const ly = e._stuckY;
  const step = lx == null ? 99 : Math.hypot(e.x - lx, e.y - ly);
  e._stuckX = e.x;
  e._stuckY = e.y;
  if (!wanted) {
    e._stuckT = 0;
    return false;
  }
  if (step < 0.06 * (dt / 0.066)) e._stuckT = (e._stuckT || 0) + dt;
  else e._stuckT = 0;
  if ((e._stuckT || 0) <= 0.6) return false;
  const hd = e.hd || 0;
  const side = Math.sin((e.x || 0) * 2.1 + (e.y || 0)) >= 0 ? 1 : -1;
  e.x += -Math.sin(hd) * side * 2.8 * dt;
  e.y += Math.cos(hd) * side * 2.8 * dt;
  e._stuckT = 0.3;
  return true;
}

export function hashId(id) {
  let h = 0;
  const s = String(id || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Start a windup attack at `target` (a session) if in reach. Returns the telegraph or
 * null. The mob holds still through the windup; the telegraph's resolve clears it.
 * over: optional profile overrides ({ windup, radius, dmg, … }).
 */
export function startAttack(room, e, target, targetD, dmg, over = null) {
  const p = over ? { ...attackFor(e), ...over } : attackFor(e);
  if (targetD > p.trigger) return null;
  if (p.minTrigger && targetD < p.minTrigger) return null;
  const dir = Math.atan2(target.y - e.y, target.x - e.x);
  // a lunging strike closes to arm's length (≈1.4), no further
  const lunge = p.lunge ? Math.max(0, Math.min(p.lunge, targetD - 1.4)) : 0;
  const spec = {
    attackerId: e.id,
    shape: p.shape,
    x: e.x,
    y: e.y,
    dir,
    duration: p.windup * 1000,
    kind: p.kind,
    dmg,
    // the blow lands: the mob's own motion starts on the deadline (hits are judged
    // right after, laggy players a grace later — telegraph.mjs)
    onLand: (r, t) => {
      if (e.teleId !== t.id) return;
      e.teleId = null;
      e.windupLeft = 0;
      e.atkCd = Math.max(e.atkCd || 0, p.recover);
      if (lunge > 0.05) {
        // the strike steps in along its facing (knockback-style impulse), never onto you
        pushMob(e, Math.cos(t.dir), Math.sin(t.dir), lunge);
      }
      if (p.shape === "line" && p.dartDur) {
        // the wisp lunges through the line it telegraphed
        const b = r.canto.geo.bounds;
        e.dart = {
          fx: e.x,
          fy: e.y,
          tx: clamp(t.x + Math.cos(t.dir) * t.length, 1.5, b.width - 1.5),
          ty: clamp(t.y + Math.sin(t.dir) * t.length, 1.5, b.height - 1.5),
          t: 0,
          dur: p.dartDur,
        };
        e.hd = t.dir;
        e.sp = 0;
      }
    },
  };
  if (p.shape === "cone") {
    spec.radius = p.radius;
    spec.arc = p.arc;
  } else if (p.shape === "line") {
    spec.length = Math.min(p.length, targetD + 1.6);
    spec.width = p.width;
  } else if (p.shape === "ring") {
    spec.radius = p.radius;
    spec.inner = p.inner;
  } else {
    spec.radius = p.radius;
  }
  const t = room.telegraph(spec);
  e.teleId = t.id;
  e.windupLeft = p.windup;
  e.windupMax = p.windup;
  e.poise = 0;
  e.hd = dir;
  // atkCd covers the windup; recover is added when it resolves
  e.atkCd = p.windup + 0.05;
  return t;
}

/** Break a windup (poise / finisher / mechanic). */
export function interruptAttack(room, e, stagger = 0.5, reason = "stagger") {
  if (e.teleId) {
    room.cancelTelegraph(e.teleId, reason);
    e.teleId = null;
  }
  e.windupLeft = 0;
  e.staggerLeft = Math.max(e.staggerLeft || 0, stagger);
  e.atkCd = Math.max(e.atkCd || 0, stagger + 0.35);
  e.poise = 0;
}

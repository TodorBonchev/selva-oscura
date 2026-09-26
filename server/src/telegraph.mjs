/**
 * Ground telegraphs: a shape on the floor that fills over a windup, then resolves
 * against EVERY player standing inside it (not just the attacker's target). Dash /
 * respawn iframes still resolve, as a "safe" beat with no damage.
 *
 * Shapes (planar x/y, `dir` in radians — planar heading, 0 = +x, π/2 = +y):
 *   circle  centre (x,y), radius
 *   ring    centre (x,y), inner … radius (donut; `inner` defaults to radius − width)
 *   cone    apex (x,y), facing dir, radius (reach), arc (full opening angle)
 *   line    start (x,y), facing dir, length, width (full width)
 *
 * Wire: { type: "telegraph", id, attackerId, shape, x, y, dir, radius, length, width,
 *         arc, inner, duration (ms), kind, dmg } — and { type: "telegraph_cancel", id }.
 * The client draws the fill growing to the edge over `duration`; the server resolves
 * at the end of it (tick granularity, ≤66 ms late).
 *
 * Pure geometry (pointInShape / shapeExit) is shared with scripts/selfplay.mjs so the
 * bot dodges the exact shape the server tests.
 */

let teleSeq = 0;

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Is planar point (px,py) inside telegraph shape `t`, grown by `pad`? */
export function pointInShape(t, px, py, pad = 0) {
  const dx = px - t.x;
  const dy = py - t.y;
  const d = Math.hypot(dx, dy);
  switch (t.shape) {
    case "circle":
      return d <= (t.radius || 0) + pad;
    case "ring": {
      const inner = t.inner != null ? t.inner : Math.max(0, (t.radius || 0) - (t.width || 1));
      return d <= (t.radius || 0) + pad && d >= inner - pad;
    }
    case "cone": {
      if (d > (t.radius || 0) + pad) return false;
      if (d < 0.35 + pad) return true; // standing on the apex
      const off = Math.abs(wrapAngle(Math.atan2(dy, dx) - (t.dir || 0)));
      const half = (t.arc || Math.PI / 2) / 2;
      if (off <= half) return true;
      // pad as a distance off the cone's side edge
      return pad > 0 && off < Math.PI / 2 + half && d * Math.sin(off - half) <= pad;
    }
    case "line": {
      const ux = Math.cos(t.dir || 0);
      const uy = Math.sin(t.dir || 0);
      const along = dx * ux + dy * uy;
      const perp = Math.abs(-dx * uy + dy * ux);
      return along >= -pad && along <= (t.length || 0) + pad && perp <= (t.width || 1) / 2 + pad;
    }
    default:
      return false;
  }
}

/**
 * Shortest way out of a shape from (px,py): returns { x, y, d } — a unit planar
 * direction and the distance to walk (plus `pad`) — or null when already outside.
 */
export function shapeExit(t, px, py, pad = 0.4) {
  if (!pointInShape(t, px, py, pad)) return null;
  const dx = px - t.x;
  const dy = py - t.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const rx = dx / d;
  const ry = dy / d;
  const best = { x: rx, y: ry, d: Infinity };
  const offer = (x, y, dist) => {
    if (dist < best.d) {
      best.x = x;
      best.y = y;
      best.d = dist;
    }
  };
  switch (t.shape) {
    case "circle":
      offer(rx, ry, (t.radius || 0) - d + pad);
      break;
    case "ring": {
      const inner = t.inner != null ? t.inner : Math.max(0, (t.radius || 0) - (t.width || 1));
      offer(rx, ry, (t.radius || 0) - d + pad);
      if (inner > 0.6) offer(-rx, -ry, d - inner + pad);
      break;
    }
    case "cone": {
      offer(rx, ry, (t.radius || 0) - d + pad);
      // sideways past the nearer edge (perpendicular to the facing)
      const dir = t.dir || 0;
      const half = (t.arc || Math.PI / 2) / 2;
      const rel = wrapAngle(Math.atan2(dy, dx) - dir);
      const side = rel >= 0 ? 1 : -1;
      const edge = dir + side * half;
      // distance from the point to the edge ray, stepping along the edge normal
      const nx = -Math.sin(edge) * side;
      const ny = Math.cos(edge) * side;
      const across = Math.max(0, -(dx * nx + dy * ny)) + pad;
      offer(nx, ny, across);
      break;
    }
    case "line": {
      const ux = Math.cos(t.dir || 0);
      const uy = Math.sin(t.dir || 0);
      const along = dx * ux + dy * uy;
      const perpS = -dx * uy + dy * ux;
      const half = (t.width || 1) / 2;
      const side = perpS >= 0 ? 1 : -1;
      offer(-uy * side, ux * side, half - Math.abs(perpS) + pad);
      offer(ux, uy, (t.length || 0) - along + pad);
      offer(-ux, -uy, along + pad);
      break;
    }
    default:
      return null;
  }
  return best.d === Infinity ? null : best;
}

/** Public wire form of a telegraph (no server-only fields). */
function wire(t) {
  return {
    type: "telegraph",
    id: t.id,
    attackerId: t.attackerId,
    shape: t.shape,
    x: +t.x.toFixed(2),
    y: +t.y.toFixed(2),
    dir: +(t.dir || 0).toFixed(3),
    radius: t.radius,
    length: t.length,
    width: t.width,
    arc: t.arc,
    inner: t.inner,
    duration: Math.round(t.durMs),
    kind: t.kind,
    dmg: t.dmg,
  };
}

/**
 * Per-room telegraph book-keeping. The room owns one; mob AI, bosses and canto
 * mechanics start telegraphs through room.telegraph(spec).
 */
export class Telegraphs {
  constructor(room) {
    this.room = room;
    /** @type {any[]} live telegraphs, resolved in start order */
    this.live = [];
  }

  /**
   * Start a telegraph. spec: { attackerId, shape, x, y, dir, radius, length, width, arc,
   * inner, duration (ms), kind, dmg, onResolve(room, t, hits), onHit(room, t, sess) → dmg,
   * noDamage }. Returns the telegraph (its `id` is on the wire).
   */
  start(spec) {
    teleSeq += 1;
    const t = {
      id: `t${teleSeq}`,
      attackerId: spec.attackerId ?? null,
      shape: spec.shape || "circle",
      x: Number(spec.x) || 0,
      y: Number(spec.y) || 0,
      dir: Number(spec.dir) || 0,
      radius: spec.radius != null ? +Number(spec.radius).toFixed(2) : undefined,
      length: spec.length != null ? +Number(spec.length).toFixed(2) : undefined,
      width: spec.width != null ? +Number(spec.width).toFixed(2) : undefined,
      arc: spec.arc != null ? +Number(spec.arc).toFixed(3) : undefined,
      inner: spec.inner != null ? +Number(spec.inner).toFixed(2) : undefined,
      durMs: Math.max(60, Number(spec.duration) || 500),
      left: Math.max(0.06, (Number(spec.duration) || 500) / 1000),
      kind: spec.kind || "slam",
      dmg: Math.max(0, Math.round(Number(spec.dmg) || 0)),
      onResolve: spec.onResolve || null,
      onHit: spec.onHit || null,
      noDamage: Boolean(spec.noDamage),
      extra: spec.extra || null,
    };
    this.live.push(t);
    const msg = wire(t);
    if (t.extra) Object.assign(msg, t.extra);
    this.room.broadcast(msg);
    return t;
  }

  /** Drop a live telegraph without resolving it (stagger, death, leash). */
  cancel(id, reason = "") {
    const i = this.live.findIndex((t) => t.id === id);
    if (i < 0) return false;
    this.live.splice(i, 1);
    this.room.broadcast({ type: "telegraph_cancel", id, reason: reason || undefined });
    return true;
  }

  /** Cancel every telegraph an attacker owns (it died / was reset). */
  cancelBy(attackerId, reason = "") {
    for (let i = this.live.length - 1; i >= 0; i--) {
      if (this.live[i].attackerId === attackerId) this.cancel(this.live[i].id, reason);
    }
  }

  get(id) {
    return this.live.find((t) => t.id === id) || null;
  }

  clear() {
    this.live.length = 0;
  }

  /** Count down; resolve the due ones against every player inside the shape. */
  tick(dt) {
    if (!this.live.length) return;
    let due = null;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const t = this.live[i];
      t.left -= dt;
      if (t.left > 0) continue;
      this.live.splice(i, 1);
      (due || (due = [])).unshift(t);
    }
    if (!due) return;
    for (const t of due) this.resolve(t);
  }

  resolve(t) {
    const room = this.room;
    const attacker = t.attackerId ? room.entities.get(t.attackerId) : null;
    // A mob that died or was reset mid-windup never lands the blow
    if (t.attackerId && !attacker && !String(t.attackerId).startsWith("mech")) return;
    const hits = [];
    if (!t.noDamage) {
      for (const s of [...room.sessions.values()]) {
        if (!(s.hp > 0)) continue;
        if (!pointInShape(t, s.x, s.y)) continue;
        let dmg = t.dmg;
        if (t.onHit) dmg = t.onHit(room, t, s);
        if (dmg == null || dmg <= 0) continue;
        hits.push(s);
        room.hitPlayer(s, attacker || { id: t.attackerId }, dmg, {
          teleKind: t.kind,
          teleId: t.id,
          champTele: t.kind === "champ_slam" || undefined,
        });
      }
    }
    if (t.onResolve) t.onResolve(room, t, hits);
  }
}

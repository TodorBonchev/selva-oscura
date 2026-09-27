/**
 * Wisp darts drawn on the telegraph clock instead of the interpolation delay.
 *
 * Mobs are drawn ~one snapshot interval in the past (render/smoothing InterpStore),
 * but a wisp_dart lands on the server at the telegraph deadline and its hit reaches
 * you right away — an interpolated wisp would arrive ~150 ms after you already
 * flinched, and its telegraph line would start ahead of it. So while a dart telegraph
 * runs, the wisp's drawn position follows the telegraph: it settles onto the line's
 * start during the coil, darts to the end as the fill lands (ease-out over the
 * server's dartDur), holds there until interpolation has caught up, then blends back.
 * Fixed pool; nothing allocates per frame.
 */
import type { InterpStore, Vec2 } from "../render/smoothing";

/** server mobAi.mjs ATTACKS.dart.dartDur */
const DART_MS = 160;
/** coil: glide from the drawn (delayed) spot onto the line start */
const SETTLE_MS = 110;
/** after the dart: blend back into interpolation */
const BLEND_MS = 140;
/** the server clamps dart ends this far inside the bounds (mobAi.mjs) */
const EDGE = 1.5;
const POOL = 8;

type Dart = {
  active: boolean;
  id: string;
  teleId: string;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  t0: number;
  /** visible windup (ms): the dart starts as the fill lands */
  wind: number;
  /** hand back to interpolation by then at the latest */
  holdUntil: number;
  /** blend-out start (0 while driven) */
  releaseAt: number;
  /** drawn position at release (blend source) */
  rx: number;
  ry: number;
  /** last drawn position */
  lx: number;
  ly: number;
};

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const _v: Vec2 = { x: 0, y: 0 };

export class DartPaths {
  private darts: Dart[] = [];

  constructor() {
    for (let i = 0; i < POOL; i++) {
      this.darts.push({
        active: false,
        id: "",
        teleId: "",
        sx: 0,
        sy: 0,
        ex: 0,
        ey: 0,
        t0: 0,
        wind: 1,
        holdUntil: 0,
        releaseAt: 0,
        rx: 0,
        ry: 0,
        lx: 0,
        ly: 0,
      });
    }
  }

  /**
   * A wisp telegraphed a dart: line from (x,y) along dir for `length`. windMs: the fill
   * time shown here; delayMs: the interpolation delay (how long until the samples of
   * the server's dart are drawn).
   */
  start(
    id: string,
    teleId: string,
    x: number,
    y: number,
    dir: number,
    length: number,
    windMs: number,
    nowMs: number,
    bounds: { width: number; height: number } | null,
    delayMs: number
  ) {
    let d: Dart | undefined;
    for (const o of this.darts) if (o.active && o.id === id) d = o;
    if (!d) d = this.darts.find((o) => !o.active);
    if (!d) d = this.darts.reduce((a, b) => (a.t0 < b.t0 ? a : b));
    let ex = x + Math.cos(dir) * length;
    let ey = y + Math.sin(dir) * length;
    if (bounds) {
      ex = Math.max(EDGE, Math.min(bounds.width - EDGE, ex));
      ey = Math.max(EDGE, Math.min(bounds.height - EDGE, ey));
    }
    d.active = true;
    d.id = id;
    d.teleId = teleId;
    d.sx = x;
    d.sy = y;
    d.ex = ex;
    d.ey = ey;
    d.t0 = nowMs;
    d.wind = Math.max(60, windMs);
    d.holdUntil = nowMs + d.wind + DART_MS + delayMs + 160;
    d.releaseAt = 0;
  }

  /** The server broke the windup (stagger / still / death): hand back from here. */
  cancel(teleId: string, nowMs: number) {
    for (const d of this.darts) {
      if (!d.active || d.teleId !== teleId || d.releaseAt > 0) continue;
      d.releaseAt = nowMs;
      d.rx = d.lx;
      d.ry = d.ly;
    }
  }

  /** Per frame, right after interp.update(): drive the darting wisps' drawn position. */
  apply(interp: InterpStore, nowMs: number) {
    for (const d of this.darts) {
      if (!d.active) continue;
      const p = interp.get(d.id);
      if (!p) {
        d.active = false;
        continue;
      }
      const ix = p.x;
      const iy = p.y;
      const u = nowMs - d.t0;
      let x: number;
      let y: number;
      let vx = 0;
      let vy = 0;
      if (d.releaseAt > 0) {
        const k = (nowMs - d.releaseAt) / BLEND_MS;
        if (k >= 1) {
          d.active = false;
          continue;
        }
        const e = ease(k);
        x = d.rx + (ix - d.rx) * e;
        y = d.ry + (iy - d.ry) * e;
        interp.vel(d.id, _v);
        vx = _v.x;
        vy = _v.y;
      } else if (u < d.wind) {
        // coil: settle onto the line start (the server holds it there through the windup)
        const k = ease(u / SETTLE_MS);
        x = ix + (d.sx - ix) * k;
        y = iy + (d.sy - iy) * k;
      } else if (u < d.wind + DART_MS) {
        const q = (u - d.wind) / DART_MS;
        const e = 1 - (1 - q) * (1 - q);
        x = d.sx + (d.ex - d.sx) * e;
        y = d.sy + (d.ey - d.sy) * e;
        const sp = (2 * (1 - q) * 1000) / DART_MS;
        vx = (d.ex - d.sx) * sp;
        vy = (d.ey - d.sy) * sp;
      } else {
        x = d.ex;
        y = d.ey;
        // interpolation has replayed the server's dart (or the hold ran out): hand back
        if (Math.hypot(ix - d.ex, iy - d.ey) < 0.35 || nowMs >= d.holdUntil) {
          d.releaseAt = nowMs;
          d.rx = x;
          d.ry = y;
        }
      }
      d.lx = x;
      d.ly = y;
      if (!interp.override(d.id, x, y, vx, vy)) d.active = false;
    }
  }

  clear() {
    for (const d of this.darts) d.active = false;
  }
}

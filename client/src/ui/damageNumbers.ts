/**
 * Floating combat numbers on one screen-space layer: a fixed pool of absolutely
 * positioned nodes moved with `transform` every rendered frame (compositor-only — no
 * layout, no per-number CSS2D object or rAF loop). Styled by source so a glance tells
 * your cut from a spell, a finisher, a dash, a blow on you or a heal. Numbers on the
 * same target stack upward instead of overprinting, with a little sideways jitter.
 */
import * as THREE from "three";

export type DmgStyle = "melee" | "heavy" | "spell" | "dash" | "self" | "heal" | "other" | "block";

type Item = {
  el: HTMLElement;
  active: boolean;
  x: number;
  y: number;
  z: number;
  start: number;
  dur: number;
  jitter: number;
  stack: number;
  pop: number;
  rise: number;
  visible: boolean;
};

const POOL = 28;
const STACK_MS = 420;
const STACK_PX = 17;

const DUR: Record<DmgStyle, number> = {
  melee: 760,
  heavy: 980,
  spell: 820,
  dash: 760,
  self: 900,
  heal: 1000,
  other: 620,
  block: 700,
};

const _v = new THREE.Vector3();

export class DamageNumbers {
  readonly layer: HTMLElement;
  private items: Item[] = [];
  private next = 0;
  private recent = new Map<string, { t: number; n: number }>();
  private live = 0;

  constructor(parent: HTMLElement) {
    this.layer = document.createElement("div");
    this.layer.className = "dmg-layer";
    parent.appendChild(this.layer);
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement("div");
      el.className = "dmg";
      el.style.opacity = "0";
      this.layer.appendChild(el);
      this.items.push({ el, active: false, x: 0, y: 0, z: 0, start: 0, dur: 1, jitter: 0, stack: 0, pop: 1, rise: 46, visible: false });
    }
  }

  /**
   * A number at world (x,y,z). key groups numbers that should stack (the target id).
   */
  spawn(x: number, y: number, z: number, text: string, style: DmgStyle, nowMs: number, key = "", mark = "", popMul = 1) {
    let it = this.items[this.next]!;
    // prefer a free slot; otherwise the oldest (round-robin)
    for (let k = 0; k < POOL; k++) {
      const c = this.items[(this.next + k) % POOL]!;
      if (!c.active) {
        it = c;
        this.next = (this.next + k + 1) % POOL;
        break;
      }
      if (k === POOL - 1) this.next = (this.next + 1) % POOL;
    }
    let stack = 0;
    if (key) {
      const r = this.recent.get(key);
      if (r && nowMs - r.t < STACK_MS) {
        r.n = (r.n + 1) % 5;
        r.t = nowMs;
        stack = r.n;
      } else if (r) {
        r.n = 0;
        r.t = nowMs;
      } else {
        if (this.recent.size > 48) {
          for (const [k, v] of this.recent) if (nowMs - v.t > STACK_MS) this.recent.delete(k);
        }
        this.recent.set(key, { t: nowMs, n: 0 });
      }
    }
    if (!it.active) this.live++;
    it.active = true;
    it.x = x;
    it.y = y;
    it.z = z;
    it.start = nowMs;
    it.dur = DUR[style];
    it.jitter = (Math.random() - 0.5) * (style === "self" ? 18 : 30);
    it.stack = stack * STACK_PX;
    const base = style === "heavy" ? 1.9 : style === "self" || style === "spell" ? 1.45 : style === "other" ? 1.1 : 1.35;
    it.pop = base * (popMul > 0 ? popMul : 1);
    it.rise = style === "heavy" ? 58 : style === "other" ? 30 : 46;
    it.el.className = mark ? `dmg dmg-${style} ${mark}` : `dmg dmg-${style}`;
    it.el.textContent = text;
  }

  /** Move every live number (call once per rendered frame, after the camera is placed). */
  update(camera: THREE.Camera, w: number, h: number, nowMs: number) {
    if (this.live === 0) return;
    for (let i = 0; i < POOL; i++) {
      const it = this.items[i]!;
      if (!it.active) continue;
      const u = (nowMs - it.start) / it.dur;
      if (u >= 1 || u < 0) {
        it.active = false;
        this.live--;
        if (it.visible) {
          it.visible = false;
          it.el.style.opacity = "0";
        }
        continue;
      }
      _v.set(it.x, it.y, it.z).project(camera);
      if (_v.z > 1 || _v.z < -1) {
        if (it.visible) {
          it.visible = false;
          it.el.style.opacity = "0";
        }
        continue;
      }
      const sx = (_v.x * 0.5 + 0.5) * w + it.jitter;
      // ease-out rise; stacked numbers start higher
      const rise = (1 - (1 - u) * (1 - u)) * it.rise;
      const sy = (-_v.y * 0.5 + 0.5) * h - rise - it.stack;
      const pop = u < 0.12 ? it.pop + (1 - it.pop) * (u / 0.12) : 1;
      const a = u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45;
      it.el.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0) translate(-50%,-50%) scale(${pop.toFixed(3)})`;
      it.el.style.opacity = a.toFixed(3);
      it.visible = true;
    }
  }

  clear() {
    for (const it of this.items) {
      it.active = false;
      it.visible = false;
      it.el.style.opacity = "0";
    }
    this.live = 0;
    this.recent.clear();
  }
}

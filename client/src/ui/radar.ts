/**
 * D4-style minimap + screen-edge arrows toward the portal and nearest foes.
 * Planar (x, y) → canvas (x right, y down = world +z).
 */
import type { PerspectiveCamera } from "three";
import { Vector3 } from "three";

type Vec2 = { x: number; y: number };

const RANGE = 38;
const _ndc = new Vector3();

function cantoShort(id: string | undefined): string | null {
  if (id === "inferno_05") return "Lust";
  if (id === "inferno_06") return "Gluttony";
  if (id === "inferno_07") return "Avarice";
  if (id === "inferno_01") return "Wood";
  return null;
}

function destLabel(e: any): string {
  if (e?.kind === "exit" || e?.poiKind === "portal") {
    return cantoShort(e.toCanto) || e.label || "Portal";
  }
  if (e?.kind === "boss") return e.name || "Boss";
  if (e?.kind === "mob") return e.champion ? "Champion" : "Shade";
  if (e?.poiKind === "npc" || e?.kind === "poi") return e.label || e.name || "Guide";
  return e?.label || e?.name || "";
}

function destClass(toCanto: string | undefined): string {
  if (toCanto === "inferno_05") return "lust";
  if (toCanto === "inferno_06") return "gluttony";
  if (toCanto === "inferno_07") return "avarice";
  if (toCanto === "inferno_01") return "wood";
  return "wood";
}

export class Radar {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  hint: HTMLElement;
  compass: HTMLElement;
  arrows = new Map<string, HTMLElement>();
  private lastHint = "";

  constructor() {
    this.canvas = document.getElementById("minimap-canvas") as HTMLCanvasElement;
    this.hint = document.getElementById("minimap-hint") as HTMLElement;
    this.compass = document.getElementById("canto-compass") as HTMLElement;
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.id = "minimap-canvas";
      this.canvas.width = 256;
      this.canvas.height = 256;
    }
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("minimap canvas");
    this.ctx = ctx;
    if (!this.hint) {
      this.hint = document.createElement("div");
      this.hint.id = "minimap-hint";
    }
    if (!this.compass) {
      this.compass = document.createElement("div");
      this.compass.id = "canto-compass";
      document.body.appendChild(this.compass);
    }
  }

  tick(opts: {
    you: Vec2;
    aimX: number;
    aimY: number;
    bounds: { width: number; height: number };
    entities: any[];
    cantoId: string;
    camera: PerspectiveCamera;
    compact: boolean;
    firstClears?: string[];
  }) {
    this.drawMap(opts);
    this.drawArrows(opts);
    this.writeHint(opts);
  }

  private portalPreferred(entities: any[], cantoId: string, firstClears?: string[]): any | null {
    const portals = entities.filter((e) => e.kind === "exit" || e.poiKind === "portal");
    if (!portals.length) return null;
    const cleared = Array.isArray(firstClears) ? firstClears : [];
    const unlocked = (e: any) => !e.requireClear || cleared.includes(e.requireClear);
    // After Lust clear, prefer the Gluttony gate; after Gluttony clear, prefer Avarice
    if (cantoId === "inferno_05") {
      const glut = portals.find((e) => e.toCanto === "inferno_06" && unlocked(e));
      if (glut) return glut;
      const glutLocked = portals.find((e) => e.toCanto === "inferno_06");
      if (glutLocked) return glutLocked;
    }
    if (cantoId === "inferno_06") {
      const ava = portals.find((e) => e.toCanto === "inferno_07" && unlocked(e));
      if (ava) return ava;
      const avaLocked = portals.find((e) => e.toCanto === "inferno_07");
      if (avaLocked) return avaLocked;
      const lust = portals.find((e) => e.toCanto === "inferno_05");
      if (lust) return lust;
    }
    if (cantoId === "inferno_07") {
      const glut = portals.find((e) => e.toCanto === "inferno_06");
      if (glut) return glut;
    }
    return portals.find((e) => e.toCanto && e.toCanto !== "inferno_01") || portals[0];
  }

  private drawMap(opts: {
    you: Vec2;
    aimX: number;
    aimY: number;
    bounds: { width: number; height: number };
    entities: any[];
    cantoId: string;
    firstClears?: string[];
  }) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const scale = (w * 0.46) / RANGE;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0c0b08ee";
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c9a22799";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = "#6a5e3f44";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.32, 0, Math.PI * 2);
    ctx.stroke();

    const plot = (x: number, y: number) => ({
      px: cx + (x - opts.you.x) * scale,
      py: cy + (y - opts.you.y) * scale,
    });

    const ring = (px: number, py: number, r: number, fill: string, stroke?: string) => {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };

    ctx.fillStyle = "#3a342855";
    ctx.fillRect(
      cx - opts.you.x * scale,
      cy - opts.you.y * scale,
      opts.bounds.width * scale,
      opts.bounds.height * scale
    );

    for (const e of opts.entities) {
      const { px, py } = plot(e.x, e.y);
      const dx = px - cx;
      const dy = py - cy;
      const d = Math.hypot(dx, dy);
      const rim = w * 0.45;
      const on = d <= rim;
      const sx = on ? px : cx + (dx / d) * rim;
      const sy = on ? py : cy + (dy / d) * rim;

      if (e.kind === "exit" || e.poiKind === "portal") {
        const clears = opts.firstClears || [];
        const locked = Boolean(e.requireClear && !clears.includes(e.requireClear));
        const towardGlut = e.toCanto === "inferno_06";
        const towardAva = e.toCanto === "inferno_07";
        const fill = locked
          ? "#6a6048"
          : towardAva
            ? "#e8c86a"
            : towardGlut
              ? "#c8e070"
              : "#e8c86a";
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = fill;
        ctx.globalAlpha = locked ? 0.45 : 1;
        ctx.fillRect(-5, -5, 10, 10);
        ctx.restore();
        if (!on) this.rimChevron(ctx, sx, sy, fill);
      } else if (e.kind === "boss") {
        ring(sx, sy, on ? 6 : 5, "#d63a2a", "#ffc8b8");
      } else if (e.kind === "mob") {
        ring(sx, sy, e.champion ? 4.5 : 3.2, e.champion ? "#e8c86a" : "#c44a3a");
      } else if (e.kind === "loot") {
        ring(sx, sy, 2.4, "#f0d982");
      } else if (e.kind === "poi" || e.poiKind) {
        ring(sx, sy, 3.2, "#d9cfae", "#8a7030");
      }
    }

    const facing = Math.atan2(opts.aimX, -opts.aimY);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(facing);
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fillStyle = "#ffe8a0";
    ctx.strokeStyle = "#1a1408";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private rimChevron(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    const ang = Math.atan2(y - ctx.canvas.height * 0.5, x - ctx.canvas.width * 0.5);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang + Math.PI / 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 3);
    ctx.lineTo(-4, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawArrows(opts: {
    you: Vec2;
    entities: any[];
    camera: PerspectiveCamera;
    compact: boolean;
    cantoId?: string;
    firstClears?: string[];
  }) {
    const wanted: { id: string; dest: string; label: string; e: any }[] = [];
    const portal = this.portalPreferred(opts.entities, opts.cantoId || "", opts.firstClears);
    if (portal) {
      const clears = opts.firstClears || [];
      const locked = Boolean(portal.requireClear && !clears.includes(portal.requireClear));
      wanted.push({
        id: "portal",
        dest: locked ? "locked" : destClass(portal.toCanto),
        label: locked
          ? portal.requireClear === "inferno_05"
            ? "Clear Judge"
            : portal.requireClear === "inferno_06"
              ? "Clear Maw"
              : "Sealed"
          : destLabel(portal),
        e: portal,
      });
    }
    let bestFoe: any = null;
    let bestD = Infinity;
    for (const e of opts.entities) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      const d = Math.hypot(e.x - opts.you.x, e.y - opts.you.y);
      if (d < bestD) {
        bestD = d;
        bestFoe = e;
      }
    }
    if (bestFoe) {
      const bossDest =
        opts.cantoId === "inferno_07"
          ? "avarice"
          : opts.cantoId === "inferno_06"
            ? "gluttony"
            : bestFoe.kind === "boss"
              ? "lust"
              : "wood";
      wanted.push({
        id: "foe",
        dest:
          bestFoe.kind === "boss"
            ? bossDest
            : opts.cantoId === "inferno_07"
              ? "avarice"
              : opts.cantoId === "inferno_06"
                ? "gluttony"
                : "wood",
        label: destLabel(bestFoe),
        e: bestFoe,
      });
    }

    const seen = new Set<string>();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const padL = opts.compact ? 16 : 24;
    const padR = opts.compact ? 16 : 24;
    const padT = opts.compact ? 88 : 72;
    const padB = opts.compact ? 108 : 84;

    for (const w of wanted) {
      seen.add(w.id);
      const d = Math.hypot(w.e.x - opts.you.x, w.e.y - opts.you.y);
      const onScreen = this.projectEdge(opts.camera, w.e.x, w.e.y, vw, vh, padL, padT, padR, padB);
      let el = this.arrows.get(w.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "compass-arrow";
        el.innerHTML = `<i class="compass-chevron"></i><span class="compass-label"></span><span class="compass-dist"></span>`;
        this.compass.appendChild(el);
        this.arrows.set(w.id, el);
      }
      el.dataset.dest = w.dest;
      const lab = el.querySelector(".compass-label") as HTMLElement;
      const dist = el.querySelector(".compass-dist") as HTMLElement;
      lab.textContent = w.label;
      dist.textContent = `${Math.round(d)}m`;
      const hide = onScreen.inside && d < 14;
      el.style.opacity = hide ? "0" : "1";
      el.style.left = `${onScreen.x}px`;
      el.style.top = `${onScreen.y}px`;
      const chev = el.querySelector(".compass-chevron") as HTMLElement;
      chev.style.setProperty("--ang", `${onScreen.ang}deg`);
    }
    for (const [id, el] of this.arrows) {
      if (!seen.has(id)) {
        el.remove();
        this.arrows.delete(id);
      }
    }
  }

  private projectEdge(
    camera: PerspectiveCamera,
    x: number,
    y: number,
    vw: number,
    vh: number,
    padL: number,
    padT: number,
    padR: number,
    padB: number
  ): { x: number; y: number; ang: number; inside: boolean } {
    _ndc.set(x, 1.2, y).project(camera);
    let nx = _ndc.x;
    let ny = _ndc.y;
    if (_ndc.z > 1) {
      nx = -nx;
      ny = -ny;
    }
    const sx = (nx * 0.5 + 0.5) * vw;
    const sy = (-ny * 0.5 + 0.5) * vh;
    const inside =
      sx > padL && sx < vw - padR && sy > padT && sy < vh - padB && _ndc.z <= 1;
    const cx = vw * 0.5;
    const cy = vh * 0.5;
    let dx = sx - cx;
    let dy = sy - cy;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) dy = -1;
    const ang = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const left = padL;
    const right = vw - padR;
    const top = padT;
    const bot = vh - padB;
    const hw = (right - left) * 0.5;
    const hh = (bot - top) * 0.5;
    const px = dx / (hw || 1);
    const py = dy / (hh || 1);
    const m = Math.max(Math.abs(px), Math.abs(py), 1);
    return {
      x: cx + dx / m,
      y: cy + dy / m,
      ang,
      inside,
    };
  }

  private writeHint(opts: { you: Vec2; entities: any[]; cantoId: string; firstClears?: string[] }) {
    const portal = this.portalPreferred(opts.entities, opts.cantoId, opts.firstClears);
    const guide = opts.entities.find(
      (e) => e.poiKind === "npc" || (e.kind === "poi" && (e.label === "Guide" || e.name === "Guide"))
    );
    let foe: any = null;
    let foeD = Infinity;
    for (const e of opts.entities) {
      if (e.kind !== "mob" && e.kind !== "boss") continue;
      const d = Math.hypot(e.x - opts.you.x, e.y - opts.you.y);
      if (d < foeD) {
        foeD = d;
        foe = e;
      }
    }
    const clears = opts.firstClears || [];
    let text = "Explore the wood";
    if (opts.cantoId === "inferno_05" || opts.cantoId === "inferno_06" || opts.cantoId === "inferno_07") {
      const bossLabel =
        opts.cantoId === "inferno_07"
          ? "Slay Hoard Crush"
          : opts.cantoId === "inferno_06"
            ? "Slay the Triple Maw"
            : "Slay the Judge";
      const portalLocked = portal && portal.requireClear && !clears.includes(portal.requireClear);
      if (opts.cantoId === "inferno_07") {
        const heart = opts.entities.find(
          (e: any) => e.archetype === "hoard_heart" && (e.hp == null || e.hp > 0)
        );
        const cw = opts.entities.find(
          (e: any) => /^counterweight$/i.test(String(e.name || "")) && (e.hp == null || e.hp > 0)
        );
        const bell = opts.entities.find((e: any) => e.poiKind === "bell");
        const roadW = opts.entities.find(
          (e: any) => /^road weights$/i.test(String(e.name || "")) && (e.hp == null || e.hp > 0)
        );
        // Gluttony-portal approach: first weights before mid-lane
        if (
          roadW &&
          opts.you.x < 40 &&
          Math.hypot(roadW.x - opts.you.x, roadW.y - opts.you.y) < 18
        ) {
          text = "Weigh the road";
        } else if (opts.you.x < 42 && opts.you.y > 82) {
          const sw = opts.entities.find(
            (e: any) =>
              /^southwest spill$/i.test(String(e.name || "")) && (e.hp == null || e.hp > 0)
          );
          text = sw ? "Sweep Southwest Spill" : "Scorched SW flats";
        } else if (heart && Math.hypot(heart.x - opts.you.x, heart.y - opts.you.y) < 34) {
          text = "Break Hoard Heart";
        } else if (
          bell &&
          opts.you.x > 55 &&
          opts.you.x < 100 &&
          Math.hypot(bell.x - opts.you.x, bell.y - opts.you.y) < 22 &&
          !heart
        ) {
          text = "Ring Ledger Bell";
        } else if (cw && Math.hypot(cw.x - opts.you.x, cw.y - opts.you.y) < 22) {
          text = "Tip Counterweight";
        } else if (foe && foe.kind === "boss" && opts.you.x > 108) {
          text = bossLabel;
        } else if (foe) text = foe.kind === "boss" ? bossLabel : `Hunt ${destLabel(foe)}`;
        else if (clears.includes("inferno_07") && portal) {
          text = `Return — ${cantoShort(portal.toCanto) || "Gluttony"} (bank weighed drops)`;
        } else if (portal) text = `Travel — ${cantoShort(portal.toCanto) || "portal"}`;
      } else if (foe) text = foe.kind === "boss" ? bossLabel : `Hunt ${destLabel(foe)}`;
      else if (portal && portalLocked) {
        text =
          portal.requireClear === "inferno_06"
            ? "Clear Triple Maw — then Avarice opens"
            : "Clear the Judge — then Gluttony opens";
      } else if (portal) {
        const dest = cantoShort(portal.toCanto) || "portal";
        text = `Travel — ${dest}`;
      }
    } else if (foe && foeD < 28) {
      text = `Hunt ${destLabel(foe)}`;
    } else if (clears.includes("inferno_07")) {
      const stash = opts.entities.find((e: any) => e.poiKind === "stash");
      if (guide) {
        const gd = Math.hypot(guide.x - opts.you.x, guide.y - opts.you.y);
        text = gd < 10 ? "Guide — counsel after Avarice" : "Speak with the Guide (Avarice is clear)";
      } else if (stash) {
        text = "Bank weighed drops at the stash";
      } else if (portal) {
        const dest = cantoShort(portal.toCanto) || "Lust";
        text = `Hunt again — ${dest}`;
      } else text = "Avarice is clear — writ, stash, or hunt again";
    } else if (portal) {
      const d = Math.hypot(portal.x - opts.you.x, portal.y - opts.you.y);
      const dest = cantoShort(portal.toCanto) || "Lust";
      text = d < 8 ? `Hold E — enter ${dest}` : `Follow the gold arrow to ${dest}`;
    } else if (guide) {
      text = "Speak with the Guide";
    }
    if (text !== this.lastHint) {
      this.lastHint = text;
      this.hint.textContent = text;
    }
  }
}

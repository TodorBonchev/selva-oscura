/**
 * D4-style minimap + screen-edge arrows toward the portal and nearest foes.
 * Planar (x, y) → canvas (x right, y down = world +z).
 */
import type { PerspectiveCamera } from "three";
import { Vector3 } from "three";

type Vec2 = { x: number; y: number };

const RANGE = 38;
/** Avarice gold road is long — pull camera out so Crush/CW/hub gate fit. */
const RANGE_AVA = 48;
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
  if (e?.kind === "mob") {
    if (/^counterweight$/i.test(String(e.name || ""))) return "Counterweight";
    return e.champion ? "Champion" : "Shade";
  }
  if (e?.poiKind === "npc" || e?.kind === "poi") return e.label || e.name || "Guide";
  return e?.label || e?.name || "";
}

/** Avarice measure lane: prefer Counterweight, then Crush — wardens must not steal the arrow. */
function pickAvaMeasureFoe(you: Vec2, entities: any[]): any | null {
  const cw = entities.find(
    (e: any) => /^counterweight$/i.test(String(e.name || "")) && (e.hp == null || e.hp > 0)
  );
  const crush = entities.find((e: any) => e.kind === "boss" && (e.hp == null || e.hp > 0));
  if (cw) {
    const d = Math.hypot(cw.x - you.x, cw.y - you.y);
    if (d < 52) return cw;
  }
  if (crush) {
    const d = Math.hypot(crush.x - you.x, crush.y - you.y);
    // After CW tips (or already on the dais band), lock compass onto Crush
    if (!cw && (you.x > 100 || d < 42)) return crush;
  }
  return null;
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
  /** Avarice: remember Counterweight so we can hand the compass to Crush once. */
  private avaSawCw = false;
  private avaHandoffUntil = 0;

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
    bellCd?: number;
    dailyWritOpen?: boolean;
    spokeToGuide?: boolean;
  }) {
    if (opts.cantoId !== "inferno_07") {
      this.avaSawCw = false;
      this.avaHandoffUntil = 0;
    }
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
    const range = opts.cantoId === "inferno_07" ? RANGE_AVA : RANGE;
    const scale = (w * 0.46) / range;

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

    // Avarice gold road tint — measure lane readable on the map
    if (opts.cantoId === "inferno_07") {
      const road: [number, number][] = [
        [18, 52], [28, 50], [38, 56], [54, 68], [70, 48], [86, 58], [110, 52], [138, 48],
      ];
      ctx.save();
      ctx.strokeStyle = "#d4a84066";
      ctx.lineWidth = Math.max(2.5, 5.5 * scale * 0.22);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i < road.length; i++) {
        const { px, py } = plot(road[i][0], road[i][1]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.strokeStyle = "#f2dea033";
      ctx.lineWidth = Math.max(1.2, 2.4 * scale * 0.22);
      ctx.stroke();
      ctx.restore();
    }

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
        const pk = String(e.poiKind || "");
        if (opts.cantoId === "inferno_07" && (pk === "bell" || pk === "cache" || pk === "shrine" || pk === "marker")) {
          ctx.save();
          ctx.translate(sx, sy);
          if (pk === "bell") {
            // ledger bell — upright diamond
            ctx.rotate(Math.PI / 4);
            ctx.fillStyle = "#e8c86a";
            ctx.fillRect(-3.2, -3.2, 6.4, 6.4);
            ctx.strokeStyle = "#1a1408";
            ctx.lineWidth = 1;
            ctx.strokeRect(-3.2, -3.2, 6.4, 6.4);
          } else if (pk === "cache") {
            // chest — square with gold lid tick
            ctx.fillStyle = "#c9a227";
            ctx.fillRect(-3.5, -3, 7, 6);
            ctx.fillStyle = "#f2dea0";
            ctx.fillRect(-3.5, -3, 7, 2);
            ctx.strokeStyle = "#1a1408";
            ctx.strokeRect(-3.5, -3, 7, 6);
          } else if (pk === "shrine") {
            // shrine — small cross / balance
            ctx.strokeStyle = "#f2dea0";
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(0, -4.5);
            ctx.lineTo(0, 4.5);
            ctx.moveTo(-3.5, -1);
            ctx.lineTo(3.5, -1);
            ctx.stroke();
            ring(0, 0, 1.4, "#d4a84088");
          } else {
            // marker stone — tall tick
            ctx.fillStyle = "#d9cfae";
            ctx.fillRect(-1.4, -4.5, 2.8, 9);
            ctx.fillStyle = "#c9a227";
            ctx.fillRect(-2.2, -4.5, 4.4, 2);
          }
          ctx.restore();
          if (!on) this.rimChevron(ctx, sx, sy, "#e8c86a");
        } else {
          ring(sx, sy, 3.2, "#d9cfae", "#8a7030");
        }
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
    bellCd?: number;
    dailyWritOpen?: boolean;
    spokeToGuide?: boolean;
  }) {
    const wanted: { id: string; dest: string; label: string; e: any }[] = [];
    const portal = this.portalPreferred(opts.entities, opts.cantoId || "", opts.firstClears);
    const guideEnt = opts.entities.find(
      (e: any) => e.poiKind === "npc" || (e.kind === "poi" && (e.label === "Guide" || e.name === "Guide"))
    );
    // Hub: daily writ path → Guide chevron (beats portal spam when writ is open)
    const hubWrit =
      (opts.cantoId === "inferno_01" || !opts.cantoId) &&
      opts.dailyWritOpen &&
      guideEnt &&
      (opts.spokeToGuide || opts.dailyWritOpen);
    if (hubWrit && guideEnt) {
      wanted.push({
        id: "guide",
        dest: "wood",
        label: "Daily writ",
        e: guideEnt,
      });
    }
    if (portal && !hubWrit) {
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
    // Avarice: Counterweight → Crush handoff beats nearest warden/pack
    if (opts.cantoId === "inferno_07") {
      const measure = pickAvaMeasureFoe(opts.you, opts.entities);
      if (measure) {
        bestFoe = measure;
        bestD = Math.hypot(measure.x - opts.you.x, measure.y - opts.you.y);
      }
    }
    const clears = opts.firstClears || [];
    const avaCleared = opts.cantoId === "inferno_07" && clears.includes("inferno_07");
    // After Crush: compass is return/bank only — skip foe spam in the gold haze
    if (bestFoe && !avaCleared) {
      const bossDest =
        opts.cantoId === "inferno_07"
          ? "avarice"
          : opts.cantoId === "inferno_06"
            ? "gluttony"
            : bestFoe.kind === "boss"
              ? "lust"
              : "wood";
      // Avarice: hide common weight arrows when a portal is already guiding
      const skipCommonWeight =
        opts.cantoId === "inferno_07" &&
        portal &&
        bestFoe.kind !== "boss" &&
        !bestFoe.champion &&
        bestD > 22;
      if (!skipCommonWeight) {
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
      const distTxt = `${Math.round(d)}m`;
      if (lab.textContent !== w.label) lab.textContent = w.label;
      if (dist.textContent !== distTxt) dist.textContent = distTxt;
      const hideNear = opts.cantoId === "inferno_07" ? 18 : 14;
      const hide = onScreen.inside && d < hideNear;
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

  private writeHint(opts: {
    you: Vec2;
    entities: any[];
    cantoId: string;
    firstClears?: string[];
    bellCd?: number;
    dailyWritOpen?: boolean;
    spokeToGuide?: boolean;
  }) {
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
          // Bell quiet: point the measure onward (CW/Crush) — daily writ waits with the Guide
          if ((opts.bellCd || 0) > 0.4) {
            if (cw) text = "Bell quiet — Tip Counterweight";
            else if (opts.entities.some((e: any) => e.kind === "boss" && (e.hp == null || e.hp > 0)))
              text = "Bell quiet — Press Hoard Crush";
            else if (opts.dailyWritOpen)
              text = "Bell quiet — Guide for daily writ (Dark Wood)";
            else text = "Bell quiet — measure holds";
          } else {
            text = "Ring Ledger Bell";
          }
        } else if (cw && Math.hypot(cw.x - opts.you.x, cw.y - opts.you.y) < 28) {
          this.avaSawCw = true;
          text = "Tip Counterweight";
        } else if (
          !cw &&
          opts.entities.some((e: any) => e.kind === "boss" && (e.hp == null || e.hp > 0)) &&
          (opts.you.x > 100 || this.avaSawCw)
        ) {
          const crush = opts.entities.find(
            (e: any) => e.kind === "boss" && (e.hp == null || e.hp > 0)
          );
          const now = performance.now();
          if (this.avaSawCw && this.avaHandoffUntil === 0) this.avaHandoffUntil = now + 4200;
          if (this.avaHandoffUntil > now) text = "The measure tips — Crush";
          else text = bossLabel;
          // Keep compass target as Crush even if a warden is nearer
          if (crush) {
            foe = crush;
            foeD = Math.hypot(crush.x - opts.you.x, crush.y - opts.you.y);
          }
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
      if (opts.dailyWritOpen && guide) {
        const gd = Math.hypot(guide.x - opts.you.x, guide.y - opts.you.y);
        text =
          gd < 10
            ? "Guide — claim the daily writ"
            : "Daily writ — follow the Guide (Avarice is clear)";
      } else if (guide) {
        const gd = Math.hypot(guide.x - opts.you.x, guide.y - opts.you.y);
        text = gd < 10 ? "Guide — counsel after Avarice" : "Speak with the Guide (Avarice is clear)";
      } else if (stash) {
        text = "Bank weighed drops at the stash";
      } else if (portal) {
        const dest = cantoShort(portal.toCanto) || "Lust";
        text = `Hunt again — ${dest}`;
      } else text = "Avarice is clear — writ, stash, or hunt again";
    } else if (opts.dailyWritOpen && guide) {
      const gd = Math.hypot(guide.x - opts.you.x, guide.y - opts.you.y);
      text = gd < 10 ? "Guide — claim the daily writ" : "Daily writ — speak with the Guide";
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

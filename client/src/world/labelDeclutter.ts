/**
 * Nameplate declutter (≈10 Hz, screen space). A pack that engages you used to put a
 * full name + HP plate over every foe ~2 u above its feet: on a phone the plates
 * overprinted each other and sat on the hero (31 px tall in landscape).
 *
 *   - Trash foes wear only their HP bar on phones (the bottom target plate names the
 *     foe you fight); on desktop one name per pack (its member nearest you).
 *   - Plates are ranked target / hovered > boss > elite / mid-boss / ally > trash (nearer first);
 *     a plate whose rect overlaps an already placed one by more than OVERLAP of the
 *     smaller is hidden (bosses and the target never are).
 *   - A foe's plate (not a boss's) over the hero's projected body fades to a ghost.
 *   - A boss plate projected into the top HUD band is pinned just under it, and kept
 *     on screen sideways clear of the phone's minimap column (margins: bosses carry no
 *     other plate offset).
 *   - No world label (foe plate, POI / gate / loot name) ever draws over the HUD: the
 *     vitals and objective bands, the minimap, the stick, the action buttons, the
 *     target plate, toasts, callouts and the Guide's dialogue — nor over the arrival
 *     title card while it shows. One that would is hidden until it clears (HUD rects re-read ~4 Hz).
 *
 * Plate sizes are estimated from the CSS (styles.css .world-label.foe …) instead of
 * measured: no layout reads. Class toggles only on change; no per-pass allocation
 * beyond the pooled item array.
 */
import * as THREE from "three";
import type { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const EVERY_MS = 100;
/** Overlap (share of the smaller rect) past which the lower-ranked plate hides. */
const OVERLAP = 0.25;
/** Share of a trash plate over the hero's body past which it fades. */
const HERO_COVER = 0.2;
/** How tall the hero stands (world units, with the hero group's scale). */
const HERO_H = 2.5;
/** Phones: width (px) of the minimap / Inv column a boss plate keeps clear of. */
const RIGHT_COL = 118;
/** Re-read the HUD rects this often (ms): the quest line, toasts and title card move. */
const HUD_EVERY_MS = 250;
/**
 * HUD a world label must never draw over (each visible match is one keep-out rect,
 * padded by KEEP_PAD). The arrival title card counts from the moment it shows (.cc-show)
 * until its fade-out has all but ended.
 */
const KEEP_OUT = [
  "#hud-top",
  "#quest-track",
  "#minimap",
  "#minimap-hint",
  "#lust-wind",
  "#action-bar .action-btn",
  "#virtual-joystick .vj-base",
  "#target-plate",
  "#portal-hold-prompt",
  "#dodge-callout",
  "#toast",
  "#bar-tip",
  "#canto-card",
  "#dialogue",
].join(",");
const KEEP_PAD = 4;
/** Share of a label's box over a keep-out rect past which it hides. */
const KEEP_OVER = 0.04;

export type PlateRec = {
  id: string;
  kind: string;
  group: THREE.Group;
  label: CSS2DObject;
  hpEl: HTMLElement;
  nameEl: HTMLElement;
  /** declutter state: this pass's verdict, and what the DOM shows (written on change) */
  dcCull?: boolean;
  dcCullShown?: boolean;
  dcFade?: boolean;
  dcNoName?: boolean;
  dcShift?: number;
  dcShiftX?: number;
  /** a POI / gate / loot label: measured box, cached per text + class (no per-pass layout read) */
  dcKey?: string;
  dcW?: number;
  dcH?: number;
};

type Item = {
  rec: PlateRec;
  x: number;
  y: number;
  w: number;
  h: number;
  pri: number;
  d: number;
  trash: boolean;
  boss: boolean;
};

export type DeclutterHost = {
  camera: THREE.PerspectiveCamera;
  nodes: Map<string, PlateRec>;
  youGroup: THREE.Group | null;
  renderYou: { x: number; y: number };
  viewW: number;
  viewH: number;
  /** foe the bottom target plate shows (nearest / locked) */
  plateTargetId: string | null;
  lockedId: string | null;
};

const _v = new THREE.Vector3();
const FOE_KINDS = new Set(["whirl", "champion", "judge", "triple_maw", "hoard_crush"]);
const BOSS_KINDS = new Set(["judge", "triple_maw", "hoard_crush"]);

/** A foe plate (ally plates never fade: they are few and far above their heads). */
function rec0(it: Item): boolean {
  return it.rec.kind !== "player";
}

function inter(ax0: number, ay0: number, ax1: number, ay1: number, bx0: number, by0: number, bx1: number, by1: number) {
  const w = Math.min(ax1, bx1) - Math.max(ax0, bx0);
  const h = Math.min(ay1, by1) - Math.max(ay0, by0);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Drawn at all: in the layout, not hidden, not faded out (its own opacity × its
 * ancestors'). A title card / toast counts from the moment it is shown (its class), not
 * once its fade-in has got far enough.
 */
function drawn(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) return false;
  const showing = el.classList.contains("cc-show") || el.classList.contains("toast-show");
  let op = 1;
  for (let e: HTMLElement | null = showing ? el.parentElement : el; e && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    op *= Number(cs.opacity);
    if (op < 0.05) return false;
  }
  return true;
}

export class LabelDeclutter {
  private lastAt = 0;
  private hudAt = -1e9;
  private hudBottom = 0;
  private pool: Item[] = [];
  private items: Item[] = [];
  private others: PlateRec[] = [];
  private packNear = new Map<string, Item>();
  /** keep-out rects, flat [x0, y0, x1, y1, …] (client px) */
  private keep: number[] = [];

  /** Does the box overlap the HUD (any keep-out rect) by more than KEEP_OVER of itself? */
  overHud(x0: number, y0: number, x1: number, y1: number): boolean {
    const k = this.keep;
    const a = Math.max(1, (x1 - x0) * (y1 - y0)) * KEEP_OVER;
    for (let i = 0; i < k.length; i += 4) {
      if (inter(x0, y0, x1, y1, k[i]!, k[i + 1]!, k[i + 2]!, k[i + 3]!) > a) return true;
    }
    return false;
  }

  /** Once per frame after the entity sync; does its work at ~10 Hz. */
  tick(host: DeclutterHost, compact: boolean, now: number) {
    if (now - this.lastAt < EVERY_MS) return;
    this.lastAt = now;
    const vw = host.viewW || window.innerWidth;
    const vh = host.viewH || window.innerHeight;
    if (now - this.hudAt > HUD_EVERY_MS) {
      this.hudAt = now;
      this.hudBottom = this.measureHud();
    }
    const cam = host.camera;
    const items = this.items;
    items.length = 0;
    const others = this.others;
    others.length = 0;
    let n = 0;
    const you = host.renderYou;
    for (const rec of host.nodes.values()) {
      const foe = FOE_KINDS.has(rec.kind);
      const ally = rec.kind === "player";
      if (!foe && !ally) {
        // (placed after the plates: a foe's plate wins over a POI's name)
        others.push(rec);
        continue;
      }
      if (!rec.label.visible || rec.hpEl.style.opacity === "0") {
        this.apply(rec, false, false, rec.dcNoName ?? false, 0);
        continue;
      }
      const g = rec.group;
      _v.set(g.position.x, g.position.y + rec.label.position.y * g.scale.y, g.position.z).project(cam);
      if (_v.z > 1 || _v.x < -1.2 || _v.x > 1.2 || _v.y < -1.2 || _v.y > 1.2) continue;
      const it = this.pool[n] || (this.pool[n] = {} as Item);
      n++;
      const boss = BOSS_KINDS.has(rec.kind);
      const cls = rec.hpEl.classList;
      const elite = cls.contains("elite") || cls.contains("midboss");
      const id = rec.id;
      const target = id === host.plateTargetId || id === host.lockedId || cls.contains("is-hover");
      it.rec = rec;
      it.x = (_v.x * 0.5 + 0.5) * vw;
      it.y = (-_v.y * 0.5 + 0.5) * vh + (rec.hpEl.style.marginTop && g.userData.lustPlate ? -17 : 0);
      it.boss = boss;
      it.trash = foe && !boss && !elite;
      it.pri = target ? 4 : boss ? 3 : elite || ally ? 2 : 1;
      const gx = g.position.x - you.x;
      const gz = g.position.z - you.y;
      it.d = gx * gx + gz * gz;
      // Estimated plate box (bottom-centre anchored): name line + HP bar
      const name = rec.nameEl.textContent || "";
      const font = boss ? 15 : 13;
      const barW = boss ? 128 : elite ? 92 : ally ? 48 : compact ? 56 : 78;
      const barH = boss ? 12 : ally ? 7 : compact && !elite ? 9 : 10;
      it.w = Math.max(barW, name.length * font * 0.58);
      it.h = barH + (name ? font * 1.3 : 0);
      items.push(it);
    }
    // Names: phones show none on trash (the target plate names your foe); desktop one per pack
    const packNear = this.packNear;
    packNear.clear();
    if (!compact) {
      for (const it of items) {
        if (!it.trash) continue;
        const pk = String((it.rec.group.userData.packId as string | undefined) ?? it.rec.id);
        const cur = packNear.get(pk);
        if (!cur || it.pri > cur.pri || (it.pri === cur.pri && it.d < cur.d)) packNear.set(pk, it);
      }
    }
    items.sort((a, b) => b.pri - a.pri || a.d - b.d);
    // Hero body box
    let hx0 = 0;
    let hy0 = 0;
    let hx1 = -1;
    let hy1 = -1;
    const yg = host.youGroup;
    if (yg) {
      _v.set(yg.position.x, yg.position.y, yg.position.z).project(cam);
      const fx = (_v.x * 0.5 + 0.5) * vw;
      const fy = (-_v.y * 0.5 + 0.5) * vh;
      _v.set(yg.position.x, yg.position.y + HERO_H, yg.position.z).project(cam);
      const ty = (-_v.y * 0.5 + 0.5) * vh;
      const half = Math.max(12, (fy - ty) * 0.32);
      hx0 = fx - half;
      hx1 = fx + half;
      hy0 = ty;
      hy1 = fy;
    }
    const heroA = Math.max(1, (hx1 - hx0) * (hy1 - hy0));
    const hudB = this.hudBottom;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const noName = it.trash && (compact || packNear.get(String((it.rec.group.userData.packId as string | undefined) ?? it.rec.id)) !== it);
      if (noName) it.h -= 13 * 1.3;
      // Bosses: never under the top HUD band — pinned just below it
      let shift = 0;
      let shiftX = 0;
      if (it.boss) {
        const top = it.y - it.h;
        if (hudB > 0 && top < hudB + 6) shift = Math.min(vh * 0.4, hudB + 6 - top);
        it.y += shift;
        // …and kept on screen sideways, clear of the phone's minimap / Inv column
        const right = vw - 6 - (compact && it.y - it.h < vh * 0.55 ? RIGHT_COL : 0);
        if (it.x + it.w / 2 > right) shiftX = right - (it.x + it.w / 2);
        else if (it.x - it.w / 2 < 6) shiftX = 6 - (it.x - it.w / 2);
        it.x += shiftX;
      }
      const x0 = it.x - it.w / 2;
      const x1 = it.x + it.w / 2;
      const y0 = it.y - it.h;
      const y1 = it.y;
      const a = it.w * it.h;
      let cull = false;
      if (it.pri < 3) {
        for (let j = 0; j < i; j++) {
          const o = items[j]!;
          if (o.rec.dcCull) continue;
          const ov = inter(x0, y0, x1, y1, o.x - o.w / 2, o.y - o.h, o.x + o.w / 2, o.y);
          if (ov > OVERLAP * Math.min(a, o.w * o.h)) {
            cull = true;
            break;
          }
        }
      }
      // never over the HUD (a boss's too: the target plate carries its life meanwhile)
      if (!cull && this.overHud(x0, y0, x1, y1)) cull = true;
      // (any foe's plate but a boss's: the bottom target plate still names your foe)
      const fade = !cull && !it.boss && rec0(it) && inter(x0, y0, x1, y1, hx0, hy0, hx1, hy1) > HERO_COVER * Math.min(a, heroA);
      // (a culled plate must not block the ones ranked below it: mark before the next)
      it.rec.dcCull = cull;
      this.apply(it.rec, cull, fade, noName, shift, shiftX);
    }
    for (const rec of others) this.placeOther(host, rec, vw, vh, items);
  }

  /**
   * Any other labelled node (POI, gate, loot, NPC): hidden while its label would sit on
   * the HUD or under the title card. Its box is measured once per text / class change.
   */
  private placeOther(host: DeclutterHost, rec: PlateRec, vw: number, vh: number, plates: Item[]) {
    const el = rec.hpEl;
    if (!rec.label.visible || el.style.display === "none" || !rec.group.visible) {
      if (rec.dcCullShown) this.apply(rec, false, rec.dcFade ?? false, rec.dcNoName ?? false, rec.dcShift ?? 0, rec.dcShiftX ?? 0);
      return;
    }
    const key = `${el.textContent}|${el.className.replace(/\bwl-\S+/g, "")}|${el.style.marginTop}`;
    if (rec.dcKey !== key) {
      rec.dcW = el.offsetWidth;
      rec.dcH = el.offsetHeight;
      // (not laid out yet — first frame, or its text is still coming: measure again next pass)
      if (rec.dcW > 0) rec.dcKey = key;
    }
    const g = rec.group;
    const L = rec.label;
    _v.set(g.position.x, g.position.y + L.position.y * g.scale.y, g.position.z).project(host.camera);
    let cull = false;
    if (_v.z <= 1 && _v.x > -1.3 && _v.x < 1.3 && _v.y > -1.3 && _v.y < 1.3 && (rec.dcW || 0) > 0) {
      const w = rec.dcW || 0;
      const h = rec.dcH || 0;
      // (CSS2DObject.center: the label's anchor inside its own box)
      const x0 = (_v.x * 0.5 + 0.5) * vw - w * L.center.x;
      const y0 = (-_v.y * 0.5 + 0.5) * vh - h * L.center.y;
      cull = this.overHud(x0, y0, x0 + w, y0 + h);
      // …or under a foe's plate shown there (a name can wait; a foe's life cannot)
      for (let i = 0; i < plates.length && !cull; i++) {
        const o = plates[i]!;
        if (o.rec.dcCull || o.rec.kind === "player") continue;
        const oa = o.w * o.h;
        if (inter(x0, y0, x0 + w, y0 + h, o.x - o.w / 2, o.y - o.h, o.x + o.w / 2, o.y) > OVERLAP * Math.min(w * h, oa)) cull = true;
      }
    }
    if ((rec.dcCullShown ?? false) !== cull) {
      rec.dcCullShown = cull;
      el.classList.toggle("wl-cull", cull);
    }
  }

  /** Bottom (px) of the top HUD band (vitals strip and the objective line); refreshes the keep-out rects. */
  private measureHud(): number {
    let b = 0;
    for (const id of ["hud-top", "quest-track"]) {
      const el = document.getElementById(id);
      if (!el || el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      // (portrait stacks the objective lower; only the top band counts)
      if (r.height > 0 && r.top < window.innerHeight * 0.3) b = Math.max(b, r.bottom);
    }
    const k = this.keep;
    k.length = 0;
    const els = document.querySelectorAll<HTMLElement>(KEEP_OUT);
    for (let i = 0; i < els.length; i++) {
      const el = els[i]!;
      if (!drawn(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      k.push(r.left - KEEP_PAD, r.top - KEEP_PAD, r.right + KEEP_PAD, r.bottom + KEEP_PAD);
    }
    return b;
  }

  private apply(rec: PlateRec, cull: boolean, fade: boolean, noName: boolean, shift: number, shiftX = 0) {
    const cls = rec.hpEl.classList;
    if ((rec.dcCullShown ?? false) !== cull) {
      rec.dcCullShown = cull;
      cls.toggle("wl-cull", cull);
    }
    if ((rec.dcFade ?? false) !== fade) {
      rec.dcFade = fade;
      cls.toggle("wl-fade", fade);
    }
    if ((rec.dcNoName ?? false) !== noName) {
      rec.dcNoName = noName;
      cls.toggle("wl-noname", noName);
    }
    const s = Math.round(shift);
    if ((rec.dcShift ?? 0) !== s) {
      rec.dcShift = s;
      // (plates are bottom-anchored: a top margin moves the whole plate down)
      rec.hpEl.style.marginTop = s > 0 ? `${s}px` : "";
    }
    const sx = Math.round(shiftX);
    if ((rec.dcShiftX ?? 0) !== sx) {
      rec.dcShiftX = sx;
      rec.hpEl.style.marginLeft = sx !== 0 ? `${sx}px` : "";
    }
  }
}

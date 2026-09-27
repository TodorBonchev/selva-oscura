/**
 * Combat presentation that isn't the hero: server telegraphs on the ground and the
 * attacker's windup pose, mob flinches with a hit flash, your own swing's predicted
 * contact (spark + hit-stop on the blade's frame, reconciled with the server's number),
 * death collapses with an ash burst, and the pooled combat numbers.
 *
 * WorldApp keeps the camera, HUD and canto flavour; it forwards messages here and calls
 * tick() once per rendered frame. Everything is pooled — nothing is created per hit.
 */
import * as THREE from "three";
import type { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { InterpStore, Vec2 } from "../render/smoothing";
import { AshBurstPool, HitFlashPool } from "./combatFx";
import { TelegraphRenderer, telePalette, visibleWindupMs, type TelegraphLand, type TelegraphMsg } from "./telegraphs";
import { DartPaths } from "./dartPaths";
import {
  mobAttack,
  mobAttackCancel,
  mobDeath,
  mobFlinch,
  rigMob,
  tickMob,
  tickMobDeath,
  type MobFamily,
  type MobState,
} from "./mobAnim";
import { DamageNumbers, type DmgStyle } from "../ui/damageNumbers";
import type { KindKey } from "./meshes";

/** The slice of WorldApp's node record this module touches. */
export type CombatNode = {
  id: string;
  kind: KindKey;
  group: THREE.Group;
  label: CSS2DObject;
};

export interface CombatHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  root: HTMLElement;
  interp: InterpStore;
  renderYou: Vec2;
  nodes: Map<string, CombatNode>;
  standY(x: number, y: number, lift?: number): number;
  /** Top of what is drawn at a planar point (floor triangles / boss dais). */
  surfaceY(x: number, y: number): number;
  cantoId(): string | undefined;
  /** Map bounds (dart ends clamp to them like the server's). */
  bounds(): { width: number; height: number } | null;
  /** Measured round trip to the server (ms; 0 = unknown). */
  rttMs(): number;
  /** Free a node's GPU resources + label (after its death collapse). */
  disposeNode(rec: CombatNode): void;
  /** A telegraph finished filling (the blow lands): slam shock / sting cues. */
  onTelegraphLand(l: TelegraphLand): void;
}

/** A predicted blade contact of ours waiting for the server's combat message. */
type Predicted = { id: string; at: number };

/**
 * How the server's combat message for one of our melee blows relates to the swing we
 * already played: the predicted primary target (number only), another foe the same
 * swing cleaved (its own spark + flinch, but no second hit-stop / shake / haptic), or
 * unrelated (full feedback).
 */
export type SwingMatch = "primary" | "cleave" | "none";

const PREDICT_WINDOW_MS = 600;
const MOB_KINDS = new Set<KindKey>(["whirl", "champion", "judge", "triple_maw", "hoard_crush"]);

/** Pose family for a spawned foe (drives its attack / death flavour). */
export function mobFamily(kind: KindKey, e: { archetype?: string; name?: string }): MobFamily {
  const a = String(e.archetype || "");
  if (kind === "judge") return "judge";
  if (kind === "triple_maw") return "maw";
  if (kind === "hoard_crush") return "crush";
  if (a.endsWith("_heart")) return "heart";
  if (a === "gale_wisp" || a === "mud_wisp" || a === "coin_wisp") return "wisp";
  if (/^(cerbero|counterweight)$/i.test(String(e.name || ""))) return "brute";
  if (kind === "champion") return "champion";
  return "shade";
}

export function isMobKind(kind: KindKey): boolean {
  return MOB_KINDS.has(kind);
}

const _vel: Vec2 = { x: 0, y: 0 };

export class CombatView {
  readonly tele: TelegraphRenderer;
  readonly flashes = new HitFlashPool();
  readonly ash = new AshBurstPool();
  readonly numbers: DamageNumbers;
  readonly darts = new DartPaths();
  private dying: CombatNode[] = [];
  private predicted: Predicted[] = [];
  /** performance.now() of our last predicted blade contact */
  private lastSwingAt = -1e9;

  constructor(private host: CombatHost) {
    this.tele = new TelegraphRenderer((x, y) => host.surfaceY(x, y));
    host.scene.add(this.tele.group, this.flashes.group, this.ash.group);
    this.numbers = new DamageNumbers(host.root);
  }

  /** A foe leaves without a death collapse (pruned / travel): take back its flash shell. */
  release(group: THREE.Object3D) {
    this.flashes.release(group);
  }

  /** Rig a freshly spawned foe for posing (before its label is attached). */
  rig(group: THREE.Group, kind: KindKey, e: { archetype?: string; name?: string }) {
    if (!MOB_KINDS.has(kind)) return;
    rigMob(group, mobFamily(kind, e));
  }

  // ——— telegraphs ————————————————————————————————————————————————

  onTelegraph(m: TelegraphMsg, nowMs: number) {
    const kind = String(m.kind || "");
    // the fill, the attacker's strike pose and a dart all land on the same (visible) beat
    const vis = visibleWindupMs(Number(m.duration) || 500, this.host.rttMs());
    this.tele.start(m, nowMs, telePalette(this.host.cantoId(), kind), vis);
    if (!m.attackerId) return;
    const att = String(m.attackerId);
    if (this.teleOwner.size > 64) this.teleOwner.clear();
    this.teleOwner.set(att, String(m.id));
    const st = this.host.nodes.get(att)?.group.userData.mob as MobState | undefined;
    if (st) mobAttack(st, kind, Number(m.dir) || 0, vis, nowMs);
    if (kind === "wisp_dart" && m.shape === "line") {
      this.darts.start(
        att,
        String(m.id),
        Number(m.x) || 0,
        Number(m.y) || 0,
        Number(m.dir) || 0,
        Number(m.length) || 3,
        vis,
        nowMs,
        this.host.bounds(),
        this.host.interp.delay
      );
    }
  }

  /** Per frame right after interp.update(): darting wisps follow their telegraph. */
  applyMotion(nowMs: number) {
    this.darts.apply(this.host.interp, nowMs);
  }

  /** The server broke a windup (poise / finisher / bell / death): fade it, reel the owner. */
  onTelegraphCancel(id: string, nowMs: number) {
    for (const [att, tid] of this.teleOwner) {
      if (tid !== id) continue;
      this.teleOwner.delete(att);
      const st = this.host.nodes.get(att)?.group.userData.mob as MobState | undefined;
      if (st) mobAttackCancel(st, nowMs);
      break;
    }
    this.tele.cancel(id, nowMs);
    this.darts.cancel(id, nowMs);
  }

  /** attacker id → its live telegraph id */
  private teleOwner = new Map<string, string>();

  // ——— hits ——————————————————————————————————————————————————————

  /** A blow landed on a foe: flinch away from the hitter + a brief white flash. */
  hitMob(rec: CombatNode, fromX: number, fromY: number, heavy: boolean, nowMs: number) {
    const st = rec.group.userData.mob as MobState | undefined;
    if (!st || st.dying) return;
    mobFlinch(st, fromX - rec.group.position.x, fromY - rec.group.position.z, heavy ? 1.7 : 1, nowMs);
    if (st.flashMesh) this.flashes.flash(st.flashMesh, heavy ? 0xffc890 : 0xfff0e0, nowMs, heavy ? 0.85 : 0.6, heavy ? 150 : 110);
  }

  /** Our blade met the target on this frame (before the server confirms). */
  predictContact(targetId: string, nowMs: number) {
    const now = nowMs;
    this.lastSwingAt = now;
    let w = 0;
    for (const p of this.predicted) if (now - p.at < PREDICT_WINDOW_MS) this.predicted[w++] = p;
    this.predicted.length = w;
    if (this.predicted.length < 8) this.predicted.push({ id: targetId, at: now });
    else {
      this.predicted[0]!.id = targetId;
      this.predicted[0]!.at = now;
    }
  }

  /**
   * The server's combat message for one of our melee blows: the predicted target
   * (consumed once), a foe the same swing cleaved (any within the window of our last
   * contact), or neither.
   */
  matchSwing(targetId: string, nowMs: number): SwingMatch {
    for (let i = 0; i < this.predicted.length; i++) {
      const p = this.predicted[i]!;
      if (p.id !== targetId || nowMs - p.at > PREDICT_WINDOW_MS) continue;
      this.predicted.splice(i, 1);
      return "primary";
    }
    return nowMs - this.lastSwingAt <= PREDICT_WINDOW_MS ? "cleave" : "none";
  }

  number(x: number, y: number, z: number, amount: number, style: DmgStyle, key: string, nowMs: number, label?: string) {
    const n = Math.round(Number(amount) || 0);
    const text =
      label ?? (style === "heal" ? `+${n}` : style === "block" ? "dodged" : style === "self" ? `−${n}` : String(n));
    this.numbers.spawn(x, y, z, text, style, nowMs, key);
  }

  // ——— deaths ————————————————————————————————————————————————————

  /**
   * The foe died: collapse it (it leaves the live node map now), ash burst, then
   * dispose when done. (fromX, fromY): the killer's planar position.
   */
  startDeath(rec: CombatNode, fromX: number, fromY: number, nowMs: number): boolean {
    const st = rec.group.userData.mob as MobState | undefined;
    if (!st || st.dying) return false;
    const p = rec.group.position;
    mobDeath(st, p.x - fromX, p.z - fromY, nowMs);
    rec.label.visible = false;
    (rec.label.element as HTMLElement).style.display = "none";
    const canto = this.host.cantoId();
    const boss = st.family === "judge" || st.family === "maw" || st.family === "crush";
    const col =
      canto === "inferno_07" ? 0xf2c860 : canto === "inferno_06" ? 0xb8c070 : st.family === "wisp" ? 0xffc0a0 : 0xff8a40;
    this.ash.spawn(p.x, p.y, p.z, col, nowMs, boss ? 2.6 : st.family === "wisp" ? 0.8 : st.family === "shade" ? 1.1 : 1.6, boss ? 1500 : 950, st.family === "shade" ? 1.4 : 1);
    this.dying.push(rec);
    return true;
  }

  // ——— per frame ———————————————————————————————————————————————————

  /** Pose one live foe (after its idle animation ran). */
  tickMob(rec: CombatNode, dt: number, nowMs: number, detail: boolean) {
    const st = rec.group.userData.mob as MobState | undefined;
    if (!st) return;
    this.host.interp.vel(rec.id, _vel);
    const p = rec.group.position;
    const you = this.host.renderYou;
    const fx = you.x - p.x;
    const fy = you.y - p.z;
    // face the pilgrim only up close (melee), never across the field
    const near = fx * fx + fy * fy < (st.family === "judge" || st.family === "maw" || st.family === "crush" ? 49 : 10);
    tickMob(rec.group, st, dt, nowMs, _vel.x, _vel.y, fx, fy, near, detail);
  }

  tick(nowMs: number, w: number, h: number) {
    const n = this.tele.tick(nowMs);
    for (let i = 0; i < n; i++) this.host.onTelegraphLand(this.tele.landedAt(i));
    this.flashes.update(nowMs);
    this.ash.update(nowMs);
    let k = 0;
    for (let i = 0; i < this.dying.length; i++) {
      const rec = this.dying[i]!;
      const st = rec.group.userData.mob as MobState;
      if (tickMobDeath(rec.group, st, nowMs)) {
        this.flashes.release(rec.group);
        this.host.disposeNode(rec);
      }
      else this.dying[k++] = rec;
    }
    this.dying.length = k;
    this.numbers.update(this.host.camera, w, h, nowMs);
  }

  /** Canto travel: drop telegraphs, corpses, numbers, pending predictions. */
  clear() {
    this.tele.clear();
    this.flashes.clear();
    this.ash.clear();
    for (const rec of this.dying) {
      this.flashes.release(rec.group);
      this.host.disposeNode(rec);
    }
    this.dying.length = 0;
    this.predicted.length = 0;
    this.lastSwingAt = -1e9;
    this.darts.clear();
    this.teleOwner.clear();
    this.numbers.clear();
  }
}

/**
 * Skill visuals. One-shots come from spell_fx. Glyphs, burns, shades, vortices
 * and halos follow room.skillFx so a late joiner still sees them.
 * Meshes are pooled. Tick does not allocate.
 */
import * as THREE from "three";
import { setPlanar } from "./frames";
import { acquireFxMote, acquireFxRing, releaseFx, softDotTexture } from "./fx";
import { GroundDecals, SkillParticles, type DecalKind } from "./skillParticles";

export type SkillFxTier = "low" | "mid" | "high";

type Shot = {
  mesh: THREE.Object3D;
  t0: number;
  life: number;
  kind: number;
  x: number;
  y: number;
  x1: number;
  y1: number;
  r0: number;
  r1: number;
  owner: string;
  pool: string;
  /** 0 default. Rings: 1 intensify, 2 quick contract. Columns: 1 flicker. */
  mode: number;
  prog: number;
};

type Persist = {
  id: string;
  kind: string;
  mesh: THREE.Object3D;
  x: number;
  y: number;
  tx: number;
  ty: number;
  r: number;
  owner: string;
  seen: number;
};

type StatusTag = {
  id: string;
  group: THREE.Group;
  stun: THREE.Object3D[];
  root: THREE.Mesh;
  slow: THREE.Mesh;
  weak: THREE.Mesh;
  used: number;
};

const KIND_RING = 1;
const KIND_BEAM = 2;
const KIND_CLEAVE = 3;
const KIND_COLUMN = 4;
const KIND_DOME = 5;
const KIND_MOTES = 6;
const KIND_PUFF = 7;
const KIND_FISSURE = 8;
const KIND_LANCE = 9;
const KIND_EMIT = 10;

const CRIMSON = 0xc8281e;
const EMBER = 0xff7a2a;
const BONE = 0xf0d8a0;
const GOLD = 0xf4d27a;
const WHITE_FIRE = 0xfff6dc;
const FLAME = 0xff8a30;
const VIOLET = 0x8a5cc8;
const LILAC = 0xc8b8e0;
const ASH = 0x3a3544;
const PALE_WIND = 0xd6e6f6;
const PALE_STORM = 0xd0e4ff;
const STONE = 0x8a8478;
const BRONZE = 0xb07a3a;
const PALE_STONE = 0xd8cfc0;

const CLEAVE_VERT = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CLEAVE_FRAG = /* glsl */ `
  varying vec2 vP;
  uniform float uOpen;
  uniform float uFade;
  uniform vec3 uCore;
  uniform vec3 uEdge;
  void main() {
    float ang = atan(vP.y, vP.x);
    float lim = max(0.02, uOpen) * 1.04719755;
    if (abs(ang) > lim) discard;
    float r = length(vP);
    if (r > 1.0) discard;
    float rim = smoothstep(0.72, 0.98, r);
    float edge = smoothstep(lim - 0.14, lim, abs(ang));
    float hot = max(rim, edge);
    vec3 col = mix(uCore, uEdge, hot);
    float a = uFade * (0.5 + 0.48 * hot) * smoothstep(0.0, 0.06, r);
    if (a < 0.02) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

function branchTint(id: string): number {
  switch (id) {
    case "furious_cleave":
    case "wrath_charge":
    case "war_cry":
    case "earthsplitter":
    case "ferocia":
    case "bloodthirst":
      return CRIMSON;
    case "whirl_ward":
    case "bastion":
    case "stone_skin":
    case "thorns":
      return BRONZE;
    case "last_stand":
      return 0xf0d080;
    case "infernal_burst":
    case "pillar_of_flame":
      return FLAME;
    case "lance_of_light":
    case "grace":
    case "halo":
    case "fervore":
      return GOLD;
    case "gale_bolt":
    case "shadow_step":
    case "snare_glyph":
    case "summon_shade":
    case "tempest":
      return VIOLET;
    case "mana_deny":
      return 0xb7a6d6;
    default:
      return 0xe6d7b0;
  }
}

export class SkillVfx {
  private scene: THREE.Scene;
  private standY: (x: number, y: number, h?: number) => number;
  private tierOf: () => SkillFxTier;
  private youId: () => string;
  private foeOf: (ownerId: string) => boolean;
  private posOf: (id: string) => { x: number; y: number } | null;
  private onImpact?: (
    x: number,
    y: number,
    strength: number,
    casterId: string,
    spellId: string,
    colorHex: number
  ) => void;
  private canto: () => string;
  private particles: SkillParticles;
  private decals: GroundDecals;
  private now = 0;
  private readonly _v = new THREE.Vector3();
  private flashSlots: { spr: THREE.Sprite; mat: THREE.SpriteMaterial; t0: number; life: number; alpha: number; size: number; on: boolean }[] = [];
  private flashCursor = 0;
  private shots: Shot[] = [];
  private persist = new Map<string, Persist>();
  private persistFree: Persist[] = [];
  private stamp = 0;
  private aim: THREE.Mesh | null = null;
  private aimOn = false;
  private beams: THREE.Mesh[] = [];
  private cleaves: THREE.Mesh[] = [];
  private columns: THREE.Mesh[] = [];
  private domes: THREE.Mesh[] = [];
  private bastions: THREE.Group[] = [];
  private chipAt = 0;
  private moteGroups: THREE.Group[] = [];
  private puffs: THREE.Group[] = [];
  private lances: THREE.Group[] = [];
  private blanks: THREE.Object3D[] = [];
  private ghosts: THREE.Group[] = [];
  private tags: StatusTag[] = [];
  private tagUsed = 0;
  private overlay = new Map<string, { stun: number; root: number; slow: number; weak: number; until: number }>();
  private beamGeo: THREE.BoxGeometry;
  private cleaveGeo: THREE.ShapeGeometry;
  private dot: THREE.Texture;

  constructor(
    scene: THREE.Scene,
    opts: {
      standY: (x: number, y: number, h?: number) => number;
      tier: () => SkillFxTier;
      youId: () => string;
      foeOf: (ownerId: string) => boolean;
      posOf: (id: string) => { x: number; y: number } | null;
      onImpact?: (
        x: number,
        y: number,
        strength: number,
        casterId: string,
        spellId: string,
        colorHex: number
      ) => void;
      canto?: () => string;
    }
  ) {
    this.scene = scene;
    this.standY = opts.standY;
    this.tierOf = opts.tier;
    this.youId = opts.youId;
    this.foeOf = opts.foeOf;
    this.posOf = opts.posOf;
    this.onImpact = opts.onImpact;
    this.canto = opts.canto || (() => "");
    this.beamGeo = new THREE.BoxGeometry(1, 0.08, 0.12);
    this.cleaveGeo = cleaveGeo();
    this.dot = softDotTexture();
    this.particles = new SkillParticles(scene, opts.tier);
    this.decals = new GroundDecals(scene, opts.standY, opts.tier);
    this.buildFlashes();
  }

  /** spell_fx. Returns false for the three original spells (WorldApp draws those). */
  onSpell(msg: {
    spellId?: string;
    x?: number;
    y?: number;
    tx?: number;
    ty?: number;
    radius?: number;
    duration?: number;
    hits?: string[];
    casterId?: string;
  }, now: number): boolean {
    this.now = now > 0 ? now : this.now;
    const id = String(msg.spellId || "");
    const x = Number(msg.x) || 0;
    const y = Number(msg.y) || 0;
    const tx = Number(msg.tx ?? msg.x) || x;
    const ty = Number(msg.ty ?? msg.y) || y;
    const radius = Number(msg.radius) || 2;
    const dur = Number(msg.duration) || 0.4;
    const owner = String(msg.casterId || "");
    const hits = Array.isArray(msg.hits) ? msg.hits : [];
    const legacy = id === "gale_bolt" || id === "whirl_ward" || id === "infernal_burst";
    if (owner && owner !== this.youId()) this.remoteFlare(x, y, branchTint(id));
    if (id === "infernal_burst") {
      this.infernal(x, y, radius, owner);
      return false;
    }
    if (id === "gale_bolt") {
      this.galeBolt(x, y, tx, ty, owner);
      return false;
    }
    if (id === "whirl_ward") {
      this.whirlWard(x, y, owner);
      return false;
    }
    if (legacy) return false;
    if (id === "furious_cleave") this.cleave(x, y, tx, ty, radius, now, hits, owner);
    else if (id === "wrath_charge") this.wrathCharge(x, y, tx, ty, now, owner, hits);
    else if (id === "war_cry") this.warCry(x, y, radius, dur, now, owner, hits);
    else if (id === "earthsplitter") this.fissure(x, y, tx, ty, now, owner, hits);
    else if (id === "lance_of_light") this.lance(x, y, tx, ty, now, owner);
    else if (id === "grace") this.grace(x, y, now, owner);
    else if (id === "pillar_of_flame") {
      if (dur >= 0.5 && hits.length === 0) this.pillarMark(x, y, radius, dur, now, owner);
      else this.pillarBurst(x, y, radius, now, owner);
    } else if (id === "halo") this.haloBurst(x, y, radius, now);
    else if (id === "shadow_step") this.shadowStep(x, y, tx, ty, now);
    else if (id === "snare_glyph") {
      if (dur <= 0.35 && hits.length) this.snareSnap(x, y, radius, now, owner, hits);
    } else if (id === "summon_shade") this.summonShade(x, y);
    else if (id === "tempest") this.tempestCast(x, y, radius, now, owner);
    else if (id === "bastion") this.bastionCast(x, y, radius || 1.8, now, owner);
    else if (id === "last_stand") this.lastStand(x, y, now, owner);
    else if (id === "bloodthirst") this.bloodthirst(x, y);
    return true;
  }

  /**
   * Hit read: flash, a shockwave that stays up at least half a second, a particle
   * burst, an optional decal, and the host camera/light callback.
   */
  impact(
    x: number,
    y: number,
    strength: number,
    colorHex: number,
    opts?: {
      casterId?: string;
      spellId?: string;
      decal?: DecalKind | null;
      radius?: number;
      shock?: boolean;
      yaw?: number;
    }
  ) {
    const now = this.now > 0 ? this.now : -1;
    const s = Math.max(0, Math.min(1, strength));
    const h = this.standY(x, y, 1.05);
    this.flashAt(x, y, h, colorHex, 140 + s * 60, 0.9, 0.65 + s * 1.15);
    const rad = opts?.radius ?? 1.05 + s * 2.5;
    if (opts?.shock !== false) {
      this.ring(x, y, 0.32, rad, now, 560 + s * 200, colorHex, 0.92, true, 0, 0, true);
      if (this.tierOf() !== "low" && s >= 0.55) {
        this.ring(x, y, 0.22, rad * 0.7, now, 520 + s * 160, BONE, 0.5, true);
      }
    }
    this.particles.burst(
      x,
      y,
      this.standY(x, y, 0.35),
      8 + Math.round(s * 16),
      2.1 + s * 3.4,
      colorHex,
      640,
      0.22 + s * 0.08,
      0.05,
      1.5 + s * 2.4,
      -4.8,
      0
    );
    if (opts?.decal) {
      this.decals.spawn(opts.decal, x, y, Math.max(0.7, (opts.radius ?? 0.9 + s) * 0.85), opts.decal === "crackLit" ? 0xffffff : colorHex, 3200, opts.yaw ?? 0);
    }
    this.onImpact?.(x, y, s, opts?.casterId || "", opts?.spellId || "", colorHex);
  }

  /** ~200 ms branch-coloured gather at the caster's hand, then a linger so it can be read. */
  windup(spellId: string, x: number, y: number, aimX: number, aimY: number) {
    const now = this.now > 0 ? this.now : -1;
    const col = branchTint(spellId);
    const dx = aimX - x;
    const dy = aimY - y;
    const len = Math.hypot(dx, dy) || 1;
    const hx = x + (dx / len) * 0.42;
    const hy = y + (dy / len) * 0.42;
    const hh = this.standY(hx, hy, 1.15);
    this.particles.converge(hx, hy, hh, 1.1, 16, col, 540, 220);
    this.ring(hx, hy, 1.15, 0.2, now, 540, col, 0.72, true, 0, 2);
    this.flashAt(hx, hy, hh, col, 200, 0.62, 0.72);
  }

  /** Branch-tinted spark on a struck body. */
  hitSpark(x: number, y: number, spellId: string) {
    const col = branchTint(spellId);
    this.particles.burst(x, y, this.standY(x, y, 1.05), 12, 3.3, col, 560, 0.2, 0.04, 2.3, -4.2, 0);
    this.ring(x, y, 0.12, 0.75, this.now > 0 ? this.now : -1, 480, col, 0.78, true);
  }

  levelUp(x: number, y: number, big: boolean, now: number) {
    const r = big ? 1.8 : 0.9;
    this.column(x, y, big ? 1.8 : 1.05, now, big ? 1100 : 560, 0xf0d080);
    this.ring(x, y, 0.35, r, now, big ? 800 : 460, 0xf0d080, big ? 0.9 : 0.55, false);
    if (big) this.motes(x, y, now, 800, 0xf6e2a4);
  }

  sparkThorns(x: number, y: number, now: number) {
    this.now = now > 0 ? now : this.now;
    const t0 = this.now > 0 ? this.now : now;
    const n = this.scaled(7);
    const h = this.standY(x, y, 1.05);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      this.particles.emit(
        x + Math.cos(ang) * 0.22,
        h,
        y + Math.sin(ang) * 0.22,
        Math.cos(ang) * 4.2,
        0.35,
        Math.sin(ang) * 4.2,
        420,
        0.1,
        0.02,
        i % 2 ? BRONZE : PALE_STONE,
        0.72,
        -1.4,
        2.4,
        0
      );
    }
    this.ring(x, y, 0.12, 0.55, t0, 460, BRONZE, 0.5, true);
  }

  /** Pale chips when Stone Skin soaks a blow. At most once per 400 ms. */
  stoneChip(x: number, y: number) {
    const now = this.now;
    if (this.chipAt > 0 && now - this.chipAt < 400) return;
    this.chipAt = now > 0 ? now : 1;
    const t0 = now > 0 ? now : -1;
    const n = this.scaled(6);
    const h = this.standY(x, y, 0.9);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      this.particles.emit(
        x,
        h,
        y,
        Math.cos(ang) * 2.2,
        1.5 + (i % 3) * 0.25,
        Math.sin(ang) * 2.2,
        520,
        0.11,
        0.03,
        i % 2 ? PALE_STONE : STONE,
        0.78,
        -6,
        1.15,
        0
      );
    }
    this.ring(x, y, 0.16, 0.62, t0, 460, PALE_STONE, 0.5, false);
  }

  /** Ground-aim ring while a key or button is held. */
  setAim(on: boolean, x = 0, y = 0, radius = 1) {
    this.aimOn = on && radius > 0.05;
    if (!this.aimOn) {
      if (this.aim) this.aim.visible = false;
      return;
    }
    if (!this.aim) {
      this.aim = acquireFxRing(0.86, 1, 28, 0xe6d7b0, 0.55, true);
      this.scene.add(this.aim);
    }
    this.aim.visible = true;
    setPlanar(this.aim.position, x, y, this.standY(x, y, 0.08));
    this.aim.scale.setScalar(Math.max(0.35, radius));
  }

  syncPersistent(
    list: { id: string; kind: string; x: number; y: number; r?: number; owner?: string; ttl?: number }[] | undefined,
    now: number
  ) {
    this.stamp++;
    const rows = list || [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = String(row.id);
      let rec = this.persist.get(id);
      if (!rec) {
        rec = this.persistFree.pop() || this.blankPersist();
        rec.mesh = this.meshForKind(String(row.kind));
        this.scene.add(rec.mesh);
        this.persist.set(id, rec);
      } else if (rec.kind !== row.kind) {
        this.scene.remove(rec.mesh);
        this.releaseMesh(rec.kind, rec.mesh);
        rec.mesh = this.meshForKind(String(row.kind));
        this.scene.add(rec.mesh);
      }
      rec.id = id;
      rec.kind = String(row.kind);
      rec.tx = Number(row.x) || 0;
      rec.ty = Number(row.y) || 0;
      if (!Number.isFinite(rec.x)) {
        rec.x = rec.tx;
        rec.y = rec.ty;
      }
      rec.r = Number(row.r) || 1.5;
      rec.owner = String(row.owner || "");
      rec.seen = this.stamp;
      rec.mesh.visible = true;
      if (rec.kind === "bastion") this.expireDomes(rec.owner, now);
      this.paintPersist(rec, now);
    }
    for (const [id, rec] of this.persist) {
      if (rec.seen === this.stamp) continue;
      rec.mesh.visible = false;
      this.scene.remove(rec.mesh);
      this.releaseMesh(rec.kind, rec.mesh);
      this.persist.delete(id);
      rec.x = NaN;
      this.persistFree.push(rec);
    }
  }

  /** Mob / player status ornaments. `push` is called by WorldApp with live positions. */
  beginStatuses() {
    this.tagUsed = 0;
  }

  pushStatus(id: string, x: number, y: number, stun: number, root: number, slow: number, weak: number, now: number) {
    const extra = this.overlay.get(id);
    if (extra && extra.until > now) {
      stun = Math.max(stun, extra.stun);
      root = Math.max(root, extra.root);
      slow = Math.max(slow, extra.slow);
      weak = Math.max(weak, extra.weak);
    }
    if (stun < 0.05 && root < 0.05 && slow < 0.05 && weak < 0.05) return;
    if (this.tagUsed >= 16) return;
    const tag = this.tagAt(this.tagUsed++);
    tag.id = id;
    tag.group.visible = true;
    setPlanar(tag.group.position, x, y, this.standY(x, y, 0.05));
    const showStun = stun > 0.05;
    for (let i = 0; i < tag.stun.length; i++) tag.stun[i].visible = showStun;
    tag.root.visible = root > 0.05;
    tag.slow.visible = slow > 0.05;
    tag.weak.visible = weak > 0.05;
    if (showStun) {
      const n = tag.stun.length;
      for (let i = 0; i < n; i++) {
        const a = now * 0.004 + (i / n) * Math.PI * 2;
        tag.stun[i].position.set(Math.cos(a) * 0.35, 2.05, Math.sin(a) * 0.35);
      }
    }
  }

  endStatuses() {
    for (let i = this.tagUsed; i < this.tags.length; i++) this.tags[i].group.visible = false;
  }

  tick(now: number) {
    this.now = now;
    if (this.aim && !this.aimOn) this.aim.visible = false;
    let w = 0;
    for (let i = 0; i < this.shots.length; i++) {
      const s = this.shots[i];
      if (s.t0 < 0) s.t0 = now;
      if (now < s.t0) {
        s.mesh.visible = false;
        this.shots[w++] = s;
        continue;
      }
      const u = (now - s.t0) / s.life;
      if (!(u < 1)) {
        this.scene.remove(s.mesh);
        this.releasePool(s.pool, s.mesh);
        continue;
      }
      if (s.pool !== "emit") s.mesh.visible = true;
      this.poseShot(s, u, now);
      this.shots[w++] = s;
    }
    this.shots.length = w;
    this.particles.tick(now);
    this.decals.tick(now);
    this.tickFlashes(now);
    for (const rec of this.persist.values()) {
      if (!rec.mesh.visible) continue;
      rec.x += (rec.tx - rec.x) * 0.35;
      rec.y += (rec.ty - rec.y) * 0.35;
      if (rec.kind === "halo" || rec.kind === "shade" || rec.kind === "bastion") {
        const follow = rec.kind === "shade" ? null : this.posOf(rec.owner);
        if (follow) {
          rec.x = follow.x;
          rec.y = follow.y;
        }
      }
      this.placePersist(rec, now);
    }
  }

  clear() {
    for (let i = 0; i < this.shots.length; i++) {
      const s = this.shots[i];
      this.scene.remove(s.mesh);
      this.releasePool(s.pool, s.mesh);
    }
    this.shots.length = 0;
    for (const rec of this.persist.values()) {
      this.scene.remove(rec.mesh);
      this.releaseMesh(rec.kind, rec.mesh);
      rec.x = NaN;
      this.persistFree.push(rec);
    }
    this.persist.clear();
    this.particles.clear();
    this.decals.clear();
    for (let i = 0; i < this.flashSlots.length; i++) {
      this.flashSlots[i].on = false;
      this.flashSlots[i].spr.visible = false;
    }
    this.setAim(false);
    this.endStatuses();
    this.tagUsed = 0;
    for (const t of this.tags) t.group.visible = false;
  }

  private poseShot(s: Shot, u: number, now: number) {
    const fade = 1 - u;
    if (s.kind === KIND_RING) {
      const mesh = s.mesh as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const age = now - s.t0;
      const boost = (mesh.userData.opBoost as number) || 1;
      if (s.mode === 1) {
        const tail = u > 0.82 ? 1 - (u - 0.82) / 0.18 : 1;
        const pulse = 0.92 + 0.08 * Math.sin(now * 0.012);
        mesh.scale.setScalar((s.r0 + (s.r1 - s.r0) * (0.9 + 0.1 * u)) * pulse);
        mat.opacity = (0.38 + 0.55 * Math.min(1, u * 1.7)) * tail * boost;
      } else if (s.mode === 2) {
        const k = Math.min(1, age / 220);
        mesh.scale.setScalar(s.r0 + (s.r1 - s.r0) * k);
        mat.opacity = 0.8 * fade * boost;
      } else {
        mesh.scale.setScalar(s.r0 + (s.r1 - s.r0) * u);
        mat.opacity = 0.85 * fade * boost;
      }
    } else if (s.kind === KIND_BEAM) {
      const mat = (s.mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = 0.9 * fade;
    } else if (s.kind === KIND_CLEAVE) {
      this.poseCleave(s, u, now);
    } else if (s.kind === KIND_COLUMN) {
      const mesh = s.mesh as THREE.Mesh;
      const h = s.r1 * (0.72 + u * 0.28);
      mesh.scale.set(s.r0, h, s.r0);
      mesh.position.y = this.standY(s.x, s.y, h * 0.5);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const flick = s.mode === 1 ? 0.78 + 0.22 * Math.sin(now * 0.034 + s.x * 1.7) : 1;
      mat.opacity = 0.84 * Math.max(0.45, fade) * flick;
    } else if (s.kind === KIND_FISSURE) {
      this.poseFissure(s, now);
    } else if (s.kind === KIND_LANCE) {
      this.poseLance(s, now);
    } else if (s.kind === KIND_EMIT) {
      this.poseEmit(s, now);
    } else if (s.kind === KIND_DOME) {
      const pos = this.posOf(s.owner);
      const x = pos ? pos.x : s.x;
      const y = pos ? pos.y : s.y;
      setPlanar(s.mesh.position, x, y, this.standY(x, y, 1.15));
      const mat = (s.mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = 0.42 + 0.1 * Math.sin(now * 0.008);
    } else if (s.kind === KIND_MOTES) {
      const g = s.mesh as THREE.Group;
      const n = g.children.length;
      if (s.mode === 3) {
        const spin = u * Math.PI * 2;
        let vis = 0;
        for (let i = 0; i < n; i++) if (g.children[i].visible) vis++;
        let k = 0;
        for (let i = 0; i < n; i++) {
          const c = g.children[i];
          if (!c.visible || vis < 1) continue;
          const a = spin + (k / vis) * Math.PI * 2;
          k++;
          c.position.set(Math.cos(a) * s.r0, 0.85, Math.sin(a) * s.r0);
          const mat = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
          mat.opacity = 0.9 * Math.max(0.15, fade);
        }
      } else {
        for (let i = 0; i < n; i++) {
          const c = g.children[i];
          const a = (i / n) * Math.PI * 2 + now * 0.003;
          const rad = 0.35 + u * 0.8;
          c.position.set(Math.cos(a) * rad, 0.4 + u * 1.6, Math.sin(a) * rad);
        }
      }
    } else if (s.kind === KIND_PUFF) {
      const g = s.mesh as THREE.Group;
      g.scale.setScalar(0.85 + u * 1.15);
      for (let i = 0; i < g.children.length; i++) {
        const mat = (g.children[i] as THREE.Sprite).material as THREE.SpriteMaterial;
        mat.opacity = 0.82 * Math.max(0.25, fade);
      }
    }
  }

  private ring(
    x: number,
    y: number,
    r0: number,
    r1: number,
    now: number,
    life: number,
    color: number,
    opacity: number,
    additive = true,
    delay = 0,
    mode = 0,
    thick = false
  ) {
    // Draw-call budget: each ring is its own mesh. Drop extras once the tier's cap is live.
    const tier = this.tierOf();
    const cap = tier === "low" ? 7 : tier === "mid" ? 18 : 28;
    let live = 0;
    for (let i = 0; i < this.shots.length; i++) if (this.shots[i].kind === KIND_RING) live++;
    if (live >= cap) return;
    const inner = thick ? 0.55 : 0.82;
    const mesh = acquireFxRing(inner, 1, this.tierOf() === "low" ? 20 : 32, color, opacity, additive);
    mesh.userData.opBoost = 1;
    setPlanar(mesh.position, x, y, this.standY(x, y, 0.08));
    mesh.scale.setScalar(Math.max(0.05, r0));
    mesh.visible = delay <= 0 && now >= 0;
    this.scene.add(mesh);
    this.shots.push({
      mesh, t0: now + delay, life, kind: KIND_RING, x, y, x1: x, y1: y, r0, r1, owner: "", pool: "ring", mode, prog: 0,
    });
  }

  private beam(x: number, y: number, tx: number, ty: number, now: number, life: number, color: number, thick: number) {
    const mesh = this.beams.pop() || this.makeBeam();
    const len = this.aimBox(mesh, x, y, tx, ty);
    mesh.scale.set(Math.max(0.2, len), thick / 0.08, 1);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = 0.9;
    mat.blending = THREE.AdditiveBlending;
    mesh.visible = true;
    this.scene.add(mesh);
    this.shots.push({
      mesh, t0: now, life: life * 1000, kind: KIND_BEAM, x, y, x1: tx, y1: ty, r0: thick, r1: 0, owner: "", pool: "beam", mode: 0, prog: 0,
    });
  }

  private cleave(x: number, y: number, tx: number, ty: number, radius: number, now: number, hits: string[], owner: string) {
    const mesh = this.cleaves.pop() || this.makeCleave();
    const dx = tx - x;
    const dy = ty - y;
    const yaw = Math.atan2(-dy, dx);
    // Fan opens toward local +X. Laid flat (rotation.x = -π/2) and yawed onto the aim.
    mesh.rotation.order = "YXZ";
    mesh.rotation.y = yaw;
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = 0;
    const reach = Math.max(1.4, radius);
    mesh.scale.setScalar(reach);
    setPlanar(mesh.position, x, y, this.standY(x, y, 0.16));
    const mat = mesh.material as THREE.ShaderMaterial;
    mat.uniforms.uOpen.value = 0.02;
    mat.uniforms.uFade.value = 1;
    mesh.visible = true;
    this.scene.add(mesh);
    this.shots.push({
      mesh, t0: now, life: 900, kind: KIND_CLEAVE, x, y, x1: tx, y1: ty, r0: reach, r1: radius, owner, pool: "cleave", mode: hits.length ? 1 : 0, prog: 0,
    });
    const len = Math.hypot(dx, dy) || 1;
    const cx = x + (dx / len) * radius * 0.55;
    const cy = y + (dy / len) * radius * 0.55;
    this.ring(x, y, Math.max(0.35, radius * 0.2), radius * 0.9, now, 640, 0x3a1814, 0.55, false);
    this.decals.spawn("scorch", cx, cy, Math.min(1.7, radius * 0.42), CRIMSON, 2800, yaw);
    this.particles.ringBurst(cx, cy, 10, 2.1, 0x4e463f, this.standY(cx, cy, 0.16), 640, 1, 0.7);
    if (hits.length) this.impact(cx, cy, 0.45, EMBER, { casterId: owner, spellId: "furious_cleave", radius: Math.max(1.2, radius * 0.45) });
  }

  private column(
    x: number,
    y: number,
    radius: number,
    now: number,
    life: number,
    color: number,
    opts?: { slim?: boolean; flicker?: boolean; additive?: boolean }
  ) {
    const mesh = this.columns.pop() || this.makeColumn();
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = 0.86;
    mat.blending = opts?.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    const girth = opts?.slim ? Math.max(0.28, radius * 0.22) : Math.max(1.25, radius * 0.55);
    const h = opts?.slim ? Math.max(3.6, radius * 1.9) : Math.max(4.6, radius * 2.3);
    mesh.scale.set(girth, h, girth);
    setPlanar(mesh.position, x, y, this.standY(x, y, h * 0.5));
    mesh.visible = true;
    this.scene.add(mesh);
    this.shots.push({
      mesh, t0: now, life: Math.max(450, life), kind: KIND_COLUMN, x, y, x1: x, y1: y, r0: girth, r1: h, owner: "", pool: "column", mode: opts?.flicker ? 1 : 0, prog: 0,
    });
  }

  private motes(x: number, y: number, now: number, life: number, color: number) {
    const g = this.moteGroups.pop() || this.makeMotes();
    const n = this.tierOf() === "low" ? 3 : 5;
    for (let i = 0; i < g.children.length; i++) {
      const c = g.children[i] as THREE.Mesh;
      c.visible = i < n;
      const mat = c.material as THREE.MeshBasicMaterial;
      mat.color.setHex(color);
      mat.opacity = 0.9;
    }
    setPlanar(g.position, x, y, this.standY(x, y, 0.2));
    g.visible = true;
    this.scene.add(g);
    this.shots.push({
      mesh: g, t0: now, life, kind: KIND_MOTES, x, y, x1: x, y1: y, r0: 0.4, r1: 1, owner: "", pool: "motes", mode: 0, prog: 0,
    });
  }

  private puff(x: number, y: number, now: number) {
    const g = this.puffs.pop() || this.makePuff();
    setPlanar(g.position, x, y, this.standY(x, y, 0.8));
    g.scale.setScalar(0.4);
    g.visible = true;
    this.scene.add(g);
    this.shots.push({
      mesh: g, t0: now, life: 560, kind: KIND_PUFF, x, y, x1: x, y1: y, r0: 0.7, r1: 1.8, owner: "", pool: "puff", mode: 0, prog: 0,
    });
  }

  private dome(x: number, y: number, radius: number, now: number, life: number, owner: string) {
    const mesh = this.domes.pop() || this.makeDome();
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(PALE_STONE);
    mat.opacity = 0.5;
    mesh.scale.setScalar(Math.max(1.2, radius));
    setPlanar(mesh.position, x, y, this.standY(x, y, 1.1));
    mesh.visible = true;
    this.scene.add(mesh);
    this.shots.push({
      mesh, t0: now, life: Math.max(400, Math.min(600, life)), kind: KIND_DOME, x, y, x1: x, y1: y, r0: radius, r1: radius, owner, pool: "dome", mode: 0, prog: 0,
    });
  }

  private wrathCharge(x: number, y: number, tx: number, ty: number, now: number, owner: string, hits: string[]) {
    this.beam(x, y, tx, ty, now, 0.72, CRIMSON, 0.36);
    const dx = tx - x;
    const dy = ty - y;
    const len = Math.hypot(dx, dy) || 1;
    const ox = (-dy / len) * 0.22;
    const oy = (dx / len) * 0.22;
    this.beam(x + ox, y + oy, tx + ox, ty + oy, now, 0.66, BONE, 0.16);
    const h = this.standY((x + tx) * 0.5, (y + ty) * 0.5, 0.75);
    this.particles.streak(x, y, tx, ty, 22, CRIMSON, h, 740, 0);
    this.particles.streak(x, y, tx, ty, 10, EMBER, h + 0.25, 680, 0);
    this.particles.ringBurst(x, y, 16, 3.3, 0x6a625c, this.standY(x, y, 0.2), 760, 1, 1.45);
    this.impact(tx, ty, 0.65, CRIMSON, { casterId: owner, spellId: "wrath_charge", decal: "crack", radius: 1.4 });
    this.markHits(hits, "stun", 0.6, now);
  }

  private warCry(x: number, y: number, radius: number, dur: number, now: number, owner: string, hits: string[]) {
    const r = Math.max(1.6, radius);
    this.impact(x, y, 0.5, CRIMSON, { casterId: owner, spellId: "war_cry", radius: r });
    this.ring(x, y, Math.max(0.45, r * 0.28), r * 1.06, now, 780, EMBER, 0.82, true, 120);
    this.particles.ringBurst(x, y, 22, 3.6, 0x6e655c, this.standY(x, y, 0.22), 820, 1, 1.55);
    this.particles.rise(x, y, r * 0.62, 16, EMBER, this.standY(x, y, 0.3), 1100, 1.7, 0);
    this.markHits(hits, "weak", Math.min(4, dur), now);
  }

  private fissure(x: number, y: number, tx: number, ty: number, now: number, owner: string, hits: string[]) {
    const mesh = this.beams.pop() || this.makeBeam();
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(EMBER);
    mat.opacity = 0.9;
    mat.blending = THREE.AdditiveBlending;
    mesh.visible = true;
    this.scene.add(mesh);
    this.shots.push({
      mesh, t0: now, life: 980, kind: KIND_FISSURE, x, y, x1: tx, y1: ty, r0: 0, r1: 0, owner, pool: "beam", mode: 0, prog: 0,
    });
    this.markHits(hits, "slow", 0.8, now);
  }

  private lance(x: number, y: number, tx: number, ty: number, now: number, owner: string) {
    const g = this.lances.pop() || this.makeLance();
    g.visible = true;
    this.scene.add(g);
    this.shots.push({
      mesh: g, t0: now, life: 720, kind: KIND_LANCE, x, y, x1: tx, y1: ty, r0: 0, r1: 0, owner, pool: "lance", mode: 0, prog: 0,
    });
  }

  private grace(x: number, y: number, now: number, owner: string) {
    this.decals.spawn("rune", x, y, 1.2, GOLD, 3400, 0);
    this.ring(x, y, 0.35, 1.2, now, 1400, GOLD, 0.42, true);
    this.flashAt(x, y, this.standY(x, y, 1.2), WHITE_FIRE, 200, 0.45, 0.85);
    const blank = this.blanks.pop() || new THREE.Object3D();
    this.shots.push({
      mesh: blank, t0: now, life: 1400, kind: KIND_EMIT, x, y, x1: x, y1: y, r0: 0.4, r1: 0, owner, pool: "emit", mode: 1, prog: 0,
    });
  }

  private pillarMark(x: number, y: number, radius: number, dur: number, now: number, owner: string) {
    const life = Math.max(520, dur * 1000);
    this.ring(x, y, radius * 0.62, radius, now, life, FLAME, 0.9, true, 0, 1);
    if (this.tierOf() !== "low") this.ring(x, y, radius * 0.32, radius * 0.72, now, life, WHITE_FIRE, 0.55, true, 0, 1);
    this.decals.spawn("rune", x, y, Math.max(1.1, radius), FLAME, Math.min(4000, Math.max(2500, life)), 0);
    const blank = this.blanks.pop() || new THREE.Object3D();
    this.shots.push({
      mesh: blank, t0: now, life, kind: KIND_EMIT, x, y, x1: x, y1: y, r0: radius, r1: 0, owner, pool: "emit", mode: 2, prog: 0,
    });
  }

  private pillarBurst(x: number, y: number, radius: number, now: number, owner: string) {
    this.column(x, y, radius, now, 1400, FLAME, { flicker: true, additive: true });
    this.column(x, y, radius, now, 1400, WHITE_FIRE, { slim: true, flicker: true, additive: true });
    const h = this.standY(x, y, 0.4);
    this.particles.burst(x, y, h, 24, 2.4, FLAME, 980, 0.34, 0.07, 6.4, -2.4, 0);
    this.particles.rise(x, y, Math.max(0.6, radius * 0.45), 14, WHITE_FIRE, h + 0.3, 1100, 2.5, 0);
    this.impact(x, y, 0.9, FLAME, { casterId: owner, spellId: "pillar_of_flame", decal: "scorch", radius: Math.max(1.6, radius) });
  }

  private haloBurst(x: number, y: number, radius: number, now: number) {
    const r = Math.max(1.2, radius);
    this.ring(x, y, r * 0.35, r, now, 720, GOLD, 0.82, true);
    this.ring(x, y, r * 0.15, r * 0.6, now, 520, WHITE_FIRE, 0.5, true);
    this.particles.ringBurst(x, y, 20, 4.2, GOLD, this.standY(x, y, 0.35), 780, 0, 1.7);
    // (pale-gold motes, not pure white: a dozen white additive dots read as flat blobs)
    this.particles.rise(x, y, r * 0.55, 10, 0xffe2a0, this.standY(x, y, 0.4), 1200, 1.45, 0);
  }

  private infernal(x: number, y: number, radius: number, owner: string) {
    const h = this.standY(x, y, 0.45);
    this.particles.burst(x, y, h, 26, 4.6, FLAME, 780, 0.34, 0.08, 3.8, -3.4, 0);
    this.particles.burst(x, y, this.standY(x, y, 0.25), 12, 2.2, WHITE_FIRE, 640, 0.16, 0.04, 2.4, -2.2, 0);
    this.decals.spawn("scorch", x, y, Math.max(1.5, radius * 0.9), FLAME, 3400, 0);
    this.impact(x, y, 0.75, FLAME, { casterId: owner, spellId: "infernal_burst", radius: Math.max(1.8, radius) });
  }

  /** Dark red / black floors where dark debris disappears (Lust, Wrath, the Pit). */
  private darkFloor(): boolean {
    const c = this.canto();
    return c === "inferno_05" || c === "inferno_08" || c === "inferno_31";
  }

  /** Lust storm washes dark smoke out; Avarice gold needs a darker puff to read. */
  private shadeContrast(): { rim: number; smoke: number } {
    const c = this.canto();
    if (c === "inferno_05") return { rim: 1.4, smoke: 0x7c7488 };
    if (c === "inferno_07") return { rim: 1, smoke: 0x141018 };
    return { rim: 1, smoke: ASH };
  }

  private scaled(count: number): number {
    if (!(count > 0)) return 0;
    const t = this.tierOf();
    const m = t === "low" ? 0.35 : t === "mid" ? 0.7 : 1;
    const n = Math.round(count * m);
    return n < 1 ? 1 : n;
  }

  private boostLastRing(mul: number) {
    const s = this.shots[this.shots.length - 1];
    if (s && s.kind === KIND_RING && mul > 1) s.mesh.userData.opBoost = mul;
  }

  /** WorldApp still draws the ward ring for your own cast. Sparks run for every caster. */
  private whirlWard(x: number, y: number, owner: string) {
    const now = this.now > 0 ? this.now : -1;
    const g = this.moteGroups.pop() || this.makeMotes();
    const show = this.tierOf() === "low" ? 3 : 5;
    for (let i = 0; i < g.children.length; i++) {
      const c = g.children[i] as THREE.Mesh;
      c.visible = i < show;
      const mat = c.material as THREE.MeshBasicMaterial;
      mat.color.setHex(i % 2 ? BRONZE : PALE_STONE);
      mat.opacity = 0.9;
    }
    setPlanar(g.position, x, y, this.standY(x, y, 0.15));
    g.visible = true;
    this.scene.add(g);
    this.shots.push({
      mesh: g, t0: now, life: 420, kind: KIND_MOTES, x, y, x1: x, y1: y, r0: 0.95, r1: 0.95, owner, pool: "motes", mode: 3, prog: 0,
    });
    this.particles.ringBurst(x, y, 14, 2.2, STONE, this.standY(x, y, 0.12), 740, 1, 0.85);
    this.impact(x, y, 0.35, BRONZE, { casterId: owner, spellId: "whirl_ward", radius: 1.35 });
  }

  private bastionCast(x: number, y: number, radius: number, now: number, owner: string) {
    const r = Math.max(1.4, radius);
    this.particles.ringBurst(x, y, 16, 2.4, PALE_STONE, this.standY(x, y, 0.16), 740, 1, 1.05);
    this.particles.rise(x, y, 0.7, 12, BRONZE, this.standY(x, y, 0.25), 900, 1.55, 0);
    this.decals.spawn("rune", x, y, 1.25, BRONZE, 3400, 0);
    this.impact(x, y, 0.55, BRONZE, { casterId: owner, spellId: "bastion", radius: r });
    if (!this.bastionLive(owner)) this.dome(x, y, r, now, 520, owner);
  }

  private bastionLive(owner: string): boolean {
    if (!owner) return false;
    for (const rec of this.persist.values()) {
      if (rec.kind === "bastion" && rec.owner === owner) return true;
    }
    return false;
  }

  /** Drop the cast flash once the persistent dome for this owner is in the room. */
  private expireDomes(owner: string, now: number) {
    if (!owner) return;
    for (let i = 0; i < this.shots.length; i++) {
      const s = this.shots[i];
      if (s.kind !== KIND_DOME || s.owner !== owner) continue;
      s.t0 = now - 5;
      s.life = 1;
    }
  }

  private lastStand(x: number, y: number, now: number, owner: string) {
    this.column(x, y, 1.05, now, 1100, 0xf0d080, { flicker: true, additive: true });
    this.flashAt(x, y, this.standY(x, y, 1.6), 0xfff6ee, 170, 0.95, 1.55);
    if (this.tierOf() !== "low") this.ring(x, y, 0.35, 2.5, now, 720, BRONZE, 0.82, true);
    const n = this.scaled(12);
    const base = this.standY(x, y, 0.2);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const rad = 0.2 + (i % 3) * 0.12;
      this.particles.emit(
        x + Math.cos(ang) * rad,
        base,
        y + Math.sin(ang) * rad,
        Math.cos(ang) * 0.7,
        6.4,
        Math.sin(ang) * 0.7,
        680,
        0.15,
        0.04,
        i % 2 ? PALE_STONE : STONE,
        0.88,
        -7.5,
        0.35,
        0
      );
    }
    this.impact(x, y, 0.7, 0xf0d080, { casterId: owner, spellId: "last_stand", radius: 2.3 });
  }

  /** Heal wisps only. No ring, no impact, no camera. */
  private bloodthirst(x: number, y: number) {
    const n = this.scaled(8);
    const h = this.standY(x, y, 0.3);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const rad = 0.26;
      this.particles.emit(
        x + Math.cos(ang) * rad,
        h,
        y + Math.sin(ang) * rad,
        -Math.sin(ang) * 1.45,
        2.3,
        Math.cos(ang) * 1.45,
        600,
        0.11,
        0.03,
        i % 2 ? CRIMSON : 0xff6a62,
        0.7,
        0.55,
        0.55,
        0
      );
    }
  }

  /** WorldApp still draws the bolt mesh; this is the particle layer in front of it. */
  private galeBolt(x: number, y: number, tx: number, ty: number, owner: string) {
    const h = this.standY((x + tx) * 0.5, (y + ty) * 0.5, 0.95);
    this.particles.streak(x, y, tx, ty, 16, PALE_WIND, h, 700, 0);
    this.particles.burst(tx, ty, this.standY(tx, ty, 0.65), 8, 2.1, LILAC, 640, 0.16, 0.04, 1.7, -3.2, 0);
    this.impact(tx, ty, 0.3, LILAC, { casterId: owner, spellId: "gale_bolt", radius: 0.75 });
  }

  private shadowStep(x: number, y: number, tx: number, ty: number, now: number) {
    const look = this.shadeContrast();
    const rim = look.rim;
    const h0 = this.standY(x, y, 0.4);
    const h1 = this.standY(tx, ty, 0.4);
    this.particles.burst(x, y, h0, 14, 2.1, look.smoke, 780, 0.4 * (rim > 1 ? 1.15 : 1), 0.12, 1.5, -2.2, 1, 1.05);
    this.ring(x, y, 1.2 * rim, 0.16 * rim, now, 740, VIOLET, 0.9, true, 0, 2);
    this.boostLastRing(rim);
    this.collapseSparks(x, y, this.standY(x, y, 0.95), 1.3 * rim, 14, LILAC, Math.min(1, 0.68 * rim), 0.18 * rim, 760);
    this.afterimage(x, y, tx, ty, this.standY((x + tx) * 0.5, (y + ty) * 0.5, 0.85), Math.min(0.7, 0.38 * rim), 0.14 * rim);
    this.ring(tx, ty, 0.22 * rim, 1.75 * rim, now, 780, VIOLET, 0.92, true);
    this.boostLastRing(rim);
    this.particles.burst(tx, ty, h1, Math.round(12 * rim), 2.5 * rim, LILAC, 740, 0.2 * rim, 0.05, 2.1, -4, 0);
    this.particles.ringBurst(tx, ty, 12, 2.3, look.smoke, this.standY(tx, ty, 0.16), 800, 1, 1.05);
  }

  /** Inward lilac sparks. Alpha and size are explicit so Lust can lift them. */
  private collapseSparks(
    x: number,
    z: number,
    h: number,
    radius: number,
    count: number,
    color: number,
    alpha: number,
    size: number,
    life: number
  ) {
    const n = this.scaled(count);
    const travel = 220;
    const T = Math.max(0.08, Math.min(life, travel) / 1000);
    const drag = 7;
    const v0 = (radius * drag) / (1 - Math.exp(-drag * T));
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const rad = radius * (0.82 + (i % 5) * 0.04);
      const cy = Math.cos(ang);
      const sy = Math.sin(ang);
      const py = h + Math.sin(ang * 2) * 0.28;
      this.particles.emit(
        x + cy * rad,
        py,
        z + sy * rad,
        -cy * v0,
        ((h - py) / T) * 0.35,
        -sy * v0,
        life,
        size,
        size * 0.35,
        color,
        alpha,
        0,
        drag,
        0
      );
    }
  }

  private afterimage(x0: number, z0: number, x1: number, z1: number, h: number, alpha: number, size: number) {
    const n = this.scaled(14);
    const dx = x1 - x0;
    const dz = z1 - z0;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      this.particles.emit(
        x0 + dx * t,
        h + (i % 3) * 0.14,
        z0 + dz * t,
        dx * 0.12,
        0.12,
        dz * 0.12,
        820,
        size,
        size * 0.3,
        VIOLET,
        alpha,
        -0.35,
        0.45,
        0
      );
    }
  }

  private snareSnap(x: number, y: number, radius: number, now: number, owner: string, hits: string[]) {
    const n = this.scaled(10);
    const rad = Math.max(0.7, radius * 0.72);
    const base = this.standY(x, y, 0.12);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      this.particles.emit(
        x + Math.cos(ang) * rad,
        base,
        y + Math.sin(ang) * rad,
        0,
        7.2,
        0,
        520,
        0.14,
        0.04,
        VIOLET,
        0.95,
        -6.5,
        0.25,
        0
      );
    }
    this.ring(x, y, 0.18, Math.max(1.15, radius), now, 560, VIOLET, 0.95, true, 0, 2);
    this.impact(x, y, 0.5, VIOLET, { casterId: owner, spellId: "snare_glyph", radius: Math.max(1.15, radius) });
    this.markHits(hits, "root", 1.2, now);
  }

  private summonShade(x: number, y: number) {
    this.decals.spawn("rune", x, y, 1.2, VIOLET, 3400, 0);
    this.particles.rise(x, y, 0.5, 16, ASH, this.standY(x, y, 0.2), 1100, 1.9, 1);
    this.flashAt(x, y, this.standY(x, y, 1.35), VIOLET, 180, 0.9, 1.15);
  }

  private tempestCast(x: number, y: number, radius: number, now: number, owner: string) {
    const r = Math.max(2.4, radius);
    this.impact(x, y, 0.6, PALE_STORM, { casterId: owner, spellId: "tempest", radius: r });
    this.ring(x, y, 0.45, r, now, 760, LILAC, 0.78, true, 40);
  }

  /** Ash motes while the shade is actually moving. Rate and count follow the tier. */
  private shadeAsh(rec: Persist, now: number) {
    const ud = rec.mesh.userData;
    const lx = ud.ashX as number;
    const ly = ud.ashY as number;
    if (!(lx === lx)) {
      ud.ashX = rec.x;
      ud.ashY = rec.y;
      return;
    }
    const dx = rec.x - lx;
    const dy = rec.y - ly;
    if (dx * dx + dy * dy < 0.0016) return;
    const tier = this.tierOf();
    const gap = tier === "low" ? 160 : tier === "mid" ? 100 : 60;
    const prev = (ud.ashAt as number) || 0;
    if (now - prev < gap) return;
    ud.ashX = rec.x;
    ud.ashY = rec.y;
    ud.ashAt = now;
    const n = tier === "low" ? 1 : tier === "mid" ? 2 : 3;
    const h = this.standY(rec.x, rec.y, 0.65);
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / (n + 1);
      this.particles.emit(
        rec.x - dx * t,
        h + i * 0.1,
        rec.y - dy * t,
        -dx * 1.4,
        0.5 + i * 0.12,
        -dy * 1.4,
        680,
        0.2,
        0.05,
        ASH,
        0.5,
        0.2,
        0.7,
        1
      );
    }
  }

  /** Inward orbiting dust, plus a short lightning streak on mid/high. */
  private vortexDust(rec: Persist, now: number) {
    const ud = rec.mesh.userData;
    const tier = this.tierOf();
    const gap = tier === "low" ? 80 : tier === "mid" ? 45 : 28;
    const prev = (ud.swirlAt as number) || 0;
    if (now - prev >= gap) {
      ud.swirlAt = now;
      const n = tier === "low" ? 1 : tier === "mid" ? 2 : 4;
      const R = Math.max(1, rec.r);
      let ang = (ud.swirlAng as number) || 0;
      const h = this.standY(rec.x, rec.y, 0.32);
      for (let i = 0; i < n; i++) {
        ang += 2.15;
        const rad = R * (0.42 + (i % 3) * 0.22);
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        this.particles.emit(
          rec.x + c * rad,
          h + (i % 2) * 0.38,
          rec.y + s * rad,
          -s * 2.5 - c * 1.2,
          0.22,
          c * 2.5 - s * 1.2,
          780,
          0.28,
          0.07,
          i % 2 ? ASH : 0x5c564e,
          0.5,
          -0.3,
          0.5,
          1
        );
      }
      ud.swirlAng = ang;
    }
    if (tier === "low") return;
    const boltAt = ud.boltAt as number;
    if (!(boltAt > 0)) {
      ud.boltAt = now + 700;
      return;
    }
    if (now < boltAt) return;
    const jitter = (((ud.boltN as number) || 0) % 4) * (tier === "high" ? 90 : 80);
    ud.boltN = ((ud.boltN as number) || 0) + 1;
    ud.boltAt = now + (tier === "high" ? 600 : 900) + jitter;
    const ang = ((ud.boltAng as number) || 0.4) + 1.85;
    ud.boltAng = ang;
    const R = Math.max(0.8, rec.r * 0.85);
    const x0 = rec.x + Math.cos(ang) * R * 0.15;
    const z0 = rec.y + Math.sin(ang) * R * 0.15;
    const x1 = rec.x + Math.cos(ang + 0.2) * R;
    const z1 = rec.y + Math.sin(ang + 0.2) * R;
    const h0 = this.standY(rec.x, rec.y, 1.7);
    const h1 = this.standY(rec.x, rec.y, 0.2);
    const segs = tier === "high" ? 5 : 3;
    for (let i = 0; i < segs; i++) {
      const t = i / (segs - 1);
      this.particles.emit(
        x0 + (x1 - x0) * t,
        h0 + (h1 - h0) * t,
        z0 + (z1 - z0) * t,
        0,
        0,
        0,
        170,
        0.09,
        0.02,
        0xf4f7ff,
        0.95,
        0,
        0,
        0
      );
    }
  }

  private remoteFlare(x: number, y: number, color: number) {
    this.particles.converge(x, y, this.standY(x, y, 1.15), 0.9, 10, color, 500, 120);
    this.flashAt(x, y, this.standY(x, y, 1.2), color, 180, 0.55, 0.55);
  }

  private poseCleave(s: Shot, u: number, now: number) {
    const mesh = s.mesh as THREE.Mesh;
    const open = Math.min(1, (now - s.t0) / 150);
    const yaw = Math.atan2(-(s.y1 - s.y), s.x1 - s.x);
    mesh.rotation.order = "YXZ";
    mesh.rotation.y = yaw + (1 - open) * 0.62;
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = 0;
    mesh.scale.setScalar(Math.max(1.2, s.r0));
    mesh.updateMatrix();
    const mat = mesh.material as THREE.ShaderMaterial;
    mat.uniforms.uOpen.value = Math.max(0.04, open);
    const fade = u < 0.22 ? 1 : 1 - (u - 0.22) / 0.78;
    mat.uniforms.uFade.value = Math.max(0, fade);
    const steps = this.tierOf() === "low" ? 2 : 4;
    const per = this.tierOf() === "low" ? 2 : 3;
    const target = Math.floor(open * steps);
    while (s.prog < target) {
      s.prog++;
      const t = s.prog / steps;
      const ang = (t - 0.5) * ((Math.PI * 2) / 3);
      for (let k = 0; k < per; k++) {
        const j = (k - 1) * 0.07;
        const rad = 0.78 + k * 0.08;
        this._v.set(Math.cos(ang + j) * rad, Math.sin(ang + j) * rad, 0.02);
        this._v.applyMatrix4(mesh.matrix);
        const ox = this._v.x - s.x;
        const oz = this._v.z - s.y;
        const ol = Math.hypot(ox, oz) || 1;
        this.particles.emit(
          this._v.x,
          this._v.y,
          this._v.z,
          (ox / ol) * 2.5,
          1.4 + k * 0.25,
          (oz / ol) * 2.5,
          560,
          0.18,
          0.04,
          k === 0 ? BONE : EMBER,
          0.9,
          -3.2,
          1.15,
          0
        );
      }
    }
  }

  private poseFissure(s: Shot, now: number) {
    const age = now - s.t0;
    const travel = Math.min(1, age / 250);
    const dx = s.x1 - s.x;
    const dy = s.y1 - s.y;
    const len = Math.hypot(dx, dy) || 0.2;
    const vis = Math.max(0.2, len * travel);
    const mx = s.x + (dx / len) * vis * 0.5;
    const my = s.y + (dy / len) * vis * 0.5;
    const mesh = s.mesh as THREE.Mesh;
    mesh.rotation.set(0, Math.atan2(-dy, dx), 0);
    setPlanar(mesh.position, mx, my, this.standY(mx, my, 0.22));
    mesh.scale.set(vis, 0.55 / 0.08, 2.4);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    const fade = age < 520 ? 1 : Math.max(0, 1 - (age - 520) / 460);
    mat.opacity = 0.88 * fade;
    const step = this.tierOf() === "low" ? 2.6 : 1.45;
    const steps = Math.max(2, Math.min(8, Math.ceil(len / step)));
    const want = Math.min(steps - 1, Math.floor(travel * steps));
    const yaw = Math.atan2(-dy, dx);
    while (s.prog < want) {
      s.prog++;
      const t = s.prog / steps;
      const px = s.x + dx * t;
      const py = s.y + dy * t;
      // (lit seam: a dark outline and a molten white-gold core read on Lust's red floor
      // and the Styx silt alike; the old ember-tinted crack vanished on dark red)
      this.decals.spawn("crackLit", px, py, 0.95, 0xffffff, 3200, yaw);
      this.particles.burst(px, py, this.standY(px, py, 0.22), 6, 2.3, 0xffd890, 640, 0.18, 0.04, 2.6, -4, 0);
      this.particles.burst(px, py, this.standY(px, py, 0.12), 5, 1.5, this.darkFloor() ? 0xc8b8a0 : 0x5c564e, 720, 0.3, 0.08, 1.2, -3.2, 1, 1.6);
    }
    if (travel >= 1 && s.mode === 0) {
      s.mode = 1;
      this.impact(s.x1, s.y1, 0.85, EMBER, {
        casterId: s.owner,
        spellId: "earthsplitter",
        decal: "crackLit",
        radius: 1.7,
        yaw,
      });
    }
  }

  private poseLance(s: Shot, now: number) {
    const age = now - s.t0;
    const grow = Math.min(1, age / 90);
    const holdEnd = 440;
    const thin = age < holdEnd ? 1 : Math.max(0.12, 1 - (age - holdEnd) / 280);
    const dx = s.x1 - s.x;
    const dy = s.y1 - s.y;
    const len = Math.hypot(dx, dy) || 0.2;
    const vis = Math.max(0.12, len * grow);
    const mx = s.x + (dx / len) * vis * 0.5;
    const my = s.y + (dy / len) * vis * 0.5;
    const g = s.mesh as THREE.Group;
    g.rotation.set(0, Math.atan2(-dy, dx), 0);
    setPlanar(g.position, mx, my, this.standY(mx, my, 0.95));
    const glow = g.children[0] as THREE.Mesh;
    const core = g.children[1] as THREE.Mesh;
    glow.scale.set(vis, (0.48 * thin) / 0.08, 2.8 * thin);
    core.scale.set(vis, (0.12 * thin) / 0.08, 0.55 * thin);
    const fade = age < holdEnd ? 1 : Math.max(0, 1 - (age - holdEnd) / 280);
    (glow.material as THREE.MeshBasicMaterial).opacity = 0.55 * fade;
    (core.material as THREE.MeshBasicMaterial).opacity = 0.95 * fade;
    if (s.prog === 0 && grow >= 1) {
      s.prog = 1;
      this.particles.burst(s.x1, s.y1, this.standY(s.x1, s.y1, 0.9), 12, 3.1, WHITE_FIRE, 620, 0.16, 0.04, 2.2, -2.5, 0);
      this.impact(s.x1, s.y1, 0.45, GOLD, { casterId: s.owner, spellId: "lance_of_light", radius: 1.15 });
    }
  }

  private poseEmit(s: Shot, now: number) {
    if (s.mode === 1) {
      const step = 80;
      const n = Math.floor((now - s.t0) / step);
      const cap = this.tierOf() === "low" ? 10 : 16;
      const per = this.tierOf() === "low" ? 1 : this.tierOf() === "mid" ? 2 : 3;
      while (s.prog < n && s.prog < cap) {
        const i = s.prog++;
        const base = this.standY(s.x, s.y, 0.3);
        for (let k = 0; k < per; k++) {
          const a = i * 0.85 + k * 2.1;
          const rad = 0.28 + (k % 3) * 0.08;
          this.particles.emit(
            s.x + Math.cos(a) * rad,
            base + k * 0.05,
            s.y + Math.sin(a) * rad,
            -Math.sin(a) * 0.75,
            1.25 + k * 0.15,
            Math.cos(a) * 0.75,
            820,
            0.16,
            0.04,
            k === 0 ? GOLD : WHITE_FIRE,
            0.82,
            -0.2,
            0.55,
            0
          );
        }
      }
      return;
    }
    const step = 100;
    const n = Math.floor((now - s.t0) / step);
    const cap = this.tierOf() === "low" ? 6 : 14;
    while (s.prog < n && s.prog < cap) {
      s.prog++;
      const k = this.tierOf() === "low" ? 2 : 3 + (s.prog % 3);
      this.particles.rise(s.x, s.y, Math.max(0.45, s.r0 * 0.55), k, FLAME, this.standY(s.x, s.y, 0.16), 880, 1.05 + s.prog * 0.05, 0);
    }
  }

  private flashAt(x: number, y: number, h: number, color: number, life: number, alpha: number, size: number) {
    const cap = this.flashCap();
    if (cap <= 0) return;
    const f = this.flashSlots[this.flashCursor % cap];
    this.flashCursor = (this.flashCursor + 1) % cap;
    f.on = true;
    f.t0 = this.now > 0 ? this.now : 0;
    f.life = Math.max(120, Math.min(200, life));
    f.alpha = alpha;
    f.size = size;
    f.mat.color.setHex(color);
    f.mat.opacity = alpha;
    f.spr.visible = true;
    f.spr.scale.setScalar(size * 0.4);
    setPlanar(f.spr.position, x, y, h);
  }

  private flashCap(): number {
    const want = this.tierOf() === "low" ? 1 : this.tierOf() === "mid" ? 3 : 5;
    return Math.min(want, this.flashSlots.length);
  }

  private tickFlashes(now: number) {
    for (let i = 0; i < this.flashSlots.length; i++) {
      const f = this.flashSlots[i];
      if (!f.on) continue;
      if (!(f.t0 > 0)) f.t0 = now;
      const u = (now - f.t0) / f.life;
      if (u >= 1) {
        f.on = false;
        f.spr.visible = false;
        continue;
      }
      f.mat.opacity = f.alpha * (1 - u);
      f.spr.scale.setScalar(f.size * (0.4 + u * 1.4));
    }
  }

  private buildFlashes() {
    const n = this.tierOf() === "low" ? 1 : this.tierOf() === "mid" ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.dot,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const spr = new THREE.Sprite(mat);
      spr.visible = false;
      spr.frustumCulled = false;
      spr.renderOrder = 7;
      spr.name = "skillFlash";
      this.scene.add(spr);
      this.flashSlots.push({ spr, mat, t0: 0, life: 1, alpha: 0, size: 1, on: false });
    }
  }

  private meshForKind(kind: string): THREE.Object3D {
    if (kind === "shade") {
      const g = this.ghosts.pop() || makeGhost(this.dot);
      g.userData.ashX = NaN;
      g.userData.ashAt = 0;
      return g;
    }
    if (kind === "vortex") return this.makeVortex();
    if (kind === "glyph") return this.makeGlyph();
    if (kind === "burn") return this.makeBurn();
    if (kind === "bastion") return this.bastions.pop() || this.makeBastion();
    return this.makeHalo();
  }

  private releaseMesh(kind: string, mesh: THREE.Object3D) {
    if (kind === "shade") {
      if (this.ghosts.length < 4) this.ghosts.push(mesh as THREE.Group);
      return;
    }
    if (kind === "bastion") {
      if (this.bastions.length < 4) {
        this.bastions.push(mesh as THREE.Group);
        return;
      }
      mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.userData?.fxPoolKey) releaseFx(m);
        else if (m.name === "shell" && m.geometry) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
      return;
    }
    mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.userData?.fxPoolKey) releaseFx(m);
    });
  }

  private paintPersist(rec: Persist, now: number) {
    if (!Number.isFinite(rec.x)) {
      rec.x = rec.tx;
      rec.y = rec.ty;
    }
    this.placePersist(rec, now);
  }

  private placePersist(rec: Persist, now: number) {
    const yLift = rec.kind === "shade" ? 0 : 0.06;
    setPlanar(rec.mesh.position, rec.x, rec.y, this.standY(rec.x, rec.y, yLift));
    if (rec.kind === "glyph") {
      const foe = this.foeOf(rec.owner) && rec.owner !== this.youId();
      const pulse = 0.94 + 0.08 * Math.sin(now * 0.0026);
      rec.mesh.scale.setScalar(Math.max(0.6, rec.r) * pulse);
      const moteCap = this.tierOf() === "low" ? 2 : 4;
      let mi = 0;
      rec.mesh.traverse((o) => {
        if (o.name === "mote") {
          const show = mi < moteCap;
          o.visible = show;
          if (show) {
            const a = now * 0.00115 + mi * 1.57;
            const bob = (now * 0.00055 + mi * 0.31) % 1;
            o.position.set(Math.cos(a) * 0.62, 0.12 + bob * 1.05, Math.sin(a) * 0.62);
            const mat = (o as THREE.Mesh).material as THREE.MeshBasicMaterial;
            if (mat) mat.opacity = (foe ? 0.22 : 0.82) * (0.4 + 0.6 * (1 - bob));
          }
          mi++;
          return;
        }
        const m = o as THREE.Mesh;
        const mat = m.material as THREE.MeshBasicMaterial | undefined;
        if (mat && mat.opacity != null && m.userData.baseOp) {
          const breathe = 0.86 + 0.14 * Math.sin(now * 0.0026);
          mat.opacity = (foe ? 0.16 : m.userData.baseOp) * breathe;
        }
      });
    } else if (rec.kind === "burn") {
      rec.mesh.scale.setScalar(Math.max(0.8, rec.r));
    } else if (rec.kind === "vortex") {
      rec.mesh.scale.setScalar(Math.max(0.8, rec.r / 2));
      rec.mesh.rotation.y = now * 0.004;
      this.vortexDust(rec, now);
    } else if (rec.kind === "bastion") {
      const breathe = 0.97 + 0.05 * Math.sin(now * 0.0024);
      rec.mesh.scale.setScalar(Math.max(1.2, rec.r) * breathe);
      setPlanar(rec.mesh.position, rec.x, rec.y, this.standY(rec.x, rec.y, 0.02));
      const show = this.tierOf() === "low" ? 2 : 4;
      const pulse = 0.82 + 0.18 * Math.sin(now * 0.0024);
      let oi = 0;
      const ch = rec.mesh.children;
      for (let i = 0; i < ch.length; i++) {
        const c = ch[i];
        if (c.name === "shell") {
          const mat = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
          mat.opacity = 0.3 * pulse;
        } else if (c.name === "rim") {
          const mat = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
          mat.opacity = 0.62 * pulse;
        } else if (c.name === "orb") {
          c.visible = oi < show;
          if (c.visible) {
            const a = now * 0.0018 + oi * 1.5708;
            c.position.set(Math.cos(a) * 0.78, 0.42 + Math.sin(now * 0.003 + oi) * 0.06, Math.sin(a) * 0.78);
          }
          oi++;
        }
      }
    } else if (rec.kind === "halo") {
      const sc = Math.max(1, rec.r);
      rec.mesh.scale.setScalar(sc);
      rec.mesh.rotation.y = 0;
      const inv = 1 / sc;
      const tier = this.tierOf();
      const show = tier === "low" ? 2 : tier === "mid" ? 4 : 6;
      const breathe = 0.82 + 0.18 * Math.sin(now * 0.0035);
      const ch = rec.mesh.children;
      for (let i = 0; i < ch.length; i++) {
        const c = ch[i] as THREE.Mesh;
        const n = c.name;
        if (n === "haloRing") {
          (c.material as THREE.MeshBasicMaterial).opacity = 0.62 * breathe;
        } else if (n === "haloGlow") {
          (c.material as THREE.MeshBasicMaterial).opacity = 0.08 + 0.04 * breathe;
        } else if (n === "haloCrown") {
          // the crown hovers at a fixed world height and size over the caster
          c.position.y = (1.15 + Math.sin(now * 0.0021) * 0.06) * inv;
          c.scale.setScalar(inv * 1.2);
          (c.material as THREE.MeshBasicMaterial).opacity = 0.42 * breathe;
        } else if (n === "orb" || n === "orbTrail") {
          const k = Number(c.userData.haloI) || 0;
          c.visible = k < show;
          if (!c.visible) continue;
          const dir = k & 1 ? -1 : 1;
          const lag = n === "orbTrail" ? 0.32 : 0;
          const a = now * 0.0021 * dir + (k / 6) * Math.PI * 2 - lag * dir;
          const rad = k & 1 ? 0.62 : 0.86;
          const hy = (k & 1 ? 0.85 : 0.38) + Math.sin(now * 0.004 + k * 1.7) * 0.08;
          c.position.set(Math.cos(a) * rad, hy * inv, Math.sin(a) * rad);
          const base = Number(c.userData.baseScale) || 0.05;
          c.scale.setScalar(base * inv);
        }
      }
    } else if (rec.kind === "shade") {
      rec.mesh.rotation.y = now * 0.0008;
      const glow = 0.7 + 0.3 * Math.sin(now * 0.006);
      const ch = rec.mesh.children;
      for (let i = 0; i < ch.length; i++) {
        const c = ch[i];
        if (c.name !== "eye") continue;
        const mat = (c as THREE.Sprite).material as THREE.SpriteMaterial;
        mat.opacity = glow;
        c.scale.setScalar(0.1 + glow * 0.03);
      }
      this.shadeAsh(rec, now);
    }
  }

  private blankPersist(): Persist {
    return {
      id: "",
      kind: "",
      mesh: new THREE.Group(),
      x: NaN,
      y: NaN,
      tx: 0,
      ty: 0,
      r: 1,
      owner: "",
      seen: 0,
    };
  }

  private aimBox(mesh: THREE.Mesh, x: number, y: number, tx: number, ty: number): number {
    const dx = tx - x;
    const dy = ty - y;
    const len = Math.hypot(dx, dy) || 0.2;
    const mx = x + dx * 0.5;
    const my = y + dy * 0.5;
    mesh.rotation.order = "XYZ";
    mesh.rotation.x = 0;
    mesh.rotation.z = 0;
    mesh.rotation.y = Math.atan2(-dy, dx);
    setPlanar(mesh.position, mx, my, this.standY(mx, my, 0.9));
    return len;
  }

  private makeBeam(): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff2c0,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return new THREE.Mesh(this.beamGeo, mat);
  }

  private makeCleave(): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uOpen: { value: 0.02 },
        uFade: { value: 1 },
        uCore: { value: new THREE.Color(CRIMSON) },
        uEdge: { value: new THREE.Color(BONE) },
      },
      vertexShader: CLEAVE_VERT,
      fragmentShader: CLEAVE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    });
    const mesh = new THREE.Mesh(this.cleaveGeo, mat);
    mesh.renderOrder = 3;
    return mesh;
  }

  private makeLance(): THREE.Group {
    const g = new THREE.Group();
    const glow = new THREE.Mesh(
      this.beamGeo,
      new THREE.MeshBasicMaterial({
        color: GOLD,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        forceSinglePass: true,
      })
    );
    const core = new THREE.Mesh(
      this.beamGeo,
      new THREE.MeshBasicMaterial({
        color: WHITE_FIRE,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        forceSinglePass: true,
      })
    );
    glow.name = "glow";
    core.name = "core";
    glow.renderOrder = 3;
    core.renderOrder = 4;
    g.add(glow, core);
    return g;
  }

  private makeColumn(): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff6a18,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return new THREE.Mesh(new THREE.CylinderGeometry(1, 1.15, 1, 10), mat);
  }

  private makeMotes(): THREE.Group {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const m = acquireFxMote(0.12, 6, 0xf4e2a8, 0.9);
      g.add(m);
    }
    return g;
  }

  private makePuff(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.SpriteMaterial({
      map: this.dot,
      color: 0x3a3544,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    const a = new THREE.Sprite(mat);
    a.scale.setScalar(1.05);
    const b = new THREE.Sprite(mat.clone());
    b.position.set(0.25, 0.3, 0.1);
    b.scale.setScalar(0.45);
    g.add(a, b);
    return g;
  }

  private makeBastion(): THREE.Group {
    const g = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({
        color: PALE_STONE,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    shell.name = "shell";
    shell.scale.y = 0.72;
    shell.position.y = 0.72;
    const rim = acquireFxRing(0.86, 1, 28, BRONZE, 0.62, true);
    rim.name = "rim";
    rim.position.y = 0.06;
    g.add(shell, rim);
    for (let i = 0; i < 4; i++) {
      const m = acquireFxMote(0.08, 5, BRONZE, 0.85);
      m.name = "orb";
      const a = (i / 4) * Math.PI * 2;
      m.position.set(Math.cos(a) * 0.78, 0.42, Math.sin(a) * 0.78);
      g.add(m);
    }
    return g;
  }

  private makeDome(): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xe6d7b0,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat);
    mesh.scale.y = 0.72;
    return mesh;
  }

  private makeGlyph(): THREE.Group {
    const g = new THREE.Group();
    const ring = acquireFxRing(0.72, 1, 24, 0x5a4678, 0.9, false);
    ring.userData.baseOp = 0.8;
    const cross = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.06),
      new THREE.MeshBasicMaterial({
        color: 0xe6d7b0,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    cross.rotation.x = -Math.PI / 2;
    cross.userData.baseOp = 0.85;
    const cross2 = cross.clone();
    cross2.rotation.z = Math.PI / 2;
    cross2.material = (cross.material as THREE.MeshBasicMaterial).clone();
    g.add(ring, cross, cross2);
    for (let i = 0; i < 4; i++) {
      const m = acquireFxMote(0.07, 5, LILAC, 0.8);
      m.name = "mote";
      const a = (i / 4) * Math.PI * 2;
      m.position.set(Math.cos(a) * 0.55, 0.2, Math.sin(a) * 0.55);
      g.add(m);
    }
    return g;
  }

  private makeBurn(): THREE.Group {
    const g = new THREE.Group();
    const decal = acquireFxRing(0.2, 1, 20, 0xff5520, 0.45, true);
    decal.userData.baseOp = 0.45;
    g.add(decal);
    return g;
  }

  private makeVortex(): THREE.Group {
    const g = new THREE.Group();
    const a = acquireFxRing(0.55, 0.75, 24, 0xd0e4ff, 0.55, true);
    const b = acquireFxRing(0.85, 1, 28, 0xe6d7b0, 0.4, true);
    b.position.y = 0.35;
    g.add(a, b);
    return g;
  }

  /**
   * Halo (Faith): a warm gold ground ring with a faint inner glow, a thin crown ring
   * that hovers at chest height, and gold/white sparks orbiting at two heights with a
   * dimmer spark trailing each. Sizes are kept in world units however wide the halo
   * is (placePersist undoes the group's radius scale for the sparks).
   */
  private makeHalo(): THREE.Group {
    const g = new THREE.Group();
    const ring = acquireFxRing(0.95, 1, 48, 0xf4d27a, 0.6, true);
    ring.position.y = 0.12;
    ring.name = "haloRing";
    const inner = acquireFxRing(0.18, 0.88, 32, 0xb8862a, 0.16, true);
    inner.position.y = 0.1;
    inner.name = "haloGlow";
    const crown = acquireFxRing(0.5, 0.56, 32, 0xfff0c8, 0.5, true);
    crown.position.y = 1.15;
    crown.name = "haloCrown";
    g.add(ring, inner, crown);
    for (let i = 0; i < 6; i++) {
      const lead = acquireFxMote(0.085, 6, i & 1 ? 0xfff0c8 : 0xffc860, 0.8);
      lead.name = "orb";
      lead.userData.haloI = i;
      const trail = acquireFxMote(0.05, 6, 0xd8a040, 0.4);
      trail.name = "orbTrail";
      trail.userData.haloI = i;
      g.add(lead, trail);
    }
    return g;
  }

  private releasePool(pool: string, mesh: THREE.Object3D) {
    mesh.visible = false;
    if (pool === "ring") {
      releaseFx(mesh as THREE.Mesh);
      return;
    }
    if (pool === "beam" && this.beams.length < 8) this.beams.push(mesh as THREE.Mesh);
    else if (pool === "cleave" && this.cleaves.length < 4) this.cleaves.push(mesh as THREE.Mesh);
    else if (pool === "column" && this.columns.length < 4) this.columns.push(mesh as THREE.Mesh);
    else if (pool === "dome" && this.domes.length < 4) this.domes.push(mesh as THREE.Mesh);
    else if (pool === "lance" && this.lances.length < 4) this.lances.push(mesh as THREE.Group);
    else if (pool === "emit" && this.blanks.length < 16) this.blanks.push(mesh);
    else if (pool === "motes" && this.moteGroups.length < 6) {
      this.moteGroups.push(mesh as THREE.Group);
    } else if (pool === "puff" && this.puffs.length < 8) this.puffs.push(mesh as THREE.Group);
    else if (pool === "motes") {
      mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.userData?.fxPoolKey) releaseFx(m);
      });
    }
  }

  private markHits(hits: string[], kind: "stun" | "root" | "slow" | "weak", seconds: number, now: number) {
    const until = now + seconds * 1000;
    for (let i = 0; i < hits.length; i++) {
      const id = String(hits[i]);
      let row = this.overlay.get(id);
      if (!row) {
        row = { stun: 0, root: 0, slow: 0, weak: 0, until: 0 };
        this.overlay.set(id, row);
      }
      row.until = Math.max(row.until, until);
      if (kind === "stun") row.stun = seconds;
      else if (kind === "root") row.root = seconds;
      else if (kind === "slow") row.slow = seconds;
      else row.weak = seconds;
    }
  }

  private tagAt(i: number): StatusTag {
    if (this.tags[i]) return this.tags[i];
    const group = new THREE.Group();
    const stun: THREE.Sprite[] = [];
    const n = this.tierOf() === "low" ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const mat = new THREE.SpriteMaterial({
        map: this.dot,
        color: 0xe6d7b0,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.scale.setScalar(0.16);
      group.add(s);
      stun.push(s);
    }
    const root = new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.035, 6, 14),
      new THREE.MeshBasicMaterial({ color: 0xe6d7b0, transparent: true, opacity: 0.8, depthWrite: false })
    );
    root.rotation.x = Math.PI / 2;
    root.position.y = 0.35;
    const slow = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0x88a8c8,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    slow.position.y = 1;
    slow.scale.set(0.7, 1.3, 0.7);
    const weak = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0x2a1818,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    weak.position.y = 1;
    weak.scale.set(0.75, 1.35, 0.75);
    group.add(root, slow, weak);
    group.visible = false;
    this.scene.add(group);
    const tag: StatusTag = { id: "", group, stun, root, slow, weak, used: 0 };
    this.tags.push(tag);
    return tag;
  }
}

function cleaveGeo(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  // 120° fan opening toward local +X. Laid flat, that axis is yawed onto the aim.
  shape.absarc(0, 0, 1, -Math.PI / 3, Math.PI / 3, false);
  shape.lineTo(0, 0);
  return new THREE.ShapeGeometry(shape, 10);
}

function makeGhost(dot: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x1c2230,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 1.15, 7), mat);
  body.position.y = 0.75;
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat);
  hood.position.y = 1.5;
  const armGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.7, 5);
  const armL = new THREE.Mesh(armGeo, mat);
  armL.position.set(-0.28, 1.05, 0.05);
  armL.rotation.z = 0.4;
  const armR = new THREE.Mesh(armGeo, mat);
  armR.position.set(0.28, 1.05, 0.05);
  armR.rotation.z = -0.4;
  const eyeMat = new THREE.SpriteMaterial({
    map: dot,
    color: VIOLET,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const eyeL = new THREE.Sprite(eyeMat);
  eyeL.name = "eye";
  eyeL.position.set(-0.07, 1.54, 0.16);
  eyeL.scale.setScalar(0.11);
  eyeL.frustumCulled = false;
  eyeL.renderOrder = 6;
  const eyeR = new THREE.Sprite(eyeMat.clone());
  eyeR.name = "eye";
  eyeR.position.set(0.07, 1.54, 0.16);
  eyeR.scale.setScalar(0.11);
  eyeR.frustumCulled = false;
  eyeR.renderOrder = 6;
  g.add(body, hood, armL, armR, eyeL, eyeR);
  g.scale.setScalar(0.95);
  return g;
}

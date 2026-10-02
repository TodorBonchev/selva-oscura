/**
 * Skill visuals. One-shots come from spell_fx. Glyphs, burns, shades, vortices
 * and halos follow room.skillFx so a late joiner still sees them.
 * Meshes are pooled. Tick does not allocate.
 */
import * as THREE from "three";
import { setPlanar } from "./frames";
import { acquireFxMote, acquireFxRing, releaseFx, softDotTexture } from "./fx";

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

export class SkillVfx {
  private scene: THREE.Scene;
  private standY: (x: number, y: number, h?: number) => number;
  private tierOf: () => SkillFxTier;
  private youId: () => string;
  private foeOf: (ownerId: string) => boolean;
  private posOf: (id: string) => { x: number; y: number } | null;
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
  private moteGroups: THREE.Group[] = [];
  private puffs: THREE.Group[] = [];
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
    }
  ) {
    this.scene = scene;
    this.standY = opts.standY;
    this.tierOf = opts.tier;
    this.youId = opts.youId;
    this.foeOf = opts.foeOf;
    this.posOf = opts.posOf;
    this.beamGeo = new THREE.BoxGeometry(1, 0.08, 0.12);
    this.cleaveGeo = cleaveGeo();
    this.dot = softDotTexture();
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
    const id = String(msg.spellId || "");
    if (id === "gale_bolt" || id === "whirl_ward" || id === "infernal_burst") return false;
    const x = Number(msg.x) || 0;
    const y = Number(msg.y) || 0;
    const tx = Number(msg.tx ?? msg.x) || x;
    const ty = Number(msg.ty ?? msg.y) || y;
    const radius = Number(msg.radius) || 2;
    const dur = Number(msg.duration) || 0.4;
    const owner = String(msg.casterId || "");
    const hits = Array.isArray(msg.hits) ? msg.hits : [];
    if (id === "furious_cleave") this.cleave(x, y, tx, ty, radius, now);
    else if (id === "wrath_charge") {
      this.beam(x, y, tx, ty, now, 0.55, 0xf0d8a0, 0.42);
      this.markHits(hits, "stun", 0.6, now);
    } else if (id === "war_cry") {
      this.ring(x, y, Math.max(0.8, radius * 0.45), radius, now, 620, 0xf0d8a0, 0.92, false);
      this.markHits(hits, "weak", Math.min(4, dur), now);
    } else if (id === "earthsplitter") {
      this.beam(x, y, tx, ty, now, 0.6, 0xe6d2a0, 0.72);
      this.markHits(hits, "slow", 0.8, now);
    } else if (id === "lance_of_light") this.beam(x, y, tx, ty, now, 0.48, 0xfff6d0, 0.32);
    else if (id === "grace") this.motes(x, y, now, Math.max(0.8, Math.min(dur, 2)) * 1000, 0xf4e2a8);
    else if (id === "pillar_of_flame") {
      if (dur >= 0.5 && hits.length === 0) this.ring(x, y, radius * 0.7, radius, now, dur * 1000, 0xff8840, 0.85);
      else this.column(x, y, radius, now, 1400, 0xff6a18);
    } else if (id === "halo") this.ring(x, y, radius * 0.85, radius, now, 420, 0xf0e0a0, 0.7);
    else if (id === "shadow_step") {
      this.puff(x, y, now);
      this.puff(tx, ty, now);
    } else if (id === "snare_glyph") {
      if (dur <= 0.35 && hits.length) {
        this.ring(x, y, 0.3, radius, now, 280, 0xc8b8e0, 0.9);
        this.markHits(hits, "root", 1.2, now);
      }
    } else if (id === "tempest") this.ring(x, y, 0.5, radius, now, 360, 0xd0e4ff, 0.7);
    else if (id === "bastion") this.dome(x, y, radius || 1.8, now, dur * 1000, owner);
    else if (id === "last_stand") {
      this.column(x, y, 0.7, now, 900, 0xf0d080);
      this.ring(x, y, 0.4, 1.6, now, 700, 0xf0d080, 0.9);
    }
    return true;
  }

  levelUp(x: number, y: number, big: boolean, now: number) {
    const r = big ? 1.8 : 0.9;
    this.column(x, y, big ? 1.8 : 1.05, now, big ? 1100 : 560, 0xf0d080);
    this.ring(x, y, 0.35, r, now, big ? 800 : 460, 0xf0d080, big ? 0.9 : 0.55, false);
    if (big) this.motes(x, y, now, 800, 0xf6e2a4);
  }

  sparkThorns(x: number, y: number, now: number) {
    this.motes(x, y, now, 280, 0xe8c86a);
    this.ring(x, y, 0.2, 0.8, now, 240, 0xe8c86a, 0.8);
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
    if (this.aim && !this.aimOn) this.aim.visible = false;
    let w = 0;
    for (let i = 0; i < this.shots.length; i++) {
      const s = this.shots[i];
      const u = (now - s.t0) / s.life;
      if (u >= 1) {
        this.scene.remove(s.mesh);
        this.releasePool(s.pool, s.mesh);
        continue;
      }
      this.poseShot(s, u, now);
      this.shots[w++] = s;
    }
    this.shots.length = w;
    for (const rec of this.persist.values()) {
      if (!rec.mesh.visible) continue;
      rec.x += (rec.tx - rec.x) * 0.35;
      rec.y += (rec.ty - rec.y) * 0.35;
      if (rec.kind === "halo" || rec.kind === "shade") {
        const follow = rec.kind === "halo" ? this.posOf(rec.owner) : null;
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
    this.setAim(false);
    this.endStatuses();
    this.tagUsed = 0;
    for (const t of this.tags) t.group.visible = false;
  }

  private poseShot(s: Shot, u: number, now: number) {
    const fade = 1 - u;
    if (s.kind === KIND_RING) {
      const mesh = s.mesh as THREE.Mesh;
      mesh.scale.setScalar(s.r0 + (s.r1 - s.r0) * u);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.85 * fade;
    } else if (s.kind === KIND_BEAM) {
      const mat = (s.mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = 0.9 * fade;
    } else if (s.kind === KIND_CLEAVE) {
      const mesh = s.mesh as THREE.Mesh;
      mesh.scale.setScalar(s.r0 * (0.85 + u * 0.2));
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.92 * Math.max(0.35, fade);
    } else if (s.kind === KIND_COLUMN) {
      const mesh = s.mesh as THREE.Mesh;
      const h = s.r1 * (0.72 + u * 0.28);
      mesh.scale.set(s.r0, h, s.r0);
      mesh.position.y = this.standY(s.x, s.y, h * 0.5);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.84 * Math.max(0.4, fade);
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
      for (let i = 0; i < n; i++) {
        const c = g.children[i];
        const a = (i / n) * Math.PI * 2 + now * 0.003;
        const rad = 0.35 + u * 0.8;
        c.position.set(Math.cos(a) * rad, 0.4 + u * 1.6, Math.sin(a) * rad);
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
    additive = true
  ) {
    const mesh = acquireFxRing(0.82, 1, this.tierOf() === "low" ? 20 : 32, color, opacity, additive);
    setPlanar(mesh.position, x, y, this.standY(x, y, 0.08));
    mesh.scale.setScalar(r0);
    this.scene.add(mesh);
    this.shots.push({
      mesh, t0: now, life, kind: KIND_RING, x, y, x1: x, y1: y, r0, r1, owner: "", pool: "ring",
    });
  }

  private beam(x: number, y: number, tx: number, ty: number, now: number, life: number, color: number, thick: number) {
    const mesh = this.beams.pop() || this.makeBeam();
    const len = this.aimBox(mesh, x, y, tx, ty);
    mesh.scale.set(Math.max(0.2, len), thick / 0.08, 1);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = 0.9;
    mesh.visible = true;
    this.scene.add(mesh);
    this.shots.push({
      mesh, t0: now, life: life * 1000, kind: KIND_BEAM, x, y, x1: tx, y1: ty, r0: thick, r1: 0, owner: "", pool: "beam",
    });
  }

  private cleave(x: number, y: number, tx: number, ty: number, radius: number, now: number) {
    const mesh = this.cleaves.pop() || this.makeCleave();
    const dx = tx - x;
    const dy = ty - y;
    // Fan opens toward local +X. Lay it on the ground (rotation.x = -π/2 keeps +X in the
    // ground plane) and yaw so that +X matches the aim. Check: aim (0, +1) → yaw -π/2 →
    // local +X lands on world +Z.
    mesh.rotation.order = "YXZ";
    mesh.rotation.y = Math.atan2(-dy, dx);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = 0;
    mesh.scale.setScalar(Math.max(1.4, radius));
    setPlanar(mesh.position, x, y, this.standY(x, y, 0.22));
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.92;
    mesh.visible = true;
    this.scene.add(mesh);
    this.shots.push({
      mesh, t0: now, life: 700, kind: KIND_CLEAVE, x, y, x1: tx, y1: ty, r0: radius, r1: radius, owner: "", pool: "cleave",
    });
    this.ring(x, y, Math.max(0.4, radius * 0.25), radius, now, 520, 0xffe6b0, 0.8, false);
  }

  private column(x: number, y: number, radius: number, now: number, life: number, color: number) {
    const mesh = this.columns.pop() || this.makeColumn();
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = 0.86;
    const girth = Math.max(1.25, radius * 0.55);
    const h = Math.max(4.6, radius * 2.3);
    mesh.scale.set(girth, h, girth);
    setPlanar(mesh.position, x, y, this.standY(x, y, h * 0.5));
    mesh.visible = true;
    this.scene.add(mesh);
    this.shots.push({
      mesh, t0: now, life, kind: KIND_COLUMN, x, y, x1: x, y1: y, r0: girth, r1: h, owner: "", pool: "column",
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
      mesh: g, t0: now, life, kind: KIND_MOTES, x, y, x1: x, y1: y, r0: 0.4, r1: 1, owner: "", pool: "motes",
    });
  }

  private puff(x: number, y: number, now: number) {
    const g = this.puffs.pop() || this.makePuff();
    setPlanar(g.position, x, y, this.standY(x, y, 0.8));
    g.scale.setScalar(0.4);
    g.visible = true;
    this.scene.add(g);
    this.shots.push({
      mesh: g, t0: now, life: 560, kind: KIND_PUFF, x, y, x1: x, y1: y, r0: 0.7, r1: 1.8, owner: "", pool: "puff",
    });
  }

  private dome(x: number, y: number, radius: number, now: number, life: number, owner: string) {
    const mesh = this.domes.pop() || this.makeDome();
    mesh.scale.setScalar(Math.max(1.2, radius));
    setPlanar(mesh.position, x, y, this.standY(x, y, 1.1));
    mesh.visible = true;
    this.scene.add(mesh);
    this.shots.push({
      mesh, t0: now, life: Math.max(400, life), kind: KIND_DOME, x, y, x1: x, y1: y, r0: radius, r1: radius, owner, pool: "dome",
    });
  }

  private meshForKind(kind: string): THREE.Object3D {
    if (kind === "shade") return this.ghosts.pop() || makeGhost();
    if (kind === "vortex") return this.makeVortex();
    if (kind === "glyph") return this.makeGlyph();
    if (kind === "burn") return this.makeBurn();
    return this.makeHalo();
  }

  private releaseMesh(kind: string, mesh: THREE.Object3D) {
    if (kind === "shade") {
      if (this.ghosts.length < 4) this.ghosts.push(mesh as THREE.Group);
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
      rec.mesh.scale.setScalar(Math.max(0.6, rec.r));
      rec.mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        const mat = m.material as THREE.MeshBasicMaterial | undefined;
        if (mat && mat.opacity != null && m.userData.baseOp) mat.opacity = foe ? 0.16 : m.userData.baseOp;
      });
    } else if (rec.kind === "burn") {
      rec.mesh.scale.setScalar(Math.max(0.8, rec.r));
    } else if (rec.kind === "vortex") {
      rec.mesh.scale.setScalar(Math.max(0.8, rec.r / 2));
      rec.mesh.rotation.y = now * 0.004;
    } else if (rec.kind === "halo") {
      rec.mesh.scale.setScalar(Math.max(1, rec.r));
      rec.mesh.rotation.y = now * 0.0015;
    } else if (rec.kind === "shade") {
      rec.mesh.rotation.y = now * 0.0008;
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
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe6b0,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return new THREE.Mesh(this.cleaveGeo, mat);
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

  private makeHalo(): THREE.Group {
    const g = new THREE.Group();
    const ring = acquireFxRing(0.9, 1, 32, 0xf0e0a0, 0.55, true);
    ring.position.y = 0.15;
    g.add(ring);
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
    else if (pool === "column" && this.columns.length < 3) this.columns.push(mesh as THREE.Mesh);
    else if (pool === "dome" && this.domes.length < 4) this.domes.push(mesh as THREE.Mesh);
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

function makeGhost(): THREE.Group {
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
  g.add(body, hood, armL, armR);
  g.scale.setScalar(0.95);
  return g;
}

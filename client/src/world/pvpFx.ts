/**
 * Pooled PvP juice: windup cones, duel rings, respawn shimmer, hero hit flash.
 * Shared geometries and materials. No real lights. Fades use performance.now
 * so hit-stop cannot freeze a telegraph the victim still has to read.
 *
 * Cone is authored in XZ with apex at the origin and arc along local −Z
 * (Object3D forward). rotation.y = yawFromPlanar(fx, fy) aims it.
 */
import * as THREE from "three";
import { markShared, sharedGeo, sharedMat } from "./dispose";
import { yawFromPlanar } from "./frames";

const CONE_N = 6;
const RING_N = 4;
const FLASH_N = 8;
const CONE_R = 3.9;
const CONE_ANG = Math.acos(0.2);

type ConeSlot = {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  until: number;
  born: number;
  ms: number;
  peak: number;
  on: boolean;
};

type RingSlot = {
  group: THREE.Group;
  spin: THREE.Group;
  runes: THREE.Group;
  id: string;
  stamp: number;
  on: boolean;
};

type FlashSlot = {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  at: number;
  dur: number;
  peak: number;
  on: boolean;
};

function coneGeometry(): THREE.BufferGeometry {
  const seg = 8;
  const positions: number[] = [];
  const index: number[] = [];
  positions.push(0, 0, 0);
  for (let i = 0; i <= seg; i++) {
    const a = -CONE_ANG + (2 * CONE_ANG * i) / seg;
    positions.push(Math.sin(a) * CONE_R, 0, -Math.cos(a) * CONE_R);
  }
  for (let i = 0; i < seg; i++) index.push(0, i + 1, i + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function dashTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 16;
  const g = c.getContext("2d");
  if (g) {
    g.clearRect(0, 0, 256, 16);
    g.fillStyle = "#e4c060";
    for (let i = 0; i < 16; i++) g.fillRect(i * 16, 2, 8, 12);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  return markShared(t);
}

export class PvpFx {
  private cones: ConeSlot[] = [];
  private rings: RingSlot[] = [];
  private flashes: FlashSlot[] = [];
  private shimmerMat: THREE.MeshBasicMaterial;
  private shimmerGeo: THREE.BufferGeometry;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const coneGeo = sharedGeo("pvpCone", coneGeometry);
    for (let i = 0; i < CONE_N; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xf0d8a0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(coneGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.cones.push({ mesh, mat, until: 0, born: 0, ms: 120, peak: 0.22, on: false });
    }

    const dashMap = dashTexture();
    const dashGeo = sharedGeo("pvpRingDash", () => new THREE.RingGeometry(8.55, 9.15, 48));
    const runeGeo = sharedGeo("pvpRune", () => new THREE.BoxGeometry(0.28, 0.08, 0.55));
    const runeMat = sharedMat(
      "pvpRune",
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xf0e2b0,
          transparent: true,
          opacity: 0.85,
        })
    );
    for (let i = 0; i < RING_N; i++) {
      const group = new THREE.Group();
      group.visible = false;
      const mat = new THREE.MeshBasicMaterial({
        map: dashMap,
        color: 0xe8c86a,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const dashes = new THREE.Mesh(dashGeo, mat);
      dashes.rotation.x = -Math.PI / 2;
      const spin = new THREE.Group();
      spin.add(dashes);
      const runes = new THREE.Group();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const box = new THREE.Mesh(runeGeo, runeMat);
        box.position.set(Math.cos(a) * 8.7, 0.12, Math.sin(a) * 8.7);
        box.rotation.y = -a;
        runes.add(box);
      }
      const halo = new THREE.Mesh(
        sharedGeo("pvpRingHalo", () => new THREE.RingGeometry(8.9, 9.35, 40)),
        sharedMat(
          "pvpRingHalo",
          () =>
            new THREE.MeshBasicMaterial({
              color: 0xc9a227,
              transparent: true,
              opacity: 0.35,
              depthWrite: false,
              side: THREE.DoubleSide,
            })
        )
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.04;
      group.add(halo, spin, runes);
      scene.add(group);
      this.rings.push({ group, spin, runes, id: "", stamp: 0, on: false });
    }

    const flashGeo = sharedGeo("pvpHeroFlash", () => new THREE.SphereGeometry(0.42, 8, 6));
    for (let i = 0; i < FLASH_N; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xfff3c4,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(flashGeo, mat);
      mesh.visible = false;
      mesh.name = "pvpFlash";
      mesh.position.set(0, 1.15, 0);
      // a body-shaped glint, not a ball over the hero
      mesh.scale.set(1, 1.7, 1);
      this.flashes.push({ mesh, mat, at: 0, dur: 140, peak: 0.7, on: false });
    }

    this.shimmerGeo = sharedGeo("pvpShimmer", () => new THREE.SphereGeometry(0.6, 10, 8));
    this.shimmerMat = sharedMat(
      "pvpShimmer",
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xf0d48a,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
    );
  }

  windup(x: number, y: number, z: number, fx: number, fy: number, heavy: boolean, ms: number, now: number) {
    let slot: ConeSlot | null = null;
    for (let i = 0; i < this.cones.length; i++) {
      const c = this.cones[i]!;
      if (!c.on) {
        slot = c;
        break;
      }
    }
    if (!slot) slot = this.cones[0]!;
    slot.on = true;
    slot.born = now;
    slot.ms = Math.max(80, ms);
    slot.until = now + slot.ms;
    slot.peak = heavy ? 0.62 : 0.26;
    slot.mat.color.setHex(heavy ? 0xffe6a8 : 0xf0d8a0);
    slot.mat.opacity = slot.peak;
    slot.mesh.visible = true;
    slot.mesh.position.set(x, y, z);
    slot.mesh.rotation.y = yawFromPlanar(fx, fy);
    slot.mesh.scale.setScalar(heavy ? 1 : 0.92);
  }

  /** Show one ring per live countdown/fight duel. `yAt` is stand height. Authored at r = 9. */
  syncRings(
    duels: readonly { id: string; cx: number; cy: number; r: number; phase: string }[],
    yAt: (x: number, y: number) => number
  ) {
    const stamp = (this.rings[0]?.stamp ?? 0) + 1;
    for (let i = 0; i < duels.length; i++) {
      const d = duels[i]!;
      if (d.phase !== "countdown" && d.phase !== "fight") continue;
      let slot: RingSlot | undefined;
      for (let k = 0; k < this.rings.length; k++) {
        const s = this.rings[k]!;
        if (s.on && s.id === d.id) {
          slot = s;
          break;
        }
      }
      if (!slot) {
        for (let k = 0; k < this.rings.length; k++) {
          const s = this.rings[k]!;
          if (!s.on) {
            slot = s;
            break;
          }
        }
      }
      if (!slot) continue;
      slot.on = true;
      slot.id = d.id;
      slot.stamp = stamp;
      slot.group.visible = true;
      slot.group.position.set(d.cx, yAt(d.cx, d.cy), d.cy);
      const sc = (d.r || 9) / 9;
      slot.group.scale.setScalar(sc);
    }
    for (let k = 0; k < this.rings.length; k++) {
      const s = this.rings[k]!;
      if (s.stamp !== stamp) {
        s.on = false;
        s.id = "";
        s.group.visible = false;
        s.stamp = stamp;
      }
    }
  }

  tick(now: number, rawDt: number) {
    for (let i = 0; i < this.cones.length; i++) {
      const c = this.cones[i]!;
      if (!c.on) continue;
      const u = (now - c.born) / c.ms;
      if (u >= 1) {
        c.on = false;
        c.mesh.visible = false;
        c.mat.opacity = 0;
        continue;
      }
      c.mat.opacity = c.peak * (1 - u);
    }
    const spin = rawDt > 0 && rawDt < 0.2 ? rawDt : 0.016;
    for (let i = 0; i < this.rings.length; i++) {
      const s = this.rings[i]!;
      if (!s.on) continue;
      s.spin.rotation.y += spin * 0.45;
      s.runes.rotation.y -= spin * 0.28;
    }
    const pulse = 0.09 + Math.sin(now * 0.008) * 0.05;
    this.shimmerMat.opacity = pulse;
    for (let i = 0; i < this.flashes.length; i++) {
      const f = this.flashes[i]!;
      if (!f.on) continue;
      const u = (now - f.at) / f.dur;
      if (u >= 1) {
        f.on = false;
        f.mesh.visible = false;
        f.mat.opacity = 0;
        continue;
      }
      f.mat.opacity = f.peak * (1 - u);
    }
  }

  shimmer(group: THREE.Object3D, on: boolean) {
    let mesh = group.userData.pvpShimmer as THREE.Mesh | undefined;
    if (!mesh) {
      mesh = new THREE.Mesh(this.shimmerGeo, this.shimmerMat);
      mesh.name = "pvpShimmer";
      mesh.position.set(0, 1.15, 0);
      mesh.scale.set(1, 1.35, 1);
      mesh.visible = false;
      group.add(mesh);
      group.userData.pvpShimmer = mesh;
    }
    if (mesh.visible !== on) mesh.visible = on;
  }

  flashHero(group: THREE.Object3D, heavy: boolean, now: number) {
    let slot: FlashSlot | null = null;
    for (let i = 0; i < this.flashes.length; i++) {
      const f = this.flashes[i]!;
      if (!f.on) {
        slot = f;
        break;
      }
    }
    if (!slot) slot = this.flashes[0]!;
    if (slot.mesh.parent && slot.mesh.parent !== group) slot.mesh.parent.remove(slot.mesh);
    if (slot.mesh.parent !== group) group.add(slot.mesh);
    slot.on = true;
    slot.at = now;
    slot.dur = heavy ? 180 : 120;
    slot.peak = heavy ? 0.42 : 0.26;
    slot.mat.opacity = slot.peak;
    slot.mesh.visible = true;
    slot.mesh.position.set(0, 1.15, 0);
  }

  /** Detach pooled flashes before the hero group is disposed. Shimmer geo/mat are shared. */
  releaseHero(group: THREE.Object3D) {
    for (let i = 0; i < this.flashes.length; i++) {
      const f = this.flashes[i]!;
      if (f.mesh.parent === group) {
        group.remove(f.mesh);
        f.on = false;
        f.mesh.visible = false;
        f.mat.opacity = 0;
      }
    }
  }
}

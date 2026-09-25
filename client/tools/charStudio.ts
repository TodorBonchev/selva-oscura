/**
 * Dev-only character studio: renders the real wanderer rig with game materials
 * and Dark Wood lighting in a grid of views (close-ups + in-game scale).
 *
 *   npm run dev → http://localhost:5173/tools/char-studio.html
 *   ?anim=idle|walk|attack  &t=<ms>  &u=<attack phase 0..1>  &slash=0 (no trail)
 *   &hide=<joint,names>  &who=guide (the Virgil NPC palette)
 *
 * Not part of the production build (Vite only bundles index.html).
 */
import * as THREE from "three";
import { loadMatKit } from "../src/world/materials";
import { makeGuide, makeWanderer } from "../src/world/meshes";
import { tickHumanoid } from "../src/world/anim";
import { applyEquippedLook } from "../src/world/gearLook";
import { makeSlashTrail, tickSlashTrail } from "../src/world/fx";

const q = new URLSearchParams(location.search);
const anim = q.get("anim") || "idle";
const tMs = Number(q.get("t") || 900);
const hide = new Set((q.get("hide") || "").split(",").filter(Boolean));
const who = q.get("who") === "guide" ? "guide" : "pilgrim";

const FULL = {
  Head: { id: "h" },
  Chest: { id: "c" },
  Hands: { id: "g" },
  Feet: { id: "f" },
  MainHand: { id: "w" },
  OffHand: { id: "o" },
};

type View = {
  label: string;
  gear: "none" | "full";
  /** camera offset from hero feet (world units) and look height */
  cam: [number, number, number];
  lookY: number;
  fov: number;
};

// In-game portrait: camera (9.8, 13.2, 9.8), fov 54 over 844 css px ≈ 43 px/unit.
// A 500 px cell at that scale needs fov ≈ 34° — the hero lands ~110 px tall, as on a phone.
const views: View[] = [
  { label: "bare · front 3/4", gear: "none", cam: [2.3, 2.6, -4.8], lookY: 1.3, fov: 34 },
  { label: "bare · side", gear: "none", cam: [5.4, 2.0, -0.4], lookY: 1.3, fov: 34 },
  { label: "bare · in-game scale", gear: "none", cam: [9.8, 13.2, 9.8], lookY: 1.3, fov: 34 },
  { label: "geared · front 3/4", gear: "full", cam: [-2.4, 2.6, -4.7], lookY: 1.3, fov: 34 },
  { label: "geared · back 3/4", gear: "full", cam: [3.0, 2.8, 4.4], lookY: 1.3, fov: 34 },
  { label: "geared · in-game scale", gear: "full", cam: [9.8, 13.2, 9.8], lookY: 1.3, fov: 34 },
];

const COLS = 3;
const ROWS = 2;

async function main() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = true;
  renderer.setScissorTest(true);
  document.body.appendChild(renderer.domElement);

  const mats = await loadMatKit(renderer);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.HemisphereLight(0xf0e0c0, 0x22180c, 1.35));

  const scenes = views.map((v) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1c1812);
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    scene.add(new THREE.HemisphereLight(0xe8d4b0, 0x1a1410, 1.12));
    scene.add(new THREE.AmbientLight(0x8a7a62, 0.48));
    const sun = new THREE.DirectionalLight(0xffe6c0, 1.85);
    sun.position.set(14, 22, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x88aacc, 0.55);
    fill.position.set(-12, 10, -8);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe0b0, 1.7);
    rim.position.set(-10, 9, -12);
    scene.add(rim);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(30, 48),
      new THREE.MeshStandardMaterial({ map: mats.leather.map, color: 0x4a3e2c, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const hero = who === "guide" ? makeGuide(mats) : makeWanderer(mats);
    hero.scale.multiplyScalar(1.42);
    const heroLight = new THREE.PointLight(0xffc878, 3.4, 9, 1.6);
    heroLight.position.set(0.08, 1.15, -0.42);
    hero.add(heroLight);
    // The Guide wears its own fixed look (see makeGuide); gear views apply to the pilgrim
    if (who === "pilgrim") applyEquippedLook(hero, v.gear === "full" ? FULL : {});
    if (hide.size) hero.traverse((o) => { if (hide.has(o.name)) o.visible = false; });
    scene.add(hero);
    tickHumanoid(hero, {
      moving: anim === "walk",
      tMs: 0,
      attacking: false,
      speed: anim === "walk" ? 8 : 0,
    });
    // settle move weight, then pose at t
    for (let k = 1; k <= 30; k++) {
      tickHumanoid(hero, {
        moving: anim === "walk",
        tMs: (tMs * k) / 30,
        attacking: anim === "attack" && k === 30,
        attackU: Number(q.get("u") || 0.34),
        speed: anim === "walk" ? 8 : 0,
      });
    }
    if (anim === "attack" && q.get("slash") !== "0") {
      const u = Number(q.get("u") || 0.34);
      const slash = makeSlashTrail();
      const anchor = hero.getObjectByName("slashAnchor") || hero;
      anchor.add(slash);
      tickSlashTrail(slash, u);
      slash.visible = true;
    }
    const cam = new THREE.PerspectiveCamera(v.fov, 1, 0.1, 200);
    cam.position.set(v.cam[0], v.cam[1], v.cam[2]);
    cam.lookAt(0, v.lookY, 0);
    return { scene, cam };
  });

  const labels = document.getElementById("labels")!;
  const render = () => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cw = W / COLS;
    const ch = H / ROWS;
    labels.innerHTML = "";
    views.forEach((v, i) => {
      const cx = (i % COLS) * cw;
      const cy = Math.floor(i / COLS) * ch;
      const { scene, cam } = scenes[i]!;
      cam.aspect = cw / ch;
      cam.updateProjectionMatrix();
      renderer.setViewport(cx, H - cy - ch, cw, ch);
      renderer.setScissor(cx, H - cy - ch, cw, ch);
      renderer.render(scene, cam);
      const span = document.createElement("span");
      span.textContent = v.label;
      span.style.left = `${cx + 6}px`;
      span.style.top = `${cy + 6}px`;
      labels.appendChild(span);
    });
    (window as unknown as { __studioReady?: boolean }).__studioReady = true;
  };
  render();
  window.addEventListener("resize", render);
}

void main();

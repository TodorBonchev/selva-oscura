/**
 * Portal veil: four vertical curtains on the canto bounds. Crossing one wraps
 * the pilgrim to the opposite edge (see world/wrap.ts). One shared shader,
 * one draw call per side, no textures.
 */
import * as THREE from "three";
import type { Tier } from "./quality";
import type { Bounds } from "./wrap";

const VEIL_H = 5.6;
const GROUND_LIFT = 0.04;

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldN;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  uniform float uFresnel;
  uniform vec2 uHero;
  varying vec2 vUv;
  varying vec3 vWorldN;
  varying vec3 vWorldPos;
  void main() {
    float y = vUv.y;
    float lift = pow(1.0 - y, 1.35);
    float scroll = vUv.x * 6.28318 + y * 2.0;
    float bands = 0.5
      + 0.28 * sin(scroll * 3.0 + uTime * 0.65)
      + 0.16 * sin(scroll * 7.0 - uTime * 1.15 + y * 5.0)
      + 0.08 * sin(vUv.x * 40.0 + uTime * 1.8);
    bands = clamp(bands, 0.0, 1.0);
    // linear-space bone-gold / ash (sRGB #d8c08a / #8a8378); the output is encoded below
    vec3 gold = vec3(0.69, 0.52, 0.25);
    vec3 ash = vec3(0.26, 0.23, 0.19);
    vec3 col = mix(ash, gold, bands * (0.35 + 0.65 * lift));
    float fres = 0.0;
    if (uFresnel > 0.5) {
      vec3 N = normalize(vWorldN);
      vec3 V = normalize(cameraPosition - vWorldPos);
      fres = pow(1.0 - abs(dot(N, V)), 1.7);
    }
    float alpha = lift * lift * (0.035 + 0.06 * bands);
    alpha += fres * lift * 0.035;
    float line = (1.0 - smoothstep(0.0, 0.035, y)) * (0.55 + 0.45 * sin(vUv.x * 36.0 + uTime * 2.2));
    col += gold * line * 0.55;
    alpha += line * 0.22;
    // The veil parts round the pilgrim (the near curtain never hides the hero)
    float part = smoothstep(1.2, 4.5, distance(vWorldPos.xz, uHero));
    alpha *= uAlpha * mix(0.25, 1.0, part);
    alpha = clamp(alpha, 0.0, 0.55);
    if (alpha < 0.012) discard;
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;

export class EdgeVeil {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private geos: THREE.BufferGeometry[] = [];

  constructor(bounds: Bounds, tier: Tier) {
    this.group.name = "edgeVeil";
    const low = tier === "low";
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: low ? 0.62 : 1 },
        uFresnel: { value: low ? 0 : 1 },
        uHero: { value: new THREE.Vector2(-999, -999) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      blending: THREE.NormalBlending,
      fog: false,
    });
    const w = bounds.width;
    const h = bounds.height;
    const y = GROUND_LIFT + VEIL_H * 0.5;
    // PlaneGeometry faces +z. rotY(π/2) turns that normal to +x (west curtain,
    // visible from inside). rotY(−π/2) faces −x. South stays +z; north rotY(π) faces −z.
    this.addWall(h, Math.PI / 2, 0, y, h / 2);
    this.addWall(h, -Math.PI / 2, w, y, h / 2);
    this.addWall(w, 0, w / 2, y, 0);
    this.addWall(w, Math.PI, w / 2, y, h);
  }

  private addWall(span: number, rotY: number, x: number, y: number, z: number) {
    const geo = new THREE.PlaneGeometry(span, VEIL_H, 1, 1);
    this.geos.push(geo);
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.name = "edgeVeil";
    mesh.rotation.y = rotY;
    mesh.position.set(x, y, z);
    mesh.renderOrder = 6;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    this.group.add(mesh);
  }

  setTime(seconds: number) {
    this.mat.uniforms.uTime!.value = seconds;
  }

  /** Planar hero position (x, y = world z): the curtain thins around it. */
  setHero(x: number, y: number) {
    (this.mat.uniforms.uHero!.value as THREE.Vector2).set(x, y);
  }

  setTier(tier: Tier) {
    const low = tier === "low";
    this.mat.uniforms.uAlpha!.value = low ? 0.62 : 1;
    this.mat.uniforms.uFresnel!.value = low ? 0 : 1;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    this.geos.length = 0;
    this.mat.dispose();
  }
}

export function buildEdgeVeil(bounds: Bounds, tier: Tier): EdgeVeil {
  return new EdgeVeil(bounds, tier);
}

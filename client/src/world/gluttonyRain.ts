/**
 * Gluttony rain — "piova etterna, maladetta, fredda e greve": one LineSegments volume
 * of slanted streaks in a box around the camera focus. Every streak's fall, drift and
 * wrap happen in the vertex shader from a time uniform, so nothing is uploaded after
 * build: a frame costs one draw call and four uniform writes.
 *
 * The buffer holds `max` streaks; uDensity picks how many fall (the Maw's second phase
 * thickens it) — the rest are pushed out of clip space in the vertex shader.
 */
import * as THREE from "three";

const VERT = /* glsl */ `
  attribute vec4 aSeed;   // x, y: column in the box; z: fall phase; w: rank (density cut)
  attribute float aEnd;   // 0 = head of the streak, 1 = its tail
  uniform vec3 uOrigin;   // box centre (camera focus, on the ground)
  uniform float uTime;
  uniform float uDensity;
  uniform float uBox;
  uniform float uHeight;
  uniform float uSpeed;
  uniform float uLen;
  uniform vec2 uWind;
  varying float vA;
  void main() {
    if (aSeed.w > uDensity) {
      vA = 0.0;
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }
    float fall = fract(aSeed.z + uTime * uSpeed / uHeight);
    vec2 col = aSeed.xy * uBox + uWind * uTime;
    vec2 rel = mod(col - uOrigin.xz + 0.5 * uBox, uBox) - 0.5 * uBox;
    vec3 vel = normalize(vec3(uWind.x, -uSpeed, uWind.y));
    vec3 wp = vec3(uOrigin.x + rel.x, uOrigin.y - 0.6 + uHeight * (1.0 - fall), uOrigin.z + rel.y);
    wp -= vel * uLen * aEnd;
    // thin toward the box edge so the volume has no visible wall
    float edge = 1.0 - smoothstep(0.36, 0.5, max(abs(rel.x), abs(rel.y)) / uBox);
    vA = smoothstep(0.0, 0.1, fall) * (1.0 - smoothstep(0.93, 1.0, fall)) * (1.0 - 0.8 * aEnd) * edge;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vA;
  void main() {
    if (vA <= 0.003) discard;
    gl_FragColor = vec4(uColor, vA * uAlpha);
    #include <colorspace_fragment>
  }
`;

export type RainTier = "low" | "mid" | "high";

/** Streaks falling in calm rain by tier; the buffer holds 1.5× for the Maw's storm. */
const BASE: Record<RainTier, number> = { low: 120, mid: 200, high: 300 };
const STORM = 1.5;

export class GluttonyRain {
  readonly lines: THREE.LineSegments;
  private mat: THREE.ShaderMaterial;
  private geo: THREE.BufferGeometry;
  private calm: number;
  private density = 0;
  private want = 0;

  constructor(tier: RainTier, compact: boolean) {
    const base = BASE[tier] ?? BASE.low;
    const max = Math.round(base * STORM);
    this.calm = base / max;
    this.density = this.calm;
    this.want = this.calm;
    const pos = new Float32Array(max * 2 * 3);
    const seed = new Float32Array(max * 2 * 4);
    const end = new Float32Array(max * 2);
    for (let i = 0; i < max; i++) {
      // a golden-ratio scatter keeps columns even without clumps
      const sx = (i * 0.6180339887 + 0.13) % 1;
      const sy = (i * 0.7548776662 + 0.41) % 1;
      const ph = (i * 0.5698402910 + 0.07) % 1;
      const rank = (i + 0.5) / max;
      for (let v = 0; v < 2; v++) {
        const k = i * 2 + v;
        seed[k * 4] = sx;
        seed[k * 4 + 1] = sy;
        seed[k * 4 + 2] = ph;
        seed[k * 4 + 3] = rank;
        end[k] = v;
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    this.geo.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uOrigin: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uDensity: { value: this.density },
        uBox: { value: compact ? 26 : 32 },
        uHeight: { value: compact ? 12 : 11 },
        uSpeed: { value: 17 },
        uLen: { value: compact ? 1.25 : 1.05 },
        uWind: { value: new THREE.Vector2(3.2, 1.4) },
        uColor: { value: new THREE.Color(0xc4c6a8) },
        uAlpha: { value: compact ? 0.62 : 0.5 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.name = "gluttonyRain";
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
  }

  /** Heavier rain (the Maw's second phase) or calm again. */
  setStorm(on: boolean) {
    this.want = on ? 1 : this.calm;
  }

  /** Per frame: follow the camera focus (x, groundY, z); time in seconds. */
  update(x: number, y: number, z: number, tSec: number, dt: number) {
    const u = this.mat.uniforms;
    (u.uOrigin.value as THREE.Vector3).set(x, y, z);
    // (wrapped so the float drift term keeps its precision over long sessions)
    u.uTime.value = tSec % 2048;
    if (this.density !== this.want) {
      const k = Math.min(1, dt * 0.8);
      this.density += (this.want - this.density) * k;
      if (Math.abs(this.want - this.density) < 0.004) this.density = this.want;
      u.uDensity.value = this.density;
    }
  }

  dispose() {
    this.lines.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

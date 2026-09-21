import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    darkness: { value: 0.42 },
    offset: { value: 0.85 },
    hitFlash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float darkness;
    uniform float offset;
    uniform float hitFlash;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * vec2(offset, offset);
      float v = smoothstep(0.35, 1.15, dot(uv, uv));
      c.rgb = mix(c.rgb, c.rgb * 0.22, v * darkness);
      c.rgb += vec3(0.46, 0.26, 0.08) * hitFlash;
      c.rgb = mix(c.rgb, c.rgb * vec3(1.12, 0.86, 0.72), hitFlash * 0.4);
      gl_FragColor = c;
    }
  `,
};

export function makeComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera
): { composer: EffectComposer; grade: ShaderPass } {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.55, 0.78);
  composer.addPass(bloom);
  const grade = new ShaderPass(VignetteShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return { composer, grade };
}

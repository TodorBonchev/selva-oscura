import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/**
 * OutputPass (tone mapping + sRGB) with the hit flash folded in, so the post chain is
 * scene → [bloom] → this one full-screen pass. The old separate vignette/grade pass cost a
 * full-screen HalfFloat read+write per frame, and its vignette was ~0 even in the corners
 * (smoothstep(0.35, 1.15, r²) with r² ≤ 0.36 at offset 0.85).
 */
export class GradeOutputPass extends OutputPass {
  /** WorldApp.hitFlashAmt, applied in linear HDR before tone mapping. */
  flash: THREE.IUniform<number> = { value: 0 };

  constructor() {
    super();
    (this.uniforms as Record<string, THREE.IUniform>).hitFlash = this.flash;
    const mat = this.material as THREE.RawShaderMaterial;
    mat.fragmentShader = mat.fragmentShader
      .replace("uniform sampler2D tDiffuse;", "uniform sampler2D tDiffuse;\n\t\tuniform float hitFlash;")
      .replace(
        "gl_FragColor = texture2D( tDiffuse, vUv );",
        `gl_FragColor = texture2D( tDiffuse, vUv );
			gl_FragColor.rgb += vec3( 0.46, 0.26, 0.08 ) * hitFlash;
			gl_FragColor.rgb = mix( gl_FragColor.rgb, gl_FragColor.rgb * vec3( 1.12, 0.86, 0.72 ), hitFlash * 0.4 );`
      );
  }
}

/** Blur mips the bloom actually runs (UnrealBloomPass allocates 5). */
const BLOOM_MIPS = 3;

export function makeComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts?: { bloom?: boolean }
): { composer: EffectComposer; grade: GradeOutputPass; bloom: UnrealBloomPass | null } {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  let bloom: UnrealBloomPass | null = null;
  if (opts?.bloom !== false) {
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.16, 0.4, 0.88);
    // The strength-0.16 glow reads the same from the three widest-resolution mips; the
    // skipped 1/16–1/32 targets stay black in the composite. Their factors go to mip 3.
    (bloom as unknown as { nMips: number }).nMips = BLOOM_MIPS;
    const factors = bloom.compositeMaterial.uniforms.bloomFactors.value as number[];
    for (let i = BLOOM_MIPS; i < factors.length; i++) {
      factors[BLOOM_MIPS - 1] += factors[i] * 0.5;
      factors[i] = 0;
    }
    composer.addPass(bloom);
  }
  const grade = new GradeOutputPass();
  composer.addPass(grade);
  return { composer, grade, bloom };
}

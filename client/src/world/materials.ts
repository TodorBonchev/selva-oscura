import * as THREE from "three";

export type MatKit = {
  cloth: THREE.MeshStandardMaterial;
  bronze: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  bark: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  gale: THREE.MeshBasicMaterial;
  gem: THREE.MeshStandardMaterial;
  groundHub: THREE.MeshStandardMaterial;
  groundLust: THREE.MeshStandardMaterial;
  bone: THREE.MeshStandardMaterial;
  ember: THREE.MeshStandardMaterial;
  shadowCatch: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  armor: THREE.MeshStandardMaterial;
  canopyA: THREE.MeshStandardMaterial;
  canopyB: THREE.MeshStandardMaterial;
  moss: THREE.MeshStandardMaterial;
};

/** Dual-scale world-XZ albedo so tiled ground maps stop reading as wallpaper. */
export function breakAlbedoTiling(mat: THREE.MeshStandardMaterial, scale: number) {
  mat.customProgramCacheKey = () => `break-albedo:${scale.toFixed(3)}`;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vWp;`
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vWp;`
      )
      .replace(
        "#include <map_fragment>",
        `
#ifdef USE_MAP
  vec2 wu = vWp.xz * ${scale.toFixed(4)};
  vec2 wr = vec2(wu.x * 0.72 - wu.y * 0.69, wu.x * 0.69 + wu.y * 0.72);
  vec4 a = texture2D(map, wu);
  vec4 b = texture2D(map, wr * 0.37 + vec2(0.41, 0.17));
  vec4 c = texture2D(map, wu * 1.73 + vec2(0.08, 0.62));
  float n = 0.5 + 0.5 * sin(vWp.x * 0.093 + vWp.z * 0.071);
  float n2 = 0.5 + 0.5 * sin(vWp.x * 0.031 - vWp.z * 0.044);
  vec4 sampledDiffuseColor = mix(mix(a, b, n), c, 0.22 + 0.18 * n2);
  float macro = 0.88 + 0.16 * n2;
  sampledDiffuseColor.rgb *= macro;
  float lum = dot(sampledDiffuseColor.rgb, vec3(0.30, 0.54, 0.16));
  sampledDiffuseColor.rgb = mix(vec3(lum * 0.94, lum * 0.86, lum * 0.72), sampledDiffuseColor.rgb, 0.74);
  diffuseColor *= sampledDiffuseColor;
#endif
`
      );
  };
}

const TEX = (name: string) =>
  `/assets/tex/${name}.jpg?v=${typeof __ASSET_VER__ !== "undefined" ? __ASSET_VER__ : "1"}`;

function loadTex(
  loader: THREE.TextureLoader,
  url: string,
  repeat: number,
  anisotropy: number
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repeat, repeat);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = anisotropy;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        resolve(t);
      },
      undefined,
      reject
    );
  });
}

function hatchCanvas(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1a1610";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "rgba(210,196,150,0.28)";
  g.lineWidth = 1;
  for (let i = -128; i < 256; i += 5) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 128, 128);
    g.stroke();
  }
  g.strokeStyle = "rgba(40,30,20,0.35)";
  for (let i = -128; i < 256; i += 9) {
    g.beginPath();
    g.moveTo(i, 128);
    g.lineTo(i + 128, 0);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 8);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function engrave(mat: THREE.MeshStandardMaterial, _hatch: THREE.Texture) {
  // Doré weight comes from the generated albedo maps + warm rim light.
  mat.envMapIntensity = 0.55;
}

export async function loadMatKit(renderer: THREE.WebGLRenderer): Promise<MatKit> {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const hatch = hatchCanvas();

  const [clothMap, bronzeMap, goldMap, barkMap, stoneMap, galeMap, hubMap, lustMap, leatherMap, armorMap] =
    await Promise.all([
      loadTex(loader, TEX("cloth"), 2.2, aniso),
      loadTex(loader, TEX("bronze"), 2.4, aniso),
      loadTex(loader, TEX("gold"), 2.0, aniso),
      loadTex(loader, TEX("bark"), 1.6, aniso),
      loadTex(loader, TEX("stone"), 2.2, aniso),
      loadTex(loader, TEX("gale"), 1.4, aniso),
      loadTex(loader, TEX("hub_ground"), 8, aniso),
      loadTex(loader, TEX("lust_ground"), 10, aniso),
      loadTex(loader, TEX("leather"), 2.0, aniso),
      loadTex(loader, TEX("armor"), 1.8, aniso),
    ]);

  const cloth = new THREE.MeshStandardMaterial({
    map: clothMap,
    color: 0xf2e6c8,
    roughness: 0.78,
    metalness: 0.04,
  });
  const bronze = new THREE.MeshStandardMaterial({
    map: bronzeMap,
    color: 0xd4b07a,
    roughness: 0.48,
    metalness: 0.45,
  });
  const gold = new THREE.MeshStandardMaterial({
    map: goldMap,
    color: 0xffe08a,
    roughness: 0.28,
    metalness: 0.7,
    emissive: 0x6a4a10,
    emissiveIntensity: 0.55,
  });
  const bark = new THREE.MeshStandardMaterial({
    map: barkMap,
    color: 0x6a5a48,
    roughness: 0.92,
    metalness: 0.04,
  });
  const stone = new THREE.MeshStandardMaterial({
    map: stoneMap,
    color: 0xc8bda0,
    roughness: 0.78,
    metalness: 0.12,
  });
  const gale = new THREE.MeshBasicMaterial({
    map: galeMap,
    color: 0xff6a44,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const gem = new THREE.MeshStandardMaterial({
    color: 0xe8c86a,
    roughness: 0.18,
    metalness: 0.35,
    emissive: 0x6a4a10,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.92,
  });
  const leather = new THREE.MeshStandardMaterial({
    map: leatherMap,
    color: 0x6a5844,
    roughness: 0.86,
    metalness: 0.08,
  });
  const armor = new THREE.MeshStandardMaterial({
    map: armorMap,
    color: 0xc4a060,
    roughness: 0.42,
    metalness: 0.55,
    emissive: 0x2a1a08,
    emissiveIntensity: 0.18,
  });
  const groundHub = new THREE.MeshStandardMaterial({
    map: hubMap,
    color: 0xe4d4b6,
    roughness: 0.94,
    metalness: 0.02,
    vertexColors: true,
  });
  const groundLust = new THREE.MeshStandardMaterial({
    map: lustMap,
    color: 0xd4a080,
    roughness: 0.88,
    metalness: 0.06,
    emissive: 0x3a1208,
    emissiveIntensity: 0.22,
    vertexColors: true,
  });
  const canopyA = new THREE.MeshStandardMaterial({
    map: barkMap,
    color: 0x3a4a32,
    roughness: 0.94,
    metalness: 0.02,
    emissive: 0x10180e,
    emissiveIntensity: 0.18,
  });
  const canopyB = new THREE.MeshStandardMaterial({
    map: barkMap,
    color: 0x2a3826,
    roughness: 0.95,
    metalness: 0.02,
    emissive: 0x0c140c,
    emissiveIntensity: 0.14,
  });
  const moss = new THREE.MeshStandardMaterial({
    color: 0x2c3824,
    roughness: 0.96,
    metalness: 0.02,
    emissive: 0x0a1208,
    emissiveIntensity: 0.12,
  });
  breakAlbedoTiling(groundHub, 0.088);
  breakAlbedoTiling(groundLust, 0.062);
  const bone = new THREE.MeshStandardMaterial({
    color: 0xf4ead4,
    roughness: 0.45,
    metalness: 0.04,
    emissive: 0x3a3020,
    emissiveIntensity: 0.18,
  });
  const ember = new THREE.MeshStandardMaterial({
    color: 0xff6a33,
    emissive: 0xff3310,
    emissiveIntensity: 1.4,
    roughness: 0.35,
    metalness: 0.1,
  });
  const shadowCatch = new THREE.MeshStandardMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });

  for (const m of [cloth, bronze, gold, bark, stone, bone, groundHub, groundLust, leather, armor, canopyA, canopyB, moss]) {
    engrave(m, hatch);
  }

  return {
    cloth,
    bronze,
    gold,
    bark,
    stone,
    gale,
    gem,
    groundHub,
    groundLust,
    bone,
    ember,
    shadowCatch,
    leather,
    armor,
    canopyA,
    canopyB,
    moss,
  };
}

export const RARITY_HEX: Record<string, number> = {
  normal: 0xb8b0a0,
  magic: 0x4a7fd4,
  rare: 0xd4b84a,
  set: 0x33cc88,
  unique: 0xcc8800,
  canto_unique: 0xee66cc,
};

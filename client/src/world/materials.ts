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
};

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

  const [clothMap, bronzeMap, goldMap, barkMap, stoneMap, galeMap, hubMap, lustMap] =
    await Promise.all([
      loadTex(loader, TEX("cloth"), 2.2, aniso),
      loadTex(loader, TEX("bronze"), 2.4, aniso),
      loadTex(loader, TEX("gold"), 2.0, aniso),
      loadTex(loader, TEX("bark"), 1.6, aniso),
      loadTex(loader, TEX("stone"), 2.2, aniso),
      loadTex(loader, TEX("gale"), 1.4, aniso),
      loadTex(loader, TEX("hub_ground"), 18, aniso),
      loadTex(loader, TEX("lust_ground"), 16, aniso),
    ]);

  const cloth = new THREE.MeshStandardMaterial({
    map: clothMap,
    color: 0xcbbda0,
    roughness: 0.86,
    metalness: 0.08,
  });
  const bronze = new THREE.MeshStandardMaterial({
    map: bronzeMap,
    color: 0xb08a5a,
    roughness: 0.42,
    metalness: 0.72,
  });
  const gold = new THREE.MeshStandardMaterial({
    map: goldMap,
    color: 0xe0c56a,
    roughness: 0.32,
    metalness: 0.85,
    emissive: 0x3a2a08,
    emissiveIntensity: 0.25,
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
  const groundHub = new THREE.MeshStandardMaterial({
    map: hubMap,
    color: 0xb8b09a,
    roughness: 0.95,
    metalness: 0.02,
  });
  const groundLust = new THREE.MeshStandardMaterial({
    map: lustMap,
    color: 0x9a6a55,
    roughness: 0.9,
    metalness: 0.08,
    emissive: 0x2a0804,
    emissiveIntensity: 0.18,
  });
  const bone = new THREE.MeshStandardMaterial({
    color: 0xddd4be,
    roughness: 0.55,
    metalness: 0.08,
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

  for (const m of [cloth, bronze, gold, bark, stone, bone, groundHub, groundLust]) {
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

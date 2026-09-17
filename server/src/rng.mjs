export function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pickWeighted(rng, entries, weightKey = "weight") {
  const total = entries.reduce((s, e) => s + e[weightKey], 0);
  let roll = rng() * total;
  for (const e of entries) {
    roll -= e[weightKey];
    if (roll <= 0) return e;
  }
  return entries[entries.length - 1];
}

export function newSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

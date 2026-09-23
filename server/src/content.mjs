import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveContentRoot() {
  if (process.env.CONTENT_ROOT) return path.resolve(process.env.CONTENT_ROOT);
  const candidates = [
    path.resolve(__dirname, "../content"), // bundled next to server
    path.resolve(__dirname, "../../content"), // monorepo
    path.resolve("/content"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "cantos"))) return c;
  }
  throw new Error("content/ not found; set CONTENT_ROOT");
}

export const CONTENT_ROOT = resolveContentRoot();

function readJson(rel) {
  const full = path.join(CONTENT_ROOT, rel);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

export function loadCanto(id) {
  return readJson(`cantos/${id}.json`);
}

export function loadDropTable(id) {
  return readJson(`drops/tables/${id}.json`);
}

export function loadEmitRates() {
  return readJson("economy/emit_rates.json");
}

export function loadBurns() {
  return readJson("economy/burns.json");
}

export function loadPool(id) {
  const bases = path.join(CONTENT_ROOT, "drops/pools", `${id}.json`);
  if (fs.existsSync(bases)) return readJson(`drops/pools/${id}.json`);
  return null;
}

export function loadAffixPools() {
  return readJson("drops/pools/inferno_affixes.json");
}

export const CANTOS = {
  inferno_01: loadCanto("inferno_01"),
  inferno_05: loadCanto("inferno_05"),
  inferno_06: loadCanto("inferno_06"),
  inferno_07: loadCanto("inferno_07"),
};

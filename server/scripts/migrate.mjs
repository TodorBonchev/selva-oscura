#!/usr/bin/env node
/**
 * One-shot migrate. Never prints the connection string.
 *
 *   DATABASE_URL=… npm run migrate
 *   node scripts/migrate.mjs --env-file /path/to/neon.env
 */
import fs from "node:fs";
import { initDb, runMigrations, closeDb, dbEnabled } from "../src/db.mjs";

function loadEnvFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const i = s.indexOf("=");
    const k = s.slice(0, i);
    let v = s.slice(i + 1);
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const envIdx = process.argv.indexOf("--env-file");
if (envIdx >= 0 && process.argv[envIdx + 1]) {
  loadEnvFile(process.argv[envIdx + 1]);
}

async function main() {
  const ok = await initDb();
  if (!ok || !dbEnabled()) {
    console.error("[migrate] DATABASE_URL missing — nothing to do");
    process.exit(1);
  }
  const { applied } = await runMigrations();
  console.log(
    applied.length
      ? `[migrate] applied: ${applied.join(", ")}`
      : "[migrate] already up to date"
  );
  await closeDb();
}

main().catch((err) => {
  console.error("[migrate] failed:", err.message);
  process.exit(1);
});

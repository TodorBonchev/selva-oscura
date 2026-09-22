/**
 * Start a local Postgres for dev playtests.
 * Data lives in server/.pgdata. Does not touch Neon or Railway.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".pgdata");
const envFile = path.join(root, ".env");
const port = 5433;
const user = "selva";
const password = "selva_local";
const database = "selva";
const databaseUrl = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
});

async function ensureInit() {
  if (fs.existsSync(path.join(dataDir, "PG_VERSION"))) return;
  await pg.initialise();
}

async function ensureDatabase() {
  const { default: pgDriver } = await import("pg");
  const admin = new pgDriver.Client({
    connectionString: `postgresql://${user}:${password}@127.0.0.1:${port}/postgres`,
  });
  await admin.connect();
  try {
    const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (!found.rowCount) await admin.query(`CREATE DATABASE ${database}`);
  } finally {
    await admin.end();
  }
}

function ensureEnv() {
  if (fs.existsSync(envFile)) {
    console.log("[local-db] server/.env already present — left it unchanged");
    return;
  }
  fs.writeFileSync(
    envFile,
    `PORT=8080\nDATABASE_URL=${databaseUrl}\n`,
    "utf8"
  );
  console.log("[local-db] wrote server/.env for local Postgres");
}

await ensureInit();
await pg.start();
await ensureDatabase();
ensureEnv();
console.log(`[local-db] Postgres listening on 127.0.0.1:${port} database ${database}`);
console.log("[local-db] leave this process running while you use the game server");

const stop = async () => {
  try {
    await pg.stop();
  } catch {
    /* already stopped */
  }
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

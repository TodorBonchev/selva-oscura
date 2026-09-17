import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

/** @type {pg.Pool | null} */
let pool = null;
let enabled = false;

export function dbEnabled() {
  return enabled;
}

/**
 * Connect using DATABASE_URL. Neon requires SSL.
 * Returns false (with warning) when unset — in-memory fallback.
 */
export async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url || !String(url).trim()) {
    console.warn(
      "[db] DATABASE_URL not set — using in-memory ledger (state resets on restart)"
    );
    enabled = false;
    pool = null;
    return false;
  }

  const needsSsl =
    /sslmode=require/i.test(url) ||
    /neon\.tech/i.test(url) ||
    process.env.PGSSLMODE === "require";

  // Prefer explicit SSL + libpq-compat so Neon's sslmode=require keeps working
  // under newer pg-connection-string semantics.
  let connectionString = url;
  if (needsSsl && !/uselibpqcompat=/i.test(connectionString)) {
    connectionString += (connectionString.includes("?") ? "&" : "?") + "uselibpqcompat=true";
  }

  pool = new pg.Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 8,
  });

  // Smoke-check without logging the URL
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }

  enabled = true;
  console.log("[db] Postgres connected (DATABASE_URL present)");
  return true;
}

export function getPool() {
  if (!pool || !enabled) {
    throw new Error("Database not enabled");
  }
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

export async function withClient(fn) {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withTransaction(fn) {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    }
  });
}

/** Apply *.sql in migrations/ once each (tracked in schema_migrations). */
export async function runMigrations() {
  if (!enabled) return { applied: [] };

  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = [];
  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    const exists = await query(
      "SELECT 1 FROM schema_migrations WHERE id = $1",
      [id]
    );
    if (exists.rowCount > 0) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING",
        [id]
      );
    });
    applied.push(id);
    console.log(`[db] migration applied: ${id}`);
  }

  if (applied.length === 0) {
    console.log("[db] migrations up to date");
  }
  return { applied };
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
  enabled = false;
}

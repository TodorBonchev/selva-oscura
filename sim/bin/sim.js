#!/usr/bin/env node
/**
 * Slice 0 stub: dry-run loads locked economy JSON and prints a summary.
 * Full Monte Carlo lands in Slice 2.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../");
const content = path.join(root, "content");

function readJson(rel) {
  const p = path.join(content, rel);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function dryRun() {
  const burns = readJson("economy/burns.json");
  const rates = readJson("economy/emit_rates.json");
  const c01 = readJson("cantos/inferno_01.json");
  const c05 = readJson("cantos/inferno_05.json");
  console.log("selva-oscura-sim dry-run");
  console.log("vault_start_stelle:", rates.vault_start_stelle);
  console.log("event_types:", Object.keys(rates.p_by_event));
  console.log("burns_keys:", Object.keys(burns));
  console.log("cantos:", c01.id, c01.role, "|", c05.id, c05.title);
  console.log("ok");
}

function season(args) {
  const days = Number(args["--days"] ?? 90);
  const players = Number(args["--players"] ?? 4000);
  const seed = Number(args["--seed"] ?? 42);
  console.log(`season stub days=${days} players=${players} seed=${seed}`);
  console.log("Implement full projection in Slice 2 after Slice 1 playable.");
  dryRun();
}

const [, , cmd, ...rest] = process.argv;
const args = {};
for (let i = 0; i < rest.length; i += 2) {
  if (rest[i]?.startsWith("--")) args[rest[i]] = rest[i + 1];
}

if (cmd === "dry-run" || !cmd) dryRun();
else if (cmd === "season") season(args);
else {
  console.error("usage: sim dry-run | sim season --days 90 --players 4000 --seed 42");
  process.exit(1);
}

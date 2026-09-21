import { GameSocket } from "./net/GameSocket";
import { WorldApp } from "./world/WorldApp";
import { showToast } from "./ui/hud";

const DEFAULT_SERVER =
  import.meta.env.VITE_GAME_SERVER_URL ||
  (typeof __DEFAULT_GAME_SERVER__ !== "undefined"
    ? __DEFAULT_GAME_SERVER__
    : "https://game-server-production-b9f9.up.railway.app");

function resolveServer(): string {
  const params = new URLSearchParams(location.search);
  const q = params.get("server");
  if (q) return q.replace(/\/$/, "");
  return DEFAULT_SERVER.replace(/\/$/, "");
}

const serverUrl = resolveServer();

function resolveDisplayName(): string {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get("name")?.trim();
  if (fromUrl) {
    try {
      localStorage.setItem("selva_display_name", fromUrl.slice(0, 24));
    } catch {
      /* ignore */
    }
    return fromUrl.slice(0, 24);
  }
  let stored = "";
  try {
    stored = localStorage.getItem("selva_display_name") || "";
  } catch {
    /* ignore */
  }
  if (stored.trim()) return stored.trim().slice(0, 24);
  const fallback = `Wanderer-${Math.random().toString(36).slice(2, 6)}`;
  const entered =
    typeof window !== "undefined" && typeof window.prompt === "function"
      ? window.prompt("Display name (saved for reconnect; cancel = random)", fallback)
      : null;
  const name = (entered && entered.trim() ? entered.trim() : fallback).slice(0, 24);
  try {
    localStorage.setItem("selva_display_name", name);
  } catch {
    /* ignore */
  }
  return name;
}

const name = resolveDisplayName();

showToast(`Connecting to ${serverUrl}…`, "info");

const socket = new GameSocket(serverUrl, name);
socket.connect();

socket.on((msg) => {
  if (msg.type === "welcome") {
    showToast(`Connected as ${name}`, "info");
  }
});

const root = document.getElementById("game-root");
if (!root) throw new Error("#game-root missing");

const app = new WorldApp(root, socket);
void app.start();

window.addEventListener(
  "touchmove",
  (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.("#panels, .panel, input")) return;
    e.preventDefault();
  },
  { passive: false }
);

document.addEventListener(
  "gesturestart",
  (e) => e.preventDefault(),
  { passive: false }
);

console.info("[Selva Oscura] Slice 1 Three.js client", { serverUrl, name });

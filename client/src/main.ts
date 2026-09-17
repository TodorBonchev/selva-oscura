import Phaser from "phaser";
import { GameSocket } from "./net/GameSocket";
import { WorldScene } from "./scenes/WorldScene";
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

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game-root",
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#0b0f0c",
  scene: [WorldScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    activePointers: 3,
  },
};

const game = new Phaser.Game(config);
game.scene.start("world", { socket });

window.addEventListener("resize", () => {
  game.scale.resize(window.innerWidth, window.innerHeight);
});

// Prevent pull-to-refresh / page scroll stealing touches over the canvas
document.body.addEventListener(
  "touchmove",
  (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.("#panels, .panel, input")) return;
    e.preventDefault();
  },
  { passive: false }
);

// Block pinch-zoom / double-tap zoom gestures over the game surface
document.addEventListener(
  "gesturestart",
  (e) => e.preventDefault(),
  { passive: false }
);

console.info("[Selva Oscura] Slice 1 client", { serverUrl, name });

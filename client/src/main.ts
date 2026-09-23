import { GameSocket } from "./net/GameSocket";
import { WorldApp } from "./world/WorldApp";
import { showToast } from "./ui/hud";
import {
  awaitMobileBootEnter,
  installFullscreenGestureHook,
  isStandaloneDisplay,
  prefersMobileImmersive,
} from "./ui/fullscreen";

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

function randomWanderer(): string {
  return `Wanderer-${Math.random().toString(36).slice(2, 6)}`;
}

function readStoredName(): string {
  try {
    return (localStorage.getItem("selva_display_name") || "").trim().slice(0, 24);
  } catch {
    return "";
  }
}

function writeStoredName(name: string) {
  try {
    localStorage.setItem("selva_display_name", name.slice(0, 24));
  } catch {
    /* ignore */
  }
}

function nameFromUrl(): string | null {
  const fromUrl = new URLSearchParams(location.search).get("name")?.trim();
  if (!fromUrl) return null;
  const name = fromUrl.slice(0, 24);
  writeStoredName(name);
  return name;
}

/** Desktop path: URL → storage → optional prompt. */
function resolveDisplayNameDesktop(): string {
  const fromUrl = nameFromUrl();
  if (fromUrl) return fromUrl;
  const stored = readStoredName();
  if (stored) return stored;
  const fallback = randomWanderer();
  const entered =
    typeof window !== "undefined" && typeof window.prompt === "function"
      ? window.prompt("Display name (saved for reconnect; cancel = random)", fallback)
      : null;
  const name = (entered && entered.trim() ? entered.trim() : fallback).slice(0, 24);
  writeStoredName(name);
  return name;
}

function seedNameForMobileBoot(): string {
  return nameFromUrl() || readStoredName() || randomWanderer();
}

installFullscreenGestureHook();

async function boot() {
  let name: string;
  if (prefersMobileImmersive() && !isStandaloneDisplay()) {
    name = await awaitMobileBootEnter(seedNameForMobileBoot());
  } else {
    name = resolveDisplayNameDesktop();
  }

  showToast(`Connecting to ${serverUrl}…`, "info");

  const socket = new GameSocket(serverUrl, name);
  socket.connect();

  socket.on((msg) => {
    if (msg.type === "welcome") {
      showToast(`Connected as ${name}`, "info");
      // Vite DEV only — browser console jump: __selvaTravel("inferno_07")
      // bypassGates: playtest may skip Lust→Glut / Glut→Ava require_clear.
      // Defer until a snapshot has landed so WorldApp can apply the canto rebuild
      // (early travel during async hello raced hub geometry vs HUD title).
      if (import.meta.env.DEV) {
        (window as unknown as { __selvaTravel?: (canto: string) => void }).__selvaTravel = (
          canto: string
        ) => {
          const go = () => socket.travel(canto, { bypassGates: true });
          // Wait until WorldApp has applied ≥1 snapshot so canto rebuild path runs
          // (travel during mat-load left HUD updated from lastSnapshot replay race).
          const tryGo = () => {
            if ((window as unknown as { __selvaWorldReady?: boolean }).__selvaWorldReady) go();
            else window.setTimeout(tryGo, 50);
          };
          tryGo();
        };
      }
    }
  });

  const root = document.getElementById("game-root");
  if (!root) throw new Error("#game-root missing");

  const app = new WorldApp(root, socket);
  void app.start();
}

void boot();

window.addEventListener(
  "touchmove",
  (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.("#panels, .panel, input, #boot-veil")) return;
    e.preventDefault();
  },
  { passive: false }
);

document.addEventListener(
  "gesturestart",
  (e) => e.preventDefault(),
  { passive: false }
);

console.info("[Selva Oscura] Slice 1 Three.js client", { serverUrl });

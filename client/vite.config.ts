import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
  define: {
    // Public assets are served with a 1-year immutable cache on Vercel; a
    // per-build version query keeps phones from showing stale sprites/ground.
    __ASSET_VER__: JSON.stringify(Date.now().toString(36)),
    __DEFAULT_GAME_SERVER__: JSON.stringify(
      process.env.VITE_GAME_SERVER_URL ||
        "https://game-server-production-b9f9.up.railway.app"
    ),
  },
});

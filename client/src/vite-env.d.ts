/// <reference types="vite/client" />

declare const __DEFAULT_GAME_SERVER__: string;
declare const __ASSET_VER__: string;

interface ImportMetaEnv {
  readonly VITE_GAME_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

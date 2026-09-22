/**
 * Phone fullscreen + boot gate.
 *
 * Android/Chrome: Fullscreen API on documentElement after a user gesture.
 * iOS Safari: Fullscreen API is unreliable / often unavailable for non-video;
 * we still try webkit prefixes and lean on viewport-fit=cover + standalone PWA.
 */

type FsEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type DocFs = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitIsFullScreen?: boolean;
};

export function prefersMobileImmersive(): boolean {
  if (typeof window === "undefined") return false;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (h <= 520 && w <= 1100) return true;
  const compact =
    window.matchMedia("(max-width: 640px)").matches ||
    (window.matchMedia("(pointer: coarse)").matches && Math.min(w, h) < 900);
  if (compact) return true;
  const touch =
    "ontouchstart" in window ||
    (navigator.maxTouchPoints != null && navigator.maxTouchPoints > 0);
  return touch && Math.min(w, h) < 960;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(display-mode: standalone)").matches;
  const ios = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return mq || ios;
}

export function isGameFullscreen(): boolean {
  const d = document as DocFs;
  return Boolean(document.fullscreenElement || d.webkitFullscreenElement || d.webkitIsFullScreen);
}

/** Best-effort enter fullscreen. Safe to call outside a gesture (no-ops / rejects quietly). */
export async function requestGameFullscreen(): Promise<boolean> {
  if (typeof document === "undefined") return false;
  if (isStandaloneDisplay() || isGameFullscreen()) return true;
  const el = document.documentElement as FsEl;
  try {
    if (typeof el.requestFullscreen === "function") {
      await el.requestFullscreen({ navigationUI: "hide" } as FullscreenOptions);
      return true;
    }
    if (typeof el.webkitRequestFullscreen === "function") {
      await el.webkitRequestFullscreen();
      return true;
    }
    if (typeof el.webkitRequestFullScreen === "function") {
      await el.webkitRequestFullScreen();
      return true;
    }
    if (typeof el.msRequestFullscreen === "function") {
      await el.msRequestFullscreen();
      return true;
    }
  } catch {
    /* user denied or browser blocked — keep playing windowed */
  }
  return false;
}

export async function exitGameFullscreen(): Promise<void> {
  const d = document as DocFs;
  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
      return;
    }
    if (d.webkitFullscreenElement && d.webkitExitFullscreen) {
      await d.webkitExitFullscreen();
    }
  } catch {
    /* ignore */
  }
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

/**
 * On phones: keep the boot veil until the wanderer taps Enter (fullscreen gesture).
 * On desktop / already-standalone: resolve immediately.
 * Returns the display name to use for the socket.
 */
export function awaitMobileBootEnter(fallbackName: string): Promise<string> {
  if (typeof document === "undefined") return Promise.resolve(fallbackName);
  if (!prefersMobileImmersive() || isStandaloneDisplay()) {
    return Promise.resolve(fallbackName);
  }

  const veil = document.getElementById("boot-veil");
  const btn = document.getElementById("btn-enter-wood") as HTMLButtonElement | null;
  const input = document.getElementById("boot-name") as HTMLInputElement | null;
  if (!veil || !btn) return Promise.resolve(fallbackName);

  veil.classList.add("await-enter");
  btn.hidden = false;
  const hint = veil.querySelector(".boot-hint") as HTMLElement | null;
  if (hint) hint.hidden = false;
  const wrap = veil.querySelector(".boot-name-wrap") as HTMLElement | null;
  if (wrap) wrap.hidden = false;
  if (input) {
    input.hidden = false;
    const stored = readStoredName();
    input.value = stored || fallbackName;
    input.setAttribute("maxlength", "24");
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const raw = (input?.value || "").trim() || fallbackName;
      const name = raw.slice(0, 24);
      writeStoredName(name);
      void requestGameFullscreen();
      veil.classList.remove("await-enter");
      btn.hidden = true;
      if (hint) hint.hidden = true;
      if (wrap) wrap.hidden = true;
      if (input) input.hidden = true;
      document.body.classList.add("fs-attempted");
      resolve(name);
    };

    btn.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        finish();
      },
      { once: true }
    );

    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish();
      }
    });
  });
}

/**
 * Fallback: first in-game gesture also tries fullscreen (if still windowed).
 */
export function installFullscreenGestureHook(): void {
  if (typeof document === "undefined") return;
  if (isStandaloneDisplay()) return;

  let armed = true;
  const tryOnce = (ev: Event) => {
    if (!armed) return;
    if (!prefersMobileImmersive()) return;
    if (isGameFullscreen()) {
      armed = false;
      return;
    }
    const t = ev.target as HTMLElement | null;
    if (t?.closest?.("input, textarea, #boot-veil")) return;
    armed = false;
    void requestGameFullscreen().finally(() => {
      /* leave armed=false so we don't spam prompts */
    });
  };

  const opts: AddEventListenerOptions = { capture: true, passive: true };
  document.addEventListener("pointerdown", tryOnce, opts);
  document.addEventListener("touchstart", tryOnce, opts);
  document.addEventListener("keydown", tryOnce, opts);

  const syncClass = () => {
    document.body.classList.toggle("is-fullscreen", isGameFullscreen());
  };
  document.addEventListener("fullscreenchange", syncClass);
  document.addEventListener("webkitfullscreenchange", syncClass as EventListener);
  syncClass();
}

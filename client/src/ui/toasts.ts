/**
 * Toast queue, NPC dialogue panel and canto title card.
 *
 * One #toast slot used to be overwritten by whatever arrived last (the Lust
 * intro lasted 1 ms under "Entered Lust."). Now:
 *   - a small priority queue (emit > warn > loot > info), each toast shown at
 *     least MIN_SHOW_MS before a queued one may replace it;
 *   - same-family lines collapse in place ("Closing on …", pickups, gate lines);
 *   - server noise ("Travel: x", "Dash", "Entered X.") is dropped — the canto
 *     title card says where you arrived;
 *   - "Guide: …" lines open the dialogue panel instead of a 3 s toast.
 */

type Level = "emit" | "warn" | "loot" | "info";

const PRIORITY: Record<Level, number> = { emit: 3, warn: 2, loot: 1, info: 0 };
const HOLD_MS: Record<Level, number> = { emit: 3600, warn: 2600, loot: 2400, info: 3000 };
const MIN_SHOW_MS = 1200;
const MAX_QUEUE = 4;
const FADE_MS = 420;

type Toast = { text: string; level: Level; family: string; key: string; count: number };

let current: (Toast & { shownAt: number }) | null = null;
const queue: Toast[] = [];
let endTimer: number | null = null;
let fadeTimer: number | null = null;
let endAt = 0;

function asLevel(level: string | undefined): Level {
  return level === "emit" || level === "warn" || level === "loot" ? level : "info";
}

/** Lowercase, trailing punctuation off — "Lust falls." and "Lust falls" are one line. */
function keyOf(text: string): string {
  return text.trim().toLowerCase().replace(/[.!…\s]+$/u, "");
}

/** Lines that say the same kind of thing replace each other instead of queueing. */
function familyOf(text: string): string {
  const t = text.trim();
  if (/^Closing on /i.test(t)) return "closing";
  if (/^Approaching /i.test(t)) return "approach";
  if (/^(Picked up|Picking up|Dropped:|Weighed:)/i.test(t)) return "loot";
  if (/^Interact:/i.test(t)) return "interact";
  if (/out of (range|mana)|not enough mana|nothing to strike|no foe|recharging|cooling/i.test(t)) return "oor";
  if (/gate .*(opens|stands open)|gate past the/i.test(t)) return "gate";
  if (/^(Bounty|First clear|Champion bounty)\b/i.test(t)) return "reward";
  return keyOf(t);
}

/** Server lines that only restate what the screen already shows. */
function isNoise(text: string): boolean {
  const t = text.trim();
  return /^Travel: /i.test(t) || /^Dash$/i.test(t) || /^Entered [^—]+\.$/i.test(t);
}

export function pushToast(rawText: string, rawLevel?: string) {
  const text = String(rawText ?? "").trim();
  if (!text || isNoise(text)) return;
  const guide = /^Guide:\s*/i.exec(text);
  if (guide) {
    showDialogue("Guide", text.slice(guide[0].length));
    return;
  }
  const level = asLevel(rawLevel);
  const t: Toast = { text, level, family: familyOf(text), key: keyOf(text), count: 1 };
  const now = performance.now();
  if (current && (current.key === t.key || current.family === t.family)) {
    // Collapse onto what is showing: refresh text, keep the stronger level
    if (current.key !== t.key && t.family === "loot") t.count = current.count + 1;
    const lvl = PRIORITY[t.level] >= PRIORITY[current.level] ? t.level : current.level;
    current = { ...t, level: lvl, shownAt: current.shownAt };
    render(current, false);
    schedule(Math.max(endAt, now + Math.min(HOLD_MS[lvl], 2000)));
    return;
  }
  const dup = queue.findIndex((q) => q.key === t.key || q.family === t.family);
  if (dup >= 0) queue.splice(dup, 1);
  queue.push(t);
  // Stable: highest priority first, FIFO within a level
  queue.sort((a, b) => PRIORITY[b.level] - PRIORITY[a.level]);
  while (queue.length > MAX_QUEUE) queue.pop();
  if (!current) {
    showNext();
    return;
  }
  // Something waits: let the current line go once it has had its minimum
  const minEnd = current.shownAt + MIN_SHOW_MS;
  if (endAt > minEnd) schedule(Math.max(minEnd, now));
}

/**
 * New canto: queued chatter from the last place is stale. Info / loot lines are
 * dropped (warnings and rewards still get their turn); an info line on screen
 * gives way at once.
 */
export function flushStaleToasts() {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].level === "info" || queue[i].level === "loot") queue.splice(i, 1);
  }
  if (current && current.level === "info") schedule(performance.now());
}

function schedule(at: number) {
  endAt = at;
  if (endTimer != null) window.clearTimeout(endTimer);
  endTimer = window.setTimeout(endCurrent, Math.max(0, at - performance.now()));
}

function endCurrent() {
  endTimer = null;
  if (queue.length) {
    showNext();
    return;
  }
  current = null;
  const el = document.getElementById("toast");
  if (!el) return;
  el.classList.remove("toast-show");
  el.classList.add("toast-fade");
  if (fadeTimer != null) window.clearTimeout(fadeTimer);
  // Drop text after fade so long strings don't linger for GC
  fadeTimer = window.setTimeout(() => {
    fadeTimer = null;
    if (!current) el.textContent = "";
  }, FADE_MS);
}

function showNext() {
  const t = queue.shift();
  if (!t) return;
  current = { ...t, shownAt: performance.now() };
  render(current, true);
  let hold = HOLD_MS[t.level];
  // A backed-up queue speeds everything along (but never under the minimum)
  if (queue.length) hold = Math.max(MIN_SHOW_MS, hold * 0.6);
  schedule(current.shownAt + hold);
}

function render(t: Toast, animate: boolean) {
  const el = document.getElementById("toast");
  if (!el) return;
  if (fadeTimer != null) {
    window.clearTimeout(fadeTimer);
    fadeTimer = null;
  }
  placeToastLayer();
  el.textContent = t.count > 1 ? `${t.text}  ·  +${t.count - 1} more` : t.text;
  if (animate) {
    el.className = "";
    // Restart the CSS entry animation even when the class is re-applied
    void el.offsetWidth;
  } else {
    el.classList.remove("toast-info", "toast-loot", "toast-emit", "toast-warn", "toast-fade");
  }
  el.classList.add("toast-show", `toast-${t.level}`);
}

/**
 * #toast-layer is fixed (above modals).
 * Phone HUD: toasts stack in the left column under vitals + objective line.
 * Desktop / wide: pin under the HUD plates; narrow: above the action bar.
 */
export function placeToastLayer() {
  const layer = document.getElementById("toast-layer");
  const top = document.getElementById("hud-top");
  if (!layer || !top) return;
  if (document.body.classList.contains("hud-compact")) {
    layer.classList.remove("toast-above-actions");
    layer.style.bottom = "";
    let y = top.getBoundingClientRect().bottom;
    const quest = document.getElementById("quest-track");
    // (fixed elements have no offsetParent — test the box instead)
    const qr = quest?.getBoundingClientRect();
    if (qr && qr.height > 0 && quest?.textContent?.trim()) y = Math.max(y, qr.bottom);
    // Portrait: the foe plate shares this column — stack toasts beneath it
    const tp = document.getElementById("target-plate");
    if (tp && !document.body.classList.contains("hud-landscape")) {
      const tr = tp.getBoundingClientRect();
      if (tr.height > 0) y = Math.max(y, tr.bottom);
    }
    layer.style.top = `${Math.round(y + 6)}px`;
    return;
  }
  const narrow =
    window.matchMedia("(max-width: 400px)").matches ||
    window.matchMedia("(max-height: 520px) and (max-width: 900px)").matches;
  if (narrow) {
    layer.classList.add("toast-above-actions");
    layer.style.top = "";
    const bar = document.getElementById("action-bar");
    const barH = bar ? bar.getBoundingClientRect().height : 0;
    layer.style.bottom = `${Math.round(barH + 10)}px`;
  } else {
    layer.classList.remove("toast-above-actions");
    layer.style.bottom = "";
    const quest = document.getElementById("quest-track");
    const qr = quest?.getBoundingClientRect();
    const y = Math.max(top.getBoundingClientRect().bottom, qr && qr.height > 0 ? qr.bottom : 0);
    layer.style.top = `${Math.round(y + 6)}px`;
  }
}

// ——— Dialogue panel (Guide counsel) ———

let dialogueTimer: number | null = null;

function dialogueEl(): HTMLElement {
  let el = document.getElementById("dialogue");
  if (el) return el;
  el = document.createElement("div");
  el.id = "dialogue";
  el.className = "hidden";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `<div class="dlg-speaker"></div><div class="dlg-text"></div><div class="dlg-close">Tap anywhere to close</div>`;
  document.body.appendChild(el);
  // The panel never eats a tap: any touch/click after a short read dismisses it
  // and still reaches the world (a gate tap walks there and closes the counsel).
  window.addEventListener(
    "pointerdown",
    () => {
      if (performance.now() - dialogueShownAt > 700) hideDialogue();
    },
    { capture: true, passive: true }
  );
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") hideDialogue();
  });
  return el;
}

let dialogueShownAt = 0;

export function showDialogue(speaker: string, text: string) {
  const el = dialogueEl();
  (el.querySelector(".dlg-speaker") as HTMLElement).textContent = speaker;
  (el.querySelector(".dlg-text") as HTMLElement).textContent = text;
  el.classList.remove("hidden", "dlg-out");
  void el.offsetWidth;
  el.classList.add("dlg-in");
  dialogueShownAt = performance.now();
  if (dialogueTimer != null) window.clearTimeout(dialogueTimer);
  // Reading time: ~55 ms a character, 5–14 s
  const ms = Math.max(5000, Math.min(14000, text.length * 55));
  dialogueTimer = window.setTimeout(hideDialogue, ms);
}

export function hideDialogue() {
  const el = document.getElementById("dialogue");
  if (dialogueTimer != null) {
    window.clearTimeout(dialogueTimer);
    dialogueTimer = null;
  }
  if (!el || el.classList.contains("hidden")) return;
  el.classList.remove("dlg-in");
  el.classList.add("dlg-out");
  window.setTimeout(() => {
    if (el.classList.contains("dlg-out")) el.classList.add("hidden");
  }, 360);
}

// ——— Canto title card (arrival) ———

let cardTimer: number | null = null;

export function showCantoCard(title: string, epigraph: string, goal: string) {
  let el = document.getElementById("canto-card");
  if (!el) {
    el = document.createElement("div");
    el.id = "canto-card";
    el.setAttribute("aria-live", "polite");
    el.innerHTML = `<div class="cc-rule"></div><div class="cc-title"></div><div class="cc-epi"></div><div class="cc-goal"></div><div class="cc-rule"></div>`;
    document.body.appendChild(el);
  }
  (el.querySelector(".cc-title") as HTMLElement).textContent = title;
  const epi = el.querySelector(".cc-epi") as HTMLElement;
  epi.textContent = epigraph;
  epi.hidden = !epigraph;
  const g = el.querySelector(".cc-goal") as HTMLElement;
  g.textContent = goal;
  g.hidden = !goal;
  el.classList.remove("cc-show");
  void el.offsetWidth;
  el.classList.add("cc-show");
  if (cardTimer != null) window.clearTimeout(cardTimer);
  cardTimer = window.setTimeout(() => {
    cardTimer = null;
    el?.classList.remove("cc-show");
  }, 3600);
}

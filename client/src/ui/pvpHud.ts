/**
 * PvP DOM: duel chip and invite, arena clock, kill feed, scoreboard, recap,
 * leaderboard. Writes text only when it changes. Mount before wireHud so
 * [data-close] on the Leaderboard panel is bound.
 */
import { isCompactUi } from "./hud";

const HOW_IT: Record<string, string> = {
  melee: "slash",
  finisher: "heavy blow",
  gale_bolt: "bolt",
  infernal_burst: "burst",
  dash: "dash",
  furious_cleave: "cleave",
  wrath_charge: "charge",
  war_cry: "cry",
  earthsplitter: "split",
  lance_of_light: "lance",
  grace: "grace",
  pillar_of_flame: "pillar",
  halo: "halo",
  shadow_step: "step",
  snare_glyph: "snare",
  summon_shade: "shade",
  tempest: "tempest",
  bastion: "bastion",
  thorns: "thorns",
  last_stand: "last stand",
};

export const HOW_ICON: Record<string, string> = {
  melee: "⚔",
  finisher: "✶",
  gale_bolt: "⇢",
  infernal_burst: "✹",
  dash: "»",
  furious_cleave: "⚔",
  wrath_charge: "»",
  war_cry: "✶",
  earthsplitter: "⚔",
  lance_of_light: "†",
  grace: "✚",
  pillar_of_flame: "✹",
  halo: "○",
  shadow_step: "»",
  snare_glyph: "⌗",
  summon_shade: "✧",
  tempest: "◎",
  bastion: "◈",
  thorns: "✶",
  last_stand: "✦",
};

const REASON_IT: Record<string, string> = {
  down: "knockdown",
  ring: "out of the ring",
  timeout: "time expired",
  draw: "draw",
  forfeit: "forfeit",
  disconnect: "disconnect",
};

export function howIt(how: string): string {
  return HOW_IT[how] || how;
}
export function howIcon(how: string): string {
  return HOW_ICON[how] || "⚔";
}
export function reasonIt(reason: string): string {
  return REASON_IT[reason] || reason;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  parent.appendChild(n);
  return n;
}

export type FeedRow = { killer: string; victim: string; how: string; mine: boolean; down: boolean; at: number };

export class PvpHud {
  root: HTMLElement;
  challenge: HTMLButtonElement;
  pending: HTMLButtonElement;
  invite: HTMLElement;
  inviteText: HTMLElement;
  inviteBar: HTMLElement;
  countdown: HTMLElement;
  ringWarn: HTMLElement;
  result: HTMLElement;
  resultTitle: HTMLElement;
  resultSub: HTMLElement;
  opp: HTMLElement;
  oppName: HTMLElement;
  oppFill: HTMLElement;
  arena: HTMLElement;
  arenaClock: HTMLElement;
  arenaRound: HTMLElement;
  streak: HTMLElement;
  feed: HTMLElement;
  feedRows: HTMLElement[];
  announce: HTMLElement;
  score: HTMLElement;
  scoreBody: HTMLElement;
  roundEnd: HTMLElement;
  roundEndBody: HTMLElement;
  queue: HTMLButtonElement;
  recap: HTMLElement;
  recapTitle: HTMLElement;
  recapList: HTMLElement;
  recapTimer: HTMLElement;
  boardBody: HTMLElement;
  boardYou: HTMLElement;
  boardStats: HTMLElement;
  mute: HTMLButtonElement;
  hurt: HTMLElement;
  hitDir: HTMLElement;
  queueHint: HTMLElement;
  classifica: HTMLButtonElement;
  tabella: HTMLButtonElement;
  menuBtn: HTMLButtonElement | null = null;
  menu: HTMLElement;
  menuCatch: HTMLElement;
  queueChip: HTMLButtonElement;
  queueBadge: HTMLElement | null = null;
  private roundNext: HTMLElement | null = null;
  private challengeText = "";
  private pendingText = "";
  private countText = "";
  private clockText = "";
  private roundText = "";
  private streakText = "";
  private queueText = "";
  private oppLabel = "";
  private oppWidth = "";
  recapOn = false;
  scorePinned = false;
  private menuIsOpen = false;

  constructor(handlers: {
    onChallenge: () => void;
    onCancel: () => void;
    onAccept: () => void;
    onDecline: () => void;
    onQueue: () => void;
    onBoard: () => void;
    onScore: () => void;
    onMute: () => void;
    onChallenges?: () => void;
  }) {
    this.root = el("div", "pvp-root", document.body);

    this.menuBtn = document.getElementById("btn-menu") as HTMLButtonElement | null;
    this.queueBadge = document.getElementById("pvp-menu-badge");
    this.menuCatch = el("div", "pvp-menu-catch hidden", this.root);
    this.menu = el("div", "pvp-menu hidden", this.root);
    this.menu.id = "pvp-menu";
    this.menu.setAttribute("role", "menu");
    this.menu.setAttribute("aria-label", "Game menu");

    this.classifica = el("button", "pvp-menu-item", this.menu);
    this.classifica.type = "button";
    this.classifica.setAttribute("role", "menuitem");
    this.classifica.innerHTML = `Leaderboard<span class="pvp-menu-hot">L</span>`;
    this.classifica.addEventListener("click", (e) => {
      e.preventDefault();
      this.closeMenu();
      handlers.onBoard();
    });
    this.tabella = el("button", "pvp-menu-item pvp-tabella", this.menu);
    this.tabella.type = "button";
    this.tabella.setAttribute("role", "menuitem");
    this.tabella.innerHTML = `Scoreboard<span class="pvp-menu-hot">Tab</span>`;
    this.tabella.addEventListener("click", (e) => {
      e.preventDefault();
      this.closeMenu();
      handlers.onScore();
    });
    const chal = el("button", "pvp-menu-item", this.menu);
    chal.type = "button";
    chal.setAttribute("role", "menuitem");
    chal.innerHTML = `Challenges<span class="pvp-menu-hot">J</span>`;
    chal.addEventListener("click", (e) => {
      e.preventDefault();
      this.closeMenu();
      handlers.onChallenges?.();
    });
    this.queue = el("button", "pvp-menu-item pvp-queue", this.menu);
    this.queue.type = "button";
    this.queue.setAttribute("role", "menuitem");
    this.queue.textContent = "Ranked 1v1";
    this.queue.addEventListener("click", (e) => {
      e.preventDefault();
      this.closeMenu();
      handlers.onQueue();
    });
    this.queueHint = el("div", "pvp-queue-hint", this.menu);
    this.mute = el("button", "pvp-menu-item pvp-mute", this.menu);
    this.mute.type = "button";
    this.mute.setAttribute("role", "menuitem");
    this.mute.textContent = "Sound";
    this.mute.addEventListener("click", (e) => {
      e.preventDefault();
      handlers.onMute();
    });

    this.queueChip = el("button", "pvp-queue-chip hidden", this.root);
    this.queueChip.type = "button";
    this.queueChip.setAttribute("aria-label", "Queued — open menu to cancel");
    this.queueChip.addEventListener("click", (e) => {
      e.preventDefault();
      this.openMenu();
    });
    const util = document.getElementById("hud-util");
    if (util) util.insertBefore(this.queueChip, util.firstChild);

    this.menuBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleMenu();
    });
    this.menuCatch.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.closeMenu();
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape" && this.menuIsOpen) {
        e.preventDefault();
        this.closeMenu();
      }
    });
    window.addEventListener("resize", () => {
      if (this.menuIsOpen) this.placeMenu();
    });

    this.challenge = el("button", "pvp-challenge hidden", this.root);
    this.challenge.type = "button";
    this.challenge.addEventListener("click", (e) => {
      e.preventDefault();
      handlers.onChallenge();
    });
    this.pending = el("button", "pvp-pending hidden", this.root);
    this.pending.type = "button";
    this.pending.addEventListener("click", (e) => {
      e.preventDefault();
      handlers.onCancel();
    });

    this.invite = el("div", "pvp-invite hidden", this.root);
    this.inviteText = el("p", "pvp-invite-text", this.invite);
    const barTrack = el("div", "pvp-invite-track", this.invite);
    this.inviteBar = el("i", "", barTrack);
    const row = el("div", "pvp-invite-row", this.invite);
    const yes = el("button", "pvp-yes", row);
    yes.type = "button";
    yes.textContent = "Accept (Y)";
    yes.addEventListener("click", (e) => {
      e.preventDefault();
      handlers.onAccept();
    });
    const no = el("button", "pvp-no", row);
    no.type = "button";
    no.textContent = "Decline (N)";
    no.addEventListener("click", (e) => {
      e.preventDefault();
      handlers.onDecline();
    });

    this.countdown = el("div", "pvp-countdown hidden", this.root);
    this.ringWarn = el("div", "pvp-ringwarn hidden", this.root);
    this.result = el("div", "pvp-result hidden", this.root);
    this.resultTitle = el("div", "pvp-result-title", this.result);
    this.resultSub = el("div", "pvp-result-sub", this.result);

    this.opp = el("div", "pvp-opp hidden", this.root);
    this.oppName = el("div", "pvp-opp-name", this.opp);
    const oppTrack = el("div", "pvp-opp-track", this.opp);
    this.oppFill = el("i", "", oppTrack);

    this.arena = el("div", "pvp-arena hidden", this.root);
    this.arenaRound = el("div", "pvp-arena-round", this.arena);
    this.arenaClock = el("div", "pvp-arena-clock", this.arena);
    this.streak = el("div", "pvp-streak", this.arena);

    this.feed = el("div", "pvp-feed", this.root);
    this.feedRows = [];
    for (let i = 0; i < 5; i++) {
      const rowEl = el("div", "pvp-feed-row", this.feed);
      rowEl.style.display = "none";
      this.feedRows.push(rowEl);
    }

    this.announce = el("div", "pvp-announce hidden", this.root);

    this.score = el("div", "pvp-score hidden", this.root);
    const scoreCard = el("div", "pvp-score-card", this.score);
    el("div", "pvp-score-head", scoreCard).textContent = "Round scoreboard";
    this.scoreBody = el("div", "pvp-score-body", scoreCard);

    this.roundEnd = el("div", "pvp-roundend hidden", this.root);
    this.roundEndBody = el("div", "pvp-roundend-card", this.roundEnd);

    this.recap = el("div", "pvp-recap hidden", this.root);
    const recapCard = el("div", "pvp-recap-card", this.recap);
    this.recapTitle = el("div", "pvp-recap-title", recapCard);
    this.recapList = el("div", "pvp-recap-list", recapCard);
    this.recapTimer = el("div", "pvp-recap-timer", recapCard);

    this.hurt = el("div", "pvp-hurt", document.body);
    this.hitDir = el("div", "pvp-hitdir", document.body);
    el("div", "pvp-low", document.body);

    const panels = document.getElementById("panels") || document.body;
    const board = el("aside", "panel modal hidden", panels);
    board.id = "pvp-board";
    board.setAttribute("aria-label", "Leaderboard");
    const head = el("div", "panel-head", board);
    const h2 = el("h2", "", head);
    h2.textContent = "Leaderboard";
    const close = el("button", "btn-close", head);
    close.type = "button";
    close.setAttribute("data-close", "pvp-board");
    close.setAttribute("aria-label", "Close leaderboard");
    close.textContent = "✕";
    const scroll = el("div", "pvp-board-scroll", board);
    this.boardBody = el("div", "pvp-board-table", scroll);
    this.boardYou = el("div", "pvp-board-you", scroll);
    this.boardStats = el("div", "pvp-board-stats", scroll);
    const titles = el("div", "pvp-titles", scroll);
    titles.innerHTML =
      "<h3>Titles</h3><p>Cosmetic only — no stats change.</p><ul>" +
      "<li><b>Wounded</b> — first blood given or taken</li>" +
      "<li><b>Duelist</b> — 5 duel wins</li>" +
      "<li><b>Fury</b> — best streak of 5</li>" +
      "<li><b>Champion</b> — 3 arena rounds won</li>" +
      "<li><b>Giant</b> — peak rating 1500</li>" +
      "</ul>";
  }

  menuOpen(): boolean {
    return this.menuIsOpen;
  }

  toggleMenu() {
    if (this.menuIsOpen) this.closeMenu();
    else this.openMenu();
  }

  openMenu() {
    this.menuIsOpen = true;
    this.menu.classList.remove("hidden");
    this.menuCatch.classList.remove("hidden");
    this.menuBtn?.setAttribute("aria-expanded", "true");
    this.menuBtn?.classList.add("is-open");
    this.placeMenu();
  }

  closeMenu(): boolean {
    if (!this.menuIsOpen) return false;
    this.menuIsOpen = false;
    this.menu.classList.add("hidden");
    this.menuCatch.classList.add("hidden");
    this.menuBtn?.setAttribute("aria-expanded", "false");
    this.menuBtn?.classList.remove("is-open");
    return true;
  }

  private placeMenu() {
    const btn = this.menuBtn;
    const menu = this.menu;
    if (!btn || menu.classList.contains("hidden")) return;
    const r = btn.getBoundingClientRect();
    const pad = 8;
    const compact = isCompactUi();
    const landscape = document.body.classList.contains("hud-landscape");
    const mw = Math.min(landscape ? 240 : 280, window.innerWidth - pad * 2);
    menu.style.width = `${mw}px`;
    const mh = menu.offsetHeight || 200;
    const reserve = compact ? (landscape ? 118 : 130) : 16;
    const util = document.getElementById("hud-util")?.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - pad - reserve;
    const spaceLeft = (util?.left ?? r.left) - pad;
    let top: number;
    let left: number;
    if (landscape && spaceLeft >= Math.min(mw, 180)) {
      left = Math.max(pad, (util?.left ?? r.left) - mw - 6);
      top = Math.max(pad, Math.min(util?.top ?? r.top, window.innerHeight - mh - pad - reserve));
    } else if (spaceBelow < mh && spaceLeft >= Math.min(mw, 180)) {
      left = Math.max(pad, r.left - mw - 6);
      top = Math.min(r.top, window.innerHeight - mh - pad - reserve);
      top = Math.max(pad, top);
    } else {
      top = r.bottom + 6;
      if (top + mh + pad + reserve > window.innerHeight) {
        top = Math.max(pad, r.top - mh - 6);
      }
      left = r.right - mw;
      if (left < pad) left = pad;
      if (left + mw > window.innerWidth - pad) left = window.innerWidth - mw - pad;
    }
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.right = "auto";
  }



  setMuted(muted: boolean) {
    this.mute.textContent = muted ? "Muted" : "Sound";
    this.mute.classList.toggle("is-muted", muted);
  }

  setChallenge(text: string | null) {
    const next = text || "";
    if (next === this.challengeText && this.challenge.classList.contains("hidden") === !next) return;
    this.challengeText = next;
    this.challenge.classList.toggle("hidden", !next);
    if (next && this.challenge.textContent !== next) this.challenge.textContent = next;
  }

  setPending(text: string | null) {
    const next = text || "";
    if (next === this.pendingText) return;
    this.pendingText = next;
    this.pending.classList.toggle("hidden", !next);
    if (next && this.pending.textContent !== next) this.pending.textContent = next;
  }

  showInvite(text: string) {
    this.invite.classList.remove("hidden");
    if (this.inviteText.textContent !== text) this.inviteText.textContent = text;
  }
  hideInvite() {
    if (!this.invite.classList.contains("hidden")) this.invite.classList.add("hidden");
  }
  inviteOpen(): boolean {
    return !this.invite.classList.contains("hidden");
  }
  setInviteFrac(frac: number) {
    const w = `${Math.max(0, Math.min(100, Math.round(frac * 100)))}%`;
    if (this.inviteBar.style.width !== w) this.inviteBar.style.width = w;
  }

  setCountdown(text: string | null) {
    const next = text || "";
    if (next === this.countText) return;
    this.countText = next;
    this.countdown.classList.toggle("hidden", !next);
    if (next) {
      this.countdown.textContent = next;
      this.countdown.classList.remove("pvp-pop");
      void this.countdown.offsetWidth;
      this.countdown.classList.add("pvp-pop");
    }
  }

  setRingWarn(text: string | null) {
    const on = Boolean(text);
    this.ringWarn.classList.toggle("hidden", !on);
    if (text && this.ringWarn.textContent !== text) this.ringWarn.textContent = text;
  }

  showResult(title: string, sub: string) {
    this.resultTitle.textContent = title;
    this.resultSub.textContent = sub;
    this.result.classList.remove("hidden");
    this.result.classList.remove("pvp-pop");
    void this.result.offsetWidth;
    this.result.classList.add("pvp-pop");
  }
  hideResult() {
    this.result.classList.add("hidden");
  }

  setOpponent(name: string | null, ratio: number) {
    const on = Boolean(name);
    this.opp.classList.toggle("hidden", !on);
    if (!name) return;
    if (name !== this.oppLabel) {
      this.oppLabel = name;
      this.oppName.textContent = name;
    }
    const w = `${Math.max(0, Math.min(100, Math.round(ratio * 100)))}%`;
    if (w !== this.oppWidth) {
      this.oppWidth = w;
      this.oppFill.style.width = w;
    }
  }

  setArena(on: boolean, roundLabel: string, clock: string, streak: string) {
    this.arena.classList.toggle("hidden", !on);
    if (!on) return;
    if (roundLabel !== this.roundText) {
      this.roundText = roundLabel;
      this.arenaRound.textContent = roundLabel;
    }
    if (clock !== this.clockText) {
      this.clockText = clock;
      this.arenaClock.textContent = clock;
    }
    if (streak !== this.streakText) {
      this.streakText = streak;
      this.streak.textContent = streak;
      this.streak.classList.toggle("hidden", !streak);
    }
  }

  setQueue(text: string, queued: boolean, hint = "", clock = "") {
    if (text !== this.queueText) {
      this.queueText = text;
      this.queue.textContent = text;
    }
    this.queue.classList.toggle("is-queued", queued);
    this.queueHint.classList.toggle("on", Boolean(hint));
    if (hint && this.queueHint.textContent !== hint) this.queueHint.textContent = hint;
    this.menuBtn?.classList.toggle("is-queued", queued);
    if (this.queueBadge) {
      const badge = clock || "";
      this.queueBadge.classList.toggle("hidden", !queued);
      if (queued && this.queueBadge.textContent !== badge) this.queueBadge.textContent = badge;
    }
    this.queueChip.classList.toggle("hidden", !queued);
    if (queued) {
      const chip = clock ? `Queued ${clock}` : "Queued";
      if (this.queueChip.textContent !== chip) this.queueChip.textContent = chip;
    }
    if (this.menuIsOpen) this.placeMenu();
  }

  setFeed(rows: readonly FeedRow[], now: number) {
    for (let i = 0; i < this.feedRows.length; i++) {
      const node = this.feedRows[i]!;
      const row = rows[i];
      if (!row) {
        if (node.style.display !== "none") node.style.display = "none";
        continue;
      }
      if (node.style.display !== "block") node.style.display = "block";
      const age = now - row.at;
      node.classList.toggle("mine", row.mine && !row.down);
      node.classList.toggle("victim", row.down);
      node.classList.toggle("fade", age > 4600);
      const text = `${row.killer} ${howIcon(row.how)} ${row.victim}`;
      if (node.textContent !== text) node.textContent = text;
    }
  }

  flashAnnounce(text: string) {
    this.announce.textContent = text;
    this.announce.classList.remove("hidden", "pvp-pop");
    void this.announce.offsetWidth;
    this.announce.classList.add("pvp-pop");
  }
  hideAnnounce() {
    this.announce.classList.add("hidden");
  }

  setScore(html: string, show: boolean) {
    this.score.classList.toggle("hidden", !show);
    if (show && this.scoreBody.innerHTML !== html) this.scoreBody.innerHTML = html;
  }
  toggleScorePin() {
    this.scorePinned = !this.scorePinned;
    if (!this.scorePinned) this.score.classList.add("hidden");
    return this.scorePinned;
  }

  showRoundEnd(html: string) {
    this.roundEndBody.innerHTML = html;
    const next = this.roundEndBody.querySelector(".pvp-roundend-next");
    this.roundNext = next instanceof HTMLElement ? next : null;
    this.roundEnd.classList.remove("hidden");
  }
  setRoundNext(text: string) {
    const n = this.roundNext;
    if (n && n.textContent !== text) n.textContent = text;
  }
  hideRoundEnd() {
    this.roundEnd.classList.add("hidden");
    this.roundNext = null;
  }

  showRecap(title: string, rowsHtml: string) {
    this.recapOn = true;
    this.recap.classList.remove("hidden", "pvp-recap-out");
    this.recapTitle.textContent = title;
    this.recapList.innerHTML = rowsHtml;
  }
  setRecapTimer(text: string) {
    if (this.recapTimer.textContent !== text) this.recapTimer.textContent = text;
  }
  hideRecap() {
    if (!this.recapOn && this.recap.classList.contains("hidden")) return;
    this.recapOn = false;
    this.recap.classList.add("pvp-recap-out");
    window.setTimeout(() => {
      if (!this.recapOn) this.recap.classList.add("hidden");
    }, 420);
  }

  pulseHurt() {
    this.hurt.classList.remove("pvp-hurt-on");
    void this.hurt.offsetWidth;
    this.hurt.classList.add("pvp-hurt-on");
  }

  /** Screen angle in degrees: 0 is up (threat ahead of the camera). */
  pulseHit(deg: number) {
    this.hitDir.style.setProperty("--hit-ang", `${Math.round(deg)}deg`);
    this.hitDir.classList.remove("on");
    void this.hitDir.offsetWidth;
    this.hitDir.classList.add("on");
  }

  setLowHp(on: boolean) {
    document.body.classList.toggle("pvp-lowhp", on);
  }

  setKillCam(on: boolean) {
    document.body.classList.toggle("pvp-killcam", on);
  }

  setBoard(html: string, youHtml: string, statsHtml: string) {
    this.boardBody.innerHTML = html;
    this.boardYou.innerHTML = youHtml;
    this.boardStats.innerHTML = statsHtml;
  }

  compactHint(): string {
    return isCompactUi() ? "" : " (G)";
  }
}

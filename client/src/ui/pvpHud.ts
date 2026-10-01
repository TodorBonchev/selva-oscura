/**
 * PvP DOM: duel chip and invite, arena clock, kill feed, scoreboard, recap,
 * leaderboard. Writes text only when it changes. Mount before wireHud so
 * [data-close] on the Classifica panel is bound.
 */
import { isCompactUi } from "./hud";

const HOW_IT: Record<string, string> = {
  melee: "fendente",
  finisher: "colpo grave",
  gale_bolt: "dardo",
  infernal_burst: "vampata",
  dash: "scatto",
};

export const HOW_ICON: Record<string, string> = {
  melee: "⚔",
  finisher: "✶",
  gale_bolt: "⇢",
  infernal_burst: "✹",
  dash: "»",
};

const REASON_IT: Record<string, string> = {
  down: "atterramento",
  ring: "fuori dal cerchio",
  timeout: "tempo scaduto",
  draw: "pareggio",
  forfeit: "resa",
  disconnect: "sconnessione",
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

export type FeedRow = { killer: string; victim: string; how: string; mine: boolean; at: number };

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
  classifica: HTMLButtonElement;
  tabella: HTMLButtonElement;
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

  constructor(handlers: {
    onChallenge: () => void;
    onCancel: () => void;
    onAccept: () => void;
    onDecline: () => void;
    onQueue: () => void;
    onBoard: () => void;
    onScore: () => void;
    onMute: () => void;
  }) {
    this.root = el("div", "pvp-root", document.body);

    const tools = el("div", "pvp-tools", this.root);
    this.classifica = el("button", "pvp-tool", tools);
    this.classifica.type = "button";
    this.classifica.textContent = "Classifica";
    this.classifica.addEventListener("click", (e) => {
      e.preventDefault();
      handlers.onBoard();
    });
    this.tabella = el("button", "pvp-tool pvp-tabella", tools);
    this.tabella.type = "button";
    this.tabella.textContent = "Tabella";
    this.tabella.addEventListener("click", (e) => {
      e.preventDefault();
      handlers.onScore();
    });
    this.queue = el("button", "pvp-tool pvp-queue", tools);
    this.queue.type = "button";
    this.queue.textContent = "Classificata 1v1";
    this.queue.addEventListener("click", (e) => {
      e.preventDefault();
      handlers.onQueue();
    });
    this.mute = el("button", "pvp-tool pvp-mute", tools);
    this.mute.type = "button";
    this.mute.textContent = "Suono";
    this.mute.addEventListener("click", (e) => {
      e.preventDefault();
      handlers.onMute();
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
    yes.textContent = "Accetta (Y)";
    yes.addEventListener("click", (e) => {
      e.preventDefault();
      handlers.onAccept();
    });
    const no = el("button", "pvp-no", row);
    no.type = "button";
    no.textContent = "Rifiuta (N)";
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
    el("div", "pvp-score-head", scoreCard).textContent = "Tabella del round";
    this.scoreBody = el("div", "pvp-score-body", scoreCard);

    this.roundEnd = el("div", "pvp-roundend hidden", this.root);
    this.roundEndBody = el("div", "pvp-roundend-card", this.roundEnd);

    this.recap = el("div", "pvp-recap hidden", this.root);
    const recapCard = el("div", "pvp-recap-card", this.recap);
    this.recapTitle = el("div", "pvp-recap-title", recapCard);
    this.recapList = el("div", "pvp-recap-list", recapCard);
    this.recapTimer = el("div", "pvp-recap-timer", recapCard);

    this.hurt = el("div", "pvp-hurt", document.body);

    const panels = document.getElementById("panels") || document.body;
    const board = el("aside", "panel modal hidden", panels);
    board.id = "pvp-board";
    board.setAttribute("aria-label", "Classifica");
    const head = el("div", "panel-head", board);
    const h2 = el("h2", "", head);
    h2.textContent = "Classifica";
    const close = el("button", "btn-close", head);
    close.type = "button";
    close.setAttribute("data-close", "pvp-board");
    close.setAttribute("aria-label", "Chiudi classifica");
    close.textContent = "✕";
    const scroll = el("div", "pvp-board-scroll", board);
    this.boardBody = el("div", "pvp-board-table", scroll);
    this.boardYou = el("div", "pvp-board-you", scroll);
    this.boardStats = el("div", "pvp-board-stats", scroll);
    const titles = el("div", "pvp-titles", scroll);
    titles.innerHTML =
      "<h3>Titoli</h3><p>Solo ornamento — nessuna statistica cambia.</p><ul>" +
      "<li><b>Ferito</b> — primo sangue, dato o preso</li>" +
      "<li><b>Duellante</b> — 5 vittorie in duello</li>" +
      "<li><b>Furia</b> — serie migliore di 5</li>" +
      "<li><b>Campione</b> — 3 round dell'arena vinti</li>" +
      "<li><b>Gigante</b> — rating di picco 1500</li>" +
      "</ul>";
  }

  setMuted(muted: boolean) {
    this.mute.textContent = muted ? "Muto" : "Suono";
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

  setQueue(text: string, queued: boolean) {
    if (text !== this.queueText) {
      this.queueText = text;
      this.queue.textContent = text;
    }
    this.queue.classList.toggle("is-queued", queued);
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
      node.classList.toggle("mine", row.mine);
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
    this.roundEnd.classList.remove("hidden");
  }
  hideRoundEnd() {
    this.roundEnd.classList.add("hidden");
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

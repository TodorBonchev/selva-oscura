export type Handler = (msg: any) => void;

function toWsUrl(httpBase: string): string {
  const u = new URL(httpBase);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws";
  u.search = "";
  u.hash = "";
  return u.toString();
}

/** Pings unanswered this long (ms) → the link is dead: reconnect (GameSocket.recycle). */
const PONG_DEAD_MS = 9000;

export class GameSocket {
  ws: WebSocket | null = null;
  playerId: string | null = null;
  /** Last room snapshot — replayed to handlers that attach after it arrived (scene boot race). */
  lastSnapshot: any = null;
  private handlers = new Set<Handler>();
  private url: string;
  private name: string;
  private reconnectTimer: number | null = null;
  /** True after the first successful open — used to toast drops / reconnects only. */
  private everConnected = false;
  /**
   * Smoothed round trip (ms; 0 until measured). Reported back with each ping so the
   * server can give telegraph dodges that much grace (server telegraph.mjs).
   */
  rttMs = 0;
  private pingTimer: number | null = null;
  /** performance.now() of the oldest ping still unanswered (0 = none outstanding). */
  private pingPendingSince = 0;
  /** The server handed this pilgrim to a newer connection (close 4000): stay down. */
  replaced = false;

  constructor(httpBase: string, name: string) {
    this.url = toWsUrl(httpBase);
    this.name = name;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      const wasConnected = this.everConnected;
      this.everConnected = true;
      this.send({ type: "hello", name: this.name, protocol: 1 });
      this.startPings();
      if (wasConnected) {
        for (const h of this.handlers) h({ type: "net", state: "reconnected" });
      }
    };
    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "welcome") this.playerId = msg.playerId;
      if (msg.type === "snapshot") this.lastSnapshot = msg;
      if (msg.type === "pong") this.notePong(msg);
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = (ev) => {
      this.stopPings();
      if (ev.code === 4000) {
        // another tab / device took this pilgrim over: reconnecting would steal it back
        this.replaced = true;
        for (const h of this.handlers) h({ type: "net", state: "replaced" });
        return;
      }
      if (this.everConnected) {
        for (const h of this.handlers) h({ type: "net", state: "disconnected" });
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // close will fire
    };
  }

  /** Ping every 2 s (and right away) to keep a round-trip estimate. */
  private startPings() {
    this.stopPings();
    this.pingPendingSince = 0;
    const ping = () => {
      const now = performance.now();
      // Watchdog: pings unanswered this long mean a dead link the browser hasn't
      // noticed (a phone switching networks) — drop it and dial again
      if (this.pingPendingSince > 0 && now - this.pingPendingSince > PONG_DEAD_MS) {
        this.recycle();
        return;
      }
      if (this.pingPendingSince === 0) this.pingPendingSince = now;
      this.send({ type: "ping", c: now, rtt: this.rttMs > 0 ? Math.round(this.rttMs) : undefined });
    };
    ping();
    this.pingTimer = window.setInterval(ping, 2000);
  }

  /** Abandon a silent socket (its late close is ignored) and reconnect at once. */
  private recycle() {
    const old = this.ws;
    this.stopPings();
    if (old) {
      old.onopen = null;
      old.onmessage = null;
      old.onclose = null;
      old.onerror = null;
      try {
        old.close();
      } catch {
        /* already closing */
      }
    }
    this.ws = null;
    if (this.everConnected) {
      for (const h of this.handlers) h({ type: "net", state: "disconnected" });
    }
    this.connect();
  }

  private stopPings() {
    if (this.pingTimer != null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private notePong(msg: { c?: number }) {
    this.pingPendingSince = 0;
    const c = Number(msg.c);
    if (!Number.isFinite(c)) return;
    const sample = performance.now() - c;
    if (!(sample >= 0) || sample > 5000) return;
    // quick to believe a faster link, slow to believe one spike
    if (this.rttMs <= 0) this.rttMs = sample;
    else this.rttMs += (sample - this.rttMs) * (sample < this.rttMs ? 0.5 : 0.2);
  }

  private scheduleReconnect() {
    if (this.reconnectTimer != null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  on(handler: Handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  move(x: number, y: number) {
    this.send({ type: "move", x, y });
  }
  /** Date.now() of the last attack packet (the server's swing cooldown runs from it). */
  lastAttackAt = 0;
  /** combo: this swing's place in the 3-hit chain (2 = the overhead finisher). */
  attack(targetId: string, combo = 0) {
    this.lastAttackAt = Date.now();
    this.send({ type: "attack", targetId, combo });
  }
  cast(spellId: string, aim?: { x?: number; y?: number }) {
    this.send({
      type: "cast",
      spellId,
      aimX: aim?.x,
      aimY: aim?.y,
    });
  }
  interact(targetId: string) {
    this.send({ type: "interact", targetId });
  }
  travel(toCanto: string, opts?: { bypassGates?: boolean }) {
    this.send({
      type: "travel",
      toCanto,
      ...(opts?.bypassGates ? { bypassGates: true } : {}),
    });
  }
  pickup(lootId: string) {
    this.send({ type: "pickup", lootId });
  }
  ahBrowse() {
    this.send({ type: "ah_browse" });
  }
  ahList(itemId: string, priceAsh: number) {
    this.send({ type: "ah_list", itemId, priceAsh });
  }
  ahBuy(listingId: string) {
    this.send({ type: "ah_buy", listingId });
  }
  ahBid(listingId: string, bidAsh: number) {
    this.send({ type: "ah_bid", listingId, bidAsh });
  }
  claimDaily() {
    this.send({ type: "claim_daily" });
  }
  equip(itemId: string) {
    this.send({ type: "equip", itemId });
  }
  unequip(opts: { itemId?: string; slot?: string }) {
    this.send({ type: "unequip", itemId: opts.itemId, slot: opts.slot });
  }
  salvageBag() {
    this.send({ type: "salvage_bag" });
  }
  stashPut(itemId: string) {
    this.send({ type: "stash_put", itemId });
  }
  stashTake(itemId: string) {
    this.send({ type: "stash_take", itemId });
  }
  sip() {
    this.send({ type: "sip" });
  }
  dash(x: number, y: number) {
    this.send({ type: "dash", x, y });
  }
}

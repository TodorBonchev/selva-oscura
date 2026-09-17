export type Handler = (msg: any) => void;

function toWsUrl(httpBase: string): string {
  const u = new URL(httpBase);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws";
  u.search = "";
  u.hash = "";
  return u.toString();
}

export class GameSocket {
  ws: WebSocket | null = null;
  playerId: string | null = null;
  private handlers = new Set<Handler>();
  private url: string;
  private name: string;
  private reconnectTimer: number | null = null;

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
      this.send({ type: "hello", name: this.name, protocol: 1 });
    };
    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "welcome") this.playerId = msg.playerId;
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = () => {
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // close will fire
    };
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
  attack(targetId: string) {
    this.send({ type: "attack", targetId });
  }
  interact(targetId: string) {
    this.send({ type: "interact", targetId });
  }
  travel(toCanto: string) {
    this.send({ type: "travel", toCanto });
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
}

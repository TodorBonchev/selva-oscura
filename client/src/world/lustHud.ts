/**
 * Lust storm HUD: a wind arrow + countdown over the minimap while the storm warns and
 * blows, and a composited streak layer over the world during the gust (one fixed div,
 * animated by transform; its opacity follows the phase). Built on entering Lust, removed
 * on leaving. DOM is written only when a value changes (angle in 3° steps, label text).
 */
import "./lustHud.css";

/** One 420×180 tile of wind streaks (thin tapered strokes of varied length). */
function streakTile(): string {
  const lines: string[] = [];
  const rows = [
    [14, 30, 150, 0.55],
    [34, 210, 120, 0.4],
    [52, 90, 190, 0.5],
    [71, 300, 90, 0.35],
    [88, 20, 110, 0.45],
    [104, 170, 210, 0.6],
    [121, 330, 70, 0.3],
    [139, 60, 160, 0.5],
    [156, 250, 140, 0.42],
    [172, 120, 80, 0.3],
  ];
  for (const [y, x, w, a] of rows) {
    lines.push(
      `<rect x='${x}' y='${y}' width='${w}' height='1.6' rx='0.8' fill='url(#g)' opacity='${a}'/>`,
      // (wrapped copy so the tile repeats seamlessly)
      `<rect x='${x - 420}' y='${y}' width='${w}' height='1.6' rx='0.8' fill='url(#g)' opacity='${a}'/>`
    );
  }
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='180'>` +
    `<defs><linearGradient id='g' x1='0' x2='1'><stop offset='0' stop-color='#fff' stop-opacity='0'/>` +
    `<stop offset='0.7' stop-color='#f2eee8' stop-opacity='1'/><stop offset='1' stop-color='#fff' stop-opacity='0.2'/></linearGradient></defs>` +
    lines.join("") +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export class LustHud {
  private wind: HTMLDivElement | null = null;
  private rot: HTMLDivElement | null = null;
  private label: HTMLDivElement | null = null;
  private streaks: HTMLDivElement | null = null;
  private lastAng = 999;
  private lastLabel = "";
  private lastMode = "";

  constructor() {
    const map = document.getElementById("minimap");
    if (map) {
      const w = document.createElement("div");
      w.id = "lust-wind";
      w.innerHTML = `<div class="lw-rot"><div class="lw-arrow"></div></div><div class="lw-label"></div>`;
      map.appendChild(w);
      this.wind = w;
      this.rot = w.querySelector(".lw-rot");
      this.label = w.querySelector(".lw-label");
    }
    const s = document.createElement("div");
    s.id = "lust-streaks";
    s.style.setProperty("--lust-streak-tile", streakTile());
    s.appendChild(document.createElement("i"));
    document.body.appendChild(s);
    this.streaks = s;
  }

  /**
   * mode: "calm" | "warn" | "gust"; screenAng: the wind's direction on screen (radians,
   * clockwise from screen-right); label: the countdown / name shown over the map.
   */
  update(mode: string, screenAng: number, label: string) {
    if (mode !== this.lastMode) {
      this.lastMode = mode;
      const on = mode === "warn" || mode === "gust";
      if (this.wind) {
        this.wind.classList.toggle("on", on);
        this.wind.classList.toggle("warn", mode === "warn");
      }
      if (this.streaks) {
        this.streaks.classList.toggle("warn", mode === "warn");
        this.streaks.classList.toggle("gust", mode === "gust");
      }
    }
    if (mode === "calm") return;
    const deg = Math.round((screenAng * 180) / Math.PI / 3) * 3;
    if (deg !== this.lastAng) {
      this.lastAng = deg;
      if (this.rot) this.rot.style.transform = `rotate(${deg}deg)`;
      if (this.streaks) this.streaks.style.transform = `rotate(${deg}deg)`;
    }
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      if (this.label) this.label.textContent = label;
    }
  }

  dispose() {
    this.wind?.remove();
    this.streaks?.remove();
    this.wind = null;
    this.rot = null;
    this.label = null;
    this.streaks = null;
  }
}

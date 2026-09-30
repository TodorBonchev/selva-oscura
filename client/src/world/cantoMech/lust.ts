/**
 * Lust (inferno_05) canto mechanic, client side — the storm, the windbreaks, the tethered
 * lovers and Minos's judgement as the player sees and feels them. The authoritative half
 * is server/src/cantoMech/lust.mjs (its header documents the wire); the visuals live in
 * world/lustStorm.ts, the HUD in world/lustHud.ts, the shared geometry in world/lustGeo.ts.
 *
 * "La bufera infernal, che mai non resta, / mena li spirti con la sua rapina"
 */
import type { CantoMech } from "./index";
import type { WorldApp } from "../WorldApp";
import type { Objective } from "../objective";
import { LustStorm } from "../lustStorm";
import {
  DASH_DOWNWIND,
  PLAYER_DRIFT,
  PLAYER_PAD,
  inLee,
  pushOutOfRocks,
  sweepRocks,
  walkMul,
} from "../lustGeo";
import { registerAttackPose, type Pose } from "../mobAnim";
import { registerTelePalette, registerTeleWeight } from "../telegraphs";
import { showToast } from "../../ui/hud";

let storm: LustStorm | null = null;
/** The storm's first warning of the page session explains itself once. */
let stormExplained = false;

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Minos coils his tail: rises, the body winds round against the coil, then a jolt as the
// rings go out. u: windup 0..1 (the whole cascade), r: recovery 0..1.
registerAttackPose("minos_coil", (u, r, _st, out: Pose) => {
  const w = r > 0 ? Math.max(0, 1 - r * 2.2) : smooth(u);
  const s = r > 0 ? Math.sin(Math.min(1, r * 2.2) * Math.PI) : 0;
  out.y = 0.34 * w - 0.1 * s;
  out.ry = Math.sin(u * Math.PI * 4) * 0.22 * w;
  out.rx = 0.12 * w - 0.2 * s;
  out.sy = 1 + 0.05 * w - 0.05 * s;
});

// The sentence: he rears back to full height, winds his arm across, then bows forward
// and sweeps the fan of lines.
registerAttackPose("minos_sentence", (u, r, _st, out: Pose) => {
  const w = r > 0 ? Math.max(0, 1 - r / 0.25) : smooth(u);
  const s = r <= 0 ? 0 : r < 0.3 ? smooth(r / 0.3) : 1 - smooth((r - 0.3) / 0.7);
  out.rx = 0.24 * w - 0.46 * s;
  out.y = 0.4 * w - 0.12 * s;
  out.fz = 0.55 * s;
  out.ry = 0.38 * w - 0.5 * s;
});

// Colour-coded judgement: the coils in violet, the sentence bone-white on crimson (gold
// is the guidance colour — objective arrow, beacon, open gate: "gold = go" everywhere)
registerTelePalette("minos_coil", { base: 0x1c0418, hot: 0xb0247a, rim: 0xff8ad0 });
registerTelePalette("minos_sentence", { base: 0x1c0406, hot: 0xd8283c, rim: 0xfff0ea });
// the storm's own strikes: cold ash-blue, unlike any foe's blow
registerTelePalette("bufera_strike", { base: 0x080c14, hot: 0x6f8fc0, rim: 0xe6eeff });
// His blows land like a boss's slam (shock, hit light, camera); the sentence's lines a
// little lighter (up to three land 0.2 s apart)
registerTeleWeight("minos_coil", "boss");
registerTeleWeight("minos_sentence", "champ");

/**
 * Minos's dodge callouts on the shared #dodge-callout (the generic "Dash the slam" is
 * keyed on boss_slam): shown for the whole cascade / fan, in his colours
 * (lustHud.css). One timer: the sentence, cast while the last coil still spreads,
 * takes over the coils' callout instead of being hidden by its timer.
 */
let calloutTimer = 0;

function judgeCallout(text: string, sec: number, sentence: boolean) {
  const el = document.getElementById("dodge-callout");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("avarice-dodge", "hidden");
  el.classList.add("lust-judge");
  el.classList.toggle("sentence", sentence);
  window.clearTimeout(calloutTimer);
  calloutTimer = window.setTimeout(() => el.classList.add("hidden"), Math.max(400, sec * 1000));
}

function clearJudgeCallout() {
  window.clearTimeout(calloutTimer);
  const el = document.getElementById("dodge-callout");
  if (el?.classList.contains("lust-judge")) el.classList.add("hidden");
  el?.classList.remove("lust-judge", "sentence");
}

function alive(e: any): boolean {
  return e && (e.hp == null || e.hp > 0);
}

/** Only a pilgrim in the Judge's reach gets his callouts. */
function nearJudge(app: WorldApp, id: unknown): boolean {
  const ents: any[] = app.room?.entities || [];
  const you = app.renderYou;
  for (const e of ents) {
    if (String(e.id) !== String(id)) continue;
    return Math.hypot(e.x - you.x, e.y - you.y) < 16;
  }
  return false;
}

function passed(e: any, you: { x: number; y: number }): boolean {
  return you.x > e.x + 8 && Math.hypot(e.x - you.x, e.y - you.y) > 10;
}

export const lustMech: CantoMech = {
  enter(app: WorldApp) {
    storm?.dispose();
    storm = new LustStorm(app);
    if (import.meta.env.DEV) (window as unknown as { __lustStorm?: LustStorm | null }).__lustStorm = storm;
  },

  exit() {
    storm?.dispose();
    storm = null;
    clearJudgeCallout();
  },

  tick(_app: WorldApp, dt: number) {
    storm?.tick(dt);
  },

  onSnapshot(_app: WorldApp, mech: any) {
    if (!storm || !mech || typeof mech !== "object") return;
    storm.sync(mech);
    if (mech.wb) storm.setWindbreaks(mech.wb);
    storm.lov = Array.isArray(mech.lov) ? (mech.lov as [string, string, number]) : null;
    storm.minosWard = mech.mw === 1;
  },

  onMessage(app: WorldApp, msg: any): boolean {
    if (!storm) return false;
    switch (msg.type) {
      case "lust_storm":
        storm.sync(msg);
        if (msg.phase === "warn" && !stormExplained) {
          stormExplained = true;
          showToast("La bufera infernal, che mai non resta — shelter in a rock's lee", "warn");
        }
        return true;
      case "lust_slam": {
        // "percotendo": a foe dashed against the rock
        const x = Number(msg.x) || 0;
        const y = Number(msg.y) || 0;
        app.spawnHitFx({ x, y }, 0xd8cabc, true);
        // it rebounds off the rock, back into the wind
        const rec = app.nodes.get(String(msg.id));
        if (rec) app.combat?.hitMob(rec, x + storm.wx * 2, y + storm.wy * 2, true, performance.now());
        const d = Math.hypot(x - app.renderYou.x, y - app.renderYou.y);
        if (d < 14) app.kickShake(0.14 * (1 - d / 14), x - app.renderYou.x, y - app.renderYou.y);
        return true;
      }
      case "lust_tether": {
        if (storm.lov) storm.lov[2] = msg.state === "bind" ? 1 : msg.state === "cut" ? 2 : 0;
        if (msg.state === "cut" || msg.state === "snap") {
          const x = Number(msg.x);
          const y = Number(msg.y);
          if (Number.isFinite(x) && Number.isFinite(y)) app.spawnHitFx({ x, y }, 0xff6a8c, msg.state === "cut");
        }
        return true;
      }
      case "lust_coil": {
        const n = Math.max(1, Math.min(3, Number(msg.n) || 1));
        const ms: number[] = Array.isArray(msg.ms) ? msg.ms : [];
        storm.startCoil(String(msg.id), n, ms);
        // "cignesi con la coda tante volte": out of each ring, back in behind it
        const last = Number(ms[ms.length - 1]) || 1200;
        if (nearJudge(app, msg.id)) judgeCallout(n > 1 ? `Coils ×${n} — out, then in` : "Out of the coil", last / 1000, false);
        return true;
      }
      case "lust_sentence":
        if (nearJudge(app, msg.id)) judgeCallout("Step off the sentence", (Number(msg.ms) || 800) / 1000, true);
        return true;
      default:
        return false;
    }
  },

  objective(app: WorldApp, obj: Objective) {
    const room: any = app.room;
    if (!room || !storm) return;
    const you = app.renderYou;
    const ents: any[] = room.entities || [];
    // The chain: Storm Heart → the lovers → Minos → the gate
    const t = obj.target;
    const onHeart = t?.kind === "foe" && String(t.entity?.archetype || "") === "storm_heart";
    const cleared = Array.isArray(room.you?.firstClears) && room.you.firstClears.includes("inferno_05");
    if (!onHeart && !cleared && t?.kind === "foe") {
      let lover: any = null;
      let best = Infinity;
      let n = 0;
      for (const e of ents) {
        if (e.kind !== "mob" || e.packId !== "lust_champion_pair" || !alive(e)) continue;
        n++;
        const d = Math.hypot(e.x - you.x, e.y - you.y);
        if (d < best && !passed(e, you)) {
          best = d;
          lover = e;
        }
      }
      if (lover) {
        const bound = storm.lov?.[2] === 1;
        obj.text =
          n < 2
            ? `Slay ${lover.name} — «ad una morte»`
            : bound
              ? "Part the lovers — their bond shares every wound"
              : "The bond is broken — strike the lovers down";
        obj.target = { id: String(lover.id), x: lover.x, y: lover.y, label: n < 2 ? String(lover.name) : "The lovers", kind: "foe", entity: lover };
      } else if (t.entity?.kind === "boss" && storm.minosWard) {
        // the flock shields him: point at the nearest borne shade
        let shade: any = null;
        let bd = Infinity;
        for (const e of ents) {
          // (the borne flock is no pack: its ids carry the server's prefix)
          if (e.kind !== "mob" || !String(e.id).startsWith("mob_lustflock_") || !alive(e)) continue;
          const d = Math.hypot(e.x - you.x, e.y - you.y);
          if (d < bd) {
            bd = d;
            shade = e;
          }
        }
        obj.text = "The flock shields Minos — scatter the borne shades";
        if (shade) obj.target = { id: String(shade.id), x: shade.x, y: shade.y, label: "Borne Shade", kind: "foe", entity: shade };
      } else if (t.entity?.kind === "boss") {
        obj.text = "Minos judges at the gate — slay him";
        t.label = "Minos";
      } else if (obj.text.endsWith("the Judge")) {
        // "Defeat Bufera — then the Judge"
        obj.text = obj.text.slice(0, -"the Judge".length) + "Minos";
      }
    }
    // The storm owns the second line while it warns and blows
    const now = performance.now();
    if (storm.phase === "warn") {
      obj.sub = `La bufera in ${Math.ceil(storm.leftSec(now) * 10) / 10}s — shelter in a rock's lee`;
    } else if (storm.phase === "gust" && storm.str > 0.05) {
      obj.sub = storm.judged
        ? "Minos's sentence blows you toward the edge"
        : storm.sheltered
          ? "Sheltered in the lee — the storm passes over"
          : "La bufera — shelter in a rock's lee";
    }
  },

  moveFeel(app: WorldApp, out) {
    const s = storm;
    if (!s) return;
    s.driftX = 0;
    s.driftY = 0;
    const now = performance.now();
    const str = s.strength(now);
    if (str <= 0.02) return;
    const you = app.renderYou;
    if (inLee(s.wb, s.wx, s.wy, you.x, you.y)) return;
    const vl = Math.hypot(app.velX, app.velY);
    if (vl > 0.3) out.speedMul *= walkMul(app.velX / vl, app.velY / vl, s.wx, s.wy, str);
    s.driftX = s.wx * PLAYER_DRIFT * str;
    s.driftY = s.wy * PLAYER_DRIFT * str;
    out.driftX += s.driftX;
    out.driftY += s.driftY;
  },

  collide(_app: WorldApp, p) {
    if (storm?.wb) pushOutOfRocks(storm.wb, p, PLAYER_PAD);
  },

  adjustDash(_app: WorldApp, from, to, dirX, dirY) {
    const s = storm;
    if (!s) return;
    const str = s.strength(performance.now());
    if (str > 0.05 && !inLee(s.wb, s.wx, s.wy, from.x, from.y)) {
      const a = dirX * s.wx + dirY * s.wy;
      if (a > 0) {
        const extra = 5.5 * DASH_DOWNWIND * a * Math.min(1, str);
        // Caller wraps. Keep the end unwrapped so the rock sweep is one segment.
        to.x += dirX * extra;
        to.y += dirY * extra;
      }
    }
    if (!s.wb) return;
    const t = sweepRocks(s.wb, from.x, from.y, to.x, to.y, PLAYER_PAD);
    if (t < 1) {
      to.x = from.x + (to.x - from.x) * t;
      to.y = from.y + (to.y - from.y) * t;
    }
    pushOutOfRocks(s.wb, to, PLAYER_PAD);
  },
};

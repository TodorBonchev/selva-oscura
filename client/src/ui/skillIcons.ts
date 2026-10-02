/**
 * Etching-style skill seals. The three shipped spell plates stay as pngs.
 * Every other skill is a small canvas glyph (bone line, gold accent, soot ground),
 * drawn once and cached as a data URL.
 */

const PNG: Record<string, string> = {
  gale_bolt: "/assets/spells/spell_gale_bolt.png",
  whirl_ward: "/assets/spells/spell_whirl_ward.png",
  infernal_burst: "/assets/spells/spell_infernal_burst.png",
};

const cache = new Map<string, string>();

/** Star seal for the Skills action button (compact HUD hides the text label). */
export const SKILLS_BTN_ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <path d="M32 6 L37.5 23.5 H56 L41 34.5 L46.5 52 L32 41.5 L17.5 52 L23 34.5 L8 23.5 H26.5 Z"
        fill="none" stroke="#e6d7b0" stroke-width="2.4" stroke-linejoin="round"/>
      <circle cx="32" cy="32" r="3" fill="#c9a227"/>
    </svg>`
  );

export function skillIcon(id: string): string {
  const png = PNG[id];
  if (png) return png;
  const hit = cache.get(id);
  if (hit) return hit;
  const url = draw(id);
  cache.set(id, url);
  return url;
}

function draw(id: string): string {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return "";
  g.fillStyle = "#14110c";
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = "#e6d7b0";
  g.fillStyle = "#e6d7b0";
  g.lineWidth = 2;
  g.lineJoin = "round";
  g.lineCap = "round";
  glyph(g, id);
  return c.toDataURL("image/png");
}

function gold(g: CanvasRenderingContext2D) {
  g.strokeStyle = "#c9a227";
  g.fillStyle = "#c9a227";
}

function glyph(g: CanvasRenderingContext2D, id: string) {
  switch (id) {
    case "furious_cleave": {
      g.beginPath();
      g.arc(32, 40, 22, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
      g.beginPath();
      g.moveTo(14, 36);
      g.lineTo(32, 18);
      g.lineTo(50, 36);
      g.stroke();
      gold(g);
      g.beginPath();
      g.moveTo(22, 44);
      g.lineTo(42, 28);
      g.stroke();
      break;
    }
    case "ferocia": {
      g.beginPath();
      g.moveTo(32, 8);
      g.lineTo(40, 28);
      g.lineTo(58, 32);
      g.lineTo(40, 36);
      g.lineTo(32, 56);
      g.lineTo(24, 36);
      g.lineTo(6, 32);
      g.lineTo(24, 28);
      g.closePath();
      g.stroke();
      gold(g);
      g.fillRect(30, 22, 4, 20);
      break;
    }
    case "wrath_charge": {
      g.beginPath();
      g.moveTo(8, 40);
      g.lineTo(28, 40);
      g.lineTo(28, 32);
      g.lineTo(54, 44);
      g.lineTo(28, 56);
      g.lineTo(28, 48);
      g.lineTo(8, 48);
      g.closePath();
      g.stroke();
      gold(g);
      g.beginPath();
      g.moveTo(10, 22);
      g.lineTo(26, 22);
      g.stroke();
      break;
    }
    case "war_cry": {
      g.beginPath();
      g.arc(24, 34, 8, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(24, 34, 16, -0.8, 0.8);
      g.stroke();
      gold(g);
      g.beginPath();
      g.arc(24, 34, 24, -0.6, 0.6);
      g.stroke();
      break;
    }
    case "bloodthirst": {
      g.beginPath();
      g.moveTo(32, 12);
      g.bezierCurveTo(48, 12, 52, 28, 32, 50);
      g.bezierCurveTo(12, 28, 16, 12, 32, 12);
      g.stroke();
      gold(g);
      g.beginPath();
      g.moveTo(32, 22);
      g.lineTo(32, 40);
      g.moveTo(26, 30);
      g.lineTo(38, 30);
      g.stroke();
      break;
    }
    case "earthsplitter": {
      g.beginPath();
      g.moveTo(8, 18);
      g.lineTo(56, 46);
      g.moveTo(14, 46);
      g.lineTo(50, 22);
      g.stroke();
      gold(g);
      g.strokeRect(28, 28, 8, 8);
      break;
    }
    case "lance_of_light": {
      g.beginPath();
      g.moveTo(32, 6);
      g.lineTo(38, 28);
      g.lineTo(56, 32);
      g.lineTo(38, 36);
      g.lineTo(32, 58);
      g.lineTo(26, 36);
      g.lineTo(8, 32);
      g.lineTo(26, 28);
      g.closePath();
      g.stroke();
      gold(g);
      g.beginPath();
      g.moveTo(32, 16);
      g.lineTo(32, 48);
      g.stroke();
      break;
    }
    case "grace": {
      g.beginPath();
      g.arc(32, 28, 10, 0, Math.PI * 2);
      g.stroke();
      gold(g);
      g.beginPath();
      g.moveTo(32, 42);
      g.lineTo(32, 56);
      g.moveTo(24, 48);
      g.lineTo(40, 48);
      g.stroke();
      break;
    }
    case "pillar_of_flame": {
      g.beginPath();
      g.ellipse(32, 50, 14, 5, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(32, 46);
      g.bezierCurveTo(44, 36, 40, 18, 32, 8);
      g.bezierCurveTo(24, 18, 20, 36, 32, 46);
      g.stroke();
      gold(g);
      g.beginPath();
      g.moveTo(32, 40);
      g.lineTo(32, 18);
      g.stroke();
      break;
    }
    case "fervore": {
      g.beginPath();
      g.moveTo(18, 50);
      g.lineTo(32, 10);
      g.lineTo(46, 50);
      g.stroke();
      gold(g);
      g.beginPath();
      g.moveTo(24, 36);
      g.lineTo(40, 36);
      g.stroke();
      break;
    }
    case "halo": {
      g.beginPath();
      g.ellipse(32, 22, 16, 6, 0, 0, Math.PI * 2);
      g.stroke();
      gold(g);
      g.beginPath();
      g.arc(32, 40, 10, 0, Math.PI * 2);
      g.stroke();
      break;
    }
    case "shadow_step": {
      g.beginPath();
      g.arc(18, 40, 8, 0, Math.PI * 2);
      g.stroke();
      gold(g);
      g.beginPath();
      g.arc(46, 24, 8, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(26, 36);
      g.lineTo(38, 28);
      g.stroke();
      break;
    }
    case "snare_glyph": {
      g.strokeRect(16, 16, 32, 32);
      g.beginPath();
      g.moveTo(16, 16);
      g.lineTo(48, 48);
      g.moveTo(48, 16);
      g.lineTo(16, 48);
      g.stroke();
      gold(g);
      g.beginPath();
      g.arc(32, 32, 5, 0, Math.PI * 2);
      g.stroke();
      break;
    }
    case "summon_shade": {
      g.beginPath();
      g.moveTo(32, 10);
      g.lineTo(46, 22);
      g.lineTo(42, 50);
      g.lineTo(22, 50);
      g.lineTo(18, 22);
      g.closePath();
      g.stroke();
      gold(g);
      g.beginPath();
      g.arc(26, 28, 2, 0, Math.PI * 2);
      g.arc(38, 28, 2, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case "silenzio": {
      g.beginPath();
      g.arc(32, 32, 16, 0.4, Math.PI * 1.7);
      g.stroke();
      gold(g);
      g.beginPath();
      g.moveTo(22, 22);
      g.lineTo(44, 44);
      g.stroke();
      break;
    }
    case "tempest": {
      g.beginPath();
      g.arc(32, 32, 8, 0, Math.PI * 1.6);
      g.stroke();
      g.beginPath();
      g.arc(32, 32, 16, 0.4, Math.PI * 1.8);
      g.stroke();
      gold(g);
      g.beginPath();
      g.arc(32, 32, 24, 0.8, Math.PI * 1.5);
      g.stroke();
      break;
    }
    case "stone_skin": {
      g.strokeRect(16, 18, 32, 28);
      g.beginPath();
      g.moveTo(16, 32);
      g.lineTo(48, 32);
      g.moveTo(32, 18);
      g.lineTo(32, 46);
      g.stroke();
      gold(g);
      g.strokeRect(28, 26, 8, 8);
      break;
    }
    case "vigor": {
      g.beginPath();
      g.arc(32, 34, 16, 0, Math.PI * 2);
      g.stroke();
      gold(g);
      g.beginPath();
      g.moveTo(32, 22);
      g.lineTo(32, 46);
      g.moveTo(22, 34);
      g.lineTo(42, 34);
      g.stroke();
      break;
    }
    case "bastion": {
      g.beginPath();
      g.moveTo(32, 8);
      g.lineTo(52, 18);
      g.lineTo(48, 40);
      g.quadraticCurveTo(32, 56, 16, 40);
      g.lineTo(12, 18);
      g.closePath();
      g.stroke();
      gold(g);
      g.beginPath();
      g.moveTo(32, 20);
      g.lineTo(32, 40);
      g.stroke();
      break;
    }
    case "thorns": {
      for (const [x, y, a] of [
        [32, 14, -0.2],
        [18, 36, 0.6],
        [46, 36, 2.4],
        [32, 48, 1.2],
      ] as const) {
        g.save();
        g.translate(x, y);
        g.rotate(a);
        g.beginPath();
        g.moveTo(0, -8);
        g.lineTo(3, 6);
        g.lineTo(-3, 6);
        g.closePath();
        g.stroke();
        g.restore();
      }
      gold(g);
      g.beginPath();
      g.arc(32, 32, 4, 0, Math.PI * 2);
      g.stroke();
      break;
    }
    case "last_stand": {
      g.beginPath();
      g.moveTo(32, 8);
      g.lineTo(32, 56);
      g.moveTo(18, 20);
      g.lineTo(46, 20);
      g.stroke();
      gold(g);
      g.beginPath();
      g.arc(32, 40, 10, 0, Math.PI * 2);
      g.stroke();
      break;
    }
    default: {
      g.beginPath();
      g.arc(32, 32, 14, 0, Math.PI * 2);
      g.stroke();
      gold(g);
      g.fillRect(30, 24, 4, 16);
    }
  }
}

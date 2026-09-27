/**
 * Per-canto self-play behaviour — the bot half of server/src/cantoMech/*.
 *
 * botMech(cantoId) returns that canto's hooks ({} when none). All optional;
 * selfplay.mjs calls them:
 *   onMsg(bot, m)                    every server message, before the bot's own handling
 *   steer(bot, you, goal) → {x,y}    walking: the next waypoint toward `goal` (route
 *                                    around hazards / obstacles); return goal unchanged
 *                                    when nothing is in the way
 *   step(bot, you, now, target) → Promise<bool>
 *                                    each combat tick after the generic dodge: spend the
 *                                    tick on a canto action (take cover, use a mechanic);
 *                                    true = tick spent. Respect bot.style ("skilled" uses
 *                                    mechanics, "naive" plays like a new phone player).
 */
import lust from "./lust.mjs";
import gluttony from "./gluttony.mjs";
import avarice from "./avarice.mjs";

const MECHS = {
  inferno_05: lust,
  inferno_06: gluttony,
  inferno_07: avarice,
};

const NONE = Object.freeze({});

export function botMech(cantoId) {
  return MECHS[cantoId] || NONE;
}

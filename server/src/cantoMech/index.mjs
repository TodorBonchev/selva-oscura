/**
 * Canto mechanics — one module per combat canto (lust / gluttony / avarice / wrath), each the
 * home of that canto's signature environmental mechanic and boss pattern.
 *
 * getMech(cantoId) returns the canto's hook object ({} when it has none). Every hook
 * is optional; room.mjs calls them at these points:
 *
 *   init(room)                         world (re)spawn — after packs/bosses exist (room
 *                                      reset when it empties too). Reset mech state here.
 *   tick(room, dt)                     every server tick (~15 Hz), after player timers,
 *                                      before telegraphs resolve and mobs act.
 *   snapshotExtra(room, sess) → any    merged into that player's snapshot as `snap.mech`
 *                                      (keep it small: it rides every ~130 ms snapshot).
 *   adjustMove(room, sess, from, to, dt) → {x,y}
 *                                      a move packet: return the position to accept
 *                                      (wind drift, mud slow budget…). `from` is the
 *                                      server position, `to` the requested one, dt the
 *                                      seconds since the last move packet (real
 *                                      wall-clock time: 0 for bunched packets).
 *   moveAllowance(room, sess) → number extra u/s the room's move budget allows (a
 *                                      gust carrying a walker downwind).
 *   adjustDash(room, sess, fromX, fromY, toX, toY, dirX, dirY) → {x,y} | null
 *                                      where a dash really ends (the client mirrors it
 *                                      in CantoMech.adjustDash).
 *   afterMobs(room, dt) → bool         after every mob/boss moved this tick (settle them
 *                                      against solid props…); true = something moved.
 *   onDamage(room, target, amount, source) → amount
 *                                      every hit. target is a session (target.playerId
 *                                      set) when a player is hit, an entity otherwise;
 *                                      source: { id, kind, playerId?, spellId?, teleKind? }.
 *   onBell(room, sess, poi) → bool     a bell rung; return true when handled (skips the
 *                                      default still).
 *   onKilled(room, e)                  a mob/boss died (loot already rolled).
 *   bossTick(room, boss, dt) → bool    return true to replace the default boss AI this tick.
 *   onBossReset(room, boss)            a boss left alone knit whole (../bossMend.mjs):
 *                                      reset its fight state (phase and credit already are).
 *   mobTick(room, e, dt) → bool        return true to replace the default mob AI this tick.
 *   onInteract(room, sess, poi) → bool a POI in reach was used (E); return true when the
 *                                      mechanic owns it (it toasts / marks dirty itself).
 *   onAttack(room, sess, target, combo) → bool
 *                                      a swing at a foe, before the melee range check;
 *                                      return true to spend it on the mechanic's own
 *                                      action (the room still applies the swing cooldown).
 *   dashScale(room, sess) → number     dash distance multiplier where the dash starts
 *                                      (the client mech's dashScale must agree).
 * Entities a mechanic summons may set `summoned: true`: the road-clear line doesn't
 * count them.
 *
 * Helpers on the room for mechanics:
 *   room.telegraph(spec) → t           ground telegraph (telegraph.mjs; spec.onLand at
 *                                      the deadline, spec.onHit per player, spec.onResolve
 *                                      once all are judged — laggy players get a dodge
 *                                      grace ≤ 220 ms; attackerId "mech:<name>" or a mob id)
 *   room.cancelTelegraph(id)
 *   room.shovePlayer(sess, dx, dy, durMs)   pushes the player (server + {type:"shove"})
 *   room.statusPlayer(sess, { slow, root, durMs })   {type:"status"}; slow is a speed
 *                                      multiplier (0.6 = 40% slower); the move budget
 *                                      is enforced in handleMove
 *   room.shoveMob(e, dx, dy)           knockback-style impulse on a mob
 *   room.hitPlayer(sess, attacker, dmg, extra)   armor, iframes, death, combat message
 *   room.broadcast(msg) / room.send(ws, msg)     custom messages reach the client
 *                                      canto mech's onMessage(app, msg)
 */
import lust from "./lust.mjs";
import gluttony from "./gluttony.mjs";
import avarice from "./avarice.mjs";
import wrath from "./wrath.mjs";

const MECHS = {
  inferno_05: lust,
  inferno_06: gluttony,
  inferno_07: avarice,
  inferno_08: wrath,
};

const NONE = Object.freeze({});

export function getMech(cantoId) {
  return MECHS[cantoId] || NONE;
}

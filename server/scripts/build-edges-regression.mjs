#!/usr/bin/env node
/**
 * PvE build-edge unit checks. No server, no sockets — fake entities only.
 *
 *   cd server && node scripts/build-edges-regression.mjs
 */
import {
  FEDE_FIRE_KINDS,
  OMBRA_CD_MS,
  ombraBreakDecision,
  ombraControlLands,
  scaleIncoming,
  scaleOutgoing,
} from "../src/buildEdges.mjs";

let failures = 0;
function check(ok, label, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
}

const boss = (hp, max = 100, extra = {}) => ({ kind: "boss", hp, maxHp: max, archetype: "argenti_fury", ...extra });
const mob = (arch, hp, max = 100, extra = {}) => ({ kind: "mob", archetype: arch, hp, maxHp: max, ...extra });

check(scaleOutgoing(100, "furious_cleave", boss(29), "inferno_01") === 125, "ira execute +25% on a boss under 30%");
check(scaleOutgoing(100, "wrath_charge", boss(30), "inferno_01") === 100, "ira execute is strictly below 30%");
check(scaleOutgoing(100, "earthsplitter", mob("whirl_shade", 10, 100, { elite: true }), "inferno_05") === 125, "ira execute hits an elite");
check(scaleOutgoing(100, "furious_cleave", mob("fury_champion", 20, 100), "inferno_08") === 125, "ira execute hits a champion archetype");
check(scaleOutgoing(100, "furious_cleave", mob("whirl_shade", 10), "inferno_01") === 100, "ira execute skips fodder");
check(scaleOutgoing(100, "wrath_charge", mob("wrath_shade", 80, 100, { enraged: true }), "inferno_08") === 120, "ira +20% vs an enraged Wrath foe");
check(scaleOutgoing(100, "wrath_charge", mob("wrath_shade", 80, 100, { enraged: true }), "inferno_05") === 100, "ira enrage bonus is inferno_08 only");
check(
  scaleOutgoing(100, "earthsplitter", boss(20, 100, { enraged: true }), "inferno_08") === 125,
  "ira execute and enrage do not stack past +25%"
);
check(scaleOutgoing(100, "war_cry", boss(10), "inferno_08") === 100, "war cry is not an execute spell");
check(scaleOutgoing(100, "gale_bolt", boss(10), "inferno_08") === 100, "ombra damage is not an ira execute");

check(scaleOutgoing(100, "infernal_burst", mob("mire_shade", 80), "inferno_06") === 120, "fede +20% vs mire shade");
check(scaleOutgoing(50, "lance_of_light", mob("mud_wisp", 40), "inferno_06") === 60, "fede +20% vs mud wisp");
check(scaleOutgoing(100, "pillar_of_flame", mob("mire_champion", 90, 100, { champion: true }), "inferno_06") === 120, "fede +20% vs mire champion");
check(scaleOutgoing(100, "halo", mob("mire_warden", 100), "inferno_06") === 120, "fede +20% vs mire warden");
check(scaleOutgoing(100, "infernal_burst", mob("storm_heart", 80), "inferno_05") === 125, "fede +25% vs a ward heart");
check(scaleOutgoing(80, "lance_of_light", mob("rage_heart", 50), "inferno_08") === 100, "fede +25% vs rage heart");
check(scaleOutgoing(100, "halo", mob("hoard_heart", 40), "inferno_07") === 125, "fede +25% vs hoard heart");
check(scaleOutgoing(100, "pillar_of_flame", mob("mire_heart", 40), "inferno_06") === 125, "fede +25% vs mire heart");
check(scaleOutgoing(100, "infernal_burst", mob("whirl_shade", 40), "inferno_06") === 100, "fede does not buff a plain shade");
check(scaleOutgoing(100, "grace", mob("mire_shade", 40), "inferno_06") === 100, "grace is not a damage edge");

const now = 1_700_000_000_000;
const grace = { graceHotUntil: now + 4000 };
const halo = { haloUntil: now + 8000 };
const bare = {};
check(scaleIncoming(100, { sess: grace, teleKind: "styx_eruption", now }) === 70, "grace cuts styx eruption by 30%");
check(scaleIncoming(100, { sess: halo, teleKind: "styx_eruption", now }) === 70, "halo cuts styx eruption by 30%");
check(scaleIncoming(100, { sess: { graceHotUntil: now - 1 }, teleKind: "styx_eruption", now }) === 100, "expired grace does not resist fire");
check(scaleIncoming(100, { sess: bare, teleKind: "styx_eruption", now }) === 100, "no fede buff, full eruption");
check(scaleIncoming(100, { sess: grace, teleKind: "hail", now }) === 100, "hail is not a fire hazard");
check(scaleIncoming(100, { sess: grace, teleKind: "boss_slam", now }) === 100, "a slam is not fede fire resist");
check(FEDE_FIRE_KINDS.length === 1 && FEDE_FIRE_KINDS[0] === "styx_eruption", "fire list is only styx_eruption");

const ward = { wardUntil: 4 };
const bastion = { bastionUntil: now + 2000 };
const champAtk = { kind: "mob", champion: true, archetype: "gale_champion" };
const bossAtk = { kind: "boss", id: "argenti_fury" };
check(scaleIncoming(100, { sess: ward, attacker: bossAtk, teleKind: "boss_slam", now }) === 75, "whirl ward soaks a boss slam 25%");
check(scaleIncoming(100, { sess: bastion, attacker: champAtk, teleKind: "champ_slam", now }) === 75, "bastion soaks a champion telegraph 25%");
check(scaleIncoming(100, { sess: ward, attacker: { kind: "mech", id: "x" }, teleKind: "crush", now }) === 75, "crush kind is soaked");
check(scaleIncoming(100, { sess: ward, attacker: bossAtk, now }) === 100, "a boss hit with no telegraph is not soaked");
check(scaleIncoming(100, { sess: ward, attacker: { kind: "mob", archetype: "whirl_shade" }, teleKind: "shade_swipe", now }) === 100, "fodder swipes are not soaked");
check(scaleIncoming(100, { sess: bare, attacker: bossAtk, teleKind: "boss_slam", now }) === 100, "no guard, full slam");
check(scaleIncoming(100, { sess: { bastionUntil: now - 5, wardUntil: 0 }, attacker: bossAtk, teleKind: "boss_slam", now }) === 100, "expired bastion does not soak");
check(
  scaleIncoming(100, { sess: { ...grace, ...ward }, attacker: bossAtk, teleKind: "styx_eruption", now }) === 53,
  "grace and ward stack on a boss eruption (100 → 53)"
);

const windingChamp = () => ({
  kind: "mob",
  champion: true,
  archetype: "gale_champion",
  teleId: "t1",
  hp: 80,
  maxHp: 100,
});
const slamOpts = (spellId, t, extra = {}) => ({ spellId, now: t, teleKind: "champ_slam", ...extra });

check(ombraControlLands("snare_glyph") === true, "snare glyph is ombra control");
check(ombraControlLands("tempest") === true, "tempest is ombra control");
check(ombraControlLands("gale_bolt") === true, "gale bolt landing counts as ombra control");
check(ombraControlLands("shadow_step") === false, "shadow step applies no CC");
check(ombraControlLands("shadow_step", true) === true, "shadow step counts only when CC is flagged");
check(ombraControlLands("furious_cleave") === false, "ira is not ombra control");

const c1 = windingChamp();
const first = ombraBreakDecision(c1, slamOpts("snare_glyph", now));
check(first.cancel === true && first.at === now, "snare cancels a champion slam windup");
c1._ombraBreakAt = first.at;
const soon = ombraBreakDecision(c1, slamOpts("gale_bolt", now + OMBRA_CD_MS - 1));
check(soon.cancel === false, "ombra interrupt waits 6 s on that target");
const later = ombraBreakDecision(c1, slamOpts("tempest", now + OMBRA_CD_MS));
check(later.cancel === true && later.at === now + OMBRA_CD_MS, "ombra interrupt is ready again at 6 s");

const fodder = { kind: "mob", archetype: "whirl_shade", teleId: "t2" };
check(ombraBreakDecision(fodder, slamOpts("gale_bolt", now)).cancel === false, "ombra does not cancel fodder");

const bossSlam = { kind: "boss", teleId: "t3", hp: 400, maxHp: 500 };
check(ombraBreakDecision(bossSlam, { spellId: "gale_bolt", now, teleKind: "boss_slam" }).cancel === true, "ombra cancels a boss's simple slam");
check(
  ombraBreakDecision(bossSlam, { spellId: "tempest", now, teleKind: "minos_coil" }).cancel === false,
  "ombra does not cancel a boss phase pattern"
);
check(
  ombraBreakDecision(bossSlam, { spellId: "snare_glyph", now, teleKind: "plutus_roll" }).cancel === false,
  "ombra does not cancel a phase roll"
);
check(
  ombraBreakDecision({ ...windingChamp(), teleId: "" }, slamOpts("gale_bolt", now)).cancel === false,
  "ombra needs a live windup"
);
check(
  ombraBreakDecision(windingChamp(), { spellId: "shadow_step", now, teleKind: "champ_slam" }).cancel === false,
  "shadow step does not cancel"
);

const trap = {
  kind: "mob",
  get archetype() {
    throw new Error("boom");
  },
  get hp() {
    throw new Error("boom");
  },
};
check(scaleOutgoing(40, "infernal_burst", trap, "inferno_06") === 40, "a throwing target stays neutral on outgoing");
check(scaleIncoming(40, { sess: trap, attacker: trap, teleKind: "styx_eruption", now }) === 40, "a throwing session stays neutral on incoming");
check(ombraBreakDecision(trap, slamOpts("gale_bolt", now)).cancel === false, "a throwing entity does not cancel");
check(scaleOutgoing(0, "furious_cleave", boss(1), "inferno_01") === 0, "zero damage stays zero");
check(scaleOutgoing("nope", "halo", mob("mire_shade", 10), "inferno_06") === 0, "non-numeric damage stays zero");

if (failures) {
  console.log(`FAIL ${failures} build-edge check(s)`);
  process.exit(1);
}
console.log("PASS build edges");

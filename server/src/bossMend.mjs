/**
 * How a canto boss heals (shared by room.tickBossMend and the canto mechanics).
 *
 * A boss mends only when abandoned: no living pilgrim within BOSS_ABSENT_R of it for
 * BOSS_MEND_AFTER seconds (a walk to the entrance shrine and back, or a death and the
 * road back, costs the fight next to nothing), and then slowly — BOSS_MEND_RATE of its
 * life a second: a long detour costs a few blows' worth, a fight truly walked away from
 * is whole again in a couple of minutes (and an emptied canto resets anyway). Knit back
 * past half it re-arms its second phase (Minos's flock, the Maw's feeders, Plutus's
 * hurled weights); knit whole it resets (kill credit cleared, phase 1). A boss dragged
 * off its dais walks home keeping its wounds (blows glance off it on the way). Each
 * combat canto also keeps a second shrine short of its boss, outside BOSS_ABSENT_R, for
 * a quick mend mid-fight.
 */
export const BOSS_ABSENT_R = 20;
export const BOSS_MEND_AFTER = 25;
export const BOSS_MEND_RATE = 0.01;
/** A boss dragged this far off its dais walks home. */
export const BOSS_LEASH = 20;

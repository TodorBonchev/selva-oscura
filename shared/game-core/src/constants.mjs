export const ASH_PER_STELLE = 1000;
export const PLAY_VAULT_STELLE = 300_000_000;
export const PROTOCOL_VERSION = 1;

export const EVENT_TYPES = ["DailyQuest", "ChampionPack", "Boss", "FirstClear"];

export const STARTING_EMIT_P = {
  DailyQuest: 1e-7,
  ChampionPack: 3e-7,
  Boss: 5e-7,
  FirstClear: 2e-6,
};

export const DEFAULT_EMIT_CAPS = {
  dailyQuestPerPlayerPerDay: 1,
  firstClearOncePerCanto: true,
  bossPerPlayerHourly: 3,
  bossGlobalHourly: 500,
  maxRemainingFractionPerUtcDay: 0.0001,
};

export function ashToStelleDisplay(ash) {
  const whole = Math.trunc(ash / ASH_PER_STELLE);
  const frac = Math.abs(ash % ASH_PER_STELLE);
  return `${whole}.${String(frac).padStart(3, "0")}`;
}

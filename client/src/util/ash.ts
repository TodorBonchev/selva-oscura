/** 1 STELLE = 1000 Ash — locked; display helper only. */
export const ASH_PER_STELLE = 1000;

export function ashToStelleDisplay(ash: number): string {
  const whole = Math.trunc(ash / ASH_PER_STELLE);
  const frac = Math.abs(ash % ASH_PER_STELLE);
  return `${whole}.${String(frac).padStart(3, "0")}`;
}

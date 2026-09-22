/**
 * Map paper-doll equip slots → wanderer mesh visibility.
 * Pieces are tagged at build time via `userData.gearSlot`.
 * Named joints used by tickHumanoid stay in the graph even when hidden.
 */
import type * as THREE from "three";
import type { EquipSlot } from "../items/icons";

export const GEAR_SLOTS: readonly EquipSlot[] = [
  "Head",
  "Chest",
  "Hands",
  "Feet",
  "MainHand",
  "OffHand",
] as const;

/** Tag a mesh/group so applyEquippedLook can toggle it. */
export function tagGearSlot(obj: THREE.Object3D, slot: EquipSlot): void {
  obj.userData.gearSlot = slot;
}

function slotFilled(
  equipped: Partial<Record<string, unknown>> | null | undefined,
  slot: EquipSlot
): boolean {
  if (!equipped) return false;
  const v = equipped[slot];
  return v != null && typeof v === "object";
}

/**
 * Show/hide tagged gear based on equipped slots.
 * Empty / undefined equipped → hide all optional gear (bare underlayer).
 * Safe on any Object3D; no-op if nothing is tagged.
 */
export function applyEquippedLook(
  root: THREE.Object3D,
  equipped: Partial<Record<string, unknown>> | null | undefined
): void {
  const filled: Record<string, boolean> = {};
  for (const s of GEAR_SLOTS) filled[s] = slotFilled(equipped, s);

  root.traverse((o) => {
    const slot = o.userData?.gearSlot as string | undefined;
    if (!slot || !(slot in filled)) return;
    o.visible = filled[slot];
  });
}

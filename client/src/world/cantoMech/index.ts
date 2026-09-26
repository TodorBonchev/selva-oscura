/**
 * Client side of the canto mechanics — one module per combat canto (lust / gluttony /
 * avarice), the visual + feel half of server/src/cantoMech/*.
 *
 * mechFor(cantoId) returns the canto's hooks ({} when none). All optional; WorldApp calls:
 *   enter(app)                 after the canto's ground and scene are rebuilt (arrival)
 *   exit(app)                  before leaving it (dispose what enter() built — use
 *                              dispose.ts; mark shared resources with markShared)
 *   tick(app, dt)              every frame (dt: world seconds, hit-stop scaled)
 *   onMessage(app, msg) → bool a server message WorldApp does not handle itself
 *                              (a mechanic's custom broadcast); true when consumed
 *   onSnapshot(app, mech)      every snapshot, with the server's snapshotExtra (`room.mech`)
 *   objective(app, obj)        ~10 Hz after the shared objective model is computed —
 *                              mutate obj.text / obj.sub / obj.target to steer the
 *                              player toward this canto's own goal (objective.ts)
 *   moveFeel(app, out)         local movement feel, once per frame before prediction:
 *                              out = { speedMul, accelMul, driftX, driftY } arrives at
 *                              {1, 1, 0, 0}; multiply / add (drift is planar u/s). The
 *                              server must allow the same (its adjustMove hook).
 * Generic forces are already wired: {type:"shove"} and {type:"status"} from
 * room.shovePlayer / room.statusPlayer land in app.forces (world/forces.ts).
 * Mob attack poses for new telegraph kinds: registerAttackPose() in world/mobAnim.ts.
 * Perf rules hold here too: no per-frame allocation, pooled FX, VirtualLight markers
 * (lightPool.ts) instead of real lights, shared materials.
 */
import type { WorldApp } from "../WorldApp";
import type { Objective } from "../objective";
import { lustMech } from "./lust";
import { gluttonyMech } from "./gluttony";
import { avariceMech } from "./avarice";

export type MoveFeelOut = { speedMul: number; accelMul: number; driftX: number; driftY: number };

export interface CantoMech {
  enter?(app: WorldApp): void;
  exit?(app: WorldApp): void;
  tick?(app: WorldApp, dt: number): void;
  onMessage?(app: WorldApp, msg: any): boolean;
  onSnapshot?(app: WorldApp, mech: unknown): void;
  objective?(app: WorldApp, obj: Objective): void;
  moveFeel?(app: WorldApp, out: MoveFeelOut): void;
}

const NONE: CantoMech = Object.freeze({});

const MECHS: Record<string, CantoMech> = {
  inferno_05: lustMech,
  inferno_06: gluttonyMech,
  inferno_07: avariceMech,
};

export function mechFor(cantoId: string | null | undefined): CantoMech {
  return (cantoId && MECHS[cantoId]) || NONE;
}

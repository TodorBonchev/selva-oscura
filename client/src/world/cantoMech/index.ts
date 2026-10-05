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
 *   collide(app, p)            solid props: push the predicted planar position p out
 *                              (mutate it), after the foe push-out, every move substep.
 *   adjustDash(app, from, to, dirX, dirY)
 *                              where your dash really ends: mutate `to` (the server's
 *                              adjustDash hook does the same).
 *   objective(app, obj)        ~10 Hz after the shared objective model is computed —
 *                              mutate obj.text / obj.sub / obj.target to steer the
 *                              player toward this canto's own goal (objective.ts)
 *   moveFeel(app, out)         local movement feel, once per frame before prediction:
 *                              out = { speedMul, accelMul, driftX, driftY } arrives at
 *                              {1, 1, 0, 0}; multiply / add (drift is planar u/s). The
 *                              server must allow the same (its adjustMove hook).
 *   dashScale(app) → number    dash distance multiplier from where you stand (the
 *                              server's dashScale must agree).
 *   onAttackPress(app) → bool  an attack press (button, F, a tap or hold on a foe)
 *                              before targeting; true = the mechanic spent it (throws…).
 *   nodeMesh(app, e, kind) → Group | null
 *                              the mesh for an entity this canto owns (its own POI
 *                              kinds); null = the default builder.
 * Telegraph colours for a mechanic's own kinds: registerTelePalette() in telegraphs.ts.
 * Generic forces are already wired: {type:"shove"} and {type:"status"} from
 * room.shovePlayer / room.statusPlayer land in app.forces (world/forces.ts).
 * Mob attack poses for new telegraph kinds: registerAttackPose() in world/mobAnim.ts.
 * A mechanic's heavy telegraph kinds land like slams: registerTeleWeight() in telegraphs.ts.
 * Perf rules hold here too: no per-frame allocation, pooled FX, VirtualLight markers
 * (lightPool.ts) instead of real lights, shared materials.
 */
import type * as THREE from "three";
import type { WorldApp } from "../WorldApp";
import type { Objective } from "../objective";
import { lustMech } from "./lust";
import { gluttonyMech } from "./gluttony";
import { avariceMech } from "./avarice";
import { wrathMech } from "./wrath";

export type MoveFeelOut = { speedMul: number; accelMul: number; driftX: number; driftY: number };

export interface CantoMech {
  enter?(app: WorldApp): void;
  exit?(app: WorldApp): void;
  tick?(app: WorldApp, dt: number): void;
  onMessage?(app: WorldApp, msg: any): boolean;
  onSnapshot?(app: WorldApp, mech: unknown): void;
  collide?(app: WorldApp, p: { x: number; y: number }): void;
  adjustDash?(app: WorldApp, from: { x: number; y: number }, to: { x: number; y: number }, dirX: number, dirY: number): void;
  objective?(app: WorldApp, obj: Objective): void;
  moveFeel?(app: WorldApp, out: MoveFeelOut): void;
  dashScale?(app: WorldApp): number;
  onAttackPress?(app: WorldApp): boolean;
  nodeMesh?(app: WorldApp, e: any, kind: string): THREE.Group | null;
}

const NONE: CantoMech = Object.freeze({});

const MECHS: Record<string, CantoMech> = {
  inferno_05: lustMech,
  inferno_06: gluttonyMech,
  inferno_07: avariceMech,
  inferno_08: wrathMech,
};

export function mechFor(cantoId: string | null | undefined): CantoMech {
  return (cantoId && MECHS[cantoId]) || NONE;
}

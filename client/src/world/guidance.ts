/**
 * Wayfinding glue: the objective model (≤10 Hz) → objective line, compass,
 * minimap, world beacon; plus gate state (colour language, labels, the
 * "OPENED" moment). WorldApp calls tick() once per frame and syncGate() /
 * gateLabel() from its entity sync — everything else lives here.
 */
import * as THREE from "three";
import type { WorldApp } from "./WorldApp";
import { computeObjective, type Objective } from "./objective";
import { mechFor } from "./cantoMech";
import { cantoName, GATE_LABEL_RANGE, gateState, gateTitle, lockReason, type GateState } from "./gates";
import { makeBeaconMaterial, setPortalGateVisual, tickPortalMaterials } from "./meshes";
import { CAM_FACE_YAW, setPlanar } from "./frames";
import { wrapDelta } from "./wrap";
import { roomWraps } from "./mapSpace";
import { isCompactUi, setQuestLine } from "../ui/hud";

const OBJECTIVE_EVERY_MS = 100;
/** How long a newly opened gate says "Open" (label sub-line + compass arrow). */
const OPENED_MS = 8000;
/** A sealed gate's label is quiet while a living boss is this close to you (m). */
const GATE_BOSS_QUIET = 22;

type NodeLike = { id: string; kind: string; group: THREE.Group; hpEl: HTMLElement };

export class Guidance {
  app: WorldApp;
  objective: Objective | null = null;
  private lastObjAt = 0;
  private day = "";
  private dayAt = 0;
  private hint = "";
  /** Gate that just opened (its compass arrow reads "… · Open" until openedUntil). */
  private openedId = "";
  private openedUntil = 0;
  private beacon: THREE.Group;
  private beaconPillar: THREE.Mesh;
  private beaconRing: THREE.Mesh;

  constructor(app: WorldApp) {
    this.app = app;
    // Objective beacon for non-gate targets (heart, elite, boss, Guide, board):
    // one pillar + one ground ring, moved each frame — never re-created.
    this.beacon = new THREE.Group();
    this.beacon.name = "objectiveBeacon";
    this.beaconPillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.46, 9, 12, 1, true),
      makeBeaconMaterial(0xffd46a, 0.5)
    );
    this.beaconPillar.position.y = 4.5;
    this.beaconPillar.renderOrder = 2;
    this.beaconRing = new THREE.Mesh(
      new THREE.RingGeometry(1.05, 1.32, 36),
      new THREE.MeshBasicMaterial({
        color: 0xffd46a,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.beaconRing.rotation.x = -Math.PI / 2;
    this.beaconRing.position.y = 0.08;
    this.beacon.add(this.beaconPillar, this.beaconRing);
    this.beacon.visible = false;
    app.scene.add(this.beacon);
  }

  private today(): string {
    const now = Date.now();
    if (now - this.dayAt > 60_000) {
      this.dayAt = now;
      this.day = new Date(now).toISOString().slice(0, 10);
    }
    return this.day;
  }

  /** Once per frame from WorldApp.draw. */
  tick() {
    const app = this.app;
    const room = app.room;
    if (!room || !app.radar) return;
    const now = performance.now();
    tickPortalMaterials(app.animT);
    if (now - this.lastObjAt >= OBJECTIVE_EVERY_MS || !this.objective) {
      this.lastObjAt = now;
      this.objective = computeObjective(room, app.renderYou, this.today());
      mechFor(room.cantoId).objective?.(app, this.objective);
      const t = this.objective.target;
      // The gate just opened: the arrow says so (its label is past 30 m more often than not)
      if (t && t.id === this.openedId && now < this.openedUntil) {
        t.label = `${t.label} · Open`;
        t.open = true;
      }
      setQuestLine(this.objective.text, this.objective.sub);
      this.hint = this.captionFor(this.objective);
    }
    this.placeBeacon();
    const yu = room.you;
    app.radar.tick({
      you: app.renderYou,
      aimX: app.aimX,
      aimY: app.aimY,
      bounds: room.bounds,
      entities: room.entities,
      cantoId: room.cantoId,
      camera: app.camera,
      compact: isCompactUi(),
      firstClears: Array.isArray(yu?.firstClears) ? yu.firstClears : [],
      objective: this.objective,
      hint: this.hint,
      wrap: roomWraps(room),
      players: room.players,
      youId: yu?.id != null ? String(yu.id) : "",
      duels: room.duels,
      role: room.role,
    });
  }

  /** Minimap caption: the hold prompt at a gate, else "target · distance". */
  private captionFor(o: Objective): string {
    const app = this.app;
    const ph = app.portalHold;
    if (ph) return `Entering ${app.portalDestName(ph.target)}`;
    const portal = app.portalForUse();
    if (portal && !app.portalIsLocked(portal)) {
      const dest = app.portalDestName(portal);
      return isCompactUi() ? `Hold Use — ${dest}` : `Hold E — ${dest}`;
    }
    const t = o.target;
    if (!t) return "";
    const b = app.room?.bounds;
    let dx = t.x - app.renderYou.x;
    let dy = t.y - app.renderYou.y;
    if (roomWraps(app.room) && b && b.width > 0 && b.height > 0) {
      dx = wrapDelta(dx, b.width);
      dy = wrapDelta(dy, b.height);
    }
    const d = Math.round(Math.hypot(dx, dy));
    return `${t.label} · ${d}m`;
  }

  private placeBeacon() {
    const app = this.app;
    const t = this.objective?.target;
    if (!t || t.kind === "gate") {
      if (this.beacon.visible) this.beacon.visible = false;
      return;
    }
    const pos = app.entityRenderPos(t.entity);
    const d = Math.hypot(pos.x - app.renderYou.x, pos.y - app.renderYou.y);
    // Close by, the target's own label and ring say enough
    const show = d > 7;
    if (this.beacon.visible !== show) this.beacon.visible = show;
    if (!show) return;
    setPlanar(this.beacon.position, pos.x, pos.y, app.standY(pos.x, pos.y));
    const pulse = 0.5 + 0.5 * Math.sin(app.animT * 0.004);
    this.beaconRing.scale.setScalar(1 + pulse * 0.12);
    // Taller pillar over bosses so it clears the model; wider with distance so a
    // far target still reads as more than a hairline
    const tall = t.entity?.kind === "boss" ? 1.35 : 1;
    const wide = Math.min(3, Math.max(1, d / 22));
    if (Math.abs(this.beaconPillar.scale.x - wide) > 0.05 || this.beaconPillar.scale.y !== tall) {
      this.beaconPillar.scale.set(wide, tall, wide);
      this.beaconPillar.position.y = 4.5 * tall;
    }
  }

  // ——— Gates ———

  stateOf(e: any): GateState {
    const room = this.app.room;
    return gateState(e, room?.cantoId, room?.you?.firstClears);
  }

  /** New gate mesh: face the camera, dress for its state, add the label sub-line. */
  setupGate(group: THREE.Group, wrap: HTMLElement, e: any) {
    group.rotation.y = CAM_FACE_YAW;
    const st = this.stateOf(e);
    if (this.app.mats) setPortalGateVisual(group, st, this.app.mats);
    wrap.classList.add("portal-label", `gate-${st}`);
    if (group.userData.gateKind === "arena") wrap.classList.add("gate-arena");
    const name = wrap.querySelector(".wl-name");
    if (name && !wrap.querySelector(".wl-sub")) {
      const sub = document.createElement("div");
      sub.className = "wl-sub";
      name.after(sub);
    }
  }

  /** Per-frame gate sync (cheap: state swaps are no-ops unless the state changed). */
  syncGate(rec: NodeLike, e: any) {
    const app = this.app;
    if (!app.mats) return;
    const prev = rec.group.userData.portalState as GateState | undefined;
    const st = this.stateOf(e);
    const arena = rec.group.userData.gateKind === "arena";
    const vis = arena ? "arena" : st;
    if (prev === st && rec.group.userData.portalVis === vis) {
      this.fitBeacon(rec);
      return;
    }
    setPortalGateVisual(rec.group, st, app.mats);
    const el = rec.hpEl;
    el.classList.remove("gate-forward", "gate-return", "gate-locked");
    el.classList.add(`gate-${st}`);
    el.classList.toggle("portal-locked", st === "locked");
    if (prev === "locked" && st !== "locked") this.gateOpened(rec, e);
  }

  /** The "OPENED" moment: burst at the gate, flare the pillar, flash the label. */
  private gateOpened(rec: NodeLike, e: any) {
    const app = this.app;
    rec.group.userData.openedAt = app.animT;
    this.openedId = String(e.id);
    this.openedUntil = performance.now() + OPENED_MS;
    // (gateLabel keeps the "gate-opened" flash on the same clock as the arrow)
    rec.hpEl.classList.add("gate-opened");
    const x = rec.group.position.x;
    const z = rec.group.position.z;
    const y = rec.group.position.y + 0.12;
    const segs = isCompactUi() ? 36 : 56;
    for (const [inner, outer, dur, from, to, delay] of [
      [0.9, 1.2, 1300, 1.2, 7.5, 0],
      [0.95, 1.1, 1700, 0.8, 11, 180],
    ] as const) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, segs),
        new THREE.MeshBasicMaterial({
          color: 0xffd46a,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          forceSinglePass: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, y, z);
      app.scene.add(ring);
      app.impacts.push({ mesh: ring, start: app.animT + delay, dur, from, to });
    }
    const d = Math.hypot(e.x - app.renderYou.x, e.y - app.renderYou.y);
    if (d < 40) app.camPunch = Math.max(app.camPunch, 0.9);
    // The scene's gate light follows the newly opened road
    app.placePortalLight();
    // Point the objective at the gate right away (don't wait for the 10 Hz tick)
    this.objective = null;
  }

  /**
   * Pillar width: slim when you stand at the gate (it would fill the screen),
   * full from afar; blooms wide for a moment when the gate opens.
   */
  private fitBeacon(rec: NodeLike) {
    const ud = rec.group.userData;
    let beacon = ud.beaconMesh as THREE.Object3D | undefined;
    if (beacon === undefined) {
      beacon = rec.group.getObjectByName("gateBeacon");
      ud.beaconMesh = beacon ?? null;
    }
    if (!beacon || rec.group.userData.portalState === "locked") return;
    const app = this.app;
    const d = Math.hypot(rec.group.position.x - app.renderYou.x, rec.group.position.z - app.renderYou.y);
    // Standing at the gate the pillar is all screen and no news: drop it (fill cost on phones)
    const show = d > 9 || ud.openedAt != null;
    if (beacon.visible !== show) beacon.visible = show;
    if (!show) return;
    let w = Number(beacon.userData.baseW ?? 1) * Math.min(1, Math.max(0.35, (d - 6) / 18));
    const at = ud.openedAt as number | undefined;
    if (at != null) {
      const u = (app.animT - at) / 1800;
      if (u >= 1) delete ud.openedAt;
      else w *= 1 + 2.2 * (1 - u) * (1 - u);
    }
    if (Math.abs(beacon.scale.x - w) > 0.01) {
      beacon.scale.x = w;
      beacon.scale.z = w;
    }
  }

  /**
   * Gate label: always "<Canto> gate" + distance (or the seal reason) up to
   * GATE_LABEL_RANGE on every screen size. DOM written only on change.
   */
  gateLabel(rec: NodeLike & { label: { visible: boolean } }, e: any, d: number) {
    const el = rec.hpEl;
    const nearest = this.app.nearestInteract?.id === rec.id;
    const opened = this.openedId === rec.id && performance.now() < this.openedUntil;
    if (el.classList.contains("gate-opened") !== opened) el.classList.toggle("gate-opened", opened);
    const st = (rec.group.userData.portalState as GateState | undefined) ?? this.stateOf(e);
    // The label stands down when the gold arrow already says the same (the gate is up
    // under the HUD / minimap: a clipped duplicate — the arrow reads "· Open" too). The
    // "Open" flash otherwise shows at any distance: that moment is the news. A sealed
    // gate says nothing while the
    // boss that holds it fights you (his plate and the objective line carry it — in the
    // Minos arena the callout, both plates and the prompt piled into one band)
    const hide =
      this.app.radar?.objArrowFor === rec.id ||
      (!opened && ((d > GATE_LABEL_RANGE && !nearest) || (st === "locked" && this.bossNear(GATE_BOSS_QUIET))));
    if (hide) {
      if (rec.label.visible) rec.label.visible = false;
      if (el.style.opacity !== "0") el.style.opacity = "0";
      return;
    }
    if (!rec.label.visible) rec.label.visible = true;
    if (el.style.opacity !== "1") el.style.opacity = "1";
    const nameEl = el.querySelector(".wl-name") as HTMLElement | null;
    const subEl = el.querySelector(".wl-sub") as HTMLElement | null;
    const name = e?.toCanto ? gateTitle(e) : String(e?.label || e?.name || "Gate");
    if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;
    let sub: string;
    if (opened) sub = "Open";
    else if (st === "locked") sub = `${lockReason(e)} · ${Math.round(d)}m`;
    else sub = `${Math.round(d)}m`;
    if (subEl && subEl.textContent !== sub) subEl.textContent = sub;
  }

  /** A living boss within r of the hero (cached per frame-ish: 10 Hz is plenty). */
  private bossNear(r: number): boolean {
    const now = performance.now();
    if (now - this.bossNearAt < 100) return this.bossNearV;
    this.bossNearAt = now;
    this.bossNearV = false;
    const room = this.app.room;
    const you = this.app.renderYou;
    if (!room) return false;
    for (const e of room.entities) {
      if (e.kind !== "boss" || !(e.hp == null || e.hp > 0)) continue;
      if (Math.hypot(e.x - you.x, e.y - you.y) < r) {
        this.bossNearV = true;
        break;
      }
    }
    return this.bossNearV;
  }
  private bossNearAt = -1e9;
  private bossNearV = false;

  /** Short arrival goal for the canto title card. */
  arrivalGoal(cantoId: string, you: any): string {
    const clears: string[] = Array.isArray(you?.firstClears) ? you.firstClears : [];
    if (cantoId === "inferno_05") {
      return clears.includes("inferno_05")
        ? "The Gluttony gate stands open past Minos's dais"
        : "Break the Storm Heart, then Minos at the gate";
    }
    if (cantoId === "inferno_06") {
      return clears.includes("inferno_06")
        ? "The Avarice gate stands open past the Maw"
        : "Clear the mire, then the Triple Maw";
    }
    if (cantoId === "inferno_07") {
      return clears.includes("inferno_07")
        ? "The Wrath gate and the Dark Wood road stand open past the dais"
        : "Cross between the weights' clashes, then break Plutus";
    }
    if (cantoId === "inferno_08") {
      return clears.includes("inferno_08")
        ? "The Dark Wood road stands open past Argenti's landing"
        : "Ford the Styx, break the Rage Heart, then Filippo Argenti";
    }
    if (cantoId === "inferno_31") return "The pit is open — strike, or queue a ranked duel";
    if (cantoId === "inferno_01") {
      if (!you?.spokeToGuide) return "Speak with the Guide, then take the gold gate to Lust";
      if (clears.includes("inferno_08")) return "Wrath is clear — writ, stash, or hunt the circles again";
      if (clears.includes("inferno_07")) return "Avarice is clear — the Styx waits beyond Plutus's dais";
      if (clears.includes("inferno_06")) return "Gluttony is clear — bank your drops, then on to Avarice";
      if (clears.includes("inferno_05")) return "Lust is clear — bank your drops, then on to Gluttony";
      return "No foes here — the gold gate leads to Lust";
    }
    return cantoName(cantoId);
  }
}

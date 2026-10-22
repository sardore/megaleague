import { bossRedUnits } from '../features/boss-raid.js';
import { cardHasCapability } from "../engine/entities.js";
import { policySlots } from "../engine/policies.js";
import { timeCurrentSuppressionDomain } from "../features/timeora.js";
import { systems } from "../runtime/systems.js";
export function initializePresentationClockSaturation() {
  TIME_CLOCK_VISUAL_SATURATION_VERSION = "time-clock-visual-saturation-hold-r1";
  timeClockVisualSaturation = new TimeClockVisualSaturationController();
  systems.timeClockVisualSaturation = timeClockVisualSaturation;
  policySlots.render10 = {
    transform(currentResult) {
      const result = currentResult;
      /* 기존 render가 특성 정지 클래스를 지워도 연출 잠금은 다시 적용한다. */
      timeClockVisualSaturation.sync();
      return result;
    }
  };
}
let TIME_CLOCK_VISUAL_SATURATION_VERSION;
class TimeClockVisualSaturationLease {
  constructor(controller, id) {
    this.controller = controller;
    this.id = id;
    this.released = false;
  }
  release() {
    if (this.released) return;
    this.released = true;
    this.controller.release(this.id);
  }
}
class TimeClockVisualSaturationController {
  constructor() {
    this.sequence = 0;
    this.leases = new Map();
  }
  fieldUnits(g) {
    if (!g) return [];
    return ["P", "A"].flatMap(team => (g.teams?.[team]?.field || []).filter(Boolean));
  }
  isBossSharedClock(g, clock) {
    if (!g?.bossRaid || !clock) return false;
    return !!clock.bossShared || clock.uid === "boss-shared-clock" || clock.team === "A";
  }
  ownerUidsForClock(g, clock) {
    const owners = new Set();
    if (!clock) return owners;
    if (this.isBossSharedClock(g, clock)) {
      const redUnits = typeof bossRedUnits === "function" ? bossRedUnits(g) : (g.teams?.A?.field || []).filter(u => u && !u.dead && cardHasCapability(u, "timeControl"));
      for (const unit of redUnits) if (unit?.uid != null) owners.add(String(unit.uid));
      return owners;
    }
    if (clock.uid != null) owners.add(String(clock.uid));
    return owners;
  }
  resolveSuppressedUids(g, clockEvents) {
    const clocks = (clockEvents || []).flatMap(event => event?.clocks || []).filter(clock => clock && !clock.blocked && clock.aligned);
    const liveDomain = typeof timeCurrentSuppressionDomain === "function" ? timeCurrentSuppressionDomain(g) : null;
    if ((g?.order || g?.bossRaid) && liveDomain?.suppressedUids?.size) return new Set(liveDomain.suppressedUids);
    if (!clocks.length) return new Set();
    const alignedTeams = new Set(clocks.filter(clock => !this.isBossSharedClock(g, clock)).map(clock => clock.team).filter(Boolean));
    if (alignedTeams.has("P") && alignedTeams.has("A")) return new Set();
    const suppressTeams = new Set();
    for (const clock of clocks) {
      if (this.isBossSharedClock(g, clock)) suppressTeams.add("P");else if (clock.team === "P") suppressTeams.add("A");else if (clock.team === "A") suppressTeams.add("P");
    }
    const suppressed = new Set();
    for (const team of suppressTeams) for (const unit of g?.teams?.[team]?.field || []) if (unit?.uid != null && !unit.dead) suppressed.add(String(unit.uid));
    return suppressed;
  }
  acquire(g, clockEvents) {
    const suppressedUids = this.resolveSuppressedUids(g, clockEvents);
    if (!suppressedUids.size) return new TimeClockVisualSaturationLease(this, null);
    const id = `${TIME_CLOCK_VISUAL_SATURATION_VERSION}:${++this.sequence}`;
    this.leases.set(id, suppressedUids);
    this.sync();
    return new TimeClockVisualSaturationLease(this, id);
  }
  release(id) {
    if (id != null) this.leases.delete(id);
    this.sync();
  }
  activeSuppressedUids() {
    const result = new Set();
    for (const uids of this.leases.values()) for (const uid of uids) result.add(String(uid));
    return result;
  }
  sync() {
    const active = this.activeSuppressedUids();
    document.querySelectorAll('.arena .battle-unit-card[data-zone="field"], .arena .summon-card').forEach(element => {
      const uid = element.dataset.uid || element.dataset.entityId;
      element.classList.toggle("clock-visual-saturation-held", uid != null && active.has(String(uid)));
    });
    document.body.classList.toggle("time-clock-visual-saturation-active", this.leases.size > 0);
  }
  reset() {
    this.leases.clear();
    this.sync();
  }
}
let timeClockVisualSaturation;

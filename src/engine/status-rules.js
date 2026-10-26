import { card } from './entities.js';

export function isZombie(unit) {
  return !!unit && (!!unit.zombified || !!card(unit).tags?.includes('zombie'));
}
export function undeadPreventsDeath(unit) {
  return isZombie(unit) && Number(unit.statuses?.undead || 0) > 0;
}
export function healingBecomesDamage(unit) {
  return !isZombie(unit) && Number(unit?.statuses?.undead || 0) > 0;
}
export function healingCapacity(unit) {
  if (!unit || unit.dead || unit.statuses?.healSeal > 0) return 0;
  return healingBecomesDamage(unit) ? Infinity : Math.max(0, unit.maxHp - unit.hp);
}
export function statusTicksThisTurn(g, unit, id) {
  // Undead grants complete future turns, including when applied during an action.
  return id !== 'undead' || unit.statusAppliedTurnSerial?.[id] !== g.turnSerial;
}

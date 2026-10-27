import { card, state_engine_entities } from './entities.js';

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
export function fillFreezeActive(unit, id = 'freeze') {
  return id === 'freeze' && !!unit?.fillFreeze && Number(unit.statuses?.freeze || 0) > 0;
}
export function statusTicksThisTurn(g, unit, id) {
  // Energy-bound freeze does not count down; it ends when the unit's energy is full.
  if (fillFreezeActive(unit, id)) return false;
  // Undead grants complete future turns, including when applied during an action.
  return id !== 'undead' || unit.statusAppliedTurnSerial?.[id] !== g.turnSerial;
}
export function statusLabel(unit, id, value = unit?.statuses?.[id]) {
  const name = state_engine_entities.STATUS[id] || id;
  return fillFreezeActive(unit, id) ? `${name} : 에너지를 다 채우기까지` : `${name} ${value}턴`;
}

import { state_catalog_cards } from '../catalog/cards.js';
import { addHpProtectionBarrier, clearAttackDecreases, setAttack, totalAttackDecrease } from '../engine/effects.js';
import { applyHpZeroEffect, applyStatus, dealDamage, findUnit, heal, queueVisual, traitsActive } from '../engine/combat.js';
import { card, cardHasCapability } from '../engine/entities.js';
import { log } from '../presentation/audio.js';
import { state_ui_cards } from '../ui/cards.js';
import { registerCardDefinition } from '../ui/deck.js';

export function initializeFeaturesWeller() {
  const { C, S } = state_catalog_cards;
  registerCardDefinition(C('weller', '웰러', 160, '불사·저주 탱커', '메가리그',
    '점액막: HP 보호막을 보유하면 받는 피해 50% 감소. 상대 단일 대상 기술을 자신에게 집중시키고 기술 사용·후퇴 불가. 그레이브업: HP 0에서 사망 판정 전에 언데드 4턴과 HP 보호막 160을 얻는다. 다음 자기 차례 시작마다 보호막 40 감소·HP 40 회복, 총 4회. 발동 후 그레이브업 제거.', [
      S('suppressedCurse', '억누른저주', 'RorB*', '대상 공격력 -10, 자신에게 매 자기 차례 시작 20씩 감소하는 HP 보호막 60. 다음 자기 차례 1·2턴째에 같은 대상 공격력 각각 -10. 3턴째에 대상의 전체 공격력 감소량×4D를 주고 공격력 감소를 전부 제거한다.', 'enemy', [{ type: 'suppressedCurse' }], ['damage', 'debuff', 'delayed'], { vfxTheme: 'suppressedCurse' }),
      S('graveDown', '그레이브다운', '****', '대상의 현재 HP가 자신의 현재 HP보다 낮으면 대상 HP를 즉시 0으로 만든다. 조건 미충족 시 실패한다.', 'enemy', [{ type: 'graveDown' }], ['damage', 'execute'], { vfxTheme: 'graveDown' })
    ], { grade: '4☆', tags: ['zombie'], releaseOrder: 55,
      hpBarrierStance: { receivedDamageMultiplier: 0.5, tauntSingleTarget: true, blockSkill: true, blockRetreat: true }, graveUp: true,
      traitRules: [
        { description: '점액막: HP 보호막 보유 중 받는 피해 50% 감소·상대 단일 대상 기술 유도·기술 사용 및 후퇴 불가.' },
        { consumedField: 'graveUpConsumed', description: '그레이브업: HP 0에서 언데드 4턴과 HP 보호막 160. 다음 자기 차례 시작마다 보호막 40 감소·HP 40 회복, 총 4회. 발동 후 제거.' }
      ] }));
  state_ui_cards.CARD_EMOJI_MAP.weller = ['🧟', '🪦'];
}

export function triggerGraveUp(g, unit) {
  if (!unit || unit.dead || unit.hp > 0 || unit.graveUpConsumed || !cardHasCapability(unit, 'graveUp') || !traitsActive(unit, g)) return false;
  unit.graveUpConsumed = true;
  unit.graveUpRecovery = { remaining: 4, amount: 40 };
  unit.hp = 0;
  // The trait grants its declared 160 even if an HP-zero effect left another layer intact.
  addHpProtectionBarrier(g, unit, 160, unit.uid, 'graveUp', { decayPerTurn: 40, cap: Infinity });
  applyStatus(g, unit, 'undead', 4, unit);
  log(g, `${unit.name} 특성 · 그레이브업: 언데드 4턴·HP 보호막 160. 그레이브업 제거.`, 'turn');
  queueVisual(g, { type: 'wellerFx', phase: 'graveUp', uid: unit.uid, targetUid: unit.uid });
  return true;
}

export function applyWellerEffect(g, actor, target, effect, skill, ctx = {}) {
  if (effect.type === 'suppressedCurse') {
    setAttack(g, target, -10);
    addHpProtectionBarrier(g, actor, 60, actor.uid, 'suppressedCurse', { decayPerTurn: 20 });
    actor.delayedCurses ||= [];
    actor.delayedCurses.push({ targetUid: target.uid, elapsed: 0, skillId: skill.id });
    queueVisual(g, { type: 'wellerFx', phase: 'curse', uid: actor.uid, targetUid: target.uid, stage: 0 });
    return 0;
  }
  const succeeds = Number(target.hp) < Number(actor.hp);
  queueVisual(g, { type: 'wellerFx', phase: 'graveDown', uid: actor.uid, targetUid: target.uid, succeeds });
  if (!succeeds) {
    log(g, `${actor.name}: 그레이브다운 실패 · 대상 HP ${target.hp} ≥ 자신의 HP ${actor.hp}.`);
    return 0;
  }
  const old = Math.max(0, Number(target.hp));
  log(g, `${actor.name}: 그레이브다운 · ${target.name} HP ${old} → 0.`, 'damage');
  return applyHpZeroEffect(g, actor, target, skill, !!ctx.sim);
}

export function processWellerTurnStart(g, unit, sim = false) {
  const recovery = unit.graveUpRecovery;
  if (recovery?.remaining > 0) {
    recovery.remaining--;
    heal(g, unit, recovery.amount, unit, { reason: 'grave-up', effectId: 'graveUp', sim });
    queueVisual(g, { type: 'wellerFx', phase: 'recovery', uid: unit.uid, targetUid: unit.uid, remaining: recovery.remaining });
    if (!recovery.remaining) unit.graveUpRecovery = null;
  }
  for (const curse of unit.delayedCurses || []) {
    const target = findUnit(g, curse.targetUid);
    if (!target || target.dead) { curse.elapsed = 3; continue; }
    curse.elapsed++;
    if (curse.elapsed < 3) {
      setAttack(g, target, -10);
      queueVisual(g, { type: 'wellerFx', phase: 'curse', uid: unit.uid, targetUid: target.uid, stage: curse.elapsed });
    } else {
      const amount = totalAttackDecrease(target) * 4;
      const skill = card(unit).skills.find(s => s.id === curse.skillId) || { id: curse.skillId, name: '억누른저주', tags: ['damage'] };
      queueVisual(g, { type: 'wellerFx', phase: 'curseBurst', uid: unit.uid, targetUid: target.uid, rawAmount: amount });
      dealDamage(g, unit, target, { amount }, skill, sim);
      clearAttackDecreases(g, target);
    }
  }
  if (unit.delayedCurses) unit.delayedCurses = unit.delayedCurses.filter(c => c.elapsed < 3);
}

import { onRaidUnitDefeated } from "../features/boss-raid.js";
import { triggerGraveUp } from "../features/weller.js";
import { fillFreezeActive, healingBecomesDamage, isZombie, statusLabel, undeadPreventsDeath } from './status-rules.js';

// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_engine_combat = {
  CRITICAL_DAMAGE_MULTIPLIER: undefined,
  CompositeDamagePresentationOwner: undefined,
  DamageBatchOwner: undefined
};
import { state_runtime_entities } from "../runtime/entities.js";
import { other, state_engine_actions } from "./actions.js";
import { allEnergy, energyStores, gainTraitEnergyNow, normalizeEnergy, notifyReactiveEnergyMutation, requestTraitEnergy, setEnergyBatch, status, totalEnergy } from "./energy.js";
import { actionFaultHit, card, cardCapability, cardHasCapability, firstSkillByTag, skillDefHasEffect, skillDefHasRuntimeKind, state_engine_entities } from "./entities.js";
import { checkWinner } from "./execution.js";
import { elixianHealAmount, syncAromaCombatFlags } from "../features/elixian.js";
import { reactiveEnergyRule, syncReactiveEnergyMaxHp } from "../features/genocider.js";
import { circuitBlocksExternal, fragmentDefense } from "../features/summons.js";
import { state_features_timeora } from "../features/timeora.js";
import { log, queueCombatNotice } from "../presentation/audio.js";
import { state_presentation_coordinates } from "../presentation/coordinates.js";
import { systems } from "../runtime/systems.js";
import { combatInt, energyAmountText, state_ui_battle_state } from "../ui/battle-state.js";
/* 실드멜트(실드를 부수고 남은 피해를 HP에 넣는 효과)는 shieldMeltImmune 특성을 가진 대상에게는 통하지 않아 초과 피해가 소멸한다. */
export function shieldMeltApplies(effect, unit) {
  return !!effect?.shieldMelt && !(cardHasCapability(unit, "shieldMeltImmune") && traitsActive(unit));
}
export function traitsActive(u, g = state_engine_actions.timeTraitGame || state_ui_battle_state.game) {
  if (status(u, "traitSeal")) return false;
  if (!state_engine_actions.timeFeatureReady) return true;
  return !state_features_timeora.timeClockTraitSuppression.suppresses(g, u);
}
export function isStatusImmune(u, s) {
  let c = card(u);
  return traitsActive(u) && (c[`${s}Immune`] || c.immunities?.includes(s));
}
export function activeIruma(g, t) {
  return g.teams[t]?.field.find(u => u && !u.dead && cardHasCapability(u, "irumaCleanse") && traitsActive(u)) || null;
}
export function applyStatus(g, u, s, d, source = null, presentationMeta = null, options = {}) {
  actionFaultHit("status-before");
  let c = card(u);
  if (s === "freeze" && cardHasCapability(u, "freezeAbsorb") && traitsActive(u)) {
    const healAmount = Number(cardCapability(u, "freezeAbsorbHeal", 0)),
      energyGain = cardCapability(u, "freezeAbsorbEnergy", null),
      gained = [];
    if (healAmount > 0) {
      const freezeAbsorbOldHp = Number(u.hp || 0);
      u.hp += healAmount;
      state_engine_entities.GenericBattleStatisticsOwner.recordHealing(g, {
        source: u,
        target: u,
        requestedAmount: healAmount,
        actualAppliedAmount: Math.max(0, Math.min(u.maxHp, u.hp) - Math.min(u.maxHp, freezeAbsorbOldHp)),
        reason: "freeze-absorb",
        effectId: "freeze-absorb"
      });
      log(g, `${u.name} 특성 · 냉동 흡수: 냉동 무효, HP +${healAmount} (${u.hp}/${u.maxHp}).`, "heal");
      queueVisual(g, u, "heal", healAmount);
    }
    if (energyGain) {
      for (let i = 0; i < Number(energyGain.amount || 0); i++) if (gainTraitEnergyNow(g, u, energyGain.color, 1, "냉동 흡수")) gained.push(energyGain.color);
      log(g, `${u.name} 특성 · 냉동 흡수: 냉동 무효, ${gained.join("") || "에너지"} 획득.`);
    }
    queueCombatNotice(g, u, "냉동 무효", "immune");
    return false;
  }
  if (u.scheduledAction?.kind === "bloom") {
    log(g, `${u.name}: 피어나는생명 대기 효과로 ${state_engine_entities.STATUS[s]} 무효.`);
    queueCombatNotice(g, u, `${state_engine_entities.STATUS[s]} 무효`, "immune");
    return false;
  }
  if (isStatusImmune(u, s)) {
    log(g, `${u.name}: 특성으로 ${state_engine_entities.STATUS[s]} 면역.`);
    queueCombatNotice(g, u, `${state_engine_entities.STATUS[s]} 면역`, "immune");
    return false;
  }
  u.statuses[s] = Math.max(status(u, s), d);
  if (s === "freeze") u.fillFreeze = !!options.untilEnergyFull;
  u.statusAppliedTurnSerial ||= {};
  u.statusAppliedTurnSerial[s] = g.turnSerial;
  log(g, `${u.name}에게 ${statusLabel(u, s, d)}.`);
  queueCombatNotice(g, u, statusLabel(u, s, d), "status", presentationMeta);
  if (source) source.statusScore += d;
  let t = teamOf(g, u),
    ir = t && activeIruma(g, t);
  if (ir && traitsActive(ir)) {
    delete u.statuses[s];
    delete u.statusAppliedTurnSerial[s];
    log(g, `${ir.name} 특성 · 즉시 상태이상 치료: ${u.name}의 ${state_engine_entities.STATUS[s]} 제거.`);
    queueCombatNotice(g, u, `${state_engine_entities.STATUS[s]} 치료`, "cure");
    heal(g, u, 20, ir, {
      reason: "iruma-cleanse",
      effectId: "instant-cleanse"
    });
    triggerForcedCleansePenalty(g, u, t, source);
  }
  actionFaultHit("status-after");
  if (s === "traitSeal" && typeof reactiveEnergyRule === "function" && reactiveEnergyRule(u)) syncReactiveEnergyMaxHp(g, u, "특성봉인", true);
  if (s === 'undead' && status(u, s) && isZombie(u)) queueVisual(g, { type: 'wellerFx', phase: 'undeadApply', uid: u.uid, targetUid: u.uid });
  return true;
}
/* 에너지 기반 냉동은 턴 수로 줄지 않고, 걸린 개체의 차례가 끝날 때 에너지가 가득 차 있으면 풀린다. 남은 값은 채워야 할 에너지 수로 맞춘다. */
export function settleFillFreeze(g, u) {
  if (!fillFreezeActive(u)) return false;
  const missing = (card(u).maxEnergy || 4) - totalEnergy(u);
  if (missing <= 0.001) {
    delete u.statuses.freeze;
    u.fillFreeze = false;
    if (u.statusAppliedTurnSerial) delete u.statusAppliedTurnSerial.freeze;
    log(g, `${u.name}: 에너지가 가득 차 냉동 종료.`);
    queueCombatNotice(g, u, `${state_engine_entities.STATUS.freeze} 종료`, "cure");
    return true;
  }
  u.statuses.freeze = Math.max(1, Math.ceil(missing - 0.001));
  return false;
}
export function triggerForcedCleansePenalty(g, target, targetTeam, source = null) {
  let enemy = other(targetTeam),
    stamp = source ? `${source.uid}:${source.skillUses}:${g.stats.turns}` : null;
  if (stamp && target.lastCleansePenaltyStamp === stamp) return;
  if (activeSweetna(g, enemy)) {
    if (stamp) target.lastCleansePenaltyStamp = stamp;
    let lost = clearAllEnergy(target);
    log(g, `스위트나 특성 발동: ${target.name}의 에너지 전부 제거(${lost}).`);
    let sweet = g.teams[enemy].field.find(u => u && !u.dead && cardHasCapability(u, "sweetna"));
    if (sweet) sweet.energyDisrupt += lost;
  }
}
export function teamOf(g, u) {
  for (const t of ["P", "A"]) if ([...g.teams[t].field, ...g.teams[t].bench, ...g.teams[t].graveyard, ...(g.teams[t].summons || [])].some(x => x?.uid === u?.uid)) return t;
  return null;
}
export function activeSweetna(g, t) {
  return g.teams[t]?.field.some(u => u && !u.dead && cardHasCapability(u, "sweetna") && traitsActive(u, g));
}
export function hasTrait(u, prop) {
  return traitsActive(u) && !!card(u)[prop];
}
export function initializeEngineCombat() {
  state_engine_combat.CRITICAL_DAMAGE_MULTIPLIER = 1.5;
  state_engine_combat.CompositeDamagePresentationOwner = (() => {
    const begin = (g, identity = {}) => {
      if (!g) return null;
      const id = String(identity.id || `${g.battleId || g.matchId || "battle"}:${g.turnSerial || 0}:composite`);
      const group = {
        id,
        skillId: identity.skillId || null,
        sourceInstanceId: identity.sourceInstanceId || null,
        totals: new Map(),
        events: []
      };
      g.compositeDamagePresentation = group;
      return group;
    };
    const record = (g, target, amount, eventId = null, detail = {}) => {
      const group = g?.compositeDamagePresentation;
      if (!group || !target) return false;
      const uid = String(target.uid || target.entityId || "unknown"),
        actual = Math.max(0, Number(amount) || 0);
      group.totals.set(uid, Number(group.totals.get(uid) || 0) + actual);
      group.events.push({
        uid,
        eventId,
        actual,
        ...detail
      });
      return true;
    };
    const end = g => {
      const group = g?.compositeDamagePresentation || null;
      if (g) g.compositeDamagePresentation = null;
      if (!group) return null;
      return Object.freeze({
        id: group.id,
        skillId: group.skillId,
        sourceInstanceId: group.sourceInstanceId,
        totals: Object.freeze(Object.fromEntries(group.totals)),
        events: Object.freeze(group.events.map(event => Object.freeze({
          ...event
        })))
      });
    };
    const active = g => g?.compositeDamagePresentation || null;
    return Object.freeze({
      begin,
      record,
      end,
      active
    });
  })();
  state_engine_combat.DamageBatchOwner = (() => {
    const begin = (g, source = "action") => {
      const snapshot = {
        source,
        horizonGuard: {
          P: !!g?.teams?.P?.field?.some(u => u && !u.dead && Number(cardCapability(u, "teamDamageGuardAtFullHp", 0)) > 0 && Number(u.hp) >= Number(u.maxHp) && traitsActive(u, g)),
          A: !!g?.teams?.A?.field?.some(u => u && !u.dead && Number(cardCapability(u, "teamDamageGuardAtFullHp", 0)) > 0 && Number(u.hp) >= Number(u.maxHp) && traitsActive(u, g))
        }
      };
      g.damageBatchContext = snapshot;
      return snapshot;
    };
    const end = g => {
      if (g) g.damageBatchContext = null;
    };
    const finalReceived = (g, target, amount) => {
      const team = teamOf(g, target);
      const batch = g?.damageBatchContext;
      const active = batch ? !!batch.horizonGuard?.[team] : !!g?.teams?.[team]?.field?.some(u => u && !u.dead && Number(cardCapability(u, "teamDamageGuardAtFullHp", 0)) > 0 && Number(u.hp) >= Number(u.maxHp) && traitsActive(u, g));
      if (!active) return Math.max(0, Number(amount) || 0);
      const guard = (g?.teams?.[team]?.field || []).find(u => u && !u.dead && Number(cardCapability(u, "teamDamageGuardAtFullHp", 0)) > 0 && Number(u.hp) >= Number(u.maxHp) && traitsActive(u, g));
      const multiplier = Math.max(0, Math.min(1, Number(cardCapability(guard, "teamDamageGuardAtFullHp", 0.5)) || 0.5));
      return Math.max(0, (Number(amount) || 0) * multiplier);
    };
    return Object.freeze({
      begin,
      end,
      finalReceived
    });
  })();
}
export function ignoresCombatStatChanges(actor, target, g = state_engine_actions.timeTraitGame || state_ui_battle_state.game) {
  return [actor, target].some(u => u && traitsActive(u, g) && card(u).ignoreStatChanges);
}
// Stored modifiers and continuous traits contribute to the same stat value.
// Consumers choose whether changes apply once, before either stat is evaluated.
export function combatStats(g, unit, {
  ignoreChanges = false,
  defenseModMultiplier = 1
} = {}) {
  const traitBound = cardHasCapability(unit, "baseDefenseTraitBound");
  const baseDefense = traitBound && (ignoreChanges || !traitsActive(unit, g)) ? 0 : Number(unit.baseDefense || 0);
  if (ignoreChanges) return {
    attack: 0,
    defense: baseDefense,
    baseDefense
  };
  const team = g && teamOf(g, unit);
  const aura = team ? Math.max(0, ...g.teams[team].field.filter(source => source && !source.dead && traitsActive(source, g)).map(source => Number(cardCapability(source, "defenseAura", 0)))) : 0;
  const penalty = unit.aromaDamagePenalty && !(traitsActive(unit, g) && card(unit).statDecreaseImmune) ? 10 : 0;
  return {
    attack: Number(unit.attackMod || 0),
    /* baseDefense는 지금 실제로 적용 중인 기본 방어다. 특성이 정지돼 기본 방어가 빠진 경우에도 표시는 이 값을 기준으로 변화량을 계산한다. */
    baseDefense,
    defense: baseDefense + Number(unit.defenseMod || 0) * defenseModMultiplier + fragmentDefense(unit, g) + aura - penalty
  };
}
export function rawDamage(effect, actor, target, skill, g = state_engine_actions.timeTraitGame || state_ui_battle_state.game) {
  let n = effect.amount,
    statIgnored = ignoresCombatStatChanges(actor, target, g);
  if (!effect.ignoreAttackMod) n += combatStats(g, actor, {
    ignoreChanges: statIgnored
  }).attack;
  if (effect.noShieldBonus && !actor.shield) n += effect.noShieldBonus;
  if (card(actor).noShieldAttackBonus && !actor.shield && traitsActive(actor, g)) n += card(actor).noShieldAttackBonus;
  if (effect.ifTargetGathered && target.lastAction === "gather") n += effect.ifTargetGathered;
  if (effect.lastEnergyBonus && totalEnergy(actor) < 0.01) n += effect.lastEnergyBonus;
  if (effect.sameTargetBonus && actor.lastTarget === target.uid) n += effect.sameTargetBonus;
  if (effect.alternateBonus && actor.lastSkill && actor.lastSkill !== skill.id) n += effect.alternateBonus;
  if ((effect.sweetPoisonBonus || cardHasCapability(actor, "sweetna") && traitsActive(actor, g)) && status(target, "poison")) n += 10 * status(target, "poison");
  return n;
}
/* 이 공격이 크리티컬이 될 확률의 단일 판정. 맞는 쪽 특성(critTakenAtHp: 그 HP 이상이면 받는 공격이 항상 크리티컬)이 우선한다. */
export function criticalChanceOf(actor, target, effect, g = state_engine_actions.timeTraitGame || state_ui_battle_state.game) {
  if (effect?.forceCritical) return 1;
  const threshold = card(target)?.critTakenAtHp;
  if (Number.isFinite(threshold) && traitsActive(target, g) && Number(target.hp || 0) >= threshold) return 1;
  return Math.max(0, Math.min(1, Number(effect?.crit ?? card(actor).crit ?? 0)));
}
export function effectiveDefense(actor, target, effect, crit, g = state_engine_actions.timeTraitGame || state_ui_battle_state.game) {
  if (crit) return 0;
  const statIgnored = ignoresCombatStatChanges(actor, target, g),
    cap = effect?.defCap ?? 999,
    modMultiplier = Number(effect?.defenseModMultiplier ?? 1);
  return Math.min(cap, combatStats(g, target, {
    ignoreChanges: statIgnored,
    defenseModMultiplier: modMultiplier
  }).defense);
}
export function sweetProtection(g, actor, target) {
  let tt = teamOf(g, target);
  return tt && activeSweetna(g, tt) ? 10 * status(actor, "poison") : 0;
}
export function damageRange(g, actor, target, effect, skill) {
  let bases = effect.boostAmount ? [{
      n: effect.amount,
      w: 1 - effect.boostChance
    }, {
      n: effect.boostAmount,
      w: effect.boostChance
    }] : [{
      n: rawDamage(effect, actor, target, skill, g),
      w: 1
    }],
    critChance = criticalChanceOf(actor, target, effect, g),
    vals = [],
    sum = 0,
    weight = 0,
    pcts = g.variance && !effect.ignoreVariance ? Array.from({
      length: 35
    }, (_, i) => 66 + i) : [100];
  for (const bv of bases) for (const crit of critChance >= 1 ? [true] : critChance > 0 ? [false, true] : [false]) for (const pct of pcts) {
    let base = effect.boostAmount ? bv.n + rawDamage({
        ...effect,
        amount: 0,
        boostAmount: null
      }, actor, target, skill, g) : bv.n,
      w = bv.w * (crit ? critChance : 1 - critChance) / pcts.length;
    if (!critChance) w = bv.w / pcts.length;
    let def = effect.ignoreDefense ? 0 : effectiveDefense(actor, target, effect, false, g),
      n;
    if (crit) {
      const mult = state_engine_combat.CRITICAL_DAMAGE_MULTIPLIER,
        attackModParticipates = !ignoresCombatStatChanges(actor, target, g) && !effect.ignoreAttackMod,
        noAttackStatBase = attackModParticipates ? base - Number(actor.attackMod || 0) : base,
        baseline = noAttackStatBase * mult * pct / 100,
        adjusted = Math.max(0, base * mult * pct / 100 - def);
      n = Math.max(baseline, adjusted);
    } else {
      n = base * pct / 100 - def;
    }
    n = Math.max(0, n - sweetProtection(g, actor, target) - (target.hideHits ? 30 : 0));
    n = attackMitigation(g, target, n);
    n = Math.round(state_engine_combat.DamageBatchOwner.finalReceived(g, target, n));
    if (activeShieldProtector(g, target)) n = Math.ceil(n / 2);
    vals.push(n);
    sum += n * w;
    weight += w;
  }
  const evadeChance = attackEvasionChance(target, g);
  const r = {
    min: evadeChance > 0 ? 0 : Math.min(...vals),
    max: Math.max(...vals),
    mean: sum / weight * (1 - evadeChance),
    critChance
  };
  return r;
}
export function clearOwnedField(g, u, reason = "전장을 떠남") {
  if (g.fieldEffect?.ownerUid === u?.uid) {
    const label = g.fieldEffect?.type === "aroma" ? "아로마필드" : "그랜드필드";
    log(g, `${u.name} ${reason}: ${label} 종료.`);
    g.fieldEffect = null;
  }
  syncAromaCombatFlags(g);
}
export function checkDeath(g, u, killer) {
  const wasDead = !!u?.dead,
    team = u ? teamOf(g, u) : null,
    fieldSlot = team ? g.teams[team].field.findIndex(x => x?.uid === u.uid) : -1;
  actionFaultHit("death-before");
  if (u.hp <= 0 && !u.dead) {
    triggerGraveUp(g, u);
    if (u.hp > 0) return;
    if (undeadPreventsDeath(u)) { u.hp = 0; return; }
    u.hp = 0;
    u.dead = true;
    clearOwnedField(g, u, "사망");
    if (u.sequence || u.scheduledAction) {
      u.sequence = null;
      u.scheduledAction = null;
      log(g, `${u.name} 사망으로 예약 효과 취소.`);
    }
    log(g, `${u.name} 사망.`, "damage");
    if (killer) killer.lastTarget = u.uid;
    actionFaultHit("death-after");
    const replacementRequired = !!team && g.teams[team].field.some(x => x?.uid === u.uid) && g.teams[team].bench.some(x => x && !x.dead);
    if (replacementRequired) actionFaultHit("replacement-pending-after");
    if (!g.deferWinner) checkWinner(g);
  }
  if (u && !wasDead && u.dead && team) {
    g.teams[team].deathSerial = (g.teams[team].deathSerial || 0) + 1;
    if (cardHasCapability(u, "resonanceTrait") && fieldSlot >= 0 && traitsActive(u)) {
      g.teams[team].pendingElixianResonance ||= g.teams[team].field.map(() => false);
      g.teams[team].pendingElixianResonance[fieldSlot] = true;
      log(g, `${u.name} 특성 · 잔향: 슬롯 ${fieldSlot + 1}의 다음 출전 아군에게 영구 턴 시작 HP 10 회복을 예약.`);
      queueVisual(g, {
        type: "elixianPulseFx",
        uid: u.uid,
        resonance: true
      });
    }
  }
  syncAromaCombatFlags(g);
  if (u && !wasDead && u.dead) onRaidUnitDefeated(g, u);
}
export function queueVisual(g, u, type, amount, meta = {}) {
  if (u && typeof u === "object" && u.type && type == null) {
    u.recipientEntityId ||= u.targetUid || u.uid || null;
    u.sourceEntityId ||= u.uid || null;
  }
  let __result;
  __queueVisualCore: {
    if (typeof state_ui_battle_state.game !== "undefined" && g === state_ui_battle_state.game && u) {
      let event;
      if (u.type && type == null) {
        event = u;
        event.recipientEntityId ||= event.targetUid || event.uid || null;
        event.sourceEntityId ||= event.uid || null;
      } else {
        const recipientEntityId = u.entityId || u.uid || null;
        event = {
          uid: recipientEntityId,
          recipientEntityId,
          type,
          amount,
          ...meta
        };
      }
      if (["damage", "directHp"].includes(event.type) && typeof state_presentation_coordinates.DamagePresentationAnchorOwner !== "undefined") state_presentation_coordinates.DamagePresentationAnchorOwner.captureInto(g, event);
      if (["skillFx", "horizonStrike", "lunaShard", "sugarSwamp", "leafBlade", "orbVolley"].includes(event.type) && typeof state_presentation_coordinates.VfxCoordinateOwner !== "undefined") state_presentation_coordinates.VfxCoordinateOwner.captureInto(event);
      state_ui_battle_state.visualEvents.push(event);
    }
  }
  if (Array.isArray(state_ui_battle_state.visualEvents)) for (const ev of state_ui_battle_state.visualEvents) {
    ev.recipientEntityId ||= ev.targetUid || ev.uid || null;
    ev.sourceEntityId ||= ev.uid || null;
  }
  return __result;
}
export function skillVisualKind(skill, effects = []) {
  const text = `${skill?.name || ""} ${skill?.desc || ""}`;
  const types = effects.map(e => e.type);
  if (types.some(x => ["heal", "healAll", "queueHeal", "lifeRain"].includes(x)) || /회복|생명|라이프|치유/.test(text)) return "heal";
  if (types.some(x => ["shield", "nextHitReduction", "firstGuard", "grandField"].includes(x)) || /실드|보호|가드|방어/.test(text)) return "shield";
  if (types.some(x => /status|poison|freeze|paralyze|burn|slow|seal|trap/i.test(x)) || /독|마비|빙결|냉동|화상|저주|봉인|함정/.test(text)) return "status";
  if (types.some(x => /energy|color|clearField/i.test(x)) || /에너지|충전|전류|전기/.test(text)) return "energy";
  if (/베기|칼날|검|창|할퀴|발톱|채찍/.test(text)) return "slash";
  if (/화살|탄|샷|브레스|빔|광선|버스트|폭풍|파이어|불꽃|물|번개/.test(text)) return "projectile";
  if (/지진|강타|돌진|스매시|충돌|박치기|깨물|이빨|격돌/.test(text)) return "impact";
  return types.some(x => ["damage", "proportionalDamage", "firstBurst", "rampage", "firestorm"].includes(x)) ? "impact" : "magic";
}
export function queueSkillVisual(g, actor, target, skill, effects = []) {
  if (g?.bossRaid && skillDefHasEffect(skill, "bossTimeStrike")) {
    queueVisual(g, {
      type: "bossTimeStrikeFx",
      uid: actor.uid,
      targetUid: target?.uid || null
    });
    return;
  }
  if (typeof state_ui_battle_state.game === "undefined" || g !== state_ui_battle_state.game || !actor || !skill) return;
  if (["lifeRain", "horizonStrike", "lunaShard", "leafBlade", "orbVolley", "startSequence", 'suppressedCurse', 'graveDown'].some(type => skillDefHasEffect(skill, type))) return;
  if (skill.vfxTheme) {
    state_ui_battle_state.visualEvents.push({
      type: "marineSkillFx",
      uid: actor.uid,
      targetUid: target?.uid || null,
      theme: skill.vfxTheme,
      phase: "cast",
      skillName: skill.name
    });
    return;
  }
  if (skillDefHasRuntimeKind(skill, "randomShieldMeltHit")) {
    state_ui_battle_state.visualEvents.push({
      type: "eruptionFx",
      uid: actor.uid,
      targetUid: target?.uid || null,
      skillName: skill.name,
      boosted: false
    });
    return;
  }
  const kind = skillVisualKind(skill, effects);
  state_ui_battle_state.visualEvents.push({
    type: "skillFx",
    uid: actor.uid,
    targetUid: target?.uid || null,
    skillName: skill.name,
    kind
  });
}
export function queueBloomVisual(g, enemies, evaded) {
  if (typeof state_ui_battle_state.game !== "undefined" && g === state_ui_battle_state.game) {
    state_ui_battle_state.visualEvents.push({
      type: "bloomField"
    });
    for (const u of enemies) state_ui_battle_state.visualEvents.push({
      uid: u.uid,
      type: evaded[u.uid]?.paid ? "bloomHalf" : "bloomBurst"
    });
  }
}
export function reduceAllDamage(u, n, g = state_engine_actions.timeTraitGame || state_ui_battle_state.game) {
  if (u.fullInvulnerableUntilOwnTurn) return 0;
  if (u.scheduledAction?.kind === "zigzag") return 0;
  let out = traitsActive(u, g) ? Math.max(0, n - Number(cardCapability(u, "damageReduction", 0))) : Math.max(0, n);
  const fullHpMultiplier = traitsActive(u, g) ? Number(card(u).fullHpDamageMultiplier || 1) : 1;
  if (fullHpMultiplier < 1 && Number(u.hp || 0) >= Number(u.maxHp || 0) - 1e-6) out = Math.ceil(out * fullHpMultiplier);
  if (hpBarrierStanceActive(g, u)) out = Math.ceil(out * Number(card(u).hpBarrierStance.receivedDamageMultiplier ?? 1));
  return out;
}
export function hpBarrierStanceActive(g, unit) {
  return !!unit && !unit.dead && !!card(unit).hpBarrierStance && traitsActive(unit, g) && (unit.hpProtectionBarriers || []).some(layer => Number(layer.amount) > 0);
}
export function absorbHpProtectionBarrier(g, u, n) {
  n = Math.max(0, combatInt(n));
  for (const layer of u.hpProtectionBarriers || []) layer.amount = Math.max(0, combatInt(layer.amount));
  let original = n,
    absorbed = 0;
  for (const layer of u.hpProtectionBarriers || []) {
    if (n <= 0) break;
    let take = Math.min(layer.amount, n);
    layer.amount -= take;
    n -= take;
    absorbed += take;
  }
  u.hpProtectionBarriers = (u.hpProtectionBarriers || []).filter(x => x.amount > 0.001);
  if (absorbed) {
    if (n > 0) log(g, `${u.name}: HP 보호막 ${absorbed} 파괴, 초과 피해 ${n}이 본체 HP에 적용됐다.`);else log(g, `${u.name}: HP 보호막이 ${absorbed} 피해를 흡수했다.`);
  }
  return {
    absorbed,
    remainder: n,
    original
  };
}
export function afterBodyHpChange(g, u, oldHp) {
  if (!cardHasCapability(u, "thresholdEnergy")) return;
  u.lifeThresholdUses = Number(u.lifeThresholdUses || 0);
  u.lifeThresholdMaxUses = 2;
  if (u.hp > 140 && u.lifeThresholdUses < u.lifeThresholdMaxUses) u.yggThresholdArmed = true;
  if (oldHp > 140 && u.hp <= 140 && u.yggThresholdArmed) {
    u.yggThresholdArmed = false;
    if (!traitsActive(u)) {
      log(g, `${u.name}: 특성봉인 중 생명의 문턱을 통과해 발동하지 않음.`);
      return;
    }
    if (u.lifeThresholdUses >= u.lifeThresholdMaxUses) {
      log(g, `${u.name}: 생명의 문턱 사용 완료(2/2).`);
      return;
    }
    u.lifeThresholdUses++;
    log(g, `${u.name} 특성 · 생명의 문턱 발동 ${u.lifeThresholdUses}/2.`, "turn");
    for (const t of ["P", "A"]) for (const x of g.teams[t].field) if (x && !x.dead) removeOneFieldEnergy(g, x);
    setEnergyBatch(g, u, [1, 2, 3, 4].map(() => ({
      c: "W",
      a: 1
    })));
  }
}
export function removeOneFieldEnergy(g, u) {
  let stores = energyStores(u),
    left = 1,
    removed = 0;
  for (const store of stores) for (let i = store.length - 1; i >= 0 && left > 1e-6; i--) {
    let take = Math.min(store[i].a, left);
    store[i].a -= take;
    left -= take;
    removed += take;
    if (store[i].a < 0.01) store.splice(i, 1);
  }
  if (removed) log(g, `${u.name}: 생명의 문턱으로 에너지 ${energyAmountText(removed)}개 분량 제거.`);
  notifyReactiveEnergyMutation(g, u, false, "에너지 제거");
  return removed;
}
export function nonAttackDamage(g, u, n, source) {
  const raw = Math.round(n);
  const final = Math.round(state_engine_combat.DamageBatchOwner.finalReceived(g, u, reduceAllDamage(u, raw, g)));
  if (final > 0) g.noDamageTurns = 0;
  log(g, `${u.name}: ${source} 피해 ${raw}${raw !== final ? ` → 피해경감 후 ${final}` : ""}.`, "damage");
  const applied = applyResolvedDamagePacket(g, null, u, final, {
    damageType: "nonAttack",
    skillName: String(source || ""),
    disableShieldProtector: true,
    sourceLabel: String(source || "")
  });
  checkDeath(g, u);
  return applied;
}
export function applyShieldFirstFixedDamage(g, u, n, source) {
  const raw = Math.round(n);
  const final = Math.round(state_engine_combat.DamageBatchOwner.finalReceived(g, u, reduceAllDamage(u, raw, g)));
  const beforeHp = Number(u.hp || 0),
    beforeShield = Number(u.shield || 0);
  const applied = applyResolvedDamagePacket(g, null, u, final, {
    damageType: "shieldFirstDirect",
    skillName: String(source || ""),
    disableShieldProtector: true,
    sourceLabel: String(source || "")
  });
  const hpLoss = Math.max(0, beforeHp - Number(u.hp || 0));
  const shieldLoss = Math.max(0, beforeShield - Number(u.shield || 0));
  if (final > 0) g.noDamageTurns = 0;
  log(g, `${u.name}: ${source} 피해 ${raw}${raw !== final ? ` → 피해경감 후 ${final}` : ""}.`, "damage");
  return {
    applied,
    shieldLoss,
    hpLoss,
    final
  };
}
export function reflectDamage(g, defender, attacker) {
  let n = traitsActive(defender) ? card(defender).reflect || 0 : 0;
  if (n && attacker && !attacker.dead) {
    defender.reflectDealt += n;
    nonAttackDamage(g, attacker, n, `${defender.name} 반사`);
  }
}
export function activeShieldProtector(g, target) {
  let t = teamOf(g, target);
  return t && g.teams[t].field.find(u => u && !u.dead && u.uid !== target.uid && cardHasCapability(u, "shieldProtector") && traitsActive(u, g) && u.shield > 0);
}
export function eclipseBlocks(target, g = state_engine_actions.timeTraitGame || state_ui_battle_state.game) {
  return cardHasCapability(target, "eclipse") && target.eclipseEligible && traitsActive(target, g) && Math.abs(totalEnergy(target) - target.turns) < 0.001;
}
export function attackMitigation(g, target, amount) {
  return target.fireWingUntil != null || eclipseBlocks(target, g) ? 0 : reduceAllDamage(target, amount, g);
}
export function applyAttackReductionAndImmunity(g, target, amount) {
  const after = attackMitigation(g, target, amount);
  if (target.fireWingUntil != null) {
    log(g, `${target.name} 효과 · 화염날개: 공격 피해 무효.`);
  }
  if (eclipseBlocks(target, g)) {
    log(g, `${target.name} 특성 · 이클립스: 공격기술 피해 무효.`);
  }
  return after;
}
export function triggerFlappisHit(g, target) {
  let t = teamOf(g, target);
  if (!t) return;
  let f = g.teams[t].field.find(x => x && !x.dead && cardHasCapability(x, "traitEnergyOnHit") && traitsActive(x));
  if (!f) return;
  const rule = cardCapability(f, "traitEnergyOnHit", {});
  const own = f.uid === target.uid;
  const spec = own ? rule.self : rule.ally;
  if (!spec || !(Number(spec.amount) > 0)) return;
  requestTraitEnergy(g, f, spec.color || "W", Number(spec.amount), own ? "자신이 공격 타격을 받음" : "필드 아군이 공격 타격을 받음");
}
export function applyHpPortion(g, actor, target, n) {
  if (n <= 0) return 0;
  let ex = absorbHpProtectionBarrier(g, target, n),
    old = target.hp;
  target.hp -= ex.remainder;
  if (undeadPreventsDeath(target)) target.hp = Math.max(0, target.hp);
  afterBodyHpChange(g, target, old);
  return ex.absorbed + ex.remainder;
}
export function applyHpZeroEffect(g, actor, target, skill, sim = false) {
  if (!target || target.dead) return 0;
  const before = { hp: Math.max(0, Number(target.hp)), shield: Number(target.shield || 0) };
  target.hp = 0;
  afterBodyHpChange(g, target, before.hp);
  const event = emitDamageAppliedEvent(g, actor, target, { before, after: { hp: 0, shield: before.shield }, damageType: 'hpZero', skillId: skill.id, skillName: skill.name, sim });
  publishDamageVisual(g, target, before.hp, { damageEventId: event?.eventId || null, sourceEntityId: actor?.uid || null, skillId: skill.id });
  if (before.hp > 0) g.noDamageTurns = 0;
  checkDeath(g, target, actor);
  return before.hp;
}
export function shiftDamage(g, iruma, target, limit = 150) {
  let moved = Math.max(0, Math.min(limit, target.maxHp - target.hp));
  if (moved <= 0) {
    log(g, `${target.name}: 이전할 기존 HP 피해가 없음.`);
    return 0;
  }
  target.hp += moved;
  state_engine_entities.GenericBattleStatisticsOwner.recordHealing(g, {
    source: iruma,
    target,
    requestedAmount: moved,
    actualAppliedAmount: moved,
    reason: "shift-damage-transfer",
    effectId: "shift"
  });
  log(g, `${target.name}: 기존 HP 피해 ${moved}를 이루마에게 이전하여 HP ${moved} 회복.`, "heal");
  queueVisual(g, target, "heal", moved);
  let received = nonAttackDamage(g, iruma, moved, `${target.name}의 시프트 이전 피해`);
  log(g, `시프트: ${moved} 이전, 이루마 실질 피해 ${received}.`);
  return moved;
}
export function emitDamageAppliedEvent(g, actor, recipient, detail = {}) {
  const eventEngine = systems.BattleEventEngine;
  if (detail?.sim || !recipient) return null;
  const before = detail.before || {},
    after = detail.after || {};
  const actualAppliedAmount = state_engine_entities.GenericBattleStatisticsOwner.actualDamage(before, after);
  if (!eventEngine?.emit || !(actualAppliedAmount > 0)) return null;
  const recipientEntityId = recipient.entityId || recipient.uid || null;
  const sourceEntityId = actor?.entityId || actor?.uid || detail.sourceEntityId || null;
  const transactionId = g?.pendingTransaction?.transactionId || detail.transactionId || null;
  const actionId = g?.pendingTransaction?.actionId || detail.actionId || null;
  const event = eventEngine.emit(g, "DAMAGE_APPLIED", {
    sourceEntityId,
    recipientEntityId,
    teamId: typeof teamOf === "function" ? teamOf(g, recipient) : null,
    payload: {
      detailed: true,
      damageType: detail.damageType || "attack",
      skillId: detail.skillId || null,
      skillName: detail.skillName || null,
      actionId,
      transactionId,
      hitIndex: Number(detail.hitIndex || 1),
      hitCount: Number(detail.hitCount || 1),
      amount: actualAppliedAmount,
      hpBefore: Number(before.hp || 0),
      hpAfter: Number(after.hp || 0),
      shieldBefore: Number(before.shield || 0),
      shieldAfter: Number(after.shield || 0),
      hpDamage: Math.max(0, Math.max(0, Number(before.hp) || 0) - Math.max(0, Number(after.hp) || 0)),
      shieldDamage: Math.max(0, Math.max(0, Number(before.shield) || 0) - Math.max(0, Number(after.shield) || 0)),
      lethal: Number(after.hp || 0) <= 0 && Number(before.hp || 0) > 0,
      variancePercent: Number(detail.variancePercent || 100),
      defenseApplied: Number(detail.defenseApplied || 0),
      finalPacketDamage: Math.max(0, Number(detail.finalPacketDamage ?? detail.amount) || 0)
    }
  });
  if (event) state_engine_entities.GenericBattleStatisticsOwner.applyEvent(g, event);
  return event;
}
export function publishDamageVisual(g, target, amount, detail = {}) {
  const group = state_engine_combat.CompositeDamagePresentationOwner.active(g);
  if (group) {
    state_engine_combat.CompositeDamagePresentationOwner.record(g, target, amount, detail.damageEventId || null, detail);
    return null;
  }
  return queueVisual(g, target, "damage", amount, detail);
}
export function applyResolvedDamagePacket(g, actor, target, final, effect = {}) {
  let total = 0,
    targetActual = 0,
    protector = effect?.disableShieldProtector ? null : activeShieldProtector(g, target);
  const targetBefore = {
    hp: Number(target.hp || 0),
    shield: Number(target.shield || 0)
  };
  if (protector && final > 0) {
    const protectorBefore = {
      hp: Number(protector.hp || 0),
      shield: Number(protector.shield || 0)
    };
    let toProtector = Math.floor(final / 2),
      toTarget = final - toProtector,
      old = protector.shield,
      absorbed = Math.min(old, toProtector);
    protector.shield = Math.max(0, old - toProtector);
    protector.shieldAbsorbed += absorbed;
    total += absorbed;
    if (shieldMeltApplies(effect, protector) && toProtector > old) {
      let hp = applyHpPortion(g, actor, protector, toProtector - old);
      total += hp;
      log(g, `${protector.name} 특성 · 실드 대신피해: 실드 ${old} 파괴, 실드멜트 HP 피해 ${hp}.`);
    } else log(g, `${protector.name} 특성 · 실드 대신피해: ${target.name} ${toTarget}D / 실드 ${toProtector}D${toProtector > old ? " (초과 소멸)" : ""}.`);
    const protectorAfter = {
      hp: Number(protector.hp || 0),
      shield: Number(protector.shield || 0)
    };
    const protectorAmount = Math.max(0, protectorBefore.hp - protectorAfter.hp + protectorBefore.shield - protectorAfter.shield);
    const protectorEvent = emitDamageAppliedEvent(g, actor, protector, {
      ...effect,
      redirected: true,
      finalPacketDamage: toProtector,
      before: protectorBefore,
      after: protectorAfter,
      amount: protectorAmount
    });
    publishDamageVisual(g, protector, shieldMeltApplies(effect, protector) ? toProtector : absorbed, {
      damageEventId: protectorEvent?.eventId || null,
      sourceEntityId: actor?.entityId || actor?.uid || null,
      hitIndex: effect?.hitIndex || 1,
      hitCount: effect?.hitCount || 1,
      vfxSequenceId: effect?.vfxSequenceId || null,
      skillId: effect?.skillId || null
    });
    checkDeath(g, protector, actor);
    final = toTarget;
  }
  if (target.shield > 0) {
    let old = target.shield,
      absorbed = Math.min(old, final);
    target.shield = Math.max(0, old - final);
    target.shieldAbsorbed += absorbed;
    total += absorbed;
    targetActual += absorbed;
    if (shieldMeltApplies(effect, target) && final > old) {
      let hp = applyHpPortion(g, actor, target, final - old);
      total += hp;
      targetActual += hp;
      log(g, `${target.name} 실드멜트: 실드 ${old} 파괴, HP 피해 ${hp}.`);
    } else log(g, `${target.name} 실드 ${old} → ${target.shield}${final > old ? " (초과 피해 소멸)" : ""}.`);
  } else {
    let hp = applyHpPortion(g, actor, target, final);
    total += hp;
    targetActual += hp;
  }
  const targetAfter = {
    hp: Number(target.hp || 0),
    shield: Number(target.shield || 0)
  };
  const targetEvent = emitDamageAppliedEvent(g, actor, target, {
    ...effect,
    finalPacketDamage: final,
    before: targetBefore,
    after: targetAfter,
    amount: targetActual
  });
  publishDamageVisual(g, target, targetActual, {
    damageEventId: targetEvent?.eventId || null,
    sourceEntityId: actor?.entityId || actor?.uid || null,
    hitIndex: effect?.hitIndex || 1,
    hitCount: effect?.hitCount || 1,
    vfxSequenceId: effect?.vfxSequenceId || null,
    skillId: effect?.skillId || null
  });
  if ((effect?.damageType || "attack") === "attack") target.lastAttackDamage = targetActual;
  return total;
}
export function dealProportionalDamage(g, actor, target, basis, ratio, skill, sim = false) {
  let raw = (basis === "max" ? target.maxHp : target.hp) * ratio,
    after = Math.max(0, raw - sweetProtection(g, actor, target));
  if (target.hideHits > 0) {
    after = Math.max(0, after - 30);
    target.hideHits--;
    log(g, `${target.name} 효과 · 모래숨기 -30, 남은 ${target.hideHits}회.`);
  }
  after = applyAttackReductionAndImmunity(g, target, after);
  after = state_engine_combat.DamageBatchOwner.finalReceived(g, target, after);
  let final = Math.round(after);
  if (!sim) log(g, `${skill.name}: ${basis === "max" ? "최대" : "현재"} HP ${Math.round(ratio * 100)}% = ${combatInt(raw)}D, 방어·난수 무시, 최종 피해 ${final}D.`, "damage");
  let total = applyResolvedDamagePacket(g, actor, target, final, {
    damageType: "attack",
    proportional: true
  });
  triggerFlappisHit(g, target);
  reflectDamage(g, target, actor);
  checkDeath(g, target, actor);
  checkDeath(g, actor, target);
  return total;
}
export function attackPacketWouldDefeatTarget(g, target, finalDamage, effect = {}) {
  if (undeadPreventsDeath(target) || cardHasCapability(target, 'graveUp') && !target.graveUpConsumed && traitsActive(target, g)) return false;
  let toTarget = Math.max(0, Number(finalDamage || 0));
  if (activeShieldProtector(g, target) && toTarget > 0) toTarget -= Math.floor(toTarget / 2);
  const shield = Math.max(0, Number(target?.shield || 0));
  if (shield > 0) {
    if (!shieldMeltApplies(effect, target)) return false;
    toTarget = Math.max(0, toTarget - shield);
  }
  const barriers = (target?.hpProtectionBarriers || []).reduce((sum, layer) => sum + Math.max(0, Number(layer?.amount || 0)), 0);
  return toTarget + 1e-6 >= Math.max(0, Number(target?.hp || 0)) + barriers;
}
export function attackEvasionChance(target, g = state_engine_actions.timeTraitGame || state_ui_battle_state.game) {
  return traitsActive(target, g) ? Math.max(0, Math.min(1, Number(card(target).attackEvasionChance || 0))) : 0;
}
export function attackEvaded(g, target, sim = false) {
  const chance = attackEvasionChance(target, g);
  if (!(chance > 0) || sim) return false;
  if (g.rng.next() >= chance) return false;
  log(g, `${target.name} 특성 · 공격 회피!`);
  queueVisual(g, {
    type: "marineSkillFx",
    uid: target.uid,
    targetUid: target.uid,
    theme: "shuviDodge",
    phase: "impact",
    skillName: "회피"
  });
  return true;
}
export function blocksCriticalAttack(target) {
  if (!target || target.dead) return true;
  if (target.fullInvulnerableUntilOwnTurn) return true;
  if (target.scheduledAction?.kind === "zigzag") return true;
  if (target.fireWingUntil != null) return true;
  if (eclipseBlocks(target)) return true;
  return false;
}
export function applyCriticalAttack(g, actor, target, amount, skill, sim = false, reason = "", extra = {}) {
  if (!actor || !target || actor.dead || target.dead) return 0;
  if (!sim) {
    log(g, `${skill.name}: 크리티컬 판정${reason ? ` (${reason})` : ""}.`, "damage");
    queueVisual(g, {
      type: "marineSkillFx",
      uid: actor.uid,
      targetUid: target.uid,
      theme: "criticalImpact",
      phase: "impact",
      skillName: "크리티컬"
    });
  }
  return dealDamage(g, actor, target, {
    amount: Number(amount || 0),
    forceCritical: true,
    ...extra
  }, skill, sim);
}
export function dealDamage(g, actor, target, effect, skill, sim = false) {
  const faultBoundary = !effect?._nestedDamageSequence;
  if (faultBoundary) actionFaultHit("damage-before");
  const evadeChance = attackEvasionChance(target, g);
  if (attackEvaded(g, target, sim)) {
    if (faultBoundary) actionFaultHit("damage-after");
    return 0;
  }
  let hits = effect.hits || 1,
    total = 0,
    fmt = n => combatInt(n);
  for (let h = 1; h <= hits; h++) {
    if (actor.dead || target.dead) break;
    let base;
    if (effect.boostAmount) {
      let boosted = sim ? effect.amount + (effect.boostAmount - effect.amount) * effect.boostChance : g.rng.next() < effect.boostChance;
      base = boosted === true ? effect.boostAmount : boosted === false ? effect.amount : boosted;
      let extras = rawDamage({
        ...effect,
        amount: 0,
        boostAmount: null
      }, actor, target, skill, g);
      base += extras;
      if (!sim) {
        const eruptionBoosted = base - extras === effect.boostAmount;
        log(g, `분화 강화 ${eruptionBoosted ? "성공: 230D" : "실패: 210D"}.`, "turn");
        if (skillDefHasRuntimeKind(skill, "randomShieldMeltHit") && typeof state_ui_battle_state.game !== "undefined" && g === state_ui_battle_state.game) {
          for (let vi = state_ui_battle_state.visualEvents.length - 1; vi >= 0; vi--) {
            const ev = state_ui_battle_state.visualEvents[vi];
            if (ev.type === "eruptionFx" && ev.uid === actor.uid && ev.targetUid === target.uid) {
              ev.boosted = eruptionBoosted;
              break;
            }
          }
        }
      }
    } else base = rawDamage(effect, actor, target, skill, g);
    let crit = false,
      pct = 100,
      simCritExpectedAfterDefense = null,
      criticalIgnoredUnfavorableStats = false,
      criticalBaselineRolled = null,
      criticalAdjustedAfterDefense = null;
    const criticalMultiplier = state_engine_combat.CRITICAL_DAMAGE_MULTIPLIER;
    const criticalChance = criticalChanceOf(actor, target, effect, g);
    const attackModParticipates = !ignoresCombatStatChanges(actor, target, g) && !effect.ignoreAttackMod;
    const noAttackStatBase = attackModParticipates ? base - Number(actor.attackMod || 0) : base;
    const defenseForCriticalComparison = effect.ignoreDefense ? 0 : effectiveDefense(actor, target, effect, false, g);
    if (!sim) {
      crit = criticalChance >= 1 || g.rng.next() < criticalChance;
      if (g.variance && !effect.ignoreVariance) pct = g.rng.int(66, 100);
      if (crit) {
        const adjustedCriticalBase = base * criticalMultiplier,
          baselineCriticalBase = noAttackStatBase * criticalMultiplier,
          adjustedRolled = adjustedCriticalBase * pct / 100;
        criticalBaselineRolled = baselineCriticalBase * pct / 100;
        criticalAdjustedAfterDefense = Math.max(0, adjustedRolled - defenseForCriticalComparison);
        criticalIgnoredUnfavorableStats = criticalAdjustedAfterDefense + 1e-9 < criticalBaselineRolled;
        base = criticalIgnoredUnfavorableStats ? baselineCriticalBase : adjustedCriticalBase;
        log(g, `${skill.name} ${h}/${hits}: 크리티컬!${criticalIgnoredUnfavorableStats ? " 불리한 공격·방어 영향 무시." : ""}`);
      }
    } else {
      pct = g.variance && !effect.ignoreVariance ? 83 : 100;
      if (criticalChance > 0) {
        const normalBase = base,
          normalRolled = normalBase * pct / 100,
          normalDefense = effect.ignoreDefense ? 0 : effectiveDefense(actor, target, effect, false, g),
          normalAfterDefense = Math.max(0, normalRolled - normalDefense),
          criticalBaseline = noAttackStatBase * criticalMultiplier * pct / 100,
          criticalAdjusted = Math.max(0, normalBase * criticalMultiplier * pct / 100 - defenseForCriticalComparison),
          criticalAfterDefense = Math.max(criticalBaseline, criticalAdjusted);
        base = normalBase;
        simCritExpectedAfterDefense = normalAfterDefense * (1 - criticalChance) + criticalAfterDefense * criticalChance;
      }
    }
    let rolled = base * pct / 100,
      def = effect.ignoreDefense ? 0 : effectiveDefense(actor, target, effect, crit, g),
      after = sim && Number.isFinite(simCritExpectedAfterDefense) ? simCritExpectedAfterDefense : crit ? Math.max(Number(criticalBaselineRolled || 0), Number(criticalAdjustedAfterDefense || 0)) : Math.max(0, rolled - def),
      sweet = sweetProtection(g, actor, target);
    if (sim && Number.isFinite(simCritExpectedAfterDefense)) def = 0;
    if (crit) def = criticalIgnoredUnfavorableStats ? 0 : defenseForCriticalComparison;
    if (sweet) {
      after = Math.max(0, after - sweet);
      if (!sim) log(g, `스위트나 독 비례 보호 -${sweet}D.`);
    }
    const hideReductionPending = target.hideHits > 0;
    if (hideReductionPending) after = Math.max(0, after - 30);
    after = applyAttackReductionAndImmunity(g, target, after);
    if (sim && evadeChance > 0) after *= 1 - evadeChance;
    after = state_engine_combat.DamageBatchOwner.finalReceived(g, target, after);
    let final = Math.round(after);
    if (effect.failUnlessDefeat && !attackPacketWouldDefeatTarget(g, target, final, effect)) {
      if (!sim) {
        log(g, `${skill.name}: ${target.name}이 버텨 기술 실패. 피해는 적용되지 않음.`);
        queueVisual(g, {
          type: "marineSkillFx",
          uid: actor.uid,
          targetUid: target.uid,
          theme: "axeChopFail",
          phase: "impact",
          skillName: skill.name
        });
      }
      if (faultBoundary) actionFaultHit("damage-after");
      return 0;
    }
    if (hideReductionPending) {
      target.hideHits--;
      log(g, `${target.name} 효과 · 모래숨기 -30, 남은 ${target.hideHits}회.`);
    }
    if (!sim) {
      let calc = `${skill.name} ${hits > 1 ? `${h}/${hits} ` : ""}${fmt(base)}D`;
      if (g.variance) calc += ` × ${pct}% = ${fmt(rolled)}D`;
      if (def) calc += `, 방어 ${def} 적용`;
      if (Number(cardCapability(target, "damageReduction", 0)) > 0 && traitsActive(target)) calc += `, 피해경감 ${combatInt(cardCapability(target, "damageReduction", 0))}`;
      calc += `, 최종 피해 ${final}D`;
      log(g, calc, "damage");
    }
    total += applyResolvedDamagePacket(g, actor, target, final, {
      damageType: "attack",
      ...effect,
      sim,
      skillId: skill?.id || null,
      skillName: skill?.name || null,
      hitIndex: Number(effect._sequenceHitIndex || h),
      hitCount: Number(effect._sequenceHitCount || hits),
      variancePercent: pct,
      defenseApplied: def,
      baseDamage: base,
      rolledDamage: rolled
    });
    triggerFlappisHit(g, target);
    reflectDamage(g, target, actor);
    checkDeath(g, target, actor);
    checkDeath(g, actor, target);
    if (faultBoundary && h === 1) actionFaultHit("first-hit-after");
    if (faultBoundary && h < hits) actionFaultHit("next-hit-before");
  }
  if (faultBoundary) actionFaultHit("damage-after");
  return total;
}
export function dealDamageSequence(g, actor, target, amounts, skill, sim = false, baseEffect = {}) {
  const packets = (amounts || []).map(Number).filter(Number.isFinite);
  actionFaultHit("damage-before");
  let total = 0;
  for (let i = 0; i < packets.length; i++) {
    if (actor?.dead || target?.dead) break;
    total += dealDamage(g, actor, target, {
      ...baseEffect,
      amount: packets[i],
      hits: 1,
      _nestedDamageSequence: true,
      _sequenceHitIndex: i + 1,
      _sequenceHitCount: packets.length
    }, skill, sim);
    if (i === 0) actionFaultHit("first-hit-after");
    if (i + 1 < packets.length && !target?.dead) actionFaultHit("next-hit-before");
  }
  actionFaultHit("damage-after");
  return total;
}
export function heal(g, u, n, source = null, meta = {}) {
  actionFaultHit("healing-before");
  if (!u || u.dead) return 0;
  if (status(u, "healSeal")) {
    log(g, `${u.name}: 회복봉인으로 회복 실패.`);
    actionFaultHit("healing-after");
    return 0;
  }
  const base = Math.max(0, Math.round(Number(n) || 0)),
    adjusted = elixianHealAmount(g, u, base),
    old = u.hp,
    missingBefore = Math.max(0, u.maxHp - u.hp),
    got = Math.max(0, Math.min(adjusted, missingBefore));
  if (healingBecomesDamage(u)) {
    nonAttackDamage(g, u, adjusted, '언데드 · 회복 반전');
    actionFaultHit('healing-after');
    return 0;
  }
  u.hp += got;
  afterBodyHpChange(g, u, old);
  const bonus = adjusted - base;
  log(g, `${u.name} HP ${got} 회복${bonus ? ` (아로마필드 ${bonus > 0 ? "+" : ""}${bonus})` : ""}.`, "heal");
  if (got > 0) queueVisual(g, u, "heal", got);
  state_engine_entities.GenericBattleStatisticsOwner.recordHealing(g, {
    source,
    target: u,
    requestedAmount: adjusted,
    actualAppliedAmount: got,
    reason: meta?.reason || "heal",
    effectId: meta?.effectId || null,
    actionId: meta?.actionId || null,
    transactionId: meta?.transactionId || null,
    sim: !!meta?.sim
  });
  const sourceUnit = typeof source === "string" ? state_engine_entities.GenericBattleStatisticsOwner.resolveSource(g, source) : source;
  const splashRatio = !meta?.suppressHealingSplash && sourceUnit && traitsActive(sourceUnit) ? Number(card(sourceUnit).healingSplashMissingRatio || 0) : 0;
  if (got > 0 && splashRatio > 0) {
    const team = teamOf(g, sourceUnit),
      splash = Math.max(0, Math.floor(missingBefore * splashRatio));
    if (team && splash > 0) {
      const allies = g.teams[team].field.filter(ally => ally && !ally.dead);
      log(g, `${sourceUnit.name} 특성 · 회복 확산: ${u.name}의 회복 직전 잃은 HP ${missingBefore} → 필드 아군 전체 ${splash} 회복.`, "heal");
      for (const ally of allies) heal(g, ally, splash, sourceUnit, {
        ...meta,
        suppressHealingSplash: true,
        reason: "iruma-healing-splash",
        effectId: meta?.effectId || "iruma-healing-splash"
      });
      queueVisual(g, {
        type: "marineSkillFx",
        uid: sourceUnit.uid,
        targetUids: allies.map(ally => ally.uid),
        theme: "irumaHealingSplash",
        phase: "impact",
        skillName: "회복 확산"
      });
    }
  }
  actionFaultHit("healing-after");
  return got;
}
export function createShield(g, u, n, max = 999) {
  n = Math.max(0, combatInt(n));
  max = Math.max(0, combatInt(max));
  u.shield = Math.max(0, combatInt(u.shield));
  let got = Math.min(n, Math.max(0, max - u.shield));
  u.shield += got;
  log(g, `${u.name} 실드 +${got}${got < n ? " (상한 도달)" : ""}.`);
  if (got > 0) queueCombatNotice(g, u, `실드 +${got}`, "shield", {
    stackAmount: got
  });
  return got;
}
export function changeEnergyColor(g, u, color, all = false, source = null) {
  let __result;
  __changeEnergyColorCore: {
    if (typeof circuitBlocksExternal === "function" && circuitBlocksExternal(u, source)) {
      log(g, `${u.name} 특성 · 프레그먼트: 외부 에너지 색 변경 차단.`);
      {
        __result = 0;
        break __changeEnergyColorCore;
      }
    }
    const entries = energyStores(u).flat();
    if (!entries.length) {
      __result = 0;
      break __changeEnergyColorCore;
    }
    let changed = 0;
    if (all) {
      entries.forEach(e => {
        if (e.c !== color) {
          e.c = color;
          changed += e.a;
        }
      });
    } else {
      let e = entries.find(e => e.c !== color);
      if (e) {
        changed = e.a;
        e.c = color;
      }
    }
    for (const actor of ["beast", "rider"]) if (cardHasCapability(u, "dualActor")) normalizeEnergy(u, actor);
    if (!cardHasCapability(u, "dualActor")) normalizeEnergy(u);
    if (source) source.energyDisrupt += changed;
    log(g, `${u.name} 에너지 ${energyAmountText(changed)}개 분량이 ${color}로 변경.`);
    notifyReactiveEnergyMutation(g, u, true, "에너지 색 변경");
    {
      __result = changed;
      break __changeEnergyColorCore;
    }
  }
  if (typeof state_runtime_entities.EnergyEngine !== "undefined") state_runtime_entities.EnergyEngine.ensureStore(u);
  return __result;
}
export function removeEnergy(g, u, amount, source = null, { recent = false } = {}) {
  let __result;
  __removeEnergyCore: {
    if (typeof circuitBlocksExternal === "function" && circuitBlocksExternal(u, source)) {
      log(g, `${u.name} 특성 · 프레그먼트: 외부 에너지 제거 차단.`);
      {
        __result = 0;
        break __removeEnergyCore;
      }
    }
    const store = energyStores(u).find(st => st.length);
    if (!store) {
      __result = 0;
      break __removeEnergyCore;
    }
    let i = recent ? store.length - 1 : store.findIndex(e => e.a === 0.5);
    if (i < 0) i = 0;
    let e = store[i],
      x = Math.min(e.a, amount);
    e.a -= x;
    if (e.a < 0.01) store.splice(i, 1);
    if (source) source.energyDisrupt += x;
    log(g, `${u.name} 에너지 ${energyAmountText(x)}개 분량 제거.`);
    notifyReactiveEnergyMutation(g, u, false, "에너지 제거");
    {
      __result = x;
      break __removeEnergyCore;
    }
  }
  if (typeof state_runtime_entities.EnergyEngine !== "undefined") state_runtime_entities.EnergyEngine.ensureStore(u);
  return __result;
}
export function findUnit(g, uid) {
  for (const t of ["P", "A"]) for (const u of [...g.teams[t].field, ...g.teams[t].bench, ...g.teams[t].graveyard, ...(g.teams[t].summons || [])]) if (u?.uid === uid) return u;
  return null;
}
export function clearAllEnergy(u) {
  let __result;
  __clearAllEnergyCore: {
    let n = allEnergy(u);
    u.energy = [];
    u.beastEnergy = [];
    u.riderEnergy = [];
    notifyReactiveEnergyMutation(null, u, false, "에너지 전부 제거");
    {
      __result = n;
      break __clearAllEnergyCore;
    }
  }
  if (typeof state_runtime_entities.EnergyEngine !== "undefined") state_runtime_entities.EnergyEngine.ensureStore(u);
  return __result;
}
export function clearStatuses(g, target, source = null) {
  let removed = Object.keys(target.statuses || {}),
    sealedSkills = Object.entries(target.skillSeals || {}),
    had = removed.length + sealedSkills.length;
  if (!had) return false;
  removed.forEach(s => queueCombatNotice(g, target, `${state_engine_entities.STATUS[s] || s} 치료`, "cure"));
  sealedSkills.forEach(([skillId]) => {
    let skillName = card(target).skills.find(x => x.id === skillId)?.name || skillId;
    queueCombatNotice(g, target, `${skillName} 기술봉인 치료`, "cure");
  });
  target.statuses = {};
  target.statusAppliedTurnSerial = {};
  target.skillSeals = {};
  log(g, `${target.name}의 상태이상(기술봉인 포함)이 강제로 해제됨.`);
  let tt = teamOf(g, target);
  if (tt) triggerForcedCleansePenalty(g, target, tt, source);
  if (typeof reactiveEnergyRule === "function" && reactiveEnergyRule(target)) syncReactiveEnergyMaxHp(g, target, "특성 복귀", true);
  if (target.hp <= 0) checkDeath(g, target, source);
  return true;
}
export function clearFieldEnergy(g, actor) {
  let at = teamOf(g, actor),
    enemyLost = 0,
    allyLost = 0,
    removed = [];
  for (const t of ["P", "A"]) for (const u of g.teams[t].field) {
    if (!u || u.dead) continue;
    let n = clearAllEnergy(u);
    if (t !== at) enemyLost += n;else allyLost += n;
    removed.push({
      uid: u.uid,
      amount: n
    });
    log(g, `${u.name}: 지진으로 필드 에너지 ${energyAmountText(n)} 제거.`);
  }
  actor.energyDisrupt += enemyLost;
  if (!!firstSkillByTag(actor, "fieldClear")) {
    queueVisual(g, {
      type: "huveEarthquake",
      uid: actor.uid,
      removed
    });
  }
}
export function activeNoBlack(g, t) {
  return !!g?.teams?.[t]?.field?.some(u => u && !u.dead && cardHasCapability(u, "noBlackGather") && traitsActive(u));
}
export function activeNoRed(g, t) {
  return !!g?.teams?.[t]?.field?.some(u => u && !u.dead && cardHasCapability(u, "noRedGather") && traitsActive(u));
}

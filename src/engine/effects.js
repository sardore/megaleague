import { applyClockEffect } from "../features/timeora.js";
import { applyReactiveEnergyEffect } from "../features/genocider.js";
import { applyResonanceEffect, syncAromaCombatFlags, elixianHpProtection, totalHpProtection } from "../features/elixian.js";
import { applyWellerEffect, resolveSuppressedCurse } from '../features/weller.js';
import { healingBecomesDamage, healingCapacity } from './status-rules.js';
import { applyStrikeEffect } from "../features/foxious.js";
import { applySummonEffect, circuitBlocksExternal, resolveVoltageBurst } from "../features/summons.js";
import { applyDeepSeaEffect, grantEnergyWithDiscard } from "../features/character-rules.js";
// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_engine_effects = {
  RANDOM_ENERGY_RULES: undefined,
  ENERGY_GAIN_SERVICE: undefined
};
import { state_catalog_cards } from "../catalog/cards.js";
import { other, unitAt } from "./actions.js";
import { activeIruma, activeNoBlack, activeNoRed, afterBodyHpChange, applyCriticalAttack, applyShieldFirstFixedDamage, applyStatus, attackEvasionChance, attackPacketWouldDefeatTarget, blocksCriticalAttack, changeEnergyColor, checkDeath, clearAllEnergy, clearFieldEnergy, clearStatuses, createShield, damageRange, dealDamage, dealDamageSequence, dealProportionalDamage, findUnit, heal, isStatusImmune, nonAttackDamage, queueBloomVisual, queueVisual, removeEnergy, shiftDamage, teamOf, traitsActive, triggerForcedCleansePenalty, state_engine_combat } from "./combat.js";
import { allEnergy, energyStore, gainEnergy, notifyReactiveEnergyMutation, spendReq, status, totalEnergy } from "./energy.js";
import { RNG, actionFaultHit, card, cardHasCapability, firstSkillByEffect, firstSkillByTag, firstSkillOf, skillDefHasEffect, skillDefHasTag, skillIdByEffectGlobal, state_engine_entities } from "./entities.js";
import { checkWinner } from "./execution.js";
import { dmAppendMemoryCost, dmIsDragonCard, dmMemoryBaseCosts } from "../features/dragon-memory.js";
import { log, queueCombatNotice } from "../presentation/audio.js";
import { combatInt, energyAmountText, state_ui_battle_state } from "../ui/battle-state.js";
export class EnergyGainContext {
  constructor({
    game: g,
    recipient = null,
    team = null,
    actor = null,
    source = "random",
    candidates = ["R", "W", "B"],
    amount = 1,
    store = null,
    fixedColor = null,
    rng = null
  } = {}) {
    this.game = g || null;
    this.recipient = recipient || null;
    this.team = team || (g && recipient ? teamOf(g, recipient) : null);
    this.actor = actor || null;
    this.source = String(source || "random");
    this.amount = Number(amount || 0);
    this.fixedColor = "RWB".includes(fixedColor) ? fixedColor : null;
    this.rng = rng || g?.rng || null;
    this.store = Array.isArray(store) ? store : recipient ? energyStore(recipient, actor) : [];
    this.baseCandidates = [...new Set((candidates || []).map(String).filter(c => "RWB".includes(c)))];
    this.originalCandidateCount = this.baseCandidates.length;
  }
  deterministicCandidates() {
    if (this.fixedColor) return [this.fixedColor];
    if (Math.abs(this.amount - 0.5) < 0.001) {
      const half = this.store.find(e => Number(e?.a || 0) === 0.5 && "RWB".includes(e?.c));
      if (half && this.baseCandidates.includes(half.c)) return [half.c];
    }
    return [...this.baseCandidates];
  }
}
export class EnergyGainRule {
  constructor(id, applies, transform) {
    this.id = id;
    this.applies = applies;
    this.transform = transform;
  }
}
export class EnergyGainRuleBook {
  constructor() {
    this.rules = [];
  }
  register(rule) {
    if (!(rule instanceof EnergyGainRule)) throw new TypeError("EnergyGainRule required");
    this.rules.push(rule);
    return this;
  }
  candidates(context) {
    const ctx = context instanceof EnergyGainContext ? context : new EnergyGainContext(context);
    let pool = ctx.deterministicCandidates();
    // 후보가 하나뿐이면 무작위 수급이 아니므로 어떤 색상 제한 특성도 개입하지 않는다.
    if (pool.length < 2) return pool;
    for (const rule of this.rules) {
      if (!rule.applies(ctx, pool)) continue;
      const next = [...new Set((rule.transform(ctx, [...pool]) || []).map(String).filter(c => "RWB".includes(c)))];
      if (next.length) pool = next;
    }
    return pool;
  }
}
export class RandomEnergyGainService {
  constructor(ruleBook) {
    this.ruleBook = ruleBook;
  }
  context(input) {
    return input instanceof EnergyGainContext ? input : new EnergyGainContext(input);
  }
  candidates(input) {
    return this.ruleBook.candidates(this.context(input));
  }
  draw(input) {
    actionFaultHit("energy-proposal-before");
    const ctx = this.context(input),
      pool = this.candidates(ctx);
    actionFaultHit("energy-proposal-after");
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];
    if (!ctx.rng?.pick) throw new Error(`무작위 에너지 RNG 없음: ${ctx.source}`);
    return ctx.rng.pick(pool);
  }
  grant(input, replaceIndex = null, opt = {}) {
    const ctx = this.context(input),
      color = this.draw(ctx);
    if (!color || !ctx.recipient) return {
      color,
      gained: false
    };
    const gained = gainEnergy(ctx.game, ctx.recipient, color, ctx.amount, replaceIndex, ctx.actor, opt);
    return {
      color,
      gained
    };
  }
}
export function initializeEngineEffects() {
  state_engine_effects.RANDOM_ENERGY_RULES = new EnergyGainRuleBook().register(new EnergyGainRule("flameflower-no-black-random-gain", (ctx, pool) => ctx.originalCandidateCount >= 2 && pool.length >= 2 && !!ctx.game && !!ctx.team && activeNoBlack(ctx.game, ctx.team), (_ctx, pool) => pool.filter(c => c !== "B"))).register(new EnergyGainRule("lunari-no-red-random-gain", (ctx, pool) => ctx.originalCandidateCount >= 2 && pool.length >= 2 && !!ctx.game && !!ctx.team && activeNoRed(ctx.game, ctx.team), (_ctx, pool) => pool.filter(c => c !== "R")));
  state_engine_effects.ENERGY_GAIN_SERVICE = new RandomEnergyGainService(state_engine_effects.RANDOM_ENERGY_RULES);
}
export function randomEnergyCandidates(g, {
  recipient = null,
  team = null,
  actor = null,
  source = "random",
  candidates = ["R", "W", "B"],
  amount = 1,
  store = null,
  fixedColor = null,
  rng = null
} = {}) {
  return state_engine_effects.ENERGY_GAIN_SERVICE.candidates({
    game: g,
    recipient,
    team,
    actor,
    source,
    candidates,
    amount,
    store,
    fixedColor,
    rng
  });
}
export function drawRandomEnergyColor(g, options = {}) {
  return state_engine_effects.ENERGY_GAIN_SERVICE.draw({
    game: g,
    ...options
  });
}
export function naturalColors(g, t, recipient = null, amount = 1, actor = null, source = "natural-gather") {
  return randomEnergyCandidates(g, {
    recipient,
    team: t,
    actor,
    source,
    candidates: ["R", "W", "B"],
    amount
  });
}
export function cloneRngForPreview(rng) {
  if (!rng) return null;
  const clone = Object.create(RNG.prototype);
  clone.s = Number(rng.s || 0);
  return clone;
}
export function previewNaturalGatherProposal(g, t, s, u, amount, actor = null, source = "natural-gather") {
  if (!g || !u) return null;
  const amt = Number(amount || 0),
    store = energyStore(u, actor),
    colors = naturalColors(g, t, u, amt, actor, `${source}-preview`),
    existingHalf = Math.abs(amt - 0.5) < 0.001 ? store.find(e => Number(e?.a || 0) === 0.5) : null,
    rngState = Number(g?.rng?.s ?? 0),
    previewRng = cloneRngForPreview(g.rng),
    beforePreview = Number(previewRng?.s ?? rngState);
  let color = existingHalf?.c || null;
  if (!color) {
    if (!colors.length) return null;
    color = colors.length === 1 ? colors[0] : previewRng.pick(colors);
  }
  return Object.freeze({
    version: 1,
    kind: "natural-gather",
    turnSerial: Number(g.turnSerial || 0),
    team: t,
    slot: Number(s),
    uid: u.uid || null,
    actor: actor || null,
    amount: amt,
    color,
    candidates: Object.freeze([...colors]),
    rngState,
    rngUsed: Number(previewRng?.s ?? beforePreview) !== beforePreview
  });
}
export function consumeNaturalGatherProposal(g, t, s, u, amount, actor = null, proposal = null, source = "natural-gather") {
  if (!proposal || proposal.kind !== "natural-gather" || !g || !u) return null;
  const amt = Number(amount || 0),
    store = energyStore(u, actor),
    colors = naturalColors(g, t, u, amt, actor, `${source}-execute`),
    existingHalf = Math.abs(amt - 0.5) < 0.001 ? store.find(e => Number(e?.a || 0) === 0.5) : null;
  if (Number(proposal.turnSerial) !== Number(g.turnSerial || 0) || proposal.team !== t || Number(proposal.slot) !== Number(s) || proposal.uid !== (u.uid || null) || (proposal.actor || null) !== (actor || null) || Math.abs(Number(proposal.amount || 0) - amt) > 0.001 || !Array.isArray(proposal.candidates) || proposal.candidates.join("") !== colors.join("")) return null;
  const deterministic = existingHalf?.c || (colors.length === 1 ? colors[0] : null);
  if (deterministic) return deterministic === proposal.color ? deterministic : null;
  if (!colors.length || Number(g?.rng?.s ?? 0) !== Number(proposal.rngState)) return null;
  const stateBefore = Number(g.rng.s || 0),
    actual = g.rng.pick(colors);
  if (actual !== proposal.color) {
    g.rng.s = stateBefore;
    return null;
  }
  return actual;
}
export function totalAttackDecrease(u) {
  return Math.max(0, Number(u?.attackDecrease || 0), -Number(u?.attackMod || 0));
}
export function clearAttackDecreases(g, u) {
  const amount = totalAttackDecrease(u);
  u.attackMod = Number(u.attackMod || 0) + amount;
  u.attackDecrease = 0;
  log(g, `${u.name}: 공격력 감소 ${amount} 전부 제거.`);
  return amount;
}
export function setAttack(g, u, delta) {
  if (delta < 0 && traitsActive(u, g) && card(u).statDecreaseImmune) {
    log(g, `${u.name} 특성 · 능력치 감소 무효.`);
    queueCombatNotice(g, u, "공격 감소 무효", "immune");
    return 0;
  }
  const old = Number(u.attackMod || 0);
  u.attackDecrease = totalAttackDecrease(u) + Math.max(0, -Number(delta || 0));
  u.attackMod = old + Number(delta || 0);
  log(g, `${u.name} 공격 ${old} → ${u.attackMod}.`);
  return u.attackMod - old;
}
export function setDefense(g, u, delta) {
  if (delta < 0 && traitsActive(u) && card(u).statDecreaseImmune) {
    log(g, `${u.name} 특성 · 능력치 감소 무효.`);
    queueCombatNotice(g, u, "방어 감소 무효", "immune");
    return 0;
  }
  let old = u.defense;
  u.defenseMod += delta;
  u.defense = u.baseDefense + u.defenseMod;
  log(g, `${u.name} 방어 ${old} → ${u.defense}.`);
  const actual = u.defense - old;
  if (actual) queueCombatNotice(g, u, `방어 ${actual > 0 ? "+" : ""}${actual}`, "effect", {
    stackAmount: actual
  });
  return actual;
}
export function distributeHealPool(g, units, pool, source = null, meta = {}) {
  pool = Math.max(0, Math.round(pool));
  let healed = 0,
    candidates = units.filter(u => healingCapacity(u) > 0);
  while (pool > 0 && candidates.length) {
    const previousPool = pool;
    let share = Math.max(1, Math.floor(pool / candidates.length));
    for (const u of [...candidates]) {
      if (pool <= 0) break;
      const ask = Math.min(share, pool), inverted = healingBecomesDamage(u);
      let got = heal(g, u, ask, source, meta);
      pool -= inverted ? ask : got;
      healed += got;
    }
    candidates = candidates.filter(u => healingCapacity(u) > 0);
    if (pool === previousPool) break;
    if (candidates.length && !share) break;
  }
  return healed;
}
export function addHpProtectionBarrier(g, u, amount, sourceUid, kindOverride = null, options = {}) {
  amount = Math.max(0, combatInt(amount));
  u.hpProtectionBarriers ||= [];
  const source = sourceUid ? findUnit(g, sourceUid) : null;
  const kind = kindOverride || (cardHasCapability(source, "resonanceTrait") ? "elixian" : "standard");
  const globalRoom = Math.max(0, (options.cap ?? combatInt(u.maxHp)) - totalHpProtection(u));
  const sourceRoom = kind === "elixian" ? Math.max(0, 80 - elixianHpProtection(u)) : Number.POSITIVE_INFINITY;
  const got = Math.max(0, Math.min(amount, globalRoom, sourceRoom));
  if (got > 0) {
    u.hpProtectionBarriers.push({
      amount: got,
      sourceUid,
      kind,
      ...(options.decayPerTurn != null ? { decayPerTurn: options.decayPerTurn } : {}),
      ...(options.healOnDecay ? { healOnDecay: options.healOnDecay } : {}),
      lastHalvedEpoch: u.barrierTurnEpoch || 0
    });
  }
  log(g, `${u.name} 효과 · HP 보호막 ${got} 생성${got < amount ? "(상한 도달)" : ""}(총 ${totalHpProtection(u)}/${u.maxHp}).`);
  if (got > 0) queueCombatNotice(g, u, `HP 보호막 +${got}`, "barrier", {
    sourceEntityId: sourceUid || null,
    stackAmount: got
  });
  return got;
}
export function decayHpProtectionBarriers(g, u, sim = false) {
  if (!u.hpProtectionBarriers?.length) return;
  const healed = {};
  let changed = false,
    epoch = u.barrierTurnEpoch || 0;
  for (const x of u.hpProtectionBarriers) {
    if (x.kind === "elixian" && x.decayPerTurn == null) continue;
    if ((x.lastHalvedEpoch ?? -1) >= epoch) continue;
    const before = combatInt(x.amount);
    x.amount = x.decayPerTurn != null ? Math.max(0, before - Number(x.decayPerTurn)) : Math.floor(before / 2);
    if (x.healOnDecay) healed[x.healOnDecay] = (healed[x.healOnDecay] || 0) + (before - combatInt(x.amount));
    x.lastHalvedEpoch = epoch;
    changed = true;
  }
  u.hpProtectionBarriers = u.hpProtectionBarriers.filter(x => x.amount > 0.01);
  if (changed) log(g, `${u.name}: HP 보호막의 차례 시작 감소 적용(총 ${totalHpProtection(u)}).`);
  // A barrier that converts its decay into healing heals exactly what it lost (damage it absorbed earlier is not refunded).
  for (const [effectId, amount] of Object.entries(healed)) if (amount > 0) heal(g, u, amount, u, { reason: effectId, effectId, sim });
}
export function applySkillSeal(g, u, skillId, d, source) {
  if (u.scheduledAction?.kind === "bloom") {
    log(g, `${u.name}: 피어나는생명 대기 효과로 기술봉인 무효.`);
    queueCombatNotice(g, u, "기술봉인 무효", "immune");
    return false;
  }
  if (isStatusImmune(u, "skillSeal")) {
    log(g, `${u.name}: 특성으로 기술봉인 면역.`);
    queueCombatNotice(g, u, "기술봉인 면역", "immune");
    return false;
  }
  u.skillSeals[skillId] = Math.max(u.skillSeals[skillId] || 0, d);
  if (source) source.statusScore += d;
  const sealedSkillName = card(u).skills.find(x => x.id === skillId)?.name || "기술";
  log(g, `${u.name}의 ${sealedSkillName} 기술봉인 ${d}턴.`);
  queueCombatNotice(g, u, `${sealedSkillName} 기술봉인 ${d}턴`, "status");
  let t = teamOf(g, u),
    ir = t && activeIruma(g, t);
  if (ir && traitsActive(ir)) {
    delete u.skillSeals[skillId];
    log(g, `${ir.name} 특성 · 즉시 상태이상 치료: ${u.name}의 기술봉인 제거.`);
    queueCombatNotice(g, u, "기술봉인 치료", "cure");
    heal(g, u, 20, ir, {
      reason: "iruma-cleanse",
      effectId: "instant-cleanse"
    });
    triggerForcedCleansePenalty(g, u, t, source);
  }
  return true;
}
export function processQueuedHeal(g, u) {
  if (!u.queuedHeals?.length) return;
  for (const q of [...u.queuedHeals]) {
    heal(g, u, q.amount, q.sourceUid, {
      reason: "queued-heal",
      effectId: q.effectId || q.kind || "queued-heal"
    });
    q.remaining--;
    log(g, `${u.name}: 예약 지속 회복 ${q.amount}, 남은 ${q.remaining}회.`);
  }
  u.queuedHeals = u.queuedHeals.filter(q => q.remaining > 0);
}
export function createGrandField(g, actor, t, target, skill, sim, effect = {}) {
  const grandPresent = g.fieldEffect?.type === "grand",
    amount = grandPresent ? Number(effect.damageWhenPresent ?? effect.damageAmount ?? 40) : Number(effect.damageWhenMissing ?? effect.damageAmount ?? 40),
    damage = amount > 0 && target ? dealDamage(g, actor, target, {
      amount
    }, skill, sim) : 0;
  if (effect.onlyIfMissing && grandPresent) return damage;
  const previous = g.fieldEffect;
  if (previous) {
    const previousOwner = findUnit(g, previous.ownerUid);
    log(g, `${previousOwner?.name || "기존 소유자"}의 ${previous.type === "grand" ? "그랜드필드" : "기존 필드"} 효과 제거.`, "turn");
  }
  g.fieldEffect = {
    type: "grand",
    ownerUid: actor.uid,
    team: t,
    serial: (previous?.serial || 0) + 1
  };
  log(g, `${actor.name} 효과 · 그랜드필드 전개: 아군 W/B→*, 적 *→WorB.`, "turn");
  queueVisual(g, {
    type: "grandWave",
    uid: actor.uid,
    team: t
  });
  const barrierAmount = Math.max(0, Number(effect.barrierAmount ?? 120));
  if (barrierAmount > 0) {
    log(g, `${actor.name}: 그랜드필드 부가효과로 HP 보호막 ${barrierAmount} 부여.`, "turn");
    for (const unit of g.teams[t].field) if (unit && !unit.dead) addHpProtectionBarrier(g, unit, barrierAmount, actor.uid);
  }
  return damage;
}
export function ensureScheduledActionIdentity(g, u, scheduled = u?.scheduledAction) {
  if (!g || !u || !scheduled) return null;
  const sourceInstanceId = String(u.entityId || u.uid || "");
  if (!sourceInstanceId) return null;
  if (!scheduled.sourceInstanceId) scheduled.sourceInstanceId = sourceInstanceId;
  if (!scheduled.scheduledActionId) {
    g.scheduledActionSerial = Math.max(0, Number(g.scheduledActionSerial) || 0) + 1;
    const battleId = String(g.battleId || g.matchId || g.seed || "battle");
    scheduled.scheduledActionId = `${battleId}:scheduled:${g.scheduledActionSerial}:${sourceInstanceId}`;
  }
  return scheduled;
}
export function registerScheduledAction(g, u, scheduled) {
  actionFaultHit("schedule-before");
  if (!g || !u || !scheduled || typeof scheduled !== "object") return null;
  u.scheduledAction = {
    ...scheduled
  };
  const registered = ensureScheduledActionIdentity(g, u, u.scheduledAction);
  actionFaultHit("schedule-after");
  return registered;
}
export function scheduledExecutionId(g, scheduled) {
  return `${scheduled.scheduledActionId}:due:${Number(g?.turnSerial || 0)}`;
}
export function beginScheduledActionExecution(g, u) {
  const scheduled = ensureScheduledActionIdentity(g, u);
  if (!scheduled) return null;
  const executionId = scheduledExecutionId(g, scheduled);
  const consumed = Array.isArray(g.consumedScheduledActionIds) ? g.consumedScheduledActionIds : g.consumedScheduledActionIds = [];
  if (consumed.includes(executionId)) {
    if (u.scheduledAction === scheduled) u.scheduledAction = null;
    u.lastAction = "scheduled";
    return {
      scheduled,
      executionId,
      duplicate: true
    };
  }
  return {
    scheduled,
    executionId,
    duplicate: false
  };
}
export function completeScheduledActionExecution(g, execution) {
  if (!g || !execution || execution.duplicate) return false;
  const consumed = Array.isArray(g.consumedScheduledActionIds) ? g.consumedScheduledActionIds : g.consumedScheduledActionIds = [];
  if (consumed.includes(execution.executionId)) return false;
  consumed.push(execution.executionId);
  if (consumed.length > 256) consumed.splice(0, consumed.length - 256);
  return true;
}
export function startZigzag(g, u) {
  registerScheduledAction(g, u, {
    kind: "zigzag",
    remaining: 1
  });
  log(g, `${u.name} 효과 · 지그재그굴착 무적 대기. 다음 자기 차례에 발동.`);
}
export function executeZigzag(g, t, u, sim = false) {
  let enemies = g.teams[other(t)].field.filter(x => x && !x.dead),
    counts = new Map(enemies.map(x => [x.uid, 0])),
    sk = firstSkillByEffect(u, "zigzagExcavate");
  for (let i = 0; i < 5 && enemies.length; i++) {
    let weights = enemies.map(x => Math.max(1, 5 - allEnergy(x))),
      sum = weights.reduce((n, x) => n + x, 0),
      roll = sim ? sum / 2 : g.rng.next() * sum,
      pick = enemies[enemies.length - 1];
    for (let j = 0; j < enemies.length; j++) {
      roll -= weights[j];
      if (roll <= 0) {
        pick = enemies[j];
        break;
      }
    }
    counts.set(pick.uid, counts.get(pick.uid) + 1);
  }
  u.scheduledAction = null;
  for (const x of enemies) {
    let n = counts.get(x.uid);
    if (n) {
      log(g, `${u.name} 지그재그굴착: ${x.name} ${n}회 선택 → ${n * 40}D 단일 공격.`);
      dealDamage(g, u, x, {
        amount: n * 40
      }, sk, sim);
    }
  }
}
export function scheduledSlotRef(g, target) {
  let targetTeam = teamOf(g, target),
    targetSlot = targetTeam ? g.teams[targetTeam].field.findIndex(x => x?.uid === target.uid) : -1;
  return {
    targetTeam,
    targetSlot
  };
}
export function lightCandelabra(g, actor, target, paid, ctx, skill) {
  let w = Math.min(3, Math.floor(paid.filter(x => x.c === "W").reduce((n, x) => n + x.a, 0) + 0.001)),
    t = teamOf(g, actor);
  if (teamOf(g, target) !== t) {
    let d = dealDamage(g, actor, target, {
      amount: 100
    }, skill, ctx.sim);
    if (!target.dead && w >= 1) applyStatus(g, target, "traitSeal", 5, actor);
    if (!target.dead && w >= 2) applyStatus(g, target, "healSeal", 5, actor);
    if (!target.dead && w >= 3) {
      let sid = ctx.sealedSkillId || card(target).skills[0]?.id;
      if (sid) applySkillSeal(g, target, sid, 5, actor);
    }
    return d;
  }
  let amount = [30, 40, 60, 120][w],
    ticks = [4, 3, 2, 1][w];
  heal(g, target, amount, actor, {
    reason: "light-candelabra",
    effectId: skill?.id || "lightCandelabra",
    sim: ctx.sim
  });
  if (ticks > 1) {
    target.queuedHeals.push({
      amount,
      remaining: ticks - 1,
      sourceUid: actor.uid
    });
    log(g, `${target.name} 효과 · 빛의촛대 지속 회복 ${amount} × ${ticks - 1}회 예약.`);
  }
  return 0;
}
export function lifeRainHealPool(g, actor, t) {
  // 최신 임시 조정: 분배 가능한 라이프레인 회복 자원은
  // 기술 처리 직전 이루마 현재 HP의 1/3만 사용한다.
  return Math.max(0, Math.round((actor?.hp || 0) / 3));
}
export function distributeLifeRainPool(g, allies, pool, leftAmount = null, source = null, meta = {}) {
  allies = allies.filter(u => u && !u.dead);
  if (!allies.length || pool <= 0) return {
    healed: 0,
    overheal: pool
  };
  if (allies.length === 1) {
    const inverted = healingBecomesDamage(allies[0]);
    const got = heal(g, allies[0], pool, source, meta);
    return {
      healed: got,
      overheal: inverted ? 0 : pool - got
    };
  }
  let left = Math.max(0, Math.min(pool, Math.round(leftAmount == null ? pool / 2 : leftAmount)));
  let requested = [left, pool - left],
    healed = 0,
    converted = 0,
    carry = [0, 0];
  for (let i = 0; i < 2; i++) {
    if (status(allies[i], "healSeal")) {
      log(g, `${allies[i].name}: 라이프레인 배정 ${requested[i]}이 회복봉인으로 소멸.`);
      continue;
    }
    const missing = healingCapacity(allies[i]);
    const ask = Math.min(requested[i], missing);
    if (healingBecomesDamage(allies[i])) converted += ask;
    healed += heal(g, allies[i], ask, source, meta);
    carry[1 - i] += Math.max(0, requested[i] - ask);
  }
  for (let i = 0; i < 2; i++) if (carry[i] > 0 && !allies[i].dead && !status(allies[i], "healSeal")) {
    if (healingBecomesDamage(allies[i])) converted += carry[i];
    healed += heal(g, allies[i], carry[i], source, meta);
  }
  return {
    healed,
    overheal: Math.max(0, pool - healed - converted)
  };
}
export function lifeRain(g, actor, t, split = null, sim = false) {
  let enemy = other(t),
    sk = firstSkillByEffect(actor, "lifeRain");
  for (const u of [...g.teams[enemy].field]) if (u && !u.dead) {
    dealDamage(g, actor, u, {
      amount: 0
    }, sk, sim);
    setDefense(g, u, -10);
    applyStatus(g, u, "slow", 2, actor);
  }
  const allies = g.teams[t].field.filter(u => u && !u.dead),
    pool = lifeRainHealPool(g, actor, t);
  const result = distributeLifeRainPool(g, allies, pool, split, actor, {
    reason: "life-rain",
    effectId: sk?.id || "liferain",
    sim
  });
  log(g, `라이프레인 회복 자원 ${pool}: 실제 회복 ${result.healed}, 남은 ${result.overheal}.`, "heal");
  queueVisual(g, {
    type: "lifeRainFx",
    uid: actor.uid,
    allyUids: allies.map(u => u.uid),
    enemyUids: g.teams[enemy].field.filter(u => u && !u.dead).map(u => u.uid)
  });
  return result.healed;
}
export function iceRoar(g, actor) {
  actor.roarUses = (actor.roarUses || 0) + 1;
  for (const t of ["P", "A"]) for (const u of g.teams[t].field) if (u && !u.dead) applyStatus(g, u, "freeze", 2, actor);
}
export function removeEnergyAmount(u, amount, actorOrder = ["beast", "rider"]) {
  let removed = 0;
  for (const who of actorOrder) {
    let store = energyStore(u, who);
    for (let i = store.length - 1; i >= 0 && removed + 1e-6 < amount; i--) {
      let take = Math.min(store[i].a, amount - removed);
      store[i].a -= take;
      removed += take;
      if (store[i].a < 0.01) store.splice(i, 1);
    }
  }
  return removed;
}
export function removeSelectedEnergyPlan(u, plan) {
  let removed = 0;
  for (const item of plan || []) {
    let left = item.a,
      store = energyStore(u, item.actor);
    for (let i = store.length - 1; i >= 0 && left > 0.001; i--) {
      if (store[i].c !== item.c) continue;
      let take = Math.min(left, store[i].a);
      store[i].a -= take;
      left -= take;
      removed += take;
      if (store[i].a < 0.01) store.splice(i, 1);
    }
  }
  return removed;
}
export function executeRampage(g, actor, target, paid, extra, skill, sim, extraPlan = null) {
  let base = paid.reduce((n, e) => n + e.a, 0),
    removed = extraPlan ? removeSelectedEnergyPlan(actor, extraPlan) : removeEnergyAmount(actor, extra || 0),
    amount = (base + removed) * 10;
  log(g, `${actor.name} 날뛰기: 총 ${base + removed} 에너지 제거, ${amount}D.`);
  return dealDamage(g, actor, target, {
    amount
  }, skill, sim);
}
export function executeLance(g, actor, target, skill, sim) {
  let frozen = status(target, "freeze"),
    amount = 70 + frozen * 30,
    total = dealDamage(g, actor, target, {
      amount
    }, skill, sim);
  delete target.statuses.freeze;
  log(g, `${target.name}: 파쇄창 처리 후 냉동 제거(${frozen}턴).`);
  return total;
}
export function startBloom(g, u) {
  registerScheduledAction(g, u, {
    kind: "bloom",
    evaded: {},
    remaining: 1
  });
  log(g, `${u.name} 효과 · 피어나는생명 대기 중. 다음 자기 차례에 발동.`);
}
export function applyBloomAllocation(g, units, pool, leftAmount = null, source = null, meta = {}) {
  let live = units.filter(x => x && !x.dead && x.hp < x.maxHp);
  if (!live.length) return 0;
  if (live.length === 1 || leftAmount == null) return distributeHealPool(g, live, pool, source, meta);
  let left = Math.max(0, Math.min(pool, Math.round(leftAmount / 10) * 10)),
    right = pool - left,
    got = heal(g, live[0], left, source, meta) + heal(g, live[1], right, source, meta);
  log(g, `피어나는생명 회복 분배: ${live[0].name} ${left}, ${live[1].name} ${right}.`, "heal");
  return got;
}
export function executeBloom(g, t, u, sim = false) {
  let enemies = g.teams[other(t)].field.filter(x => x && !x.dead),
    base = enemies.length ? 320 / enemies.length : 0,
    total = 0,
    sk = firstSkillByEffect(u, "bloomingLife"),
    evaded = u.scheduledAction?.evaded || {},
    evadedCount = enemies.filter(x => evaded[x.uid]?.paid).length;
  u.bloomTargets = (u.bloomTargets || 0) + enemies.length;
  u.bloomEvaded = (u.bloomEvaded || 0) + evadedCount;
  queueBloomVisual(g, enemies, evaded);
  u.scheduledAction = null;
  for (const x of enemies) {
    let amount = base * (evaded[x.uid]?.paid ? 0.5 : 1);
    log(g, `${x.name}: 피어나는생명 분배 ${amount}D${evaded[x.uid]?.paid ? " (코스트 기술 사용으로 절반)" : ""}.`);
    total += dealDamage(g, u, x, {
      amount
    }, sk, sim);
  }
  let pool = Math.max(0, Math.round(total * 0.5 / 10) * 10),
    allies = g.teams[t].field.filter(x => x && !x.dead),
    injured = allies.filter(x => x.hp < x.maxHp),
    missing = injured.reduce((n, x) => n + x.maxHp - x.hp, 0);
  log(g, `피어나는생명 실질 피해 ${total}, 10단위 회복 자원 ${pool}.`, "heal");
  if (pool >= missing || injured.length < 2 || sim || typeof state_ui_battle_state.game === "undefined" || g !== state_ui_battle_state.game || t !== "P" || g.mode !== "human") applyBloomAllocation(g, injured, pool, null, u, {
    reason: "blooming-life",
    effectId: sk?.id || "bloomingLife",
    sim
  });else g.pendingTraitChoices.push({
    kind: "bloomHeal",
    uid: u.uid,
    pool,
    targetUids: injured.slice(0, 2).map(x => x.uid)
  });
}
export function startRubyFollow(g, u, target) {
  let slot = scheduledSlotRef(g, target);
  if (slot.targetSlot < 0) return;
  registerScheduledAction(g, u, {
    kind: "rubyFollow",
    ...slot,
    remaining: 1
  });
  log(g, `${u.name} 효과 · 파이어스톰 ${slot.targetSlot + 1}번 적 슬롯 후속 공격 예약.`);
}
export function executeRubyHit(g, u, target, sim = false) {
  let sk = firstSkillByEffect(u, "firestorm"),
    d = dealDamage(g, u, target, {
      amount: 80
    }, sk, sim);
  if (!target.dead) applyStatus(g, target, "traitSeal", 2, u);
  return d;
}
export function executeScheduled(g, t, s, u, sim = false) {
  const ownsBatch = !g?.damageBatchContext;
  if (ownsBatch) state_engine_combat.DamageBatchOwner.begin(g, `${u?.uid || "scheduled"}:scheduled:${u?.scheduledAction?.scheduledActionId || g?.turnSerial || 0}`);
  try {
    let sch = u.scheduledAction;
    if (!sch) return false;
    if (sch.kind === "voltageBurst") {
      const target = unitAt(g, sch.targetTeam, sch.targetSlot) || findUnit(g, sch.targetUid),
        skill = firstSkillByEffect(u, "circuitVoltageBurst");
      if (sch.remaining > 1) {
        sch.remaining--;
        const done = sch.initialN - sch.remaining;
        queueVisual(g, {
          type: "voltagePrepareFx",
          uid: u.uid,
          rings: done,
          total: sch.initialN
        });
        log(g, `${u.name}: 볼티지버스트 준비 ${done}/${sch.initialN}.`);
        return true;
      }
      resolveVoltageBurst(g, t, u, target, skill, sim);
      return true;
    }
    const scheduledKind = sch.kind;
    if (sch.kind === "bloom") executeBloom(g, t, u, sim);else if (sch.kind === "zigzag") executeZigzag(g, t, u, sim);else {
      let targetTeam = sch.targetTeam || other(t),
        target = Number.isInteger(sch.targetSlot) ? g.teams[targetTeam]?.field[sch.targetSlot] : g.teams[other(t)].field.find(x => x && !x.dead && x.uid === sch.targetUid);
      if (target?.dead) target = null;
      if (!target && sch.kind !== "sweet") {
        log(g, `${u.name}: 예약한 적 슬롯이 비어 있어 후속 공격 불발.`);
        u.scheduledAction = null;
      } else if (sch.kind === "rubyFollow") {
        u.scheduledAction = null;
        executeRubyHit(g, u, target, sim);
      } else if (sch.kind === "delayedAttack") {
        const sk = card(u).skills.find(x => x.id === sch.skillId);
        u.scheduledAction = null;
        if (target && sk) {
          queueVisual(g, {
            type: "marineSkillFx",
            uid: u.uid,
            targetUid: target.uid,
            theme: sk.vfxTheme || "delayedAttack",
            phase: "impact",
            skillName: sk.name
          });
          dealDamage(g, u, target, {
            amount: Number(sch.damage || 0)
          }, sk, sim);
        }
      } else if (sch.kind === "suppressedCurse") {
        resolveSuppressedCurse(g, u, sch, target, sim);
      } else if (sch.kind === "hurricane") {
        if (sch.remaining > 1) {
          sch.remaining--;
          log(g, `${u.name}: 허리케인 다이브 대기, ${sch.remaining}턴 남음.`);
        } else {
          u.scheduledAction = null;
          dealDamage(g, u, target, {
            amount: sch.damage
          }, firstSkillByEffect(u, "hurricaneDive"), sim);
        }
      } else if (sch.kind === "sweet") {
        const sk = firstSkillByEffect(u, "startSequence");
        const slots = sch.targetSlots?.length ? sch.targetSlots : [{
          targetTeam: sch.targetTeam || other(t),
          targetSlot: sch.targetSlot,
          targetUid: sch.targetUid
        }];
        const targets = slots.map(slotRef => {
          const teamId = slotRef.targetTeam || slotRef.team || other(t),
            slotIndex = Number(slotRef.targetSlot ?? slotRef.slot);
          const occupant = Number.isInteger(slotIndex) ? g.teams[teamId]?.field?.[slotIndex] : null;
          return occupant && !occupant.dead ? occupant : null;
        }).filter(Boolean);
        if (!targets.length) {
          log(g, `${u.name}: 예약한 적 슬롯들이 비어 있어 후속 공격 불발.`);
          u.scheduledAction = null;
        } else {
          const actionIdentity = sch.scheduledActionId || `${g.battleId || g.matchId || "battle"}:${g.turnSerial}:${u.uid}:${sk?.id || "scheduled-skill"}:scheduled`;
          queueVisual(g, {
            type: "sugarSwamp",
            uid: u.uid,
            targetUids: targets.map(target => target.uid),
            sourceInstanceId: u.uid,
            sourceTeam: t,
            targetTeam: other(t),
            sourceSlot: s,
            skillId: sk?.id || null,
            actionId: actionIdentity,
            transactionId: sch.effectiveActionSpec?.transactionId || actionIdentity,
            vfxSequenceId: `${actionIdentity}:sugar-swamp:followup:${Number(sch.remaining || 0)}`,
            scheduled: true,
            stageIndex: Number((sch.effectiveActionSpec?.followUpCount || 0) + 1)
          });
          for (const currentTarget of targets) {
            dealDamage(g, u, currentTarget, {
              amount: 30,
              sweetPoisonBonus: true
            }, sk, sim);
            if (!currentTarget.dead) applyStatus(g, currentTarget, "poison", 3, u);
          }
          if (u.scheduledAction) {
            u.scheduledAction.remaining--;
            if (u.scheduledAction.remaining <= 0) u.scheduledAction = null;
          }
        }
      }
    }
    u.lastAction = "scheduled";
    if (scheduledKind === "sweet") u.sequence = u.scheduledAction ? {
      skill: skillIdByEffectGlobal("startSequence"),
      targetTeam: u.scheduledAction.targetTeam,
      targetSlot: u.scheduledAction.targetSlot,
      targetSlots: u.scheduledAction.targetSlots,
      effectiveActionSpec: u.scheduledAction.effectiveActionSpec,
      remaining: u.scheduledAction.remaining
    } : null;
    return true;
  } finally {
    if (ownsBatch) state_engine_combat.DamageBatchOwner.end(g);
  }
}
export function hasNullifyTrait(u) {
  let c = card(u);
  return traitsActive(u) && !!(c.nullifyTrait || c.freezeAbsorb || c.poisonImmune || c.slowImmune || c.immunities?.length);
}
export function memoryOptions(g, t, actor) {
  if (!actor || !firstSkillByTag(actor, "copy") || actor.memoryUsed) return [];
  return (g.teams[t]?.bench || []).filter(unit => unit && !unit.dead && unit.uid !== actor.uid && dmIsDragonCard(card(unit))).map(unit => {
    const sourceCard = card(unit),
      skill = firstSkillOf(sourceCard);
    if (!skill || skillDefHasTag(skill, "copy") || skillDefHasEffect(skill, "iceRoar") || skillDefHasEffect(skill, "rampage") || skillDefHasEffect(skill, "shatterLance")) return null;
    const costVariants = dmMemoryBaseCosts(actor, skill).map(dmAppendMemoryCost);
    return {
      unit,
      card: sourceCard,
      skill,
      cost: costVariants[0],
      costVariants
    };
  }).filter(Boolean);
}
export function collectTargetEnergyEntries(target) {
  if (cardHasCapability(target, "dualActor")) return [...target.beastEnergy.map(e => ({
    ...e,
    actor: "beast"
  })), ...target.riderEnergy.map(e => ({
    ...e,
    actor: "rider"
  }))];
  return target.energy.map(e => ({
    ...e,
    actor: null
  }));
}
export function takeTargetEnergyByPlan(target, amount, plan = null, strictPlan = false) {
  let removed = 0,
    taken = [],
    stores = cardHasCapability(target, "dualActor") ? [["beast", target.beastEnergy], ["rider", target.riderEnergy]] : [[null, target.energy]];
  const takeFrom = (who, store, index, requested) => {
    if (!store?.[index] || removed + 1e-6 >= amount) return 0;
    const take = Math.min(Number(requested || 0), Number(store[index].a || 0), amount - removed);
    if (!(take > 0)) return 0;
    const color = store[index].c;
    store[index].a -= take;
    removed += take;
    taken.push({
      c: color,
      a: take,
      actor: who
    });
    if (store[index].a < 0.01) store.splice(index, 1);
    return take;
  };
  if (plan?.length) for (const pick of plan) {
    const pair = stores.find(([who]) => who === (pick.actor ?? null)),
      store = pair?.[1];
    if (!store) continue;
    const i = store.findIndex(e => e.c === pick.c && e.a + 1e-6 >= Number(pick.a || 0));
    if (i >= 0) takeFrom(pair[0], store, i, Number(pick.a || 0));
    if (removed + 1e-6 >= amount) break;
  }
  if (!strictPlan) for (const [who, store] of stores) for (let i = store.length - 1; i >= 0 && removed + 1e-6 < amount; i--) takeFrom(who, store, i, amount - removed);
  return taken;
}
export function removeTargetEnergyByPlan(target, amount, plan = null) {
  return takeTargetEnergyByPlan(target, amount, plan, false).reduce((sum, item) => sum + item.a, 0);
}
export function restoreTakenEnergy(target, item) {
  const store = cardHasCapability(target, "dualActor") ? item.actor === "rider" ? target.riderEnergy : target.beastEnergy : target.energy;
  store.push({
    c: item.c,
    a: item.a
  });
}
export function transferSelectedTargetEnergy(g, actor, target, plan, count = 1) {
  if (!actor || !target || !Array.isArray(plan) || !plan.length) return 0;
  if (typeof circuitBlocksExternal === "function" && circuitBlocksExternal(target, actor)) {
    log(g, `${target.name} 특성 · 프레그먼트: 에너지 강탈 차단.`);
    return 0;
  }
  const selected = plan.slice(0, Math.max(1, Number(count || 1))),
    requested = selected.reduce((sum, item) => sum + Number(item?.a || 0), 0),
    taken = takeTargetEnergyByPlan(target, requested, selected, true);
  let transferred = 0;
  for (const item of taken) {
    if (grantEnergyWithDiscard(g, actor, item.c, item.a)) transferred += item.a;else restoreTakenEnergy(target, item);
  }
  if (transferred > 0) {
    actor.energyDisrupt = Number(actor.energyDisrupt || 0) + transferred;
    notifyReactiveEnergyMutation(g, target, false, "에너지 강탈됨");
    notifyReactiveEnergyMutation(g, actor, true, "에너지 강탈");
    log(g, `${actor.name}: ${target.name}에게서 선택한 에너지 ${energyAmountText(transferred)} 강탈.`);
  }
  return transferred;
}
export function executeMysticBurst(g, actor, target, skill, ctx) {
  let x = ctx?.action?.extraColors || ctx.extraColors || {
      R: 0,
      W: 0,
      B: 0
    },
    extraPaid = spendReq(actor, {
      R: x.R,
      W: x.W,
      B: x.B,
      any: 0,
      wb: 0
    }),
    amount = 100 + 30 * x.R;
  log(g, `${actor.name}: 미스틱버스트 추가 에너지 ${extraPaid.map(e => e.c).join("") || "없음"} 지불.`);
  let d = dealDamage(g, actor, target, {
      amount
    }, skill, ctx.sim),
    healed = heal(g, actor, 50 * x.W, actor, {
      reason: "mystic-burst",
      effectId: skill?.id || "mysticBurst",
      sim: ctx.sim
    }),
    rolls = [];
  for (let i = 0; i < x.B && !target.dead; i++) {
    let pool = ["burn", "paralyze", "freeze", "poison", "slow", "traitSeal"],
      st = ctx.sim ? "slow" : g.rng.pick(pool),
      ok = applyStatus(g, target, st, 2, actor);
    rolls.push({
      status: st,
      ok
    });
  }
  queueVisual(g, {
    type: "mysticBurst",
    uid: actor.uid,
    targetUid: target.uid,
    extraR: x.R,
    extraW: x.W,
    extraB: x.B,
    healed,
    healBlocked: x.W > 0 && healed === 0,
    rolls
  });
  return d;
}
export function executeMutualEnergyTrade(g, actor, target, effect, skill, ctx) {
  let action = ctx?.action || ctx,
    requested = Math.max(0, Math.min(action.interactionAmount || 0, allEnergy(target))),
    actionIdentity = String(action?.actionId || action?.commandId || `${g.battleId || g.matchId || "battle"}:${g.turnSerial}:${actor.uid}:${effect?.type || "energy-trade"}`);
  state_engine_combat.CompositeDamagePresentationOwner.begin(g, {
    id: `${actionIdentity}:${effect?.type || "energy-trade"}`,
    skillId: skill?.id || null,
    sourceInstanceId: actor.uid
  });
  g.deferWinner = true;
  let attack = dealDamage(g, actor, target, {
      amount: Number(effect?.baseDamage || 0),
      compositeDamageGroupId: `${actionIdentity}:${effect?.type || "energy-trade"}`
    }, skill, ctx.sim),
    removed = removeTargetEnergyByPlan(target, requested, action.interactionPlan),
    selfDirect = Number(effect?.selfDamagePerEnergy ?? effect?.perEnergyDamage ?? 0) * removed,
    enemyDirect = Number(effect?.perEnergyDamage ?? 0) * removed;
  actor.energyDisrupt += removed;
  const sourceLabel = skill?.name || "에너지 교환",
    selfDamage = applyShieldFirstFixedDamage(g, actor, selfDirect, `${sourceLabel} 반동`),
    enemyDamage = applyShieldFirstFixedDamage(g, target, enemyDirect, sourceLabel),
    selfLoss = selfDamage.hpLoss,
    enemyLoss = enemyDamage.hpLoss;
  g.deferWinner = false;
  checkDeath(g, actor, target);
  checkDeath(g, target, actor);
  checkWinner(g);
  log(g, `${skill?.name || "기술"}: 에너지 ${removed} 제거, ${actor.name} 피해 ${selfDamage.applied}, ${target.name} 피해 ${enemyDamage.applied}.`);
  const compositePresentation = state_engine_combat.CompositeDamagePresentationOwner.end(g);
  queueVisual(g, {
    type: "mutualEnergyTrade",
    uid: actor.uid,
    targetUid: target.uid,
    amount: removed,
    selfLoss,
    enemyLoss,
    selfTotal: Number(compositePresentation?.totals?.[actor.uid] || selfDamage.applied || 0),
    enemyTotal: Number(compositePresentation?.totals?.[target.uid] || attack + enemyDamage.applied || 0),
    compositeDamageGroupId: compositePresentation?.id || null,
    componentEventIds: (compositePresentation?.events || []).map(event => event.eventId).filter(Boolean),
    selfShieldLoss: selfDamage.shieldLoss,
    enemyShieldLoss: enemyDamage.shieldLoss
  });
  return attack + enemyDamage.applied;
}
export function activateFullInvulnerabilityUntilOwnTurn(g, actor, sourceName = "무적") {
  if (!actor || actor.dead) return false;
  actor.fullInvulnerableUntilOwnTurn = true;
  log(g, `${actor.name}: ${sourceName} · 다음 자기 차례 시작 전까지 모든 피해 무효.`);
  queueCombatNotice(g, actor, "전 피해 무적", "immune");
  return true;
}
export function effectApply(g, actor, target, e, skill, ctx) {
  switch (e.type) {
    case 'suppressedCurse':
    case 'graveDown':
      return applyWellerEffect(g, actor, target, e, skill, ctx);
    case "mysticBurst":
      return executeMysticBurst(g, actor, target, skill, ctx);
    case "mutualEnergyTrade":
      return executeMutualEnergyTrade(g, actor, target, e, skill, ctx);
    case "suctionPad":
    case "eternaHeal":
    case "toxiousUnseal":
    case "groundZero":
    case "dustWave":
    case "abyssCannon":
      return applyDeepSeaEffect(g, actor, target, e, skill, ctx);
    case "abyssVortex":
    case "junglesVineWhip":
    case "circuitRoundKick":
    case "circuitArmsBlade":
    case "circuitVoltageBurst":
      return applySummonEffect(g, actor, target, e, skill, ctx);
    case "foxStrike":
      return applyStrikeEffect(g, actor, target, e, skill, ctx);
    case "elixianShiningWind":
    case "elixianAromaField":
    case "elixianMultiArrow":
    case "elixianLastGift":
      return applyResonanceEffect(g, actor, target, e, skill, ctx);
    case "genociderSlashClaw":
    case "genociderDisplosion":
      return applyReactiveEnergyEffect(g, actor, target, e, skill, ctx);
    case "timeRecall":
    case "hyperClock":
      return applyClockEffect(g, actor, target, e, skill, ctx);
    case "bossTimeStrike":
      return dealDamage(g, actor, target, {
        amount: Number(ctx?.action?.bossTimeStrikeDamage || 40)
      }, skill, ctx.sim);
    case "masterTailwind":
      {
        let gained = 0;
        for (let i = 0; i < Number(e.count || 3); i++) {
          const result = state_engine_effects.ENERGY_GAIN_SERVICE.grant({
            game: g,
            recipient: actor,
            team: ctx.team,
            actor: null,
            source: "master-tailwind",
            candidates: ["R", "W", "B"],
            amount: 1
          });
          if (result.gained) gained++;
        }
        log(g, `${actor.name}: 순풍으로 무작위 에너지 ${gained}개 획득.`);
        return gained;
      }
    case "randomMultiHit":
      {
        const range = state_catalog_cards.PlusStarModifierOwner.hitRange(actor, skill) || (Array.isArray(e.hitRange) ? e.hitRange : [1, 1]);
        const hits = ctx.sim ? Math.round((range[0] + range[1]) / 2) : g.rng.int(range[0], range[1]);
        if (skill?.vfxTheme === "leafBlade") {
          const actionIdentity = ctx.action?.actionId || ctx.action?.commandId || `${g.battleId || g.matchId || "battle"}:${g.turnSerial}:${actor.uid}:${skill?.id || "randomMultiHit"}:${target?.uid || "none"}`;
          queueVisual(g, {
            type: "leafBlade",
            uid: actor.uid,
            targetUid: target?.uid || null,
            sourceInstanceId: actor.uid,
            targetInstanceId: target?.uid || null,
            sourceTeam: ctx.team,
            targetTeam: other(ctx.team),
            sourceSlot: ctx.slot,
            targetSlot: ctx.action?.target?.slot ?? null,
            skillId: skill?.id || null,
            actionId: actionIdentity,
            transactionId: ctx.action?.commandId || actionIdentity,
            vfxSequenceId: `${actionIdentity}:leaf-blade`,
            hitCount: hits
          });
        }
        return dealDamage(g, actor, target, {
          amount: Number(e.amount || 0),
          hits
        }, skill, ctx.sim);
      }
    case "orbVolley":
      {
        /* 구체를 한 발씩 날린다. 발마다 따로 상태이상 판정을 하고, 걸린 구체는 그 상태의 색으로 날아간다.
           판정은 연출(구체 색)과 실제 적용이 같은 결과를 쓰도록 먼저 모두 굴린 뒤 한 번에 넘긴다. */
        const hits = Math.max(1, Math.trunc(Number(e.hits || 1))),
          outcomes = Array.isArray(e.outcomes) ? e.outcomes : [],
          rolls = Array.from({
            length: hits
          }, () => !ctx.sim && outcomes.length && g.rng.next() < Number(e.chance || 0) ? outcomes[g.rng.int(0, outcomes.length - 1)] : null);
        if (!ctx.sim) {
          const actionIdentity = ctx.action?.actionId || ctx.action?.commandId || `${g.battleId || g.matchId || "battle"}:${g.turnSerial}:${actor.uid}:${skill?.id || "orbVolley"}:${target?.uid || "none"}`;
          queueVisual(g, {
            type: "orbVolley",
            uid: actor.uid,
            targetUid: target?.uid || null,
            sourceInstanceId: actor.uid,
            targetInstanceId: target?.uid || null,
            sourceTeam: ctx.team,
            targetTeam: other(ctx.team),
            sourceSlot: ctx.slot,
            targetSlot: ctx.action?.target?.slot ?? null,
            skillId: skill?.id || null,
            actionId: actionIdentity,
            transactionId: ctx.action?.commandId || actionIdentity,
            vfxSequenceId: `${actionIdentity}:orb-volley`,
            orbs: rolls.map(roll => roll?.kind || "plain")
          });
        }
        let total = 0;
        for (const roll of rolls) {
          if (actor.dead || target.dead) break;
          total += dealDamage(g, actor, target, {
            amount: Number(e.amount || 0),
            hits: 1
          }, skill, ctx.sim);
          if (!roll || target.dead) continue;
          if (roll.status) applyStatus(g, target, roll.status, roll.duration, actor);
          else if (roll.defense) setDefense(g, target, Number(roll.defense));
        }
        return total;
      }
    case "horizonStrike":
      {
        const actionIdentity = ctx.action?.actionId || ctx.action?.commandId || `${g.battleId || g.matchId || "battle"}:${g.turnSerial}:${actor.uid}:${skill?.id || "horizon"}:${target?.uid || "none"}`;
        const vfxSequenceId = `${actionIdentity}:horizon-strike`;
        queueVisual(g, {
          type: "horizonStrike",
          uid: actor.uid,
          targetUid: target?.uid || null,
          sourceInstanceId: actor.uid,
          targetInstanceId: target?.uid || null,
          sourceTeam: ctx.team,
          targetTeam: other(ctx.team),
          sourceSlot: ctx.slot,
          targetSlot: ctx.action?.target?.slot ?? null,
          skillId: skill?.id || null,
          actionId: actionIdentity,
          transactionId: ctx.action?.commandId || actionIdentity,
          vfxSequenceId,
          element: e.element || "sun",
          status: e.status,
          skillName: skill?.name || ""
        });
        const total = dealDamageSequence(g, actor, target, [40, 100], skill, ctx.sim, {
          vfxSequenceId
        });
        if (!target.dead) applyStatus(g, target, e.status, 2, actor, {
          vfxSequenceId,
          horizonStatus: true
        });
        return total;
      }
    case "lunaShard":
      {
        const enemyTeam = other(ctx.team),
          targets = g.teams[enemyTeam].field.filter(x => x && !x.dead);
        const energySnapshot = new Map(targets.map(x => [x.uid, allEnergy(x)]));
        const actionIdentity = ctx.action?.actionId || ctx.action?.commandId || `${g.battleId || g.matchId || "battle"}:${g.turnSerial}:${actor.uid}:${skill?.id || "lunaShard"}`;
        queueVisual(g, {
          type: "lunaShard",
          uid: actor.uid,
          targetUids: targets.map(x => x.uid),
          sourceInstanceId: actor.uid,
          sourceTeam: ctx.team,
          targetTeam: enemyTeam,
          sourceSlot: ctx.slot,
          skillId: skill?.id || null,
          actionId: actionIdentity,
          transactionId: ctx.action?.commandId || actionIdentity,
          vfxSequenceId: `${actionIdentity}:luna-shard`
        });
        let total = 0;
        for (const enemy of targets) {
          const amount = Math.max(0, 80 - 20 * Number(energySnapshot.get(enemy.uid) || 0));
          total += dealDamage(g, actor, enemy, {
            amount
          }, skill, ctx.sim);
          setAttack(g, enemy, -10);
        }
        return total;
      }
    case "randomScaledDamage":
      {
        const lo = Math.max(1, Math.floor(Number(e.minMultiplier ?? 1))),
          hi = Math.max(lo, Math.floor(Number(e.maxMultiplier ?? lo))),
          multiplier = ctx.sim ? (lo + hi) / 2 : g.rng.int(lo, hi),
          amount = Number(e.amount || 0) * multiplier;
        log(g, `${actor.name}: ${skill?.name || "기술"} 배수 ×${multiplier} → ${amount}D.`);
        return dealDamage(g, actor, target, {
          amount
        }, skill, ctx.sim);
      }
    case "hpLossBlast":
      {
        const loss = Math.max(0, Number(actor.turnEndHp ?? actor.hp) - Number(actor.hp));
        log(g, `${actor.name}: ${skill?.name || "기술"} · 이전 차례 끝 HP ${actor.turnEndHp ?? actor.hp} → 현재 HP ${actor.hp}, 피해 ${loss}D.`);
        if (!(loss > 0)) return 0;
        return dealDamage(g, actor, target, {
          amount: loss
        }, skill, ctx.sim);
      }
    case "damage":
      {
        const dealt = dealDamage(g, actor, target, e, skill, ctx.sim);
        /* 반동: 실제로 가한 피해량의 일정 비율을 자신도 받는다(고정 피해). */
        if (e.recoilFraction > 0 && dealt > 0 && !actor.dead) nonAttackDamage(g, actor, Math.round(dealt * e.recoilFraction), `${skill.name} 반동`);
        return dealt;
      }
    case "proportionalDamage":
      return dealProportionalDamage(g, actor, target, e.basis, e.ratio, skill, ctx.sim);
    case "firstBurst":
      {
        let d = dealProportionalDamage(g, actor, target, "max", 0.33, skill, ctx.sim),
          ally = g.teams[ctx.team].field.find(x => x && !x.dead && x.uid !== actor.uid);
        heal(g, actor, d / 2, actor, {
          reason: "first-burst",
          effectId: skill?.id || "firstBurst",
          sim: ctx.sim
        });
        if (ally) heal(g, ally, d / 2, actor, {
          reason: "first-burst",
          effectId: skill?.id || "firstBurst",
          sim: ctx.sim
        });
        return d;
      }
    case "heal":
      return heal(g, target, e.amount, actor, {
        reason: "skill-heal",
        effectId: skill?.id || e.type,
        sim: ctx.sim
      });
    case "selfHeal":
      return heal(g, actor, e.amount, actor, {
        reason: "self-heal",
        effectId: skill?.id || e.type,
        sim: ctx.sim
      });
    case "attackMod":
      return setAttack(g, e.target === "self" ? actor : target, Number(e.amount || 0));
    case "defenseMod":
      return setDefense(g, e.target === "self" ? actor : target, Number(e.amount || 0));
    case "fullInvulnerableUntilOwnTurn":
      return activateFullInvulnerabilityUntilOwnTurn(g, actor, skill?.name || "무적");
    case "queuedSkillCostReduction":
      actor.queuedSkillCostReduction = Math.max(Number(actor.queuedSkillCostReduction || 0), Number(e.amount || 0));
      log(g, `${actor.name}: 다음 자기 차례 기술 코스트 ${e.amount} 감소 예약.`);
      return e.amount;
    case "repeatStatus":
      if (actor.lastAction === "skill" && actor.lastSkill === e.previousSkill && !target.dead) return applyStatus(g, target, e.status, e.duration, actor);
      return false;
    case "extraEnergyHeal":
      {
        const explicit = Array.isArray(ctx.extraEnergyPlan) ? ctx.extraEnergyPlan : null;
        let paid = [];
        if (explicit) {
          const req = {
            R: 0,
            W: 0,
            B: 0,
            any: 0,
            wb: 0
          };
          for (const item of explicit) if (item && req[item.c] != null) req[item.c] += Number(item.a || 0);
          paid = spendReq(actor, req);
        } else {
          paid = spendReq(actor, {
            R: 0,
            W: 0,
            B: 0,
            any: Number(ctx.action?.extraEnergyAmount || 0),
            wb: 0
          });
        }
        const amount = paid.reduce((sum, item) => sum + Number(item.a || 0), 0);
        const healed = heal(g, actor, amount * Number(e.amountPerEnergy || 0), actor, {
          reason: "extra-energy-heal",
          effectId: skill?.id || e.type,
          sim: ctx.sim
        });
        log(g, `${actor.name}: 추가 에너지 ${energyAmountText(amount)} 투입 → HP ${healed} 회복.`);
        return healed;
      }
    case "selectedEnergyTransfer":
      return transferSelectedTargetEnergy(g, actor, target, ctx.action?.interactionPlan, e.count || 1);
    case "removeEnergyAmount":
      {
        let left = Math.max(0, Number(e.amount || 0)),
          removed = 0;
        while (left > 1e-6) {
          const got = removeEnergy(g, target, left, actor);
          if (!(got > 0)) break;
          removed += got;
          left -= got;
        }
        return removed;
      }
    case "delayedAttack":
      {
        if (e.invulnerable) activateFullInvulnerabilityUntilOwnTurn(g, actor, skill?.name || "무적");
        const slot = scheduledSlotRef(g, target);
        registerScheduledAction(g, actor, {
          kind: "delayedAttack",
          ...slot,
          remaining: 1,
          damage: Number(e.amount || 0),
          skillId: skill?.id || null
        });
        log(g, `${actor.name}: ${skill.name} 예약. 다음 자기 차례에 ${e.amount}D.`);
        return 0;
      }
    case "thresholdCritical":
      {
        const critical = Number(target.hp || 0) <= Number(target.maxHp || 0) * Number(e.threshold || 0);
        const dealt = critical ? applyCriticalAttack(g, actor, target, Number(e.amount || 0), skill, ctx.sim, "HP 1/4 이하") : dealDamage(g, actor, target, {
          amount: Number(e.amount || 0)
        }, skill, ctx.sim);
        if (Number(e.recoil || 0) > 0 && !actor.dead) nonAttackDamage(g, actor, Number(e.recoil || 0), `${skill.name} 반동`);
        return dealt;
      }
    case "allOrNothingCritical":
      {
        const chance = Math.max(0, Math.min(1, Number(e.criticalChance || 0)));
        if (ctx.sim) {
          if (blocksCriticalAttack(target)) return 0;
          const normalEstimate = damageRange(g, actor, target, {
              amount: Number(e.amount || 0)
            }, skill).mean,
            criticalEstimate = damageRange(g, actor, target, {
              amount: Number(e.amount || 0),
              forceCritical: true
            }, skill).mean,
            normalDefeats = attackPacketWouldDefeatTarget(g, target, Math.round(normalEstimate), {}),
            criticalDefeats = attackPacketWouldDefeatTarget(g, target, Math.round(criticalEstimate), {}),
            evadeChance = attackEvasionChance(target, g),
            defeatChance = (1 - evadeChance) * ((normalDefeats ? 1 - chance : 0) + (criticalDefeats ? chance : 0));
          if (defeatChance >= 1 - 1e-9) return applyCriticalAttack(g, actor, target, Number(e.amount || 0), skill, true, `${Math.round(chance * 100)}% 판정`, {
            failUnlessDefeat: true
          });
          if (!(defeatChance > 0)) return 0;
          const survive = 1 - defeatChance,
            oldHp = Number(target.hp || 0),
            beforeDurability = oldHp + Number(target.shield || 0) + (target.hpProtectionBarriers || []).reduce((sum, layer) => sum + Math.max(0, Number(layer?.amount || 0)), 0);
          target.hp = oldHp * survive;
          target.shield = Number(target.shield || 0) * survive;
          for (const layer of target.hpProtectionBarriers || []) layer.amount = Math.max(0, Number(layer?.amount || 0) * survive);
          afterBodyHpChange(g, target, oldHp);
          const afterDurability = Number(target.hp || 0) + Number(target.shield || 0) + (target.hpProtectionBarriers || []).reduce((sum, layer) => sum + Math.max(0, Number(layer?.amount || 0)), 0);
          return Math.max(0, beforeDurability - afterDurability);
        }
        const critical = g.rng.next() < chance;
        if (critical) return applyCriticalAttack(g, actor, target, Number(e.amount || 0), skill, false, `${Math.round(chance * 100)}% 판정`, {
          failUnlessDefeat: true
        });
        return dealDamage(g, actor, target, {
          amount: Number(e.amount || 0),
          failUnlessDefeat: true
        }, skill, false);
      }
    case "shield":
      return createShield(g, target, e.amount, e.max);
    case "selfShield":
      return createShield(g, actor, e.amount, e.max);
    case "defense":
      {
        let old = target.defense;
        target.defenseMod = Math.min((e.max ?? 99) - target.baseDefense, target.defenseMod + e.amount);
        target.defense = target.baseDefense + target.defenseMod;
        log(g, `${target.name} 방어 ${old} → ${target.defense}.`);
        break;
      }
    case "selfDefense":
      {
        let old = actor.defense;
        actor.defenseMod = Math.min((e.max ?? 99) - actor.baseDefense, actor.defenseMod + e.amount);
        actor.defense = actor.baseDefense + actor.defenseMod;
        log(g, `${actor.name} 방어 ${old} → ${actor.defense}.`);
        break;
      }
    case "status":
      return applyStatus(g, e.target === "self" ? actor : target, e.status, e.duration, actor);
    case "statusChance":
      {
        let ok = ctx.sim ? e.chance >= 0.5 : g.rng.next() < e.chance;
        log(g, `${state_engine_entities.STATUS[e.status]} 판정 ${ok ? "성공" : "실패"} (${Math.round(e.chance * 100)}%).`);
        if (ok) return applyStatus(g, target, e.status, e.duration, actor);
        break;
      }
    case "colorAll":
      return changeEnergyColor(g, target, e.color, true, actor);
    case "colorOne":
      return changeEnergyColor(g, target, e.color, false, actor);
    case "removeEnergy":
      return removeEnergy(g, target, e.amount, actor);
    case "removeAllEnergy":
      {
        /* 에너지를 전부 제거한다. 자신은 외부 제거가 아니므로 막힘 없이 비우고, 상대는 일반 제거 경로(프레그먼트 차단 등)를 따른다. */
        const who = e.target === "self" ? actor : target;
        if (e.target === "self") return clearAllEnergy(actor);
        let removed = 0;
        for (let guard = 0; guard < 64 && who.energy.length; guard++) {
          const got = removeEnergy(g, who, 99, actor);
          if (!(got > 0)) break;
          removed += got;
        }
        return removed;
      }
    case "hpBarrier":
      return addHpProtectionBarrier(g, target, Number(e.amount || 0), actor.uid, "standard", {
        decayPerTurn: e.decayPerTurn
      });
    case "clearFieldEnergy":
      return clearFieldEnergy(g, actor);
    case "cleanse":
      return clearStatuses(g, target, actor);
    case "nextHitReduction":
      target.hideHits = Math.min(2, e.hits);
      log(g, `${target.name} 효과 · 모래숨기 ${target.hideHits}회.`);
      break;
    case "startSequence":
      {
        const spec = ctx?.effectiveActionSpec || ctx?.action?.effectiveActionSpec || null;
        const slots = (spec?.targetSlots?.length ? spec.targetSlots : target ? [scheduledSlotRef(g, target)] : []).filter(slot => Number.isInteger(Number(slot?.slot))).map(slot => Object.freeze({
          targetTeam: slot.targetTeam || slot.team || other(ctx.team),
          targetSlot: Number(slot.targetSlot ?? slot.slot),
          targetUid: slot.targetUid || slot.uid || null
        }));
        if (slots.length) {
          const primary = slots[0];
          const effectiveActionSpec = spec || state_catalog_cards.PlusStarModifierOwner.actionSpec(g, ctx.team, ctx.slot, actor, skill, ctx.action, [target]);
          actor.sequence = {
            skill: skillIdByEffectGlobal("startSequence"),
            ...primary,
            targetSlots: slots,
            effectiveActionSpec,
            remaining: e.remaining
          };
          registerScheduledAction(g, actor, {
            kind: "sweet",
            ...primary,
            targetSlots: slots,
            effectiveActionSpec,
            remaining: e.remaining
          });
          log(g, `${actor.name} 효과 · 슈가스웜프 후속 공격 ${e.remaining}회 예약 (${slots.length}개 슬롯).`);
        }
        break;
      }
    case "selfDamage":
      return nonAttackDamage(g, actor, e.amount, "자해");
    case "slotTrap":
      g.teams[other(ctx.team)].traps[ctx.slot] = {
        status: e.status,
        duration: e.duration,
        owner: actor.uid
      };
      log(g, `${other(ctx.team) === "P" ? "플레이어" : "AI"} 슬롯 ${ctx.slot + 1}에 전기태클 설치.`);
      break;
    case "transferPaidEnergy":
      {
        let pe = ctx.paid[0];
        if (pe && totalEnergy(target) + 1 <= (card(target).maxEnergy || 4)) {
          gainEnergy(g, target, pe.c, 1);
          log(g, `${actor.name} → ${target.name}: ${pe.c} 에너지 1 전달.`);
        }
        break;
      }
    case "shift":
      return shiftDamage(g, actor, target, e.amount);
    case "lifeRain":
      return lifeRain(g, actor, ctx.team, ctx.split, ctx.sim);
    case "iceRoar":
      return iceRoar(g, actor);
    case "rampage":
      return executeRampage(g, actor, target, ctx.paid, ctx.extra, skill, ctx.sim, ctx.extraEnergyPlan);
    case "shatterLance":
      return executeLance(g, actor, target, skill, ctx.sim);
    case "bloomingLife":
      return startBloom(g, actor);
    case "flameWing":
      actor.fireWingUntil = actor.turns + 1;
      log(g, `${actor.name} 효과 · 화염날개: 다음 자기 차례 전까지 공격 피해 무효.`);
      break;
    case "firestorm":
      {
        let d = executeRubyHit(g, actor, target, ctx.sim);
        if (!actor.dead) startRubyFollow(g, actor, target);
        return d;
      }
    case "prawnCharge":
      return dealDamage(g, actor, target, {
        amount: hasNullifyTrait(target) ? 160 : 120
      }, skill, ctx.sim);
    case "holyFlame":
      {
        let n = allEnergy(target),
          amount = Math.max(0, 100 - 20 * n),
          recovery = 100 - amount,
          d = dealDamage(g, actor, target, {
            amount
          }, skill, ctx.sim),
          healTarget = ctx.healTarget || actor;
        heal(g, healTarget, recovery, actor, {
          reason: "holy-flame",
          effectId: skill?.id || "holyFlame",
          sim: ctx.sim
        });
        return d;
      }
    case "lightCandelabra":
      return lightCandelabra(g, actor, target, ctx.paid, ctx, skill);
    case "grandField":
      {
        const result = createGrandField(g, actor, ctx.team, target, skill, ctx.sim, e);
        syncAromaCombatFlags(g);
        return result;
      }
    case "zigzagExcavate":
      return startZigzag(g, actor);
    case "hurricaneDive":
      {
        let amount = 30 + 70 * (ctx.extraW || 0);
        if (ctx.extraW) {
          registerScheduledAction(g, actor, {
            kind: "hurricane",
            ...scheduledSlotRef(g, target),
            remaining: ctx.extraW,
            damage: amount
          });
          log(g, `${actor.name} 효과 · 허리케인 다이브 ${ctx.extraW}턴 대기, ${amount}D 예약.`);
          return 0;
        }
        return dealDamage(g, actor, target, {
          amount
        }, skill, ctx.sim);
      }
  }
}
/* Phase 9: result pipelines keep post-processing iterative instead of nesting public owners. */

import { state_runtime_transactions } from "../runtime/transactions.js";
import { battleActionConstraintsMet } from './entities.js';
import { statusTicksThisTurn } from './status-rules.js';
import { state_runtime_entities } from "../runtime/entities.js";
import { state_runtime_state } from "../runtime/state.js";
import { isNonAttackSkill } from "../app/controls.js";
import { effectiveSkillCost, effectiveSkillTarget, skillRequirementsMet, state_catalog_cards } from "../catalog/cards.js";
import { effectApply, legalActions, other, prepareCurrentTurn, unitAt, state_engine_actions } from "./actions.js";
import { applyStatus, checkDeath, clearOwnedField, findUnit, heal, nonAttackDamage, queueSkillVisual, queueVisual, traitsActive, state_engine_combat } from "./combat.js";
import { beginScheduledActionExecution, completeScheduledActionExecution, consumeNaturalGatherProposal, executeScheduled, naturalColors } from "./effects.js";
import { aliveUnits, bestEnergyReplacementPlan, canPayAction, canPayReq, canSwitch, energyStore, energyValue, findPaymentPlan, gainEnergy, initializeDeployment, parseCost, reqAcceptsCounts, requestTraitEnergy, spendAction, spendFrom, spendPaymentPlan, spendReq, status, switchCost, totalEnergy, state_engine_energy } from "./energy.js";
import { actionFaultHit, card, cardCapability, cardHasCapability, skillDefHasEffect, skillDefHasRuntimeKind, skillDefHasTag, skillsOf, state_engine_entities } from "./entities.js";
import { triggerDeepMind } from "../features/character-rules.js";
import { syncAromaCombatFlags } from "../features/elixian.js";
import { reactiveEnergyRule, syncReactiveEnergyMaxHp } from "../features/genocider.js";
import { processJunglesSummons, targetRef } from "../features/summons.js";
import { executeTimeAction } from "../features/timeora.js";
import { state_online_commands } from "../online/commands.js";
import { log, queueCombatNotice } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
export function revealUnit(g, t, u) {
  if (u && !g.revealed[t].includes(u.uid)) {
    g.revealed[t].push(u.uid);
    g.publicHistory.push({
      type: "reveal",
      team: t,
      uid: u.uid,
      card: u.card
    });
  }
}
export function deployCharacter(g, t, s, uid) {
  const resonancePending = !!g?.teams?.[t]?.pendingElixianResonance?.[s];
  const tm = g?.teams?.[t];
  if (!g || !tm || !Array.isArray(tm.field) || !Array.isArray(tm.bench) || !Array.isArray(tm.graveyard) || !Number.isInteger(s) || s < 0 || s >= tm.field.length || typeof uid !== "string") return false;
  const current = g.order?.[g.turn];
  if (!current || current[0] !== t || current[1] !== s) return false;
  const matches = tm.bench.map((unit, index) => unit?.uid === uid ? {
    unit,
    index
  } : null).filter(Boolean);
  if (matches.length !== 1) return false;
  const {
    unit: incoming,
    index
  } = matches[0];
  if (!incoming) return false;
  for (const teamId of Object.keys(g.teams || {})) {
    const field = g.teams[teamId]?.field;
    if (Array.isArray(field) && field.some(unit => unit?.uid === uid)) return false;
  }
  const occupant = tm.field[s];
  if (occupant && !occupant.dead) return false;
  if (g.bossRaid?.online && t === "P") {
    const slotOwner = g.bossRaid.slotOwners?.[s];
    if (!slotOwner || incoming.bossOwner !== slotOwner) return false;
  }
  if (occupant?.dead) tm.graveyard.push(occupant);
  const u = tm.bench.splice(index, 1)[0];
  tm.field[s] = u;
  initializeDeployment(g, u);
  revealUnit(g, t, u);
  log(g, `${t === "P" ? "플레이어" : "AI"} 슬롯 ${s + 1}: ${u.name} 출전.`);
  let trap = tm.traps[s];
  if (trap) {
    applyStatus(g, u, trap.status, trap.duration, findUnit(g, trap.owner));
    tm.traps[s] = null;
    log(g, `전기태클 발동 후 소멸.`);
  }
  const deployed = unitAt(g, t, s);
  if (resonancePending && deployed && !deployed.dead) {
    deployed.elixianResonance = true;
    g.teams[t].pendingElixianResonance[s] = false;
    log(g, `${deployed.name}: 엘릭시안의 잔향을 이어받아 자기 차례 시작마다 HP 10을 영구 회복한다.`);
    queueVisual(g, {
      type: "elixianPulseFx",
      uid: deployed.uid,
      resonance: true
    });
  }
  syncAromaCombatFlags(g);
  return true;
}
export function switchCharacter(g, t, s, bi) {
  let tm = g.teams[t],
    out = tm.field[s],
    incoming = tm.bench[bi];
  if (!incoming) return;
  clearOwnedField(g, out, "후퇴");
  if (cardHasCapability(out, "eclipse")) out.eclipseEligible = false;
  if (out.sequence || out.scheduledAction) {
    out.sequence = null;
    out.scheduledAction = null;
    log(g, `${out.name}: 필드를 떠나 예약 효과 취소.`);
  }
  tm.bench[bi] = out;
  tm.field[s] = incoming;
  initializeDeployment(g, incoming);
  revealUnit(g, t, incoming);
  out.switches++;
  out.lastTarget = null;
  g.dualActorController = null;
  log(g, `${out.name} 후퇴, ${incoming.name} 출전.`);
  let trap = tm.traps[s];
  if (trap) {
    applyStatus(g, incoming, trap.status, trap.duration, findUnit(g, trap.owner));
    tm.traps[s] = null;
    log(g, `전기태클 발동 후 소멸.`);
  }
  syncAromaCombatFlags(g);
}
export function recordPaidSkill(g, t, u, paid) {
  if (state_engine_actions.timeFeatureReady && u) u._timePaidRecord = {
    turnSerial: g.turnSerial,
    amount: (paid || []).reduce((n, e) => n + Number(e?.a || 0), 0),
    paid: (paid || []).map(e => ({
      ...e
    }))
  };
  if (!paid.length) return;
  for (const aw of g.teams[other(t)].field) if (aw && !aw.dead && aw.scheduledAction?.kind === "bloom") aw.scheduledAction.evaded[u.uid] = {
    paid: true
  };
}
export function advanceDualOrEnd(g, t, s, u, usedSkill, switched = false) {
  if (g?._timeDeferTurnAdvance && !g?._timeCommittingTurnAdvance) {
    g.pendingClockTurnAdvance = {
      teamId: t,
      slotIndex: s,
      actorEntityId: u?.entityId || u?.uid || null,
      usedSkill: !!usedSkill,
      switched: !!switched,
      requestedAt: performance.now(),
      turnSerial: Number(g.turnSerial || 0)
    };
    return;
  }
  if (cardHasCapability(u, "dualActor") && !switched && state_engine_energy.dualActorController.current(g, u) === "beast" && !u.dead && unitAt(g, t, s)?.uid === u.uid) {
    u.dualUsedSkill = !!(u.dualUsedSkill || usedSkill);
    state_engine_energy.dualActorController.toRider(g, u);
    log(g, `${u.name}: 빙마 행동 종료 → 기수 행동 시작.`, "turn");
    return;
  }
  let used = !!(usedSkill || u.dualUsedSkill);
  u.dualUsedSkill = false;
  endTurn(g, t, s, used);
}
export function executeCoreBase(g, t, s, a, {
  sim = false
} = {}) {
  if (a?.type === "noLegalPass") {
    const current = g.order?.[g.turn];
    if (!current || current[0] !== t || Number(current[1]) !== Number(s)) return false;
    if (legalActions(g, t, s).length !== 0) return false;
    log(g, `${unitAt(g, t, s)?.name || "빈 슬롯"}: 가능한 행동이 없어 턴을 자동으로 넘김.`, "turn");
    return endTurn(g, t, s, false) !== false;
  }
  if (a?.type === "deploy") {
    const current = g.order?.[g.turn];
    if (!current || current[0] !== t || current[1] !== s || typeof a.unit !== "string") return false;
    const deployed = deployCharacter(g, t, s, a.unit);
    if (!deployed) return false;
    endTurn(g, t, s, false);
    return true;
  }
  const preUnit = unitAt(g, t, s);
  if (preUnit && !preUnit.dead && preUnit.speedDelayTurns > 0 && a?.type !== "speedDelay") return false;
  if (a?.type === "speedDelay") {
    if (!preUnit || preUnit.dead || preUnit.speedDelayTurns <= 0) return false;
    preUnit.speedDelayTurns--;
    preUnit.lastAction = "speedDelay";
    log(g, `${preUnit.name}: Speed ${card(preUnit).speed} 출전 지연으로 행동을 넘김.`, "turn");
    endTurn(g, t, s, false);
    return true;
  }
  if (a?.type === "switch") {
    if (!preUnit || preUnit.dead || !canSwitch(g, t, preUnit) || !g.teams[t].bench[a.bench]) return false;
    const cost = switchCost(preUnit),
      actor = cardHasCapability(preUnit, "dualActor") ? "beast" : null,
      plan = a.switchPaymentPlan;
    const currentPlan = plan ? Math.abs(plan.R + plan.W + plan.B - cost) < 0.001 && reqAcceptsCounts(parseCost("*".repeat(cost)), plan) && canPayReq(preUnit, {
      R: plan.R,
      W: plan.W,
      B: plan.B,
      any: 0,
      wb: 0
    }, actor) : null;
    if (plan && !currentPlan) return false;
    const paid = plan ? spendPaymentPlan(preUnit, plan, actor) : spendFrom(preUnit, "*".repeat(cost), [], actor);
    g.teams[t].switchUses = (g.teams[t].switchUses || 0) + 1;
    log(g, `${preUnit.name}: 교체 코스트 ${cost ? `${cost}E` : "무료"} 지불, 진영 교체 ${g.teams[t].switchUses}/3.`);
    a = {
      ...a,
      switchPaid: paid
    };
  }
  prepareCurrentTurn(g);
  let u = unitAt(g, t, s);
  if (!a) return false;
  if (!u || u.dead) return false;
  if (a.type === "scheduled" || a.type === "sequence") {
    const scheduledExecution = u.scheduledAction ? beginScheduledActionExecution(g, u) : null;
    if (scheduledExecution?.duplicate) {
      endTurn(g, t, s, true);
      return true;
    }
    const executed = executeScheduled(g, t, s, u, sim);
    if (!executed) return false;
    if (scheduledExecution) completeScheduledActionExecution(g, scheduledExecution);
    endTurn(g, t, s, true);
    return true;
  }
  let usedSkill = false,
    switched = false;
  if (a.type === "dualPass") {
    u.lastAction = "pass";
    log(g, `${u.name}: ${a.actor === "rider" ? "기수" : "빙마"} 행동을 넘김.`);
  } else if (a.type === "gather") {
    let actor = a.actor || null,
      store = energyStore(u, actor),
      amt = status(u, "slow") ? 0.5 : 1,
      colors = naturalColors(g, t, u, amt, actor, "natural-gather"),
      existingHalf = amt === 0.5 ? store.find(e => e.a === 0.5) : null,
      col = a.gatherProposal ? consumeNaturalGatherProposal(g, t, s, u, amt, actor, a.gatherProposal, "natural-gather") : existingHalf ? existingHalf.c : a.color && colors.includes(a.color) ? a.color : g.rng.pick(colors),
      max = card(u).maxEnergy || 4;
    if (!col) return false;
    if (existingHalf) log(g, `${u.name}: 기존 ${col} 반에너지와 합치기 위해 자연 수급 색이 ${col}로 고정.`);
    if (totalEnergy(u, actor) + amt > max) {
      let ri = a.replaceIndices ?? a.replaceIndex;
      if (ri == null && (t !== "P" || g.mode === "aivai")) ri = bestEnergyReplacementPlan(u, col, amt, actor);
      if (ri != null) {
        let indices = Array.isArray(ri) ? ri : [ri],
          old = indices.map(i => store[i]).filter(Boolean).map(e => `${e.c}${e.a === 0.5 ? "½" : ""}`).join("+");
        let gained = gainEnergy(g, u, col, amt, indices, actor);
        if (!gained) {
          log(g, `${u.name}: 선택한 에너지 양이 부족해 새 ${col} 에너지를 포기.`);
        } else log(g, `${u.name}${actor ? ` ${actor === "beast" ? "빙마" : "기수"}` : ""}: 최대 에너지에서 ${old} 버림 → ${col}${amt === 0.5 ? "½" : ""} 보관.`);
      } else log(g, `${u.name}: ${col} 에너지 포기(최대치).`);
    } else {
      gainEnergy(g, u, col, amt, null, actor);
      log(g, `${u.name}${actor ? ` ${actor === "beast" ? "빙마" : "기수"}` : ""}: ${col} 에너지 ${amt} 획득.`);
    }
    u.lastAction = "gather";
  } else if (a.type === "switch") {
    switchCharacter(g, t, s, a.bench);
    u.lastAction = "switch";
    switched = true;
  } else if (a.type === "skill") {
    let baseSk = card(u).skills.find(x => x.id === a.skill),
      sk = baseSk,
      cost = a.costOverride != null ? String(a.costOverride) : effectiveSkillCost(g, t, u, baseSk, baseSk?.cost),
      actor = a.actor || null;
    if (!baseSk || u.skillSeals?.[baseSk.id] || !skillRequirementsMet(u, baseSk)) return false;
    if (a.copySkill) {
      let source = state_catalog_cards.CARDS.find(c => c.id === a.copyCard);
      sk = source?.skills.find(x => x.id === a.copySkill);
      if (!sk) return false;
    }
    let plan = a.paymentPlan;
    if (plan) {
      let current = findPaymentPlan(g, t, u, skillDefHasEffect(baseSk, "hurricaneDive") ? "W*" : cost, actor, c => Math.abs(c.R - plan.R) < 0.001 && Math.abs(c.W - plan.W) < 0.001 && Math.abs(c.B - plan.B) < 0.001);
      if (!current) return false;
    } else if (!canPayAction(g, t, u, cost, actor)) return false;
    let noTarget = ["field"].includes(baseSk.target),
      target = baseSk.target === "enemySlot" || noTarget ? null : unitAt(g, a.target.team, a.target.slot);
    if (!noTarget && baseSk.target !== "enemySlot" && (!target || target.dead)) return false;
    if (skillDefHasRuntimeKind(baseSk, "openingGuard")) {
      if (u.firstGuardUsesRemaining <= 0) return false;
      u.firstGuardUsesRemaining = 0;
      log(g, `${u.name}: 퍼스트가드 사용 횟수 소모(0/1).`);
    }
    let paid = plan ? spendPaymentPlan(u, plan, actor) : spendAction(g, t, u, cost, a.prefer, actor);
    if (skillDefHasEffect(baseSk, "hurricaneDive") && a.extraW) {
      let extra = spendReq(u, {
        R: 0,
        W: a.extraW,
        B: 0,
        any: 0,
        wb: 0
      }, [], actor);
      paid.push(...extra);
    }
    log(g, `${u.name}: ${a.copySkill ? `드래곤메모리로 ${sk.name}` : baseSk.name} 사용 (실제 코스트 ${paid.map(x => x.c + (x.a === 0.5 ? "½" : "")).join("") || "없음"}).`);
    const effectiveActionTargets = (() => {
      const requested = (a.targetUids || []).map(uid => findUnit(g, uid)).filter(unit => unit && !unit.dead);
      if (requested.length) return requested;
      if (effectiveSkillTarget(u, baseSk) === "enemyField") return g.teams[other(t)].field.filter(unit => unit && !unit.dead);
      return [target].filter(unit => unit && !unit.dead);
    })();
    const effectiveActionSpec = a.effectiveActionSpec || state_catalog_cards.PlusStarModifierOwner.actionSpec(g, t, s, u, baseSk, a, effectiveActionTargets.map(unit => ({
      ...targetRef(g, other(t), unit),
      uid: unit.uid
    })));
    a.effectiveActionSpec = effectiveActionSpec;
    queueSkillVisual(g, u, target, baseSk, a.copySkill ? sk.effects : baseSk.effects);
    if (skillDefHasEffect(baseSk, "startSequence")) {
      const actionIdentity = effectiveActionSpec.actionId;
      queueVisual(g, {
        type: "sugarSwamp",
        uid: u.uid,
        targetUids: effectiveActionTargets.map(x => x.uid),
        sourceInstanceId: u.uid,
        sourceTeam: t,
        targetTeam: other(t),
        sourceSlot: s,
        skillId: baseSk.id,
        actionId: actionIdentity,
        transactionId: effectiveActionSpec.transactionId,
        vfxSequenceId: `${actionIdentity}:sugar-swamp:initial`,
        stageIndex: 0
      });
    }
    if (card(u).skillHeal) heal(g, u, card(u).skillHeal, u, {
      reason: "skill-passive-heal",
      effectId: baseSk.id,
      sim
    });
    if (skillDefHasRuntimeKind(baseSk, "openingGuard")) u.usedOnce[baseSk.id] = true;
    let effects = a.copySkill ? sk.effects : baseSk.effects,
      healTarget = a.healTargetUid ? findUnit(g, a.healTargetUid) : null,
      damageBatch = state_engine_combat.DamageBatchOwner.begin(g, `${u.uid}:${baseSk.id}:${g.turnSerial}`);
    try {
      for (const e of effects) {
        const context = {
          team: t,
          slot: a.target?.slot ?? s,
          paid,
          sim,
          extra: a.extra,
          extraEnergyPlan: a.extraEnergyPlan,
          extraW: a.extraW || 0,
          split: a.split,
          healTarget,
          sealedSkillId: a.sealedSkillId,
          action: a,
          effectiveActionSpec
        };
        if (skillDefHasEffect(baseSk, "startSequence") && effectiveActionSpec.effectiveTargetShape === "enemyField") {
          if (e.type === "startSequence") {
            effectApply(g, u, effectiveActionTargets[0] || target || u, e, sk, context);
            continue;
          }
          for (const batchTarget of effectiveActionTargets) {
            if (!batchTarget?.dead || ["clearFieldEnergy"].includes(e.type)) effectApply(g, u, batchTarget, e, sk, context);
          }
          continue;
        }
        if (target?.dead && !["clearFieldEnergy", "startSequence"].includes(e.type)) continue;
        effectApply(g, u, target || u, e, sk, context);
      }
    } finally {
      state_engine_combat.DamageBatchOwner.end(g);
    }
    u.skillUses++;
    if (skillDefHasTag(baseSk, "copy")) u.memoryUses = (u.memoryUses || 0) + 1;
    u.lastAction = "skill";
    u.lastSkill = a.copySkill || baseSk.id;
    if (target && effects.some(e => ["damage", "proportionalDamage", "firstBurst", "rampage", "shatterLance", "firestorm", "prawnCharge", "holyFlame", "lightCandelabra", "grandField", "hurricaneDive"].includes(e.type))) u.lastTarget = target.uid;
    usedSkill = true;
    recordPaidSkill(g, t, u, paid);
    /*
     * 드래곤메모리는 껍데기 기술이 아니라 실제로 복사해 실행한 기술을
     * 기준으로 딥마인드를 판정한다. 공격기를 복사한 경우에는 발동하지 않는다.
     */
    if (isNonAttackSkill(sk)) triggerDeepMind(g, t, u, target || u, a, sk);
    if (cardHasCapability(u, "selectiveEnergyTrait") && traitsActive(u)) requestTraitEnergy(g, u, "R", 1, "기술 사용");
  }
  advanceDualOrEnd(g, t, s, u, usedSkill, switched);
  return true;
}
export function execute(g, t, s, action, options = {}) {
  return state_online_commands.OnlineActionAdmissionOwner.execute(g, t, s, action, options);
}

// One fixed action path. No per-action closure composition or fallback executor.
export function runCanonicalBattleAction(g, t, s, action, options = {}) {
  prepareCurrentTurn(g);
  if (!battleActionConstraintsMet(g, t, s, action)) return false;
  const energy = systems.EnergyCanonicalizationEngine;
  const before = energy.begin(g, t, s, action, options);
  const overflow = systems.__megaEnergyOverflowChoice;
  const previous = overflow.begin(g, t, s, action, options);
  let result;
  try {
    result = systems.__megaSpectatorR18.canExecute(g, t, s, action, options) === false ? false : executeTimeAction(g, t, s, action, options);
  } finally {
    overflow.end(previous);
  }
  return energy.finish(result, before, g, t, s, action, options);
}
export function endTurn(g, t, s, usedSkill) {
  const __managed = typeof state_runtime_state.StateFactory !== "undefined" && typeof state_runtime_entities.BattleEventEngine !== "undefined" && typeof state_runtime_transactions.TurnEngine !== "undefined";
  let __beforeSerial = Number(g?.turnSerial) || 0;
  if (__managed) {
    state_runtime_state.StateFactory.decorate(g);
    if (g.ended || g.winner) return false;
    const currentPair = g.order?.[g.turn];
    if (currentPair && (currentPair[0] !== t || String(currentPair[1]) !== String(s))) return false;
    const key = `${g.battleId}:${g.turnSerial}:${t}:${s}`;
    if (g._r48LastEndTurnKey === key) return false;
    g._r48LastEndTurnKey = key;
    g.phase = "TURN_END";
    __beforeSerial = Number(g.turnSerial) || 0;
  }
  let __result;
  __endTurnCore: {
    let u = unitAt(g, t, s);
    const hadSeal = u ? !!status(u, "traitSeal") : false;
    const summonOwner = !!u && skillsOf(u).some(sk => skillDefHasTag(sk, "summon"));
    const regen = !!u && cardHasCapability(u, "regenerationTrait") && traitsActive(u) && !status(u, "traitSeal");
    if (regen) for (const st of Object.keys(u.statuses || {})) if (st !== "traitSeal" && u.statuses[st] > 1 && statusTicksThisTurn(g, u, st)) u.statuses[st]--;
    if (u && !u.dead) {
      if (status(u, "burn") && !usedSkill) nonAttackDamage(g, u, 30, "화상");
      for (const st of Object.keys(u.statuses)) {
        if (u.statuses[st] > 0 && statusTicksThisTurn(g, u, st)) {
          u.statuses[st]--;
          log(g, `${u.name}: ${state_engine_entities.STATUS[st]} ${u.statuses[st]}턴 남음.`);
          if (!u.statuses[st]) {
            delete u.statuses[st];
            if (u.statusAppliedTurnSerial) delete u.statusAppliedTurnSerial[st];
            queueCombatNotice(g, u, `${state_engine_entities.STATUS[st]} 종료`, "cure");
          }
        }
      }
      if (u.hp <= 0) checkDeath(g, u);
      for (const sid of Object.keys(u.skillSeals || {})) {
        u.skillSeals[sid]--;
        if (u.skillSeals[sid] <= 0) {
          let skillName = card(u).skills.find(x => x.id === sid)?.name || "기술";
          delete u.skillSeals[sid];
          queueCombatNotice(g, u, `${skillName} 기술봉인 종료`, "cure");
        }
      }
      u.turns++;
      u.turnSkillCostReduction = 0;
      if (cardHasCapability(u, "horizonFlow") && Number(u.hp) <= Number(u.maxHp) / 2) {
        const units = [...g.teams[t].field, ...g.teams[t].bench].filter(x => x && !x.dead);
        const countColor = color => units.reduce((sum, x) => sum + energyStore(x).reduce((n, entry) => n + (entry.c === color ? Number(entry.a || 0) : 0), 0), 0);
        const white = countColor("W"),
          black = countColor("B");
        const flowTargets = cardCapability(u, "horizonFlowTargets", {});
        if (white > black && flowTargets.W) state_catalog_cards.FormFamilyOwner.transition(g, u, flowTargets.W, "시간의 흐름");else if (black > white && flowTargets.B) state_catalog_cards.FormFamilyOwner.transition(g, u, flowTargets.B, "시간의 흐름");
      }
    }
    g.stats.turns++;
    let dealt = ["P", "A"].flatMap(x => [...g.teams[x].field, ...g.teams[x].bench, ...g.teams[x].graveyard]).filter(Boolean).reduce((n, x) => n + x.damageDealt, 0);
    if (dealt > g.lastDamageTotal) {
      g.lastDamageTotal = dealt;
      g.noDamageTurns = 0;
    } else g.noDamageTurns++;
    if (!g.winner && g.noDamageTurns >= 120 && u && !u.dead) {
      let raw = 10 + Math.floor((g.noDamageTurns - 120) / 8) * 10,
        streak = g.noDamageTurns;
      nonAttackDamage(g, u, raw, "교착 압박");
      g.noDamageTurns = streak;
    }
    if (!g.winner && g.stats.turns >= 800 && u && !u.dead) {
      let raw = 40 + Math.floor((g.stats.turns - 800) / 16) * 40,
        streak = g.noDamageTurns;
      nonAttackDamage(g, u, raw, "결판 압박");
      g.noDamageTurns = streak;
    }
    g.turn = (g.turn + 1) % g.order.length;
    g.turnSerial++;
    g.preparedKey = null;
    g.dualActorController = null;
    if (g.turn === 0) g.round++;
    checkWinner(g);
    if (summonOwner && u && !u.dead) processJunglesSummons(g, t, u);
    if (g.circuitChain?.uid === u?.uid) {
      if (!u || u.dead || unitAt(g, t, s)?.uid !== u.uid) g.circuitChain = null;else if (g.circuitChain.remaining > 0) {
        g.circuitChain.remaining--;
        g.turn = g.order.findIndex(x => x[0] === t && x[1] === s);
        g.preparedKey = null;
        log(g, `${u.name}: 전류가속 추가 차례 시작 (${g.circuitChain.remaining}회 더 남음).`, "turn");
      } else g.circuitChain = null;
    }
    if (reactiveEnergyRule(u) && hadSeal !== !!status(u, "traitSeal")) syncReactiveEnergyMaxHp(g, u, "특성봉인 종료", true);
  }
  if (!__managed) return __result;
  if ((Number(g.turnSerial) || 0) === __beforeSerial) {
    delete g._r48LastEndTurnKey;
    return __result;
  }
  const skipped = state_runtime_transactions.TurnEngine.normalizeDeadEmptyOrderEntries(g);
  state_runtime_state.StateFactory.updateActive(g);
  state_runtime_entities.BattleEventEngine.emit(g, "TURN_ENDED", {
    teamId: t,
    payload: {
      slot: s,
      usedSkill: !!usedSkill,
      turnSerial: __beforeSerial,
      skippedEmptySlots: skipped
    }
  });
  if (!g.ended) state_runtime_entities.BattleEventEngine.emit(g, "TURN_STARTED", {
    teamId: g.activeTeamId,
    sourceEntityId: g.activeEntityId,
    payload: {
      turnSerial: g.turnSerial,
      round: g.round
    }
  });
  return __result === undefined ? true : __result;
}
export function checkWinner(g) {
  if (g.winner === "P" || g.winner === "A") return;
  actionFaultHit("victory-before");
  let p = aliveUnits(g.teams.P).length,
    a = aliveUnits(g.teams.A).length;
  if (!p || !a) {
    g.winner = p ? "P" : "A";
    actionFaultHit("victory-after");
    actionFaultHit("terminal-pending-after");
    actionFaultHit("terminal-commit-before");
    log(g, g.winner === "P" ? "플레이어 승리!" : "AI 승리!", "turn");
  } else actionFaultHit("victory-after");
}
export function gatherPotential(u) {
  let max = card(u).maxEnergy || 4;
  if (totalEnergy(u) < max) return 20 - totalEnergy(u) * 2;
  let base = energyValue(u),
    gain = 0,
    store = energyStore(u);
  for (const col of ["R", "W", "B"]) {
    let best = base;
    store.forEach((e, i) => {
      if (e.a < 1) return;
      let pool = store.filter((_, j) => j !== i).map(x => ({
        ...x
      }));
      pool.push({
        c: col,
        a: 1
      });
      best = Math.max(best, energyValue(u, pool));
    });
    gain += Math.max(0, best - base);
  }
  return gain ? gain / 3 : -120;
}

import { eternaLocksTeam } from "../app/controls.js";
import { listRaidSkillActions } from "../features/boss-raid.js";
import { listClockSkillActions, listMemoryActions, timeCurrentSuppressionDomain, timeFieldTimeoras, timeFieldUnits, timeRecordTurnStart } from "../features/timeora.js";
import { listReactiveEnergyActions, reactiveEnergyRule, reconcileAllReactiveEnergyUnits } from "../features/genocider.js";
import { listResonanceActions } from "../features/elixian.js";
import { listStrikeActions } from "../features/foxious.js";
import { listSummonSkillActions, summonLimitReached, countCompleteW } from "../features/summons.js";
import { listDeepSeaActions } from "../features/character-rules.js";
// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_engine_actions = {
  timeTraitGame: undefined,
  timeFeatureReady: undefined
};
import { effectiveSkillCost, effectiveSkillTarget, skillRequirementsMet, state_catalog_cards } from "../catalog/cards.js";
import { heal, queueVisual, traitsActive } from "./combat.js";
import { collectTargetEnergyEntries, ensureScheduledActionIdentity, decayHpProtectionBarriers, processQueuedHeal, scheduledExecutionId } from "./effects.js";
import { allEnergy, allPaymentPlans, canPay, canPayAction, canPayFrom, canSwitch, energyStore, status, switchCost, switchCostText, totalEnergy, transformedSkillReq, state_engine_energy } from "./energy.js";
import { battleActionConstraintsMet, card, cardHasCapability, firstSkillByEffect, resolveSkillTargets, skillDefHasEffect, skillDefHasRuntimeKind, skillDefHasTag, skillIdByEffect, skillIdByEffectGlobal, skillOf } from "./entities.js";
import { log } from "../presentation/audio.js";
import { timeSyncContinuousTraitStates } from "../presentation/introductions.js";
import { combatInt, energyAmountText, state_ui_battle_state } from "../ui/battle-state.js";
export function initializeEngineActions() {
  state_engine_actions.timeTraitGame = null;
  state_engine_actions.timeFeatureReady = false;
}
export function other(t) {
  return t === "P" ? "A" : "P";
}
export function unitAt(g, t, s) {
  if (typeof s === "string" && s.startsWith("summon:")) return (g.teams[t]?.summons || []).find(u => u?.uid === s.slice(7)) || null;
  return g.teams[t].field[s];
}
export function prepareCurrentTurn(g) {
  const beforeKey = g?.preparedKey;
  const oldTimeGame = typeof state_engine_actions.timeTraitGame !== "undefined" ? state_engine_actions.timeTraitGame : null;
  if (typeof state_engine_actions.timeTraitGame !== "undefined") state_engine_actions.timeTraitGame = g;
  try {
    let [t, s] = g.order[g.turn],
      u = unitAt(g, t, s),
      key = `${g.turnSerial}:${t}:${s}`;
    if (g.preparedKey !== key) {
      g.preparedKey = key;
      if (u && !u.dead) {
        if (u.fullInvulnerableUntilOwnTurn) {
          u.fullInvulnerableUntilOwnTurn = false;
          log(g, `${u.name}: 무적 종료.`);
        }
        u.turnSkillCostReduction = Math.max(0, Math.floor(Number(u.queuedSkillCostReduction || 0)));
        u.queuedSkillCostReduction = 0;
        if (u.turnSkillCostReduction) log(g, `${u.name}: 이번 자기 차례 기술 코스트 ${u.turnSkillCostReduction} 감소.`);
        u.barrierTurnEpoch = (u.barrierTurnEpoch || 0) + 1;
        decayHpProtectionBarriers(g, u, g !== state_ui_battle_state.game);
        processQueuedHeal(g, u);
        if (u.fireWingUntil != null && u.turns >= u.fireWingUntil) {
          u.fireWingUntil = null;
          log(g, `${u.name}: 화염날개 방어 종료.`);
        }
        if (cardHasCapability(u, "dualActor")) state_engine_energy.dualActorController.begin(g, u);else state_engine_energy.dualActorController.clear(g);
      }
    }

    // Turn-start feature rules are canonical post-processing, not stacked function wrappers.
    [t, s] = g.order[g.turn] || [];
    u = unitAt(g, t, s);
    for (const kt of ["P", "A"]) for (const cu of g.teams[kt].field || []) {
      if (cu?.scheduledAction?.kind === "voltageBurst" && cu.uid !== u?.uid) {
        cu.scheduledAction = null;
        log(g, `${cu.name}: 다른 개체의 차례가 시작되어 볼티지버스트 실패.`);
        queueVisual(g, {
          type: "voltageFailFx",
          uid: cu.uid
        });
      }
    }
    if (cardHasCapability(u, "currentAcceleration") && (!g.circuitChain || g.circuitChain.uid !== u.uid)) {
      const n = traitsActive(u) ? countCompleteW(u) : 0;
      g.circuitChain = {
        uid: u.uid,
        team: t,
        slot: s,
        remaining: n
      };
      if (n) log(g, `${u.name} 특성 · 전류가속: 추가 차례 ${n}회 예약.`);
    }
    if (g.preparedKey !== beforeKey && u && !u.dead && u.elixianResonance) {
      const got = heal(g, u, 10, u, {
        reason: "elixian-resonance",
        effectId: "elixianResonance"
      });
      log(g, `${u.name} 효과 · 잔향: 턴 시작 HP ${got} 회복.`);
      queueVisual(g, {
        type: "elixianPulseFx",
        uid: u.uid,
        resonance: true
      });
    }
    reconcileAllReactiveEnergyUnits(g, false, "차례 준비");
  } finally {
    if (typeof state_engine_actions.timeTraitGame !== "undefined") state_engine_actions.timeTraitGame = oldTimeGame;
  }
  if (state_engine_actions.timeFeatureReady && g && g.preparedKey !== beforeKey) {
    const [t, s] = g.order[g.turn] || [],
      u = unitAt(g, t, s);
    if (u && !u.dead) timeRecordTurnStart(g, u);
    const domain = timeCurrentSuppressionDomain(g);
    if (domain) {
      const stamp = `${g.turnSerial}:${domain.id}:${[...domain.ownerUids].join(",")}`;
      if (g._timeSuppressionLogStamp !== stamp) {
        g._timeSuppressionLogStamp = stamp;
        const stoppedUnits = timeFieldUnits(g).filter(x => domain.suppresses(x));
        const stopped = stoppedUnits.map(x => x.name);
        log(g, `${domain.label} 정렬: ${stopped.join(", ") || "대상 없음"}의 특성 발동 정지.`, "turn");
        for (const x of timeFieldTimeoras(g).filter(x => domain.suppresses(x))) log(g, `${x.name}: 상대 운명의 시계로 시계 반응·시간 가속·타임프로텍트·특성 정지 기능 정지.`, "turn");
        domain.representative();
      }
    }
    timeSyncContinuousTraitStates(g);
  }
}
export function enemyTargets(g, t) {
  let a = [];
  g.teams[other(t)].field.forEach((x, i) => {
    if (x && !x.dead) a.push({
      team: other(t),
      slot: i,
      uid: x.uid
    });
  });
  return a;
}
export function listStandardActions(g, t, s) {
  prepareCurrentTurn(g);
  let team = g.teams[t],
    u = team.field[s],
    a = [];
  if (!u || u.dead) {
    team.bench.filter(x => x && !x.dead).forEach(x => a.push({
      type: "deploy",
      unit: x.uid,
      label: `${x.name} 출전`
    }));
    return a;
  }
  if (u.speedDelayTurns > 0) return [{
    type: "speedDelay",
    label: `Speed ${card(u).speed} · 출전 지연 자동 진행`
  }];
  if (u.scheduledAction) {
    const scheduled = ensureScheduledActionIdentity(g, u);
    return [{
      type: "scheduled",
      actionId: scheduledExecutionId(g, scheduled),
      scheduledActionId: scheduled.scheduledActionId,
      sourceInstanceId: scheduled.sourceInstanceId,
      label: "예약 공격 자동 실행"
    }];
  }
  let frozen = status(u, "freeze"),
    sealed = status(u, "skillSeal");
  if (cardHasCapability(u, "dualActor")) {
    let who = g.dualActorController?.uid === u.uid ? g.dualActorController.actor : "beast",
      store = energyStore(u, who);
    if (!status(u, "paralyze")) a.push({
      type: "gather",
      actor: who,
      label: `${who === "beast" ? "빙마" : "기수"} 에너지 모으기`
    });
    a.push({
      type: "dualPass",
      actor: who,
      label: `${who === "beast" ? "빙마" : "기수"} 행동 넘기기`
    });
    if (who === "beast" && !frozen && canSwitch(g, t, u)) for (let i = 0; i < team.bench.length; i++) if (team.bench[i] && !team.bench[i].dead) a.push({
      type: "switch",
      bench: i,
      switchCost: switchCost(u),
      label: `${team.bench[i].name}와 교체 · ${switchCostText(u)} (${(team.switchUses || 0) + 1}/3)`
    });
    if (!frozen && !sealed) {
      let skills = card(u).skills.filter(sk => who === "beast" ? !skillDefHasEffect(sk, "shatterLance") : skillDefHasEffect(sk, "shatterLance"));
      for (const sk of skills) {
        if (usesActionVariants(u, sk) || u.skillSeals?.[sk.id]) continue;
        if (!skillRequirementsMet(u, sk) || !canPayFrom(u, sk.cost, who)) continue;
        if (skillDefHasEffect(sk, "iceRoar")) a.push({
          type: "skill",
          skill: sk.id,
          actor: who,
          target: {
            team: t,
            slot: s,
            uid: u.uid
          },
          label: sk.name
        });else if (skillDefHasEffect(sk, "rampage")) {
          let max = Math.max(0, allEnergy(u) - 1);
          for (const tar of enemyTargets(g, t)) for (let extra = 0; extra <= max + 0.001; extra += 0.5) a.push({
            type: "skill",
            skill: sk.id,
            actor: who,
            target: tar,
            extra: +extra.toFixed(1),
            label: `${sk.name} (${energyAmountText(1 + extra)}E/${combatInt((1 + extra) * 10)}D)`
          });
        } else for (const tar of enemyTargets(g, t)) a.push({
          type: "skill",
          skill: sk.id,
          actor: who,
          target: tar,
          label: sk.name
        });
      }
    }
    return a;
  }
  if (!status(u, "paralyze")) a.push({
    type: "gather",
    label: "에너지 모으기"
  });
  if (frozen) return a;
  if (canSwitch(g, t, u)) for (let i = 0; i < team.bench.length; i++) {
    let b = team.bench[i];
    if (b && !b.dead) a.push({
      type: "switch",
      bench: i,
      switchCost: switchCost(u),
      label: `${b.name}와 교체 · ${switchCostText(u)} (${(team.switchUses || 0) + 1}/3)`
    });
  }
  if (!sealed) {
    for (const sk of card(u).skills) {
      if (usesActionVariants(u, sk) || u.skillSeals?.[sk.id]) continue;
      if (!state_catalog_cards.PlusStarModifierOwner.legal(u, sk) || !skillRequirementsMet(u, sk)) continue;
      if (skillDefHasRuntimeKind(sk, "openingGuard") && u.firstGuardUsesRemaining <= 0) continue;
      if (skillDefHasRuntimeKind(sk, "dynamicDefenseSmash")) {
        for (const tar of enemyTargets(g, t)) {
          let target = unitAt(g, tar.team, tar.slot),
            actual = "*".repeat(Math.max(0, 6 - Math.floor(allEnergy(target))));
          if (canPay(u, actual)) a.push({
            type: "skill",
            skill: sk.id,
            costOverride: actual,
            target: tar,
            label: `실버스매시 (실제 ${actual || "0"})`
          });
        }
        continue;
      }
      const canonicalCost = effectiveSkillCost(g, t, u, sk, sk.cost);
      if (!canPayAction(g, t, u, canonicalCost)) continue;
      if (sk.extraAnyEnergy) {
        const baseNeed = transformedSkillReq(g, t, u, canonicalCost).tokens.length;
        const colored = sk.extraEnergyColor ? energyStore(u).reduce((n, e) => n + (e.c === sk.extraEnergyColor ? Number(e.a || 0) : 0), 0) : Infinity,
          maxExtra = Math.max(0, Math.floor(Math.min(colored, totalEnergy(u) - baseNeed) * 2 + 1e-6) / 2);
        for (const target of resolveSkillTargets(g, t, s, u, sk)) for (let extra = 0; extra <= maxExtra + 1e-6; extra += 0.5) a.push({
          type: "skill",
          skill: sk.id,
          target,
          costOverride: canonicalCost,
          extraEnergyAmount: +extra.toFixed(1),
          label: `${sk.name} · 추가 ${energyAmountText(extra)}E`
        });
        continue;
      }
      if (skillDefHasEffect(sk, "lifeRain") || skillDefHasEffect(sk, "bloomingLife")) {
        a.push({
          type: "skill",
          skill: sk.id,
          target: {
            team: t,
            slot: s,
            uid: u.uid
          },
          split: 15,
          label: sk.name
        });
        continue;
      }
      if (skillDefHasEffect(sk, "holyFlame")) {
        for (const tar of enemyTargets(g, t)) for (const healTarget of g.teams[t].field.filter(x => x && !x.dead)) a.push({
          type: "skill",
          skill: sk.id,
          target: tar,
          healTargetUid: healTarget.uid,
          label: `${sk.name} → ${healTarget.name} 회복`
        });
        continue;
      }
      let targets = resolveSkillTargets(g, t, s, u, sk);
      if (effectiveSkillTarget(u, sk) === "enemyField") {
        if (targets.length) {
          const draft = {
            type: "skill",
            skill: sk.id,
            target: targets[0],
            targetShape: "enemyField",
            targetUids: targets.map(x => x.uid),
            costOverride: canonicalCost,
            label: `${sk.name} · 적 전체`
          };
          draft.effectiveActionSpec = state_catalog_cards.PlusStarModifierOwner.actionSpec(g, t, s, u, sk, draft, targets);
          a.push(draft);
        }
      } else targets.forEach(target => {
        const draft = {
          type: "skill",
          skill: sk.id,
          target,
          costOverride: canonicalCost === sk.cost ? undefined : canonicalCost,
          label: sk.name
        };
        draft.effectiveActionSpec = state_catalog_cards.PlusStarModifierOwner.actionSpec(g, t, s, u, sk, draft, [target]);
        a.push(draft);
      });
    }
  }
  return a;
}
/* 사람 차례에도 자동으로 실행되는 규칙 행동(예약 행동·출전 지연). 자동 실행·입력 잠금·패널이 모두 이 한 곳을 쓴다. */
export const isForcedRuleAction = a => a?.type === "scheduled" || a?.type === "speedDelay";
export const forcedRuleAction = actions => (actions || []).find(isForcedRuleAction) || null;
export function legalActions(g, t, s) {
  const previous = state_engine_actions.timeTraitGame;
  state_engine_actions.timeTraitGame = g;
  try {
    let actions = listStandardActions(g, t, s);
    const actor = unitAt(g, t, s);
    if (!actor || actor.dead) return actions.filter(a => a.type === "deploy" && rosterActionAllowed(g, t, s, actor, a));
    if (Number(actor.speedDelayTurns || 0) > 0) return actions.filter(a => a.type === "speedDelay");
    if (actor.scheduledAction) return actions.filter(a => a.type === "scheduled");
    if (!status(actor, "freeze") && !status(actor, "skillSeal")) {
      actions.push(...listCostVariantActions(g, t, s), ...listEnergyInteractionActions(g, t, s), ...listDeepSeaActions(g, t, s), ...listSummonSkillActions(g, t, s), ...listStrikeActions(g, t, s), ...listResonanceActions(g, t, s), ...listReactiveEnergyActions(g, t, s), ...listClockSkillActions(g, t, s), ...listMemoryActions(g, t, s), ...listRaidSkillActions(g, t, s));
    }
    return actions.filter(a => {
      if (!battleActionConstraintsMet(g, t, s, a)) return false;
      if (!rosterActionAllowed(g, t, s, actor, a)) return false;
      if (status(actor, "freeze") && (a.type === "skill" || a.type === "switch")) return false;
      if (status(actor, "paralyze") && a.type === "gather") return false;
      if (a.type !== "skill") return true;
      const skill = skillOf(actor, a.skill);
      return !status(actor, "skillSeal") && !actor.skillSeals?.[a.skill] && skillRequirementsMet(actor, skill) && !(skillDefHasRuntimeKind(skill, "openingGuard") && actor.firstGuardUsesRemaining <= 0) && !(firstSkillByEffect(actor, "junglesVineWhip") && skillDefHasTag(skill, "summon") && summonLimitReached(g, t, actor));
    });
  } finally {
    state_engine_actions.timeTraitGame = previous;
  }
}
export function basicTargets(g, t, s, u, sk) {
  return resolveSkillTargets(g, t, s, u, sk);
}
export function listCostVariantActions(g, t, s) {
  let a = [],
    u = unitAt(g, t, s);
  if (!u || u.dead || u.scheduledAction || status(u, "freeze") || status(u, "skillSeal")) return a;
  let actor = cardHasCapability(u, "dualActor") ? g.dualActorController?.actor || "beast" : null;
  for (const sk of card(u).skills) {
    if (u.skillSeals?.[sk.id]) continue;
    if (skillDefHasEffect(sk, "lightCandelabra")) {
      for (let tier = 0; tier <= 3; tier++) {
        let plans = allPaymentPlans(g, t, u, sk.cost).filter(c => Math.min(3, Math.floor(c.W + 0.001)) === tier);
        if (!plans.length) continue;
        for (const plan of plans) for (const tar of [...enemyTargets(g, t), ...g.teams[t].field.map((x, i) => x && !x.dead ? {
          team: t,
          slot: i,
          uid: x.uid
        } : null).filter(Boolean)]) {
          let target = unitAt(g, tar.team, tar.slot);
          if (tar.team !== t && tier === 3) for (const sealSk of card(target).skills) a.push({
            type: "skill",
            skill: sk.id,
            target: tar,
            paymentPlan: plan,
            wTier: tier,
            sealedSkillId: sealSk.id,
            label: `${sk.name} · W${tier} · ${sealSk.name} 봉인`
          });else a.push({
            type: "skill",
            skill: sk.id,
            target: tar,
            paymentPlan: plan,
            wTier: tier,
            label: `${sk.name} · W${tier}`
          });
        }
      }
      continue;
    }
    if (skillDefHasEffect(sk, "grandField") && sk.target === "lowestEnergyEnemy") {
      if (canPayAction(g, t, u, sk.cost)) {
        for (const target of resolveSkillTargets(g, t, s, u, sk)) a.push({
            type: "skill",
            skill: sk.id,
            target,
            label: sk.name
          });
      }
      continue;
    }
    if (skillDefHasEffect(sk, "hurricaneDive")) {
      for (let extra = 0; extra <= 2; extra++) {
        let plans = allPaymentPlans(g, t, u, "W*").filter(c => totalEnergy(u) - c.R - c.W - c.B >= extra - 1e-6 && totalEnergy(u) - c.R - c.W - c.B >= 0 && energyStore(u).reduce((n, e) => n + (e.c === "W" ? e.a : 0), 0) - c.W >= extra - 1e-6);
        if (!plans.length) continue;
        for (const plan of plans) for (const tar of enemyTargets(g, t)) a.push({
          type: "skill",
          skill: sk.id,
          target: tar,
          paymentPlan: plan,
          extraW: extra,
          label: `${sk.name} · ${extra ? `${extra}턴 후 ${30 + 70 * extra}D` : "즉시 30D"}`
        });
      }
      continue;
    }
  }
  return a;
}
const TARGET_ENERGY_KINDS = ["targetEnergyRemoval", "targetEnergyTransfer"];
function listMysticBurstActions(g, t, u) {
  const mystic = firstSkillByEffect(u, "mysticBurst");
  if (!mystic || u.skillSeals?.[skillIdByEffect(u, "mysticBurst")]) return [];
  const pool = {
    R: 0,
    W: 0,
    B: 0
  };
  u.energy.forEach(e => pool[e.c] += e.a);
  const actions = [];
  for (const plan of allPaymentPlans(g, t, u, "WB*")) {
    const left = {
      R: Math.floor(pool.R - plan.R + 0.001),
      W: Math.floor(pool.W - plan.W + 0.001),
      B: Math.floor(pool.B - plan.B + 0.001)
    };
    for (let r = 0; r <= left.R; r++) for (let w = 0; w <= left.W; w++) for (let b = 0; b <= left.B; b++) for (const tar of enemyTargets(g, t)) actions.push({
      type: "skill",
      skill: skillIdByEffectGlobal("mysticBurst"),
      target: tar,
      paymentPlan: plan,
      extraColors: {
        R: r,
        W: w,
        B: b
      },
      label: `미스틱버스트 · 추가 ${"R".repeat(r)}${"W".repeat(w)}${"B".repeat(b) || "없음"}`
    });
  }
  return actions;
}
// A target that holds no energy still takes the skill's damage: the energy part simply has nothing to pick,
// so it yields one plain action instead of making the whole skill unusable.
function targetEnergyActions(skill, tar, target) {
  const kind = skill.interaction?.kind;
  if (kind === "targetEnergyRemoval") {
    const step = Number(skill.interaction?.step || 0.5),
      actions = [];
    for (let n = 0; n <= allEnergy(target) + 0.001; n += step) actions.push({
      type: "skill",
      skill: skill.id,
      target: tar,
      interactionAmount: +n.toFixed(1),
      label: `${skill.name} · 에너지 ${n} 제거`
    });
    return actions;
  }
  const entries = collectTargetEnergyEntries(target);
  if (!entries.length) return [{
    type: "skill",
    skill: skill.id,
    target: tar,
    interactionAmount: 0,
    interactionPlan: [],
    label: skill.name
  }];
  return entries.map(entry => ({
    type: "skill",
    skill: skill.id,
    target: tar,
    interactionAmount: Number(entry.a || 0),
    interactionPlan: [{
      ...entry
    }],
    label: `${skill.name} · ${entry.c}${entry.a === 0.5 ? "½" : ""} 강탈`
  }));
}
function listTargetEnergyActions(g, t, s, u) {
  const actions = [];
  for (const skill of card(u).skills) {
    if (!TARGET_ENERGY_KINDS.includes(skill.interaction?.kind)) continue;
    if (u.skillSeals?.[skill.id] || !skillRequirementsMet(u, skill) || !canPayAction(g, t, u, skill.cost)) continue;
    for (const tar of resolveSkillTargets(g, t, s, u, skill)) {
      const target = unitAt(g, tar.team, tar.slot);
      if (target && !target.dead) actions.push(...targetEnergyActions(skill, tar, target));
    }
  }
  return actions;
}
export function listEnergyInteractionActions(g, t, s) {
  const u = unitAt(g, t, s);
  if (!u || u.dead || status(u, "freeze") || status(u, "skillSeal")) return [];
  return [...listMysticBurstActions(g, t, u), ...listTargetEnergyActions(g, t, s, u)];
}
export { effectApply } from "./effects.js";
function rosterActionAllowed(g, team, slot, actor, action) {
  if (action.type === "switch" && (eternaLocksTeam(g, team) || g.bossRaid && team === "A")) return false;
  if (!g.bossRaid?.online || team !== "P") return true;
  const owner = g.bossRaid.slotOwners?.[slot] || actor?.bossOwner || "solo";
  if (action.type === "deploy") return g.teams.P.bench.find(u => u?.uid === action.unit)?.bossOwner === owner;
  if (action.type === "switch") return g.teams.P.bench[action.bench]?.bossOwner === actor?.bossOwner;
  return true;
}
function usesActionVariants(unit, skill) {
  if (skillDefHasTag(skill, "copy") || TARGET_ENERGY_KINDS.includes(skill.interaction?.kind)) return true;
  const types = new Set(skill.effects.map(effect => effect.type));
  if (["lightCandelabra", "hurricaneDive", "mysticBurst", "suctionPad", "abyssCannon", "abyssVortex", "junglesVineWhip", "circuitArmsBlade", "circuitVoltageBurst", "foxStrike"].some(type => types.has(type))) return true;
  if (types.has("grandField") && skill.target === "lowestEnergyEnemy") return true;
  if (cardHasCapability(unit, "resonanceTrait") && ["elixianShiningWind", "elixianAromaField", "elixianMultiArrow", "elixianLastGift"].some(type => types.has(type))) return true;
  if (reactiveEnergyRule(unit) && types.has("genociderDisplosion")) return true;
  if (cardHasCapability(unit, "timeControl") && (types.has("timeRecall") || types.has("hyperClock"))) return true;
  return !!unit.bossRed && types.has("bossTimeStrike");
}

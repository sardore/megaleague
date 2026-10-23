import { raidActionBonus } from "../features/boss-raid.js";
import { totalAttackDecrease } from '../engine/effects.js';
import { undeadPreventsDeath } from '../engine/status-rules.js';
import { actionHeuristicCore, chooseAICore } from "./search.js";
import { activeAbigate, isNonAttackSkill } from "../app/controls.js";
import { legalActions, other, unitAt, state_engine_actions } from "../engine/actions.js";
import { findUnit, teamOf, traitsActive } from "../engine/combat.js";
import { lifeRainHealPool } from "../engine/effects.js";
import { allEnergy, canPayAction, energyValue, findPaymentPlan, status } from "../engine/energy.js";
import { actionSkillHasEffect, actionSkillHasTag, card, cardHasCapability, firstSkillByEffect, firstSkillByTag, skillHasTag, skillRefHasEffect } from "../engine/entities.js";
import { bestDiscardSpecs, bestVortexSwaps, chooseDeepMindTarget, colorAmount } from "../features/character-rules.js";
import { elixianHealAmount, elixianHpProtection } from "../features/elixian.js";
import { reactiveEnergyAmount, reactiveEnergyRule, state_features_genocider } from "../features/genocider.js";
import { allBattleUnits, circuitBlocksExternal, fragmentDefense, summonLimitReached, vortexEnergySlots } from "../features/summons.js";
import { timeFieldUnits, timeRecallValue, timeTeamOf } from "../features/timeora.js";
import { timePredictedClockState } from "../presentation/introductions.js";
import { systems } from "../runtime/systems.js";
import { visibleDefense } from "../ui/battle-state.js";
import { renderSetup } from "../ui/setup.js";
export function initializeAiSpecialists() {
  state_engine_actions.timeFeatureReady = true;

  /* Specialist AI owner: all card-specific scoring/preparation lives in one ordered layer. */

  /* 타임오러는 초기 덱 목록 렌더 이후 등록되므로 현재 선택창을 한 번 갱신한다. */
  if (document.querySelector('#setup')?.classList.contains('active')) renderSetup(false);

  /* 선택형 코스트(RorB/WorB 등)는 문자 선택이 아니라 실제 에너지 토큰으로 결제한다. */

  /* ===== 온라인 탭 복귀 복구·채팅·동전 면 구분·폭시어스 리워크 ===== */
}
export function actionHeuristic(g, t, s, a) {
  const oldTimeGame = state_engine_actions.timeTraitGame;
  state_engine_actions.timeTraitGame = g;
  try {
    let score = actionHeuristicCore(g, t, s, a),
      u = unitAt(g, t, s),
      target = a?.target ? unitAt(g, a.target.team, a.target.slot) : null;
    if (!u || a?.type !== "skill") return score + raidActionBonus(g, t, s, a);
    if (actionSkillHasEffect(a, 'suppressedCurse') && target) score += 90 + totalAttackDecrease(target) * 2 + (u.hp < u.maxHp*.5 ? 40 : 0);
    if (actionSkillHasEffect(a, 'graveDown') && target) score += target.hp < u.hp && !undeadPreventsDeath(target) ? 450 + target.hp : -600;
    if (actionSkillHasEffect(a, "suctionPad") && target) {
      const allied = teamOf(g, target) === t,
        setup = cardHasCapability(u, "switchLockTrait") && canPayAction(g, t, u, "R*") ? 45 : 22;
      score += allied ? setup - 20 + (activeAbigate(g, t) ? 10 : 0) : setup + colorAmount(target, "R") * 24;
    }
    if (actionSkillHasEffect(a, "eternaHeal") && target) {
      const raw = colorAmount(target, "R") * 60,
        expected = Math.max(0, raw - Math.max(0, visibleDefense(target)));
      score += expected * 1.7 + colorAmount(target, "R") * 12;
      if (target.hp <= expected) score += 140;
    }
    if (actionSkillHasEffect(a, "toxiousUnseal")) {
      score += 92 - (u.shield || 0) * 0.45;
      if (u.hp <= 35) score -= 180;
      if (canPayAction(g, t, u, "RRR")) score -= 35;
    }
    if (actionSkillHasEffect(a, "groundZero")) {
      score += 145;
      const second = g.teams[other(t)].field.find(x => x && !x.dead && x.uid !== target?.uid);
      if (second) score += 90 + (status(second, "burn") ? 0 : 34);
    }
    if (actionSkillHasEffect(a, "dustWave")) score += 102;
    if (actionSkillHasEffect(a, "abyssCannon")) {
      const n = Number(a.baseCostCount) || 0,
        amount = Math.max(0, 100 - 40 * (4 - n)),
        poison = a.paymentPlan?.R > 0 && a.paymentPlan?.W > 0 && a.paymentPlan?.B > 0;
      score += amount - n * 9 + (poison ? 55 : 0);
      if (target && target.hp <= amount) score += 120;
      if (amount === 0 && target?.lastAttackDamage > 100) score += 22;
    }
    if (actionSkillHasEffect(a, "abyssVortex")) score += 18;
    if (actionSkillHasEffect(a, "junglesVineWhip")) score += 35 + (!u.vineWhipFirstUsed ? 35 : 0) + (Object.keys(u.statuses || {}).length ? 30 : 0) + (target ? allEnergy(target) * 8 : 0);
    if (skillHasTag(u, a.skill, "summon")) score += summonLimitReached(g, t, u) ? -999 : 70;
    if (actionSkillHasEffect(a, "circuitRoundKick")) score += allBattleUnits(g, other(t), true).length * 32;
    if (actionSkillHasEffect(a, "circuitArmsBlade") && target) score += target.maxHp * .25 + 35 + fragmentDefense(u);
    if (actionSkillHasEffect(a, "circuitVoltageBurst") && target) {
      const m = colorAmount(u, "W");
      score += m * m * 15 + (g.circuitChain?.uid === u.uid ? 40 : 0);
    }
    if (actionSkillHasEffect(a, "foxStrike") && !!firstSkillByEffect(u, "foxStrike")) {
      let dmg = 80;
      if (a.strikeMode === "double" && u.strikeSingleColor && colorAmount(u, u.strikeSingleColor) >= 2 - 1e-6) dmg = 140;
      score += dmg + (target && target.hp <= dmg ? 100 : 0) + (a.strikeMode === "single" ? 8 : 0);
    }
    if (cardHasCapability(u, "resonanceTrait")) {
      if (actionSkillHasEffect(a, "elixianShiningWind")) {
        const allies = g.teams[t].field.filter(x => x && !x.dead);
        score += allies.reduce((n, x) => n + Math.min(elixianHealAmount(g, x, 20), x.maxHp - x.hp + Math.max(0, 80 - elixianHpProtection(x))), 0) * .7;
      } else if (actionSkillHasEffect(a, "elixianAromaField")) score += g.fieldEffect?.type === "aroma" && g.fieldEffect.team === t ? 10 : 105;else if (actionSkillHasEffect(a, "elixianMultiArrow")) score += g.fieldEffect?.type === "aroma" && g.fieldEffect.team === t ? 90 : 60;else if (actionSkillHasEffect(a, "elixianLastGift")) score += (200 - u.hp) * .45 + 85;
    }
    if (reactiveEnergyRule(u)) {
      const b = reactiveEnergyAmount(u);
      if (actionSkillHasEffect(a, "genociderSlashClaw")) {
        const raw = 2 * (20 + b * 10),
          kill = target && raw >= target.hp + target.shield;
        score += raw + (kill ? 115 : 0) + (u.hp / u.maxHp < .45 ? 18 : 0);
        if ((card(target)?.reflect || 0) > 0) score -= 55;
      }
      if (actionSkillHasEffect(a, "genociderDisplosion")) {
        const extra = Number(a.displosionExtraB || 0),
          raw = extra * 80,
          postB = Math.max(0, b - (a.genociderPayment?.picks || []).filter(p => p.c === "B").reduce((n, p) => n + p.a, 0)),
          postMax = state_features_genocider.GENOCIDER_BASE_HP + (traitsActive(u) ? postB * 60 : 0),
          postHp = Math.min(u.hp, postMax),
          healValue = Math.min(60, Math.max(0, postMax - postHp)),
          kill = target && raw >= target.hp + target.shield;
        score += raw + healValue * .72 + (kill ? 150 : 0) - extra * 34;
        if (!kill && healValue < 15) score -= 70 + extra * 18;
        if (raw <= 2 * (20 + b * 10) && target && 2 * (20 + b * 10) >= target.hp + target.shield) score -= 95;
        if (u.hp / u.maxHp < .38 && !kill) score -= 80;
      }
    }
    if (cardHasCapability(u, "timeControl") && actionSkillHasEffect(a, "timeRecall") && target) {
      const v = timeRecallValue(target),
        ally = a.target.team === t;
      score += ally ? v * 1.4 : -v * 1.35;
      if (ally && u.hp / u.maxHp < .45 && target.uid === u.uid) score += 35;
    }
    if (cardHasCapability(u, "timeControl") && actionSkillHasEffect(a, "hyperClock") && target) {
      const raw = a.timeHyperReason ? 160 : 100;
      score += raw + (raw >= target.hp + target.shield ? 125 : 0);
      if (a.timeHyperReason === "clockAlignment") {
        score += timeFieldUnits(g).filter(x => timeTeamOf(g, x) !== t && traitsActive(x)).length * 18 - timeFieldUnits(g).filter(x => timeTeamOf(g, x) === t && x.uid !== u.uid && traitsActive(x)).length * 10;
        const geno = timeFieldUnits(g).find(x => reactiveEnergyRule(x) && timeTeamOf(g, x) !== t);
        if (geno && geno.maxHp > state_features_genocider.GENOCIDER_BASE_HP && geno.hp > state_features_genocider.GENOCIDER_BASE_HP) score += 80;
      }
    }
    if (!!firstSkillByTag(u, "copy") && actionSkillHasTag(a, "copy")) {
      score -= 32;
      if (skillRefHasEffect(a.copySkill, "timeRecall") && target) {
        const v = timeRecallValue(target),
          ally = a.target.team === t;
        score += (ally ? v * 1.55 : -v * 1.45) + 45;
      }
      if (target && !skillRefHasEffect(a.copySkill, "timeRecall") && target.hp + target.shield <= 120) score += 55;
    }
    const pred = timePredictedClockState(g, t, s, u, a);
    if (pred) {
      const enemyTraits = timeFieldUnits(g).filter(x => timeTeamOf(g, x) !== t && x.uid !== pred.owner.uid && traitsActive(x)).length,
        allyTraits = timeFieldUnits(g).filter(x => timeTeamOf(g, x) === t && x.uid !== pred.owner.uid && traitsActive(x)).length;
      if (pred.aligned && !pred.beforeAligned) score += enemyTraits * 13 - allyTraits * 8;
      if (!pred.aligned && pred.beforeAligned) score -= enemyTraits * 8 - allyTraits * 5;
      for (const x of timeFieldUnits(g).filter(x => reactiveEnergyRule(x) && reactiveEnergyAmount(x) > 0)) {
        const value = reactiveEnergyAmount(x) * 18 + (x.hp > state_features_genocider.GENOCIDER_BASE_HP ? 30 : 0);
        if (pred.aligned && !pred.beforeAligned) score += timeTeamOf(g, x) !== t ? value : -value * .65;
      }
    }
    return score + raidActionBonus(g, t, s, a);
  } finally {
    state_engine_actions.timeTraitGame = oldTimeGame;
  }
}
export function chooseAISpecialist(g, t, s, quick = false) {
  const oldTimeGame = state_engine_actions.timeTraitGame;
  state_engine_actions.timeTraitGame = g;
  try {
    let a = chooseAICore(g, t, s, quick),
      u = unitAt(g, t, s);
    if (!a || !u) return a;
    if (actionSkillHasEffect(a, "suctionPad") && a.target) {
      const target = unitAt(g, a.target.team, a.target.slot);
      if (target) a.rDiscardSpecs = bestDiscardSpecs(target, 1);
    }
    if (actionSkillHasEffect(a, "eternaHeal")) {
      const allies = g.teams[t].field.filter(x => x && !x.dead),
        firstNeed = Math.max(0, (allies[0]?.maxHp || 0) - (allies[0]?.hp || 0)),
        secondNeed = Math.max(0, (allies[1]?.maxHp || 0) - (allies[1]?.hp || 0));
      a.healSplitPct = firstNeed + secondNeed ? Math.round(100 * firstNeed / (firstNeed + secondNeed)) : 50;
      const rTarget = allies.slice().sort((x, y) => energyValue(y) - energyValue(x))[0] || u;
      a.rTargetUid = rTarget.uid;
      a.rDiscardSpecs = bestDiscardSpecs(rTarget, 1);
    }
    if (actionSkillHasEffect(a, "toxiousUnseal")) a.unsealDiscardSpecs = bestDiscardSpecs(u, 3);
    if (actionSkillHasEffect(a, "abyssVortex")) {
      const plan = findPaymentPlan(g, t, u, "B");
      a.paymentPlan = plan;
      a.vortexSwaps = bestVortexSwaps(g, t, u, plan);
    }
    if (isNonAttackSkill(card(u).skills.find(x => x.id === a.skill))) {
      const dm = chooseDeepMindTarget(g, t);
      if (dm) a.deepMindTargetUid = dm.uid;
    }
    if (actionSkillHasEffect(a, "lifeRain")) {
      const allies = g.teams[t].field.filter(x => x && !x.dead),
        pool = lifeRainHealPool(g, u, t),
        need0 = Math.max(0, (allies[0]?.maxHp || 0) - (allies[0]?.hp || 0)),
        need1 = Math.max(0, (allies[1]?.maxHp || 0) - (allies[1]?.hp || 0));
      a.split = allies.length < 2 ? pool : Math.round(pool * (need0 / (need0 + need1 || 2)));
    }
    if (actionSkillHasEffect(a, "abyssVortex")) {
      const pairs = legalActions(g, t, s).filter(x => actionSkillHasEffect(x, "abyssVortex"));
      a = pairs.sort((x, y) => {
        const ax = x.vortexTargets.map(id => findUnit(g, id)),
          ay = y.vortexTargets.map(id => findUnit(g, id));
        return ay.reduce((n, z) => n + allEnergy(z), 0) - ax.reduce((n, z) => n + allEnergy(z), 0);
      })[0] || a;
      a.paymentPlan = findPaymentPlan(g, t, u, "B");
      const [A, B] = (a.vortexTargets || []).map(id => findUnit(g, id));
      a.vortexSwaps = [];
      if (A && B && !circuitBlocksExternal(A, u) && !circuitBlocksExternal(B, u)) {
        const sa = vortexEnergySlots(A),
          sb = vortexEnergySlots(B);
        outer: for (const ea of sa) for (const eb of sb) if (ea.c !== eb.c) {
          a.vortexSwaps = [[{
            uid: A.uid,
            actor: ea.actor,
            index: ea.index
          }, {
            uid: B.uid,
            actor: eb.actor,
            index: eb.index
          }]];
          break outer;
        }
      }
    }
    if (actionSkillHasEffect(a, "foxStrike") && !!firstSkillByEffect(u, "foxStrike")) {
      if (a.strikeMode === "double" && u.strikeSingleColor && colorAmount(u, u.strikeSingleColor) >= 2 - 1e-6) a.prefer = [u.strikeSingleColor, u.strikeSingleColor];else if (a.strikeMode === "single" && u.strikeSingleColor) a.prefer = [u.strikeSingleColor];
    }
    return a;
  } finally {
    state_engine_actions.timeTraitGame = oldTimeGame;
  }
}
export function chooseAI(g, t, s, quick = false) {
  const boss = systems.__redTimeoraBossRaid;
  const fallback = () => chooseAISpecialist(g, t, s, quick);
  if (g?.bossRaid && typeof boss?.chooseAIController === "function") return boss.chooseAIController(g, t, s, quick, fallback);
  if (g?.bossRaid) return boss?.searchChooseR32?.(g, t, s, quick) || boss?.basicChoose?.(g, t, s, quick) || fallback();
  return fallback();
}

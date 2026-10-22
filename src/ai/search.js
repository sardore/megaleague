import { raidActionReason } from "../features/boss-raid.js";

// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_ai_search = {
  AI_SKILL_PROFILE_SCORERS: undefined
};
import { actionHeuristic } from "./specialists.js";
import { legalActions, other, unitAt } from "../engine/actions.js";
import { activeIruma, damageRange, eclipseBlocks, findUnit, isStatusImmune, teamOf } from "../engine/combat.js";
import { hasNullifyTrait } from "../engine/effects.js";
import { aliveUnits, allEnergy, canPay, canPayFrom, costGap, costTokens, spendFrom, status, switchCost, totalEnergy } from "../engine/energy.js";
import { RNG, actionSkillHasEffect, actionSkillHasRuntimeKind, actionSkillHasTag, card, cardHasCapability, clone, firstSkillByEffect, makeUnit, skillDefHasEffect, skillDefHasRuntimeKind, skillDefHasTag, skillOf } from "../engine/entities.js";
import { endTurn, execute, gatherPotential } from "../engine/execution.js";
import { reactiveEnergyRule } from "../features/genocider.js";
import { energyAmountText } from "../ui/battle-state.js";
import { poolForLeague } from "../ui/deck.js";
export function initializeAiSearch() {
  state_ai_search.AI_SKILL_PROFILE_SCORERS = Object.freeze({
    mutualEnergyTrade({
      g,
      u,
      tar,
      action,
      profile
    }) {
      if (!tar) return 0;
      const n = Number(action?.interactionAmount || 0),
        baseDamage = Number(profile?.baseDamage || 0),
        perEnergyDamage = Number(profile?.perEnergyDamage || 0),
        selfDamagePerEnergy = Number(profile?.selfDamagePerEnergy || perEnergyDamage),
        mean = baseDamage * (g.variance ? 0.83 : 1),
        targetTotal = Number(tar.hp || 0) + Number(tar.shield || 0),
        kill = mean + perEnergyDamage * n >= targetTotal,
        selfDies = selfDamagePerEnergy * n >= Number(u.hp || 0),
        trade = n * selfDamagePerEnergy * (u.hp < 150 ? 1.35 : u.hp < 230 ? 0.75 : 0.4);
      let score = mean + n * 14 - trade + (kill ? 190 : 0) - (selfDies && !kill ? 480 : selfDies ? 70 : 0);
      if (!kill && n > 0 && tar.hp > mean + perEnergyDamage * n) score -= n * 12;
      return score;
    }
  });
}
export function scoreSkillAiProfile(g, u, tar, action, skill) {
  const profile = skill?.aiProfile,
    scorer = profile && state_ai_search.AI_SKILL_PROFILE_SCORERS[profile.kind];
  return typeof scorer === "function" ? Number(scorer({
    g,
    u,
    tar,
    action,
    skill,
    profile
  }) || 0) : 0;
}
export function actionHeuristicBase(g, t, s, a) {
  let u = unitAt(g, t, s),
    stall = g.stats.turns > 240;
  if (a.type === "deploy") {
    let x = g.teams[t].bench.find(v => v.uid === a.unit),
      trap = g.teams[t].traps[s];
    return 80 + x.hp * 0.15 - (trap && !isStatusImmune(x, trap.status) ? 35 : 0);
  }
  if (a.type === "scheduled" || a.type === "sequence") {
    let k = u.scheduledAction?.kind;
    return k === "bloom" ? 260 : k === "rubyFollow" ? 150 : 120;
  }
  if (a.type === "dualPass") return -8;
  if (a.type === "switch") {
    let x = g.teams[t].bench[a.bench],
      trap = g.teams[t].traps[s];
    return 5 + (u.hp / u.maxHp < 0.3 ? 28 : 0) + x.hp * 0.06 - (trap && !isStatusImmune(x, trap.status) ? 30 : 0) - (stall ? 90 : 0);
  }
  if (a.type === "gather") {
    let sc = gatherPotential(u);
    if (status(u, "burn")) sc -= 35;
    return sc;
  }
  let sk = card(u).skills.find(x => x.id === a.skill),
    tar = sk?.target === "enemySlot" ? null : a.target ? unitAt(g, a.target.team, a.target.slot) : null,
    sc = 10;
  if (!sk) return sc;
  if (sk.target === "enemySlot") {
    let tr = g.teams[other(t)].traps[a.target.slot];
    return tr ? 3 : 30 + (g.teams[other(t)].bench.length ? 18 : 0);
  }
  if (skillDefHasTag(sk, "free")) sc += 45;
  if (skillDefHasEffect(sk, "bloomingLife")) sc += u.hp < 70 ? 80 : 210;
  if (skillDefHasEffect(sk, "lifeRain")) sc += g.teams[t].field.reduce((n, x) => n + (x ? Math.max(0, x.maxHp - x.hp) : 0), 0) * 0.6 + 55;
  if (skillDefHasEffect(sk, "iceRoar")) {
    let frozenEnemies = g.teams[other(t)].field.filter(x => x && !x.dead && !isStatusImmune(x, "freeze")).length,
      ally = g.teams[t].field.find(x => x && x.uid !== u.uid);
    sc += frozenEnemies * 55 - (ally && !isStatusImmune(ally, "freeze") && !cardHasCapability(ally, "irumaCleanse") ? 45 : 0);
    if (canPayFrom(u, "WR*", "rider")) sc += 80;
  }
  if (skillDefHasEffect(sk, "rampage")) sc += (1 + (a.extra || 0)) * 10 + (tar && tar.hp <= (1 + (a.extra || 0)) * 10 ? 120 : 0) - (a.extra || 0) * 8;
  if (skillDefHasEffect(sk, "shatterLance") && tar) sc += 70 + status(tar, "freeze") * 30;
  if (skillDefHasEffect(sk, "firestorm")) sc += 150 + (u.hp > 60 ? -25 : 0);
  if (skillDefHasRuntimeKind(sk, "openingGuard")) sc += u.shield ? 45 : 125;
  if (skillDefHasRuntimeKind(sk, "dynamicDefenseSmash")) sc += 85 + (6 - (a.costOverride?.length || 0)) * 5;
  if (skillDefHasTag(sk, "copy")) sc += 75;
  if (skillDefHasEffect(sk, "holyFlame") && tar) {
    let d = Math.max(0, 100 - 20 * allEnergy(tar));
    sc += d + (100 - d) * 0.9;
  }
  if (skillDefHasEffect(sk, "prawnCharge") && tar) sc += hasNullifyTrait(tar) ? 170 : 125;
  for (const e of sk.effects) {
    if (e.type === "damage" && tar) {
      let r = damageRange(g, u, tar, e, sk),
        hits = e.hits || 1,
        mean = r.mean * hits,
        killProb = tar.shield && !e.shieldMelt ? 0 : r.min * hits >= tar.hp + (e.shieldMelt ? tar.shield : 0) ? 1 : r.max * hits < tar.hp ? 0 : (r.max * hits - tar.hp) / Math.max(1, (r.max - r.min) * hits);
      sc += mean + killProb * 120;
      if (e.shieldMelt) sc += Math.min(tar.shield, mean) * 0.5;
      if (card(tar).reflect) {
        let refl = card(tar).reflect * hits;
        if (refl >= u.hp) sc -= 220;
        if (tar.hideHits && mean / hits <= 30) sc -= 65;
      }
    }
    if (e.type === "heal" && tar) sc += Math.min(e.amount, tar.maxHp - tar.hp) * 1.3 - (tar.hp === tar.maxHp ? 50 : 0) - (stall ? 80 : 0);
    if (e.type === "shield" && tar) {
      let useful = Math.min(e.amount, Math.max(0, (e.max ?? 999) - tar.shield));
      sc += useful * (tar.shield > 45 ? 0.15 : 0.8) - (useful === 0 ? 50 : 0);
    }
    if (e.type === "status" && tar) {
      let irumaChance = g.knowledge?.unknownCandidates?.includes("iruma") ? 1 / Math.max(1, g.knowledge.unknownCandidates.length) : 0;
      sc += (e.status === "poison" ? 35 + allEnergy(tar) * 7 : e.status === "slow" ? 24 : 18) * (1 - irumaChance);
    }
    if (e.type === "statusChance" && tar) sc += e.chance * 24;
    if (e.type === "startSequence" && tar) sc += 100;
    if (e.type === "clearFieldEnergy") {
      let enemy = g.teams[other(t)].field.reduce((n, x) => n + (x && !x.dead ? allEnergy(x) : 0), 0),
        ally = g.teams[t].field.reduce((n, x) => n + (x && !x.dead ? allEnergy(x) : 0), 0);
      sc += (enemy - ally) * 22;
    }
  }
  if (status(u, "burn")) sc += 28;
  return sc;
}
export function pendingBloom(g, t) {
  return g.teams[other(t)].field.find(x => x && !x.dead && x.scheduledAction?.kind === "bloom") || null;
}
export function actionPaysEnergy(u, a) {
  if (a.type !== "skill") return false;
  let sk = card(u).skills.find(x => x.id === a.skill),
    cost = a.costOverride ?? sk?.cost ?? "";
  return costTokens(cost).length + (status(u, "poison") ? 1 : 0) > 0;
}
export function sequenceThreatening(g, t, u) {
  let slot = g.teams[t].field.findIndex(x => x?.uid === u.uid);
  return g.teams[other(t)].field.find(x => x && !x.dead && cardHasCapability(x, "sweetna") && x.scheduledAction?.kind === "sweet" && x.scheduledAction.targetTeam === t && x.scheduledAction.targetSlot === slot) || null;
}
export function megaTacticalAdjustment(g, t, s, a) {
  let u = unitAt(g, t, s),
    sc = 0;
  if (!u || u.dead) return sc;
  let bloom = pendingBloom(g, t),
    sk = a.type === "skill" ? card(u).skills.find(x => x.id === a.skill) : null,
    tar = a.target ? unitAt(g, a.target.team, a.target.slot) : null;
  if (bloom) {
    let live = g.teams[t].field.filter(x => x && !x.dead).length || 1,
      avoided = 160 / live;
    if (actionPaysEnergy(u, a)) sc += avoided + 45;
    if (tar?.uid === bloom.uid && sk) {
      let effect = sk.effects.find(e => e.type === "damage"),
        mean = effect ? damageRange(g, u, bloom, effect, sk).mean * (effect.hits || 1) : actionSkillHasEffect(a, "prawnCharge") ? 120 : actionSkillHasEffect(a, "firestorm") ? 80 : actionSkillHasEffect(a, "holyFlame") ? Math.max(0, 100 - 20 * allEnergy(bloom)) : 0;
      sc += Math.min(170, mean * 0.7) + (mean >= bloom.hp + bloom.shield ? 180 : 0);
    }
    if (actionSkillHasRuntimeKind(a, "openingGuard")) sc += 105;
    if (a.type === "gather" || a.type === "dualPass") sc -= avoided * 0.65;
  }
  if (a.type === "switch" && sequenceThreatening(g, t, u)) sc += 145;
  if (a.type === "switch") {
    let incoming = g.teams[t].bench[a.bench],
      memoryUser = g.teams[t].field.find(x => x && !x.dead && card(x).skills.some(k => skillDefHasTag(k, "copy")));
    if (incoming && !incoming.everDeployed && card(incoming).tags.includes("dragon") && memoryUser) sc -= 130;
  }
  if (cardHasCapability(u, "dualActor")) {
    let who = a.actor || g.dualActorController?.actor || "beast";
    if (a.type === "gather") {
      let wanted = who === "beast" ? "WB" : "WR*",
        gap = costGap(u, wanted, who);
      sc += Math.max(0, 55 - gap * 8);
    }
    if (actionSkillHasEffect(a, "iceRoar")) {
      let frozenTargets = g.teams[other(t)].field.filter(x => x && !x.dead && !isStatusImmune(x, "freeze")).length;
      sc += frozenTargets * 35 + (canPayFrom(u, "WR*", "rider") ? 150 : 0);
    }
    if (actionSkillHasEffect(a, "rampage")) {
      let damage = (1 + (a.extra || 0)) * 10,
        kill = tar && tar.hp <= damage;
      if (!kill && damage <= 20) sc -= 125;
      if (!kill && costGap(u, "WB", "beast") <= 1.01) sc -= 65;
    }
    if (actionSkillHasEffect(a, "shatterLance") && tar && status(tar, "freeze")) sc += 120 + status(tar, "freeze") * 25;
  }
  if (actionSkillHasEffect(a, "startSequence") && tar) {
    let poisonBlocked = isStatusImmune(tar, "poison") || !!activeIruma(g, other(t)),
      retreats = g.teams[other(t)].bench.filter(x => x && !x.dead).length,
      enemyBurst = g.teams[other(t)].field.reduce((n, x) => n + (x && !x.dead ? Math.max(0, ...card(x).skills.map(k => k.effects.find(e => e.type === "damage")?.amount || 0)) : 0), 0);
    sc += poisonBlocked ? -105 : Math.min(115, 30 + status(tar, "poison") * 20);
    sc -= retreats * 12;
    if (u.hp < enemyBurst * 0.55) sc -= 80;
    if (tar.hp <= 35) sc -= 55;
    if (activeIruma(g, other(t)) && allEnergy(tar) > 1) sc += allEnergy(tar) * 25;
  }
  return sc;
}
export function evaluate(g, me) {
  if (g.winner) return g.winner === me ? 1e6 : g.winner === "D" ? 0 : -1e6;
  let score = 0;
  for (const t of ["P", "A"]) {
    let sign = t === me ? 1 : -1,
      tm = g.teams[t];
    score += sign * aliveUnits(tm).length * 700;
    score += sign * tm.field.filter(x => x && !x.dead).length * 80;
    for (const u of aliveUnits(tm)) {
      let extra = (u.hpProtectionBarriers || []).reduce((n, x) => n + x.amount, 0);
      score += sign * (u.hp * 2 + u.shield * 1.25 + extra * 1.1 + u.defense * 3 + allEnergy(u) * 14);
      score -= sign * (status(u, "burn") * 18 + status(u, "paralyze") * 9 + status(u, "poison") * 16 + status(u, "slow") * 8);
      if (u.scheduledAction) score += sign * (u.scheduledAction.kind === "bloom" ? 190 : u.scheduledAction.kind === "rubyFollow" ? 105 : u.scheduledAction.kind === "zigzag" ? 180 : u.scheduledAction.kind === "hurricane" ? Math.max(45, u.scheduledAction.damage - u.scheduledAction.remaining * 25) : 75);
      let needs = Math.min(...card(u).skills.map(sk => costGap(u, sk.cost)));
      score -= sign * needs * 8;
    }
  }
  if (g.fieldEffect?.type === "grand") score += (g.fieldEffect.team === me ? 1 : -1) * 90;
  return score;
}
export function stateKey(g, d) {
  return d + "|" + g.turn + "|" + (g.dualActorController?.actor || "-") + "|" + (g.fieldEffect ? `${g.fieldEffect.type}:${g.fieldEffect.team}:${g.fieldEffect.ownerUid}` : "-") + "|" + ["P", "A"].flatMap(t => [...g.teams[t].field, ...g.teams[t].bench].map(u => u ? `${u.card}:${u.hp}:${u.shield}:${u.defense}:${u.attackMod || 0}:${u.defenseMod || 0}:${u.hideHits || 0}:${u.scheduledAction?.kind || "-"}:${(u.hpProtectionBarriers || []).map(x => x.amount).join(",")}:${u.energy.map(e => e.c + e.a).join("")}:${u.beastEnergy.map(e => e.c + e.a).join("")}:${u.riderEnergy.map(e => e.c + e.a).join("")}:${Object.entries(u.statuses).join()}:${Object.entries(u.skillSeals || {}).join()}` : "-")).join("|");
}
export function maskedStateFor(g, viewer) {
  let c = clone(g),
    enemy = other(viewer),
    known = g.revealed[enemy] || [],
    knownIds = new Set([...g.teams[enemy].field, ...g.teams[enemy].graveyard, ...g.teams[enemy].bench.filter(u => u && known.includes(u.uid))].filter(Boolean).map(u => u.card)),
    pool = poolForLeague(g.league).filter(id => !knownIds.has(id));
  c.knowledge = {
    viewer,
    unknownCandidates: pool
  };
  c.teams[enemy].bench = c.teams[enemy].bench.map((u, i) => u && known.includes(u.uid) ? u : u ? {
    ...makeUnit("mole", `hidden-${enemy}-${i}`),
    card: "unknown",
    name: "미공개 카드",
    hp: 190,
    maxHp: 190,
    hidden: true
  } : null);
  return c;
}
export function simExecute(g, t, s, a) {
  let c = clone(g);
  c.rng = new RNG(1);
  c.logs = [];
  execute(c, t, s, a, {
    sim: true
  });
  return c;
}
export function search(g, root, depth, alpha, beta, tt, deadline) {
  if (depth <= 0 || g.winner || performance.now() > deadline) return evaluate(g, root);
  let [t, s] = g.order[g.turn],
    acts = legalActions(g, t, s);
  if (!acts.length) {
    let c = clone(g);
    endTurn(c, t, s, false);
    return search(c, root, depth - 1, alpha, beta, tt, deadline);
  }
  acts.sort((a, b) => actionHeuristic(g, t, s, b) - actionHeuristic(g, t, s, a));
  acts = acts.slice(0, 8);
  let max = t === root,
    best = max ? -Infinity : Infinity,
    key = stateKey(g, depth);
  if (tt.has(key)) return tt.get(key);
  for (const a of acts) {
    let v;
    if (a.type === "gather") {
      v = 0;
      for (const color of ["R", "W", "B"]) v += search(simExecute(g, t, s, {
        ...a,
        color
      }), root, depth - 1, alpha, beta, tt, deadline) / 3;
    } else v = search(simExecute(g, t, s, a), root, depth - 1, alpha, beta, tt, deadline);
    if (max) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
    } else {
      best = Math.min(best, v);
      beta = Math.min(beta, v);
    }
    if (beta <= alpha || performance.now() > deadline) break;
  }
  tt.set(key, best);
  return best;
}
export function chooseAIBase(g, t, s, quick = false) {
  let acts = legalActions(g, t, s),
    u = unitAt(g, t, s);
  if (!acts.length) return null;
  if (cardHasCapability(u, "ignoreStatChanges") && !status(u, "poison") && acts.some(a => a.type === "skill" && actionSkillHasTag(a, "free"))) acts = acts.filter(a => a.type !== "gather");
  if (u && totalEnergy(u) >= (card(u).maxEnergy || 4) && gatherPotential(u) < 0 && acts.some(a => a.type === "skill" || a.type === "scheduled")) acts = acts.filter(a => a.type !== "gather");
  let scored = acts.map(a => ({
    a,
    h: actionHeuristic(g, t, s, a)
  })).sort((x, y) => y.h - x.h);
  if (quick) return scored[0].a;
  let maxDepth = g.difficulty === "hard" ? 4 : 2,
    deadline = performance.now() + (g.difficulty === "hard" ? 120 : 60),
    tt = new Map(),
    best = scored[0];
  for (let d = 1; d <= maxDepth; d++) {
    if (performance.now() > deadline) break;
    let roundBest = null,
      complete = true;
    for (const x of scored.slice(0, 8)) {
      if (performance.now() > deadline) {
        complete = false;
        break;
      }
      let v = search(simExecute(g, t, s, x.a), t, d - 1, -Infinity, Infinity, tt, deadline) + x.h * 0.08;
      if (!roundBest || v > roundBest.v) roundBest = {
        ...x,
        v
      };
    }
    if (complete && roundBest) best = roundBest;
  }
  best.a.reason = aiReason(g, t, s, best.a);
  return best.a;
}
export function applyLifeRainAiSplit(g, t, action) {
  if (!actionSkillHasEffect(action, "lifeRain")) return action;
  const allies = g.teams[t].field.filter(x => x && !x.dead);
  const values = allies.map(x => Math.max(1, (x.maxHp - x.hp) * 2 + x.lastAttackDamage + (x.hp < 80 ? 80 : 0)));
  const sum = values.reduce((n, x) => n + x, 0);
  action.split = allies.length < 2 ? 30 : Math.round(30 * values[0] / sum);
  return action;
}
export function imminentBloom(g, t) {
  return g.teams[other(t)].field.find(x => x && !x.dead && !!firstSkillByEffect(x, "bloomingLife") && !x.scheduledAction && !status(x, "freeze") && !status(x, "skillSeal") && canPay(x, "W*")) || null;
}
export function leavesPaidResponse(u, a) {
  if (a.type !== "skill") return true;
  let copy = clone(u),
    sk = card(copy).skills.find(x => x.id === a.skill),
    cost = a.costOverride ?? sk?.cost ?? "",
    actor = a.actor || null;
  if (!canPayFrom(copy, cost, actor)) return false;
  spendFrom(copy, cost, a.prefer, actor);
  return card(copy).skills.some(x => !skillDefHasEffect(x, "bloomingLife") && canPayFrom(copy, x.cost, actor));
}
export function expectedActionDamage(g, t, u, a, target) {
  if (a.type !== "skill" || !target) return 0;
  let sk = card(u).skills.find(x => x.id === a.skill),
    e = sk?.effects.find(x => x.type === "damage");
  if (e) return damageRange(g, u, target, e, sk).mean * (e.hits || 1);
  if (actionSkillHasEffect(a, "prawnCharge")) return hasNullifyTrait(target) ? 160 : 120;
  if (actionSkillHasEffect(a, "firestorm")) return 80;
  if (actionSkillHasEffect(a, "holyFlame")) return Math.max(0, 100 - 20 * allEnergy(target));
  if (actionSkillHasEffect(a, "shatterLance")) return 70 + status(target, "freeze") * 30;
  if (actionSkillHasEffect(a, "rampage")) return (1 + (a.extra || 0)) * 10;
  return 0;
}
/* Core AI owner: historically split across 12 nested wrappers. Keep one ordered layer so
   character additions feed shared capabilities/skills instead of deepening the call chain. */
export function actionHeuristicCore(g, t, s, a) {
  let sc = actionHeuristicBase(g, t, s, a),
    u = unitAt(g, t, s),
    tar = a?.target ? unitAt(g, a.target.team, a.target.slot) : null,
    sk = a?.type === "skill" ? skillOf(u, a.skill) : null;
  if (!u) return sc;
  if (actionSkillHasEffect(a, "holyFlame") && a.healTargetUid) {
    const h = findUnit(g, a.healTargetUid),
      recovery = 100 - Math.max(0, 100 - 20 * allEnergy(tar));
    sc += Math.min(recovery, Math.max(0, h.maxHp - h.hp)) * 1.2;
  }
  if (actionSkillHasEffect(a, "rampage") && canPayFrom(u, "WR*", "rider")) {
    const safeExtra = Math.max(0, totalEnergy(u, "beast") - 1),
      damage = (1 + (a.extra || 0)) * 10;
    if ((a.extra || 0) > safeExtra && tar.hp > damage) sc -= 180;
  }
  if (actionSkillHasEffect(a, "bloomingLife")) {
    const danger = g.teams[other(t)].field.reduce((n, x) => n + (x && !x.dead ? Math.max(...card(x).skills.map(sk => sk.effects.find(e => e.type === "damage")?.amount || 0)) : 0), 0);
    sc -= Math.max(0, danger - u.hp) * 0.5;
  }
  sc += megaTacticalAdjustment(g, t, s, a);
  if (cardHasCapability(u, "dualActor") && actionSkillHasEffect(a, "iceRoar") && !canPayFrom(u, "WR*", "rider")) {
    const ally = g.teams[t].field.find(x => x && !x.dead && x.uid !== u.uid),
      safe = !ally || isStatusImmune(ally, "freeze") || cardHasCapability(ally, "irumaCleanse") || ally.scheduledAction?.kind === "bloom";
    sc += safe ? -15 : -165;
  }
  if (a.type === "scheduled") {
    const q = u.scheduledAction;
    if (q?.kind === "zigzag") sc += 230;
    if (q?.kind === "hurricane") sc += q.damage - Math.max(0, q.remaining - 1) * 35;
  }
  if (actionSkillHasEffect(a, "proportionalDamage") && tar) sc += tar.hp * 0.33 + (tar.hp * 0.33 >= tar.hp ? 100 : 0);
  if (actionSkillHasEffect(a, "firstBurst") && tar) {
    const d = tar.maxHp * 0.33;
    sc += d + Math.min(d / 2, u.maxHp - u.hp) + (u.hp <= 140 && u.hp + d / 2 > 140 ? 70 : 0);
  }
  if (actionSkillHasEffect(a, "lightCandelabra") && tar) {
    if (teamOf(g, tar) === t) sc += Math.min(120, tar.maxHp - tar.hp) * 1.25 + (a.wTier === 3 ? 20 : 0);else {
      const seals = (isStatusImmune(tar, "traitSeal") ? 0 : 1) + (isStatusImmune(tar, "healSeal") ? 0 : 1) + (isStatusImmune(tar, "skillSeal") ? 0 : 1);
      sc += 100 + Math.min(a.wTier || 0, seals) * 38 + allEnergy(tar) * 8;
    }
  }
  if (actionSkillHasEffect(a, "grandField")) {
    const fx = sk?.effects?.find(e => e?.type === "grandField") || {},
      grandPresent = g.fieldEffect?.type === "grand",
      amount = grandPresent ? Number(fx.damageWhenPresent ?? fx.damageAmount ?? 40) : Number(fx.damageWhenMissing ?? fx.damageAmount ?? 40),
      deploys = !(fx.onlyIfMissing && grandPresent),
      barrier = deploys ? Math.max(0, Number(fx.barrierAmount ?? 120)) : 0,
      ally = g.teams[t].field.filter(x => x && !x.dead).length;
    sc += amount + (barrier === 120 ? ally * 92 : ally * barrier * 0.75) + (deploys ? g.fieldEffect?.team === t ? -45 : 35 : 0);
  }
  if (actionSkillHasEffect(a, "zigzagExcavate")) sc += u.hp < 70 ? 80 : 205;
  if (actionSkillHasEffect(a, "hurricaneDive") && tar) {
    const d = 30 + 70 * (a.extraW || 0),
      delay = a.extraW || 0,
      risk = delay * (u.hp < u.maxHp * 0.4 ? 55 : 25) + g.teams[other(t)].bench.filter(x => x && !x.dead).length * delay * 10;
    sc += d - risk + (d >= tar.hp + tar.shield ? 110 : 0);
  }
  if (actionSkillHasRuntimeKind(a, "selfHealStatusHit") && tar) sc += Math.min(30, u.maxHp - u.hp) * 1.3 + (isStatusImmune(tar, "slow") ? 0 : 28);
  if (a.type === "gather" && cardHasCapability(u, "eclipse") && eclipseBlocks(u)) sc += 28;
  if (a.type === "switch" && u.scheduledAction?.kind === "zigzag" && g.fieldEffect?.ownerUid === u.uid) sc -= 180;
  const aw = imminentBloom(g, t);
  if (aw) {
    if (a.type === "gather") sc += 65;
    if (actionPaysEnergy(u, a) && !leavesPaidResponse(u, a)) sc -= tar?.uid === aw.uid && expectedActionDamage(g, t, u, a, aw) >= aw.hp + aw.shield ? 0 : 120;
    if (tar?.uid === aw.uid) sc += 75;
  }
  if (a.type === "switch") {
    sc -= switchCost(u) * 32;
    if (cardHasCapability(u, "dualActor") && activeIruma(g, other(t))) sc += 210;
  }
  if (!!firstSkillByEffect(u, "mysticBurst") && a.type === "gather" && totalEnergy(u) < 3) sc += 95 - totalEnergy(u) * 15;
  if (actionSkillHasEffect(a, "mysticBurst") && tar) {
    const x = a.extraColors || {
        R: 0,
        W: 0,
        B: 0
      },
      mean = (100 + 30 * x.R) * (g.variance ? 0.83 : 1),
      healValue = Math.min(50 * x.W, Math.max(0, u.maxHp - u.hp)) * 1.25;
    let statusValue = x.B * (isStatusImmune(tar, "poison") && isStatusImmune(tar, "slow") ? 10 : 34);
    if (activeIruma(g, other(t))) statusValue -= x.B * 28;
    sc += mean + healValue + statusValue + (mean >= tar.hp + tar.shield ? 160 : 0) - 12 * (x.R + x.W + x.B);
  }
  sc += scoreSkillAiProfile(g, u, tar, a, sk);
  return sc;
}
export function chooseAICore(g, t, s, quick = false) {
  let a = chooseAIBase(g, t, s, quick),
    u = unitAt(g, t, s);
  if (!u || u.dead) return a;
  if (cardHasCapability(u, "dualActor")) {
    const acts = legalActions(g, t, s),
      who = g.dualActorController?.actor || "beast";
    if (who === "beast") {
      const roar = acts.find(x => actionSkillHasEffect(x, "iceRoar"));
      if (roar && canPayFrom(u, "WR*", "rider")) a = roar;else if (actionSkillHasEffect(a, "rampage") && (1 + (a.extra || 0)) * 10 <= 20 && !acts.some(x => actionSkillHasEffect(x, "rampage") && unitAt(g, x.target.team, x.target.slot)?.hp <= (1 + (x.extra || 0)) * 10)) {
        const gather = acts.find(x => x.type === "gather");
        if (gather && costGap(u, "WB", "beast") > 0) a = gather;
      }
    } else {
      const lances = acts.filter(x => actionSkillHasEffect(x, "shatterLance") && status(unitAt(g, x.target.team, x.target.slot), "freeze"));
      if (lances.length) {
        lances.sort((x, y) => status(unitAt(g, y.target.team, y.target.slot), "freeze") - status(unitAt(g, x.target.team, x.target.slot), "freeze"));
        a = lances[0];
      }
    }
  }
  if (pendingBloom(g, t) && !actionPaysEnergy(u, a)) {
    const paid = legalActions(g, t, s).filter(x => actionPaysEnergy(u, x)).sort((x, y) => actionHeuristic(g, t, s, y) - actionHeuristic(g, t, s, x));
    if (paid.length && actionHeuristic(g, t, s, paid[0]) > actionHeuristic(g, t, s, a)) a = paid[0];
  }
  applyLifeRainAiSplit(g, t, a);
  const bloom = pendingBloom(g, t);
  if (bloom) {
    const acts = legalActions(g, t, s),
      focus = acts.filter(x => x.target && unitAt(g, x.target.team, x.target.slot)?.uid === bloom.uid).sort((x, y) => actionHeuristic(g, t, s, y) - actionHeuristic(g, t, s, x)),
      lethal = focus.find(x => expectedActionDamage(g, t, u, x, bloom) >= bloom.hp + bloom.shield),
      paid = acts.filter(x => actionPaysEnergy(u, x)).sort((x, y) => actionHeuristic(g, t, s, y) - actionHeuristic(g, t, s, x)),
      paidFocus = focus.filter(x => actionPaysEnergy(u, x));
    if (lethal) a = lethal;else if (paidFocus.length) a = paidFocus[0];else if (paid.length) a = paid[0];else if (focus[0] && actionHeuristic(g, t, s, focus[0]) > actionHeuristic(g, t, s, a)) a = focus[0];
  }
  if (cardHasCapability(u, "dualActor") && (g.dualActorController?.actor || "beast") === "beast") {
    const acts = legalActions(g, t, s),
      roar = acts.find(x => actionSkillHasEffect(x, "iceRoar"));
    if (roar) a = roar;else if (actionSkillHasEffect(a, "rampage")) {
      const tar = unitAt(g, a.target.team, a.target.slot),
        damage = (1 + (a.extra || 0)) * 10,
        gather = acts.find(x => x.type === "gather");
      if (tar && tar.hp > damage && damage < 50 && gather && costGap(u, "WB", "beast") > 0) a = gather;
    }
  }
  if (cardHasCapability(u, "dualActor") && activeIruma(g, other(t)) && (g.dualActorController?.actor || "beast") === "beast") {
    const swaps = legalActions(g, t, s).filter(x => x.type === "switch").sort((x, y) => actionHeuristic(g, t, s, y) - actionHeuristic(g, t, s, x));
    if (swaps.length) a = swaps[0];
  }
  const energyTradeSkillIds = new Set(card(u).skills.filter(sk => sk.aiProfile?.kind === "mutualEnergyTrade").map(sk => sk.id));
  if (!!firstSkillByEffect(u, "mysticBurst") || energyTradeSkillIds.size) {
    const acts = legalActions(g, t, s),
      gather = acts.find(x => x.type === "gather"),
      canHuveSkill = acts.some(x => actionSkillHasEffect(x, "mysticBurst") || energyTradeSkillIds.has(x.skill) || actionSkillHasTag(x, "fieldClear"));
    if (!canHuveSkill && gather) {
      const safeKill = acts.filter(x => energyTradeSkillIds.has(x.skill)).some(x => {
        const tar = unitAt(g, x.target.team, x.target.slot),
          sk = skillOf(u, x.skill),
          profile = sk?.aiProfile || {},
          n = Number(x.interactionAmount || 0),
          mean = Number(profile.baseDamage || 0) * (g.variance ? 0.83 : 1),
          per = Number(profile.perEnergyDamage || 0),
          selfPer = Number(profile.selfDamagePerEnergy || per);
        return mean + per * n >= tar.hp + tar.shield && selfPer * n < u.hp;
      });
      if (!safeKill && (totalEnergy(u) < 5 || gatherPotential(u) > 0)) a = gather;
    }
  }
  return a;
}
export function aiReason(g, t, s, a) {
  const raidReason = raidActionReason(g, t, s, a);
  if (raidReason) return raidReason;
  let u = unitAt(g, t, s);
  if (reactiveEnergyRule(u) && actionSkillHasEffect(a, "genociderDisplosion")) return `추가 B ${energyAmountText(a.displosionExtraB || 0)} 소비 후 최대 HP·회복·처형 가능성을 비교해 디스플로전을 선택했다.`;
  if (reactiveEnergyRule(u) && actionSkillHasEffect(a, "genociderSlashClaw")) return `B를 유지한 체급과 2타 처형 가능성을 비교해 슬래시클로를 선택했다.`;
  if (a.type === "deploy") return `공개된 슬롯 함정과 역할 기대값을 비교해 자기 후열 카드를 출전시켰다.`;
  if (a.type === "scheduled" || a.type === "sequence") return `예약된 공격을 자동 실행했다.`;
  if (a.type === "dualPass") return `다음 복합 행동의 에너지를 보존했다.`;
  if (a.type === "switch") return cardHasCapability(u, "dualActor") && activeIruma(g, other(t)) ? `상대 이루마가 냉동을 즉시 치료하므로 빙마기수를 교체했다.` : `${u.name}의 생존·교체 코스트·남은 교체 횟수를 비교해 교체했다.`;
  if (a.type === "gather") return `${u.name}의 실제 기술 완성에 도움이 되는 에너지를 준비했다.`;
  let sk = skillOf(u, a.skill);
  if (sk?.target === "enemySlot") return `후열 출전을 압박할 슬롯에 ${sk.name}을 설치했다.`;
  let tar = a.target ? unitAt(g, a.target.team, a.target.slot) : null;
  return `${tar?.name || "필드"}에 대한 처치·보호·예약 효과를 비교해 ${sk?.name || a.label}을 선택했다.`;
}

// UI

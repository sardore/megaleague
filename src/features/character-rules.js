import { state_runtime_entities } from "../runtime/entities.js";
import { healingBecomesDamage } from '../engine/status-rules.js';
import { activeAbigate, isLocallyControlledTeam, isNonAttackSkill, resolvedSkillForAction } from "../app/controls.js";
import { enemyTargets, other, unitAt } from "../engine/actions.js";
import { applyStatus, dealDamage, findUnit, heal, nonAttackDamage, queueVisual, teamOf } from "../engine/combat.js";
import { allEnergy, allPaymentPlans, energyStore, gainEnergy, notifyReactiveEnergyMutation, parseCost, status, totalEnergy } from "../engine/energy.js";
import { card, cardHasCapability, skillIdByEffect, skillIdByEffectGlobal } from "../engine/entities.js";
import { circuitBlocksExternal } from "./summons.js";
import { log } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
import { energyAmountText } from "../ui/battle-state.js";
export function colorAmount(u, color) {
  const stores = cardHasCapability(u, "dualActor") ? [u.beastEnergy || [], u.riderEnergy || []] : [u.energy || []];
  return stores.reduce((sum, store) => sum + store.reduce((n, e) => n + (e.c === color ? e.a : 0), 0), 0);
}
export function clearColorEnergy(u, color, source = null) {
  try {
    if (typeof circuitBlocksExternal === "function" && circuitBlocksExternal(u, source)) return 0;
    let removed = 0;
    const stores = cardHasCapability(u, "dualActor") ? [u.beastEnergy || [], u.riderEnergy || []] : [u.energy || []];
    for (const store of stores) for (let i = store.length - 1; i >= 0; i--) if (store[i].c === color) {
      removed += store[i].a;
      store.splice(i, 1);
    }
    const result = +removed.toFixed(1);
    notifyReactiveEnergyMutation(null, u, false, "색 에너지 제거");
    return result;
  } finally {
    if (typeof state_runtime_entities.EnergyEngine !== "undefined") state_runtime_entities.EnergyEngine.ensureStore(u);
  }
}
export function energyStoresWithLabels(u) {
  if (cardHasCapability(u, "dualActor")) return [{
    actor: "beast",
    store: u.beastEnergy || []
  }, {
    actor: "rider",
    store: u.riderEnergy || []
  }];
  return [{
    actor: null,
    store: u.energy || []
  }];
}
export function applyDiscardSpecs(u, specs = [], actor = null) {
  const store = energyStore(u, actor);
  let removed = 0;
  for (const spec of (specs || []).slice(0, 1)) {
    let i = -1;
    for (let j = store.length - 1; j >= 0; j--) if (store[j].c === spec.c && Math.abs(store[j].a - spec.a) < 0.001) {
      i = j;
      break;
    }
    if (i < 0) continue;
    removed += store[i].a;
    store.splice(i, 1);
  }
  return +removed.toFixed(1);
}
export function enumerateDiscardSpecs(entries, need) {
  const out = [],
    seen = new Set();
  (entries || []).forEach(e => {
    if (Number(e?.a || 0) + 1e-6 < need) return;
    const key = `${e.c}:${e.a}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      specs: [{
        c: e.c,
        a: e.a
      }],
      amount: Number(e.a || 0)
    });
  });
  return out.sort((a, b) => a.amount - b.amount || String(a.specs[0].c).localeCompare(String(b.specs[0].c)));
}
export function bestDiscardSpecs(u, incomingAmount = 1, actor = null) {
  const store = energyStore(u, actor),
    need = Math.max(0, totalEnergy(u, actor) + Math.min(1, Math.max(.5, Number(incomingAmount) || 0)) - (card(u).maxEnergy || 4));
  if (need <= 0.001) return [];
  const options = enumerateDiscardSpecs(store.map(e => ({
    c: e.c,
    a: e.a
  })), need);
  if (!options.length) return [];
  let best = options[0],
    bestScore = -Infinity;
  for (const op of options) {
    const cloneStore = store.map(e => ({
      ...e
    }));
    for (const spec of op.specs) {
      let i = cloneStore.findIndex(e => e.c === spec.c && Math.abs(e.a - spec.a) < 0.001);
      if (i >= 0) cloneStore.splice(i, 1);
    }
    cloneStore.push({
      c: "R",
      a: Math.min(1, Math.max(.5, Number(incomingAmount) || 0))
    });
    let score = cloneStore.reduce((n, e) => n + (e.c === "R" ? 1.15 : e.c === "W" ? 1 : 0.95) * e.a, 0);
    if (score > bestScore) {
      bestScore = score;
      best = op;
    }
  }
  return best.specs;
}
export function grantEnergyWithDiscard(g, u, color, amount = 1, specs = null, actor = null) {
  const overflowIntercept = systems.__megaEnergyOverflowChoice?.interceptGrant?.(g, u, color, amount, specs, actor);
  if (overflowIntercept?.handled) return overflowIntercept.value;
  const max = card(u).maxEnergy || 4,
    overflow = totalEnergy(u, actor) + amount - max;
  if (overflow > 0.001) {
    const chosen = Array.isArray(specs) ? specs.slice(0, 1) : bestDiscardSpecs(u, amount, actor);
    if (chosen.length !== 1 || Number(chosen[0]?.a || 0) + 1e-6 < overflow) return false;
    const removed = applyDiscardSpecs(u, chosen, actor);
    if (removed) log(g, `${u.name}: 기존 에너지 하나(${chosen[0].c}${chosen[0].a === .5 ? "½" : ""})를 버리고 ${color}${amount === 0.5 ? "½" : ""} 획득 준비.`);
  }
  return gainEnergy(g, u, color, amount, null, actor);
}
export function healPoolWithOverflow(g, units, pool, splitPct = 50, source = null, meta = {}) {
  units = units.filter(u => u && !u.dead);
  pool = Math.max(0, Number(pool) || 0);
  if (!units.length || pool <= 0) return 0;
  if (units.length === 1) return heal(g, units[0], pool, source, meta);
  const pct = Math.max(0, Math.min(100, Number(splitPct) || 0));
  let requested = [Math.round(pool * pct / 100), Math.round(pool - Math.round(pool * pct / 100))],
    remaining = pool,
    healed = 0;
  for (let pass = 0; pass < 2 && remaining > 0.001; pass++) {
    for (let i = 0; i < units.length && remaining > 0.001; i++) {
      if (units[i].dead) continue;
      let ask = pass === 0 ? Math.min(remaining, requested[i]) : remaining;
      if (ask <= 0) continue;
      const inverted = healingBecomesDamage(units[i]);
      let got = heal(g, units[i], ask, source, meta);
      healed += got;
      remaining -= inverted ? ask : got;
    }
  }
  return healed;
}
export function deepMindEnergyEntries(u) {
  const out = [];
  for (const {
    actor,
    store
  } of energyStoresWithLabels(u)) store.forEach((e, index) => out.push({
    actor,
    store,
    index,
    e
  }));
  return out;
}
export function removeDeepMindHalf(g, target, source) {
  if (typeof circuitBlocksExternal === "function" && circuitBlocksExternal(target, source)) {
    log(g, `${target.name} 특성 · 프레그먼트: 딥마인드 에너지 조작 차단.`);
    return 0;
  }
  const entries = deepMindEnergyEntries(target);
  if (!entries.length) {
    log(g, `${target.name}: 딥마인드로 제거할 에너지가 없음.`);
    return 0;
  }
  let chosen = null;
  for (let i = entries.length - 1; i >= 0; i--) if (Math.abs(entries[i].e.a - 0.5) < 0.001) {
    chosen = entries[i];
    break;
  }
  if (chosen) {
    chosen.store.splice(chosen.index, 1);
    source.energyDisrupt += 0.5;
    log(g, `${source.name} 특성 · 딥마인드: ${target.name}의 ${chosen.e.c}½ 제거.`);
    queueVisual(g, {
      type: "deepMindChip",
      uid: source.uid,
      targetUid: target.uid,
      color: chosen.e.c
    });
    return 0.5;
  }
  chosen = entries[entries.length - 1];
  chosen.e.a = Math.max(0, chosen.e.a - 0.5);
  source.energyDisrupt += 0.5;
  log(g, `${source.name} 특성 · 딥마인드: ${target.name}의 최근 ${chosen.e.c}를 ${chosen.e.c}½로 감소.`);
  queueVisual(g, {
    type: "deepMindChip",
    uid: source.uid,
    targetUid: target.uid,
    color: chosen.e.c
  });
  return 0.5;
}
export function chooseDeepMindTarget(g, ownerTeam) {
  const enemies = g.teams[other(ownerTeam)].field.filter(u => u && !u.dead && allEnergy(u) > 0.001);
  if (!enemies.length) return null;
  return enemies.slice().sort((a, b) => {
    const ah = deepMindEnergyEntries(a).some(x => x.e.a === 0.5),
      bh = deepMindEnergyEntries(b).some(x => x.e.a === 0.5);
    if (ah !== bh) return bh - ah;
    return allEnergy(b) - allEnergy(a);
  })[0];
}
export function triggerDeepMind(g, actingTeam, actor, passedTarget, action = {}, resolvedSkill = null) {
  const abigate = activeAbigate(g, actingTeam);
  if (!abigate) return false;
  const sk = resolvedSkill || resolvedSkillForAction(actor, action);
  if (!isNonAttackSkill(sk)) return false;
  let target = passedTarget;
  if (sk?.target === "enemySlot") target = null;
  if (target && !target.dead) {
    const got = heal(g, target, 10, abigate, {
      reason: "deep-mind",
      effectId: "deepMind"
    });
    queueVisual(g, {
      type: "deepMindHeal",
      uid: abigate.uid,
      targetUid: target.uid,
      amount: got
    });
  }
  const forcedUid = action.deepMindTargetUid,
    forced = forcedUid ? findUnit(g, forcedUid) : null;
  if (forced && !forced.dead && teamOf(g, forced) === other(actingTeam) && allEnergy(forced) > 0.001) {
    removeDeepMindHalf(g, forced, abigate);
    return true;
  }
  const candidates = g.teams[other(actingTeam)].field.filter(u => u && !u.dead && allEnergy(u) > 0.001);
  if (!candidates.length) {
    log(g, `${abigate.name} 특성 · 딥마인드: 제거할 상대 에너지가 없음.`);
    return true;
  }
  if (isLocallyControlledTeam(g, actingTeam)) {
    g.pendingTraitChoices.push({
      kind: "deepMind",
      sourceUid: abigate.uid,
      ownerTeam: actingTeam,
      targetUids: candidates.map(u => u.uid)
    });
    return true;
  }
  const picked = chooseDeepMindTarget(g, actingTeam);
  if (picked) removeDeepMindHalf(g, picked, abigate);
  return true;
}
export function deepTrioDamageSkill(g, actor, target, amount, skill, sim, effect = {}) {
  return dealDamage(g, actor, target, {
    amount,
    ...effect
  }, skill, sim);
}
export function applyVortexSwaps(g, actor, swaps = []) {
  const slots = () => {
    const map = new Map();
    for (const t of ["P", "A"]) for (const u of g.teams[t].field) {
      if (!u || u.dead) continue;
      for (const {
        actor: part,
        store
      } of energyStoresWithLabels(u)) store.forEach((e, index) => map.set(`${u.uid}:${part || "main"}:${index}`, {
        u,
        part,
        store,
        index,
        e
      }));
    }
    return map;
  };
  let count = 0;
  for (const pair of Array.isArray(swaps) ? swaps : []) {
    const map = slots(),
      a = map.get(pair?.[0]),
      b = map.get(pair?.[1]);
    if (!a || !b || a === b) continue;
    const ca = a.e.c;
    a.e.c = b.e.c;
    b.e.c = ca;
    count++;
  }
  if (count) log(g, `${actor.name}: 심해의소용돌이로 에너지 색 위치 ${count}회 교환.`);else log(g, `${actor.name}: 심해의소용돌이를 교환 없이 완료.`);
  queueVisual(g, {
    type: "vortexSwapFx",
    uid: actor.uid,
    swaps: count
  });
  return count;
}
export function bestVortexSwaps(g, t, actor, paymentPlan = null) {
  const cloneStores = new Map(),
    slots = [];
  for (const teamName of ["P", "A"]) for (const u of g.teams[teamName].field) {
    if (!u || u.dead) continue;
    for (const {
      actor: part,
      store
    } of energyStoresWithLabels(u)) {
      const key = `${u.uid}:${part || "main"}`,
        cp = store.map(e => ({
          ...e
        }));
      cloneStores.set(key, cp);
      cp.forEach((e, index) => slots.push({
        key: `${u.uid}:${part || "main"}:${index}`,
        uid: u.uid,
        team: teamName,
        part,
        index,
        c: e.c,
        a: e.a
      }));
    }
  }
  if (paymentPlan) {
    const actorSlots = slots.filter(x => x.uid === actor.uid);
    for (const c of "RWB") {
      let left = paymentPlan[c] || 0;
      for (let i = actorSlots.length - 1; i >= 0 && left > 0.001; i--) {
        const e = actorSlots[i];
        if (e.c !== c) continue;
        const take = Math.min(e.a, left);
        e.a -= take;
        left -= take;
      }
    }
  }
  const live = slots.filter(x => x.a > 0.001);
  const value = (slot, color) => {
    const holder = findUnit(g, slot.uid),
      own = slot.team === t,
      need = card(holder).skills.reduce((n, sk) => {
        const req = parseCost(sk.cost);
        return n + (req[color] || 0) * 9 + (req.any || 0) * 2;
      }, 0);
    return (own ? 1 : -1) * (need + (color === "R" && cardHasCapability(holder, "switchLockTrait") ? 16 : 0));
  };
  let best = null;
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    if (live[i].c === live[j].c) continue;
    const gain = value(live[i], live[j].c) + value(live[j], live[i].c) - value(live[i], live[i].c) - value(live[j], live[j].c);
    if (!best || gain > best.gain) best = {
      gain,
      pair: [live[i].key, live[j].key]
    };
  }
  return best && best.gain > 0 ? [best.pair] : [];
}

/* ─────────────────────────────────────────────────────────────
   13th~14th 4☆: 정글즈 · 서킷 / 이루마·이그드라실·아비게이트 패치
───────────────────────────────────────────────────────────── */

export function listDeepSeaActions(g, t, s) {
  let actions = [],
    u = unitAt(g, t, s);
  if (!u || u.dead) return actions;
  if (u.scheduledAction || status(u, "freeze") || status(u, "skillSeal")) return actions;
  if (cardHasCapability(u, "switchLockTrait") && !u.skillSeals?.[skillIdByEffect(u, "suctionPad")]) {
    const padPlans = status(u, "poison") ? allPaymentPlans(g, t, u, "") : [{
      R: 0,
      W: 0,
      B: 0
    }];
    for (const teamName of [t, other(t)]) g.teams[teamName].field.forEach((target, slot) => {
      if (!target || target.dead) return;
      for (const plan of padPlans) actions.push({
        type: "skill",
        skill: skillIdByEffectGlobal("suctionPad"),
        paymentPlan: {
          ...plan
        },
        target: {
          team: teamName,
          slot,
          uid: target.uid
        },
        label: `흡착 발판 → ${target.name}`
      });
    });
  }
  if (cardHasCapability(u, "deepMind") && !u.skillSeals?.[skillIdByEffect(u, "abyssCannon")]) {
    const targets = enemyTargets(g, t);
    for (let n = 0; n <= 4; n++) {
      const cost = "*".repeat(n),
        plans = n === 0 && !status(u, "poison") ? [{
          R: 0,
          W: 0,
          B: 0
        }] : allPaymentPlans(g, t, u, cost);
      for (const plan of plans) for (const target of targets) actions.push({
        type: "skill",
        skill: skillIdByEffectGlobal("abyssCannon"),
        costOverride: cost,
        paymentPlan: {
          ...plan
        },
        baseCostCount: n,
        target,
        label: `초저주포 · ${n}E · ${Math.max(0, 100 - 40 * (4 - n))}D${plan.R > 0 && plan.W > 0 && plan.B > 0 ? " · 독" : ""}`
      });
    }
  }
  return actions;
}
export function applyDeepSeaEffect(g, actor, target, e, skill, ctx) {
  const actingTeam = ctx?.team || teamOf(g, actor);
  if (e.type === "suctionPad") {
    if (circuitBlocksExternal(target, actor)) {
      if (teamOf(g, target) === actingTeam) nonAttackDamage(g, target, 20, "흡착 발판");
      log(g, target.name + " 특성 · 프레그먼트: 흡착 발판의 R 부여 차단.");
      return 0;
    }
    const action = ctx.action || {},
      allied = teamOf(g, target) === actingTeam,
      ok = grantEnergyWithDiscard(g, target, "R", 1, action.rDiscardSpecs || null);
    if (ok) {
      log(g, `${actor.name}: 흡착 발판으로 ${target.name}에게 R 1 부여.`);
    } else log(g, `${target.name}: 에너지 상한으로 흡착 발판 R 부여 실패.`);
    let d = 0;
    if (allied && !target.dead) {
      d = nonAttackDamage(g, target, 20, "흡착 발판");
    }
    queueVisual(g, {
      type: "deepTrioFx",
      skill: skillIdByEffectGlobal("suctionPad"),
      uid: actor.uid,
      targetUid: target.uid,
      allied
    });
    return d;
  }
  if (e.type === "eternaHeal") {
    const action = ctx.action || {},
      r = colorAmount(target, "R"),
      raw = Math.round(r * 60),
      dealt = deepTrioDamageSkill(g, actor, target, raw, skill, ctx.sim),
      removed = clearColorEnergy(target, "R", actor);
    log(g, `${target.name}: 이터너힐 처리 후 R ${energyAmountText(removed)}개 분량 전부 제거.`);
    const allies = g.teams[actingTeam].field.filter(u => u && !u.dead),
      hpBeforeHeal = new Map(allies.map(u => [u.uid, u.hp])),
      healed = healPoolWithOverflow(g, allies, dealt / 2, action.healSplitPct ?? 50, actor, {
        reason: "eterna-heal",
        effectId: skill?.id || "eternaHeal",
        sim: ctx.sim
      }),
      healResults = allies.map(u => ({
        uid: u.uid,
        amount: Math.max(0, u.hp - (hpBeforeHeal.get(u.uid) || 0))
      })).filter(x => x.amount > 0);
    let rTarget = action.rTargetUid ? findUnit(g, action.rTargetUid) : actor;
    if (!rTarget || rTarget.dead || teamOf(g, rTarget) !== actingTeam || !g.teams[actingTeam].field.some(u => u?.uid === rTarget.uid)) rTarget = actor.dead ? allies[0] : actor;
    if (rTarget) grantEnergyWithDiscard(g, rTarget, "R", 1, action.rDiscardSpecs || null);
    queueVisual(g, {
      type: "deepTrioFx",
      skill: skillIdByEffectGlobal("eternaHeal"),
      uid: actor.uid,
      targetUid: target.uid,
      r,
      healResults,
      rTargetUid: rTarget?.uid || null
    });
    return dealt;
  }
  if (e.type === "toxiousUnseal") {
    const action = ctx.action || {},
      broken = Math.max(0, actor.shield || 0);
    actor.shield = 0;
    log(g, `${actor.name}: 봉인 해제로 실드 ${broken} 전부 파괴.`);
    const selfDamage = nonAttackDamage(g, actor, 20, "봉인 해제");
    if (!actor.dead) {
      const incoming = 3,
        overflow = Math.max(0, totalEnergy(actor) + incoming - (card(actor).maxEnergy || 4));
      if (overflow > 0.001) {
        const specs = action.unsealDiscardSpecs || bestDiscardSpecs(actor, incoming);
        const removed = applyDiscardSpecs(actor, specs);
        if (removed) log(g, `${actor.name}: RRR 획득 공간 확보를 위해 ${energyAmountText(removed)}E 버림.`);
      }
      for (let i = 0; i < 3; i++) {
        if (totalEnergy(actor) + 1 <= (card(actor).maxEnergy || 4) + 0.001) {
          gainEnergy(g, actor, "R", 1);
          log(g, `${actor.name}: 봉인 해제 R ${i + 1}/3 획득.`);
        }
      }
    }
    queueVisual(g, {
      type: "deepTrioFx",
      skill: skillIdByEffectGlobal("toxiousUnseal"),
      uid: actor.uid,
      targetUid: actor.uid
    });
    return selfDamage;
  }
  if (e.type === "groundZero") {
    const main = deepTrioDamageSkill(g, actor, target, 140, skill, ctx.sim),
      otherTarget = g.teams[other(actingTeam)].field.find(u => u && !u.dead && u.uid !== target.uid);
    let splash = 0;
    if (otherTarget) {
      splash = deepTrioDamageSkill(g, actor, otherTarget, 70, skill, ctx.sim);
      if (!otherTarget.dead) applyStatus(g, otherTarget, "burn", 4, actor);
    }
    queueVisual(g, {
      type: "deepTrioFx",
      skill: skillIdByEffectGlobal("groundZero"),
      uid: actor.uid,
      targetUid: target.uid,
      secondaryUid: otherTarget?.uid || null
    });
    return main + splash;
  }
  if (e.type === "dustWave") {
    const dealt = deepTrioDamageSkill(g, actor, target, 100, skill, ctx.sim);
    queueVisual(g, {
      type: "deepTrioFx",
      skill: skillIdByEffectGlobal("dustWave"),
      uid: actor.uid,
      targetUid: target.uid
    });
    return dealt;
  }
  if (e.type === "abyssCannon") {
    const action = ctx.action || {},
      n = Math.max(0, Math.min(4, Number(action.baseCostCount) || 0)),
      amount = Math.max(0, 100 - 40 * (4 - n)),
      dealt = deepTrioDamageSkill(g, actor, target, amount, skill, ctx.sim),
      basePlan = action.basePaymentPlan || action.paymentPlan || {
        R: ctx.paid.filter(x => x.c === "R").reduce((z, x) => z + x.a, 0),
        W: ctx.paid.filter(x => x.c === "W").reduce((z, x) => z + x.a, 0),
        B: ctx.paid.filter(x => x.c === "B").reduce((z, x) => z + x.a, 0)
      },
      poison = basePlan.R > 0 && basePlan.W > 0 && basePlan.B > 0;
    if (poison && !target.dead) {
      const duration = 3;
      applyStatus(g, target, "poison", duration, actor);
    }
    queueVisual(g, {
      type: "deepTrioFx",
      skill: skillIdByEffectGlobal("abyssCannon"),
      uid: actor.uid,
      targetUid: target.uid,
      n,
      poison
    });
    return dealt;
  }
  return;
}

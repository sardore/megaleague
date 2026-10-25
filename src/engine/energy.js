// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_engine_energy = {
  dualActorController: undefined
};
import { state_runtime_entities } from "../runtime/entities.js";
import { downPressureSource, eternaLocksTeam } from "../app/controls.js";
import { other } from "./actions.js";
import { heal, hpBarrierStanceActive, nonAttackDamage, teamOf, traitsActive } from "./combat.js";
import { state_engine_effects } from "./effects.js";
import { actionFaultHit, card, cardHasCapability } from "./entities.js";
import { circuitIgnoresCostChanges, rawReqFromCost } from "../features/foxious.js";
import { reactiveEnergyRule, reconcileReactiveEnergy, state_features_genocider } from "../features/genocider.js";
import { log } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
export function energyStore(u, actor = null) {
  let __result;
  __energyStoreCore: {
    {
      __result = cardHasCapability(u, "dualActor") ? actor === "rider" ? u.riderEnergy : u.beastEnergy : u.energy;
      break __energyStoreCore;
    }
  }
  if (typeof state_runtime_entities.EnergyEngine !== "undefined") for (const entry of __result || []) state_runtime_entities.EnergyEngine.ensureEntry(entry, u?.entityId || u?.uid || "entity");
  return __result;
}
export function totalEnergy(u, actor = null) {
  return energyStore(u, actor).reduce((a, e) => a + e.a, 0);
}
export function allEnergy(u) {
  return cardHasCapability(u, "dualActor") ? totalEnergy(u, "beast") + totalEnergy(u, "rider") : totalEnergy(u);
}
export function status(u, s) {
  return u.statuses[s] || 0;
}
export function aliveUnits(t) {
  return [...t.field, ...t.bench].filter(u => u && !u.dead);
}
export function statusDurationTotal(u) {
  let common = Object.values(u.statuses || {}).reduce((n, d) => n + Math.max(0, Number(d) || 0), 0),
    skillSeals = Object.values(u.skillSeals || {}).reduce((n, d) => n + Math.max(0, Number(d) || 0), 0);
  return common + skillSeals;
}
export function switchCost(u) {
  return Math.max(0, 1 - (card(u).speed || 0) + statusDurationTotal(u));
}
export function switchCostText(u) {
  let n = switchCost(u);
  return n ? "*".repeat(n) : "무료";
}
export function canSwitch(g, t, u) {
  if (hpBarrierStanceActive(g, u) && card(u).hpBarrierStance.blockRetreat) return false;
  if (g?.bossRaid && t === "A") return false;
  if (typeof eternaLocksTeam === "function" && eternaLocksTeam(g, t)) return false;
  let cost = switchCost(u),
    actor = cardHasCapability(u, "dualActor") ? "beast" : null;
  return (g.teams[t].switchUses || 0) < 3 && canPayFrom(u, "*".repeat(cost), actor);
}
export function initializeDeployment(g, u) {
  if (!u) return;
  const speed = Number(card(u).speed || 0);
  u.turnEndHp = u.hp;
  u.speedDelayTurns = Math.max(0, -speed);
  if (u.speedDelayTurns) log(g, `${u.name}: Speed ${speed} 출전 지연 ${u.speedDelayTurns}턴.`);
  if (!u.everDeployed) {
    u.everDeployed = true;
    if (cardHasCapability(u, "dualActor") && !u.dualInitialized) {
      const team = teamOf(g, u);
      u.beastEnergy = [];
      u.riderEnergy = [];
      const beast = state_engine_effects.ENERGY_GAIN_SERVICE.grant({
        game: g,
        recipient: u,
        team,
        actor: "beast",
        source: "deployment-iceknight-beast",
        candidates: ["R", "W", "B"],
        amount: 1,
        store: u.beastEnergy
      }, null, {
        suppressTriggers: true
      });
      const rider = state_engine_effects.ENERGY_GAIN_SERVICE.grant({
        game: g,
        recipient: u,
        team,
        actor: "rider",
        source: "deployment-iceknight-rider",
        candidates: ["R", "W", "B"],
        amount: 1,
        store: u.riderEnergy
      }, null, {
        suppressTriggers: true
      });
      u.dualInitialized = true;
      log(g, `${u.name}: 빙마 ${beast.color}, 기수 ${rider.color} 시작 에너지 획득.`);
    } else if (speed > 0) {
      const team = teamOf(g, u),
        gained = [];
      for (let i = 0; i < speed; i++) {
        const result = state_engine_effects.ENERGY_GAIN_SERVICE.grant({
          game: g,
          recipient: u,
          team,
          source: "speed-start",
          candidates: ["R", "W", "B"],
          amount: 1
        }, null, {
          suppressTriggers: true
        });
        if (result.gained) gained.push(result.color);
      }
      log(g, `${u.name}: Speed +${speed}로 시작 에너지 ${gained.join("+") || "없음"} 획득.`);
    }
  }
}
export function initializeEngineEnergy() {
  state_engine_energy.dualActorController = {
    begin(g, u) {
      g.dualActorController = {
        uid: u.uid,
        actor: "beast"
      };
    },
    toRider(g, u) {
      if (g.dualActorController?.uid === u.uid) g.dualActorController.actor = "rider";
    },
    current(g, u) {
      return g.dualActorController?.uid === u.uid ? g.dualActorController.actor : null;
    },
    clear(g) {
      g.dualActorController = null;
    }
  };
}
export function costTokens(str = "") {
  let out = [];
  for (let i = 0; i < str.length;) {
    if (["WorB", "RorB"].includes(str.slice(i, i + 4))) {
      out.push(str.slice(i, i + 4));
      i += 4;
    } else if ("RWB*".includes(str[i])) {
      out.push(str[i]);
      i++;
    } else i++;
  }
  return out;
}
export function parseCost(str) {
  let req = {
    R: 0,
    W: 0,
    B: 0,
    any: 0,
    wb: 0,
    rb: 0
  };
  for (const c of costTokens(str)) {
    if (c === "*") req.any++;else if (c === "WorB") req.wb++;else if (c === 'RorB') req.rb++;else req[c]++;
  }
  return req;
}
export function canPayReq(u, r, actor = null) {
  let pool = {
    R: 0,
    W: 0,
    B: 0
  };
  energyStore(u, actor).forEach(e => pool[e.c] += e.a);
  for (const c of "RWB") {
    if (pool[c] + 1e-6 < r[c]) return false;
    pool[c] -= r[c];
  }
  for (let i = 0; i < r.wb; i++) {
    let c = pool.W >= 1 - 1e-6 ? "W" : pool.B >= 1 - 1e-6 ? "B" : null;
    if (!c) return false;
    pool[c] -= 1;
  }
  for (let i = 0; i < (r.rb || 0); i++) {
    const c = pool.R >= 1 - 1e-6 ? 'R' : pool.B >= 1 - 1e-6 ? 'B' : null;
    if (!c) return false;
    pool[c] -= 1;
  }
  return Math.floor(pool.R + 1e-6) + Math.floor(pool.W + 1e-6) + Math.floor(pool.B + 1e-6) >= r.any;
}
export function canPayFrom(u, cost, actor = null) {
  if (typeof circuitIgnoresCostChanges === "function" && circuitIgnoresCostChanges(u)) return canPayReq(u, parseCost(cost), actor);
  let r = parseCost(cost);
  r.any += status(u, "poison") ? 1 : 0;
  return canPayReq(u, r, actor);
}
export function canPay(u, cost) {
  return canPayFrom(u, cost, null);
}
export function costGap(u, cost, actor = null) {
  if (typeof circuitIgnoresCostChanges === "function" && circuitIgnoresCostChanges(u)) {
    const r = parseCost(cost),
      pool = {
        R: 0,
        W: 0,
        B: 0
      };
    energyStore(u, actor).forEach(e => pool[e.c] += e.a);
    let gap = 0;
    for (const c of "RWB") {
      const x = Math.min(pool[c], r[c]);
      pool[c] -= x;
      gap += r[c] - x;
    }
    const wb = Math.min(r.wb, pool.W + pool.B),
      useW = Math.min(pool.W, wb);
    pool.W -= useW;
    pool.B -= wb - useW;
    gap += r.wb - wb;
    const rb = Math.min(r.rb || 0, pool.R + pool.B), useR = Math.min(pool.R, rb);
    pool.R -= useR; pool.B -= rb - useR; gap += (r.rb || 0) - rb;
    return gap + Math.max(0, r.any - pool.R - pool.W - pool.B);
  }
  let r = parseCost(cost),
    pool = {
      R: 0,
      W: 0,
      B: 0
    },
    gap = 0;
  energyStore(u, actor).forEach(e => pool[e.c] += e.a);
  for (const c of "RWB") {
    let used = Math.min(pool[c], r[c]);
    pool[c] -= used;
    gap += r[c] - used;
  }
  let wb = Math.min(r.wb, pool.W + pool.B),
    useW = Math.min(pool.W, wb);
  pool.W -= useW;
  pool.B -= wb - useW;
  gap += r.wb - wb;
  const rb = Math.min(r.rb || 0, pool.R + pool.B), useR = Math.min(pool.R, rb);
  pool.R -= useR; pool.B -= rb - useR; gap += (r.rb || 0) - rb;
  gap += Math.max(0, r.any + (status(u, "poison") ? 1 : 0) - pool.R - pool.W - pool.B);
  return gap;
}
export function spendReq(u, r, prefer = [], actor = null) {
  let __result;
  __spendReqCore: {
    actionFaultHit("payment-before");
    let paid = [],
      store = energyStore(u, actor);
    function take(col, amt) {
      for (let i = store.length - 1; i >= 0 && amt > 1e-6; i--) {
        let e = store[i];
        if (col && e.c !== col) continue;
        let x = Math.min(e.a, amt);
        e.a -= x;
        amt -= x;
        paid.push({
          c: e.c,
          a: x,
          actor,
          energyId: e.energyId || null
        });
        if (e.a < 0.01) store.splice(i, 1);
      }
      return amt;
    }
    for (const c of "RWB") take(c, r[c]);
    let amountOf = c => store.reduce((n, e) => n + (e.c === c ? e.a : 0), 0),
      wbOrder = [...new Set([...prefer.filter(x => x === "W" || x === "B"), "W", "B"])];
    for (let i = 0; i < (r.wb || 0); i++) {
      let c = wbOrder.find(x => amountOf(x) >= 1 - 1e-6);
      if (c) take(c, 1);
    }
    const rbOrder = [...new Set([...prefer.filter(x => x === 'R' || x === 'B'), 'R', 'B'])];
    for (let i = 0; i < (r.rb || 0); i++) {
      const c = rbOrder.find(x => amountOf(x) >= 1 - 1e-6);
      if (c) take(c, 1);
    }
    let anyOrder = [...new Set([...prefer, "R", "W", "B"])];
    for (let i = 0; i < (r.any || 0); i++) {
      let c = anyOrder.find(x => amountOf(x) >= 1 - 1e-6);
      if (c) take(c, 1);
    }
    actionFaultHit("payment-after");
    notifyReactiveEnergyMutation(null, u, false, "코스트 소비");
    {
      __result = paid;
      break __spendReqCore;
    }
  }
  if (typeof state_runtime_entities.EnergyEngine !== "undefined") state_runtime_entities.EnergyEngine.ensureStore(u);
  return __result;
}
export function spendFrom(u, cost, prefer = [], actor = null) {
  if (typeof circuitIgnoresCostChanges === "function" && circuitIgnoresCostChanges(u)) return spendReq(u, parseCost(cost), prefer, actor);
  let r = parseCost(cost);
  r.any += status(u, "poison") ? 1 : 0;
  return spendReq(u, r, prefer, actor);
}
export function transformedSkillReq(g, t, u, cost) {
  if (typeof circuitIgnoresCostChanges === "function" && circuitIgnoresCostChanges(u)) return rawReqFromCost(cost);
  let tokens = costTokens(cost),
    f = g?.fieldEffect;
  if (f?.type === "grand") {
    if (f.team === t) tokens = tokens.map(x => x === "W" || x === "B" ? "*" : x);else tokens = tokens.map(x => x === "*" ? "WorB" : x);
  }
  if (status(u, "poison")) {
    const pressure = typeof downPressureSource === "function" ? downPressureSource(g, t) : null;
    tokens.push(pressure ? "B" : f?.type === "grand" && f.team !== t ? "WorB" : "*");
  }
  const r = {
    R: 0,
    W: 0,
    B: 0,
    any: 0,
    wb: 0,
    rb: 0
  };
  for (const x of tokens) x === "*" ? r.any++ : x === "WorB" ? r.wb++ : x === 'RorB' ? r.rb++ : r[x]++;
  return {
    req: r,
    tokens,
    text: tokens.join("")
  };
}
export function canPayAction(g, t, u, cost, actor = null) {
  const req = transformedSkillReq(g, t, u, cost).req;
  if (traitsActive(u) && card(u).flexibleSkillPaymentW) {
    const counts = {
      R: 0,
      W: 0,
      B: 0
    };
    energyStore(u, actor).forEach(e => counts[e.c] += Number(e.a || 0));
    return reqAcceptsCounts(req, counts, u);
  }
  return canPayReq(u, req, actor);
}
export function spendAction(g, t, u, cost, prefer = [], actor = null) {
  let __result;
  __spendActionCore: {
    if (traitsActive(u) && card(u).flexibleSkillPaymentW) {
      const plan = findPaymentPlan(g, t, u, cost, actor);
      {
        __result = plan ? spendPaymentPlan(u, plan, actor) : [];
        break __spendActionCore;
      }
    }
    {
      __result = spendReq(u, transformedSkillReq(g, t, u, cost).req, prefer, actor);
      break __spendActionCore;
    }
  }
  if (typeof state_runtime_entities.EnergyEngine !== "undefined") state_runtime_entities.EnergyEngine.ensureStore(u);
  return __result;
}
export function reqAcceptsCounts(r, c, u = null) {
  let p = {
    R: Number(c.R || 0),
    W: Number(c.W || 0),
    B: Number(c.B || 0)
  };
  const flexibleW = !!(u && traitsActive(u) && card(u).flexibleSkillPaymentW);
  for (const color of ["R", "B"]) {
    const direct = Math.min(p[color], Number(r[color] || 0));
    p[color] -= direct;
    let missing = Number(r[color] || 0) - direct;
    if (missing > 1e-6) {
      if (!flexibleW || p.W + 1e-6 < missing) return false;
      p.W -= missing;
    }
  }
  if (p.W + 1e-6 < Number(r.W || 0)) return false;
  p.W -= Number(r.W || 0);
  for (let i = 0; i < Number(r.wb || 0); i++) {
    let col = p.W >= 1 - 1e-6 ? "W" : p.B >= 1 - 1e-6 ? "B" : null;
    if (!col) return false;
    p[col] -= 1;
  }
  for (let i = 0; i < Number(r.rb || 0); i++) {
    const col = p.R >= 1 - 1e-6 ? 'R' : p.B >= 1 - 1e-6 ? 'B' : flexibleW && p.W >= 1 - 1e-6 ? 'W' : null;
    if (!col) return false;
    p[col] -= 1;
  }
  return Math.floor(p.R + 1e-6) + Math.floor(p.W + 1e-6) + Math.floor(p.B + 1e-6) >= Number(r.any || 0);
}
export function findPaymentPlan(g, t, u, cost, actor = null, predicate = () => true) {
  let r = transformedSkillReq(g, t, u, cost).req,
    need = r.R + r.W + r.B + r.wb + (r.rb || 0) + r.any,
    atoms = [];
  for (const e of energyStore(u, actor)) for (let x = 0; x < Math.round(e.a * 2); x++) atoms.push(e.c);
  let chosen = {
      R: 0,
      W: 0,
      B: 0
    },
    answer = null;
  function dfs(i, left) {
    if (answer) return;
    if (left < -0.001) return;
    if (i === atoms.length) {
      if (Math.abs(left) < 0.001 && reqAcceptsCounts(r, chosen, u) && predicate(chosen)) answer = {
        ...chosen
      };
      return;
    }
    let remaining = (atoms.length - i) * 0.5;
    if (remaining + 1e-6 < left) return;
    dfs(i + 1, left);
    chosen[atoms[i]] += 0.5;
    dfs(i + 1, left - 0.5);
    chosen[atoms[i]] -= 0.5;
  }
  dfs(0, need);
  return answer;
}
export function allPaymentPlans(g, t, u, cost, actor = null) {
  let r = transformedSkillReq(g, t, u, cost).req,
    need = r.R + r.W + r.B + r.wb + (r.rb || 0) + r.any,
    atoms = [];
  for (const e of energyStore(u, actor)) for (let x = 0; x < Math.round(e.a * 2); x++) atoms.push(e.c);
  let chosen = {
      R: 0,
      W: 0,
      B: 0
    },
    out = [],
    seen = new Set();
  function dfs(i, left) {
    if (left < -0.001) return;
    if (i === atoms.length) {
      if (Math.abs(left) < 0.001 && reqAcceptsCounts(r, chosen, u)) {
        let key = `${chosen.R}/${chosen.W}/${chosen.B}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({
            ...chosen
          });
        }
      }
      return;
    }
    if ((atoms.length - i) * 0.5 + 1e-6 < left) return;
    dfs(i + 1, left);
    chosen[atoms[i]] += 0.5;
    dfs(i + 1, left - 0.5);
    chosen[atoms[i]] -= 0.5;
  }
  dfs(0, need);
  return out;
}
export function spendPaymentPlan(u, plan, actor = null) {
  let __result;
  __spendPaymentPlanCore: {
    let r = {
      R: plan.R,
      W: plan.W,
      B: plan.B,
      any: 0,
      wb: 0
    };
    {
      __result = spendReq(u, r, [], actor);
      break __spendPaymentPlanCore;
    }
  }
  if (typeof state_runtime_entities.EnergyEngine !== "undefined") state_runtime_entities.EnergyEngine.ensureStore(u);
  return __result;
}
export function spend(u, cost, prefer = []) {
  return spendFrom(u, cost, prefer, null);
}
export function normalizeStore(store) {
  for (const c of "RWB") {
    let halves = store.filter(e => e.c === c && e.a === 0.5);
    while (halves.length >= 2) {
      let a = halves.pop(),
        b = halves.pop();
      store.splice(store.indexOf(a), 1);
      store.splice(store.indexOf(b), 1);
      store.push({
        c,
        a: 1,
        energyId: null,
        mergedFrom: [a.energyId, b.energyId].filter(Boolean)
      });
    }
  }
}
export function normalizeEnergy(u, actor = null) {
  let __result;
  __normalizeEnergyCore: {
    normalizeStore(energyStore(u, actor));
  }
  if (typeof state_runtime_entities.EnergyEngine !== "undefined") state_runtime_entities.EnergyEngine.ensureStore(u);
  return __result;
}
export function notifyReactiveEnergyMutation(g, u, allowHeal, reason) {
  if (typeof reactiveEnergyRule === "function" && reactiveEnergyRule(u)) reconcileReactiveEnergy(g ?? state_features_genocider.reactiveEnergyCurrentGame, u, allowHeal, reason);
}
export function gainEnergy(g, u, col, amount = 1, replaceIndex = null, actor = null, opt = {}) {
  let __result;
  __gainEnergyCore: {
    const overflowIntercept = systems.__megaEnergyOverflowChoice?.interceptGain?.(g, u, col, amount, replaceIndex, actor, opt);
    if (overflowIntercept?.handled) {
      __result = overflowIntercept.value;
      break __gainEnergyCore;
    }
    const finish = result => {
      notifyReactiveEnergyMutation(g, u, !!result, `${String(col || "에너지")} 획득`);
      return result;
    };
    let store = energyStore(u, actor),
      max = card(u).maxEnergy || 4;
    if (totalEnergy(u, actor) + amount > max + 0.001) {
      if (replaceIndex == null) {
        __result = finish(false);
        break __gainEnergyCore;
      }
      const indices = [...new Set((Array.isArray(replaceIndex) ? replaceIndex : [replaceIndex]).filter(i => Number.isInteger(i) && i >= 0 && i < store.length))];
      if (!indices.length) {
        __result = finish(false);
        break __gainEnergyCore;
      }
      const overflow = totalEnergy(u, actor) + amount - max;
      const removedAmount = indices.reduce((sum, i) => sum + Number(store[i]?.a || 0), 0);
      if (removedAmount + 0.001 < overflow) {
        __result = finish(false);
        break __gainEnergyCore;
      }
      for (const i of indices.sort((a, b) => b - a)) store.splice(i, 1);
    }
    store.push({
      c: col,
      a: amount
    });
    normalizeStore(store);
    if (!opt.suppressTriggers) triggerEnergyGainResult(g, u, actor);
    {
      __result = finish(true);
      break __gainEnergyCore;
    }
  }
  if (typeof state_runtime_entities.EnergyEngine !== "undefined") state_runtime_entities.EnergyEngine.ensureStore(u);
  return __result;
}
export function setEnergyBatch(g, u, items, actor = null) {
  let __result;
  __setEnergyBatchCore: {
    let store = energyStore(u, actor);
    store.splice(0, store.length, ...items.map(e => ({
      ...e
    })));
    normalizeStore(store);
    log(g, `${u.name}: 에너지를 ${items.map(e => e.c.repeat(e.a)).join("") || "0"}로 일괄 설정.`);
    notifyReactiveEnergyMutation(g, u, true, "에너지 일괄 변경");
  }
  if (typeof state_runtime_entities.EnergyEngine !== "undefined") state_runtime_entities.EnergyEngine.ensureStore(u);
  return __result;
}
export function triggerEnergyGainResult(g, u, actor = null) {
  if (actor || !cardHasCapability(u, "healingLight") || !traitsActive(u)) return;
  let n = totalEnergy(u);
  if (Math.abs(n - 1) > 0.001 && Math.abs(n - 3) > 0.001) return;
  let t = teamOf(g, u),
    allies = g.teams[t].field.filter(x => x && !x.dead && x.hp < x.maxHp).sort((a, b) => b.maxHp - b.hp - (a.maxHp - a.hp)),
    enemies = g.teams[other(t)].field.filter(x => x && !x.dead).sort((a, b) => a.hp - b.hp),
    human = typeof state_ui_battle_state.game !== "undefined" && g === state_ui_battle_state.game && t === "P" && g.mode === "human";
  log(g, `${u.name} 특성 · 치유의 빛: 에너지 ${n}개 도달.`);
  if (human) {
    let targets = allies.length ? allies : enemies;
    if (targets.length) g.pendingTraitChoices.push({
      kind: "yggLight",
      uid: u.uid,
      targetUids: targets.map(x => x.uid),
      damage: !allies.length
    });
    return;
  }
  if (allies.length) heal(g, allies[0], 30, u, {
    reason: "ygg-light",
    effectId: "yggLight"
  });else if (enemies[0]) {
    log(g, `${u.name}: 회복 대상이 없어 특성 피해 30.`);
    nonAttackDamage(g, enemies[0], 30, "치유의 빛");
  }
}
export function gainTraitEnergyNow(g, u, col, amount, reason) {
  let actor = null,
    max = card(u).maxEnergy || 4,
    replace = null;
  if (totalEnergy(u) + amount > max + 0.001) replace = bestEnergyReplacement(u, col, amount, actor);
  if (totalEnergy(u) + amount > max + 0.001 && replace == null) {
    log(g, `${u.name} 특성 · 에너지 직조: ${reason}, ${col}${amount === 0.5 ? "½" : ""} 획득 포기.`);
    return false;
  }
  let ok = gainEnergy(g, u, col, amount, replace, actor);
  if (ok) log(g, `${u.name} 특성 · 에너지 직조: ${reason}, ${col}${amount === 0.5 ? "½" : ""} 획득${replace != null ? "(교체)" : ""}.`);
  return ok;
}
export function requestTraitEnergy(g, u, col, amount, reason) {
  if (!u || u.dead || !cardHasCapability(u, "selectiveEnergyTrait") || !traitsActive(u)) return;
  let t = teamOf(g, u),
    human = typeof state_ui_battle_state.game !== "undefined" && g === state_ui_battle_state.game && t === "P" && g.mode === "human";
  if (human) g.pendingTraitChoices.push({
    uid: u.uid,
    col,
    amount,
    reason
  });else gainTraitEnergyNow(g, u, col, amount, reason);
}
export function energyValue(u, energy = energyStore(u)) {
  let store = energyStore(u),
    old = store.map(x => ({
      ...x
    }));
  store.splice(0, store.length, ...energy);
  let best = Math.max(...card(u).skills.map(sk => Math.max(0, (sk.tags.includes("damage") ? 140 : 100) - costGap(u, sk.cost) * 25)));
  store.splice(0, store.length, ...old);
  return best;
}
export function bestEnergyReplacement(u, col, amount, actor = null) {
  let plan = bestEnergyReplacementPlan(u, col, amount, actor);
  return plan?.length === 1 ? plan[0] : plan;
}
export function bestEnergyReplacementPlan(u, col, amount, actor = null) {
  const store = energyStore(u, actor),
    overflow = totalEnergy(u, actor) + amount - (card(u).maxEnergy || 4),
    base = energyValue(u);
  let best = {
    index: null,
    v: base,
    removed: Infinity
  };
  for (let i = 0; i < store.length; i++) {
    const removed = Number(store[i]?.a || 0);
    if (removed + 1e-6 < overflow) continue;
    const pool = store.filter((_, j) => j !== i).map(x => ({
      ...x
    }));
    pool.push({
      c: col,
      a: amount
    });
    normalizeStore(pool);
    const v = energyValue(u, pool);
    if (v > best.v || Math.abs(v - best.v) < 1e-6 && removed < best.removed) best = {
      index: i,
      v,
      removed
    };
  }
  return best.index == null ? null : [best.index];
}

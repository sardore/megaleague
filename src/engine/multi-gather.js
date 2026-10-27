import { traitsActive } from "./combat.js";
import { naturalColors } from "./effects.js";
import { energyStore, energyValue, normalizeStore, status, totalEnergy, triggerEnergyGainResult } from "./energy.js";
import { RNG, card, cardCapability } from "./entities.js";
import { advanceDualOrEnd } from "./execution.js";
import { log } from "../presentation/audio.js";
import { energyAmountText, state_ui_battle_state } from "../ui/battle-state.js";
import { state_ui_deck } from "../ui/deck.js";
/* 에너지 모으기 한 번에 둘 이상을 얻는 수급의 공용 규칙. 타임오러(시간 가속)와 capability multiGather를 가진 카드가 같이 쓴다.
   수급 목록(gains)은 {c, a, role, optional}이다. optional인 항목은 보관 공간이 모자라면 버려지고, 아닌 항목은 반드시 들어가야 한다.
   초과 시에는 기존 에너지를 교환하거나(gatherReplaceIndices) 새 에너지를 일부만 보관하거나(gatherKeepIndices) 포기할 수 있다(gatherDeclineOverflow). */
export function cloneRng(rng) {
  const x = Object.create(RNG.prototype);
  x.s = rng.s;
  return x;
}
export function drawNaturalColorFrom(rng, colors, store, amount) {
  const half = amount === .5 ? (store || []).find(e => e?.a === .5) : null;
  return {
    color: half?.c || rng.pick(colors),
    locked: !!half
  };
}
export function storeAfterGain(store, col, amount) {
  const next = (store || []).map(e => ({
    ...e
  }));
  next.push({
    c: col,
    a: amount
  });
  normalizeStore(next);
  return next;
}
export function humanControlsTeam(g, t) {
  if (g?.mode === "human") return t === "P";
  if (g?.mode === "online") return t === state_ui_deck.onlineSide;
  if (g?.mode === "bossSolo" || g?.mode === "bossOnline") return t === "P";
  return false;
}
export function gatherDiscardCandidates(u) {
  const store = energyStore(u);
  return store.map((e, index) => ({
    e,
    index
  })).filter(({
    e
  }) => {
    const amount = Number(e?.a || 0);
    return amount === 1 || amount === .5;
  });
}
export function fitGatherGains(store, gains, max) {
  const accepted = [],
    dropped = [];
  let total = (store || []).reduce((n, e) => n + Number(e?.a || 0), 0);
  for (const gain of gains || []) {
    const amount = Number(gain?.a || 0);
    if (total + amount <= max + .001) {
      accepted.push({
        ...gain
      });
      total += amount;
    } else dropped.push({
      ...gain
    });
  }
  return {
    accepted,
    dropped,
    total
  };
}
export function bestGatherDiscardIndex(u, gains) {
  const store = energyStore(u),
    max = card(u).maxEnergy || 4;
  let best = null;
  for (const {
    index,
    e
  } of gatherDiscardCandidates(u)) {
    const pool = store.filter((_, i) => i !== index).map(x => ({
      ...x
    }));
    const fit = fitGatherGains(pool, gains, max);
    const gained = fit.accepted.reduce((n, x) => n + Number(x.a || 0), 0);
    if (gained <= 0) continue;
    const value = energyValue(u, pool.concat(fit.accepted.map(x => ({
      c: x.c,
      a: x.a
    }))));
    const score = gained * 1000 + value - Number(e.a || 0) * .01;
    if (!best || score > best.score) best = {
      index,
      score
    };
  }
  return best?.index ?? null;
}

export function multiGatherCount(g, u) {
  const rule = u && !u.dead ? cardCapability(u, "multiGather", null) : null;
  if (!rule || !traitsActive(u, g)) return 0;
  if (rule.requires === "shield" && !(Number(u.shield || 0) > 0)) return 0;
  return Math.max(1, Number(rule.count || 1));
}
export function planMultiGather(g, t, u, count, rng = g.rng) {
  const amt = status(u, "slow") ? .5 : 1,
    colors = naturalColors(g, t, u, amt, null, "multi-gather");
  let store = energyStore(u).map(e => ({
      ...e
    })),
    gains = [];
  for (let i = 0; i < count; i++) {
    const color = drawNaturalColorFrom(rng, colors, store, amt).color;
    gains.push({
      c: color,
      a: amt,
      role: i ? "extra" : "first",
      optional: i > 0
    });
    store = storeAfterGain(store, color, amt);
  }
  return gains;
}
export function peekMultiGather(g, t, u) {
  const count = multiGatherCount(g, u);
  return {
    gains: count ? planMultiGather(g, t, u, count, cloneRng(g.rng)) : [],
    previewState: Number(g?.rng?.s ?? 0)
  };
}
export function executeMultiGather(g, t, s, u, a, opt = {}) {
  const count = multiGatherCount(g, u);
  if (!count) return false;
  const stateBefore = Number(g?.rng?.s ?? 0);
  return executeGatherGains(g, t, s, u, a, planMultiGather(g, t, u, count), {
    label: "다중 수급",
    stateBefore,
    logTotal: true
  }, opt);
}
export function executeGatherGains(g, t, s, u, a, gains, {
  label,
  stateBefore = null,
  logTotal = false
}, opt = {}) {
  // UI에서 미리 본 난수 상태와 실제 실행 상태가 다르면 실제 권위 상태를 사용하되 기록한다.
  if (a.gatherPreviewState != null && Number(a.gatherPreviewState) !== stateBefore && !opt.sim && g === state_ui_battle_state.game) {
    log(g, `${u.name}: ${label} 상태를 최신 전투 상태로 다시 계산함.`, "turn");
  }
  const store = energyStore(u);
  const explicitKeep = Array.isArray(a.gatherKeepIndices);
  if (explicitKeep) {
    const keepIndices = [...new Set(a.gatherKeepIndices.map(Number))];
    if (!keepIndices.length || keepIndices.some(index => !Number.isInteger(index) || !gains[index])) return false;
    gains = keepIndices.map(index => gains[index]);
  }
  const max = card(u).maxEnergy || 4,
    amount = gains.reduce((n, e) => n + Number(e.a || 0), 0);
  let replace = a.gatherReplaceIndices ?? a.replaceIndex ?? a.replaceIndices;
  if (totalEnergy(u) + amount > max + .001 && replace == null) {
    if (a.gatherDeclineOverflow) {
      log(g, `${u.name}: 최대 에너지로 ${label} 수급을 포기.`);
      u.lastAction = "gather";
      advanceDualOrEnd(g, t, s, u, false, false);
      return true;
    }
    if (!humanControlsTeam(g, t)) replace = bestGatherDiscardIndex(u, gains);else return false;
  }
  let fit;
  if (replace != null) {
    const indices = [...new Set(Array.isArray(replace) ? replace : [replace])].filter(i => Number.isInteger(i) && store[i]);
    if (!indices.length) return false;
    const allowed = new Set(gatherDiscardCandidates(u).map(x => x.index));
    if (indices.some(index => !allowed.has(index))) return false;
    if (!explicitKeep && Array.isArray(a.gatherSwapPairs)) {
      const gainIndices = new Set(),
        storeIndices = new Set();
      for (const pair of a.gatherSwapPairs) {
        const gainIndex = Number(pair?.gainIndex),
          storeIndex = Number(pair?.storeIndex);
        if (!Number.isInteger(gainIndex) || !Number.isInteger(storeIndex) || !gains[gainIndex] || !store[storeIndex]) return false;
        if (gainIndices.has(gainIndex) || storeIndices.has(storeIndex)) return false;
        if (Math.abs(Number(gains[gainIndex].a || 0) - Number(store[storeIndex].a || 0)) > .001) return false;
        gainIndices.add(gainIndex);
        storeIndices.add(storeIndex);
      }
      if (storeIndices.size !== indices.length || indices.some(index => !storeIndices.has(index))) return false;
    } else if (!explicitKeep && indices.length !== 1) return false;
    const removedSet = new Set(indices);
    const pool = store.filter((_, index) => !removedSet.has(index)).map(e => ({
      ...e
    }));
    fit = fitGatherGains(pool, gains, max);
    if (explicitKeep && (fit.dropped.length || fit.accepted.length !== gains.length)) return false;
    if (!explicitKeep && !fit.accepted.some(e => !e.optional)) return false;
    const removed = indices.slice().sort((a, b) => b - a).map(index => store.splice(index, 1)[0]).filter(Boolean);
    log(g, `${u.name}: 기존 ${removed.map(e => `${e.c}${e.a === .5 ? "½" : ""}`).join(" + ")} 에너지를 새 에너지와 교환.`);
  }
  fit = fitGatherGains(store, gains, max);
  // 직접 선택한 경우에는 선택한 새 에너지가 전부 들어가야 하며, 반에너지만 보관하는 선택도 허용한다.
  if (explicitKeep) {
    if (!fit.accepted.length || fit.dropped.length || fit.accepted.length !== gains.length) return false;
  } else if (!fit.accepted.some(e => !e.optional)) {
    // 자동/구형 행동은 첫 수급조차 들어가지 않는 상태에서 행동을 소비하지 않는다.
    return false;
  }
  for (const e of fit.accepted) store.push({
    c: e.c,
    a: e.a
  });
  normalizeStore(store);
  triggerEnergyGainResult(g, u, null);
  if (logTotal) log(g, `${u.name} 특성 · ${label}: 총 ${energyAmountText(fit.accepted.reduce((n, e) => n + Number(e.a || 0), 0))}E 수급.`, "turn");
  const droppedOptional = fit.dropped.filter(e => e.optional);
  if (droppedOptional.length) log(g, `${u.name}: 보관 공간 부족으로 ${label}의 추가 ${energyAmountText(droppedOptional.reduce((n, e) => n + Number(e.a || 0), 0))}E는 획득하지 못함.`, "turn");
  log(g, `${u.name}: ${fit.accepted.map(e => `${e.c}${e.a === .5 ? "½" : ""}`).join(" + ")} 에너지 획득.`);
  u.lastAction = "gather";
  advanceDualOrEnd(g, t, s, u, false, false);
  return true;
}

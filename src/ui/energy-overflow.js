import { unitAt } from "../engine/actions.js";
import { teamOf } from "../engine/combat.js";
import { energyStore, gainEnergy, normalizeStore, totalEnergy, triggerEnergyGainResult } from "../engine/energy.js";
import { RNG, actionSkillHasEffect, card } from "../engine/entities.js";
import { execute } from "../engine/execution.js";
import { reactiveEnergyRule, reconcileReactiveEnergy } from "../features/genocider.js";
import { state_features_timeora } from "../features/timeora.js";
import { log } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "./battle-state.js";
import { state_ui_deck } from "./deck.js";
import { finalizeChosenPlayerAction } from "./payment.js";
export function initializeUiEnergyOverflow() {
  VERSION = "unified-energy-overflow-choice-r24";
  overflowRuntime = null;
  playedClockVisuals = new Map();
  systems.__megaEnergyOverflowChoice = {
    version: VERSION,
    bestKeepIds,
    auditNextOverflow,
    begin: beginOverflowContext,
    end(previous) {
      overflowRuntime = previous;
    },
    interceptGain(g, u, col, amount = 1, replaceIndex = null, actor = null, opt = {}) {
      const max = card(u).maxEnergy || 4;
      if (!overflowRuntime || forcedByOpponent(g, u) || totalEnergy(u, actor) + amount <= max + .001) return {
        handled: false
      };
      const step = overflowRuntime.cursor++;
      let selection = overflowRuntime.selections[step] || null;
      const pool = overflowPool(energyStore(u, actor), col, amount);
      if (!selection && overflowRuntime.audit) {
        if (!overflowRuntime.audit.event) overflowRuntime.audit.event = {
          step,
          recipientUid: u.uid,
          recipientName: u.name,
          actor: actor || null,
          color: col,
          amount: Number(amount || 0),
          max,
          pool: pool.map(item => ({
            ...item
          }))
        };
        selection = {
          keepIds: bestKeepIds(pool, max)
        };
      }
      if (!selection) return {
        handled: false
      };
      const applied = applyOverflowSelection(g, u, col, amount, actor, opt, selection);
      return {
        handled: true,
        value: applied == null ? false : applied
      };
    },
    interceptGrant(g, u, color, amount = 1, specs = null, actor = null) {
      const max = card(u).maxEnergy || 4;
      if (overflowRuntime && !forcedByOpponent(g, u) && totalEnergy(u, actor) + amount > max + .001) return {
        handled: true,
        value: gainEnergy(g, u, color, amount, null, actor)
      };
      return {
        handled: false
      };
    },
    interceptFinalize(action) {
      const [t] = state_ui_battle_state.game?.order?.[state_ui_battle_state.game.turn] || [];
      if (!action || state_ui_battle_state.game?.puzzle || action.energyOverflowResolved || !playerControlsTeam(state_ui_battle_state.game, t) || actionSkillHasEffect(action, "eternaHeal")) return {
        handled: false
      };
      const event = auditNextOverflow(action, []);
      if (!event) return {
        handled: false
      };
      return {
        handled: true,
        value: openOverflowChoice(action, [], event, finalizeChosenPlayerAction)
      };
    },
    clockVisualDuplicate(events) {
      const signature = clockVisualSignature(events),
        now = Date.now();
      for (const [key, at] of playedClockVisuals) if (now - at > 12000) playedClockVisuals.delete(key);
      if (signature && !signature.endsWith(":") && playedClockVisuals.has(signature)) return true;
      if (signature && !signature.endsWith(":")) playedClockVisuals.set(signature, now);
      return false;
    },
    resetClockVisualDedup() {
      playedClockVisuals.clear();
    }
  };
}
let VERSION;
let overflowRuntime;
function playerControlsTeam(g, team) {
  if (!g) return false;
  if (g.mode === "human") return team === "P";
  if (g.mode === "online") return team === state_ui_deck.onlineSide;
  if (g.mode === "bossSolo" || g.mode === "bossOnline") return team === "P";
  return false;
}
function overflowPool(store, color, amount) {
  return [...(store || []).map((e, index) => ({
    id: `old:${index}`,
    source: "old",
    index,
    c: e.c,
    a: Number(e.a || 0)
  })), {
    id: "incoming",
    source: "new",
    index: 0,
    c: color,
    a: Number(amount || 0)
  }];
}
function poolTotal(items) {
  return items.reduce((sum, item) => sum + Number(item.a || 0), 0);
}
function resolveKeep(pool, keepIds, max) {
  if (!Array.isArray(keepIds)) return null;
  const ids = new Set(keepIds.map(String));
  if (ids.size !== keepIds.length) return null;
  const selected = pool.filter(item => ids.has(item.id));
  if (selected.length !== ids.size || poolTotal(selected) > max + .001) return null;
  return selected;
}
function bestKeepIds(pool, max) {
  let best = {
    score: -Infinity,
    ids: []
  };
  const combinations = 1 << pool.length;
  for (let mask = 0; mask < combinations; mask++) {
    const chosen = [];
    let total = 0,
      incoming = 0,
      colorScore = 0;
    for (let i = 0; i < pool.length; i++) if (mask & 1 << i) {
      const item = pool[i];
      chosen.push(item);
      total += item.a;
      if (item.source === "new") incoming += item.a;
      colorScore += (item.c === "W" ? 3 : item.c === "R" ? 2 : 1) * item.a;
    }
    if (total > max + .001) continue;
    const score = total * 100000 + incoming * 1000 + colorScore;
    if (score > best.score) best = {
      score,
      ids: chosen.map(item => item.id)
    };
  }
  return best.ids;
}
function forcedByOpponent(g, recipient) {
  if (!overflowRuntime?.team) return false;
  const recipientTeam = teamOf(g, recipient);
  return !!recipientTeam && recipientTeam !== overflowRuntime.team;
}
function applyOverflowSelection(g, u, color, amount, actor, opt, selection) {
  const store = energyStore(u, actor),
    max = card(u).maxEnergy || 4;
  const pool = overflowPool(store, color, amount);
  const selected = resolveKeep(pool, selection?.keepIds, max);
  if (!selected) return null;
  const keptIncoming = selected.some(item => item.id === "incoming");
  const removed = pool.filter(item => item.source === "old" && !selected.some(chosen => chosen.id === item.id));
  store.splice(0, store.length, ...selected.map(item => ({
    c: item.c,
    a: item.a
  })));
  normalizeStore(store);
  if (keptIncoming && !opt?.suppressTriggers) triggerEnergyGainResult(g, u, actor);
  if (!overflowRuntime?.sim && removed.length) log(g, `${u.name}: 에너지 초과 선택으로 기존 ${removed.map(e => `${e.c}${e.a === .5 ? "½" : ""}`).join(" + ")} 버림.`);
  if (!overflowRuntime?.sim && !keptIncoming) log(g, `${u.name}: 새 ${color}${amount === .5 ? "½" : ""} 에너지를 직접 버림.`);
  try {
    if (reactiveEnergyRule(u)) reconcileReactiveEnergy(g, u, keptIncoming, "에너지 초과 직접 선택");
  } catch (error) {
    systems.__megaRecordRecoveredError(error, "unifiedEnergyOverflowChoiceR24:L74");
  }
  return keptIncoming;
}
function beginOverflowContext(g, t, s, a, opt = {}) {
  const previous = overflowRuntime;
  const audit = opt?.__energyOverflowAudit || null;
  overflowRuntime = {
    game: g,
    team: t,
    actorUid: g ? unitAt(g, t, s)?.uid || null : null,
    selections: Array.isArray(a?.energyOverflowChoices) ? a.energyOverflowChoices : [],
    cursor: 0,
    audit,
    sim: !!opt?.sim
  };
  return previous;
}
function cloneForOverflowAudit(g) {
  const raw = JSON.stringify(g, (key, value) => key === "token" ? undefined : value);
  const clone = JSON.parse(raw);
  const rng = new RNG(clone.seed);
  rng.s = Number(clone.rng?.s ?? rng.s);
  clone.rng = rng;
  clone.token = -Math.max(1, Number(g?.turnSerial || 1));
  return clone;
}
function auditNextOverflow(action, selections) {
  if (!state_ui_battle_state.game || state_ui_battle_state.game.winner) return null;
  const clone = cloneForOverflowAudit(state_ui_battle_state.game);
  const [t, s] = clone.order?.[clone.turn] || [];
  if (t == null || s == null) return null;
  const audit = {
    event: null
  };
  try {
    execute(clone, t, s, {
      ...action,
      energyOverflowChoices: selections.map(x => ({
        keepIds: [...x.keepIds]
      }))
    }, {
      sim: true,
      __energyOverflowAudit: audit
    });
  } catch (error) {
    if (systems.DEBUG_BATTLE_EVENTS) console.warn("[energy-overflow-audit]", error);
    return null;
  }
  return audit.event;
}
function openOverflowChoice(action, selections, event, finalizeBase) {
  const current = event.pool.filter(item => item.source === "old").map(item => ({
    c: item.c,
    a: item.a,
    id: item.id
  }));
  const incoming = event.pool.filter(item => item.source === "new").map(item => ({
    c: item.c,
    a: item.a,
    id: item.id
  }));
  const best = new Set(bestKeepIds(event.pool, event.max));
  return state_features_timeora.EnergyOverflowPresentationOwner.open({
    title: `에너지 초과 · ${event.recipientName}`,
    instructions: "현재 에너지와 새로 받을 에너지를 함께 표시했습니다. 첫 줄에서 보관할 새 에너지를, 둘째 줄에서 버릴 현재 에너지를 선택하세요.",
    sourceActionIdentity: action?.actionId || action?.commandId || `${state_ui_battle_state.game?.battleId || state_ui_battle_state.game?.matchId || "battle"}:${state_ui_battle_state.game?.turnSerial || 0}:energy-overflow`,
    pendingTransactionIdentity: action?.transactionId || action?.commandId || null,
    current,
    incoming,
    max: event.max,
    initialKeepIncomingIndices: incoming.map((item, index) => best.has(item.id) ? index : null).filter(index => index != null),
    initialDiscardCurrentIndices: current.map((item, index) => !best.has(item.id) ? index : null).filter(index => index != null),
    onConfirm: ({
      keepIncomingIndices,
      discardCurrentIndices
    }) => {
      const discarded = new Set(discardCurrentIndices);
      const keptIds = [...current.filter((_, index) => !discarded.has(index)).map(item => item.id), ...keepIncomingIndices.map(index => incoming[index]?.id).filter(Boolean)];
      const nextSelections = [...selections, {
        keepIds: keptIds
      }];
      const next = auditNextOverflow(action, nextSelections);
      if (next) return openOverflowChoice(action, nextSelections, next, finalizeBase);
      document.getElementById("modal")?.classList.remove("open");
      finalizeBase({
        ...action,
        energyOverflowChoices: nextSelections,
        energyOverflowResolved: true
      });
    },
    onDropNew: () => {
      const dropSelection = {
        keepIds: current.map(item => item.id)
      };
      const nextSelections = [...selections, dropSelection];
      const next = auditNextOverflow(action, nextSelections);
      if (next) return openOverflowChoice(action, nextSelections, next, finalizeBase);
      document.getElementById("modal")?.classList.remove("open");
      finalizeBase({
        ...action,
        energyOverflowChoices: nextSelections,
        energyOverflowResolved: true
      });
    }
  });
}
let playedClockVisuals;
function clockVisualSignature(events) {
  return `${state_ui_battle_state.game?.matchId || state_ui_battle_state.game?.seed || "battle"}:${(events || []).flatMap(event => event?.clocks || []).map(c => `${c.uid}:${c.beforeHour}:${c.beforeMinute}:${c.afterHour}:${c.afterMinute}:${c.blocked ? 1 : 0}`).sort().join("|")}`;
}

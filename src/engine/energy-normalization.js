import { TimerManager } from "../runtime/timers.js";
import { unitAt } from "./actions.js";
import { energyStore, normalizeStore, status, totalEnergy, triggerEnergyGainResult } from "./energy.js";
import { card, cardHasCapability } from "./entities.js";
import { scrubUserFacingUndefined } from "../features/elixian.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
export function initializeEngineEnergyNormalization() {
  HARD_LEAVE_IDS = new Set(["onlineRoomLeave", "p2pDisconnect", "matchCancel", "matchmakingCancel", "bossMatchCancel", "bossOnlineLeave", "onlineRoomBack"]);
  document.addEventListener("click", event => {
    const button = event.target?.closest?.("button,[role=button]");
    if (!button) return;
    const hard = HARD_LEAVE_IDS.has(button.id) || /연결 끊기|온라인.*나가기|매칭 취소/.test(String(button.textContent || "").trim());
    if (!hard) return;
    try {
      systems.__megaOnlineBattleChat?.clear?.();
    } catch (error) {
      systems.__megaRecordRecoveredError(error, "fullFileAuditR29:hard-leave-chat-clear");
    }
  }, true);
  systems.EnergyCanonicalizationEngine = Object.freeze({
    VERSION: "mega-energy-canonicalization-r29",
    canonicalizeGameState: canonicalizeGameEnergy,
    begin: prepareEnergyAction,
    finish: finishEnergyAction
  });
  scheduled = false;
  scheduleClean = () => {
    if (scheduled) return;
    scheduled = true;
    TimerManager.requestAnimationFrame(() => {
      scheduled = false;
      cleanTransientDom();
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleClean, {
      once: true
    });
  } else {
    scheduleClean();
  }
}
let HARD_LEAVE_IDS;
function normalizeVisibleMiddleDots(root = document.body) {
  try {
    scrubUserFacingUndefined(root);
  } catch (error) {
    systems.__megaRecordRecoveredError(error, "fullFileAuditR29:normalizeVisibleMiddleDots");
  }
}
function canonicalizeEnergyStore(unit) {
  if (!unit || typeof energyStore !== "function") return;
  const store = energyStore(unit);
  if (!Array.isArray(store)) return;
  for (const e of store) {
    if (!e || !["R", "W", "B"].includes(e.c)) continue;
    const amount = Number(e.a);
    if (Number.isFinite(amount)) e.a = Math.max(0, Math.round(amount * 2) / 2);
  }
  try {
    normalizeStore(store);
  } catch (error) {
    systems.__megaRecordRecoveredError(error, "inline-165:L35");
  }
}
function currentGame() {
  try {
    return typeof state_ui_battle_state.game !== "undefined" ? state_ui_battle_state.game : systems.game;
  } catch {
    return systems.game;
  }
}
function canonicalizeGameEnergy(g = currentGame()) {
  if (!g?.teams) return;
  for (const team of ["P", "A"]) {
    for (const unit of [...(g.teams[team]?.field || []), ...(g.teams[team]?.bench || [])]) {
      canonicalizeEnergyStore(unit);
    }
  }
}
function prepareEnergyAction(g, t, s, action, opt = {}) {
  const actor = (() => {
    try {
      return unitAt(g, t, s);
    } catch {
      return null;
    }
  })();
  const onlineTimeKeep = !!(g === currentGame() && cardHasCapability(actor, "timeControl") && action?.type === "gather" && action?.timeAccelerationChoice === "keep" && !Array.isArray(action?.timeKeepGainIndices) && (g?.mode === "online" || g?.mode === "bossOnline" || g?.bossRaid?.online));
  const beforeTotal = onlineTimeKeep ? Number(totalEnergy(actor) || 0) : 0;
  const max = onlineTimeKeep ? Number(card(actor)?.maxEnergy || 4) : 0;
  const slowed = onlineTimeKeep && !!status(actor, "slow");
  const expected = slowed ? 1 : 1.5;
  return {
    actor,
    onlineTimeKeep,
    beforeTotal,
    max,
    expected
  };
}
function finishEnergyAction(result, before, g, t, s, action) {
  const {
    actor,
    onlineTimeKeep,
    beforeTotal,
    max,
    expected
  } = before;
  if (result && onlineTimeKeep && beforeTotal + expected <= max + 0.001) {
    const delta = Number(totalEnergy(actor) || 0) - beforeTotal;
    if (delta < expected - 0.001) {
      const missing = Math.round((expected - delta) * 2) / 2;
      const color = ["R", "W", "B"].includes(action?.timeBonusColor) ? action.timeBonusColor : ["R", "W", "B"].includes(action?.timeFirstColor) ? action.timeFirstColor : "W";
      const store = energyStore(actor);
      store.push({
        c: color,
        a: missing
      });
      normalizeStore(store);
      try {
        triggerEnergyGainResult(g, actor, null);
      } catch (error) {
        systems.__megaRecordRecoveredError(error, "inline-165:L83");
      }
    }
  }
  canonicalizeGameEnergy(g);
  return result;
}
function cleanTransientDom() {
  const seen = new Set();
  for (const el of document.querySelectorAll("[id]")) {
    if (!seen.has(el.id)) {
      seen.add(el.id);
      continue;
    }
    if (/^(battleChatPopupStack|time.*Layer|online.*Overlay)/i.test(el.id)) el.remove();
  }
  for (const el of document.querySelectorAll(".time-hyper-clock,.time-hyper-clock-overlay,.time-clock-effect-layer")) {
    if (!el.isConnected || !document.getElementById("game")?.classList.contains("active") && getComputedStyle(el).position === "fixed") el.remove();
  }
  normalizeVisibleMiddleDots(document.body);
  canonicalizeGameEnergy();
  try {
    systems.__megaSyncOnlineChatUI?.();
  } catch (error) {
    systems.__megaRecordRecoveredError(error, "inline-165:L112");
  }
}
let scheduled;
let scheduleClean;

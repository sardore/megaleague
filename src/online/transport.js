// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_online_transport = {
  finalizedOnlineMatches: undefined,
  OnlineTransportEngine: undefined
};
import { state_runtime_entities } from "../runtime/entities.js";
import { state_runtime_state } from "../runtime/state.js";
import { p2pSend, registerOnlineConnectionRoute } from "./connection.js";
import { log } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { state_ui_deck } from "../ui/deck.js";
import { render } from "../ui/payment.js";
import { state_ui_results } from "../ui/results.js";
export function initializeOnlineTransport() {
  state_online_transport.finalizedOnlineMatches = new Set();
  state_online_transport.OnlineTransportEngine = (() => {
    const debug = () => ({
      matchmakingTimer: false,
      heartbeatTimer: false,
      disconnectTimer: false,
      reconnectTimer: false,
      overlay: !!document.querySelector(".online-disconnect-overlay")
    });
    const closeSession = () => {
      document.querySelector(".online-disconnect-overlay")?.remove();
      return debug();
    };
    return Object.freeze({
      closeSession,
      debug
    });
  })();
  registerOnlineConnectionRoute("onlineHeartbeat", "online-transport", handleOnlineHeartbeatPacket, 50);
  registerOnlineConnectionRoute("surrender", "online-result", handleOnlineSurrenderPacket, 50);
  registerOnlineConnectionRoute("onlineResult", "online-result", handleOnlineResultPacket, 50);
  registerOnlineConnectionRoute("clientClosing", "online-transport", handleOnlineClientClosingPacket, 50);
  systems.__megaBeforeOnlineUnload = () => {
    try {
      if (state_ui_deck.p2p.conn?.open && state_ui_deck.p2p.battleStarted) p2pSend({
        type: "clientClosing",
        matchId: state_ui_deck.p2p.matchId,
        playerId: state_ui_deck.p2p.playerId
      });
    } catch (error) {
      systems.__megaRecordRecoveredError(error, "inline-1:L15524");
    }
  };
}
export function stableOnlinePlayerId() {
  /*
   * One durable installation identity may be shared by Chrome and the Google app on Android.
   * Relay identity must instead be stable for the current browsing context, so two independent
   * contexts on the same device can be matched without becoming a forbidden self-match.
   */
  let installationId = "";
  try {
    installationId = localStorage.getItem("megaOnlinePlayerId") || "";
  } catch (error) {
    systems.__megaRecordRecoveredError(error, "stableOnlinePlayerId.installation.read");
  }
  if (!/^p-[a-z0-9-]{12,}$/i.test(installationId)) {
    const r = new Uint32Array(4);
    crypto.getRandomValues(r);
    installationId = `p-${[...r].map(n => n.toString(36)).join("-")}`;
    try {
      localStorage.setItem("megaOnlinePlayerId", installationId);
    } catch (error) {
      systems.__megaRecordRecoveredError(error, "stableOnlinePlayerId.installation.write");
    }
  }
  let contextId = "";
  try {
    contextId = sessionStorage.getItem("megaOnlineContextPlayerId") || "";
  } catch (error) {
    systems.__megaRecordRecoveredError(error, "stableOnlinePlayerId.context.read");
  }
  if (!/^p-[a-z0-9-]{12,}$/i.test(contextId)) {
    const r = new Uint32Array(4);
    crypto.getRandomValues(r);
    contextId = `p-${[...r].map(n => n.toString(36)).join("-")}`;
    try {
      sessionStorage.setItem("megaOnlineContextPlayerId", contextId);
    } catch (error) {
      systems.__megaRecordRecoveredError(error, "stableOnlinePlayerId.context.write");
    }
  }
  return contextId;
}
export function randomId(prefix = "id") {
  const r = new Uint32Array(3);
  crypto.getRandomValues(r);
  return `${prefix}-${Date.now().toString(36)}-${[...r].map(n => n.toString(36)).join("")}`;
}
export function canonicalRelayTransportOwnsLifecycle() {
  const debug = systems.OnlineRuntime?.debug?.();
  return !!debug && !['IDLE', 'CLOSED', 'FAILED'].includes(debug.state) && debug.transport?.type === 'native-websocket-relay';
}
export function startDisconnectGrace() {
  if (canonicalRelayTransportOwnsLifecycle()) return true;
  if (!state_ui_battle_state.game || state_ui_battle_state.game.mode !== "online" || state_ui_battle_state.game.resultFinalized || state_ui_deck.p2p.reconnecting) return;
  state_ui_deck.p2p.reconnecting = true;
  state_ui_deck.p2p.lastDisconnectAt = Date.now();
  state_ui_battle_state.game.connectionInterrupted = true;
  document.querySelector(".online-disconnect-overlay")?.remove();
  systems.NetworkEngine?.matchmaking?.reconnect?.();
}
export function cancelDisconnectGrace() {
  document.querySelector(".online-disconnect-overlay")?.remove();
  if (canonicalRelayTransportOwnsLifecycle()) return true;
  if (state_ui_deck.p2p) state_ui_deck.p2p.reconnecting = false;
  if (state_ui_battle_state.game?.mode === "online" && !state_ui_battle_state.game.winner) {
    state_ui_battle_state.game.connectionInterrupted = false;
    state_ui_results.NavigationApplication.resumeBattle("disconnect-grace-cancel", {
      render: !state_ui_battle_state.busy
    });
  }
  return true;
}
export function finalizeOnlineBattleResult(resultType, winnerTeam) {
  if (!state_ui_battle_state.game || state_ui_battle_state.game.mode !== "online" || state_ui_battle_state.game.resultFinalized || state_online_transport.finalizedOnlineMatches.has(state_ui_battle_state.game.matchId)) return;
  state_ui_battle_state.game.resultFinalized = true;
  state_online_transport.finalizedOnlineMatches.add(state_ui_battle_state.game.matchId);
  state_ui_battle_state.game.resultType = resultType;
  state_ui_battle_state.game.finishedAt = Date.now();
  state_ui_battle_state.game.winner = winnerTeam;
  if (resultType === "surrender") log(state_ui_battle_state.game, winnerTeam === state_ui_deck.onlineSide ? "상대가 전투에서 나갔습니다. 탈주승." : "전투에서 나갔습니다. 탈주 패배.", "turn");else if (resultType === "disconnectForfeit") log(state_ui_battle_state.game, winnerTeam === state_ui_deck.onlineSide ? "상대가 10초 안에 재접속하지 않았습니다. 탈주승." : "연결 종료로 탈주 패배.", "turn");else if (resultType === "technicalError") {
    state_ui_battle_state.game.winner = null;
    log(state_ui_battle_state.game, "네트워크 장애로 경기가 무효 처리됐습니다.", "turn");
  }
  if (state_ui_battle_state.game.winner) {
    state_runtime_state.StateFactory.updateActive(state_ui_battle_state.game);
    const terminalEventPublished = Array.isArray(state_ui_battle_state.game.eventLog) && state_ui_battle_state.game.eventLog.some(event => event?.type === "BATTLE_ENDED");
    if (!terminalEventPublished) state_runtime_entities.BattleEventEngine.emit(state_ui_battle_state.game, "BATTLE_ENDED", {
      teamId: state_ui_battle_state.game.winner,
      payload: {
        winner: state_ui_battle_state.game.winner,
        resultType
      }
    });
  }
  cancelDisconnectGrace();
  state_ui_deck.p2p.battleStarted = false;
  if (state_ui_deck.p2p.conn?.open) p2pSend({
    type: "onlineResult",
    matchId: state_ui_battle_state.game.matchId,
    winnerTeam,
    resultType,
    finishedAt: state_ui_battle_state.game.finishedAt
  });
  if (state_ui_battle_state.game.winner) systems.OnlineRuntime?.markBattleEnded?.({
    source: `online-result:${resultType}`,
    canonicalRevision: Number(state_ui_battle_state.game.networkRevision || 0)
  });else {
    state_ui_battle_state.$("#actionHint").textContent = "무효 경기";
    render();
  }
}
export function applyRemoteOnlineResult(msg) {
  if (!state_ui_battle_state.game || state_ui_battle_state.game.matchId !== msg.matchId || state_ui_battle_state.game.resultFinalized) return;
  finalizeOnlineBattleResult(msg.resultType, msg.winnerTeam);
}
export function ensureOnlineLeaveButton() {
  let b = state_ui_battle_state.$("#onlineLeaveBattleBtn");
  if (!b) return;
  b.hidden = !(state_ui_battle_state.game?.mode === "online" && state_ui_deck.p2p.battleStarted && !state_ui_battle_state.game?.winner);
}
export function handleOnlineHeartbeatPacket() {
  if (canonicalRelayTransportOwnsLifecycle()) return true;
  state_ui_deck.p2p.lastRemoteHeartbeat = Date.now();
  cancelDisconnectGrace();
  return true;
}
export function handleOnlineSurrenderPacket(msg) {
  const incoming = String(msg?.matchId || ""),
    local = String(state_ui_deck.p2p?.matchId || state_ui_battle_state.game?.matchId || "");
  if (!incoming || !local || incoming !== local) return false;
  finalizeOnlineBattleResult("surrender", state_ui_deck.onlineSide);
  return true;
}
export function handleOnlineResultPacket(msg) {
  if (state_ui_deck.p2p?.role !== "guest") return false;
  const incoming = String(msg?.matchId || ""),
    local = String(state_ui_deck.p2p?.matchId || state_ui_battle_state.game?.matchId || "");
  if (!incoming || !local || incoming !== local) return false;
  applyRemoteOnlineResult(msg);
  return true;
}
export function handleOnlineClientClosingPacket(msg) {
  const incoming = String(msg?.matchId || ""),
    local = String(state_ui_deck.p2p?.matchId || state_ui_battle_state.game?.matchId || "");
  if (!incoming || !local || incoming !== local) return false;
  if (state_ui_battle_state.game?.mode === "online" && state_ui_deck.p2p.battleStarted) {
    startDisconnectGrace();
    return true;
  }
  return false;
}

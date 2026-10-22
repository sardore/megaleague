// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_online_start = {
  onlineCoinShownScopes: undefined,
  onlineStartTrace: undefined
};
import { state_runtime_transactions } from "../runtime/transactions.js";
import { state_runtime_input } from "../runtime/input.js";
import { state_runtime_config } from "../runtime/config.js";
import { state_catalog_cards } from "../catalog/cards.js";
import { clone } from "../engine/entities.js";
import { showOnlineCoinToss } from "../features/foxious.js";
import { state_features_genocider } from "../features/genocider.js";
import { state_online_commands } from "./commands.js";
import { onlineRulesPayload, p2pSend, registerOnlineConnectionRoute, serializeOnlineGame, updateP2PStatus } from "./connection.js";
import { onlineCompositionNow, onlineDeckIsReady, onlineLeagueNow, onlineLocalTeam, onlineRemoteCompositionNow, refreshOnlineRoomControls, state_online_lobby } from "./lobby.js";
import { randomId } from "./transport.js";
import { systems } from "../runtime/systems.js";
import { scheduleAI, startBattle } from "../ui/action-choices.js";
import { state_ui_action_panel } from "../ui/action-panel.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { stopBgm, state_ui_deck } from "../ui/deck.js";
import { isInvaderCardId } from "../ui/invaders.js";
import { state_ui_setup } from "../ui/setup.js";
export function initializeOnlineStart() {
  state_online_start.onlineCoinShownScopes = new Set();
  state_online_start.onlineStartTrace = [];
  registerOnlineConnectionRoute("lobbyMutationR2", "lobby-engine-authority", handleOnlineLobbyAuthorityPacket, 60);
  registerOnlineConnectionRoute("lobbyEnvelopeR2", "lobby-engine-authority", handleOnlineLobbyAuthorityPacket, 60);
  registerOnlineConnectionRoute("lobbyStateRequestR2", "lobby-engine-authority", handleOnlineLobbyAuthorityRequestPacket, 60);
  registerOnlineConnectionRoute("startAckR1", "start-transaction", handleOnlineStartAckPacket, 80);
  registerOnlineConnectionRoute("startRequestR1", "start-transaction", handleOnlineStartRequestPacket, 80);
  registerOnlineConnectionRoute("startCommittedR1", "start-transaction", handleOnlineStartCommittedPacket, 80);
  registerOnlineConnectionRoute("startCommittedAckR1", "start-transaction", handleOnlineStartCommittedAckPacket, 80);
  registerOnlineConnectionRoute("startAbortR1", "start-transaction", handleOnlineStartAbortPacket, 90);
}
export function onlineMatchScope(result = null) {
  const matchId = String(result?.matchId || state_ui_deck.p2p?.matchId || state_ui_battle_state.game?.matchId || "").trim();
  if (matchId) return `match:${matchId}`;
  const roomCode = String(state_ui_deck.p2p?.roomCode || "").trim();
  if (roomCode) return `room:${roomCode}`;
  return "online:pending";
}
export function cloneAndSanitizeOnlineDeck(deck, league = onlineLeagueNow(), composition = onlineCompositionNow()) {
  const clean = [];
  for (const raw of Array.isArray(deck) ? deck : []) {
    const id = String(raw || ""),
      c = state_catalog_cards.CARDS.find(x => x.id === id);
    if (!c || clean.includes(id) || !state_ui_deck.LeagueFormatOwner.cardAllowed(c, league, composition)) continue;
    if (!state_ui_deck.LeagueFormatOwner.partialValid([...clean, id], league, composition)) continue;
    if (clean.length < 4) clean.push(id);
  }
  return clean;
}
export function handleOnlineLobbyAuthorityPacket(msg) {
  return state_online_lobby.LobbyEngine.receiveState(msg);
}
export function onlineStartPacketDigest(packet = {}) {
  const canonical = {
    protocol: String(packet.protocol || "mega-online-start-r1"),
    mode: String(packet.mode || "PVP"),
    sessionGeneration: Number(packet.sessionGeneration || 0),
    matchId: String(packet.matchId || ""),
    battleId: String(packet.battleId || ""),
    startTransactionId: String(packet.startTransactionId || ""),
    coinResult: packet.coinResult || null,
    rules: packet.rules || null,
    state: packet.state || null
  };
  const text = JSON.stringify(canonical);
  let h1 = 0x811c9dc5,
    h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c + i, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}
export function onlineStartIdentity(packet = {}) {
  const tx = String(packet.startTransactionId || `${String(packet.matchId || state_ui_deck.p2p?.matchId || "")}:${String(packet.battleId || state_ui_battle_state.game?.battleId || "")}:${String(packet.coinResult?.id || state_ui_deck.p2p?.coinResult?.id || "")}:${String(packet.coinResult?.firstTeam || state_ui_deck.p2p?.coinResult?.firstTeam || "")}`);
  const digest = String(packet.packetDigest || onlineStartPacketDigest(packet));
  return `${tx}:${digest}`;
}
export function traceOnlineStart(stage, packet = {}, detail = {}) {
  const row = Object.freeze({
    at: Date.now(),
    stage: String(stage || "UNKNOWN"),
    identity: packet && typeof packet === "object" ? onlineStartIdentity(packet) : null,
    matchId: String(packet?.matchId || state_ui_deck.p2p?.matchId || ""),
    battleId: String(packet?.battleId || state_ui_battle_state.game?.battleId || ""),
    role: state_ui_deck.p2p?.role || null,
    runtimeState: systems.OnlineRuntime?.debug?.().state || null,
    startState: state_ui_deck.p2p?.startCommitTrace?.state || null,
    ...detail
  });
  state_online_start.onlineStartTrace.push(row);
  if (state_online_start.onlineStartTrace.length > 320) state_online_start.onlineStartTrace.splice(0, state_online_start.onlineStartTrace.length - 220);
  return row;
}
export function resetOnlineStartTransactionState(reason = "start-reset", options = {}) {
  if (!state_ui_deck.p2p) return false;
  for (const key of ["startRetryTimerId", "startRequestTimerId", "startAckDeadlineTimerId", "startCommitConfirmTimerId"]) {
    const id = state_ui_deck.p2p[key];
    if (id) systems.OnlineRuntime?.sessionScope?.cancel?.(id);
    state_ui_deck.p2p[key] = 0;
  }
  traceOnlineStart("START_TRANSACTION_RESET", state_ui_deck.p2p.startCommitPacket || {
    matchId: state_ui_deck.p2p.matchId
  }, {
    reason: String(reason)
  });
  state_ui_deck.p2p.startCommitPacket = null;
  state_ui_deck.p2p.startCommitAck = null;
  state_ui_deck.p2p.startCommitConfirmedAck = null;
  state_ui_deck.p2p.startCommitTrace = null;
  state_ui_deck.p2p.onlineStartPending = false;
  state_ui_deck.p2p.__startCommitScope = null;
  state_ui_deck.p2p.lastStartAckScope = null;
  state_ui_deck.p2p.guestStartAwaitingHostCommit = null;
  if (options.clearApplied !== false) state_ui_deck.p2p.lastAppliedStartIdentity = null;
  return true;
}
export function abortOnlineStartTransaction(reason = "START_ACK_TIMEOUT") {
  const packet = state_ui_deck.p2p?.startCommitPacket ? clone(state_ui_deck.p2p.startCommitPacket) : null;
  if (!packet) return false;
  traceOnlineStart("START_TRANSACTION_ABORTED", packet, {
    reason: String(reason)
  });
  const abortNotice = {
    type: "startAbortR1",
    protocol: "mega-online-start-r1",
    identity: onlineStartIdentity(packet),
    matchId: String(packet.matchId || state_ui_deck.p2p?.matchId || ""),
    battleId: String(packet.battleId || ""),
    reason: String(reason),
    at: Date.now()
  };
  const abortSent = !!systems.OnlineRuntime?.sendControl?.(abortNotice);
  traceOnlineStart("START_ABORT_SENT", packet, {
    sent: abortSent,
    reason: String(reason)
  });
  if (packet.mode === "BOSS_COOP") systems.__redTimeoraBossRaid?.abortPendingStart?.(reason);else if (state_ui_battle_state.game?.mode === "online") {
    const battleId = state_ui_battle_state.game.battleId || null;
    if (battleId) {
      state_runtime_config.TimerManager?.clearScope?.(battleId);
      state_runtime_input.InputLockManager?.releaseBattle?.(battleId);
      state_runtime_transactions.ActionTransactionManager?.clearBattle?.(battleId);
    }
    state_ui_battle_state.game = null;
    state_ui_battle_state.busy = false;
    state_ui_battle_state.pendingSkill = null;
    state_ui_battle_state.visualEvents = [];
    state_ui_battle_state.visualHoldMs = 0;
    state_ui_battle_state.lastLog = 0;
    stopBgm();
    state_ui_action_panel.ActionPanelConvergenceOwner?.reset?.(`start-abort:${reason}`);
  }
  state_ui_deck.p2p.battleStarted = false;
  systems.OnlineRuntime?.abortBattleStart?.(reason);
  resetOnlineStartTransactionState(reason, {
    clearApplied: false
  });
  return true;
}
export function onlineStartCommittedPacket(packet, reason = "start-ack-commit") {
  return {
    type: "startCommittedR1",
    protocol: "mega-online-start-r1",
    identity: onlineStartIdentity(packet),
    matchId: String(packet?.matchId || ""),
    battleId: String(packet?.battleId || ""),
    reason: String(reason),
    at: Date.now()
  };
}
export function sendOnlineStartCommitted(packet, reason = "start-ack-commit") {
  if (state_ui_deck.p2p?.role !== "host" || !packet) return false;
  const committed = onlineStartCommittedPacket(packet, reason),
    sent = !!systems.OnlineRuntime?.sendControl?.(committed);
  traceOnlineStart("START_COMMITTED_SENT", packet, {
    sent,
    reason: String(reason)
  });
  return sent;
}
export function scheduleOnlineStartCommittedRetry(packet, attempt = 1) {
  if (!packet || state_ui_deck.p2p?.role !== "host" || !state_ui_deck.p2p?.startCommitAck || state_ui_deck.p2p?.startCommitConfirmedAck) return false;
  if (state_ui_deck.p2p.startCommitConfirmTimerId) systems.OnlineRuntime?.sessionScope?.cancel?.(state_ui_deck.p2p.startCommitConfirmTimerId);
  const identity = onlineStartIdentity(packet),
    delay = Math.min(2400, 350 + Math.max(0, attempt - 1) * 250);
  const retry = () => {
    state_ui_deck.p2p.startCommitConfirmTimerId = 0;
    if (state_ui_deck.p2p?.role !== "host" || state_ui_deck.p2p?.startCommitConfirmedAck || !state_ui_deck.p2p?.startCommitPacket || onlineStartIdentity(state_ui_deck.p2p.startCommitPacket) !== identity) return;
    sendOnlineStartCommitted(state_ui_deck.p2p.startCommitPacket, `commit-confirm-retry:${attempt}`);
    scheduleOnlineStartCommittedRetry(state_ui_deck.p2p.startCommitPacket, attempt + 1);
  };
  const sessionScope = systems.OnlineRuntime?.sessionScope;
  if (!sessionScope || sessionScope.closed) return false;
  state_ui_deck.p2p.startCommitConfirmTimerId = sessionScope.setTimeout(retry, delay, `start-commit-confirm-retry-${attempt}`, {
    phase: "SESSION"
  });
  return !!state_ui_deck.p2p.startCommitConfirmTimerId;
}
export function sendOnlineStartCommittedAck(identity, matchId, battleId, reason = "commit-confirmed") {
  if (state_ui_deck.p2p?.role !== "guest" || !identity) return false;
  return !!systems.OnlineRuntime?.sendControl?.({
    type: "startCommittedAckR1",
    protocol: "mega-online-start-r1",
    identity: String(identity),
    matchId: String(matchId || state_ui_deck.p2p?.matchId || ""),
    battleId: String(battleId || state_ui_battle_state.game?.battleId || ""),
    reason: String(reason),
    at: Date.now()
  });
}
export function finalizeHostOnlineStartCommit(msg = {}) {
  if (state_ui_deck.p2p?.role !== "host" || !state_ui_deck.p2p?.startCommitPacket || !state_ui_deck.p2p?.startCommitAck) return false;
  const packet = state_ui_deck.p2p.startCommitPacket;
  state_ui_deck.p2p.onlineStartPending = false;
  state_ui_deck.p2p.battleStarted = true;
  state_ui_deck.p2p.startCommitConfirmedAck = null;
  traceOnlineStart("START_TRANSACTION_FINALIZED", packet, {
    ackIdentity: msg.identity || state_ui_deck.p2p.startCommitAck.identity || null
  });
  if (packet.mode === "BOSS_COOP") {
    const committed = !!systems.__redTimeoraBossRaid?.commitPendingStart?.(packet);
    if (!committed) abortOnlineStartTransaction("BOSS_START_COMMIT_MISSING_GAME");else {
      sendOnlineStartCommitted(packet, "boss-start-ack-commit");
      scheduleOnlineStartCommittedRetry(packet, 1);
    }
    return committed;
  }
  if (!state_ui_battle_state.game || state_ui_battle_state.game.mode !== "online") return abortOnlineStartTransaction("START_COMMIT_GAME_MISSING");
  state_ui_battle_state.game.battleStarted = true;
  state_ui_battle_state.busy = false;
  const projected = systems.OnlineRuntime?.markBattleStarted?.({
    source: "start-ack-commit",
    canonicalRevision: Number(state_ui_battle_state.game.networkRevision || 0)
  });
  sendOnlineStartCommitted(packet, "pvp-start-ack-commit");
  scheduleOnlineStartCommittedRetry(packet, 1);
  state_online_commands.OnlineActionAdmissionOwner.startProbe();
  scheduleAI();
  return projected !== false;
}
export function scheduleOnlineStartPublicationRetry(packet, attempt = 1) {
  if (!packet || state_ui_deck.p2p?.role !== "host" || state_ui_deck.p2p?.startCommitAck) return false;
  if (state_ui_deck.p2p?.startRetryTimerId) systems.OnlineRuntime?.sessionScope?.cancel?.(state_ui_deck.p2p.startRetryTimerId);
  const delays = [650, 1300, 2400, 4000],
    delay = delays[Math.max(0, Math.min(delays.length - 1, attempt - 1))];
  const identity = onlineStartIdentity(packet);
  state_ui_deck.p2p.startRetryTimerId = systems.OnlineRuntime?.sessionScope?.setTimeout?.(() => {
    state_ui_deck.p2p.startRetryTimerId = 0;
    if (state_ui_deck.p2p?.role !== "host" || state_ui_deck.p2p?.startCommitAck || !state_ui_deck.p2p?.startCommitPacket || onlineStartIdentity(state_ui_deck.p2p.startCommitPacket) !== identity) return;
    const sent = !!systems.OnlineRuntime?.sendControl?.(clone(state_ui_deck.p2p.startCommitPacket));
    state_ui_deck.p2p.startCommitTrace = {
      ...(state_ui_deck.p2p.startCommitTrace || {}),
      state: "COMMITTED_AWAITING_ACK",
      republishCount: Number(state_ui_deck.p2p.startCommitTrace?.republishCount || 0) + (sent ? 1 : 0),
      lastRepublishedAt: Date.now(),
      lastRepublishSent: sent
    };
    // The old relay does not retain application snapshots. Keep the host transaction alive
    // until the guest ACKs or the session is explicitly closed, so a long background period
    // cannot turn a missed start packet into a dead match.
    scheduleOnlineStartPublicationRetry(packet, attempt + 1);
  }, delay, `start-publication-retry-${attempt}`, {
    phase: "SESSION"
  }) || 0;
  return !!state_ui_deck.p2p.startRetryTimerId;
}
export function scheduleOnlineStartReplayRequest(reason = "start-envelope-pending", attempt = 1) {
  if (state_ui_deck.p2p?.role !== "guest" || state_ui_deck.p2p?.battleStarted) return false;
  if (state_ui_deck.p2p?.startRequestTimerId) return true;
  const delays = [800, 1600, 3000],
    delay = delays[Math.max(0, Math.min(delays.length - 1, attempt - 1))];
  state_ui_deck.p2p.startRequestTimerId = systems.OnlineRuntime?.sessionScope?.setTimeout?.(() => {
    state_ui_deck.p2p.startRequestTimerId = 0;
    if (state_ui_deck.p2p?.role !== "guest" || state_ui_deck.p2p?.battleStarted) return;
    const sent = requestOnlineStartReplay(`${reason}:${attempt}`);
    if (attempt < delays.length) scheduleOnlineStartReplayRequest(reason, attempt + 1);
  }, delay, `start-replay-request-${attempt}`, {
    phase: "SESSION"
  }) || 0;
  return !!state_ui_deck.p2p.startRequestTimerId;
}
export function sendOnlineStartAck(packet, reason = "start-received") {
  if (!state_ui_deck.p2p?.conn?.open || state_ui_deck.p2p?.role !== "guest") return false;
  const identity = onlineStartIdentity({
    ...packet,
    battleId: state_ui_battle_state.game?.battleId || packet?.battleId
  });
  state_ui_deck.p2p.lastStartAckScope = identity;
  const ack = {
    type: "startAckR1",
    protocol: "mega-online-start-r1",
    identity,
    matchId: String(packet?.matchId || state_ui_deck.p2p.matchId || ""),
    battleId: String(state_ui_battle_state.game?.battleId || packet?.battleId || ""),
    initiativeId: String(packet?.coinResult?.id || state_ui_deck.p2p?.coinResult?.id || ""),
    firstTeam: packet?.coinResult?.firstTeam || state_ui_deck.p2p?.coinResult?.firstTeam || null,
    reason: String(reason),
    at: Date.now()
  };
  const routed = systems.OnlineRuntime?.sendControl?.(ack);
  if (routed === true) return true;
  return !!(state_ui_deck.p2p?.conn?.open && p2pSend(ack));
}
export function handleOnlineStartScopePacket(msg) {
  if (msg.matchId && !state_ui_deck.p2p.matchId) state_ui_deck.p2p.matchId = msg.matchId;
  if (msg.coinResult) {
    state_ui_deck.p2p.coinResult ||= clone(msg.coinResult);
    const scope = onlineMatchScope({
      ...msg.coinResult,
      matchId: msg.matchId || state_ui_deck.p2p.matchId
    });
    if (!state_ui_deck.p2p.__coinShown && !state_online_start.onlineCoinShownScopes.has(scope)) showOnlineCoinToss({
      ...msg.coinResult,
      matchId: msg.matchId || state_ui_deck.p2p.matchId || null
    });
  }
  if (state_ui_deck.p2p?.startRequestTimerId) {
    systems.OnlineRuntime?.sessionScope?.cancel?.(state_ui_deck.p2p.startRequestTimerId);
    state_ui_deck.p2p.startRequestTimerId = 0;
  }
  if (msg.mode !== "BOSS_COOP") state_online_lobby.LobbyEngine.setStartTransaction({
    startTransactionId: String(msg.startTransactionId || onlineStartIdentity(msg)),
    packetDigest: String(msg.packetDigest || onlineStartPacketDigest(msg)),
    matchId: String(msg.matchId || state_ui_deck.p2p.matchId || ""),
    battleId: String(msg.battleId || ""),
    initiativeId: String(msg.coinResult?.id || ""),
    firstTeam: msg.coinResult?.firstTeam || null,
    state: "RECEIVED"
  });
  const ackSent = sendOnlineStartAck(msg, "start-scope-applied");
  if (!ackSent) {
    const identity = onlineStartIdentity(msg);
    systems.OnlineRuntime?.sessionScope?.setTimeout?.(() => {
      if (state_ui_deck.p2p?.role === "guest" && state_ui_deck.p2p?.guestStartAwaitingHostCommit?.identity === identity) sendOnlineStartAck(msg, "start-scope-delayed-ack");
    }, 180, "start-delayed-ack", {
      phase: "SESSION"
    });
  }
  return true;
}
export function handleOnlineStartAckPacket(msg) {
  if (state_ui_deck.p2p?.role !== "host" || msg?.protocol !== "mega-online-start-r1" || !state_ui_deck.p2p.startCommitPacket) return false;
  const expected = onlineStartIdentity(state_ui_deck.p2p.startCommitPacket),
    incoming = String(msg.identity || "");
  if (incoming !== expected) return false;
  if (!state_ui_deck.p2p.startCommitAck) {
    state_ui_deck.p2p.startCommitAck = {
      identity: incoming,
      at: Date.now(),
      battleId: msg.battleId || null
    };
    for (const key of ["startRetryTimerId", "startAckDeadlineTimerId"]) {
      const id = state_ui_deck.p2p[key];
      if (id) systems.OnlineRuntime?.sessionScope?.cancel?.(id);
      state_ui_deck.p2p[key] = 0;
    }
    state_ui_deck.p2p.startCommitTrace = {
      ...(state_ui_deck.p2p.startCommitTrace || {}),
      state: "ACKED",
      ackReceivedAt: Date.now(),
      ackCount: 1
    };
    if (state_ui_deck.p2p.startCommitPacket?.mode !== "BOSS_COOP") state_online_lobby.LobbyEngine.setStartTransaction({
      ...state_online_lobby.LobbyEngine.debug().startTransaction,
      state: "ACKED",
      ackReceivedAt: Date.now()
    });
    finalizeHostOnlineStartCommit(msg);
  } else {
    sendOnlineStartCommitted(state_ui_deck.p2p.startCommitPacket, "duplicate-start-ack");
    scheduleOnlineStartCommittedRetry(state_ui_deck.p2p.startCommitPacket, 1);
  }
  return true;
}
export function rollbackGuestOnlineStart(msg, reason = "HOST_START_ABORTED") {
  if (state_ui_deck.p2p?.role !== "guest") return false;
  const pending = state_ui_deck.p2p.guestStartAwaitingHostCommit;
  if (!pending || String(msg?.identity || "") !== String(pending.identity || "") || String(msg?.matchId || "") !== String(pending.matchId || "")) return false;
  traceOnlineStart("GUEST_START_ROLLED_BACK", msg, {
    reason: String(reason)
  });
  const g = state_ui_battle_state.game,
    battleId = g?.battleId || msg?.battleId || null;
  if (battleId) {
    state_runtime_config.TimerManager?.clearScope?.(battleId);
    state_runtime_input.InputLockManager?.releaseBattle?.(battleId);
    state_runtime_transactions.ActionTransactionManager?.clearBattle?.(battleId);
  }
  state_ui_battle_state.game = null;
  state_ui_battle_state.busy = false;
  state_ui_battle_state.pendingSkill = null;
  state_ui_battle_state.visualEvents = [];
  state_ui_battle_state.visualHoldMs = 0;
  state_ui_battle_state.lastLog = 0;
  stopBgm();
  if (state_ui_deck.p2p.sessionMode === "bossRaid") systems.__redTimeoraBossRaid?.abortPendingStart?.(reason);
  state_ui_deck.p2p.battleStarted = false;
  state_ui_deck.p2p.lastAppliedStartIdentity = null;
  systems.OnlineRuntime?.abortBattleStart?.(reason);
  resetOnlineStartTransactionState(reason);
  return true;
}
export function handleOnlineStartCommittedPacket(msg) {
  if (state_ui_deck.p2p?.role !== "guest" || msg?.protocol !== "mega-online-start-r1") return false;
  const pending = state_ui_deck.p2p.guestStartAwaitingHostCommit;
  const identity = String(msg.identity || ""),
    matchId = String(msg.matchId || "");
  const pendingMatches = !!pending && identity === String(pending.identity || "") && matchId === String(pending.matchId || "");
  const appliedMatches = !pending && identity === String(state_ui_deck.p2p?.lastAppliedStartIdentity || "") && (!matchId || matchId === String(state_ui_deck.p2p?.matchId || state_ui_battle_state.game?.matchId || ""));
  if (!pendingMatches && !appliedMatches) return false;
  state_ui_deck.p2p.guestStartAwaitingHostCommit = null;
  state_ui_deck.p2p.battleStarted = true;
  if (state_ui_battle_state.game) state_ui_battle_state.game.battleStarted = true;
  sendOnlineStartCommittedAck(identity, matchId, msg.battleId, "start-committed-received");
  traceOnlineStart(pendingMatches ? "GUEST_START_COMMIT_CONFIRMED" : "GUEST_START_COMMIT_DUPLICATE_ACK", msg);
  state_ui_action_panel.ActionPanelConvergenceOwner?.request?.("guest-start-commit-confirmed", {
    force: true,
    networkRevision: Number(state_ui_battle_state.game?.networkRevision || 0)
  });
  return true;
}
export function handleOnlineStartCommittedAckPacket(msg) {
  if (state_ui_deck.p2p?.role !== "host" || msg?.protocol !== "mega-online-start-r1" || !state_ui_deck.p2p?.startCommitPacket) return false;
  const expected = onlineStartIdentity(state_ui_deck.p2p.startCommitPacket);
  if (String(msg.identity || "") !== expected || String(msg.matchId || "") !== String(state_ui_deck.p2p.startCommitPacket.matchId || "")) return false;
  state_ui_deck.p2p.startCommitConfirmedAck = {
    identity: expected,
    at: Date.now(),
    battleId: String(msg.battleId || "")
  };
  if (state_ui_deck.p2p.startCommitConfirmTimerId) systems.OnlineRuntime?.sessionScope?.cancel?.(state_ui_deck.p2p.startCommitConfirmTimerId);
  state_ui_deck.p2p.startCommitConfirmTimerId = 0;
  traceOnlineStart("START_COMMITTED_ACK_RECEIVED", state_ui_deck.p2p.startCommitPacket, {
    identity: expected
  });
  return true;
}
export function handleOnlineStartAbortPacket(msg) {
  if (msg?.protocol !== "mega-online-start-r1") return false;
  return rollbackGuestOnlineStart(msg, msg.reason || "HOST_START_ABORTED");
}
export function requestOnlineStartReplay(reason = "restore") {
  if (!state_ui_deck.p2p?.conn?.open || state_ui_deck.p2p?.role !== "guest") return false;
  const request = {
    type: "startRequestR1",
    protocol: "mega-online-start-r1",
    matchId: String(state_ui_deck.p2p.matchId || ""),
    expectedStartTransactionId: state_ui_deck.p2p?.sessionMode === "bossRaid" ? "" : String(state_online_lobby.LobbyEngine.debug()?.startTransaction?.startTransactionId || ""),
    reason: String(reason),
    at: Date.now()
  };
  const sent = !!systems.OnlineRuntime?.sendControl?.(request);
  traceOnlineStart("START_REPLAY_REQUEST_SENT", request, {
    sent,
    reason: String(reason)
  });
  return sent;
}
export function handleOnlineStartRequestPacket(msg) {
  if (state_ui_deck.p2p?.role !== "host" || msg?.protocol !== "mega-online-start-r1" || !state_ui_deck.p2p.startCommitPacket) return false;
  if (msg.matchId && String(msg.matchId) !== String(state_ui_deck.p2p.startCommitPacket.matchId || "")) return false;
  if (msg.expectedStartTransactionId && String(msg.expectedStartTransactionId) !== String(state_ui_deck.p2p.startCommitPacket.startTransactionId || "")) return false;
  const packet = clone(state_ui_deck.p2p.startCommitPacket);
  const sent = !!systems.OnlineRuntime?.sendControl?.(packet);
  traceOnlineStart("START_REPLAY_RESPONSE_SENT", packet, {
    sent,
    requestReason: msg.reason || null
  });
  if (sent) state_ui_deck.p2p.startCommitTrace = {
    ...(state_ui_deck.p2p.startCommitTrace || {}),
    republicationCount: Number(state_ui_deck.p2p.startCommitTrace?.republicationCount || 0) + 1,
    lastRepublishedAt: Date.now()
  };
  return sent;
}
export function handleOnlineLobbyAuthorityRequestPacket(msg) {
  return state_online_lobby.LobbyEngine.receiveStateRequest(msg);
}
export function rootOnlineRoomSelectCard(id) {
  const c = state_catalog_cards.CARDS.find(x => x.id === id);
  if (!c || isInvaderCardId(id)) return;
  const league = onlineLeagueNow(),
    composition = onlineCompositionNow();
  if (!state_ui_setup.DeckDraftApplication.toggleCard(id, 4, {
    mode: league,
    composition,
    plusStar: state_ui_deck.plusStarSelection,
    team: onlineLocalTeam()
  })) return;
  state_online_lobby.LobbyEngine.submitDeck();
}
export function makeOnlineCoinResult() {
  if (state_ui_deck.p2p.coinResult?.id) return state_ui_deck.p2p.coinResult;
  state_ui_deck.p2p.matchId ||= randomId(state_ui_deck.p2p.sessionMode === "matchmaking" ? "match" : "room-match");
  const roll = new Uint32Array(1);
  crypto.getRandomValues(roll);
  const firstTeam = roll[0] % 2 === 0 ? "P" : "A";
  state_ui_deck.p2p.coinResult = {
    firstTeam,
    face: firstTeam === "P" ? "gold" : "mono",
    id: `coin-${state_ui_deck.p2p.matchId}`
  };
  return state_ui_deck.p2p.coinResult;
}

// 기존 relay는 패킷 전달만 한다. 호스트가 한 번의 고정 전투 상태를 만들고 guest는 그 snapshot으로 수렴한다.
export function startOnlineRoomBattleOnce() {
  if (state_ui_deck.p2p?.role !== "host" || state_ui_deck.p2p?.onlineStartPending || state_ui_deck.p2p?.battleStarted || state_ui_battle_state.game?.mode === "online") return false;
  const lobbyState = state_online_lobby.LobbyEngine.ready(),
    league = onlineLeagueNow();
  const localComposition = lobbyState.localComposition || onlineCompositionNow();
  const remoteComposition = lobbyState.remoteComposition || onlineRemoteCompositionNow();
  const localDeck = [...lobbyState.localDeck],
    remoteDeck = [...lobbyState.remoteDeck];
  if (!onlineDeckIsReady(localDeck, league, localComposition, lobbyState.localPlusStar, "P") || !onlineDeckIsReady(remoteDeck, league, remoteComposition, lobbyState.remotePlusStar, "A")) {
    const state = document.getElementById("roomReadyState");
    if (state) state.textContent = "양쪽 모두 현재 리그에 맞는 덱 4장을 선택해야 합니다.";
    return false;
  }
  if (!state_ui_deck.p2p?.connected || !state_ui_deck.p2p?.conn?.open) {
    updateP2PStatus("전투 시작 실패 · ONLINE_START_TRANSPORT_NOT_READY");
    return false;
  }
  if (!state_online_lobby.LobbyEngine.hasAuthoritativeState()) {
    state_online_lobby.LobbyEngine.requestConsensus("start-click-authority-sync");
    updateP2PStatus("상대 덱 동기화 확인 중…");
    refreshOnlineRoomControls();
    return false;
  }
  state_ui_deck.p2p.matchId ||= randomId(state_ui_deck.p2p.sessionMode === "matchmaking" ? "match" : "room-match");
  const scope = onlineMatchScope({
    matchId: state_ui_deck.p2p.matchId
  });
  if (state_ui_deck.p2p.__startCommitScope === scope) return !!(state_ui_deck.p2p.battleStarted || state_ui_battle_state.game?.mode === "online");
  const teamCompositions = league === "comprehensive" ? {
    P: localComposition,
    A: remoteComposition
  } : null;
  const rules = onlineRulesPayload(league, localComposition, teamCompositions);
  state_ui_deck.p2p.rules = rules;
  state_ui_deck.p2p.localComposition = localComposition;
  state_ui_deck.p2p.remoteComposition = remoteComposition;
  const result = makeOnlineCoinResult();
  state_ui_deck.p2p.onlineStartPending = true;
  state_ui_deck.p2p.__startCommitScope = scope;
  state_ui_deck.p2p.startCommitTrace = {
    state: "COMMITTING",
    scope,
    at: Date.now(),
    localDeck: [...localDeck],
    remoteDeck: [...remoteDeck],
    localDeckDigest: lobbyState.localDigest,
    remoteDeckDigest: lobbyState.remoteDigest,
    initiativeId: result.id,
    firstTeam: result.firstTeam,
    publicationCount: 0
  };
  refreshOnlineRoomControls();
  updateP2PStatus("선후공 결정 중…");
  try {
    showOnlineCoinToss({
      ...result,
      matchId: state_ui_deck.p2p.matchId
    });
    state_ui_deck.onlineSide = "P";
    systems.OnlineRuntime?.markBattleStarting?.();
    startBattle(state_ui_deck.p2p.matchId, {
      pDeck: localDeck,
      aDeck: remoteDeck,
      plusStar: {
        P: lobbyState.localPlusStar,
        A: lobbyState.remotePlusStar
      },
      mode: "online",
      rules,
      firstTeam: result.firstTeam,
      coinResult: result,
      matchId: state_ui_deck.p2p.matchId
    });
    if (!state_ui_battle_state.game || state_ui_battle_state.game.mode !== "online") throw new Error("ONLINE_START_BATTLE_INITIALIZATION_FAILED");
    state_ui_battle_state.game.matchId = state_ui_deck.p2p.matchId;
    state_ui_battle_state.game.battleStarted = true;
    state_ui_battle_state.game.onlineMatchType = state_ui_deck.p2p.sessionMode || state_ui_deck.p2p.matchType || "roomCode";
    // p2p.battleStarted remains false until guest ACK proves the same start transaction was applied.
    const serialized = serializeOnlineGame();
    const startTransactionId = `start:${state_ui_deck.p2p.matchId}:${state_ui_battle_state.game.battleId || "pending"}`;
    const startPacket = {
      type: "start",
      mode: "PVP",
      state: serialized,
      rules,
      coinResult: clone(result),
      matchId: state_ui_deck.p2p.matchId,
      battleId: state_ui_battle_state.game.battleId || null,
      startTransactionId,
      sessionGeneration: Number(systems.OnlineRuntime?.identity?.().generation || 0),
      clientVersion: state_features_genocider.GENO_CLIENT_VERSION,
      protocol: "mega-online-start-r1"
    };
    startPacket.packetDigest = onlineStartPacketDigest(startPacket);
    state_ui_deck.p2p.startCommitPacket = clone(startPacket);
    state_ui_deck.p2p.startCommitAck = null;
    state_ui_deck.p2p.startCommitConfirmedAck = null;
    state_online_lobby.LobbyEngine.setStartTransaction({
      startTransactionId,
      packetDigest: startPacket.packetDigest,
      matchId: state_ui_deck.p2p.matchId,
      battleId: state_ui_battle_state.game.battleId || null,
      firstActor: state_ui_battle_state.game.order?.[state_ui_battle_state.game.turn]?.join(":") || null,
      initiativeId: result.id,
      firstTeam: result.firstTeam,
      localDeckDigest: lobbyState.localDigest,
      remoteDeckDigest: lobbyState.remoteDigest,
      revision: Number(state_online_lobby.LobbyEngine.debug().revision || 0) + 1,
      state: "COMMITTED_AWAITING_ACK"
    });
    traceOnlineStart("START_PACKET_CREATED", startPacket, {
      phaseBefore: systems.OnlineRuntime?.identity?.().phase || null
    });
    const startSent = !!systems.OnlineRuntime?.sendControl?.(startPacket);
    traceOnlineStart("START_PACKET_SENT", startPacket, {
      sent: startSent
    });
    state_ui_deck.p2p.startCommitTrace = {
      ...state_ui_deck.p2p.startCommitTrace,
      state: "COMMITTED_AWAITING_ACK",
      committedAt: Date.now(),
      battleId: state_ui_battle_state.game.battleId || null,
      publicationCount: startSent ? 1 : 0,
      republishCount: 0,
      initialPublicationDeferred: !startSent
    };
    scheduleOnlineStartPublicationRetry(startPacket, 1);
    if (!startSent) updateP2PStatus("전투 시작 동기화 재시도 중…");
    return true;
  } catch (error) {
    const battleId = state_ui_battle_state.game?.battleId || null;
    if (battleId) {
      state_runtime_config.TimerManager?.clearScope?.(battleId);
      state_runtime_input.InputLockManager?.releaseBattle?.(battleId);
      state_runtime_transactions.ActionTransactionManager?.clearBattle?.(battleId);
    }
    state_ui_battle_state.game = null;
    state_ui_battle_state.busy = false;
    state_ui_battle_state.pendingSkill = null;
    state_ui_battle_state.visualEvents = [];
    state_ui_battle_state.visualHoldMs = 0;
    state_ui_battle_state.lastLog = 0;
    stopBgm();
    state_ui_deck.p2p.battleStarted = false;
    state_ui_deck.p2p.onlineStartPending = false;
    state_ui_deck.p2p.__startCommitScope = null;
    state_ui_deck.p2p.startCommitPacket = null;
    state_ui_deck.p2p.startCommitAck = null;
    state_ui_deck.p2p.startCommitConfirmedAck = null;
    state_ui_deck.p2p.startCommitTrace = {
      ...(state_ui_deck.p2p.startCommitTrace || {}),
      state: "FAILED",
      failedAt: Date.now(),
      error: error?.message || String(error)
    };
    systems.OnlineRuntime?.abortBattleStart?.("ONLINE_START_COMMIT_FAILED");
    updateP2PStatus(`전투 시작 실패 · ${error?.message || "ONLINE_START_COMMIT_FAILED"}`);
    refreshOnlineRoomControls();
    systems.__megaRecordRecoveredError?.(error, "startOnlineRoomBattleOnce");
    return false;
  }
}
/* ================= 온라인 턴 권위 동기화·재전송 근본 보강 r7 ================= */

import { unitAt } from "../engine/actions.js";
import { onlineCurrentMatchId, onlineSafeSend, state_online_commands } from "./commands.js";
import { cloneOnlineVisualEvents, registerOnlineConnectionRoute, serializeOnlineGame } from "./connection.js";
import { sendOnlineStartCommittedAck, traceOnlineStart } from "./start.js";
import { playVisuals } from "../presentation/animations.js";
import { systems } from "../runtime/systems.js";
import { processPendingTraitChoice, scheduleAI } from "../ui/action-choices.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { startBgm, state_ui_deck } from "../ui/deck.js";
import { visualDelivery } from "./visual-delivery.js";
import { state_presentation_coordinates } from "../presentation/coordinates.js";
// Capture against this client's current layout before restoring a snapshot that
// may remove a defeated target. Never reuse another client's pixel coordinates.
function receiveAuthoritativeVisuals(msg) {
  const delivery = visualDelivery(state_ui_deck.p2p, onlineCurrentMatchId());
  const batches = delivery.unseen(msg).map(batch => ({
    ...batch,
    visuals: cloneOnlineVisualEvents(batch.visuals)
  }));
  for (const batch of batches) for (const event of batch.visuals) {
    delete event.vfxAnchorSnapshot;
    delete event.presentationAnchor;
    state_presentation_coordinates.VfxCoordinateOwner.captureInto(event);
    state_presentation_coordinates.DamagePresentationAnchorOwner.captureInto(state_ui_battle_state.game, event);
  }
  return () => {
    for (const batch of batches) {
      if (delivery.received.has(batch.id)) continue;
      state_ui_battle_state.visualEvents.push(...batch.visuals);
      playVisuals();
      delivery.received.add(batch.id);
    }
    return delivery.batches(msg).filter(batch => delivery.received.has(batch.id)).map(batch => batch.id);
  };
}
export function sendAuthoritativeOnlineState(visuals = [], ackActionId = null, force = false, actionResolution = null) {
  systems.__megaSpectatorR18?.beforeAuthoritativeState?.(visuals);
  const bossOnline = !!state_ui_battle_state.game?.bossRaid?.online;
  if (!state_ui_battle_state.game || !(state_ui_battle_state.game.mode === "online" || bossOnline) || state_ui_deck.p2p?.role !== "host") return false;
  const packet = cloneOnlineVisualEvents(visuals);
  const normalizedResolution = actionResolution?.actionId && ["accepted", "rejected", "unknown"].includes(String(actionResolution.status || "")) ? {
    actionId: String(actionResolution.actionId),
    status: String(actionResolution.status),
    reason: String(actionResolution.reason || "")
  } : null;
  const currentRevision = Math.max(Number(state_online_commands.onlineAuthoritativeRevision || 0), Number(state_ui_battle_state.game.networkRevision || 0));
  state_online_commands.onlineAuthoritativeRevision = force ? currentRevision : currentRevision + 1;
  state_ui_battle_state.game.networkRevision = state_online_commands.onlineAuthoritativeRevision;
  const revision = state_online_commands.onlineAuthoritativeRevision;
  // Transport availability cannot veto an already committed host mutation. Advance the
  // canonical revision first; onlineSafeSend may fail and the same immutable revision is
  // then retained by the single reliable-state retry owner below.
  const visualBatches = visualDelivery(state_ui_deck.p2p, onlineCurrentMatchId()).publish(revision, packet);
  const authoritativePacket = {
    type: "authoritativeState",
    protocol: state_online_commands.ONLINE_TURN_SYNC_VERSION,
    mode: bossOnline ? "BOSS_COOP" : "PVP",
    matchId: onlineCurrentMatchId(),
    revision,
    turnSerial: state_ui_battle_state.game.turnSerial,
    turn: state_ui_battle_state.game.turn,
    state: bossOnline ? systems.__redTimeoraBossRaid.serialize(state_ui_battle_state.game) : serializeOnlineGame(),
    ackActionId: ackActionId || null,
    actionResolution: normalizedResolution,
    visualPacketId: packet.length ? `${state_ui_battle_state.game.turnSerial}:${revision}` : null,
    visuals: packet,
    visualBatches,
    forced: !!force
  };
  const sent = onlineSafeSend(authoritativePacket);
  systems.LifecycleManager?.continuity?.authoritativeSettled?.({
    source: "host-authoritative-publication",
    mode: bossOnline ? "BOSS_COOP" : "PVP",
    revision,
    turnSerial: Number(state_ui_battle_state.game.turnSerial || 0),
    sent: !!sent,
    forced: !!force
  });
  if (state_ui_deck.p2p?.role === "host") {
    // Keep the newest canonical snapshot even when the first socket write fails.
    // The reliable retry loop can then publish this exact revision once transport recovers.
    state_ui_deck.p2p.__reliableStatePacket = authoritativePacket;
    state_ui_deck.p2p.__reliableStateAck = Math.min(Number(state_ui_deck.p2p.__reliableStateAck || 0), revision - 1);
    state_ui_deck.p2p.__reliableStateSentAt = sent ? Date.now() : 0;
  }
  systems.__megaSpectatorR18?.afterAuthoritativeState?.(sent);
  return sent;
}
export function onlineSnapshotEquivalentForInput(currentRaw, incomingRaw) {
  try {
    const normalize = raw => {
      const value = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw));
      if (value && typeof value === "object") {
        delete value.networkRevision;
        delete value.networkSequence;
        delete value.lastAppliedNetworkSequence;
      }
      return JSON.stringify(value);
    };
    return normalize(currentRaw) === normalize(incomingRaw);
  } catch {
    return false;
  }
}
export function admitAuthoritativeStateCommit(detail = {}) {
  const revision = Number(detail.revision || 0),
    kind = String(detail.kind || "authoritativeState");
  if (state_ui_battle_state.game?.winner) return systems.OnlineRuntime?.markBattleEnded?.({
    source: `authoritative:${kind}`,
    canonicalRevision: revision
  }) || false;
  const payload = {
    phase: "IN_BATTLE",
    revision,
    kind,
    inputPreserved: detail.inputPreserved === true
  };
  const restored = systems.OnlineRuntime?.restore?.authoritativeApplied?.(payload);
  if (restored) return restored;
  return systems.OnlineRuntime?.projection?.request?.(`authoritative:${kind}`, {
    phase: "IN_BATTLE",
    canonicalRevision: revision,
    surfaceIntent: payload.inputPreserved ? "PRESERVE_LOCAL_INPUT" : null
  });
}
export function applyAuthoritativeOnlineState(msg) {
  if (state_ui_deck.p2p?.role === "host" || !msg?.state) return false;
  const incomingMatch = String(msg.matchId || "");
  const localMatch = String(state_ui_deck.p2p?.matchId || state_ui_battle_state.game?.matchId || "");
  if (incomingMatch && localMatch && incomingMatch !== localMatch) return false;
  const revision = Number(msg.revision || 0);
  const restorePending = !!systems.OnlineRuntime?.restore?.pending?.();
  const appliedRevision = Number(state_ui_deck.p2p.lastAuthoritativeRevision || 0);
  if (incomingMatch && !state_ui_deck.p2p.matchId) state_ui_deck.p2p.matchId = incomingMatch;
  const bossMode = state_ui_deck.p2p?.sessionMode === "bossRaid" || !!state_ui_battle_state.game?.bossRaid?.online,
    expectedMode = bossMode ? "BOSS_COOP" : "PVP";
  if (msg.mode !== expectedMode) return false;
  const replayVisuals = receiveAuthoritativeVisuals(msg);
  const acknowledge = extra => onlineSafeSend({
    type: "stateAck",
    protocol: state_online_commands.ONLINE_TURN_SYNC_VERSION,
    mode: expectedMode,
    matchId: onlineCurrentMatchId(),
    revision,
    turnSerial: state_ui_battle_state.game?.turnSerial,
    ackActionId: msg.ackActionId || null,
    ...extra,
    visualAckIds: replayVisuals()
  });
  if (revision && (revision < appliedRevision || revision === appliedRevision && !restorePending)) {
    if (revision === appliedRevision) {
      const resolution = state_online_commands.OnlineActionAdmissionOwner.settle(msg);
      if (resolution.settled) admitAuthoritativeStateCommit({
        revision,
        kind: "authoritativeActionResolution"
      });
    }
    acknowledge();
    return false;
  }
  if (state_ui_deck.p2p.guestStartAwaitingHostCommit && String(state_ui_deck.p2p.guestStartAwaitingHostCommit.matchId || "") === String(msg.matchId || state_ui_deck.p2p.matchId || "")) {
    const pendingStart = {
      ...state_ui_deck.p2p.guestStartAwaitingHostCommit
    };
    traceOnlineStart("GUEST_START_COMMIT_CONFIRMED_BY_STATE", msg);
    state_ui_deck.p2p.guestStartAwaitingHostCommit = null;
    sendOnlineStartCommittedAck(pendingStart.identity, pendingStart.matchId, pendingStart.battleId, "authoritative-state-proves-commit");
  }
  if (bossMode) {
    let incomingPreview;
    try {
      incomingPreview = JSON.parse(msg.state);
    } catch (error) {
      systems.__megaRecordRecoveredError?.(error, "authoritative-state.boss.parse");
      return false;
    }
    state_online_commands.OnlineActionAdmissionOwner.settle(msg);
    const current = state_ui_battle_state.game?.order?.[state_ui_battle_state.game?.turn] || [],
      currentUnit = state_ui_battle_state.game ? unitAt(state_ui_battle_state.game, current[0], current[1]) : null;
    const localOwnsTurn = !!state_ui_battle_state.game && current[0] === "P" && (currentUnit && currentUnit.bossOwner === state_ui_deck.p2p.role || !currentUnit && state_ui_battle_state.game?.bossRaid?.slotOwners?.[current[1]] === state_ui_deck.p2p.role);
    const modalDecision = document.getElementById("modal")?.classList.contains("open") && !state_ui_battle_state.game?.winner;
    const localDecisionOpen = localOwnsTurn && !state_online_commands.OnlineActionAdmissionOwner.hasPending() && (!!state_ui_battle_state.pendingSkill || modalDecision);
    const sameTurnSnapshot = Number(msg.turnSerial) === Number(state_ui_battle_state.game?.turnSerial) && Number(incomingPreview?.turn) === Number(state_ui_battle_state.game?.turn);
    const sameDecisionState = sameTurnSnapshot && !!state_ui_battle_state.game && onlineSnapshotEquivalentForInput(systems.__redTimeoraBossRaid.serialize(state_ui_battle_state.game), msg.state);
    if (localDecisionOpen && sameDecisionState) {
      if (revision) state_ui_deck.p2p.lastAuthoritativeRevision = revision;
      state_ui_battle_state.game.networkRevision = Math.max(Number(state_ui_battle_state.game.networkRevision || 0), revision);
      admitAuthoritativeStateCommit({
        revision,
        kind: "authoritativeStateInputPreserved",
        inputPreserved: true
      });
      acknowledge({
        inputPreserved: true
      });
      return true;
    }
    let sameState = false;
    try {
      sameState = !!state_ui_battle_state.game?.bossRaid?.online && systems.__redTimeoraBossRaid.serialize(state_ui_battle_state.game) === msg.state;
    } catch (error) {
      systems.__megaRecordRecoveredError?.(error, "authoritative-state.boss.compare");
    }
    if (sameState) {
      if (revision) state_ui_deck.p2p.lastAuthoritativeRevision = revision;
      state_ui_battle_state.game.networkRevision = Math.max(Number(state_ui_battle_state.game.networkRevision || 0), revision);
      const boundaryNeedsHeal = !state_ui_deck.p2p.battleStarted || systems.OnlineRuntime?.identity?.().phase !== "IN_BATTLE";
      state_ui_deck.p2p.battleStarted = true;
      state_ui_deck.p2p.__bossStartReceivedMatchId = String(msg.matchId || state_ui_battle_state.game?.matchId || state_ui_deck.p2p.__bossStartReceivedMatchId || "");
      if (boundaryNeedsHeal) systems.OnlineRuntime?.markBattleStarted?.({
        source: "boss-authoritative-state-recovery",
        canonicalRevision: revision || Number(state_ui_battle_state.game?.turnSerial || 0)
      });
      admitAuthoritativeStateCommit({
        revision,
        kind: "authoritativeStateSame"
      });
      acknowledge();
      return true;
    }
    const boundaryNeedsHeal = !state_ui_deck.p2p.battleStarted || systems.OnlineRuntime?.identity?.().phase !== "IN_BATTLE";
    state_ui_battle_state.game = systems.__redTimeoraBossRaid.revive(msg.state);
    state_ui_battle_state.game.networkRevision = Math.max(Number(state_ui_battle_state.game.networkRevision || 0), revision);
    if (revision) state_ui_deck.p2p.lastAuthoritativeRevision = revision;
    state_ui_deck.p2p.battleStarted = true;
    state_ui_deck.p2p.__bossStartReceivedMatchId = String(msg.matchId || state_ui_battle_state.game?.matchId || state_ui_deck.p2p.__bossStartReceivedMatchId || "");
    if (boundaryNeedsHeal) systems.OnlineRuntime?.markBattleStarted?.({
      source: "boss-authoritative-state-recovery",
      canonicalRevision: revision || Number(state_ui_battle_state.game?.turnSerial || 0)
    });
    state_ui_battle_state.busy = false;
    state_ui_battle_state.pendingSkill = null;
    document.getElementById("log").innerHTML = "";
    admitAuthoritativeStateCommit({
      revision,
      kind: "authoritativeState"
    });
    acknowledge();
    if (state_ui_battle_state.game.pendingTraitChoices?.[0]?.kind === "bossReward") processPendingTraitChoice();else {
      document.getElementById("modal")?.classList.remove("open");
      scheduleAI();
    }
    state_online_commands.OnlineActionAdmissionOwner.startProbe();
    return true;
  }
  try {
    JSON.parse(msg.state);
  } catch (error) {
    systems.__megaRecordRecoveredError?.(error, "authoritative-state.pvp.parse");
    return false;
  }
  state_online_commands.OnlineActionAdmissionOwner.settle(msg);
  const activeTurn = state_ui_battle_state.game?.order?.[state_ui_battle_state.game?.turn] || [];
  const localTurn = activeTurn[0] === state_ui_deck.onlineSide;
  const modalDecision = document.getElementById("modal")?.classList.contains("open") && !state_ui_battle_state.game?.winner;
  const localDecisionOpen = localTurn && !state_online_commands.OnlineActionAdmissionOwner.hasPending() && (!!state_ui_battle_state.pendingSkill || modalDecision);
  const sameTurnSnapshot = Number(msg.turnSerial) === Number(state_ui_battle_state.game?.turnSerial) && Number(msg.turn) === Number(state_ui_battle_state.game?.turn);
  const sameDecisionState = sameTurnSnapshot && !!state_ui_battle_state.game && onlineSnapshotEquivalentForInput(serializeOnlineGame(), msg.state);
  if (localDecisionOpen && sameDecisionState) {
    if (revision) state_ui_deck.p2p.lastAuthoritativeRevision = revision;
    state_ui_battle_state.game.networkRevision = Math.max(Number(state_ui_battle_state.game.networkRevision || 0), revision);
    admitAuthoritativeStateCommit({
      revision,
      kind: "authoritativeStateInputPreserved",
      inputPreserved: true
    });
    acknowledge({
      inputPreserved: true
    });
    return true;
  }
  let sameState = false;
  try {
    sameState = !!state_ui_battle_state.game && state_ui_battle_state.game.mode === "online" && serializeOnlineGame() === msg.state;
  } catch (error) {
    systems.__megaRecordRecoveredError(error, "authoritative-state.pvp.compare");
  }
  if (sameState) {
    if (revision) state_ui_deck.p2p.lastAuthoritativeRevision = revision;
    state_ui_battle_state.game.networkRevision = Math.max(Number(state_ui_battle_state.game.networkRevision || 0), revision);
    admitAuthoritativeStateCommit({
      revision,
      kind: "authoritativeStateSame"
    });
    acknowledge();
    return true;
  }
  state_ui_battle_state.game = systems.OnlineSnapshotEngine.restoreState(msg.state, {
    source: "authoritative-state",
    rules: state_ui_deck.p2p.rules || state_ui_deck.ONLINE_COMMON_RULES
  });
  if (revision) state_ui_deck.p2p.lastAuthoritativeRevision = revision;
  state_ui_battle_state.game.matchId ||= state_ui_deck.p2p.matchId || incomingMatch || null;
  state_ui_battle_state.game.networkRevision = Math.max(Number(state_ui_battle_state.game.networkRevision || 0), revision);
  state_ui_battle_state.game.battleStarted = true;
  state_ui_deck.p2p.battleStarted = true;
  state_ui_deck.onlineSide = "A";
  state_ui_battle_state.busy = false;
  state_ui_battle_state.pendingSkill = null;
  state_ui_battle_state.lastLog = 0;
  state_ui_battle_state.visualEvents = [];
  document.getElementById("log").innerHTML = "";
  document.getElementById("modal").classList.remove("open");
  admitAuthoritativeStateCommit({
    revision,
    kind: "authoritativeState"
  });
  acknowledge();
  startBgm();
  return true;
}
export function initializeOnlineSnapshots() {
  for (const type of ["actionRequest", "commandAck", "authoritativeState", "stateRequest", "syncProbe"]) registerOnlineConnectionRoute(type, "online-action-admission", state_online_commands.OnlineActionAdmissionOwner.receive, 70);

  /* ===================== 타임오러 4.5☆ / 운명의 시계 / 드래곤메모리 리워크 ===================== */
}

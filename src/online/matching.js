import { sessionRuntime } from "./session-model.js";
import { failSession, beginSession } from "./cleanup.js";
import { state_ui_deck } from "../ui/deck.js";
import { systems } from "../runtime/systems.js";
import { state_online_commands } from "./commands.js";
import { onlineRulesPayload, applySharedOnlineRules } from "./connection.js";
export function stalePacket(code) {
  sessionRuntime.counters.staleCallbackDropCount++;
  sessionRuntime.recordError(code, "stale relay callback dropped");
  return false;
}
export function initializeOnlineMatching() {
  sessionRuntime.MATCH_COMMIT_TIMEOUT_MS = 8000;
}
export function clearMatchReadyCommitWatchdog(session) {
  const timerId = session?.matchCommitWatchdogTimerId;
  if (!timerId) return false;
  session.scope?.cancelResource?.(timerId);
  session.matchCommitWatchdogTimerId = 0;
  return true;
}
export function resetPrecommitOfferForReconnect(session, reason = "precommit-transport-reconnect") {
  if (!session || session.committed || session.kind !== "matchmaking" || !session.pendingOffer) return false;
  const matchId = session.pendingOffer.matchId || null;
  clearMatchReadyCommitWatchdog(session);
  session.pendingOffer = null;
  session.readyOfferIds.clear();
  session.scope?.record?.("precommit-offer-reset-for-reconnect", {
    reason: String(reason),
    matchId
  });
  return true;
}
export function recoverUncommittedMatch(session, reason = "match-commit-timeout") {
  if (sessionRuntime.activeSession !== session || session.committed || session.kind !== "matchmaking" || !session.pendingOffer) return false;
  const recoveryCount = Math.max(0, Number(session.context?.handshakeRecoveryCount || 0));
  session.scope?.record?.("match-commit-timeout", {
    reason: String(reason),
    matchId: session.pendingOffer.matchId || null,
    recoveryCount
  });
  if (recoveryCount >= 2) return failSession("MATCH_COMMIT_TIMEOUT", "relay가 매칭 확정을 완료하지 못했습니다.", {
    terminal: true
  });
  try {
    session.transport?.system?.({
      type: "match.cancel",
      mode: session.mode,
      queueEntryId: session.queueEntryId,
      reason: String(reason)
    });
  } catch {}
  const mode = session.mode,
    context = {
      ...(session.context || {}),
      handshakeRecoveryCount: recoveryCount + 1
    };
  sessionRuntime.CleanupCoordinator.close("match-commit-timeout-restart", {
    notify: false,
    keepUi: true,
    releaseActive: true
  });
  const restarted = beginSession({
    kind: "matchmaking",
    mode,
    context
  });
  sessionRuntime.projectStatus();
  return !!restarted;
}
export function scheduleMatchReadyCommitWatchdog(session, reason = "match-ready") {
  clearMatchReadyCommitWatchdog(session);
  if (sessionRuntime.activeSession !== session || session.committed || !session.pendingOffer) return false;
  const offerId = session.pendingOffer.matchId;
  session.matchCommitWatchdogTimerId = session.scope?.setTimeout?.(() => {
    session.matchCommitWatchdogTimerId = 0;
    if (sessionRuntime.activeSession === session && !session.committed && session.pendingOffer?.matchId === offerId) recoverUncommittedMatch(session, `watchdog:${reason}`);
  }, sessionRuntime.MATCH_COMMIT_TIMEOUT_MS, "match-ready-commit-watchdog", {
    phase: "SESSION"
  }) || 0;
  return !!session.matchCommitWatchdogTimerId;
}
export function sendMatchReady(session, reason = "match-offer") {
  if (sessionRuntime.activeSession !== session || session.committed || session.kind !== "matchmaking" || !session.pendingOffer) return false;
  const offer = session.pendingOffer;
  const sent = !!session.transport?.system?.({
    type: "match.ready",
    mode: session.mode,
    matchId: offer.matchId,
    queueEntryId: session.queueEntryId,
    role: offer.role
  });
  offer.readyAttempts = Number(offer.readyAttempts || 0) + 1;
  offer.readySentAt = Date.now();
  offer.readyReason = String(reason);
  session.scope?.record?.("match-ready-dispatched", {
    matchId: offer.matchId,
    reason: String(reason),
    attempt: offer.readyAttempts,
    sent
  });
  scheduleMatchReadyCommitWatchdog(session, reason);
  return sent;
}
export function resumePrecommitIntent(session, reason = "foreground-precommit") {
  if (sessionRuntime.activeSession !== session || session.committed) return false;
  if (session.pendingOffer?.matchId) {
    const sent = !!session.transport?.ready && sendMatchReady(session, reason);
    session.scope?.record?.("precommit-offer-reconfirmed", {
      reason: String(reason),
      matchId: session.pendingOffer.matchId,
      sent
    });
    return sent;
  }
  if (session.transport?.ready) {
    session.scope?.record?.("precommit-transport-still-ready", {
      reason: String(reason),
      kind: session.kind,
      state: session.machine.state
    });
    return true;
  }
  return false;
}
export function receiveMatchOffer(session, packet) {
  if (session.kind !== "matchmaking" || packet.queueEntryId !== session.queueEntryId || packet.mode !== session.mode) return stalePacket("STALE_MATCH_OFFER");
  if (session.mode === "PVP") {
    const offeredLeagueRaw = String(packet.league || "").trim();
    const wantedLeague = state_ui_deck.LeagueFormatOwner.normalizeLeague(session.context?.league || state_ui_deck.leagueSelection),
      offeredLeague = offeredLeagueRaw ? state_ui_deck.LeagueFormatOwner.definitions[offeredLeagueRaw] ? offeredLeagueRaw : null : wantedLeague;
    if (!offeredLeague) return stalePacket("LEAGUE_MATCH_OFFER_INVALID");
    if (offeredLeague === "comprehensive") {
      const offeredCompositionRaw = String(packet.composition || "").trim();
      if (offeredCompositionRaw && !state_ui_deck.LeagueFormatOwner.comprehensivePatterns[offeredCompositionRaw]) return stalePacket("LEAGUE_MATCH_OFFER_COMPOSITION_INVALID");
    }
    if (offeredLeague !== wantedLeague) return stalePacket("LEAGUE_MATCH_OFFER_MISMATCH");
  }
  if (!packet.remotePlayerId || packet.remotePlayerId === sessionRuntime.playerId) return failSession("SELF_MATCH_REJECTED", "relay offered the same player identity");
  if (!["host", "guest"].includes(packet.role)) return failSession("ROLE_ARBITRATION_INVALID", String(packet.role || "missing"));
  if (session.pendingOffer?.matchId && session.pendingOffer.matchId !== packet.matchId) return stalePacket("CONCURRENT_MATCH_OFFER");
  if (session.readyOfferIds.has(packet.matchId)) {
    sessionRuntime.counters.duplicateOfferDropCount++;
    if (session.pendingOffer?.matchId === packet.matchId && session.transport?.ready) sendMatchReady(session, "duplicate-match-offer");
    return true;
  }
  session.pendingOffer = {
    matchId: packet.matchId,
    role: packet.role,
    remotePlayerId: packet.remotePlayerId,
    remoteQueueEntryId: packet.remoteQueueEntryId
  };
  session.readyOfferIds.add(packet.matchId);
  session.machine.transition("HANDSHAKING", "match-offer");
  const sent = sendMatchReady(session, "match-offer");
  if (!sent) session.scope?.record?.("match-ready-send-deferred", {
    matchId: packet.matchId,
    bindingState: session.transport?.candidateBinding?.state || session.transport?.activeBinding?.state || null
  });
  return true;
}
export function setMatchIdentity(session, matchId) {
  const value = sessionRuntime.clean(matchId, 180);
  if (!value) throw new Error("MATCH_ID_REQUIRED");
  if (session.matchId && session.matchId !== value) throw new Error("MATCH_ID_IMMUTABLE");
  if (!session.matchId) {
    session.matchId = value;
    sessionRuntime.counters.matchIdMutationCount++;
  }
  return value;
}
export function activateOnlineApplicationRoutes(session, phase, reason = "application-activate") {
  if (!session || sessionRuntime.activeSession !== session || session.scope?.closed) return false;
  const normalizedPhase = String(phase || session.scope?.phase || "LOBBY");
  systems.__megaOnlineBattleChat?.startSession?.();
  if (normalizedPhase === "IN_BATTLE") {
    systems.OnlineReliableStateEngine?.start?.();
    state_online_commands.OnlineActionAdmissionOwner.startProbe();
  }
  if (normalizedPhase === "LOBBY" && session.role === "host" && !session.rulesPublished) {
    state_ui_deck.p2p.rules = state_ui_deck.p2p.rules || onlineRulesPayload();
    applySharedOnlineRules(state_ui_deck.p2p.rules);
    session.rulesPublished = !!session.transport?.sendControlPayload?.({
      type: "rules",
      mode: "PVP",
      matchId: session.matchId || state_ui_deck.p2p.matchId || null,
      rules: state_ui_deck.p2p.rules,
      reason: String(reason)
    });
  }
  session.scope?.record?.("application-routes-activated", {
    phase: normalizedPhase,
    reason: String(reason),
    rulesPublished: !!session.rulesPublished
  });
  return true;
}

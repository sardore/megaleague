import { state_runtime_execute } from "../runtime/execute.js";
// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_online_commands = {
  ONLINE_TURN_SYNC_VERSION: undefined,
  onlineAuthoritativeRevision: undefined,
  OnlineActionAdmissionOwner: undefined
};
import { unitAt } from "../engine/actions.js";
import { execute } from "../engine/execution.js";
import { applyManualSummonAction, normalizePendingSummonTurns } from "./emotes.js";
import { applyAuthoritativeOnlineState, sendAuthoritativeOnlineState } from "./snapshots.js";
import { onlineStartIdentity, scheduleOnlineStartCommittedRetry, sendOnlineStartCommitted } from "./start.js";
import { systems } from "../runtime/systems.js";
import { afterAction, scheduleAI } from "../ui/action-choices.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { state_ui_deck } from "../ui/deck.js";
export function initializeOnlineCommands() {
  state_online_commands.ONLINE_TURN_SYNC_VERSION = "mega-online-turn-sync-r7";
  state_online_commands.onlineAuthoritativeRevision = 0;
  state_online_commands.OnlineActionAdmissionOwner = (() => {
    let pending = null;
    let retryTimer = 0;
    let stateProbeTimer = 0;
    let commandSerial = 0;
    const hostResults = new Map();
    const resolutionTrace = [];
    const sessionScope = () => systems.OnlineRuntime?.sessionScope || null;
    const cancelTimer = timerId => {
      if (!timerId) return false;
      return sessionScope()?.cancel?.(timerId) === true;
    };
    const clearRetry = () => {
      if (retryTimer) cancelTimer(retryTimer);
      retryTimer = 0;
    };
    const immutablePending = () => pending ? Object.freeze({
      actionId: String(pending.packet.actionId || ""),
      expectedTurnSerial: Number(pending.packet.expectedTurnSerial ?? -1),
      attempts: Number(pending.attempts || 0),
      acked: !!pending.acked,
      suspended: !!pending.suspendedAt,
      createdAt: Number(pending.createdAt || 0)
    }) : null;
    const view = () => Object.freeze({
      pending: immutablePending(),
      pendingActionId: String(pending?.packet?.actionId || "") || null,
      hostCommandResults: hostResults.size,
      hostResolutionTrace: Object.freeze([...hostResults.entries()].slice(-40).map(([actionId, result]) => Object.freeze({
        actionId,
        ...result
      }))),
      authoritativeRevision: Number(state_online_commands.onlineAuthoritativeRevision || 0),
      stateProbeActive: !!stateProbeTimer,
      resolutionTrace: Object.freeze(resolutionTrace.slice(-40).map(row => Object.freeze({
        ...row
      })))
    });
    const hasPending = () => !!pending;
    const pendingActionId = () => String(pending?.packet?.actionId || "") || null;
    const clearPending = ({
      unlock = true,
      resolution = "cleared"
    } = {}) => {
      const previous = pending;
      clearRetry();
      pending = null;
      if (previous) {
        resolutionTrace.push(Object.freeze({
          at: Date.now(),
          actionId: previous.packet?.actionId || null,
          expectedTurnSerial: Number(previous.packet?.expectedTurnSerial ?? -1),
          resolution: String(resolution || "cleared"),
          attempts: Number(previous.attempts || 0)
        }));
        if (resolutionTrace.length > 160) resolutionTrace.splice(0, resolutionTrace.length - 96);
      }
      if (unlock && (state_ui_battle_state.game?.mode === "online" || state_ui_battle_state.game?.bossRaid?.online) && !state_ui_battle_state.game?.paused && !state_ui_battle_state.game?.winner) {
        state_ui_battle_state.busy = false;
        systems.OnlineRuntime?.projection?.request?.(`online-action-settled:${resolution}`, {
          phase: "IN_BATTLE",
          canonicalRevision: Number(state_ui_battle_state.game?.networkRevision || 0)
        });
      }
      return !!previous;
    };
    const sendPending = () => {
      if (!pending || !state_ui_deck.p2p?.connected || pending.suspendedAt) return false;
      pending.attempts++;
      pending.lastSentAt = Date.now();
      if (!pending.acked) return onlineSafeSend(pending.packet);
      return onlineSafeSend({
        type: "stateRequest",
        protocol: state_online_commands.ONLINE_TURN_SYNC_VERSION,
        mode: pending.packet.mode || "PVP",
        matchId: pending.packet.matchId,
        actionId: pending.packet.actionId,
        knownTurnSerial: Number(state_ui_battle_state.game?.turnSerial ?? -1),
        knownRevision: Number(state_ui_deck.p2p?.lastAuthoritativeRevision || state_ui_battle_state.game?.networkRevision || 0)
      });
    };
    const queue = packet => {
      const scope = sessionScope();
      if (pending || !scope || scope.closed) return false;
      const frozenPacket = Object.freeze({
        ...packet,
        action: Object.freeze(JSON.parse(JSON.stringify(packet.action || {})))
      });
      pending = {
        packet: frozenPacket,
        attempts: 0,
        acked: false,
        createdAt: Date.now(),
        lastSentAt: 0,
        suspendedAt: 0
      };
      state_ui_battle_state.busy = true;
      systems.OnlineRuntime?.projection?.request?.("online-action-pending", {
        phase: "IN_BATTLE",
        canonicalRevision: Number(state_ui_battle_state.game?.networkRevision || 0),
        surfaceIntent: "PRESERVE_LOCAL_INPUT"
      });
      sendPending();
      retryTimer = scope.setInterval(sendPending, 650, "online-action-command-retry", {
        phase: "SESSION"
      });
      return true;
    };
    const nextActionId = g => {
      const generation = Number(systems.OnlineRuntime?.identity?.().generation || 0);
      return `${onlineCurrentMatchId()}:generation:${generation}:turn:${Number(g?.turnSerial || 0)}:command:${++commandSerial}`;
    };
    const guestOwns = (g, t, s) => {
      if (!g || g !== state_ui_battle_state.game || state_ui_deck.p2p?.role !== "guest") return false;
      const active = g.order?.[g.turn] || [];
      if (active[0] !== t || Number(active[1]) !== Number(s)) return false;
      if (g?.bossRaid?.online) {
        if (t !== "P" || !systems.__redTimeoraBossRaid?.localControlsCurrent?.(g)) return false;
        const unit = unitAt(g, t, s);
        return unit ? unit.bossOwner === "guest" : g.bossRaid.slotOwners?.[s] === "guest";
      }
      return g.mode === "online" && t === state_ui_deck.onlineSide;
    };
    const requestAction = (g, t, s, action) => {
      if (!guestOwns(g, t, s)) return false;
      const actionId = String(action?.actionId || nextActionId(g));
      return queue({
        type: "actionRequest",
        protocol: state_online_commands.ONLINE_TURN_SYNC_VERSION,
        mode: g?.bossRaid?.online ? "BOSS_COOP" : "PVP",
        matchId: onlineCurrentMatchId(),
        actionId,
        expectedTurnSerial: Number(g.turnSerial || 0),
        expectedTurn: Number(g.turn || 0),
        team: t,
        slot: Number(s),
        action: {
          ...(action || {}),
          actionId
        }
      });
    };
    const admit = function (g, t, s, action, opt = {}) {
      const live = !opt?.sim && g && (g === state_ui_battle_state.game || opt?.r48Live === true);
      if (!live) return state_runtime_execute.CanonicalActionTransactionOwner.execute(g, t, s, action, opt);
      const online = g === state_ui_battle_state.game && (g?.mode === "online" || g?.bossRaid?.online);
      if (online && state_ui_deck.p2p?.role === "guest") return guestOwns(g, t, s) ? requestAction(g, t, s, action) : false;
      if (online && state_ui_deck.p2p?.role !== "host") return false;
      if (online) {
        const current = g.order?.[g.turn] || [],
          source = String(opt?.admissionSource || "local-input");
        if (current[0] !== t || Number(current[1]) !== Number(s)) return false;
        if (source === "host-automatic" && !['scheduled', 'sequence', 'speedDelay', 'noLegalPass', 'bossPassEmpty'].includes(action?.type)) return false;
        if (source === "local-input") {
          if (g?.bossRaid?.online) {
            const unit = unitAt(g, t, s);
            if (t !== "P" || (unit ? unit.bossOwner !== "host" : g.bossRaid.slotOwners?.[s] !== "host")) return false;
          } else if (t !== state_ui_deck.onlineSide) return false;
        } else if (!['host-remote', 'host-automatic'].includes(source)) return false;
      }
      return state_runtime_execute.CanonicalActionTransactionOwner.execute(g, t, s, action, opt);
    };
    const submitManualSummon = (g, q, u, owner, action) => {
      if (!g || !q || !u || !owner || !action) return false;
      const canonicalAction = {
        ...action,
        actionId: q.actionId,
        transactionId: q.transactionId,
        sourceInstanceId: u.uid
      };
      if (g.mode === "online" && state_ui_deck.p2p?.role === "guest") {
        if (q.team !== state_ui_deck.onlineSide || hasPending()) return false;
        return queue({
          type: "actionRequest",
          protocol: state_online_commands.ONLINE_TURN_SYNC_VERSION,
          mode: "PVP",
          commandKind: "summon",
          matchId: onlineCurrentMatchId(),
          actionId: q.actionId,
          transactionId: q.transactionId,
          expectedTurnSerial: Number(g.turnSerial || 0),
          expectedTurn: Number(g.turn || 0),
          team: q.team,
          summonUid: u.uid,
          ownerUid: owner.uid,
          action: canonicalAction
        });
      }
      if (g.mode === "online" && state_ui_deck.p2p?.role !== "host") return false;
      if (g.mode === "online" && q.team !== state_ui_deck.onlineSide) return false;
      const ownerSlot = Math.max(0, Number(g.teams?.[q.team]?.field?.findIndex(unit => unit?.uid === owner.uid) ?? 0));
      const accepted = systems.CanonicalActionTransactionOwner.execute(g, q.team, ownerSlot, canonicalAction, {
        admissionSource: "manual-summon"
      }, (state, team, slot, admitted) => applyManualSummonAction(state, team, u.uid, admitted));
      if (accepted) afterAction();else systems.OnlineRuntime?.projection?.request?.("manual-summon-rejected", {
        phase: "IN_BATTLE",
        canonicalRevision: Number(g.networkRevision || 0),
        surfaceIntent: "PRESERVE_LOCAL_INPUT"
      });
      return !!accepted;
    };
    const cacheResult = (actionId, accepted, reason) => {
      hostResults.set(actionId, Object.freeze({
        accepted: !!accepted,
        reason: String(reason || "")
      }));
      if (hostResults.size > 256) hostResults.delete(hostResults.keys().next().value);
    };
    const resolutionFor = actionId => {
      const id = String(actionId || ""),
        cached = id ? hostResults.get(id) : null;
      return id ? {
        actionId: id,
        status: cached ? cached.accepted ? "accepted" : "rejected" : "unknown",
        reason: cached ? cached.reason || (cached.accepted ? "accepted-by-authority" : "rejected-by-authority") : "not-observed-by-authority"
      } : null;
    };
    const receiveActionRequest = msg => {
      const bossMode = !!state_ui_battle_state.game?.bossRaid?.online,
        expectedMode = bossMode ? "BOSS_COOP" : "PVP";
      if (msg?.mode !== expectedMode || state_ui_deck.p2p?.role !== "host" || !state_ui_battle_state.game || !(state_ui_battle_state.game.mode === "online" || bossMode)) return false;
      const actionId = String(msg?.actionId || ""),
        localMatch = onlineCurrentMatchId(),
        incomingMatch = String(msg?.matchId || "");
      if (!actionId || incomingMatch && incomingMatch !== localMatch) return false;
      const cached = hostResults.get(actionId);
      if (cached) {
        onlineSafeSend({
          type: "commandAck",
          protocol: state_online_commands.ONLINE_TURN_SYNC_VERSION,
          mode: expectedMode,
          matchId: localMatch,
          actionId,
          accepted: cached.accepted,
          reason: cached.reason || "duplicate",
          turnSerial: state_ui_battle_state.game.turnSerial
        });
        sendAuthoritativeOnlineState([], cached.accepted ? actionId : null, true, resolutionFor(actionId));
        return true;
      }
      const current = state_ui_battle_state.game.order?.[state_ui_battle_state.game.turn] || [];
      let valid = Number(msg.expectedTurnSerial) === Number(state_ui_battle_state.game.turnSerial) && Number(msg.expectedTurn) === Number(state_ui_battle_state.game.turn);
      let summon = null;
      if (bossMode) {
        const currentUnit = unitAt(state_ui_battle_state.game, current[0], current[1]);
        const guestOwnsSlot = currentUnit?.bossOwner === "guest" || !currentUnit && state_ui_battle_state.game.bossRaid?.slotOwners?.[current[1]] === "guest";
        valid = valid && current[0] === "P" && msg.team === "P" && Number(current[1]) === Number(msg.slot) && guestOwnsSlot;
      } else if (msg.commandKind === "summon") {
        summon = normalizePendingSummonTurns(state_ui_battle_state.game);
        valid = valid && msg.team === "A" && !!summon && summon.q.team === "A" && summon.u.uid === msg.summonUid && summon.owner.uid === msg.ownerUid && actionId === summon.q.actionId && msg.transactionId === summon.q.transactionId;
      } else valid = valid && msg.team === "A" && current[0] === "A" && Number(current[1]) === Number(msg.slot);
      if (!valid) {
        cacheResult(actionId, false, "stale-turn");
        onlineSafeSend({
          type: "commandAck",
          protocol: state_online_commands.ONLINE_TURN_SYNC_VERSION,
          mode: expectedMode,
          matchId: localMatch,
          actionId,
          accepted: false,
          reason: "stale-turn",
          turnSerial: state_ui_battle_state.game.turnSerial
        });
        sendAuthoritativeOnlineState([], null, true, resolutionFor(actionId));
        return false;
      }
      const admittedAction = {
        ...(msg.action || {}),
        actionId
      };
      let accepted = false,
        rejectionReason = "invalid-action";
      try {
        accepted = summon ? !!systems.CanonicalActionTransactionOwner.execute(state_ui_battle_state.game, msg.team, Number(current[1] || 0), admittedAction, {
          admissionSource: "host-remote"
        }, (state, team, slot, a) => applyManualSummonAction(state, team, summon.u.uid, a)) : !!execute(state_ui_battle_state.game, msg.team, Number(msg.slot), admittedAction, {
          admissionSource: "host-remote"
        });
      } catch (error) {
        rejectionReason = `execution-error:${error?.name || "Error"}:${error?.message || String(error)}`;
        systems.__megaRecordRecoveredError?.(error, "online-action-admission.receive");
        accepted = false;
      }
      cacheResult(actionId, accepted, accepted ? "" : rejectionReason);
      if (accepted) {
        state_ui_deck.p2p.__pendingAuthoritativeAck = actionId;
        afterAction();
      } else sendAuthoritativeOnlineState([], null, true, resolutionFor(actionId));
      onlineSafeSend({
        type: "commandAck",
        protocol: state_online_commands.ONLINE_TURN_SYNC_VERSION,
        mode: expectedMode,
        matchId: localMatch,
        actionId,
        accepted,
        reason: accepted ? "" : rejectionReason,
        turnSerial: state_ui_battle_state.game.turnSerial
      });
      return accepted;
    };
    const settle = msg => {
      if (!pending) return Object.freeze({
        settled: false,
        status: "none"
      });
      const actionId = String(pending.packet.actionId || ""),
        resolution = msg?.actionResolution || null;
      let status = "pending";
      if (actionId && String(msg?.ackActionId || "") === actionId) status = "accepted";else if (actionId && String(resolution?.actionId || "") === actionId && ["accepted", "rejected", "unknown"].includes(String(resolution?.status || ""))) status = String(resolution.status);else if (Number(msg?.turnSerial) !== Number(pending.packet.expectedTurnSerial)) status = "superseded";
      if (status === "pending") return Object.freeze({
        settled: false,
        status,
        actionId
      });
      clearPending({
        unlock: false,
        resolution: `authority:${status}`
      });
      state_ui_battle_state.busy = false;
      return Object.freeze({
        settled: true,
        status,
        actionId
      });
    };
    const requestResolution = (reason = "authoritative-resume") => {
      if (!pending || !state_ui_deck.p2p?.connected) return false;
      pending.reconciliationRequestedAt = Date.now();
      pending.reconciliationReason = String(reason);
      return !!systems.OnlineRuntime?.sendControl?.({
        type: "stateRequest",
        protocol: state_online_commands.ONLINE_TURN_SYNC_VERSION,
        mode: pending.packet.mode || "PVP",
        matchId: pending.packet.matchId || onlineCurrentMatchId(),
        actionId: pending.packet.actionId,
        knownTurnSerial: Number(state_ui_battle_state.game?.turnSerial ?? -1),
        knownRevision: Number(state_ui_deck.p2p?.lastAuthoritativeRevision || state_ui_battle_state.game?.networkRevision || 0),
        resumeReason: String(reason)
      });
    };
    const startProbe = () => {
      if (stateProbeTimer) cancelTimer(stateProbeTimer);
      stateProbeTimer = 0;
      const scope = sessionScope();
      if (!scope || scope.closed) return false;
      stateProbeTimer = scope.setInterval(() => {
        const bossOnline = !!state_ui_battle_state.game?.bossRaid?.online;
        if (!state_ui_deck.p2p?.connected || !state_ui_battle_state.game || !(state_ui_battle_state.game.mode === "online" || bossOnline) || state_ui_deck.p2p.role !== "guest") return;
        onlineSafeSend({
          type: "syncProbe",
          protocol: state_online_commands.ONLINE_TURN_SYNC_VERSION,
          mode: bossOnline ? "BOSS_COOP" : "PVP",
          matchId: onlineCurrentMatchId(),
          turnSerial: state_ui_battle_state.game.turnSerial,
          revision: state_ui_deck.p2p.lastAuthoritativeRevision || 0,
          pendingActionId: pendingActionId(),
          awaitingStartCommitIdentity: state_ui_deck.p2p?.guestStartAwaitingHostCommit?.identity || null
        });
      }, 2500, "battle-authoritative-state-probe", {
        phase: "IN_BATTLE"
      });
      return true;
    };
    const receive = msg => {
      const expectedMode = state_ui_deck.p2p?.sessionMode === "bossRaid" || !!state_ui_battle_state.game?.bossRaid?.online ? "BOSS_COOP" : "PVP";
      const incomingMatch = String(msg?.matchId || ""),
        localMatch = String(state_ui_deck.p2p?.matchId || state_ui_battle_state.game?.matchId || "");
      if (msg?.protocol !== state_online_commands.ONLINE_TURN_SYNC_VERSION || msg?.mode !== expectedMode || !incomingMatch || !localMatch || incomingMatch !== localMatch) return false;
      if (msg.type === "actionRequest") return receiveActionRequest(msg);
      if (msg.type === "commandAck" && state_ui_deck.p2p?.role === "guest") {
        if (!pending || msg.actionId !== pending.packet.actionId) return false;
        pending.acked = true;
        pending.ackAt = Date.now();
        pending.ackRejected = msg.accepted !== true;
        return sendPending();
      }
      if (msg.type === "authoritativeState") return applyAuthoritativeOnlineState(msg);
      if (msg.type === "stateRequest" && state_ui_deck.p2p?.role === "host") {
        const actionId = String(msg.actionId || ""),
          cached = actionId ? hostResults.get(actionId) : null;
        sendAuthoritativeOnlineState([], cached?.accepted ? actionId : null, true, resolutionFor(actionId));
        return true;
      }
      if (msg.type === "syncProbe" && state_ui_deck.p2p?.role === "host" && (state_ui_battle_state.game?.mode === "online" || state_ui_battle_state.game?.bossRaid?.online)) {
        const awaitingIdentity = String(msg.awaitingStartCommitIdentity || "");
        if (awaitingIdentity && state_ui_deck.p2p?.startCommitPacket && onlineStartIdentity(state_ui_deck.p2p.startCommitPacket) === awaitingIdentity) {
          sendOnlineStartCommitted(state_ui_deck.p2p.startCommitPacket, "guest-sync-probe-awaiting-commit");
          scheduleOnlineStartCommittedRetry(state_ui_deck.p2p.startCommitPacket, 1);
        }
        const differs = Number(msg.turnSerial) !== Number(state_ui_battle_state.game.turnSerial) || Number(msg.revision || 0) !== Number(state_online_commands.onlineAuthoritativeRevision || 0) || !!msg.pendingActionId || !!awaitingIdentity;
        if (differs) {
          const actionId = String(msg.pendingActionId || ""),
            cached = actionId ? hostResults.get(actionId) : null;
          sendAuthoritativeOnlineState([], cached?.accepted ? actionId : null, true, resolutionFor(actionId));
        }
        return true;
      }
      return false;
    };
    const suspendSession = (reason = "background") => {
      clearRetry();
      if (stateProbeTimer) cancelTimer(stateProbeTimer);
      stateProbeTimer = 0;
      if (pending) {
        pending.suspendedAt = Date.now();
        pending.suspendReason = String(reason);
      }
      return !!pending;
    };
    const resumeSession = (reason = "foreground") => {
      const active = !!state_ui_battle_state.game && (state_ui_battle_state.game.mode === "online" || !!state_ui_battle_state.game?.bossRaid?.online);
      if (!active) return false;
      if (pending) {
        const scope = sessionScope();
        if (!scope || scope.closed) return false;
        pending.suspendedAt ||= Date.now();
        requestResolution(`resume:${reason}`);
        retryTimer = scope.setInterval(() => requestResolution(`resume-retry:${reason}`), 650, "online-action-resolution-retry", {
          phase: "SESSION"
        });
      }
      if (state_ui_battle_state.game.mode === "online" && state_ui_deck.p2p?.role === "host" && state_ui_battle_state.onlineAutoCommandOwner) {
        const owner = state_ui_battle_state.onlineAutoCommandOwner,
          same = owner.game === state_ui_battle_state.game && owner.token === state_ui_battle_state.game.token && owner.serial === state_ui_battle_state.game.turnSerial;
        if (owner.timerId) sessionScope()?.cancel?.(owner.timerId);
        state_ui_battle_state.onlineAutoCommandOwner = null;
        state_ui_battle_state.onlineAutoCommandActive = false;
        if (same) {
          state_ui_battle_state.busy = false;
          systems.OnlineRuntime?.projection?.request?.("online-auto-resume", {
            phase: "IN_BATTLE",
            canonicalRevision: Number(state_ui_battle_state.game.networkRevision || 0)
          });
          scheduleAI();
        }
      }
      return true;
    };
    const closeSession = () => {
      clearPending({
        unlock: false,
        resolution: "session-close"
      });
      if (stateProbeTimer) cancelTimer(stateProbeTimer);
      stateProbeTimer = 0;
      hostResults.clear();
      state_online_commands.onlineAuthoritativeRevision = 0;
      commandSerial = 0;
      if (state_ui_deck.p2p) {
        state_ui_deck.p2p.lastAuthoritativeRevision = 0;
        state_ui_deck.p2p.lastVisualPacketId = null;
        state_ui_deck.p2p.visualDelivery = null;
      }
      return view();
    };
    const resetBattle = () => {
      closeSession();
      return true;
    };
    return Object.freeze({
      execute: admit,
      submitManualSummon,
      receive,
      settle,
      startProbe,
      suspendSession,
      resumeSession,
      closeSession,
      resetBattle,
      clearPending,
      hasPending,
      pendingActionId,
      resolutionFor,
      view,
      debug: view
    });
  })();
}
export function onlineSafeSend(packet) {
  try {
    const conn = state_ui_deck.p2p?.conn;
    if (!conn?.open) return false;
    return conn.send(packet) !== false;
  } catch (error) {
    if (systems.DEBUG_BATTLE_EVENTS) console.warn("[online] send failed", packet?.type, error);
    return false;
  }
}
export function onlineCurrentMatchId() {
  return String(state_ui_deck.p2p?.matchId || state_ui_battle_state.game?.matchId || state_ui_deck.p2p?.roomCode || "online");
}

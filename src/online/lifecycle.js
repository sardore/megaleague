import { sessionRuntime } from "./session-model.js";
import { state_online_commands } from "./commands.js";
import { systems } from "../runtime/systems.js";
import { state_ui_deck } from "../ui/deck.js";
import { state_runtime_config } from "../runtime/config.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { state_runtime_presentation } from "../runtime/presentation.js";
import { state_ui_action_panel } from "../ui/action-panel.js";
import { clearMatchReadyCommitWatchdog, resumePrecommitIntent } from "./matching.js";
export function initializeOnlineLifecycle() {
  sessionRuntime.LifecycleCoordinator = Object.freeze({
    background(reason = "background") {
      const session = sessionRuntime.activeSession;
      if (!session || ["IDLE", "CLOSED", "FAILED"].includes(session.machine.state)) return false;
      if (!session.lifecycleBackgrounded) {
        session.lifecycleBackgrounded = true;
        session.lifecycleEpoch = Number(session.lifecycleEpoch || 0) + 1;
      }
      session.hiddenAt ||= Date.now();
      session.backgroundReason = String(reason);
      session.lifecycleRestorePending = !!(session.committed && session.sessionToken);
      if (session.lifecycleRestorePending) {
        session.transport?.pauseHeartbeat?.(session.transport.activeBinding, `background:${reason}`);
        session.routesReady = false;
        state_online_commands.OnlineActionAdmissionOwner.suspendSession(reason);
        systems.OnlineReliableStateEngine?.pause?.();
        systems.__megaOnlineBattleChat?.pause?.();
        if (state_ui_deck.p2p) {
          state_ui_deck.p2p.reconnecting = true;
          state_ui_deck.p2p.connectionInterrupted = true;
        }
        const g = state_runtime_config.currentGame();
        if (state_ui_battle_state.onlineAutoCommandOwner) {
          const timerId = state_ui_battle_state.onlineAutoCommandOwner.timerId;
          if (timerId) session.scope?.cancelResource?.(timerId);
          state_ui_battle_state.onlineAutoCommandOwner = null;
          state_ui_battle_state.onlineAutoCommandActive = false;
        }
        systems.__redTimeoraBossRaid?.runtimePause?.(reason);
        if (g && typeof state_runtime_presentation.AnimationEngine !== "undefined") {
          state_runtime_presentation.AnimationEngine.settleInterrupted(`online-background:${reason}`, g.battleId || null);
          state_runtime_presentation.AnimationEngine.clearViewportFx();
        }
        if (g) state_ui_action_panel.ActionPanelConvergenceOwner?.suspend?.(`background-lock:${reason}`);
      } else if (session.pendingOffer?.matchId) clearMatchReadyCommitWatchdog(session);
      session.scope?.record?.("lifecycle-background", {
        reason: String(reason),
        routesReady: !!session.routesReady,
        bindingState: session.transport?.activeBinding?.state || null,
        restorePending: !!session.lifecycleRestorePending
      });
      return true;
    },
    foreground(reason = "foreground") {
      const session = sessionRuntime.activeSession;
      if (!session || ["IDLE", "CLOSED", "FAILED"].includes(session.machine.state)) return false;
      const hiddenAt = Number(session.hiddenAt || 0),
        hiddenDuration = hiddenAt ? Math.max(0, Date.now() - hiddenAt) : 0;
      session.hiddenAt = 0;
      session.lifecycleBackgrounded = false;
      const binding = session.transport?.activeBinding,
        candidate = session.transport?.candidateBinding;
      const lifecycleEpoch = Number(session.lifecycleEpoch || 0);
      session.scope?.record?.("lifecycle-foreground", {
        reason: String(reason),
        hiddenDuration,
        lifecycleEpoch,
        bindingState: binding?.state || candidate?.state || null,
        committed: !!session.committed,
        restorePending: !!session.lifecycleRestorePending
      });
      if (!session.committed || !session.sessionToken) {
        const resumed = resumePrecommitIntent(session, `foreground:${reason}`);
        session.scope?.record?.("foreground-precommit-resumed", {
          reason: String(reason),
          state: session.machine.state,
          resumed: !!resumed,
          bindingState: session.transport?.candidateBinding?.state || session.transport?.activeBinding?.state || null
        });
        if (resumed || session.transport?.connecting || session.transport?.candidateBinding) return true;
        return session.transport?.reconnectNow?.(`foreground-precommit:${reason}`) || false;
      }
      const bindingSettled = binding?.state === "READY" && binding.socket?.readyState === WebSocket.OPEN;
      const alreadySettled = !session.lifecycleRestorePending && session.routesReady && bindingSettled && Number(session.lifecycleRestoredEpoch || 0) === lifecycleEpoch;
      if (alreadySettled) {
        if (!session.transport?.heartbeatTimer && document.visibilityState !== "hidden") session.transport?.startHeartbeat?.(binding);
        session.scope?.record?.("duplicate-foreground-suppressed", {
          reason: String(reason),
          bindingId: binding.id,
          lifecycleEpoch,
          heartbeatRestarted: !!session.transport?.heartbeatTimer
        });
        return true;
      }
      if (candidate?.state === "RESTORING") return true;
      session.lifecycleRestorePending = true;
      session.lifecycleRestoreRequestEpoch = lifecycleEpoch;
      session.routesReady = false;
      return session.transport?.requestAuthoritativeResync?.(`foreground:${reason}`) || false;
    },
    pagehide() {
      return this.background("pagehide");
    },
    pageshow() {
      return this.foreground("pageshow");
    },
    networkOnline() {
      return this.foreground("network-online");
    },
    requestAuthoritativeResync(reason = "REQUEST_AUTHORITATIVE_RESYNC") {
      const session = sessionRuntime.activeSession;
      if (!session || ["IDLE", "CLOSED", "FAILED"].includes(session.machine.state) || !session.committed || !session.sessionToken) {
        session?.scope?.record?.("authoritative-resync-precommit-suppressed", {
          reason: String(reason),
          state: session?.machine?.state || null
        });
        return false;
      }
      session.lifecycleRestorePending = true;
      session.lifecycleRestoreRequestEpoch = Number(session.lifecycleEpoch || 0);
      session.routesReady = false;
      return session.transport?.requestAuthoritativeResync?.(reason) || false;
    }
  });
}

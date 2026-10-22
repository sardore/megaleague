import { sessionRuntime } from "./session-model.js";
import { state_ui_deck, syncLeagueSelectionSurface } from "../ui/deck.js";
import { state_online_lobby } from "./lobby.js";
import { state_runtime_config } from "../runtime/config.js";
import { hideCardTooltip } from "../ui/cards.js";
import { state_ui_results } from "../ui/results.js";
import { systems } from "../runtime/systems.js";
import { render } from "../ui/payment.js";
import { state_ui_action_panel } from "../ui/action-panel.js";
import { showEnd, lockOnlineSettings } from "./connection.js";
import { updateDeckSetup } from "../ui/setup.js";
import { playVisuals } from "../presentation/animations.js";
export function initializeOnlineProjection() {
  sessionRuntime.projectStatusDom = () => {
    const session = sessionRuntime.activeSession,
      state = session?.machine.state || "IDLE",
      errorCode = session?.lastError?.code || "",
      suffix = state === "FAILED" && errorCode ? ` · ${errorCode}` : "",
      text = `${sessionRuntime.STATUS_TEXT[state] || state}${suffix}`;
    for (const node of [document.getElementById("p2pStatus"), document.getElementById("matchmakingStatus"), document.getElementById("bossRuntimeStatus"), ...document.querySelectorAll("[data-online-runtime-status]")]) if (node) node.textContent = text;
    const autoMatchButton = document.getElementById("openAutoMatch");
    if (autoMatchButton) {
      const pending = !!(session?.kind === "matchmaking" && session.mode === "PVP" && !session.committed && !['CLOSED', 'FAILED', 'ENDING'].includes(state));
      autoMatchButton.disabled = pending;
      autoMatchButton.textContent = pending ? "매칭 중…" : `${state_ui_deck.LeagueFormatOwner.definition(state_ui_deck.leagueSelection).label} 자동 매칭`;
      autoMatchButton.setAttribute("aria-busy", pending ? "true" : "false");
    }
    const code = document.getElementById("roomCodeText");
    if (code) code.textContent = session?.roomCode || "------";
    const identity = document.getElementById("onlineRuntimeIdentity");
    if (identity) identity.textContent = session ? `generation ${session.generation} · ${session.mode} · ${session.role || "role pending"} · ${session.scope?.phase || "ENTRY"}#${session.scope?.projectionEpoch || 0}` : "session 없음";
    return text;
  };
  sessionRuntime.ProjectionTransaction = (() => {
    const trace = [];
    let lastCommit = null;
    const canonicalRevisionFor = phase => phase === "LOBBY" ? Number(state_online_lobby.LobbyEngine?.debug?.().revision || 0) : phase === "IN_BATTLE" || phase === "TERMINAL" ? Number(state_runtime_config.currentGame()?.networkRevision || 0) : Number(sessionRuntime.activeSession?.scope?.projectionEpoch || 0);
    const commitNavigation = (phase, reason) => {
      const before = [...document.querySelectorAll(".screen.active")].map(node => node.id);
      if (phase === "LOBBY") {
        hideCardTooltip();
        document.querySelectorAll(".screen").forEach(node => node.classList.remove("active"));
        document.documentElement.dataset.onlineActiveSurface = "LOBBY";
        document.body.classList.add("online-lobby-open");
      } else if (phase === "IN_BATTLE") {
        document.documentElement.dataset.onlineActiveSurface = "IN_BATTLE";
        document.body.classList.remove("online-lobby-open");
        state_ui_results.NavigationApplication.request("game");
      } else if (phase === "SETUP") {
        document.documentElement.dataset.onlineActiveSurface = "SETUP";
        document.body.classList.remove("online-lobby-open");
        state_ui_results.NavigationApplication.request("setup");
      } else if (phase === "TERMINAL") document.documentElement.dataset.onlineActiveSurface = "TERMINAL";
      const after = [...document.querySelectorAll(".screen.active")].map(node => node.id);
      return true;
    };
    const commit = tx => {
      const session = sessionRuntime.activeSession,
        scope = session?.scope;
      if (!scope || !scope.valid(tx.identity, tx.phase) || sessionRuntime.phaseForState(session.machine.state) !== tx.phase && !(session.machine.state === "RECONNECTING" && session.resumeState === tx.phase)) {
        sessionRuntime.counters.staleCallbackDropCount++;
        scope?.record("projection-drop", {
          reason: tx.reason,
          phase: tx.phase
        });
        return Object.freeze({
          ...tx,
          committed: false,
          dropReason: "IDENTITY_PHASE_OR_EPOCH"
        });
      }
      const currentRevision = canonicalRevisionFor(tx.phase);
      if (Number(tx.canonicalRevision) < Number(currentRevision)) {
        sessionRuntime.counters.staleCallbackDropCount++;
        scope.record("projection-drop", {
          reason: tx.reason,
          phase: tx.phase,
          dropReason: "STALE_CANONICAL_REVISION",
          requestedRevision: tx.canonicalRevision,
          currentRevision
        });
        return Object.freeze({
          ...tx,
          committed: false,
          dropReason: "STALE_CANONICAL_REVISION"
        });
      }
      if (scope.transactions.has("restore") && tx.reason !== "restore-authoritative-apply" && !tx.allowDuringRestore) {
        scope.record("projection-drop", {
          reason: tx.reason,
          phase: tx.phase,
          dropReason: "RESTORE_INCOMPLETE"
        });
        return Object.freeze({
          ...tx,
          committed: false,
          dropReason: "RESTORE_INCOMPLETE"
        });
      }
      let result = null,
        phaseCommitOk = true,
        dropReason = null;
      sessionRuntime.projectStatusDom();
      if (tx.phase === "LOBBY") {
        commitNavigation("LOBBY", tx.reason);
        if (session.mode === "BOSS_COOP") {
          const shown = systems.__redTimeoraBossRaid?.showOnlineLobby?.(true);
          const modal = document.getElementById("modal"),
            surface = document.querySelector("#modalContent .boss-lobby");
          phaseCommitOk = shown !== false && !!(surface?.isConnected && modal?.classList.contains("open"));
          result = {
            ok: phaseCommitOk,
            mode: "BOSS_COOP",
            surface: surface?.className || null
          };
          if (!phaseCommitOk) dropReason = "BOSS_LOBBY_SURFACE_ACQUISITION_FAILED";
        } else {
          const acquired = state_online_lobby.LobbyEngine.acquireSurface({
            reason: `projection:${tx.reason}`,
            projectionEpoch: tx.projectionEpoch,
            canonicalRevision: tx.canonicalRevision,
            surfaceIntent: tx.surfaceIntent || null
          });
          if (!acquired?.ok) {
            phaseCommitOk = false;
            dropReason = "LOBBY_SURFACE_ACQUISITION_FAILED";
            result = acquired;
          } else {
            result = state_online_lobby.LobbyEngine.project(`projection:${tx.reason}`);
            phaseCommitOk = !!result?.ok;
            if (!phaseCommitOk) dropReason = result?.reason || "LOBBY_PROJECTION_NOT_PLAYABLE";
          }
        }
      } else if (tx.phase === "IN_BATTLE") {
        const g = state_runtime_config.currentGame(),
          preserveLocalInput = tx.surfaceIntent === "PRESERVE_LOCAL_INPUT";
        if (g && (g.mode === "online" || g?.bossRaid?.online) && !g.winner) {
          if (!preserveLocalInput) document.getElementById("modal")?.classList.remove("open", "online-room-r22", "online-room-closing");
          commitNavigation("IN_BATTLE", tx.reason);
          if (!preserveLocalInput) render();
          result = state_ui_action_panel.ActionPanelConvergenceOwner?.request?.(`projection:${tx.reason}`, {
            force: true,
            networkRevision: Number(g.networkRevision || 0)
          });
        } else {
          phaseCommitOk = false;
          dropReason = "BATTLE_CANONICAL_UNAVAILABLE";
        }
      } else if (tx.phase === "TERMINAL") {
        commitNavigation("TERMINAL", tx.reason);
        playVisuals();
        if (state_runtime_config.currentGame()?.winner) showEnd();
        result = true;
      } else if (tx.phase === "SETUP") {
        document.getElementById("modal")?.classList.remove("open", "online-room-r22", "online-room-closing");
        commitNavigation("SETUP", tx.reason);
        updateDeckSetup();
        document.documentElement.dataset.onlineSetupProjectionEpoch = String(tx.projectionEpoch || Date.now());
        result = true;
      }
      const committed = !!(phaseCommitOk && scope.valid(tx.identity, tx.phase));
      lastCommit = {
        ...tx,
        committed,
        dropReason: committed ? null : dropReason || "PHASE_PROJECTION_FAILED",
        committedAt: Date.now(),
        result
      };
      trace.push(lastCommit);
      if (trace.length > 480) trace.splice(0, trace.length - 320);
      scope.record("projection-commit", {
        phase: tx.phase,
        reason: tx.reason,
        canonicalRevision: tx.canonicalRevision,
        committed,
        dropReason: lastCommit.dropReason
      });
      return Object.freeze(lastCommit);
    };
    const request = (reason = "projection", options = {}) => {
      const session = sessionRuntime.activeSession,
        scope = session?.scope;
      if (!scope || scope.closed) {
        return false;
      }
      if (session.kind === "spectator") {
        return Object.freeze({
          id: `projection:${++sessionRuntime.projectionTransactionSerial}`,
          reason: String(reason),
          phase: "SESSION",
          canonicalRevision: 0,
          projectionEpoch: scope.projectionEpoch,
          createdAt: Date.now(),
          committed: true,
          spectatorSidecar: true
        });
      }
      const phase = String(options.phase || sessionRuntime.phaseForState(session.machine.state));
      if (scope.phase !== phase) scope.transitionPhase(phase, `projection:${reason}`);
      const tx = Object.freeze({
        id: `projection:${++sessionRuntime.projectionTransactionSerial}`,
        reason: String(reason),
        phase,
        canonicalRevision: Number(options.canonicalRevision ?? canonicalRevisionFor(phase)),
        projectionEpoch: scope.projectionEpoch,
        allowDuringRestore: options.allowDuringRestore === true,
        surfaceIntent: options.surfaceIntent || null,
        identity: scope.capture(`projection:${reason}`, phase),
        createdAt: Date.now()
      });
      return commit(tx);
    };
    const commitDetachedSetup = (reason = "result-to-setup") => {
      const tx = {
        id: `projection:${++sessionRuntime.projectionTransactionSerial}`,
        reason: String(reason),
        phase: "SETUP",
        canonicalRevision: 0,
        projectionEpoch: Number(document.documentElement.dataset.onlineSetupProjectionEpoch || 0) + 1,
        createdAt: Date.now(),
        detached: true
      };
      document.getElementById("modal")?.classList.remove("open", "online-room-r22", "online-room-closing");
      lockOnlineSettings(false);
      state_ui_results.NavigationApplication.request("setup");
      updateDeckSetup();
      syncLeagueSelectionSurface();
      document.documentElement.dataset.onlineSetupProjectionEpoch = String(tx.projectionEpoch);
      lastCommit = {
        ...tx,
        committed: true,
        committedAt: Date.now(),
        result: true
      };
      trace.push(lastCommit);
      return Object.freeze(lastCommit);
    };
    return Object.freeze({
      request,
      commitDetachedSetup,
      debug: () => ({
        lastCommit: lastCommit ? {
          ...lastCommit
        } : null,
        trace: trace.slice(-160)
      })
    });
  })();
}

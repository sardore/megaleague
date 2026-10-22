import { TimerManager } from "./timers.js";
// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_runtime_presentation = {
  AnimationEngine: undefined,
  BattleRenderer: undefined,
  LifecycleManager: undefined,
  ChatEngine: undefined,
  SpectatorEngine: undefined,
  g: undefined
};
import { state_engine_entities } from "../engine/entities.js";
import { state_features_timeora } from "../features/timeora.js";
import { state_online_commands } from "../online/commands.js";
import { registerOnlineConnectionRoute, state_online_connection } from "../online/connection.js";
import { state_online_lobby } from "../online/lobby.js";
import { state_online_session } from "../online/session.js";
import { state_online_sync } from "../online/sync.js";
import { state_online_transport } from "../online/transport.js";
import { state_presentation_animations } from "../presentation/animations.js";
import { state_presentation_coordinates } from "../presentation/coordinates.js";
import { state_runtime_config } from "./config.js";
import { state_runtime_entities } from "./entities.js";
import { state_runtime_execute } from "./execute.js";
import { state_runtime_input } from "./input.js";
import { state_runtime_state } from "./state.js";
import { systems } from "./systems.js";
import { state_runtime_transactions } from "./transactions.js";
import { state_ui_action_panel } from "../ui/action-panel.js";
import { markLocalBattleBackground, recoverLocalBattleAfterResume, state_ui_battle_state } from "../ui/battle-state.js";
import { bgmBattleActive, startBgm, stopBgm } from "../ui/deck.js";
import { render } from "../ui/payment.js";
import { state_ui_results } from "../ui/results.js";
import { state_ui_targeting } from "../ui/targeting.js";
export function initializeRuntimePresentation() {
  state_runtime_presentation.AnimationEngine = (() => {
    const pending = new Map();
    const viewportFxTimers = new Map();
    const interruptionTrace = [];
    const wait = (promise, options = {}) => {
      const id = options.id || `animation:${state_runtime_config.now()}:${Math.random().toString(36).slice(2)}`;
      const g = state_runtime_config.currentGame();
      if (g) g.pendingAnimation = {
        id,
        reason: options.reason || "animation"
      };
      const token = state_runtime_input.InputLockManager.lock(options.lockReason || "animation", id);
      let fallback = 0,
        interruptResolve = () => {};
      const interrupted = new Promise(resolve => {
        interruptResolve = detail => resolve({
          interrupted: true,
          ...detail
        });
      });
      const timeout = new Promise(resolve => {
        fallback = TimerManager.setTimeout(() => resolve({
          fallback: true
        }), options.timeoutMs || state_runtime_config.GameConfig.animationFallbackMs, {
          scope: g?.battleId,
          reason: "animation-fallback"
        });
      });
      const record = {
        id,
        battleId: g?.battleId || null,
        reason: options.reason || "animation",
        token,
        interrupt: interruptResolve,
        task: null
      };
      const task = Promise.race([Promise.resolve(promise).then(value => ({
        value
      })), timeout, interrupted]).then(result => {
        return result;
      }).finally(() => {
        TimerManager.clear(fallback);
        pending.delete(id);
        state_runtime_input.InputLockManager.unlock(token);
        if (g?.pendingAnimation?.id === id) g.pendingAnimation = null;
      });
      record.task = task;
      pending.set(id, record);
      return task;
    };
    const viewportLayer = () => {
      let layer = document.querySelector("body > .time-fx-viewport-layer");
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "time-fx-viewport-layer";
        layer.setAttribute("aria-hidden", "true");
        document.body.appendChild(layer);
      }
      return layer;
    };
    const unmountViewportFx = node => {
      const timer = viewportFxTimers.get(node);
      if (timer) TimerManager.clear(timer);
      viewportFxTimers.delete(node);
      node?.remove?.();
      return true;
    };
    const mountViewportFx = (node, arena, point, options = {}) => {
      if (!(node instanceof HTMLElement) || !arena?.getBoundingClientRect) throw new TypeError("INVALID_VIEWPORT_FX");
      unmountViewportFx(node);
      const rect = arena.getBoundingClientRect(),
        x = Number.isFinite(point?.x) ? point.x : 0,
        y = Number.isFinite(point?.y) ? point.y : 0;
      node.style.setProperty("left", `${rect.left + x}px`, "important");
      node.style.setProperty("top", `${rect.top + y}px`, "important");
      node.dataset.viewportFx = "true";
      viewportLayer().appendChild(node);
      const ttl = Math.max(250, Number(options.ttlMs) || state_runtime_config.GameConfig.animationFallbackMs);
      const timer = TimerManager.setTimeout(() => unmountViewportFx(node), ttl, {
        scope: state_runtime_config.currentGame()?.battleId,
        reason: options.reason || "viewport-fx-fallback"
      });
      viewportFxTimers.set(node, timer);
      return node;
    };
    const clearViewportFx = () => {
      for (const node of [...viewportFxTimers.keys()]) unmountViewportFx(node);
      document.querySelectorAll("body > .time-fx-viewport-layer > *").forEach(node => node.remove());
    };
    const settleInterrupted = (reason = "lifecycle-resume", battleId = state_runtime_config.currentGame()?.battleId || null) => {
      let count = 0;
      for (const record of [...pending.values()]) {
        if (battleId && record.battleId && record.battleId !== battleId) continue;
        record.interrupt({
          reason: String(reason),
          battleId: battleId || record.battleId || null
        });
        count++;
        interruptionTrace.push({
          at: Date.now(),
          id: record.id,
          battleId: record.battleId || null,
          reason: String(reason),
          lockToken: record.token
        });
      }
      if (interruptionTrace.length > 160) interruptionTrace.splice(0, interruptionTrace.length - 120);
      return count;
    };
    const cancelBattle = id => {
      settleInterrupted("battle-cancel", id);
      TimerManager.clearScope(id);
      clearViewportFx();
    };
    return Object.freeze({
      wait,
      pendingCount: () => pending.size,
      settleInterrupted,
      interruptionTrace: () => interruptionTrace.map(entry => ({
        ...entry
      })),
      viewportLayer,
      mountViewportFx,
      unmountViewportFx,
      clearViewportFx,
      cancelBattle
    });
  })();
  state_runtime_presentation.BattleRenderer = (() => {
    const escape = value => systems.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, "\\$&");
    const decorateDom = () => {
      for (const el of document.querySelectorAll("[data-uid]")) {
        const id = el.getAttribute("data-uid");
        if (id && !el.dataset.entityId) el.dataset.entityId = id;
        if ((el.classList.contains("battle-unit-card") || el.classList.contains("summon-card")) && !el.querySelector(":scope > .character-effect-popup-layer")) {
          const layer = document.createElement("div");
          layer.className = "character-effect-popup-layer";
          layer.setAttribute("aria-hidden", "true");
          el.appendChild(layer);
        }
      }
      for (const el of document.querySelectorAll("[data-team][data-slot]")) {
        const team = el.dataset.team,
          zone = el.dataset.zone || "field",
          slot = el.dataset.slot;
        el.dataset.slotId ||= state_runtime_config.IdFactory.slot(team, zone, slot);
      }
      return true;
    };
    const entityElement = id => document.querySelector(`[data-entity-id="${escape(id)}"]`);
    const popup = (recipientEntityId, text, kind = "effect") => {
      const host = entityElement(recipientEntityId);
      if (!host) return false;
      const layer = host.querySelector(":scope > .character-effect-popup-layer");
      if (!layer) return false;
      const node = document.createElement("div");
      node.className = `float-num ${kind}`;
      node.textContent = String(text);
      layer.appendChild(node);
      TimerManager.setTimeout(() => node.remove(), 1100, {
        scope: state_runtime_config.currentGame()?.battleId,
        reason: "effect-popup"
      });
      return true;
    };
    return Object.freeze({
      decorateDom,
      entityElement,
      popup
    });
  })();
  state_ui_action_panel.ActionRenderEngine.registerDecorator("core-r48", 1000, () => {
    state_runtime_input.InputLockManager.reconcileLegacyClock("render-actions");
    const g = state_runtime_config.currentGame(),
      box = document.getElementById("actionButtons");
    if (g && typeof state_ui_battle_state.pendingSkill !== "undefined" && state_ui_battle_state.pendingSkill && box && state_runtime_input.InputLockManager.canHumanInput(g) && !box.querySelector("[data-r48-target-cancel]")) {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "대상 선택 취소";
      cancel.dataset.r48TargetCancel = "true";
      cancel.dataset.lockExempt = "true";
      cancel.onclick = () => state_ui_targeting.TargetSelectionApplication.cancel("action-panel-target-cancel");
      box.prepend(cancel);
    }
    const terminal = !!(g?.winner || g?.ended);
    const locked = !terminal && !state_runtime_input.InputLockManager.canHumanInput(g);
    for (const button of document.querySelectorAll("#actionButtons button")) {
      if (button.dataset.actionPanelMeta === "terminal") {
        button.disabled = false;
        continue;
      }
      if (!button.dataset.lockExempt) button.disabled = button.disabled || locked;
    }
  });
  state_runtime_presentation.LifecycleManager = (() => {
    const handlers = new Map();
    const subscribe = (event, fn) => {
      const target = event === "visibilitychange" ? document : window,
        set = handlers.get(event) || new Set();
      set.add(fn);
      handlers.set(event, set);
      if (set.size === 1) target.addEventListener(event, dispatch, {
        passive: true
      });
      return () => set.delete(fn);
    };
    const dispatch = event => {
      for (const fn of [...(handlers.get(event.type) || [])]) try {
        fn(event);
      } catch (error) {
        systems.__megaRecordRecoveredError?.(error, `LifecycleManager:${event.type}`);
      }
    };
    const localBackground = reason => typeof markLocalBattleBackground === "function" && markLocalBattleBackground(reason);
    const localForeground = reason => typeof recoverLocalBattleAfterResume === "function" && recoverLocalBattleAfterResume(reason);
    const continuity = Object.freeze({
      flush: () => false,
      markHidden: () => {
        localBackground("visibility-hidden");
        return state_online_session.OnlineRuntime.lifecycle.background("visibility-hidden");
      },
      resume: reason => {
        const why = reason || "resume";
        const online = state_online_session.OnlineRuntime.lifecycle.foreground(why);
        const local = localForeground(why);
        return online || local;
      },
      resumeBgm: () => {
        if (bgmBattleActive()) {
          startBgm();
          return true;
        }
        stopBgm();
        return false;
      },
      settleBackgroundVisuals: reason => {
        const g = state_runtime_config.currentGame();
        if (!g) return false;
        const count = state_runtime_presentation.AnimationEngine.settleInterrupted(`lifecycle:${reason || "resume"}`, g.battleId || null);
        state_runtime_presentation.AnimationEngine.clearViewportFx();
        return count > 0;
      },
      transportSettled: detail => state_online_session.OnlineRuntime.projection.request(`transport-settled:${detail?.reason || "unknown"}`, {
        phase: state_online_session.OnlineRuntime.identity().phase
      }),
      authoritativeSettled: detail => state_online_session.OnlineRuntime.projection.request(`authoritative-settled:${detail?.reason || "unknown"}`, {
        phase: state_online_session.OnlineRuntime.identity().phase
      }),
      cancel: () => false,
      debug: () => ({
        owner: "OnlineRuntime+LocalBattle",
        identity: state_online_session.OnlineRuntime.identity(),
        scope: state_online_session.OnlineRuntime.sessionScope.debug(),
        local: {
          backgrounded: !!state_ui_battle_state.localBattleBackgrounded,
          autoTurn: state_ui_battle_state.localAutoTurnOwner ? {
            kind: state_ui_battle_state.localAutoTurnOwner.kind,
            token: state_ui_battle_state.localAutoTurnOwner.token,
            serial: state_ui_battle_state.localAutoTurnOwner.serial,
            battleId: state_ui_battle_state.localAutoTurnOwner.battleId,
            scheduledAt: state_ui_battle_state.localAutoTurnOwner.scheduledAt
          } : null,
          timerId: Number(state_ui_battle_state.localAutoTurnTimerId || 0)
        }
      })
    });
    subscribe("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        localBackground("visibility-hidden");
        state_online_session.OnlineRuntime.lifecycle.background("visibility-hidden");
      } else {
        state_online_session.OnlineRuntime.lifecycle.foreground("visibility-visible");
        localForeground("visibility-visible");
      }
    });
    subscribe("pageshow", () => {
      const online = state_online_session.OnlineRuntime.lifecycle.pageshow();
      localForeground("pageshow");
      return online;
    });
    subscribe("pagehide", () => {
      localBackground("pagehide");
      return state_online_session.OnlineRuntime.lifecycle.pagehide();
    });
    subscribe("offline", () => state_online_session.OnlineRuntime.lifecycle.background("network-offline"));
    subscribe("online", () => state_online_session.OnlineRuntime.lifecycle.networkOnline());
    subscribe("beforeunload", () => systems.__megaBeforeOnlineUnload?.());
    return Object.freeze({
      subscribe,
      count: event => (handlers.get(event) || new Set()).size,
      continuity
    });
  })();
  state_runtime_presentation.ChatEngine = Object.freeze({
    send: text => systems.__megaOnlineBattleChat?.send?.(text),
    receive: packet => systems.__megaOnlineBattleChat?.receivePacket?.(packet),
    clear: () => systems.__megaOnlineBattleChat?.clear?.(),
    closeSession: options => systems.__megaOnlineBattleChat?.closeSession?.(options) || null,
    startSession: () => systems.__megaOnlineBattleChat?.startSession?.() || null,
    debug: () => systems.__megaOnlineBattleChat?.debug?.() || {
      panelOpen: false,
      unread: 0,
      pendingCount: 0,
      messageCount: 0,
      seenCount: 0,
      retryTimer: false
    }
  });
  state_runtime_presentation.SpectatorEngine = Object.freeze({
    state: () => systems.__megaSpectatorR18?.state || null,
    sendChat: text => systems.__megaSpectatorR18?.sendChat?.(text),
    toggleView: () => systems.__megaSpectatorR18?.toggleView?.(),
    closeSession: options => systems.__megaSpectatorR18?.closeSession?.(options) || null,
    debug: () => systems.__megaSpectatorR18?.debug?.() || null
  });
  // Current behavior/protocol regression tests.

  registerOnlineConnectionRoute("*", "sync-engine-observer", packet => state_online_sync.SyncEngine.handlePacket(packet), 90);
  Object.assign(systems, {
    GameConfig: state_runtime_config.GameConfig,
    StateFactory: state_runtime_state.StateFactory,
    StateValidator: state_runtime_state.StateValidator,
    EntityRegistry: state_runtime_entities.EntityRegistry,
    ActionPanelViewModelOwner: state_ui_action_panel.ActionPanelViewModelOwner,
    ActionPanelConvergenceOwner: state_ui_action_panel.ActionPanelConvergenceOwner,
    ActionRenderEngine: state_ui_action_panel.ActionRenderEngine,
    OnlineActionAdmissionOwner: state_online_commands.OnlineActionAdmissionOwner,
    CanonicalActionTransactionOwner: state_runtime_execute.CanonicalActionTransactionOwner,
    EnergyEngine: state_runtime_entities.EnergyEngine,
    TurnEngine: state_runtime_transactions.TurnEngine,
    DeathEngine: state_runtime_transactions.DeathEngine,
    NetworkEngine: state_online_sync.NetworkEngine,
    SyncEngine: state_online_sync.SyncEngine,
    LobbyEngine: state_online_lobby.LobbyEngine,
    ChatEngine: state_runtime_presentation.ChatEngine,
    SpectatorEngine: state_runtime_presentation.SpectatorEngine,
    OnlineConnectionEngine: state_online_connection.OnlineConnectionEngine,
    OnlineTransportEngine: state_online_transport.OnlineTransportEngine,
    AnimationEngine: state_runtime_presentation.AnimationEngine,
    InputLockManager: state_runtime_input.InputLockManager,
    EventBus: state_runtime_config.EventBus,
    BattleRenderer: state_runtime_presentation.BattleRenderer,
    LifecycleManager: state_runtime_presentation.LifecycleManager,
    BattleEventEngine: state_runtime_entities.BattleEventEngine,
    RenderedBattleEntityMapOwner: state_presentation_coordinates.RenderedBattleEntityMapOwner,
    VfxCoordinateOwner: state_presentation_coordinates.VfxCoordinateOwner,
    DamagePresentationAnchorOwner: state_presentation_coordinates.DamagePresentationAnchorOwner,
    CombatStatPresentationOwner: state_ui_battle_state.CombatStatPresentationOwner,
    HorizonStrikeSequenceOwner: state_presentation_animations.HorizonStrikeSequenceOwner,
    DynamicSkillVfxPresentationOwner: state_presentation_animations.DynamicSkillVfxPresentationOwner,
    PlusStarInteractionOwner: state_engine_entities.PlusStarInteractionOwner,
    PlusStarBannerPresentationOwner: state_engine_entities.PlusStarBannerPresentationOwner,
    ResultContributionPresentationOwner: state_ui_results.ResultContributionPresentationOwner,
    GenericBattleStatisticsOwner: state_engine_entities.GenericBattleStatisticsOwner,
    EnergyOverflowPresentationOwner: state_features_timeora.EnergyOverflowPresentationOwner
  });
  Object.defineProperty(systems, "GameState", {
    configurable: true,
    get: state_runtime_config.currentGame
  });
  state_runtime_presentation.g = state_runtime_config.currentGame();
  if (state_runtime_presentation.g) state_runtime_state.StateFactory.decorate(state_runtime_presentation.g);
  state_runtime_input.InputLockManager.reconcileLegacyClock("architecture-init");
  // Existing online connections are admitted only through OnlineRuntime mode-adapter commit.
  state_online_sync.SyncEngine.ui.ensureButton();
  state_runtime_presentation.BattleRenderer.decorateDom();
}

// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_runtime_config = {
  PROTOCOL_VERSION: undefined,
  now: undefined,
  stableText: undefined,
  hashText: undefined,
  defineDerived: undefined,
  currentGame: undefined,
  GameConfig: undefined,
  IdFactory: undefined,
  EventBus: undefined,
  TimerManager: undefined
};
import { systems } from "./systems.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
export function initializeRuntimeConfig() {
  state_runtime_config.PROTOCOL_VERSION = "mega-r48";
  state_runtime_config.now = () => Date.now();
  state_runtime_config.stableText = value => {
    const seen = new WeakSet();
    const normalize = input => {
      if (!input || typeof input !== "object") return input;
      if (seen.has(input)) return "[Circular]";
      seen.add(input);
      if (Array.isArray(input)) return input.map(normalize);
      const out = {};
      for (const key of Object.keys(input).sort()) {
        if (key === "checksum" || key === "createdAt") continue;
        out[key] = normalize(input[key]);
      }
      return out;
    };
    return JSON.stringify(normalize(value));
  };
  state_runtime_config.hashText = text => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  state_runtime_config.defineDerived = (object, key, value) => {
    try {
      Object.defineProperty(object, key, {
        value,
        writable: true,
        configurable: true,
        enumerable: false
      });
    } catch {
      object[key] = value;
    }
    return value;
  };
  state_runtime_config.currentGame = () => {
    try {
      return typeof state_ui_battle_state.game !== "undefined" ? state_ui_battle_state.game : systems.game;
    } catch {
      return systems.game;
    }
  };
  state_runtime_config.GameConfig = Object.freeze({
    protocolVersion: state_runtime_config.PROTOCOL_VERSION,
    maxEnergyDefault: 4,
    maxEventLog: 1200,
    maxOnlineEventTail: 128,
    maxOnlineLogTail: 160,
    animationFallbackMs: 12000,
    networkSyncTimeoutMs: 12000,
    phases: Object.freeze(["IDLE", "BATTLE_STARTING", "TURN_START", "START_OF_TURN_EFFECTS", "WAITING_FOR_DEPLOYMENT", "WAITING_FOR_ENERGY_GAIN", "WAITING_FOR_ENERGY_REPLACEMENT", "WAITING_FOR_ACTION", "WAITING_FOR_TARGET", "WAITING_FOR_PAYMENT", "EXECUTING_ACTION", "WAITING_FOR_ANIMATION", "RESOLVING_EFFECTS", "CHECKING_DEATHS", "CHECKING_VICTORY", "TURN_END", "SWITCHING_TURN", "SYNCING", "BATTLE_ENDED"])
  });
  state_runtime_config.IdFactory = (() => {
    let eventSerial = 0,
      transactionSerial = 0,
      energySerial = 0,
      lockSerial = 0;
    const token = (prefix, battleId = "global") => `${prefix}:${battleId}:${state_runtime_config.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    return {
      battle(seed = "battle") {
        return token("battle", String(seed));
      },
      event(battleId, sequence) {
        return `event:${battleId}:${sequence || ++eventSerial}`;
      },
      transaction(battleId) {
        return `tx:${battleId}:${++transactionSerial}`;
      },
      energy(entityId = "entity") {
        return `energy:${entityId}:${++energySerial}`;
      },
      lock(reason) {
        return `lock:${reason}:${++lockSerial}`;
      },
      slot(team, zone, index) {
        return `slot:${team}:${zone}:${index}`;
      }
    };
  })();
  state_runtime_config.EventBus = (() => {
    const listeners = new Map();
    const on = (type, listener) => {
      if (typeof listener !== "function") throw new TypeError("listener must be a function");
      const set = listeners.get(type) || new Set();
      set.add(listener);
      listeners.set(type, set);
      return () => set.delete(listener);
    };
    const emit = event => {
      for (const type of [event.type, "*"]) {
        for (const listener of [...(listeners.get(type) || [])]) {
          try {
            listener(event);
          } catch (error) {
            console.error(`[R48 EventBus:${type}]`, error);
            queueMicrotask(() => {
              throw error;
            });
          }
        }
      }
      return event;
    };
    return Object.freeze({
      on,
      emit,
      clear(type) {
        type ? listeners.delete(type) : listeners.clear();
      },
      listenerCount(type) {
        return (listeners.get(type) || new Set()).size;
      }
    });
  })();
  state_runtime_config.TimerManager = systems.TimerManager;
}

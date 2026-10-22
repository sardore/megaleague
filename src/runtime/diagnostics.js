import { timeClockVisualSaturation } from "../presentation/clock-saturation.js";
import { TimerManager } from "./timers.js";
import { systems } from './systems.js';
import { state_ui_battle_state } from '../ui/battle-state.js';
import { state_catalog_cards } from '../catalog/cards.js';
import { card, newGame } from '../engine/entities.js';
import { legalActions, prepareCurrentTurn, unitAt } from '../engine/actions.js';
import { execute, endTurn } from '../engine/execution.js';
import { registerScheduledAction } from '../engine/effects.js';
import { chooseAI } from '../ai/specialists.js';
import { sendAuthoritativeOnlineState } from '../online/snapshots.js';

// A small inspection surface for regression tests and browser diagnostics.
// Application modules import their dependencies directly and never read it.
export function installDiagnostics() {
  const api = Object.freeze({
    version: 'modular-runtime-1',
    get game() {
      return state_ui_battle_state.game;
    },
    get CARDS() {
      return state_catalog_cards.CARDS;
    },
    card,
    newGame,
    unitAt,
    legalActions,
    prepareCurrentTurn,
    execute,
    endTurn,
    chooseAI,
    registerScheduledAction,
    sendAuthoritativeOnlineState
  });
  Object.defineProperty(window, 'Megaleague', {
    value: api,
    configurable: false
  });
  Object.defineProperty(window, 'timeClockVisualSaturation', {
    value: timeClockVisualSaturation,
    configurable: false
  });
  Object.defineProperty(window, 'TimerManager', {
    value: TimerManager,
    configurable: false
  });
  for (const key of Reflect.ownKeys(systems)) {
    if (!(key in window)) Object.defineProperty(window, key, {
      get: () => systems[key],
      configurable: false
    });
  }
}

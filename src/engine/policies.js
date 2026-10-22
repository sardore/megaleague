import { legalActionsCore, unitAt } from './actions.js';
import { effectApplyCore } from './effects.js';
import { status } from './energy.js';
import { skillOf } from './entities.js';
import { skillRequirementsMet } from '../catalog/cards.js';
import { renderCore } from '../ui/setup.js';
import { systems } from '../runtime/systems.js';
import { state_ui_battle_state as battle } from '../ui/battle-state.js';
export const PASS = Symbol('unhandled-effect');

// Fixed policy slots: initialization supplies implementations, never adds a new
// runtime layer or replaces a public function. Ordering is defined here once.
const legalOrder = ['legal1', 'legal2', 'legal3', 'legal4', 'legal5', 'legal6', 'legal7', 'legal8', 'legal9', 'legal10'];
const renderOrder = ['render1', 'render2', 'render3', 'render4', 'render5', 'render6', 'render7', 'render8', 'render9', 'render10', 'render11', 'render12'];
const effectOrder = ['effect1', 'effect2', 'effect3', 'effect4', 'effect5', 'effect6', 'effect7', 'effect8', 'effect9'];
const afterOrder = ['after1', 'after2'];
export const policySlots = Object.seal(Object.fromEntries([...legalOrder, ...renderOrder, ...effectOrder, ...afterOrder].map(key => [key, null])));
function runPolicies(order, core, receiver, args) {
  const entered = [],
    left = new Set();
  let result, failure;
  try {
    for (let i = order.length - 1; i >= 0; i--) {
      const policy = policySlots[order[i]];
      if (policy?.enter) entered[i] = {
        token: policy.enter(...args)
      };
    }
    result = core.apply(receiver, args);
    for (let i = 0; i < order.length; i++) {
      const policy = policySlots[order[i]];
      if (entered[i] && policy.leave) {
        policy.leave(entered[i].token, ...args);
        left.add(i);
      }
      if (policy?.transform) result = policy.transform(result, ...args, entered[i]?.token);
    }
    return result;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    for (let i = 0; i < order.length; i++) {
      const policy = policySlots[order[i]];
      if (entered[i] && !left.has(i) && policy?.leave) {
        try {
          policy.leave(entered[i].token, ...args);
        } catch (error) {
          if (!failure) throw error;
          systems.__megaRecordRecoveredError(error, 'policy.cleanup');
        }
      }
    }
  }
}
export function applyLegalRules(g, t, s) {
  let actions = runPolicies(legalOrder, legalActionsCore, this, [g, t, s]);
  if (!Array.isArray(actions)) actions = [];
  const actor = unitAt(g, t, s);
  if (!actor) return actions;
  if (actor.dead) return actions.filter(a => a?.type === 'deploy');
  if (Number(actor.speedDelayTurns || 0) > 0) return actions.filter(a => a?.type === 'speedDelay');
  if (actor.scheduledAction) return actions.filter(a => a?.type === 'scheduled');
  return actions.filter(a => !(status(actor, 'freeze') && (a?.type === 'skill' || a?.type === 'switch')) && !(status(actor, 'skillSeal') && a?.type === 'skill') && !(status(actor, 'paralyze') && a?.type === 'gather') && (a?.type !== 'skill' || skillRequirementsMet(actor, skillOf(actor, a.skill))));
}
export function projectBattle(...args) {
  // Presentation transform signatures differ from legal-rule signatures.
  const entered = [],
    left = new Set();
  let result, failure;
  try {
    for (let i = renderOrder.length - 1; i >= 0; i--) {
      const p = policySlots[renderOrder[i]];
      if (p?.enter) entered[i] = {
        token: p.enter(...args)
      };
    }
    result = renderCore.apply(this, args);
    for (let i = 0; i < renderOrder.length; i++) {
      const p = policySlots[renderOrder[i]];
      if (entered[i] && p.leave) {
        p.leave(entered[i].token, ...args);
        left.add(i);
      }
      if (p?.transform) result = p.transform(result, entered[i]?.token, ...args);
    }
    return result;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    for (let i = 0; i < renderOrder.length; i++) {
      const p = policySlots[renderOrder[i]];
      if (entered[i] && !left.has(i) && p?.leave) {
        try {
          p.leave(entered[i].token, ...args);
        } catch (error) {
          if (!failure) throw error;
          systems.__megaRecordRecoveredError(error, 'presentation.cleanup');
        }
      }
    }
  }
}
export function resolveEffect(...args) {
  const meta = {
    visualStart: Array.isArray(battle.visualEvents) ? battle.visualEvents.length : 0
  };
  let result = PASS;
  for (let i = effectOrder.length - 1; i >= 0; i--) {
    const handler = policySlots[effectOrder[i]];
    if (!handler) continue;
    result = handler(...args);
    if (result !== PASS) break;
  }
  if (result === PASS) result = effectApplyCore.apply(this, args);
  for (const key of afterOrder) policySlots[key]?.(result, meta, ...args);
  return result;
}
export function sealPolicies() {
  for (const [key, value] of Object.entries(policySlots)) if (!value) throw new Error(`Missing policy: ${key}`);
  Object.freeze(policySlots);
}

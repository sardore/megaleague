// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_runtime_state = {
  StateFactory: undefined,
  StateValidator: undefined
};
import { unitAt } from "../engine/actions.js";
import { teamOf } from "../engine/combat.js";
import { totalEnergy } from "../engine/energy.js";
import { card, cardHasCapability, newGame } from "../engine/entities.js";
import { state_online_commands } from "../online/commands.js";
import { state_runtime_config } from "./config.js";
import { state_runtime_entities } from "./entities.js";
export function initializeRuntimeState() {
  state_runtime_state.StateFactory = (() => {
    const active = g => {
      const [team, slot] = g?.order?.[g.turn] || [];
      const unit = team != null && typeof unitAt === "function" ? unitAt(g, team, slot) : null;
      return {
        team,
        slot,
        unit
      };
    };
    const decorate = (g, options = {}) => {
      if (!g || typeof g !== "object") return g;
      g.battleId ||= g.matchId || state_runtime_config.IdFactory.battle(g.seed || "battle");
      g.mode ||= options.mode || "human";
      g.phase ||= g.winner ? "BATTLE_ENDED" : "WAITING_FOR_ACTION";
      g.round = Math.max(1, Number(g.round) || 1);
      g.turnNumber = Math.max(0, Number(g.turnSerial) || 0);
      const cur = active(g);
      g.activeTeamId = cur.team || null;
      g.activeEntityId = cur.unit?.entityId || cur.unit?.uid || null;
      g.actionOwnerId = g.activeEntityId;
      // Input ownership is authoritative battle state, not a client-local viewing side.
      g.inputOwnerId = cur.team || null;
      g.battleStarted ??= !!(g.mode === "online" || g.bossRaid?.online);
      g.pendingAction ??= null;
      g.pendingTargetSelection ??= null;
      g.pendingPayment ??= null;
      g.pendingAnimation ??= null;
      g.pendingTransaction ??= null;
      g.decks ||= {
        P: [...(g.teams?.P?.field || []), ...(g.teams?.P?.bench || [])].map(u => u?.card).filter(Boolean),
        A: [...(g.teams?.A?.field || []), ...(g.teams?.A?.bench || [])].map(u => u?.card).filter(Boolean)
      };
      g.discard ||= {
        P: [],
        A: []
      };
      g.fields ||= {
        global: g.fieldEffect || null,
        team: {
          P: null,
          A: null
        }
      };
      g.globalEffects ||= [];
      g.bossState ||= g.bossRaid ? {
        active: true,
        type: g.bossRaid.type || "raid"
      } : null;
      g.networkRevision = Math.max(Number(g.networkRevision) || 0, Number(typeof state_online_commands.onlineAuthoritativeRevision !== "undefined" ? state_online_commands.onlineAuthoritativeRevision : 0) || 0);
      g.eventSequence = Math.max(0, Number(g.eventSequence) || 0);
      g.eventLog ||= [];
      g.ended = !!(g.ended || g.winner);
      state_runtime_entities.EntityRegistry.sync(g);
      return g;
    };
    const updateActive = g => {
      if (!g || typeof g !== "object") return g;
      decorate(g);
      const cur = active(g);
      g.activeTeamId = cur.team || null;
      g.activeEntityId = cur.unit?.entityId || cur.unit?.uid || null;
      g.actionOwnerId = g.activeEntityId;
      g.inputOwnerId = cur.team || null;
      g.turnNumber = Math.max(0, Number(g.turnSerial) || 0);
      if (g.winner) {
        g.ended = true;
        g.phase = "BATTLE_ENDED";
      }
      return g;
    };
    return Object.freeze({
      create: (p, a, opt) => decorate(newGame(p, a, opt), opt),
      decorate,
      updateActive
    });
  })();
  state_runtime_state.StateValidator = (() => {
    const validate = (g, options = {}) => {
      const issues = [];
      if (!g) return {
        ok: false,
        issues: [{
          code: "NO_STATE",
          message: "game state missing"
        }]
      };
      state_runtime_state.StateFactory.decorate(g);
      const entities = Object.values(g.entities || {}),
        ids = new Set(),
        slotIds = new Set(),
        occupied = new Set(),
        energyIds = new Set();
      for (const unit of entities) {
        const id = unit.entityId || unit.uid;
        if (ids.has(id)) issues.push({
          code: "DUP_ENTITY_ID",
          entityId: id
        });
        ids.add(id);
        if (Number(unit.shield || 0) < 0) issues.push({
          code: "NEGATIVE_SHIELD",
          entityId: id,
          value: unit.shield
        });
        if (Number(unit.hp || 0) > Number(unit.maxHp || 0) + Math.max(0, Number(unit.maxHpOverflowAllowance || 0))) issues.push({
          code: "HP_OVER_MAX",
          entityId: id,
          hp: unit.hp,
          maxHp: unit.maxHp
        });
        for (const e of state_runtime_entities.EnergyEngine.snapshot(unit)) {
          if (energyIds.has(e.energyId)) issues.push({
            code: "DUP_ENERGY_ID",
            energyId: e.energyId
          });
          energyIds.add(e.energyId);
        }
        const max = Number(card(unit)?.maxEnergy || state_runtime_config.GameConfig.maxEnergyDefault);
        if (typeof totalEnergy === "function" && !cardHasCapability(unit, "dualActor") && totalEnergy(unit) > max + .001) issues.push({
          code: "ENERGY_OVER_MAX",
          entityId: id,
          value: totalEnergy(unit),
          max
        });
      }
      for (const slot of Object.values(g.slots || {})) {
        if (slotIds.has(slot.slotId)) issues.push({
          code: "DUP_SLOT_ID",
          slotId: slot.slotId
        });
        slotIds.add(slot.slotId);
        if (slot.entityId && slot.zone !== "graveyard") {
          if (occupied.has(slot.entityId)) issues.push({
            code: "MULTI_SLOT_ENTITY",
            entityId: slot.entityId
          });
          occupied.add(slot.entityId);
        }
      }
      const active = g.activeEntityId ? state_runtime_entities.EntityRegistry.get(g, g.activeEntityId) : null;
      if (g.activeEntityId && !active) issues.push({
        code: "ACTIVE_ENTITY_MISSING",
        entityId: g.activeEntityId
      });
      if (active && g.activeTeamId && typeof teamOf === "function" && teamOf(g, active) !== g.activeTeamId) issues.push({
        code: "ACTIVE_TEAM_MISMATCH",
        entityId: g.activeEntityId,
        activeTeamId: g.activeTeamId
      });
      if (!g.winner && active?.dead && !g.teams?.[g.activeTeamId]?.bench?.some(unit => unit && !unit.dead)) issues.push({
        code: "DEAD_ACTIVE_WITHOUT_REPLACEMENT",
        entityId: g.activeEntityId,
        activeTeamId: g.activeTeamId,
        turn: g.turn,
        turnSerial: g.turnSerial
      });
      if (Number(g.actionPoints || 0) < 0) issues.push({
        code: "NEGATIVE_ACTION_POINTS",
        value: g.actionPoints
      });
      if (g.ended && !g.winner) issues.push({
        code: "ENDED_WITHOUT_WINNER"
      });
      if (g.winner && !g.ended) issues.push({
        code: "WINNER_NOT_ENDED"
      });
      if (g.pendingTransaction && g.pendingAction && g.pendingTransaction.action !== g.pendingAction && g.pendingTransaction.actionId !== g.pendingAction?.actionId) issues.push({
        code: "PENDING_TRANSACTION_MISMATCH"
      });
      if (Number(g.networkSequence || 0) < Number(g.lastAppliedNetworkSequence || 0)) issues.push({
        code: "NETWORK_SEQUENCE_REVERSED"
      });
      const duplicateEvents = new Set();
      for (const ev of g.eventLog || []) {
        if (duplicateEvents.has(ev.eventId)) issues.push({
          code: "DUP_EVENT",
          eventId: ev.eventId
        });
        duplicateEvents.add(ev.eventId);
      }
      const result = {
        ok: issues.length === 0,
        issues,
        battleId: g.battleId,
        checkedAt: state_runtime_config.now()
      };
      if (!result.ok) console.error("[R48 StateValidator]", result);
      if (!result.ok && options.throwOnError) throw new Error(`State invariant violation: ${issues.map(x => x.code).join(",")}`);
      return result;
    };
    return Object.freeze({
      validate,
      assert: g => validate(g, {
        throwOnError: true
      })
    });
  })();
}

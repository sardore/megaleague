// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_runtime_entities = {
  EnergyEngine: undefined,
  EntityRegistry: undefined,
  BattleEventEngine: undefined
};
import { findUnit } from "../engine/combat.js";
import { canPayAction, energyStore, gainEnergy, spendAction } from "../engine/energy.js";
import { cardHasCapability } from "../engine/entities.js";
import { state_runtime_config } from "./config.js";
export function initializeRuntimeEntities() {
  state_runtime_entities.EnergyEngine = (() => {
    const ensureEntry = (entry, entityId = "entity") => {
      if (!entry || typeof entry !== "object") return entry;
      entry.a = Math.max(0, Math.round((Number(entry.a) || 0) * 2) / 2);
      if (!["R", "W", "B"].includes(entry.c)) entry.c = "W";
      if (!entry.energyId) entry.energyId = state_runtime_config.IdFactory.energy(entityId);
      return entry;
    };
    const ensureStore = (unit, actor = null, explicitStore = null) => {
      const store = explicitStore || (typeof energyStore === "function" ? energyStore(unit, actor) : unit?.energy);
      if (!Array.isArray(store)) return [];
      const seen = new Set();
      for (const entry of store) {
        ensureEntry(entry, unit?.entityId || unit?.uid || "entity");
        if (seen.has(entry.energyId)) entry.energyId = state_runtime_config.IdFactory.energy(unit?.entityId || unit?.uid || "entity");
        seen.add(entry.energyId);
      }
      return store;
    };
    const snapshot = unit => {
      const groups = cardHasCapability(unit, "dualActor") ? [["beast", unit.beastEnergy], ["rider", unit.riderEnergy]] : [[null, unit?.energy]];
      return groups.flatMap(([actor, store]) => ensureStore(unit, actor, store).map((e, index) => ({
        energyId: e.energyId,
        color: e.c,
        amount: e.a,
        actor,
        index
      })));
    };
    const validatePayment = (unit, ids, actor = null) => {
      const store = ensureStore(unit, actor),
        unique = [...new Set(ids || [])];
      if (unique.length !== (ids || []).length) return {
        ok: false,
        reason: "duplicate-energy-id"
      };
      if (!unique.every(id => store.some(e => e.energyId === id))) return {
        ok: false,
        reason: "foreign-or-missing-energy"
      };
      return {
        ok: true,
        entries: unique.map(id => store.find(e => e.energyId === id))
      };
    };
    return Object.freeze({
      ensureEntry,
      ensureStore,
      snapshot,
      validatePayment,
      canPay: (g, t, u, cost, actor = null) => canPayAction(g, t, u, cost, actor),
      spend: (g, t, u, cost, prefer = [], actor = null) => spendAction(g, t, u, cost, prefer, actor),
      gain: (g, u, color, amount = 1, replace = null, actor = null, opt = {}) => gainEnergy(g, u, color, amount, replace, actor, opt)
    });
  })();
  state_runtime_entities.EntityRegistry = (() => {
    const zonesFor = (g, team) => {
      const tm = g?.teams?.[team] || {};
      return [["field", tm.field || []], ["bench", tm.bench || []], ["graveyard", tm.graveyard || []], ["summon", tm.summons || []]];
    };
    const sync = g => {
      if (!g?.teams) return {
        entities: {},
        slots: {}
      };
      const entities = {},
        slots = {};
      for (const team of ["P", "A"]) for (const [zone, list] of zonesFor(g, team)) {
        list.forEach((unit, index) => {
          if (!unit) return;
          unit.entityId ||= unit.uid || `legacy:${team}:${zone}:${index}`;
          unit.uid ||= unit.entityId;
          state_runtime_entities.EnergyEngine.ensureStore(unit);
          if (cardHasCapability(unit, "dualActor")) {
            state_runtime_entities.EnergyEngine.ensureStore(unit, "beast", unit.beastEnergy);
            state_runtime_entities.EnergyEngine.ensureStore(unit, "rider", unit.riderEnergy);
          }
          entities[unit.entityId] = unit;
          const slotId = state_runtime_config.IdFactory.slot(team, zone, zone === "summon" ? unit.entityId : index);
          slots[slotId] = {
            slotId,
            teamId: team,
            zone,
            index,
            entityId: unit.entityId
          };
        });
      }
      state_runtime_config.defineDerived(g, "entities", entities);
      state_runtime_config.defineDerived(g, "slots", slots);
      return {
        entities,
        slots
      };
    };
    const get = (g, id) => (g?.entities || sync(g).entities)?.[id] || (typeof findUnit === "function" ? findUnit(g, id) : null);
    const locate = (g, id) => Object.values(g?.slots || sync(g).slots).find(x => x.entityId === id) || null;
    return Object.freeze({
      sync,
      get,
      locate,
      list: g => Object.values(g?.entities || sync(g).entities)
    });
  })();
  state_runtime_entities.BattleEventEngine = (() => {
    const emit = (g, type, data = {}) => {
      if (!g) return null;
      g.eventSequence = Math.max(0, Number(g.eventSequence) || 0) + 1;
      g.eventLog ||= [];
      const event = {
        eventId: state_runtime_config.IdFactory.event(g.battleId || g.matchId || "battle", g.eventSequence),
        battleId: g.battleId || g.matchId || null,
        sequence: g.eventSequence,
        type,
        sourceEntityId: data.sourceEntityId || null,
        recipientEntityId: data.recipientEntityId || null,
        targetSlotId: data.targetSlotId || null,
        teamId: data.teamId || null,
        payload: data.payload || {},
        createdAt: state_runtime_config.now(),
        causedByEventId: data.causedByEventId || null
      };
      if (!g.appliedEventIds) state_runtime_config.defineDerived(g, "appliedEventIds", new Set());
      if (g.appliedEventIds.has(event.eventId)) return null;
      g.appliedEventIds.add(event.eventId);
      g.eventLog.push(event);
      if (g.eventLog.length > state_runtime_config.GameConfig.maxEventLog) g.eventLog.splice(0, g.eventLog.length - state_runtime_config.GameConfig.maxEventLog);
      state_runtime_config.EventBus.emit(event);
      return event;
    };
    return Object.freeze({
      emit
    });
  })();
}

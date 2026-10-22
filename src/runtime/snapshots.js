// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_runtime_snapshots = {
  OnlineSnapshotEngine: undefined,
  snapshotState: undefined,
  restoreState: undefined
};
import { traitsActive } from "../engine/combat.js";
import { energyStore } from "../engine/energy.js";
import { RNG } from "../engine/entities.js";
import { reactiveEnergyRule } from "../features/genocider.js";
import { log } from "../presentation/audio.js";
import { state_runtime_config } from "./config.js";
import { state_runtime_state } from "./state.js";
import { systems } from "./systems.js";
import { combatInt, state_ui_battle_state } from "../ui/battle-state.js";
import { state_ui_deck } from "../ui/deck.js";
export function initializeRuntimeSnapshots() {
  state_runtime_snapshots.OnlineSnapshotEngine = (() => {
    const VERSION = "mega-online-snapshot-restore-cp25";
    const SOURCES = new Set(["legacy-start", "legacy-state", "authoritative-state", "authoritative-start", "spectator", "sync-engine", "test"]);
    const RESTORE_STAGES = Object.freeze(["parseSnapshot", "restoreRng", "assignFreshBattleToken", "applyOnlineModeDefaults", "normalizeGenociderState", "canonicalizeEnergyState", "decorateBattleState", "normalizeNetworkRevision", "validateRestoredState"]);
    let restoreCount = 0;
    let lastRestore = null;
    const normalizeContext = context => {
      const source = SOURCES.has(context?.source) ? context.source : "test";
      const rules = context?.rules ?? state_ui_deck.p2p?.rules ?? state_ui_deck.ONLINE_COMMON_RULES;
      return Object.freeze({
        source,
        rules
      });
    };
    const parseSnapshot = rawSnapshot => JSON.parse(rawSnapshot);
    const restoreRng = g => {
      const rng = new RNG(g.seed);
      rng.s = g.rng?.s || rng.s;
      g.rng = rng;
      return g;
    };
    const assignFreshBattleToken = g => {
      g.token = ++state_ui_battle_state.battleToken;
      return g;
    };
    const applyOnlineModeDefaults = (g, context) => {
      g.mode = "online";
      g.variance = false;
      g.difficulty = "normal";
      const rules = context.rules;
      if (rules?.league) {
        g.league = state_ui_deck.LeagueFormatOwner.normalizeLeague(rules.league);
        const sourceCompositions = g.leagueCompositions || rules.compositions || g.leagueComposition || rules.composition || null;
        g.leagueCompositions = state_ui_deck.LeagueFormatOwner.normalizeTeamCompositions(g.league, sourceCompositions);
        g.leagueComposition = g.leagueCompositions.P;
        g.matchType = state_ui_deck.LeagueFormatOwner.definition(g.league).label;
      }
      return g;
    };
    const restoredUnits = g => {
      if (!g?.teams) return [];
      const seen = new Set(),
        units = [];
      for (const team of ["P", "A"]) for (const unit of [...(g.teams[team]?.field || []), ...(g.teams[team]?.bench || []), ...(g.teams[team]?.graveyard || [])]) if (unit && !seen.has(unit.uid)) {
        seen.add(unit.uid);
        units.push(unit);
      }
      return units;
    };
    const genociderBAmount = unit => {
      if (!unit || !reactiveEnergyRule(unit)) return 0;
      return +energyStore(unit).reduce((total, entry) => total + (entry.c === "B" ? Number(entry.a || 0) : 0), 0).toFixed(1);
    };
    const normalizeGenociderState = g => {
      const baseHp = 240;
      for (const unit of restoredUnits(g)) {
        if (!reactiveEnergyRule(unit)) continue;
        unit._genoObservedB = genociderBAmount(unit);
        const activeB = traitsActive(unit) ? genociderBAmount(unit) : 0;
        unit.maxHp = Math.max(baseHp, combatInt(baseHp + activeB * 60));
        if (unit.hp > unit.maxHp) {
          unit.hp = unit.maxHp;
          log(g, `${unit.name}: 최대 HP 변화로 현재 HP가 ${unit.hp}/${unit.maxHp}로 조정됐다.`);
        }
      }
      return g;
    };
    const canonicalizeEnergyState = g => {
      const engine = systems.EnergyCanonicalizationEngine;
      if (!engine || typeof engine.canonicalizeGameState !== "function") throw new Error("EnergyCanonicalizationEngine unavailable");
      engine.canonicalizeGameState(g);
      return g;
    };
    const decorateBattleState = g => state_runtime_state.StateFactory.decorate(g, {
      mode: "online"
    });
    const normalizeNetworkRevision = g => {
      g.networkRevision = Math.max(g.networkRevision || 0, Number(g.revision || 0));
      return g;
    };
    const validateRestoredState = g => g;
    const restoreState = (rawSnapshot, context) => {
      const normalized = normalizeContext(context);
      let g = parseSnapshot(rawSnapshot);
      g = restoreRng(g);
      g = assignFreshBattleToken(g);
      g = applyOnlineModeDefaults(g, normalized);
      g = normalizeGenociderState(g);
      g = canonicalizeEnergyState(g);
      g = decorateBattleState(g);
      g = normalizeNetworkRevision(g);
      g = validateRestoredState(g);
      restoreCount++;
      lastRestore = Object.freeze({
        source: normalized.source,
        battleId: g?.battleId || null,
        networkRevision: Number(g?.networkRevision || 0),
        stages: [...RESTORE_STAGES]
      });
      return g;
    };
    const debug = () => ({
      version: VERSION,
      restoreCount,
      lastRestore: lastRestore ? {
        ...lastRestore,
        stages: [...lastRestore.stages]
      } : null,
      stages: [...RESTORE_STAGES]
    });
    return Object.freeze({
      VERSION,
      restoreState,
      debug
    });
  })();
  Object.defineProperty(systems, "OnlineSnapshotEngine", {
    value: state_runtime_snapshots.OnlineSnapshotEngine,
    writable: false,
    configurable: false
  });
  state_runtime_snapshots.snapshotState = g => {
    const raw = JSON.stringify(g, (key, value) => key === "token" ? undefined : value);
    return {
      raw,
      rngState: g?.rng?.s,
      token: g?.token
    };
  };
  state_runtime_snapshots.restoreState = (g, snap) => {
    const data = JSON.parse(snap.raw);
    if (typeof RNG === "function") {
      const rng = new RNG(data.seed);
      rng.s = snap.rngState || data.rng?.s || rng.s;
      data.rng = rng;
    }
    for (const key of Object.keys(g)) delete g[key];
    for (const key of ["entities", "slots", "appliedEventIds"]) {
      try {
        delete g[key];
      } catch {}
    }
    Object.assign(g, data);
    if (snap.token != null) g.token = snap.token;
    state_runtime_state.StateFactory.decorate(g);
    state_runtime_config.defineDerived(g, "appliedEventIds", new Set((g.eventLog || []).map(event => event?.eventId).filter(Boolean)));
    return g;
  };
}

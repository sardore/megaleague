import { deferRaidResult } from "../features/boss-raid.js";
import { TimerManager } from "../runtime/timers.js";

// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_online_connection = {
  onlineVisualPacketSerial: undefined,
  onlineConnectionRouteRegistry: undefined,
  OnlineConnectionEngine: undefined
};
import { state_runtime_input } from "../runtime/input.js";
import { state_runtime_presentation } from "../runtime/presentation.js";
import { state_runtime_entities } from "../runtime/entities.js";
import { state_runtime_state } from "../runtime/state.js";
import { state_runtime_config } from "../runtime/config.js";
import { state_engine_entities } from "../engine/entities.js";
import { state_online_commands } from "./commands.js";
import { onlineCompositionNow, state_online_lobby } from "./lobby.js";
import { sendAuthoritativeOnlineState } from "./snapshots.js";
import { handleOnlineStartScopePacket, onlineStartIdentity, onlineStartPacketDigest, sendOnlineStartAck, traceOnlineStart } from "./start.js";
import { playVisuals } from "../presentation/animations.js";
import { systems } from "../runtime/systems.js";
import { clearLocalAutoTurnTimer, combatInt, state_ui_battle_state } from "../ui/battle-state.js";
import { pictogramHTML } from "../ui/cards.js";
import { setLeague, startBgm, stopBgm, syncLeagueSelectionSurface, state_ui_deck } from "../ui/deck.js";
import { syncGrandFieldBackground } from "../ui/payment.js";
import { pvpTeamStats, showPvpResult, showVictoryResult } from "../ui/results.js";
export function p2pSend(data) {
  let packet = data;
  if (typeof systems.NetworkEngine !== "undefined") {
    packet = systems.NetworkEngine.envelope(data);
    const g = typeof state_runtime_config.currentGame === "function" ? state_runtime_config.currentGame() : null;
    if (g) {
      g.networkSequence = packet.sequence;
      g.networkRevision = Math.max(g.networkRevision || 0, packet.revision || 0);
    }
  }
  try {
    if (!state_ui_deck.p2p.conn?.open) return false;
    return state_ui_deck.p2p.conn.send(packet) !== false;
  } catch (error) {
    systems.__megaRecordRecoveredError?.(error, "p2pSend");
    return false;
  }
}
export function serializeOnlineBattleProjection(g = state_ui_battle_state.game) {
  const eventTail = Array.isArray(g?.eventLog) ? g.eventLog.slice(-state_runtime_config.GameConfig.maxOnlineEventTail) : [];
  const logTail = Array.isArray(g?.logs) ? g.logs.slice(-state_runtime_config.GameConfig.maxOnlineLogTail) : [];
  return JSON.stringify(g, function (k, v) {
    if (k === "token") return undefined;
    if (this === g && k === "eventLog") return eventTail;
    if (this === g && k === "logs") return logTail;
    return v;
  });
}
export function serializeOnlineGame() {
  return serializeOnlineBattleProjection(state_ui_battle_state.game);
}
export function initializeOnlineConnection() {
  state_online_connection.onlineVisualPacketSerial = 0;
  state_online_connection.onlineConnectionRouteRegistry = new Map();
  state_online_connection.OnlineConnectionEngine = (() => {
    const EVENT_NAMES = Object.freeze(["open", "data", "close", "error"]);
    let bindings = new WeakMap();
    let activeBinding = null;
    const report = (error, label, record = null) => {
      if (record) record.errors.push({
        label,
        message: error?.message || String(error)
      });
      systems.__megaRecordRecoveredError?.(error, label);
    };
    const removeListener = (conn, event, handler) => {
      if (typeof conn?.off === "function") {
        conn.off(event, handler);
        return true;
      }
      if (typeof conn?.removeListener === "function") {
        conn.removeListener(event, handler);
        return true;
      }
      return false;
    };
    const runtimeGeneration = () => Number(systems.OnlineRuntime?.identity?.().generation || 0);
    const isCurrent = record => {
      if (!record || record.closed || record.detached || activeBinding !== record) return false;
      const current = runtimeGeneration();
      return !record.runtimeGeneration || !current || record.runtimeGeneration === current;
    };
    const invoke = (record, owner, handler, ...args) => {
      if (typeof handler !== "function") return false;
      try {
        record.routeCalls[owner] = (record.routeCalls[owner] || 0) + 1;
        record.routeTrace.push(`${record.currentPacketType || "context"}:${owner}`);
        if (record.routeTrace.length > 160) record.routeTrace.splice(0, record.routeTrace.length - 96);
        handler(...args);
        return true;
      } catch (error) {
        report(error, `OnlineConnectionEngine.route.${owner}`, record);
        return false;
      }
    };
    const detach = record => {
      if (!record || record.detached) return false;
      for (const event of EVENT_NAMES) {
        const fn = record.listeners[event];
        if (fn) removeListener(record.conn, event, fn);
      }
      record.detached = true;
      record.listenerCounts = {
        open: 0,
        data: 0,
        close: 0,
        error: 0
      };
      if (activeBinding === record) activeBinding = null;
      return true;
    };
    const dispatchOpen = record => {
      if (record?.closed || record?.detached) return false;
      if (record.phase === "handshake") return invoke(record, `${record.context?.owner || "handshake"}:open`, record.context?.onOpen, record);
      if (!isCurrent(record)) {
        record.staleEvents.open++;
        return false;
      }
      return invoke(record, `${record.context?.owner || "session"}:open`, record.context?.onOpen, record);
    };
    const dispatchData = (record, message) => {
      if (!record || record.closed || record.detached || !message || typeof message !== "object") return false;
      if (record.phase === "handshake") return invoke(record, `${record.context?.owner || "handshake"}:data`, record.context?.onData, message, record);
      if (!isCurrent(record)) {
        record.staleEvents.data++;
        return false;
      }
      const routes = [...(state_online_connection.onlineConnectionRouteRegistry.get(message.type) || []), ...(state_online_connection.onlineConnectionRouteRegistry.get("*") || [])];
      record.currentPacketType = String(message.type || "unknown");
      for (const entry of routes) if (entry.phases.has("session")) invoke(record, entry.owner, entry.handler, message, record);
      record.currentPacketType = "";
      return routes.length > 0;
    };
    const dispatchClose = record => {
      if (!record || record.closed) return false;
      const current = isCurrent(record);
      record.closed = true;
      record.closeEvents++;
      detach(record);
      if (!record.intentionalClosing && current) invoke(record, `${record.context?.owner || "session"}:close`, record.context?.onClose, record);else if (!current) record.staleEvents.close++;
      return true;
    };
    const dispatchError = (record, error) => {
      if (!record || record.closed || record.detached) return false;
      if (record.phase === "handshake") return invoke(record, `${record.context?.owner || "handshake"}:error`, record.context?.onError, error, record);
      if (!isCurrent(record) || record.intentionalClosing) {
        record.staleEvents.error++;
        return false;
      }
      return invoke(record, `${record.context?.owner || "session"}:error`, record.context?.onError, error, record);
    };
    const makeRecord = (conn, context = {}) => ({
      conn,
      phase: context.phase === "handshake" ? "handshake" : "session",
      context: {
        ...context
      },
      runtimeGeneration: runtimeGeneration(),
      listeners: {},
      listenerCounts: {
        open: 0,
        data: 0,
        close: 0,
        error: 0
      },
      detached: false,
      closed: false,
      intentionalClosing: false,
      physicalCloseCalls: 0,
      closeEvents: 0,
      staleEvents: {
        open: 0,
        data: 0,
        close: 0,
        error: 0
      },
      routeCalls: {},
      routeTrace: [],
      errors: [],
      currentPacketType: ""
    });
    function bind(conn, context = {}) {
      if (!conn || typeof conn.on !== "function") throw new TypeError("OnlineConnectionEngine.bind requires a DataConnection");
      let record = bindings.get(conn);
      if (record && !record.closed && !record.detached) {
        record.context = {
          ...record.context,
          ...context
        };
        if (context.phase) record.phase = context.phase;
        record.runtimeGeneration = runtimeGeneration() || record.runtimeGeneration;
        if (record.phase === "session") activeBinding = record;
        return debug(conn);
      }
      record = makeRecord(conn, context);
      bindings.set(conn, record);
      const listeners = {
        open: () => dispatchOpen(record),
        data: message => dispatchData(record, message),
        close: () => dispatchClose(record),
        error: error => dispatchError(record, error)
      };
      try {
        for (const event of EVENT_NAMES) {
          record.listeners[event] = listeners[event];
          conn.on(event, listeners[event]);
          record.listenerCounts[event] = 1;
        }
      } catch (error) {
        detach(record);
        record.errors.push({
          label: "bind",
          message: error?.message || String(error)
        });
        throw error;
      }
      if (record.phase === "session") {
        if (activeBinding && activeBinding !== record) detach(activeBinding);
        activeBinding = record;
      }
      if (conn.open) dispatchOpen(record);
      return debug(conn);
    }
    function promote(conn, context = {}) {
      const record = bindings.get(conn);
      if (!record || record.closed || record.detached) return bind(conn, {
        ...context,
        phase: "session"
      });
      if (activeBinding && activeBinding !== record) detach(activeBinding);
      record.phase = "session";
      record.context = {
        ...record.context,
        ...context,
        phase: "session"
      };
      record.runtimeGeneration = runtimeGeneration() || record.runtimeGeneration;
      activeBinding = record;
      if (conn.open) dispatchOpen(record);
      return debug(conn);
    }
    function resume(conn, context = {}) {
      const record = bindings.get(conn);
      if (!record || record.closed || record.detached) return false;
      record.context = {
        ...record.context,
        ...context,
        phase: "session"
      };
      record.phase = "session";
      record.runtimeGeneration = runtimeGeneration() || record.runtimeGeneration;
      activeBinding = record;
      return conn.open ? dispatchOpen(record) : true;
    }
    function closeConnection(conn, options = {}) {
      const record = bindings.get(conn);
      if (record) {
        record.intentionalClosing = options.intentional !== false;
        detach(record);
      }
      if (options.closePhysical !== false && typeof conn?.close === "function" && (!record || !record.physicalCloseCalls)) {
        if (record) record.physicalCloseCalls = 1;
        try {
          conn.close();
        } catch (error) {
          report(error, "OnlineConnectionEngine.closeConnection.physical", record);
        }
      }
      if (record) record.closed = true;
      return debug(conn);
    }
    function closeSession(options = {}) {
      const record = activeBinding;
      if (!record) return debug();
      record.intentionalClosing = true;
      detach(record);
      if (options.closeConnection === true) closeConnection(record.conn, {
        intentional: true,
        closePhysical: true
      });
      return debug(record.conn);
    }
    function debug(conn = null) {
      const record = conn ? bindings.get(conn) : activeBinding;
      const routes = [...state_online_connection.onlineConnectionRouteRegistry.entries()].flatMap(([type, list]) => list.map(entry => ({
        type,
        owner: entry.owner,
        order: entry.order
      })));
      if (!record) return {
        bound: false,
        owner: "OnlineRuntime.MessageRouter/application-route-adapter",
        listenerCounts: {
          open: 0,
          data: 0,
          close: 0,
          error: 0
        },
        phase: null,
        runtimeGeneration: runtimeGeneration(),
        intentionalClosing: false,
        closed: false,
        active: false,
        routeCalls: {},
        routeTrace: [],
        physicalCloseCalls: 0,
        staleEvents: {
          open: 0,
          data: 0,
          close: 0,
          error: 0
        },
        routes
      };
      return {
        bound: true,
        owner: "OnlineRuntime.MessageRouter/application-route-adapter",
        listenerCounts: {
          ...record.listenerCounts
        },
        phase: record.phase,
        runtimeGeneration: record.runtimeGeneration,
        intentionalClosing: record.intentionalClosing,
        closed: record.closed,
        active: isCurrent(record),
        routeCalls: {
          ...record.routeCalls
        },
        routeTrace: [...record.routeTrace],
        physicalCloseCalls: record.physicalCloseCalls,
        closeEvents: record.closeEvents,
        staleEvents: {
          ...record.staleEvents
        },
        errors: [...record.errors],
        routes
      };
    }
    const reset = () => {
      if (activeBinding) detach(activeBinding);
      activeBinding = null;
      bindings = new WeakMap();
    };
    return Object.freeze({
      bind,
      promote,
      resume,
      closeConnection,
      closeSession,
      debug,
      reset
    });
  })();
  registerOnlineConnectionRoute("rules", "online-rules", handleOnlineRulesPacket, 10);
  registerOnlineConnectionRoute("start", "start-transaction", handleAuthoritativeOnlineStartPacket, 10);
}
export function cloneOnlineVisualEvents(events = []) {
  try {
    const safe = JSON.parse(JSON.stringify(Array.isArray(events) ? events : []));
    return safe.filter(v => v && typeof v === "object");
  } catch (_) {
    return [];
  }
}
export function broadcastOnlineState(visuals = []) {
  const ack = state_ui_deck.p2p?.__pendingAuthoritativeAck || null;
  if (state_ui_deck.p2p) state_ui_deck.p2p.__pendingAuthoritativeAck = null;
  return sendAuthoritativeOnlineState(visuals, ack, false);
}
export function onlineRulesPayload(league = state_ui_deck.leagueSelection, composition = state_ui_deck.comprehensiveComposition, compositions = null) {
  const normalizedLeague = state_ui_deck.LeagueFormatOwner.normalizeLeague(league);
  const payload = {
    league: normalizedLeague,
    composition: normalizedLeague === "comprehensive" ? state_ui_deck.LeagueFormatOwner.normalizeComposition(composition) : null,
    variance: false,
    difficulty: "normal"
  };
  if (normalizedLeague === "comprehensive" && compositions && state_ui_deck.LeagueFormatOwner.comprehensivePatterns[compositions.P] && state_ui_deck.LeagueFormatOwner.comprehensivePatterns[compositions.A]) {
    payload.compositions = state_ui_deck.LeagueFormatOwner.normalizeTeamCompositions(normalizedLeague, compositions);
  }
  return payload;
}
export function lockOnlineSettings(locked, rules = null, localComposition = null) {
  const variance = state_ui_battle_state.$("#variance"),
    difficulty = state_ui_battle_state.$("#difficulty"),
    leagueMode = state_ui_battle_state.$("#leagueMode");
  if (variance) {
    variance.checked = false;
    variance.disabled = !!locked;
  }
  if (difficulty) {
    difficulty.value = "normal";
    difficulty.disabled = !!locked;
  }
  if (leagueMode) leagueMode.disabled = !!locked;
  state_ui_battle_state.$$(".leagueTab,.composition-choice").forEach(button => button.disabled = !!locked);
  const nextLeague = rules?.league ? state_ui_deck.LeagueFormatOwner.normalizeLeague(rules.league) : null,
    nextComposition = nextLeague === "comprehensive" ? state_ui_deck.LeagueFormatOwner.normalizeComposition(localComposition || state_ui_deck.p2p?.localComposition || rules?.composition || state_ui_deck.comprehensiveComposition) : state_ui_deck.comprehensiveComposition,
    compositionChanged = nextLeague === "comprehensive" && nextComposition !== state_ui_deck.comprehensiveComposition;
  if (nextLeague === "comprehensive") {
    state_ui_deck.comprehensiveComposition = nextComposition;
    if (state_ui_deck.p2p) state_ui_deck.p2p.localComposition = nextComposition;
  }
  if (nextLeague && (nextLeague !== state_ui_deck.leagueSelection || compositionChanged)) setLeague(nextLeague, true);else syncLeagueSelectionSurface();
}
export function applySharedOnlineRules(rules) {
  const league = state_ui_deck.LeagueFormatOwner.normalizeLeague(rules?.league || state_ui_deck.p2p?.rules?.league || state_ui_deck.leagueSelection);
  let localComposition = null,
    remoteComposition = null,
    publishedComposition = null,
    teamCompositions = null;
  if (league === "comprehensive") {
    const incoming = rules?.compositions && typeof rules.compositions === "object" ? rules.compositions : null;
    const valid = value => state_ui_deck.LeagueFormatOwner.comprehensivePatterns[String(value || "").trim()] ? String(value).trim() : null;
    const localTeam = state_ui_deck.p2p?.role === "guest" ? "A" : "P",
      remoteTeam = localTeam === "P" ? "A" : "P";
    publishedComposition = valid(rules?.composition) || valid(incoming?.P) || valid(state_ui_deck.p2p?.rules?.composition) || valid(state_ui_deck.p2p?.localComposition) || state_ui_deck.comprehensiveComposition;
    localComposition = valid(incoming?.[localTeam]) || valid(state_ui_deck.p2p?.localComposition) || state_ui_deck.comprehensiveComposition;
    remoteComposition = valid(incoming?.[remoteTeam]) || (state_ui_deck.p2p?.role === "guest" ? publishedComposition : valid(state_ui_deck.p2p?.remoteComposition));
    if (incoming && valid(incoming.P) && valid(incoming.A)) teamCompositions = {
      P: valid(incoming.P),
      A: valid(incoming.A)
    };
  }
  const normalized = onlineRulesPayload(league, publishedComposition || state_ui_deck.comprehensiveComposition, teamCompositions);
  state_ui_deck.p2p.rules = normalized;
  state_ui_deck.p2p.localComposition = localComposition;
  state_ui_deck.p2p.remoteComposition = remoteComposition;
  if (normalized.league === "comprehensive") state_ui_deck.comprehensiveComposition = localComposition;
  lockOnlineSettings(true, normalized, localComposition);
  return normalized;
}
export function registerOnlineConnectionRoute(type, owner, handler, order = 50, phases = ["session"]) {
  if (typeof type !== "string" || !type || typeof owner !== "string" || !owner || typeof handler !== "function") throw new TypeError("invalid online connection route");
  const list = state_online_connection.onlineConnectionRouteRegistry.get(type) || [];
  const existing = list.find(entry => entry.owner === owner);
  if (existing) {
    existing.handler = handler;
    existing.order = Number(order) || 0;
    existing.phases = new Set(phases);
  } else list.push({
    owner,
    handler,
    order: Number(order) || 0,
    phases: new Set(phases)
  });
  list.sort((a, b) => a.order - b.order || a.owner.localeCompare(b.owner));
  state_online_connection.onlineConnectionRouteRegistry.set(type, list);
  return true;
}

// Application packet adapter only. Session identity, generation, binding promotion,
// reconnect and cleanup are owned exclusively by OnlineRuntime/TransportAdapter.
export function handleOnlineRulesPacket(msg) {
  if (state_ui_deck.p2p?.role !== "guest" || state_ui_deck.p2p?.sessionMode === "bossRaid" || msg?.mode !== "PVP") return false;
  const incoming = String(msg?.matchId || ""),
    local = String(state_ui_deck.p2p?.matchId || "");
  if (!incoming || !local || incoming !== local) return false;
  const rules = applySharedOnlineRules(msg.rules);
  state_online_lobby.LobbyEngine.sendState("rules-authoritative-applied");
  updateP2PStatus(`공용 규칙 동기화 · ${state_ui_deck.LeagueFormatOwner.definition(rules.league).label}${rules.league === "comprehensive" ? ` · ${state_ui_deck.LeagueFormatOwner.pattern("comprehensive", onlineCompositionNow()).label}` : ""} · 피해 난수 OFF`);
  return true;
}
export function handleAuthoritativeOnlineStartPacket(msg) {
  if (msg?.type !== "start" || msg?.protocol !== "mega-online-start-r1") return false;
  if (state_ui_deck.p2p?.role !== "guest") {
    traceOnlineStart("START_ADMISSION_DROP", msg, {
      reason: "NON_GUEST_RECEIVER",
      role: state_ui_deck.p2p?.role || null
    });
    return false;
  }
  const incomingMatch = String(msg.matchId || ""),
    localMatch = String(state_ui_deck.p2p?.matchId || "");
  if (!incomingMatch || !localMatch || incomingMatch !== localMatch) {
    traceOnlineStart("START_ADMISSION_DROP", msg, {
      reason: "MATCH_ID_MISMATCH",
      incomingMatch,
      localMatch
    });
    return false;
  }
  const expectedMode = state_ui_deck.p2p?.sessionMode === "bossRaid" ? "BOSS_COOP" : "PVP",
    incomingMode = String(msg.mode || "");
  if (incomingMode !== expectedMode) {
    traceOnlineStart("START_ADMISSION_DROP", msg, {
      reason: "MODE_MISMATCH",
      incomingMode,
      expectedMode
    });
    return false;
  }
  const computedDigest = onlineStartPacketDigest(msg);
  if (msg.packetDigest && String(msg.packetDigest) !== computedDigest) {
    traceOnlineStart("START_ADMISSION_DROP", msg, {
      reason: "PACKET_DIGEST_MISMATCH",
      computedDigest
    });
    return false;
  }
  const identity = onlineStartIdentity({
    ...msg,
    packetDigest: msg.packetDigest || computedDigest
  });
  if (state_ui_deck.p2p?.battleStarted && state_ui_deck.p2p?.lastAppliedStartIdentity === identity) {
    traceOnlineStart("START_DUPLICATE_ACK", msg, {
      identity
    });
    sendOnlineStartAck(msg, "duplicate-start-idempotent");
    return true;
  }
  traceOnlineStart("START_ADMISSION_ACCEPT", msg, {
    identity,
    mode: msg.mode || "PVP"
  });
  state_ui_deck.p2p.guestStartAwaitingHostCommit = {
    identity,
    matchId: incomingMatch,
    battleId: String(msg.battleId || ""),
    at: Date.now()
  };
  if (msg.mode === "BOSS_COOP") {
    const g = systems.__redTimeoraBossRaid.revive(msg.state);
    state_ui_deck.p2p.battleStarted = true;
    state_ui_deck.p2p.matchId = msg.matchId || state_ui_deck.p2p.matchId || g?.matchId;
    state_ui_deck.p2p.lastAppliedStartIdentity = identity;
    state_ui_deck.p2p.__bossStartReceivedMatchId = String(state_ui_deck.p2p.matchId || g?.matchId || "");
    state_online_commands.OnlineActionAdmissionOwner.clearPending({
      unlock: false,
      resolution: "authoritative-start"
    });
    handleOnlineStartScopePacket(msg);
    document.getElementById("modal")?.classList.remove("open", "boss-lobby-closing");
    systems.__redTimeoraBossRaid.launch(g);
    systems.OnlineRuntime?.restore?.authoritativeApplied?.({
      phase: "IN_BATTLE",
      revision: Number(g?.networkRevision || g?.turnSerial || 0),
      kind: "authoritativeStart"
    });
    return true;
  }
  if (msg.rules) applySharedOnlineRules(msg.rules);
  state_ui_battle_state.game = systems.OnlineSnapshotEngine.restoreState(msg.state, {
    source: "authoritative-start",
    rules: state_ui_deck.p2p.rules || msg.rules || state_ui_deck.ONLINE_COMMON_RULES
  });
  state_ui_deck.onlineSide = state_ui_deck.p2p.role === "host" ? "P" : "A";
  state_ui_battle_state.busy = false;
  state_ui_battle_state.pendingSkill = null;
  state_ui_battle_state.lastLog = 0;
  state_ui_battle_state.visualEvents = [];
  state_ui_deck.p2p.battleStarted = true;
  state_ui_deck.p2p.matchId = msg.matchId || state_ui_deck.p2p.matchId || state_ui_battle_state.game?.matchId;
  state_ui_deck.p2p.lastAppliedStartIdentity = identity;
  const projected = systems.OnlineRuntime?.markBattleStarted?.({
    source: "authoritative-start-packet",
    canonicalRevision: Number(state_ui_battle_state.game?.networkRevision || 0)
  });
  traceOnlineStart("START_CANONICAL_APPLIED", msg, {
    identity,
    phaseAfter: systems.OnlineRuntime?.identity?.().phase || null,
    projected: projected !== false,
    battleExists: !!state_ui_battle_state.game
  });
  const replay = cloneOnlineVisualEvents(msg.visuals || []);
  if (replay.length) systems.OnlineRuntime?.sessionScope?.requestAnimationFrame?.(() => {
    if (state_ui_battle_state.game?.mode === "online") {
      state_ui_battle_state.visualEvents = replay;
      playVisuals();
    }
  }, "authoritative-start-visuals", {
    phase: "IN_BATTLE"
  });
  handleOnlineStartScopePacket(msg);
  systems.OnlineRuntime?.restore?.authoritativeApplied?.({
    phase: "IN_BATTLE",
    revision: Number(state_ui_battle_state.game?.networkRevision || 0),
    kind: "authoritativeStart"
  });
  startBgm();
  return projected !== false;
}
export function updateP2PStatus(text) {
  if (systems.OnlineRuntime?.ui?.acceptLegacyStatus) return systems.OnlineRuntime.ui.acceptLegacyStatus(text);
  let el = state_ui_battle_state.$("#p2pStatus");
  if (el) el.textContent = text;
}
export async function copyPlainText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    systems.__megaRecordRecoveredError(error, "inline-1:L8673");
  }
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.left = "-9999px";
    box.style.top = "0";
    document.body.appendChild(box);
    box.focus();
    box.select();
    box.setSelectionRange(0, box.value.length);
    const ok = document.execCommand("copy");
    box.remove();
    return !!ok;
  } catch (_) {
    return false;
  }
}
export function showEndCore() {
  if (systems.__megaSpectatorR18?.interceptShowEnd?.()) return;
  if (state_ui_battle_state.game?.mode !== "online" && !state_ui_battle_state.game?.bossRaid?.online) state_ui_battle_state.busy = false;
  stopBgm();
  syncGrandFieldBackground(null);
  const local = state_ui_battle_state.game.mode === "online" ? state_ui_deck.onlineSide : "P";
  const won = state_ui_battle_state.game.winner === local;
  state_ui_battle_state.$("#actionHint").textContent = won ? "승리했습니다." : "패배했습니다.";
  if (state_ui_battle_state.game.mode === "online" && !state_ui_deck.shownPvpResults.has(state_ui_battle_state.game)) {
    state_ui_deck.shownPvpResults.add(state_ui_battle_state.game);
    showPvpResult();
  } else if (state_ui_battle_state.game.mode !== "online" && !state_ui_deck.shownEndResults.has(state_ui_battle_state.game)) {
    state_ui_deck.shownEndResults.add(state_ui_battle_state.game);
    showVictoryResult();
  }
}
export function showEnd(...args) {
  if (deferRaidResult()) return;
  if (typeof state_runtime_state.StateFactory === "undefined" || typeof state_runtime_entities.BattleEventEngine === "undefined") return showEndCore();
  const g = typeof state_runtime_config.currentGame === "function" ? state_runtime_config.currentGame() : null;
  const onlineBattle = g?.mode === "online" || g?.bossRaid?.online;
  if (!onlineBattle) {
    clearLocalAutoTurnTimer("battle-end");
    state_ui_battle_state.localBackgroundAutoTurnOwner = null;
    state_ui_battle_state.localBattleBackgrounded = false;
    if (g) {
      g.ended = true;
      g.phase = "BATTLE_ENDED";
      state_runtime_state.StateFactory.updateActive(g);
      const terminalEventPublished = Array.isArray(g.eventLog) && g.eventLog.some(event => event?.type === "BATTLE_ENDED");
      if (!terminalEventPublished) state_runtime_entities.BattleEventEngine.emit(g, "BATTLE_ENDED", {
        teamId: g.winner,
        payload: {
          winner: g.winner
        }
      });
    }
  }
  const result = showEndCore();
  if (!onlineBattle) {
    if (typeof state_runtime_presentation.AnimationEngine !== "undefined") state_runtime_presentation.AnimationEngine.clearViewportFx();
    if (g?.battleId) {
      TimerManager.clearScope(g.battleId);
      state_runtime_input.InputLockManager.releaseBattle(g.battleId);
    }
  }
  return result;
}
export function mvpContribution(u, g = null) {
  if (!u) return -Infinity;
  const value = key => g && systems.GenericBattleStatisticsOwner ? systems.GenericBattleStatisticsOwner.projectedMetric(g, u, key) : Math.max(0, Number(u[key]) || 0);
  return value("damageDealt") + value("healingDealt") * 0.8 + value("damageTaken") * 0.08 + value("healingTaken") * 0.05 + (u.dead ? 0 : 20);
}
export function battleMvp(g, team = g.winner) {
  const stats = pvpTeamStats(g, team);
  return stats.units.slice().sort((a, b) => mvpContribution(b, g) - mvpContribution(a, g))[0] || null;
}
export function mvpResultHTML(g, localTeam = "P") {
  const team = g.winner;
  const u = battleMvp(g, team);
  if (!u) return "";
  const side = team === localTeam ? "내 진영" : "상대 진영";
  return `<div class="mvp-card">
          ${pictogramHTML("small", u.card)}
          <div><div class="mvp-label">BATTLE MVP · ${side}</div>
          <div class="mvp-name">${u.name}</div>
          <div class="mvp-detail">가한 피해 ${combatInt(state_engine_entities.GenericBattleStatisticsOwner.projectedMetric(g, u, "damageDealt"))} · 가한 회복 ${combatInt(state_engine_entities.GenericBattleStatisticsOwner.projectedMetric(g, u, "healingDealt"))} · 받은 피해 ${combatInt(state_engine_entities.GenericBattleStatisticsOwner.projectedMetric(g, u, "damageTaken"))} · 받은 회복 ${combatInt(state_engine_entities.GenericBattleStatisticsOwner.projectedMetric(g, u, "healingTaken"))} · 기술 ${u.skillUses || 0}회</div></div>
        </div>`;
}

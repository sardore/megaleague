import { TimerManager } from "../runtime/timers.js";
import { aliveUnits } from "../engine/energy.js";
import { state_features_genocider } from "./genocider.js";
import { state_online_commands } from "../online/commands.js";
import { cloneOnlineVisualEvents, onlineRulesPayload, serializeOnlineGame } from "../online/connection.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { startBgm, state_ui_deck } from "../ui/deck.js";
import { render } from "../ui/payment.js";
import { state_ui_results } from "../ui/results.js";
export function initializeFeaturesSpectators() {
  SPEC_VERSION = "mega-spectator-r20";
  SPEC_COMPAT = "mega-spectator-state-r20";
  spectatorState = {
    transports: new Map(),
    transportLoads: new Map(),
    matches: new Map(),
    watchers: new Map(),
    watching: null,
    mode: "idle",
    browseTimer: null,
    announceTimer: null,
    snapshotTimer: null,
    requestTimer: null,
    lastHostSignature: "",
    lastVisualPacketId: null,
    pendingVisuals: [],
    lobbyOpenedAt: 0,
    status: "",
    bossOnly: false,
    returnTarget: "online",
    viewSide: "P",
    chatSeen: new Set()
  };
  spectatorId = (() => {
    try {
      let id = sessionStorage.getItem("mega-spectator-id");
      if (!id) {
        const bytes = new Uint32Array(4);
        crypto.getRandomValues(bytes);
        id = "viewer-" + [...bytes].map(x => x.toString(36)).join("");
        sessionStorage.setItem("mega-spectator-id", id);
      }
      return id;
    } catch {
      return `viewer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
  })();
  systems.__megaSpectatorR18 = {
    interceptShowEnd() {
      if (spectatorState.watching && state_ui_battle_state.game?.mode === "spectator") {
        specDecorateBattle();
        return true;
      }
      return false;
    },
    beforeAuthoritativeState(visuals = []) {
      if (specIsHostMatch() && Array.isArray(visuals) && visuals.length) spectatorState.pendingVisuals.push(...cloneOnlineVisualEvents(visuals));
    },
    afterAuthoritativeState() {
      if (specIsHostMatch()) TimerManager.setTimeout(() => specBroadcastSnapshot(true), 0);
    },
    version: SPEC_VERSION,
    compat: SPEC_COMPAT,
    open: specOpenLobby,
    openLobby: specOpenLobby,
    openBoss: () => specOpenLobby({
      bossOnly: true,
      returnTarget: "boss"
    }),
    watchMatch: (matchId = null) => {
      const record = matchId ? spectatorState.matches.get(String(matchId)) : specCurrentMatchRecords()[0];
      if (!record) return false;
      specBeginWatching(record);
      return true;
    },
    leave: specLeaveWatching,
    state: spectatorState,
    startHost: specStartHostBroadcast,
    stopHost: specStopHostBroadcast,
    closeSession: specCloseSession,
    debug: specDebug,
    broadcastSnapshot: specBroadcastSnapshot,
    broadcastAnnounce: specBroadcastAnnounce,
    isWatching: () => !!spectatorState.watching,
    canExecute: () => !(spectatorState.watching && state_ui_battle_state.game?.mode === "spectator"),
    canHostChat: () => !!(specIsHostMatch() && specWatcherCount() > 0),
    sendChat: specSendChat,
    hostSendChat: specHostSendChat,
    hostBroadcastChat: specHostBroadcastChat,
    toggleView: specToggleView,
    queueVisuals(events = []) {
      if (!Array.isArray(events) || !events.length) return;
      const packet = cloneOnlineVisualEvents(events);
      const signature = `${state_ui_battle_state.game?.turnSerial || 0}:${JSON.stringify(packet)}`;
      if (signature === spectatorState.lastBossVisualSignature) return;
      spectatorState.lastBossVisualSignature = signature;
      spectatorState.pendingVisuals.push(...packet);
    }
  };
}
let SPEC_VERSION;
let SPEC_COMPAT;
let spectatorState;
let spectatorId;
function specNow() {
  return Date.now();
}
function specMatchId() {
  return String(state_ui_battle_state.game?.bossRaid ? state_ui_battle_state.game?.matchId || "" : state_ui_deck.p2p?.matchId || state_ui_battle_state.game?.matchId || "");
}
export function specIsHostMatch() {
  const normalOnline = !!(state_ui_battle_state.game && state_ui_battle_state.game.mode === "online" && state_ui_deck.p2p?.connected && state_ui_deck.p2p?.role === "host" && specMatchId());
  const bossOnline = !!(state_ui_battle_state.game?.bossRaid?.online && state_ui_deck.p2p?.connected && state_ui_deck.p2p?.role === "host" && specMatchId());
  const bossSolo = !!(state_ui_battle_state.game?.bossRaid && !state_ui_battle_state.game.bossRaid.online && state_ui_battle_state.game.mode === "bossSolo" && specMatchId());
  return normalOnline || bossOnline || bossSolo;
}
function specSafeSend(action, data, target = null) {
  try {
    const sent = action?.send?.(data, target ? {
      target
    } : undefined);
    if (sent?.catch) {
      sent.catch(() => {});
      return true;
    }
    return sent === true;
  } catch {
    return false;
  }
}
async function specEnsureHub() {
  if (spectatorState.transports.has("Relay")) return true;
  const transport = await systems.OnlineRuntime?.spectator?.ensureHub?.();
  if (!transport) return false;
  transport.announce.onMessage = (data, {
    peerId
  } = {}) => specOnAnnounce(transport, data, peerId);
  transport.request.onMessage = (data, {
    peerId
  } = {}) => specOnRequest(transport, data, peerId);
  transport.snapshot.onMessage = (data, {
    peerId
  } = {}) => specOnSnapshot(transport, data, peerId);
  transport.leave.onMessage = (data, {
    peerId
  } = {}) => specOnLeave(transport, data, peerId);
  transport.chat.onMessage = (data, {
    peerId
  } = {}) => specOnChat(transport, data, peerId);
  spectatorState.transports.set("Relay", transport);
  return true;
}
function specCloseHub() {
  for (const transport of spectatorState.transports.values()) {
    try {
      transport.room?.leave?.();
    } catch (error) {
      systems.__megaRecordRecoveredError(error, "spectatorFeatureR18:L123");
    }
  }
  spectatorState.transports.clear();
  spectatorState.transportLoads.clear();
}
function specAliveCount(team) {
  try {
    return aliveUnits(team).length;
  } catch {
    return [...(team?.field || []), ...(team?.bench || [])].filter(u => u && !u.dead).length;
  }
}
function specWatcherCount() {
  return new Set([...spectatorState.watchers.values()].map(w => w.spectatorId || `${w.transport}:${w.peerId}`)).size;
}
function specChatApi() {
  return systems.__megaOnlineBattleChat || null;
}
function specViewerLabel(id) {
  const suffix = String(id || "").replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase();
  return suffix ? `관전자 ${suffix}` : "관전자";
}
function specBroadcastChatPacket(packet) {
  if (!specIsHostMatch() || !packet) return false;
  let sent = false;
  for (const watcher of spectatorState.watchers.values()) {
    const transport = spectatorState.transports.get(watcher.transport);
    if (transport) sent = specSafeSend(transport.chat, packet, watcher.peerId) || sent;
  }
  return sent;
}
function specHostBroadcastChat(message = {}) {
  if (!specIsHostMatch()) return false;
  const text = String(message.text || "").trim().slice(0, 120);
  if (!text) return false;
  const id = String(message.id || `${specMatchId()}:player-chat:${specNow()}:${Math.random().toString(36).slice(2)}`);
  if (spectatorState.chatSeen.has(id)) return false;
  spectatorState.chatSeen.add(id);
  return specBroadcastChatPacket({
    protocol: SPEC_VERSION,
    compat: SPEC_COMPAT,
    type: "chat",
    matchId: specMatchId(),
    id,
    text,
    sentAt: Number(message.sentAt || specNow()),
    senderId: String(message.senderId || "player-host"),
    senderLabel: String(message.senderLabel || "플레이어").slice(0, 24),
    origin: "player"
  });
}
function specHostSendChat(text) {
  if (!specIsHostMatch()) return false;
  const value = String(text || "").trim().slice(0, 120);
  if (!value) return false;
  const id = `${specMatchId()}:host-chat:${specNow()}:${Math.random().toString(36).slice(2)}`;
  const label = state_ui_battle_state.game?.bossRaid ? "레이드 호스트" : "플레이어 1";
  spectatorState.chatSeen.add(id);
  specChatApi()?.push?.({
    id,
    text: value,
    sentAt: specNow(),
    mine: true,
    sender: "나"
  }, {
    popup: true
  });
  specBroadcastChatPacket({
    protocol: SPEC_VERSION,
    compat: SPEC_COMPAT,
    type: "chat",
    matchId: specMatchId(),
    id,
    text: value,
    sentAt: specNow(),
    senderId: "player-host",
    senderLabel: label,
    origin: "player"
  });
  return true;
}
function specSendChat(text) {
  const w = spectatorState.watching;
  const value = String(text || "").trim().slice(0, 120);
  if (!w || !value) return false;
  const rec = spectatorState.matches.get(w.matchId) || w.record;
  if (!w.sourceOrder?.length) w.sourceOrder = Object.entries(rec?.sources || {});
  if (!w.sourceOrder.length) return false;
  const [transportName, peerId] = w.sourceOrder[Math.min(w.sourceIndex || 0, w.sourceOrder.length - 1)];
  const transport = spectatorState.transports.get(transportName);
  if (!transport) return false;
  const id = `${w.matchId}:spectator-chat:${specNow()}:${Math.random().toString(36).slice(2)}`;
  spectatorState.chatSeen.add(id);
  specChatApi()?.push?.({
    id,
    text: value,
    sentAt: specNow(),
    mine: true,
    sender: "나"
  }, {
    popup: true
  });
  return specSafeSend(transport.chat, {
    protocol: SPEC_VERSION,
    compat: SPEC_COMPAT,
    type: "chat",
    matchId: w.matchId,
    id,
    text: value,
    sentAt: specNow(),
    senderId: spectatorId,
    senderLabel: specViewerLabel(spectatorId),
    origin: "spectator"
  }, peerId);
}
function specOnChat(transport, data, peerId) {
  if (!data || data.protocol !== SPEC_VERSION || data.compat !== SPEC_COMPAT || data.type !== "chat") return;
  const matchId = String(data.matchId || ""),
    id = String(data.id || ""),
    text = String(data.text || "").trim().slice(0, 120);
  if (!matchId || !id || !text) return;
  if (specIsHostMatch() && matchId === specMatchId()) {
    if (spectatorState.chatSeen.has(id)) return;
    spectatorState.chatSeen.add(id);
    const key = specWatcherKey(transport, peerId),
      watcher = spectatorState.watchers.get(key);
    if (watcher) watcher.lastSeen = specNow();
    const senderId = String(data.senderId || watcher?.spectatorId || ""),
      senderLabel = specViewerLabel(senderId);
    specChatApi()?.push?.({
      id,
      text,
      sentAt: Number(data.sentAt || specNow()),
      mine: false,
      sender: senderLabel
    }, {
      popup: true
    });
    if (state_ui_deck.p2p?.connected && state_ui_deck.p2p?.role === "host") specChatApi()?.sendPacket?.({
      type: "spectatorChatRelay",
      matchId: specMatchId(),
      id,
      text,
      sentAt: Number(data.sentAt || specNow()),
      senderLabel
    });
    specBroadcastChatPacket({
      protocol: SPEC_VERSION,
      compat: SPEC_COMPAT,
      type: "chat",
      matchId,
      id,
      text,
      sentAt: Number(data.sentAt || specNow()),
      senderId,
      senderLabel,
      origin: "spectator"
    });
    return;
  }
  const w = spectatorState.watching;
  if (!w || matchId !== w.matchId || spectatorState.chatSeen.has(id)) return;
  const rec = spectatorState.matches.get(w.matchId) || w.record;
  if (rec?.sources?.[transport.name] && rec.sources[transport.name] !== peerId) return;
  spectatorState.chatSeen.add(id);
  specChatApi()?.push?.({
    id,
    text,
    sentAt: Number(data.sentAt || specNow()),
    mine: false,
    sender: String(data.senderLabel || "플레이어").slice(0, 24)
  }, {
    popup: true
  });
}
function specAnnouncePayload() {
  if (!specIsHostMatch()) return null;
  const matchId = specMatchId();
  const pAlive = specAliveCount(state_ui_battle_state.game.teams?.P);
  const aAlive = specAliveCount(state_ui_battle_state.game.teams?.A);
  return {
    protocol: SPEC_VERSION,
    compat: SPEC_COMPAT,
    matchId,
    league: state_ui_deck.LeagueFormatOwner.normalizeLeague(state_ui_battle_state.game.league),
    leagueComposition: state_ui_battle_state.game.league === "comprehensive" ? state_ui_deck.LeagueFormatOwner.normalizeComposition(state_ui_battle_state.game.leagueComposition) : null,
    leagueCompositions: state_ui_battle_state.game.league === "comprehensive" ? state_ui_deck.LeagueFormatOwner.normalizeTeamCompositions(state_ui_battle_state.game.league, state_ui_battle_state.game.leagueCompositions || state_ui_battle_state.game.leagueComposition) : {
      P: null,
      A: null
    },
    matchType: state_ui_battle_state.game.matchType || state_ui_deck.LeagueFormatOwner.definition(state_ui_battle_state.game.league).label,
    bossRaid: !!state_ui_battle_state.game.bossRaid,
    bossId: state_ui_battle_state.game.bossRaid?.bossId || null,
    difficulty: state_ui_battle_state.game.bossRaid?.difficulty || null,
    turnSerial: Number(state_ui_battle_state.game.turnSerial || 0),
    turns: Number(state_ui_battle_state.game.stats?.turns || 0),
    pAlive,
    aAlive,
    spectators: specWatcherCount(),
    startedAt: Number(state_ui_battle_state.game.startedAt || state_ui_deck.p2p?.spectatorStartedAt || specNow()),
    updatedAt: specNow(),
    ended: !!state_ui_battle_state.game.winner,
    hostVersion: String(state_features_genocider.GENO_CLIENT_VERSION || "")
  };
}
function specBroadcastAnnounce() {
  const packet = specAnnouncePayload();
  if (!packet) return;
  for (const transport of spectatorState.transports.values()) specSafeSend(transport.announce, packet);
}
function specWatcherKey(transport, peerId) {
  return `${transport.name}:${peerId}`;
}
function specOnRequest(transport, data, peerId) {
  if (!specIsHostMatch() || !data || data.protocol !== SPEC_VERSION || data.compat !== SPEC_COMPAT) return;
  if (String(data.matchId || "") !== specMatchId() || !peerId) return;
  const key = specWatcherKey(transport, peerId);
  spectatorState.watchers.set(key, {
    transport: transport.name,
    peerId,
    lastSeen: specNow(),
    spectatorId: String(data.spectatorId || "")
  });
  specSendSnapshotTo(transport, peerId, true);
  specBroadcastAnnounce();
  specChatApi()?.sync?.();
}
function specOnLeave(transport, data, peerId) {
  if (!data || data.protocol !== SPEC_VERSION) return;
  spectatorState.watchers.delete(specWatcherKey(transport, peerId));
  specChatApi()?.sync?.();
}
function specSnapshotPayload(force = false) {
  if (!specIsHostMatch()) return null;
  let state;
  try {
    state = state_ui_battle_state.game?.bossRaid && typeof systems.__redTimeoraBossRaid?.serialize === "function" ? systems.__redTimeoraBossRaid.serialize(state_ui_battle_state.game) : serializeOnlineGame();
  } catch {
    return null;
  }
  let stateHash = 2166136261;
  for (let i = 0; i < state.length; i += Math.max(1, Math.floor(state.length / 3072))) {
    stateHash ^= state.charCodeAt(i);
    stateHash = Math.imul(stateHash, 16777619);
  }
  const signature = `${state_ui_battle_state.game.turnSerial || 0}:${state_ui_battle_state.game.turn || 0}:${state_ui_battle_state.game.winner || ""}:${state.length}:${stateHash >>> 0}`;
  if (!force && signature === spectatorState.lastHostSignature && !spectatorState.pendingVisuals.length) return null;
  spectatorState.lastHostSignature = signature;
  const visualPacketId = spectatorState.pendingVisuals.length ? `spec:${specMatchId()}:${state_ui_battle_state.game.turnSerial || 0}:${specNow()}` : null;
  const visuals = spectatorState.pendingVisuals.splice(0, 72);
  return {
    protocol: SPEC_VERSION,
    compat: SPEC_COMPAT,
    matchId: specMatchId(),
    rules: state_ui_battle_state.game?.bossRaid ? {
      league: "mega",
      bossRaid: true,
      bossVersion: state_ui_battle_state.game.bossRaid.version || null
    } : state_ui_deck.p2p?.rules || onlineRulesPayload(state_ui_battle_state.game.league),
    bossRaid: !!state_ui_battle_state.game?.bossRaid,
    state,
    turnSerial: Number(state_ui_battle_state.game.turnSerial || 0),
    revision: Number(state_ui_deck.p2p?.__reliableStatePacket?.revision || state_online_commands.onlineAuthoritativeRevision || 0),
    visualPacketId,
    visuals,
    spectators: specWatcherCount(),
    ended: !!state_ui_battle_state.game.winner,
    sentAt: specNow()
  };
}
function specSendSnapshotTo(transport, peerId, force = false) {
  const packet = specSnapshotPayload(force);
  if (packet) specSafeSend(transport.snapshot, packet, peerId);
}
function specBroadcastSnapshot(force = false) {
  if (!specIsHostMatch()) return;
  const now = specNow();
  for (const [key, w] of spectatorState.watchers) {
    if (now - Number(w.lastSeen || 0) > 8500) spectatorState.watchers.delete(key);
  }
  const packet = specSnapshotPayload(force);
  if (!packet) return;
  for (const w of spectatorState.watchers.values()) {
    const transport = spectatorState.transports.get(w.transport);
    if (transport) specSafeSend(transport.snapshot, packet, w.peerId);
  }
}
export async function specStartHostBroadcast() {
  if (!specIsHostMatch()) return;
  state_ui_deck.p2p.spectatorStartedAt ||= specNow();
  spectatorState.mode = "host";
  await specEnsureHub();
  TimerManager.clear(spectatorState.announceTimer);
  TimerManager.clear(spectatorState.snapshotTimer);
  spectatorState.announceTimer = TimerManager.setInterval(specBroadcastAnnounce, 1450);
  spectatorState.snapshotTimer = TimerManager.setInterval(() => specBroadcastSnapshot(false), 420);
  specBroadcastAnnounce();
}
function specStopHostBroadcast() {
  TimerManager.clear(spectatorState.announceTimer);
  spectatorState.announceTimer = null;
  TimerManager.clear(spectatorState.snapshotTimer);
  spectatorState.snapshotTimer = null;
  spectatorState.watchers.clear();
  spectatorState.lastHostSignature = "";
  spectatorState.pendingVisuals.length = 0;
  if (spectatorState.mode === "host") spectatorState.mode = "idle";
  specChatApi()?.sync?.();
}
function specDebug() {
  return {
    mode: spectatorState.mode,
    watching: !!spectatorState.watching,
    transports: spectatorState.transports.size,
    matches: spectatorState.matches.size,
    watchers: spectatorState.watchers.size,
    browseTimer: !!spectatorState.browseTimer,
    announceTimer: !!spectatorState.announceTimer,
    snapshotTimer: !!spectatorState.snapshotTimer,
    requestTimer: !!spectatorState.requestTimer,
    pendingVisuals: spectatorState.pendingVisuals.length
  };
}
function specCloseSession(options = {}) {
  if (specIsHostMatch()) specBroadcastSnapshot(true);
  specStopHostBroadcast();
  TimerManager.clear(spectatorState.browseTimer);
  spectatorState.browseTimer = null;
  TimerManager.clear(spectatorState.requestTimer);
  spectatorState.requestTimer = null;
  specCloseHub();
  spectatorState.matches.clear();
  spectatorState.watchers.clear();
  spectatorState.watching = null;
  spectatorState.mode = "idle";
  spectatorState.lastVisualPacketId = null;
  spectatorState.lastBossVisualSignature = "";
  spectatorState.chatSeen.clear();
  document.body.classList.remove("spectator-mode");
  const bar = document.getElementById("spectatorBar");
  if (bar) bar.hidden = true;
  if (!options?.preserveBattleResult && state_ui_battle_state.game?.mode === "spectator") {
    state_ui_battle_state.game = null;
    state_ui_battle_state.pendingSkill = null;
    state_ui_battle_state.busy = false;
  }
  specChatApi()?.sync?.();
  return specDebug();
}
function specOnAnnounce(transport, data, peerId) {
  if (!data || data.protocol !== SPEC_VERSION || data.compat !== SPEC_COMPAT || !data.matchId || !peerId) return;
  if (data.ended && !spectatorState.watching) return;
  const id = String(data.matchId);
  const previous = spectatorState.matches.get(id) || {
    sources: {}
  };
  previous.sources ||= {};
  previous.sources[transport.name] = peerId;
  Object.assign(previous, data, {
    lastSeen: specNow()
  });
  spectatorState.matches.set(id, previous);
  if (spectatorState.mode === "browse") specRenderMatchList();
}
function specCurrentMatchRecords() {
  const now = specNow();
  for (const [id, rec] of spectatorState.matches) {
    if (now - Number(rec.lastSeen || 0) > 6500 || rec.ended) spectatorState.matches.delete(id);
  }
  const records = [...spectatorState.matches.values()];
  return records.filter(rec => !spectatorState.bossOnly || !!rec.bossRaid).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}
function specMatchLabel(rec) {
  if (rec.bossRaid && rec.bossId === "zombie-cave") return `좀비굴 · 탐험대 생존 ${rec.pAlive ?? 0}`;
  if (rec.bossRaid) return `보스전 · 붉은 시간의 군단 · 연합 ${rec.pAlive ?? 0} 대 군단 ${rec.aAlive ?? 0}`;
  const league = state_ui_deck.LeagueFormatOwner.definition(rec.league).label;
  return `${league} · ${rec.pAlive ?? 0} 대 ${rec.aAlive ?? 0}`;
}
function specRenderMatchList() {
  const list = document.getElementById("spectatorMatchList");
  if (!list || spectatorState.mode !== "browse") return;
  const records = specCurrentMatchRecords();
  list.textContent = "";
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "spectator-empty";
    empty.innerHTML = `<b>진행 중인 공개 경기가 없습니다.</b><br><span class="tiny">경기를 검색하는 동안 이 창을 열어 두세요.</span>`;
    list.appendChild(empty);
    return;
  }
  for (const rec of records) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "spectator-match-card";
    const main = document.createElement("span");
    main.className = "spectator-match-main";
    const live = document.createElement("span");
    live.className = "spectator-match-live";
    live.textContent = "LIVE";
    const title = document.createElement("span");
    title.className = "spectator-match-title";
    title.textContent = specMatchLabel(rec);
    const meta = document.createElement("span");
    meta.className = "spectator-match-meta";
    meta.textContent = `${Number(rec.turns || rec.turnSerial || 0)}행동 · 관전자 ${Number(rec.spectators || 0)}명`;
    main.append(live, title, meta);
    const enter = document.createElement("span");
    enter.textContent = "관전";
    enter.className = "pill";
    button.append(main, enter);
    button.onclick = () => specBeginWatching(rec);
    list.appendChild(button);
  }
}
function specReturnToSourceLobby() {
  spectatorState.mode = "idle";
  if (spectatorState.returnTarget === "boss" && typeof systems.__redTimeoraBossRaid?.openMenu === "function") {
    systems.__redTimeoraBossRaid.openMenu();
  } else systems.OnlineRuntime?.ui?.showEntry?.({
    source: "SPECTATOR_RETURN"
  });
}
async function specOpenLobby(options = {}) {
  if ((state_ui_battle_state.game?.mode === "online" || state_ui_battle_state.game?.bossRaid?.online) && !state_ui_battle_state.game?.winner) return;
  spectatorState.bossOnly = !!options?.bossOnly;
  spectatorState.returnTarget = options?.returnTarget === "boss" ? "boss" : "online";
  spectatorState.mode = "browse";
  spectatorState.lobbyOpenedAt = specNow();
  spectatorState.matches.clear();
  const bossOnly = spectatorState.bossOnly;
  document.getElementById("modalContent").innerHTML = `<h2>${bossOnly ? "진행 중 보스전 관전" : "진행 중 경기 관전"}</h2><p>${bossOnly ? "현재 공개된 붉은 시간의 군단 보스전을 선택하세요." : "현재 공개된 온라인 경기를 선택하세요."}</p><div id="spectatorHubStatus" class="tiny muted">관전 허브 연결 중…</div><div id="spectatorMatchList" class="spectator-match-list"></div><div class="choice-list"><button id="spectatorRefresh">목록 새로고침</button><button id="spectatorBack">뒤로</button></div><p class="tiny muted">최신 관전 기능이 적용된 경기만 목록에 표시됩니다. 관전자는 전투에 개입할 수 없습니다.</p>`;
  document.getElementById("modal").classList.add("open");
  document.getElementById("spectatorRefresh").onclick = () => {
    spectatorState.matches.clear();
    specRenderMatchList();
    specSendBrowseProbe();
  };
  document.getElementById("spectatorBack").onclick = specReturnToSourceLobby;
  specRenderMatchList();
  const ok = await specEnsureHub();
  const status = document.getElementById("spectatorHubStatus");
  if (status) status.textContent = ok ? "공개 관전 허브 연결 완료 · 경기 검색 중" : "관전 허브 연결 실패 · 네트워크를 확인하세요.";
  specSendBrowseProbe();
  TimerManager.clear(spectatorState.browseTimer);
  spectatorState.browseTimer = TimerManager.setInterval(() => {
    specRenderMatchList();
    specSendBrowseProbe();
  }, 1800);
}
function specSendBrowseProbe() {
  const packet = {
    protocol: SPEC_VERSION,
    compat: SPEC_COMPAT,
    type: "browse",
    spectatorId,
    sentAt: specNow()
  };
  for (const transport of spectatorState.transports.values()) specSafeSend(transport.request, packet);
}
function specSendWatchRequest() {
  const w = spectatorState.watching;
  if (!w) return;
  const rec = spectatorState.matches.get(w.matchId) || w.record;
  if (!w.sourceOrder?.length) w.sourceOrder = Object.entries(rec?.sources || {});
  if (!w.sourceOrder.length) return;
  const source = w.sourceOrder[Math.min(w.sourceIndex || 0, w.sourceOrder.length - 1)];
  const [transportName, peerId] = source;
  const transport = spectatorState.transports.get(transportName);
  if (transport) specSafeSend(transport.request, {
    protocol: SPEC_VERSION,
    compat: SPEC_COMPAT,
    type: "watch",
    matchId: w.matchId,
    spectatorId,
    sentAt: specNow()
  }, peerId);
}
function specBeginWatching(rec) {
  spectatorState.mode = "watching";
  spectatorState.viewSide = "P";
  state_ui_deck.onlineSide = "P";
  spectatorState.watching = {
    matchId: String(rec.matchId),
    record: rec,
    startedAt: specNow(),
    received: false,
    sourceOrder: Object.entries(rec.sources || {}),
    sourceIndex: 0
  };
  TimerManager.clear(spectatorState.browseTimer);
  spectatorState.browseTimer = null;
  document.getElementById("modalContent").innerHTML = `<h2>경기 연결 중</h2><div class="matchmaking-box"><b id="spectatorConnectStatus">호스트에게 관전 요청 중…</b><div class="matchmaking-time">LIVE</div><button id="spectatorCancelWatch">취소</button></div>`;
  document.getElementById("spectatorCancelWatch").onclick = specLeaveWatching;
  specSendWatchRequest();
  TimerManager.clear(spectatorState.requestTimer);
  spectatorState.requestTimer = TimerManager.setInterval(() => {
    if (!spectatorState.watching) return;
    const elapsed = specNow() - spectatorState.watching.startedAt;
    if (!spectatorState.watching.received && elapsed > 5200 && spectatorState.watching.sourceOrder?.length > 1) {
      spectatorState.watching.sourceIndex = (spectatorState.watching.sourceIndex + 1) % spectatorState.watching.sourceOrder.length;
    }
    specSendWatchRequest();
    const status = document.getElementById("spectatorConnectStatus");
    if (status && elapsed > 9000) status.textContent = "호스트 응답 대기 중 · 다른 신호망으로 재시도하고 있습니다.";
  }, 1800);
}
function specOnSnapshot(transport, data, peerId) {
  const w = spectatorState.watching;
  if (!w || !data || data.protocol !== SPEC_VERSION || data.compat !== SPEC_COMPAT) return;
  if (String(data.matchId || "") !== w.matchId || !data.state) return;
  const rec = spectatorState.matches.get(w.matchId) || w.record;
  if (rec?.sources?.[transport.name] && rec.sources[transport.name] !== peerId) return;
  w.received = true;
  specApplySnapshot(data);
}
function specViewButtonLabel() {
  if (state_ui_battle_state.game?.bossRaid) return spectatorState.viewSide === "P" ? "시점: 연합" : "시점: 군단";
  return spectatorState.viewSide === "P" ? "시점: P1" : "시점: P2";
}
function specToggleView() {
  if (!spectatorState.watching) return false;
  spectatorState.viewSide = spectatorState.viewSide === "P" ? "A" : "P";
  state_ui_deck.onlineSide = spectatorState.viewSide;
  render();
  return true;
}
function specEnsureBar() {
  let bar = document.getElementById("spectatorBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "spectatorBar";
    bar.hidden = true;
    bar.innerHTML = `<span class="spectator-bar-text">관전 중</span><span class="spectator-bar-actions"><button type="button" id="spectatorViewButton">시점: P1</button><button type="button" id="spectatorExitButton">관전 종료</button></span>`;
    document.body.appendChild(bar);
    bar.querySelector("#spectatorViewButton").onclick = specToggleView;
    bar.querySelector("#spectatorExitButton").onclick = specLeaveWatching;
  }
  const viewButton = bar.querySelector("#spectatorViewButton");
  if (viewButton) viewButton.textContent = specViewButtonLabel();
  return bar;
}
export function specDecorateBattle(data = null) {
  if (!spectatorState.watching) return;
  document.body.classList.add("spectator-mode");
  const bar = specEnsureBar();
  bar.hidden = false;
  const text = bar.querySelector(".spectator-bar-text");
  const count = Number(data?.spectators || 0);
  text.textContent = `${state_ui_battle_state.game?.winner ? "경기 종료" : "관전 중"} · ${state_ui_battle_state.game?.matchType || "온라인 경기"}${count ? ` · 관전자 ${count}명` : ""}`;
  const playerTitle = document.querySelector(".player-side .side-head b");
  const aiTitle = document.querySelector(".ai-side .side-head b");
  if (state_ui_battle_state.game?.bossRaid) {
    const zombie = state_ui_battle_state.game.bossRaid.kind === "zombie",
      alliance = zombie ? "탐험대" : "레이드 연합",
      legion = zombie ? "좀비 떼" : "붉은 시간 군단";
    if (playerTitle) playerTitle.textContent = spectatorState.viewSide === "P" ? `${alliance} 시점` : `${legion} 시점`;
    if (aiTitle) aiTitle.textContent = spectatorState.viewSide === "P" ? legion : alliance;
  } else {
    if (playerTitle) playerTitle.textContent = spectatorState.viewSide === "P" ? "플레이어 1 시점" : "플레이어 2 시점";
    if (aiTitle) aiTitle.textContent = spectatorState.viewSide === "P" ? "플레이어 2" : "플레이어 1";
  }
  const viewButton = bar.querySelector("#spectatorViewButton");
  if (viewButton) viewButton.textContent = specViewButtonLabel();
  const title = document.getElementById("actionTitle");
  if (title) title.textContent = state_ui_battle_state.game?.winner ? "경기 종료" : "관전 중";
  const hint = document.getElementById("actionHint");
  if (hint) hint.textContent = "읽기 전용 관전 · 상단 시점 버튼으로 양 진영을 전환할 수 있으며 채팅은 사용할 수 있습니다.";
  /* action-panel visibility is committed only by ActionPanelConvergenceOwner. */
}
function specApplySnapshot(data) {
  const first = !document.body.classList.contains("spectator-mode") || state_ui_battle_state.game?.mode !== "spectator";
  try {
    const revived = data.bossRaid && typeof systems.__redTimeoraBossRaid?.revive === "function" ? systems.__redTimeoraBossRaid.revive(data.state) : systems.OnlineSnapshotEngine.restoreState(data.state, {
      source: "spectator",
      rules: data.rules || state_ui_deck.ONLINE_COMMON_RULES
    });
    revived.mode = "spectator";
    revived.spectatorBossRaid = !!data.bossRaid;
    revived.matchId = String(data.matchId || "");
    state_ui_battle_state.game = revived;
    state_ui_deck.onlineSide = spectatorState.viewSide === "A" ? "A" : "P";
    state_ui_battle_state.busy = false;
    state_ui_battle_state.pendingSkill = null;
    if (first) {
      state_ui_battle_state.lastLog = 0;
      state_ui_battle_state.visualEvents = [];
      document.getElementById("log").innerHTML = "";
    }
    if (data.visualPacketId && data.visualPacketId !== spectatorState.lastVisualPacketId) {
      spectatorState.lastVisualPacketId = data.visualPacketId;
      state_ui_battle_state.visualEvents = cloneOnlineVisualEvents(data.visuals || []);
    } else state_ui_battle_state.visualEvents = [];
    document.getElementById("modal").classList.remove("open");
    state_ui_results.NavigationApplication.request("game");
    render();
    specDecorateBattle(data);
    if (first) startBgm();
  } catch (error) {
    console.error("[spectator] snapshot apply failed", error);
    const status = document.getElementById("spectatorConnectStatus");
    if (status) status.textContent = "관전 상태를 불러오지 못했습니다. 다시 시도 중입니다.";
  }
}
function specLeaveWatching() {
  const w = spectatorState.watching;
  if (w) {
    const rec = spectatorState.matches.get(w.matchId) || w.record;
    for (const [transportName, peerId] of Object.entries(rec?.sources || {})) {
      const transport = spectatorState.transports.get(transportName);
      if (transport) specSafeSend(transport.leave, {
        protocol: SPEC_VERSION,
        compat: SPEC_COMPAT,
        matchId: w.matchId,
        spectatorId
      }, peerId);
    }
  }
  TimerManager.clear(spectatorState.requestTimer);
  spectatorState.requestTimer = null;
  spectatorState.watching = null;
  spectatorState.mode = "idle";
  spectatorState.lastVisualPacketId = null;
  spectatorState.viewSide = "P";
  spectatorState.chatSeen.clear();
  document.body.classList.remove("spectator-mode");
  const bar = document.getElementById("spectatorBar");
  if (bar) bar.hidden = true;
  state_ui_battle_state.game = null;
  state_ui_battle_state.pendingSkill = null;
  state_ui_battle_state.busy = false;
  state_ui_results.NavigationApplication.request("setup");
  specChatApi()?.sync?.();
  specReturnToSourceLobby();
}

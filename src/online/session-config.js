import { sessionRuntime } from "./session-model.js";
import { randomId, stableOnlinePlayerId } from "./transport.js";
import { systems } from "../runtime/systems.js";
import { failWithoutSession } from "./cleanup.js";
export function initializeOnlineSessionConfig() {
  sessionRuntime.VERSION = "ONLINE-RUNTIME-AUTHORITY-CONSOLIDATION-R7";
  sessionRuntime.PROTOCOL = "cp32-online-relay-v1";
  sessionRuntime.PRODUCTION_RELAY_ENDPOINT = "wss://cp32-online-relay.onrender.com/online";
  sessionRuntime.RELAY_OPEN_TIMEOUT_MS = 90_000;
  sessionRuntime.STATES = Object.freeze(["IDLE", "STARTING", "SIGNALING", "HOSTING", "JOINING", "MATCHMAKING", "HANDSHAKING", "LOBBY", "STARTING_BATTLE", "IN_BATTLE", "RECONNECTING", "ENDING", "CLOSED", "FAILED"]);
  sessionRuntime.ALLOWED = Object.freeze({
    IDLE: new Set(["STARTING", "CLOSED"]),
    STARTING: new Set(["SIGNALING", "FAILED", "CLOSED"]),
    SIGNALING: new Set(["HOSTING", "JOINING", "MATCHMAKING", "HANDSHAKING", "LOBBY", "RECONNECTING", "FAILED", "CLOSED"]),
    HOSTING: new Set(["HANDSHAKING", "RECONNECTING", "FAILED", "ENDING", "CLOSED"]),
    JOINING: new Set(["HANDSHAKING", "RECONNECTING", "FAILED", "ENDING", "CLOSED"]),
    MATCHMAKING: new Set(["HANDSHAKING", "RECONNECTING", "FAILED", "ENDING", "CLOSED"]),
    HANDSHAKING: new Set(["MATCHMAKING", "LOBBY", "RECONNECTING", "FAILED", "ENDING", "CLOSED"]),
    LOBBY: new Set(["STARTING_BATTLE", "IN_BATTLE", "RECONNECTING", "ENDING", "FAILED", "CLOSED"]),
    STARTING_BATTLE: new Set(["LOBBY", "IN_BATTLE", "RECONNECTING", "ENDING", "FAILED", "CLOSED"]),
    IN_BATTLE: new Set(["LOBBY", "RECONNECTING", "ENDING", "FAILED", "CLOSED"]),
    RECONNECTING: new Set(["SIGNALING", "HOSTING", "JOINING", "MATCHMAKING", "HANDSHAKING", "LOBBY", "IN_BATTLE", "FAILED", "ENDING", "CLOSED"]),
    ENDING: new Set(["CLOSED", "FAILED"]),
    CLOSED: new Set(["IDLE", "STARTING"]),
    FAILED: new Set(["CLOSED", "IDLE", "STARTING"])
  });
  sessionRuntime.STATUS_TEXT = Object.freeze({
    IDLE: "연결 전",
    STARTING: "온라인 세션 시작 중",
    SIGNALING: "relay 신호 연결 중",
    HOSTING: "방 개설 완료 · 상대 참가 대기 중",
    JOINING: "같은 방 코드로 참가 대기 중",
    MATCHMAKING: "자동 매칭 대기열에서 상대 확인 중",
    HANDSHAKING: "상대를 찾았습니다 · 역할과 세션 확정 중",
    LOBBY: "실제 relay 연결 완료 · 대기실 동기화 중",
    STARTING_BATTLE: "전투 시작 확정 중",
    IN_BATTLE: "온라인 전투 연결됨",
    RECONNECTING: "기존 온라인 세션 재연결 중",
    ENDING: "온라인 세션 정리 중",
    CLOSED: "온라인 연결 종료",
    FAILED: "온라인 연결 실패"
  });
  sessionRuntime.counters = {
    roomCodeMutationCount: 0,
    playerIdMutationCount: 0,
    queueEntryMutationCount: 0,
    matchIdMutationCount: 0,
    sessionGenerationCount: 0,
    staleCallbackDropCount: 0,
    reconnectCount: 0,
    duplicateOfferDropCount: 0,
    duplicateCommitDropCount: 0,
    retiredBindingMessageDropCount: 0,
    duplicateSocketCount: 0,
    duplicateReconnectLoopCount: 0,
    restorePromotionFailureCount: 0
  };
  sessionRuntime.recentErrors = [];
  sessionRuntime.transitionTrace = [];
  sessionRuntime.modeAdapters = new Map();
  sessionRuntime.generationSerial = 0;
  sessionRuntime.configuredEndpoint = "";
  sessionRuntime.configuredEndpointSource = "production-default";
  sessionRuntime.runtimeClosing = false;
  sessionRuntime.playerId = "";
  sessionRuntime.activeSession = null;
  sessionRuntime.projectionTransactionSerial = 0;
  sessionRuntime.phaseForState = state => ({
    STARTING: "ENTRY",
    SIGNALING: "ENTRY",
    HOSTING: "ENTRY",
    JOINING: "ENTRY",
    MATCHMAKING: "ENTRY",
    HANDSHAKING: "ENTRY",
    LOBBY: "LOBBY",
    STARTING_BATTLE: "LOBBY",
    IN_BATTLE: "IN_BATTLE",
    RECONNECTING: sessionRuntime.activeSession?.committed ? sessionRuntime.activeSession?.resumeState || "LOBBY" : "ENTRY",
    ENDING: "TERMINAL",
    CLOSED: "SETUP",
    FAILED: "ENTRY"
  })[state] || "ENTRY";
}
export function initializeOnlineSessionConfigStep36() {
  sessionRuntime.clean = (value, max = 240) => String(value == null ? "" : value).trim().slice(0, max);
  sessionRuntime.randomToken = prefix => {
    try {
      return randomId(prefix);
    } catch {
      const bytes = new Uint32Array(3);
      crypto.getRandomValues(bytes);
      return `${prefix}-${[...bytes].map(value => value.toString(36)).join("-")}`;
    }
  };
  sessionRuntime.makeStableRoomCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const values = new Uint32Array(6);
    crypto.getRandomValues(values);
    return [...values].map(value => chars[value % chars.length]).join("");
  };
  sessionRuntime.validateEndpoint = value => {
    const endpoint = sessionRuntime.clean(value, 500);
    if (!endpoint) return {
      ok: false,
      code: "RELAY_ENDPOINT_REQUIRED",
      detail: "공개 WSS relay 주소를 설정해야 합니다."
    };
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      return {
        ok: false,
        code: "RELAY_ENDPOINT_INVALID",
        detail: "relay 주소 형식이 올바르지 않습니다."
      };
    }
    if (!/^wss?:$/.test(url.protocol)) return {
      ok: false,
      code: "RELAY_ENDPOINT_INVALID",
      detail: "relay 주소는 ws:// 또는 wss:// 여야 합니다."
    };
    if (location.protocol === "https:" && url.protocol !== "wss:") return {
      ok: false,
      code: "RELAY_ENDPOINT_MIXED_CONTENT",
      detail: "HTTPS 페이지에서는 wss:// relay가 필요합니다."
    };
    return {
      ok: true,
      endpoint: url.href
    };
  };
  sessionRuntime.readEndpoint = () => {
    let stored = "";
    try {
      stored = sessionRuntime.clean(localStorage.getItem("cp32OnlineRelayEndpoint"), 500);
    } catch {}
    const candidates = [{
      source: "query-override",
      value: sessionRuntime.clean(new URLSearchParams(location.search).get("relay"), 500)
    }, {
      source: "local-storage-override",
      value: stored
    }, {
      source: "build-config-override",
      value: sessionRuntime.clean(systems.CP32_ONLINE_RELAY_CONFIG?.endpoint, 500)
    }, {
      source: "production-default",
      value: sessionRuntime.PRODUCTION_RELAY_ENDPOINT
    }];
    for (const candidate of candidates) {
      if (!candidate.value) continue;
      const checked = sessionRuntime.validateEndpoint(candidate.value);
      if (!checked.ok) continue;
      sessionRuntime.configuredEndpointSource = candidate.source;
      return checked.endpoint;
    }
    sessionRuntime.configuredEndpointSource = "production-default";
    return sessionRuntime.PRODUCTION_RELAY_ENDPOINT;
  };
  sessionRuntime.configuredEndpoint = sessionRuntime.readEndpoint();
  try {
    sessionRuntime.playerId = stableOnlinePlayerId();
  } catch {
    sessionRuntime.playerId = sessionRuntime.randomToken("p");
  }
  sessionRuntime.recordError = (code, detail = "", extra = {}) => {
    const entry = {
      code: sessionRuntime.clean(code, 120) || "UNKNOWN",
      detail: sessionRuntime.clean(detail, 400),
      at: Date.now(),
      ...extra
    };
    sessionRuntime.recentErrors.push(entry);
    if (sessionRuntime.recentErrors.length > 80) sessionRuntime.recentErrors.splice(0, sessionRuntime.recentErrors.length - 80);
    return entry;
  };
  sessionRuntime.projectStatus = () => sessionRuntime.projectStatusDom();
}
export function setEndpoint(value, persist = true) {
  const checked = sessionRuntime.validateEndpoint(value);
  if (!checked.ok) {
    failWithoutSession(checked.code, checked.detail);
    return false;
  }
  sessionRuntime.configuredEndpoint = checked.endpoint;
  sessionRuntime.configuredEndpointSource = persist ? "local-storage-override" : "runtime-override";
  if (persist) try {
    localStorage.setItem("cp32OnlineRelayEndpoint", sessionRuntime.configuredEndpoint);
  } catch {}
  const input = document.getElementById("onlineRelayEndpoint");
  if (input) input.value = sessionRuntime.configuredEndpoint;
  return true;
}

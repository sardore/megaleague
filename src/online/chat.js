import { TimerManager } from "../runtime/timers.js";
import { onlineCurrentMatchId } from "./commands.js";
import { registerOnlineConnectionRoute } from "./connection.js";
import { sendOnlineEmote } from "./emotes.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { state_ui_deck } from "../ui/deck.js";
import { renderSetup } from "../ui/setup.js";
export function initializeOnlineChat() {
  /* 선택형 코스트(RorB/WorB 등)는 문자 선택이 아니라 실제 에너지 토큰으로 결제한다. */

  /* ===== 온라인 탭 복귀 복구·채팅·동전 면 구분·폭시어스 리워크 ===== */

  // 모바일 WebView에서 뒷면이 앞면과 같은 색으로 보이는 현상을 결과 확정 시 강제로 교정한다.

  document.addEventListener("animationend", event => {
    const coin = event.target?.closest?.(".online-coin");
    if (!coin || event.animationName !== "onlineCoinFlip") return;
    settleOnlineCoin(coin);
  }, true);
  onlineCoinObserver = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      const coin = node.matches?.(".online-coin") ? node : node.querySelector?.(".online-coin");
      if (coin) TimerManager.setTimeout(() => settleOnlineCoin(coin), 1520);
    }
  });
  onlineCoinObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  onlineStateRetryTimer = null;
  onlineChatRetryTimer = null;
  onlineChatMessages = [];
  onlineChatSeen = new Set();
  onlineChatPending = new Map();
  onlineChatUnread = 0;
  onlineChatPanelOpen = false;

  // 복귀 동기화는 백그라운드에서 조용히 처리한다. 입력 위에 상태 문구를 띄우지 않는다.

  // 기존 권위 상태 전송을 보존하면서 마지막 패킷을 ACK가 올 때까지 재전송한다.

  OnlineReliableStateEngine = systems.OnlineReliableStateEngine = Object.freeze({
    start: ensureOnlineStateRetryTimer,
    pause() {
      if (onlineStateRetryTimer) systems.OnlineRuntime?.sessionScope?.cancel?.(onlineStateRetryTimer);
      onlineStateRetryTimer = null;
      return this.debug();
    },
    closeSession() {
      if (onlineStateRetryTimer) systems.OnlineRuntime?.sessionScope?.cancel?.(onlineStateRetryTimer);
      onlineStateRetryTimer = null;
      if (state_ui_deck.p2p) {
        state_ui_deck.p2p.__reliableStatePacket = null;
        state_ui_deck.p2p.__reliableStateAck = 0;
        state_ui_deck.p2p.__reliableStateSentAt = 0;
      }
      return this.debug();
    },
    debug: () => ({
      retryTimer: !!onlineStateRetryTimer,
      packetPending: !!state_ui_deck.p2p?.__reliableStatePacket
    })
  });
  systems.__megaOnlineBattleChat = {
    sync: syncOnlineChatUI,
    open() {
      onlineChatPanelOpen = true;
      onlineChatUnread = 0;
      syncOnlineChatUI();
      return !document.getElementById("onlineChatPanel")?.hidden;
    },
    close() {
      onlineChatPanelOpen = false;
      syncOnlineChatUI();
      return true;
    },
    toggle() {
      onlineChatPanelOpen = !onlineChatPanelOpen;
      onlineChatUnread = 0;
      syncOnlineChatUI();
      return onlineChatPanelOpen;
    },
    isOpen() {
      return !!onlineChatPanelOpen;
    },
    send: sendOnlineChat,
    sendPacket: sendOnlinePacketSafe,
    receivePacket: handleOnlineChatPacket,
    popup: showBattleChatPopup,
    push(message, options = {}) {
      const id = String(message?.id || `${onlinePacketMatchId()}:external:${Date.now()}:${Math.random().toString(36).slice(2)}`);
      if (onlineChatSeen.has(id)) return false;
      onlineChatSeen.add(id);
      const normalized = {
        id,
        text: String(message?.text || "").trim().slice(0, 120),
        sentAt: Number(message?.sentAt || Date.now()),
        mine: !!message?.mine,
        sender: String(message?.sender || message?.senderLabel || (message?.mine ? "나" : "관전자")).slice(0, 24)
      };
      if (!normalized.text) return false;
      const added = addOnlineChatMessage(normalized);
      if (added && options.popup !== false && onlineChatPopupContextActive()) showBattleChatPopup(normalized.text, normalized.sender);
      return added;
    },
    startSession() {
      ensureOnlineChatRetryTimer();
      syncOnlineChatUI();
      return this.debug();
    },
    pause() {
      if (onlineChatRetryTimer) systems.OnlineRuntime?.sessionScope?.cancel?.(onlineChatRetryTimer);
      onlineChatRetryTimer = null;
      return this.debug();
    },
    closeSession(options = {}) {
      const clearChat = options?.clearChat === true;
      const resetUnread = clearChat || options?.resetUnread === true;
      onlineChatPanelOpen = false;
      if (onlineChatRetryTimer) systems.OnlineRuntime?.sessionScope?.cancel?.(onlineChatRetryTimer);
      onlineChatRetryTimer = null;
      if (resetUnread) onlineChatUnread = 0;
      if (clearChat) {
        onlineChatMessages.splice(0);
        onlineChatSeen.clear();
        onlineChatPending.clear();
      }
      syncOnlineChatUI();
      return this.debug();
    },
    debug() {
      return {
        panelOpen: !!onlineChatPanelOpen,
        unread: Number(onlineChatUnread || 0),
        pendingCount: onlineChatPending.size,
        messageCount: onlineChatMessages.length,
        seenCount: onlineChatSeen.size,
        retryTimer: !!onlineChatRetryTimer
      };
    },
    clear() {
      return this.closeSession({
        clearChat: true,
        resetUnread: true
      });
    }
  };
  for (const type of ["battleChat", "spectatorChatRelay", "battleChatAck", "stateAck"]) registerOnlineConnectionRoute(type, "online-resilience", handleOnlineResiliencePacket, 80);
  ensureOnlineChatUI();
  syncOnlineChatUI();
  systems.__megaSyncOnlineChatUI = syncOnlineChatUI;

  // 모든 후속 카드 정의까지 완료된 최종 CARDS 레지스트리로 편성 화면을 한 번 동기화한다.
  if (state_ui_battle_state.$("#setup")?.classList.contains("active")) renderSetup(false);
}
let onlineCoinObserver, onlineStateRetryTimer, onlineChatRetryTimer, onlineChatMessages, onlineChatSeen, onlineChatPending, onlineChatUnread, onlineChatPanelOpen, OnlineReliableStateEngine;
function settleOnlineCoin(coin) {
  if (!coin || coin.classList.contains("settled")) return;
  coin.classList.add("settled");
}
function onlinePacketMatchId(packet) {
  return String(packet?.matchId || onlineCurrentMatchId?.() || state_ui_deck.p2p?.matchId || state_ui_battle_state.game?.matchId || "online");
}
function onlineConnectionReady() {
  const open = !!state_ui_deck.p2p?.conn?.open;
  if (open && state_ui_deck.p2p && !state_ui_deck.p2p.connected) state_ui_deck.p2p.connected = true;
  return open;
}
function sendOnlinePacketSafe(packet) {
  try {
    if (!onlineConnectionReady()) return false;
    return state_ui_deck.p2p.conn.send(packet) !== false;
  } catch (error) {
    if (systems.DEBUG_BATTLE_EVENTS) console.warn("[online-resume] send failed", packet?.type, error);
    return false;
  }
}
function retryReliableOnlineState(force = false) {
  if (!onlineConnectionReady() || state_ui_deck.p2p?.role !== "host" || !(state_ui_battle_state.game?.mode === "online" || state_ui_battle_state.game?.bossRaid?.online)) return;
  const packet = state_ui_deck.p2p.__reliableStatePacket;
  if (!packet) return;
  if (Number(state_ui_deck.p2p.__reliableStateAck || 0) >= Number(packet.revision || 0)) return;
  if (!force && Date.now() - Number(state_ui_deck.p2p.__reliableStateSentAt || 0) < 720) return;
  // Reliable retries are immutable: state/turn must stay paired with packet.revision.
  state_ui_deck.p2p.__reliableStateSentAt = Date.now();
  sendOnlinePacketSafe(packet);
}
function chatTimeLabel(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}
function ensureOnlineChatUI() {
  let button = document.getElementById("onlineChatBtn");
  if (!button) {
    button = document.createElement("button");
    button.id = "onlineChatBtn";
    button.type = "button";
    button.hidden = true;
    button.setAttribute("aria-label", "온라인 채팅 열기");
    button.title = "온라인 채팅";
    document.body.appendChild(button);
    button.onclick = () => {
      onlineChatPanelOpen = !onlineChatPanelOpen;
      onlineChatUnread = 0;
      syncOnlineChatUI();
      if (onlineChatPanelOpen) TimerManager.setTimeout(() => document.getElementById("onlineChatInput")?.focus(), 0);
    };
  }
  let panel = document.getElementById("onlineChatPanel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "onlineChatPanel";
    panel.className = "online-chat-panel";
    panel.hidden = true;
    panel.innerHTML = `<div class="online-chat-head"><b>온라인 채팅</b><button id="onlineChatClose" type="button">닫기</button></div><div id="onlineChatMessages" class="online-chat-messages"></div><div class="online-chat-emotes" id="onlineChatEmotes">${["👍", "🔥", "😮", "😂", "💢", "GG"].map(e => `<button type="button" data-chat-emote="${e}" aria-label="${e}">${e}</button>`).join("")}</div><form id="onlineChatForm" class="online-chat-compose"><input id="onlineChatInput" maxlength="120" autocomplete="off" placeholder="메시지 입력"><button type="submit" class="primary">전송</button></form>`;
    document.body.appendChild(panel);
    panel.querySelector("#onlineChatClose").onclick = () => {
      onlineChatPanelOpen = false;
      syncOnlineChatUI();
    };
    panel.querySelectorAll("[data-chat-emote]").forEach(btn => {
      btn.addEventListener("click", () => sendOnlineEmote(btn.dataset.chatEmote || btn.textContent || "👍"));
    });
    panel.querySelector("#onlineChatForm").addEventListener("submit", event => {
      event.preventDefault();
      const input = panel.querySelector("#onlineChatInput");
      const value = String(input.value || "").trim();
      if (!value) return;
      input.value = "";
      sendOnlineChat(value);
    });
  }
  return {
    button,
    panel
  };
}
function renderOnlineChatMessages() {
  const box = document.getElementById("onlineChatMessages");
  if (!box) return;
  box.textContent = "";
  if (!onlineChatMessages.length) {
    const empty = document.createElement("div");
    empty.className = "online-chat-empty";
    empty.textContent = "상대와 메시지를 주고받을 수 있습니다.";
    box.appendChild(empty);
    return;
  }
  for (const message of onlineChatMessages.slice(-80)) {
    const row = document.createElement("div");
    row.className = `online-chat-message ${message.mine ? "mine" : "remote"}`;
    const body = document.createElement("span");
    body.textContent = message.text;
    const meta = document.createElement("span");
    meta.className = "online-chat-meta";
    meta.textContent = `${message.sender || (message.mine ? "나" : state_ui_battle_state.game?.bossRaid?.online ? "레이드 동료" : "상대")} · ${chatTimeLabel(message.sentAt)}`;
    row.append(body, meta);
    box.appendChild(row);
  }
  box.scrollTop = box.scrollHeight;
}
export function syncOnlineChatUI() {
  const {
    button,
    panel
  } = ensureOnlineChatUI();
  const battleScreenOpen = !!document.getElementById("game")?.classList.contains("active");
  const modalOpen = !!document.getElementById("modal")?.classList.contains("open");
  const directOnlineSession = !!(state_ui_deck.p2p?.connected && (battleScreenOpen || modalOpen));
  // 매칭/레이드 대기, 전투 중 일시 단절, 탭 복귀 재연결 중에도 채팅 UI를 숨기지 않는다.
  const persistentOnlineContext = !!((battleScreenOpen || modalOpen) && (state_ui_deck.p2p?.sessionMode === "matchmaking" || state_ui_deck.p2p?.sessionMode === "bossRaid" || state_ui_battle_state.game?.mode === "online" || state_ui_battle_state.game?.mode === "spectator" || !!state_ui_battle_state.game?.bossRaid?.online));
  const spectatorSession = !!(state_ui_battle_state.game?.mode === "spectator" && systems.__megaSpectatorR18?.isWatching?.());
  const spectatorHostSession = !!systems.__megaSpectatorR18?.canHostChat?.();
  const connectedSession = directOnlineSession || persistentOnlineContext || spectatorSession || spectatorHostSession;
  if (!connectedSession) onlineChatPanelOpen = false;
  document.body.classList.toggle("online-battle-chat-active", connectedSession);
  button.hidden = !connectedSession;
  button.style.display = connectedSession ? "grid" : "none";
  panel.hidden = !connectedSession || !onlineChatPanelOpen;
  if (!connectedSession) panel.style.display = "none";else panel.style.removeProperty("display");
  button.querySelector(".online-chat-unread")?.remove();
  if (onlineChatUnread > 0 && !onlineChatPanelOpen && connectedSession) {
    const badge = document.createElement("span");
    badge.className = "online-chat-unread";
    badge.textContent = onlineChatUnread > 9 ? "9+" : String(onlineChatUnread);
    button.appendChild(badge);
  }
  renderOnlineChatMessages();
  systems.SyncEngine?.ui?.ensureButton();
}
function addOnlineChatMessage(message) {
  if (!message) return false;
  const id = String(message.id || "");
  if (id && onlineChatMessages.some(item => String(item?.id || "") === id)) return false;
  onlineChatMessages.push(message);
  // Delivery/restore order is not presentation order. Every peer sorts the same
  // immutable message facts so late/retried packets converge to one transcript.
  onlineChatMessages.sort((a, b) => {
    const at = Number(a?.sentAt || 0),
      bt = Number(b?.sentAt || 0);
    if (at !== bt) return at - bt;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
  if (onlineChatMessages.length > 100) onlineChatMessages.splice(0, onlineChatMessages.length - 100);
  if (!message.mine && !onlineChatPanelOpen) onlineChatUnread++;
  syncOnlineChatUI();
  return true;
}
function onlineChatPopupContextActive() {
  return !!(document.getElementById("game")?.classList.contains("active") || document.getElementById("modal")?.classList.contains("open") || state_ui_deck.p2p?.sessionMode === "matchmaking" || state_ui_deck.p2p?.sessionMode === "bossRaid" || state_ui_battle_state.game?.mode === "online" || !!state_ui_battle_state.game?.bossRaid?.online);
}
function sendOnlineChat(text) {
  const value = String(text || "").trim().slice(0, 120);
  if (!value) return false;
  if (state_ui_battle_state.game?.mode === "spectator" && systems.__megaSpectatorR18?.sendChat) {
    return !!systems.__megaSpectatorR18.sendChat(value);
  }
  const queueableOnlineContext = !!(state_ui_deck.p2p?.sessionMode === "matchmaking" || state_ui_deck.p2p?.sessionMode === "bossRaid" || state_ui_battle_state.game?.mode === "online" || !!state_ui_battle_state.game?.bossRaid?.online);
  if (!onlineConnectionReady() && !queueableOnlineContext) {
    return !!systems.__megaSpectatorR18?.hostSendChat?.(value);
  }
  // 재연결 중 전송한 메시지도 버리지 않고 pending에 넣어 연결이 열리면 재전송한다.
  const id = `${onlinePacketMatchId()}:chat:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const packet = {
    type: "battleChat",
    matchId: onlinePacketMatchId(),
    id,
    text: value,
    sentAt: Date.now()
  };
  onlineChatSeen.add(id);
  onlineChatPending.set(id, {
    packet,
    lastSentAt: 0,
    attempts: 0
  });
  addOnlineChatMessage({
    id,
    text: packet.text,
    sentAt: packet.sentAt,
    mine: true,
    sender: "나"
  });
  if (onlineChatPopupContextActive()) showBattleChatPopup(packet.text, "나");
  if (state_ui_deck.p2p?.role === "host") {
    systems.__megaSpectatorR18?.hostBroadcastChat?.({
      id,
      text: packet.text,
      sentAt: packet.sentAt,
      senderId: "player-host",
      senderLabel: state_ui_battle_state.game?.bossRaid ? "레이드 호스트" : "플레이어 1"
    });
  }
  retryOnlineChats(true);
  return true;
}
function retryOnlineChats(force = false) {
  if (!onlineConnectionReady()) return;
  const now = Date.now();
  for (const pending of onlineChatPending.values()) {
    if (!force && now - pending.lastSentAt < 1000) continue;
    // 매칭 확정 전 임시 matchId로 큐에 들어간 메시지는 현재 matchId로 교정한다.
    pending.packet.matchId = onlinePacketMatchId();
    pending.lastSentAt = now;
    pending.attempts++;
    sendOnlinePacketSafe(pending.packet);
  }
}
function showBattleChatPopup(text, who = "상대") {
  const value = String(text || "").trim().slice(0, 120);
  if (!value) return;
  let stack = document.getElementById("battleChatPopupStack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "battleChatPopupStack";
    stack.className = "battle-chat-popup-stack";
    document.body.appendChild(stack);
  }
  const node = document.createElement("div");
  node.className = "battle-chat-popup";
  const label = document.createElement("b");
  label.textContent = who;
  const body = document.createElement("span");
  body.textContent = value;
  node.append(label, body);
  stack.appendChild(node);
  TimerManager.setTimeout(() => {
    node.remove();
    if (!stack.children.length) stack.remove();
  }, 2700);
}
function handleOnlineChatPacket(msg) {
  if (msg.type === "battleChat") {
    if (String(msg.matchId || "") && String(msg.matchId) !== onlinePacketMatchId()) return;
    const id = String(msg.id || "");
    if (!id) return;
    sendOnlinePacketSafe({
      type: "battleChatAck",
      matchId: onlinePacketMatchId(),
      id
    });
    if (onlineChatSeen.has(id)) return;
    onlineChatSeen.add(id);
    const text = String(msg.text || "").slice(0, 120);
    const sender = state_ui_battle_state.game?.bossRaid?.online || state_ui_deck.p2p?.sessionMode === "bossRaid" ? "레이드 동료" : "상대";
    addOnlineChatMessage({
      id,
      text,
      sentAt: Number(msg.sentAt || Date.now()),
      mine: false,
      sender
    });
    if (onlineChatPopupContextActive()) showBattleChatPopup(text, sender);
    if (state_ui_deck.p2p?.role === "host") {
      systems.__megaSpectatorR18?.hostBroadcastChat?.({
        id,
        text,
        sentAt: Number(msg.sentAt || Date.now()),
        senderId: "player-guest",
        senderLabel: state_ui_battle_state.game?.bossRaid ? "레이드 동료" : "플레이어 2"
      });
    }
  } else if (msg.type === "spectatorChatRelay") {
    if (String(msg.matchId || "") && String(msg.matchId) !== onlinePacketMatchId()) return;
    const id = String(msg.id || "");
    if (!id || onlineChatSeen.has(id)) return;
    onlineChatSeen.add(id);
    const text = String(msg.text || "").slice(0, 120),
      sender = String(msg.senderLabel || "관전자").slice(0, 24);
    addOnlineChatMessage({
      id,
      text,
      sentAt: Number(msg.sentAt || Date.now()),
      mine: false,
      sender
    });
    if (onlineChatPopupContextActive()) showBattleChatPopup(text, sender);
  } else if (msg.type === "battleChatAck") {
    onlineChatPending.delete(String(msg.id || ""));
  }
}
function ensureOnlineStateRetryTimer() {
  if (onlineStateRetryTimer) return onlineStateRetryTimer;
  onlineStateRetryTimer = systems.OnlineRuntime?.sessionScope?.setInterval?.(() => retryReliableOnlineState(false), 520, "reliable-state-retry", {
    phase: "SESSION"
  }) || null;
  return onlineStateRetryTimer;
}
function ensureOnlineChatRetryTimer() {
  if (onlineChatRetryTimer) return onlineChatRetryTimer;
  onlineChatRetryTimer = systems.OnlineRuntime?.sessionScope?.setInterval?.(() => retryOnlineChats(false), 760, "online-chat-retry", {
    phase: "SESSION"
  }) || null;
  return onlineChatRetryTimer;
}
function handleOnlineResiliencePacket(msg) {
  handleOnlineChatPacket(msg);
  if (msg.type === "stateAck" && state_ui_deck.p2p?.role === "host" && (state_ui_battle_state.game?.mode === "online" || state_ui_battle_state.game?.bossRaid?.online)) {
    if (msg.mode && msg.mode !== (state_ui_battle_state.game?.bossRaid?.online ? "BOSS_COOP" : "PVP")) return false;
    const incoming = String(msg.matchId || ""),
      local = String(state_ui_deck.p2p?.matchId || state_ui_battle_state.game?.matchId || "");
    const revision = Number(msg.revision || 0),
      latest = Number(state_ui_deck.p2p?.__reliableStatePacket?.revision || 0);
    if (!incoming || !local || incoming !== local || revision <= 0 || !latest || revision > latest) return false;
    state_ui_deck.p2p.visualDelivery?.acknowledge(msg.visualAckIds);
    state_ui_deck.p2p.__reliableStateAck = Math.max(Number(state_ui_deck.p2p.__reliableStateAck || 0), revision);
  }
}

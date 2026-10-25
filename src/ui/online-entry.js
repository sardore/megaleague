import { sessionRuntime } from "../online/session-model.js";
import { state_ui_battle_state } from "./battle-state.js";
import { state_ui_deck, onlineLeagueEntryHTML, bindOnlineLeagueEntryControls } from "./deck.js";
import { systems } from "../runtime/systems.js";
import { setEndpoint } from "../online/session-config.js";
import { copyPlainText } from "../online/connection.js";
import { failWithoutSession } from "../online/cleanup.js";
export function escapeAttribute(value) {
  return String(value || "").replace(/[&"<>]/g, char => ({
    "&": "&amp;",
    "\"": "&quot;",
    "<": "&lt;",
    ">": "&gt;"
  })[char]);
}
export function initializeUiOnlineEntry() {
  sessionRuntime.roomLinkPresetValue = sessionRuntime.clean(new URLSearchParams(location.search).get("room"), 12).toUpperCase();
  sessionRuntime.roomLinkPresetValid = /^[A-Z2-9]{6}$/.test(sessionRuntime.roomLinkPresetValue);
  sessionRuntime.entryIntentState = {
    source: sessionRuntime.roomLinkPresetValid ? "ROOM_LINK_URL" : "DIRECT_ENTRY",
    roomCode: sessionRuntime.roomLinkPresetValid ? sessionRuntime.roomLinkPresetValue : null,
    consumptionState: sessionRuntime.roomLinkPresetValid ? "UNCONSUMED" : "NONE",
    consumedAt: 0,
    switchedAt: 0,
    lastIntent: "INITIAL"
  };
  sessionRuntime.entryIntentSnapshot = () => Object.freeze({
    ...sessionRuntime.entryIntentState
  });
  sessionRuntime.returnOnlineRuntimeToSetup = (reason = "result-to-setup") => {
    const session = sessionRuntime.activeSession;
    if (session) {
      session.routesReady = false;
      if (session.machine.state === "IN_BATTLE") session.machine.transition("ENDING", reason);
      session.scope?.record?.("return-to-setup-begin", {
        reason
      });
      sessionRuntime.CleanupCoordinator.close(reason, {
        notify: true,
        keepUi: true,
        releaseActive: true,
        clearChat: false
      });
    }
    sessionRuntime.ProjectionTransaction.commitDetachedSetup(reason);
    return true;
  };
  sessionRuntime.UIControllerRuntime = Object.freeze({
    closeOwnedModal(reason = "global-modal-close") {
      if (!sessionRuntime.activeSession) return false;
      const modal = state_ui_battle_state.$("#modal");
      if (!modal?.classList?.contains("online-room-r22")) return false;
      return sessionRuntime.returnOnlineRuntimeToSetup(reason);
    },
    handleMainOnlineEntry(event) {
      event?.preventDefault?.();
      sessionRuntime.entryIntentState.lastIntent = "MAIN_ONLINE_BUTTON";
      return sessionRuntime.UIControllerRuntime.showEntry({
        source: "MAIN_ONLINE_BUTTON"
      });
    },
    showEntry(options = {}) {
      const root = document.getElementById("modalContent");
      if (!root) return false;
      const onlineLeague = state_ui_deck.LeagueFormatOwner.definition(state_ui_deck.leagueSelection);
      root.innerHTML = `<h2>온라인 대전</h2><p class="tiny muted">리그를 고른 뒤 같은 편성 규칙으로 매칭·방 대전을 진행합니다.</p>${onlineLeagueEntryHTML()}<div class="choice-list"><button id="openAutoMatch" class="primary">${onlineLeague.label} 자동 매칭</button><button id="openRoomCode">${onlineLeague.label} 방 코드 대전</button>${systems.__megaSpectatorR18 ? '<button id="openSpectatorList">진행 중 경기 관전</button>' : ""}</div><details style="margin-top:12px"><summary>온라인 연결 설정</summary><label class="tiny">WSS relay endpoint <input id="onlineRelayEndpoint" value="${escapeAttribute(sessionRuntime.configuredEndpoint)}" placeholder="wss://example.com/online" style="width:min(100%,430px)"></label><div class="choice-list" style="margin-top:8px"><button id="saveOnlineRelay">relay 주소 저장</button></div><p class="tiny muted">기본값은 CP32 공개 WSS relay입니다. 개발·대체 endpoint는 URL 또는 이 기기 설정으로만 덮어씁니다.</p></details><p data-online-runtime-status class="tiny"></p><p id="onlineRuntimeIdentity" class="tiny muted"></p>`;
      bindOnlineLeagueEntryControls(root);
      document.getElementById("openAutoMatch").onclick = event => {
        const button = event.currentTarget;
        if (button?.disabled) return false;
        if (button) {
          button.disabled = true;
          button.textContent = "매칭 중…";
          button.setAttribute("aria-busy", "true");
        }
        const started = sessionRuntime.MatchmakingCoordinator.start("PVP", {
          league: state_ui_deck.leagueSelection,
          composition: state_ui_deck.leagueSelection === "comprehensive" ? state_ui_deck.comprehensiveComposition : null
        });
        sessionRuntime.projectStatus();
        if (!started && button) {
          button.disabled = false;
          button.textContent = `${state_ui_deck.LeagueFormatOwner.definition(state_ui_deck.leagueSelection).label} 자동 매칭`;
          button.setAttribute("aria-busy", "false");
        }
        return started;
      };
      document.getElementById("openRoomCode").onclick = () => this.showRoom();
      const spectator = document.getElementById("openSpectatorList");
      if (spectator) spectator.onclick = () => systems.__megaSpectatorR18?.openLobby?.();
      document.getElementById("saveOnlineRelay").onclick = () => setEndpoint(document.getElementById("onlineRelayEndpoint").value, true);
      document.getElementById("modal")?.classList.add("open");
      sessionRuntime.projectStatus();
      return true;
    },
    consumeInitialIntent() {
      if (sessionRuntime.entryIntentState.consumptionState !== "UNCONSUMED" || !sessionRuntime.entryIntentState.roomCode) {
        return false;
      }
      sessionRuntime.entryIntentState.consumptionState = "AUTO_JOIN_CONSUMED";
      sessionRuntime.entryIntentState.consumedAt = Date.now();
      sessionRuntime.entryIntentState.lastIntent = "ROOM_LINK_AUTO_JOIN";
      this.showRoom(sessionRuntime.entryIntentState.roomCode, {
        intentSource: "ROOM_LINK_AUTO_JOIN"
      });
      return sessionRuntime.RoomCoordinator.join(sessionRuntime.entryIntentState.roomCode);
    },
    switchToAlternateMethod() {
      const roomCode = sessionRuntime.entryIntentState.roomCode;
      sessionRuntime.entryIntentState.consumptionState = "USER_DECLINED_OR_SWITCHED_METHOD";
      sessionRuntime.entryIntentState.switchedAt = Date.now();
      sessionRuntime.entryIntentState.lastIntent = "USER_SWITCHED_METHOD";
      if (sessionRuntime.activeSession) sessionRuntime.CleanupCoordinator.close("room-link-user-switched-method", {
        notify: true,
        keepUi: true,
        releaseActive: true
      });
      const shown = this.showEntry({
        source: "USER_SWITCHED_METHOD"
      });
      return shown;
    },
    manualJoin(roomCode) {
      const normalized = sessionRuntime.clean(roomCode, 12).toUpperCase();
      sessionRuntime.entryIntentState.lastIntent = "EXPLICIT_MANUAL_JOIN";
      return sessionRuntime.RoomCoordinator.join(normalized);
    },
    debugEntryIntent() {
      return sessionRuntime.entryIntentSnapshot();
    },
    showRoom(preset = "", options = {}) {
      const root = document.getElementById("modalContent");
      if (!root) return false;
      const roomLeague = state_ui_deck.LeagueFormatOwner.definition(state_ui_deck.leagueSelection),
        roomRule = state_ui_deck.LeagueFormatOwner.rulesText(state_ui_deck.leagueSelection, state_ui_deck.comprehensiveComposition);
      root.innerHTML = `<h2>${roomLeague.label} · 방 코드 대전</h2><p class="tiny muted">${roomRule} · 방장은 이 규칙으로 방을 생성하고 참가자는 연결 후 방장 규칙을 확인합니다.</p><div class="choice-list"><button id="p2pHost" class="primary">${roomLeague.label} 방 만들기</button><button id="p2pGuest">방 참가</button></div><div id="hostRoomBox" class="notice hidden"><b>방 코드</b><div id="roomCodeText" style="font-size:32px;font-weight:900;letter-spacing:7px;margin:8px 0">------</div><div class="choice-list"><button id="copyInviteLink" class="primary">초대 링크 복사</button><button id="regenerateRoomCode">새 코드 생성</button></div></div><div id="guestRoomBox" class="${preset ? "" : "hidden"}"><label>방 코드 <input id="roomCodeInput" maxlength="6" value="${escapeAttribute(preset)}" autocomplete="off" style="text-transform:uppercase;font-size:22px;letter-spacing:4px;width:180px"></label><button id="joinRoom" class="primary">참가</button></div><div class="choice-list" style="margin-top:12px"><button id="p2pDisconnect">연결 끊기</button><button id="roomBack">방식 선택</button></div><p id="p2pStatus" class="tiny"></p><p class="tiny muted">방 코드는 만들기 또는 새 코드 생성 버튼에서만 바뀝니다. transport 재시도·화면 전환·background resume에서는 바뀌지 않습니다.</p>`;
      document.getElementById("p2pHost").onclick = () => {
        document.getElementById("hostRoomBox").classList.remove("hidden");
        document.getElementById("guestRoomBox").classList.add("hidden");
        sessionRuntime.RoomCoordinator.create();
      };
      document.getElementById("p2pGuest").onclick = () => {
        document.getElementById("guestRoomBox").classList.remove("hidden");
        document.getElementById("hostRoomBox").classList.add("hidden");
      };
      document.getElementById("joinRoom").onclick = () => this.manualJoin(document.getElementById("roomCodeInput").value);
      document.getElementById("regenerateRoomCode").onclick = () => sessionRuntime.RoomCoordinator.regenerate();
      document.getElementById("copyInviteLink").onclick = async event => {
        event.preventDefault();
        const url = sessionRuntime.RoomCoordinator.inviteUrl();
        const text = url || sessionRuntime.activeSession?.roomCode || "";
        const copied = await copyPlainText(text);
        if (!copied) failWithoutSession("CLIPBOARD_BLOCKED", "초대 링크를 직접 복사하세요.");
      };
      document.getElementById("p2pDisconnect").onclick = () => {
        sessionRuntime.CleanupCoordinator.close("room-leave", {
          notify: true
        });
        sessionRuntime.projectStatus();
      };
      document.getElementById("roomBack").onclick = () => this.switchToAlternateMethod();
      document.getElementById("modal")?.classList.add("open");
      sessionRuntime.projectStatus();
      return true;
    },
    showMatchmaking(mode = "PVP") {
      if (mode !== "BOSS_COOP") {
        sessionRuntime.projectStatus();
        return true;
      }
      const root = document.getElementById("modalContent");
      if (!root) return false;
      root.innerHTML = `<h2>레이드 동료 탐색</h2><div class="matchmaking-box"><b id="matchmakingStatus" data-online-runtime-status></b><p class="tiny muted">레이드 협동 전용 매칭 · 던전 종류는 호스트가 대기실에서 정합니다</p><button id="cancelMatchmaking">매칭 취소</button></div>`;
      document.getElementById("cancelMatchmaking").onclick = () => sessionRuntime.MatchmakingCoordinator.cancel();
      document.getElementById("modal")?.classList.add("open");
      sessionRuntime.projectStatus();
      return true;
    },
    acceptLegacyStatus(text) {
      if (sessionRuntime.activeSession) sessionRuntime.activeSession.lastLegacyStatus = sessionRuntime.clean(text, 240);
      return sessionRuntime.projectStatus();
    }
  });
}

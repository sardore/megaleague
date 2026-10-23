import { TimerManager } from "../runtime/timers.js";
// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_ui_invaders = {
  invaderPortalIndex: undefined
};
import { state_catalog_cards } from "../catalog/cards.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "./battle-state.js";
import { pictogramHTML, state_ui_cards } from "./cards.js";
import { state_ui_deck } from "./deck.js";
import { renderSetup, updateDeckSetup, state_ui_setup } from "./setup.js";
export function initializeUiInvaders() {
  /* 제노사이더 시즌 인트로 · 초차원 포탈 · 전용 연출 보강 */
  state_ui_cards.CARD_EMOJI_MAP.genocider = ["💣", "☠️"];
  for (let i = state_ui_deck.MEGA_SETUP_IDS.length - 1; i >= 0; i--) if (isInvaderCardId(state_ui_deck.MEGA_SETUP_IDS[i])) state_ui_deck.MEGA_SETUP_IDS.splice(i, 1);
  /**
   * 모든 덱 선택 화면이 공유하는 초차원 포탈 뷰.
   * 화면별 코드는 선택 상태와 콜백만 넘기며, 포탈 마크업/활성 테두리/선택 모달은 여기서만 생성한다.
   */
  state_ui_battle_state.InvaderPortalView = class InvaderPortalView {
    static activeClass(selectedId) {
      return selectedId ? " portal-active-selection" : "";
    }
    static cardName(selectedId) {
      if (!selectedId) return "없음";
      return state_catalog_cards.CARDS.find(card => card.id === selectedId)?.name || selectedId;
    }
    static buttonHTML({
      buttonId,
      selectedId = null,
      areaClass = "invader-portal-area",
      areaId = ""
    }) {
      const safeId = String(selectedId || "");
      const idAttr = areaId ? ` id="${areaId}"` : "";
      return `<div${idAttr} class="${areaClass}" data-invader="${safeId}"><button id="${buttonId}" type="button" class="invader-portal-button${this.activeClass(safeId)}" data-invader="${safeId}"><span class="invader-portal-title">초차원 포탈</span><span class="invader-portal-state">현재 침략자: ${this.cardName(safeId)}</span></button></div>`;
    }
    static mountAfter(anchorElement, options) {
      if (!anchorElement) return null;
      const oldArea = options.areaId ? document.getElementById(options.areaId) : null;
      const holder = document.createElement("div");
      holder.innerHTML = this.buttonHTML(options);
      const area = holder.firstElementChild;
      if (oldArea) oldArea.replaceWith(area);else anchorElement.insertAdjacentElement("afterend", area);
      const button = area.querySelector(`#${options.buttonId}`);
      if (button && typeof options.onOpen === "function") button.onclick = options.onOpen;
      return area;
    }
    static sync(buttonId, selectedId = null) {
      const button = document.getElementById(buttonId);
      if (!button) return;
      const safeId = String(selectedId || "");
      button.dataset.invader = safeId;
      button.parentElement?.setAttribute("data-invader", safeId);
      button.classList.toggle("portal-active-selection", !!safeId);
      const state = button.querySelector(".invader-portal-state");
      if (state) state.textContent = `현재 침략자: ${this.cardName(safeId)}`;
    }
    static renderSelector({
      prefix,
      index = 0,
      selectedId = null,
      onIndex,
      onApply,
      onClear,
      onCancel,
      emptyButtonLabel = "대기실로 돌아가기"
    }) {
      const list = invaderCards();
      const root = document.getElementById("modalContent");
      if (!root) return 0;
      if (!list.length) {
        root.innerHTML = `<div class="invader-selector"><div class="invader-selector-head"><h2>초차원 포탈</h2></div><p>현재 선택 가능한 침략자가 없습니다.</p><button id="${prefix}EmptyBack">${emptyButtonLabel}</button></div>`;
        document.getElementById(`${prefix}EmptyBack`).onclick = onCancel;
        return 0;
      }
      const normalized = (Number(index) % list.length + list.length) % list.length;
      const card = list[normalized];
      const chosen = String(selectedId || "") === card.id;
      const previewClass = `invader-preview${chosen ? " portal-invader-selected" : ""}`;
      root.innerHTML = `<div class="invader-selector"><div class="invader-selector-head"><h2>초차원 포탈</h2><span class="invader-tag">침략자 ${normalized + 1}/${list.length}</span></div><div class="invader-carousel"><button id="${prefix}Prev" class="invader-arrow invader-prev" type="button" aria-label="이전 침략자">&lt;</button><div class="${previewClass}" data-card-id="${card.id}"><div class="invader-preview-top">${pictogramHTML("default", card.id)}<div><h3>${card.name} <span class="tiny">${card.grade}</span></h3><div class="invader-tag">${card.faction || "초차원의 침략자"}</div></div></div><div class="invader-preview-grid"><span>HP ${card.maxHp}</span><span>등급 ${card.grade}</span><span>최대E ${card.maxEnergy}</span></div><p><b>특성</b><br>${card.trait || "없음"}</p><div><b>기술</b>${invaderSkillSummary(card)}</div></div><button id="${prefix}Next" class="invader-arrow invader-next" type="button" aria-label="다음 침략자">&gt;</button></div><div class="invader-selector-actions"><button id="${prefix}Apply" class="primary" type="button">${chosen ? "선택 유지" : "적용"}</button><button id="${prefix}Clear" type="button" ${selectedId ? "" : "disabled"}>선택 해제</button><button id="${prefix}Cancel" type="button">취소</button></div></div>`;
      document.getElementById(`${prefix}Prev`).onclick = () => onIndex(normalized - 1);
      document.getElementById(`${prefix}Next`).onclick = () => onIndex(normalized + 1);
      document.getElementById(`${prefix}Apply`).onclick = () => onApply(card.id, normalized);
      document.getElementById(`${prefix}Clear`).onclick = onClear;
      document.getElementById(`${prefix}Cancel`).onclick = onCancel;
      return normalized;
    }
  };
  state_ui_invaders.invaderPortalIndex = 0;
  if (document.getElementById("deckCards")) {
    mountInvaderPortal();
    updateDeckSetup();
  }
  (function startGenociderSeasonIntro() {
    const intro = document.getElementById("genociderSeasonIntro");
    if (!intro) return;
    if (systems.__genociderSeasonIntroPlayed) {
      intro.remove();
      return;
    }
    systems.__genociderSeasonIntroPlayed = true;
    TimerManager.requestAnimationFrame(() => TimerManager.requestAnimationFrame(() => intro.classList.add("intro-running")));
    const normalTimer = TimerManager.setTimeout(finishGenociderSeasonIntro, 5900);
    const safetyTimer = TimerManager.setTimeout(finishGenociderSeasonIntro, 8200);
    intro.addEventListener("transitionend", () => {
      if (intro.dataset.finished === "1") {
        TimerManager.clear(normalTimer);
        TimerManager.clear(safetyTimer);
      }
    }, {
      once: true
    });
  })();
  if (state_ui_battle_state.$("#setup")?.classList.contains("active")) renderSetup(false);

  /* ================= 온라인 대기실·침략자 포탈·동전 단일화 최종 보강 ================= */
}
export function isInvaderCardId(id) {
  const c = state_catalog_cards.CARDS.find(x => x.id === id);
  return !!c?.tags?.includes("transdimensional-invader");
}
export function invaderCards() {
  return state_catalog_cards.CARDS.filter(c => c?.tags?.includes("transdimensional-invader"));
}
export function sanitizeSelectedInvaders() {
  return state_ui_setup.DeckDraftApplication.sanitizeInvaders();
}
export function currentSelectedInvader() {
  return state_ui_battle_state.selected.find(isInvaderCardId) || null;
}
export function syncInvaderPortalState() {
  if (!state_ui_battle_state.InvaderPortalView) return;
  state_ui_battle_state.InvaderPortalView.sync("invaderPortalButton", currentSelectedInvader());
}
export function mountInvaderPortal() {
  if (!state_ui_battle_state.InvaderPortalView) return;
  document.querySelectorAll('#deckCards [data-card-id="genocider"]').forEach(x => x.remove());
  const area = document.getElementById("invaderPortalArea");
  if (!state_ui_deck.LeagueFormatOwner.invaderAllowed(state_ui_deck.leagueSelection, state_ui_deck.comprehensiveComposition)) {
    area?.remove();
    return;
  }
  const deckCards = document.getElementById("deckCards");
  if (!deckCards) return;
  state_ui_battle_state.InvaderPortalView.mountAfter(deckCards, {
    areaId: "invaderPortalArea",
    areaClass: "invader-portal-area",
    buttonId: "invaderPortalButton",
    selectedId: currentSelectedInvader(),
    onOpen: openInvaderPortal
  });
}
export function invaderSkillSummary(c) {
  return (c?.skills || []).map(s => `<div class="invader-skill-row"><b>${s.name}</b> <span class="cost">${s.cost || "Cost 없음"}</span><div class="tiny">${s.desc || ""}</div></div>`).join("");
}
export function renderInvaderPortalModal() {
  state_ui_invaders.invaderPortalIndex = state_ui_battle_state.InvaderPortalView.renderSelector({
    prefix: "invaderPortalMain",
    index: state_ui_invaders.invaderPortalIndex,
    selectedId: currentSelectedInvader(),
    onIndex: next => {
      state_ui_invaders.invaderPortalIndex = next;
      renderInvaderPortalModal();
    },
    onApply: id => applyInvaderFromPortal(id),
    onClear: clearInvaderSelection,
    onCancel: () => document.getElementById("modal").classList.remove("open"),
    emptyButtonLabel: "닫기"
  });
}
export function openInvaderPortal() {
  const list = invaderCards(),
    current = currentSelectedInvader();
  state_ui_invaders.invaderPortalIndex = Math.max(0, list.findIndex(c => c.id === current));
  renderInvaderPortalModal();
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function finishInvaderApply() {
  sanitizeSelectedInvaders();
  updateDeckSetup();
  syncInvaderPortalState();
  state_ui_battle_state.$("#modal").classList.remove("open");
}
export function applyInvaderFromPortal(id) {
  const application = state_ui_setup.DeckDraftApplication.applyInvader(id);
  if (application.applied) {
    finishInvaderApply();
    return;
  }
  if (!application.needsReplacement) return;
  const c = state_catalog_cards.CARDS.find(x => x.id === id);
  state_ui_battle_state.$("#modalContent").innerHTML = `<div class="invader-selector"><h2>${c.name} 적용</h2><p>덱이 가득 찼습니다. 교체할 카드를 선택하세요.</p><div class="invader-replace-list">${state_ui_battle_state.selected.map((sid, i) => {
    const sc = state_catalog_cards.CARDS.find(x => x.id === sid);
    return `<button type="button" data-invader-replace="${i}">${sc?.name || sid} 교체</button>`;
  }).join("")}</div><div class="invader-selector-actions"><button id="invaderReplaceCancel" type="button">취소</button></div></div>`;
  document.querySelectorAll("[data-invader-replace]").forEach(b => b.onclick = () => {
    const i = Number(b.dataset.invaderReplace);
    if (!Number.isInteger(i) || i < 0 || i >= state_ui_battle_state.selected.length) return;
    if (!state_ui_setup.DeckDraftApplication.replaceAt(i, id)) return;
    finishInvaderApply();
  });
  state_ui_battle_state.$("#invaderReplaceCancel").onclick = openInvaderPortal;
}
export function clearInvaderSelection() {
  state_ui_setup.DeckDraftApplication.clearInvaders();
  finishInvaderApply();
}
export function createGenoSiphonParticles(host, power = 1, extraClass = "") {
  if (!host) return null;
  const wrap = document.createElement("div");
  wrap.className = extraClass || "geno-devour-absorb";
  wrap.style.setProperty("--geno-power", String(Math.max(0, Number(power) || 0)));
  const count = Math.max(7, 8 + Math.round((Number(power) || 0) * 5));
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    p.className = "geno-siphon-particle";
    p.style.setProperty("--p-angle", `${Math.round(360 / count * i + i % 3 * 9)}deg`);
    p.style.setProperty("--p-distance", `${34 + i % 4 * 9 + (Number(power) || 0) * 8}px`);
    p.style.setProperty("--p-delay", `${i % 5 * .025}s`);
    p.style.setProperty("--p-time", `${.48 + i % 4 * .055}s`);
    p.style.setProperty("--p-size", `${5 + i % 3 * 2}px`);
    wrap.appendChild(p);
  }
  host.appendChild(wrap);
  return wrap;
}
export function finishGenociderSeasonIntro() {
  const intro = document.getElementById("genociderSeasonIntro");
  if (!intro || intro.dataset.finished === "1") return;
  intro.dataset.finished = "1";
  intro.classList.add("intro-ending");
  TimerManager.setTimeout(() => intro.remove(), 1020);
}

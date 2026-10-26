import { TimerManager } from "../runtime/timers.js";
// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_ui_invaders = {
  invaderPortalIndex: undefined
};
import { state_catalog_cards } from "../catalog/cards.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "./battle-state.js";
import { pictogramHTML } from "./cards.js";
import { state_ui_deck } from "./deck.js";
import { renderSetup, updateDeckSetup, state_ui_setup } from "./setup.js";
import { characterTileClass, characterTileInner, morphTile, syncTileGrid, tileStarsHTML } from "./tiles.js";
export function initializeUiInvaders() {
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
    /* 포탈은 다른 선택 타일과 같은 정사각형 타일이다. 비어 있으면 포탈 문양, 침략자를 고르면 그 캐릭터가 같은 칸에 나타난다. */
    static tileElement({
      buttonId,
      selectedId = null,
      slotIndex = -1,
      onOpen
    }) {
      const card = selectedId ? state_catalog_cards.CARDS.find(c => c.id === selectedId) : null;
      const tile = document.createElement("div");
      tile.id = buttonId;
      tile.setAttribute("role", "button");
      tile.tabIndex = 0;
      tile.dataset.portalTile = "1";
      tile.dataset.tileKey = "__portal";
      tile.dataset.invader = card ? card.id : "";
      tile.dataset.cardId = card ? card.id : "";
      tile.title = card ? `초차원 포탈 · ${card.name}` : "초차원 포탈";
      tile.className = card ? characterTileClass(card, null, "portal-tile", "selected") : "char-tile portal-tile portal-empty";
      tile.innerHTML = card ? characterTileInner(card, null, {
        slotIndex
      }) : `<i class="tile-gold" aria-hidden="true"></i><div class="tile-art"><i class="portal-glyph"></i></div><span class="tile-stars"></span><i class="tile-order"></i><div class="tile-corner"></div><b class="tile-name">초차원 포탈</b>`;
      tile.onclick = onOpen || null;
      tile.onkeydown = event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          tile.onclick?.(event);
        }
      };
      return tile;
    }
    static ensureTile(grid, options) {
      if (!grid) return null;
      const old = grid.querySelector(":scope > [data-portal-tile]");
      const neu = this.tileElement(options);
      if (!old) {
        grid.prepend(neu);
        return neu;
      }
      morphTile(old, neu);
      if (grid.firstElementChild !== old) grid.prepend(old);
      return old;
    }
    static removeTile(grid) {
      grid?.querySelector(":scope > [data-portal-tile]")?.remove();
    }
    static sync(buttonId, selectedId = null, slotIndex = -1) {
      const tile = document.getElementById(buttonId);
      if (!tile?.dataset.portalTile) return;
      morphTile(tile, this.tileElement({
        buttonId,
        selectedId,
        slotIndex,
        onOpen: tile.onclick
      }));
    }
    /* 선택창: 침략자도 같은 정사각형 타일. 타일을 누르면 아래 상세가 바뀌고, 적용하면 포탈 타일에 그 캐릭터가 나타난다. */
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
      const detailHTML = `<div class="invader-preview${chosen ? " portal-invader-selected" : ""}" data-card-id="${card.id}"><div class="invader-stage"><i class="portal-ring r1"></i><i class="portal-ring r2"></i><i class="portal-ring r3"></i><i class="portal-core"></i><div class="invader-art">${pictogramHTML("default", card.id)}</div></div><div class="invader-name"><h3>${card.name}</h3>${tileStarsHTML(card.grade)}<div class="invader-tag">${card.faction || "초차원의 침략자"}</div></div><div class="invader-preview-grid"><span><i>HP</i><b>${card.maxHp}</b></span><span><i>최대E</i><b>${card.maxEnergy}</b></span></div><section class="invader-sec"><h4>특성</h4><p>${card.trait || "없음"}</p></section><section class="invader-sec"><h4>기술</h4>${invaderSkillSummary(card)}</section></div>`;
      const actionsHTML = `<button id="${prefix}Apply" class="primary" type="button">${chosen ? "선택 유지" : "적용"}</button><button id="${prefix}Clear" type="button" ${selectedId ? "" : "disabled"}>선택 해제</button><button id="${prefix}Cancel" type="button">취소</button>`;
      const tiles = list.map((c, k) => {
        const tile = document.createElement("div");
        const applied = String(selectedId || "") === c.id;
        tile.className = characterTileClass(c, null, "invader-pick", applied ? "selected" : "", k === normalized ? "focused" : "");
        tile.dataset.tileKey = c.id;
        tile.dataset.cardId = c.id;
        tile.setAttribute("role", "button");
        tile.tabIndex = 0;
        tile.innerHTML = characterTileInner(c, null);
        tile.onclick = () => onIndex(k);
        tile.onkeydown = event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onIndex(k);
          }
        };
        return tile;
      });
      let shell = root.querySelector(`.invader-selector[data-prefix="${prefix}"]`);
      if (shell) {
        /* 같은 선택창이 열려 있으면 타일은 그대로 두고 상세·강조만 바꾼다. */
        syncTileGrid(shell.querySelector(".invader-tile-grid"), tiles);
        shell.querySelector(".invader-detail").innerHTML = detailHTML;
        shell.querySelector(".invader-selector-actions").innerHTML = actionsHTML;
      } else {
        root.innerHTML = `<div class="invader-selector" data-prefix="${prefix}"><div class="invader-selector-head"><h2>초차원 포탈</h2><span class="invader-tag">침략자 ${list.length}명</span></div><div class="invader-tile-grid cards-grid"></div><div class="invader-detail">${detailHTML}</div><div class="invader-selector-actions">${actionsHTML}</div></div>`;
        shell = root.querySelector(".invader-selector");
        shell.querySelector(".invader-tile-grid").replaceChildren(...tiles);
      }
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
  state_ui_battle_state.InvaderPortalView.sync("invaderPortalButton", currentSelectedInvader(), state_ui_battle_state.selected.indexOf(currentSelectedInvader()));
}
export function mountInvaderPortal() {
  if (!state_ui_battle_state.InvaderPortalView) return;
  document.querySelectorAll('#deckCards [data-card-id="genocider"]:not([data-portal-tile])').forEach(x => x.remove());
  const deckCards = document.getElementById("deckCards");
  if (!deckCards) return;
  if (!state_ui_deck.LeagueFormatOwner.invaderAllowed(state_ui_deck.leagueSelection, state_ui_deck.comprehensiveComposition)) {
    state_ui_battle_state.InvaderPortalView.removeTile(deckCards);
    return;
  }
  state_ui_battle_state.InvaderPortalView.ensureTile(deckCards, {
    buttonId: "invaderPortalButton",
    selectedId: currentSelectedInvader(),
    slotIndex: state_ui_battle_state.selected.indexOf(currentSelectedInvader()),
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

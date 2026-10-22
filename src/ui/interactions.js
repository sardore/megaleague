import { TimerManager } from "../runtime/timers.js";
import { unitAt } from "../engine/actions.js";
import { findUnit } from "../engine/combat.js";
import { energyStore, spendPaymentPlan } from "../engine/energy.js";
import { vortexEnergySlots } from "../features/summons.js";
import { systems } from "../runtime/systems.js";
import { energyAmountText, state_ui_battle_state } from "./battle-state.js";
import { state_ui_deck } from "./deck.js";
import { executeChosenPlayerAction } from "./payment.js";
export function initializeUiInteractions() {
  VERSION = "requested-interaction-fix-r25";
  countsEqual = (left, right) => ["R", "W", "B"].every(color => Math.abs(Number(left?.[color] || 0) - Number(right?.[color] || 0)) < .001);
  energyToken = entry => `${entry.c}${Number(entry.a) === .5 ? "½" : ""}`;
  activeChoiceTarget = null;
  systems.__interactionChoiceR25 = Object.freeze({
    openAbyssCannonChoice: openAbyssCannonChoiceR25,
    openVortexEditor: openVortexEditorR25,
    beforeTarget(targetRef) {
      activeChoiceTarget = targetRef ? {
        ...targetRef
      } : null;
    },
    afterTarget() {
      paintChoiceTarget();
      TimerManager.requestAnimationFrame(paintChoiceTarget);
    },
    clearTarget: clearChoiceTarget
  });
  new MutationObserver(() => {
    const modal = document.getElementById("modal");
    if (modal && !modal.classList.contains("open")) clearChoiceTarget();
  }).observe(document.getElementById("modal"), {
    attributes: true,
    attributeFilter: ["class"]
  });
  onlineLobbyScrollMemory = new Map();
  onlineLobbyFullRenderUntil = 0;
  onlineLobbyRestoreSerial = 0;
  document.addEventListener("scroll", event => {
    const target = event.target,
      mode = target?.id === "onlineRoomDeck" ? "standard" : target?.id === "bossDeckGrid" && state_ui_deck.p2p?.sessionMode === "bossRaid" ? "boss" : onlineLobbyPickerMode();
    if (!mode) return;
    const memory = onlineLobbyMemory(mode);
    if (target?.id === "onlineRoomDeck" || target?.id === "bossDeckGrid") memory.grid = Math.max(0, Number(target.scrollTop) || 0);else if (target?.classList?.contains("modalbox")) memory.modal = Math.max(0, Number(target.scrollTop) || 0);else if (target?.id === "modalContent") memory.content = Math.max(0, Number(target.scrollTop) || 0);
  }, {
    capture: true,
    passive: true
  });
  document.addEventListener("click", event => {
    if (event.target?.closest?.("#onlineRoomDeck .form-toggle")) {
      captureOnlineLobbyScroll("standard");
      onlineLobbyFullRenderUntil = performance.now() + 700;
    }
  }, true);
  document.getElementById("closeModal")?.addEventListener("click", event => {
    const back = onlineLobbyPortalBackButton();
    if (!back) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const snapshot = captureOnlineLobbyScroll(back.mode) || onlineLobbyMemory(back.mode);
    back.button.click();
    document.getElementById("modal")?.classList.add("open");
    restoreOnlineLobbyScroll(back.mode, snapshot);
  }, true);
}
let VERSION;
let countsEqual;
let energyToken;
function openAbyssCannonChoiceR25(actions) {
  const [team, slot] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn];
  const actor = unitAt(state_ui_battle_state.game, team, slot);
  if (!actor || !actions?.length) return;
  const part = actions[0].actor || null;
  const store = energyStore(actor, part);
  const picked = new Set();
  const root = document.getElementById("modalContent");
  root.innerHTML = `<h2>초저주포 · 에너지 선택</h2>
      <p>지불할 에너지를 바로 고르세요. 선택한 실제 에너지 수가 곧 코스트가 됩니다.</p>
      <div id="abyssDirectEnergy" class="energy abyss-direct-energy"></div>
      <div id="abyssDirectPreview" class="effect-box"></div>
      <div class="choice-list">
        <button id="abyssDirectConfirm" class="primary">이 에너지로 사용</button>
        <button id="abyssDirectClear">선택 해제</button>
        <button id="abyssDirectCancel">취소</button>
      </div>`;
  const box = root.querySelector("#abyssDirectEnergy");
  const preview = root.querySelector("#abyssDirectPreview");
  const confirm = root.querySelector("#abyssDirectConfirm");
  const selectedCounts = () => {
    const result = {
      R: 0,
      W: 0,
      B: 0
    };
    for (const index of picked) result[store[index].c] += Number(store[index].a || 0);
    return result;
  };
  const refresh = () => {
    const counts = selectedCounts();
    const total = counts.R + counts.W + counts.B;
    const matching = actions.filter(action => Math.abs(Number(action.baseCostCount || 0) - total) < .001 && countsEqual(action.paymentPlan, counts));
    const chosen = matching[0] || null;
    const poison = counts.R > 0 && counts.W > 0 && counts.B > 0;
    const damage = chosen ? Math.max(0, 100 - 40 * (4 - Number(chosen.baseCostCount || 0))) : 0;
    preview.textContent = chosen ? `선택 ${total}E · ${damage}D${poison ? " · 독 부여" : ""}` : `선택 ${total}E · 사용할 수 없는 조합입니다. 0~4E의 실제 에너지를 고르세요.`;
    confirm.disabled = !chosen;
    return {
      chosen,
      counts
    };
  };
  store.forEach((entry, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `e ${entry.c} abyss-energy-chip`;
    button.textContent = energyToken(entry);
    button.onclick = () => {
      picked.has(index) ? picked.delete(index) : picked.add(index);
      button.classList.toggle("chosen", picked.has(index));
      refresh();
    };
    box.appendChild(button);
  });
  if (!store.length) box.innerHTML = `<span class="muted">보유 에너지 없음 · 0E로 사용할 수 있습니다.</span>`;
  confirm.onclick = () => {
    const {
      chosen,
      counts
    } = refresh();
    if (chosen) executeChosenPlayerAction({
      ...chosen,
      paymentPlan: {
        ...counts
      }
    });
  };
  root.querySelector("#abyssDirectClear").onclick = () => {
    picked.clear();
    box.querySelectorAll(".chosen").forEach(node => node.classList.remove("chosen"));
    refresh();
  };
  root.querySelector("#abyssDirectCancel").onclick = () => document.getElementById("modal").classList.remove("open");
  refresh();
  document.getElementById("modal").classList.add("open");
}
function openVortexEditorR25(actions, plan) {
  const pairActions = new Map();
  for (const action of actions || []) {
    const key = (action.vortexTargets || []).slice().sort().join("/");
    if (key && !pairActions.has(key)) pairActions.set(key, action);
  }
  const units = [...state_ui_battle_state.game.teams.P.field, ...state_ui_battle_state.game.teams.A.field].filter(unit => unit && !unit.dead);
  let firstUid = null;
  let secondUid = null;
  let slotsA = [];
  let slotsB = [];
  let chosenA = null;
  let chosenB = null;
  let swaps = [];
  let vortexMessage = "";
  const root = document.getElementById("modalContent");
  root.innerHTML = `<h2>심해의 소용돌이</h2>
      <p>캐릭터 두 명을 고르고, 왼쪽과 오른쪽에서 에너지를 하나씩 눌러 색을 교환하세요. 선택된 대상과 에너지는 테두리로 계속 표시됩니다.</p>
      <div id="vortexTargets"></div>
      <div id="vortexEditorBody"></div>
      <div class="choice-list"><button id="vortexCancel">취소</button></div>`;
  const targetBox = root.querySelector("#vortexTargets");
  const body = root.querySelector("#vortexEditorBody");
  const [actingTeam, actingSlot] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    actingUnit = unitAt(state_ui_battle_state.game, actingTeam, actingSlot);
  const cloneSlots = unit => {
    if (!unit) return [];
    if (unit.uid !== actingUnit?.uid) return vortexEnergySlots(unit).map(entry => ({
      ...entry
    }));
    /*
     * 소용돌이의 B 코스트를 먼저 지불한 뒤의 슬롯을 미리 보여 준다.
     * 지불될 B를 선택했다가 실행 시 인덱스가 밀리는 불일치를 막는다.
     */
    const previewUnit = {
      ...unit,
      energy: (unit.energy || []).map(entry => ({
        ...entry
      }))
    };
    spendPaymentPlan(previewUnit, plan || {
      R: 0,
      W: 0,
      B: 0
    }, null);
    return vortexEnergySlots(previewUnit).map(entry => ({
      ...entry,
      uid: unit.uid
    }));
  };
  const resetEnergyEditor = () => {
    const first = findUnit(state_ui_battle_state.game, firstUid);
    const second = findUnit(state_ui_battle_state.game, secondUid);
    slotsA = first ? cloneSlots(first) : [];
    slotsB = second ? cloneSlots(second) : [];
    chosenA = null;
    chosenB = null;
    swaps = [];
    vortexMessage = "";
  };
  const pairMarks = () => {
    const marksA = new Map();
    const marksB = new Map();
    swaps.forEach((swap, index) => {
      marksA.set(swap.aIndex, index + 1);
      marksB.set(swap.bIndex, index + 1);
    });
    return {
      marksA,
      marksB
    };
  };
  const drawTargets = () => {
    targetBox.innerHTML = "";
    units.forEach(unit => {
      const order = unit.uid === firstUid ? "1" : unit.uid === secondUid ? "2" : "";
      const button = document.createElement("button");
      button.type = "button";
      button.className = `vortex-target-card${order ? " chosen" : ""}`;
      button.dataset.order = order;
      const visibleEnergy = cloneSlots(unit).reduce((total, entry) => total + Number(entry.a || 0), 0);
      button.innerHTML = `<b>${unit.name}</b><br><span class="tiny">${energyAmountText(visibleEnergy)}E</span>`;
      button.onclick = () => {
        if (unit.uid === firstUid) {
          firstUid = secondUid;
          secondUid = null;
        } else if (unit.uid === secondUid) {
          secondUid = null;
        } else if (!firstUid) {
          firstUid = unit.uid;
        } else if (!secondUid) {
          secondUid = unit.uid;
        } else {
          firstUid = secondUid;
          secondUid = unit.uid;
        }
        resetEnergyEditor();
        drawTargets();
        drawEditor();
      };
      targetBox.appendChild(button);
    });
  };
  const addSwapIfReady = () => {
    if (chosenA == null || chosenB == null) return;
    const left = slotsA[chosenA];
    const right = slotsB[chosenB];
    if (!left || !right) return;
    const reused = swaps.some(swap => swap.aIndex === chosenA || swap.bIndex === chosenB);
    if (reused) {
      vortexMessage = "이미 교환한 슬롯입니다. 파란 테두리 슬롯을 눌러 먼저 교환을 취소하세요.";
      chosenA = null;
      chosenB = null;
      return;
    }
    const beforeA = left.c;
    const beforeB = right.c;
    if (beforeA === beforeB) {
      vortexMessage = "같은 색끼리는 바뀌는 값이 없어 교환에 포함하지 않습니다.";
      chosenA = null;
      chosenB = null;
      return;
    }
    left.c = beforeB;
    right.c = beforeA;
    swaps.push({
      aIndex: chosenA,
      bIndex: chosenB,
      beforeA,
      beforeB,
      refs: [{
        uid: left.uid,
        actor: left.actor || null,
        index: left.index
      }, {
        uid: right.uid,
        actor: right.actor || null,
        index: right.index
      }]
    });
    chosenA = null;
    chosenB = null;
    vortexMessage = `교환 ${swaps.length}쌍이 선택되었습니다.`;
  };
  const undoSwapAt = index => {
    const swap = swaps[index];
    if (!swap) return;
    if (slotsA[swap.aIndex]) slotsA[swap.aIndex].c = swap.beforeA;
    if (slotsB[swap.bIndex]) slotsB[swap.bIndex].c = swap.beforeB;
    swaps.splice(index, 1);
    chosenA = null;
    chosenB = null;
    vortexMessage = swaps.length ? `교환 ${swaps.length}쌍이 남았습니다.` : "선택한 교환을 모두 취소했습니다.";
  };
  const drawEnergyButtons = (box, entries, side, marks) => {
    box.innerHTML = "";
    entries.forEach((entry, index) => {
      const chosen = side === "A" ? chosenA === index : chosenB === index;
      const pairNumber = marks.get(index);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `e ${entry.c} vortex-energy-chip${chosen ? " chosen" : ""}${pairNumber ? " paired" : ""}`;
      button.textContent = energyToken(entry);
      if (pairNumber) button.dataset.pair = String(pairNumber);
      button.onclick = () => {
        if (pairNumber) {
          undoSwapAt(pairNumber - 1);
          drawEditor();
          return;
        }
        if (side === "A") chosenA = chosenA === index ? null : index;else chosenB = chosenB === index ? null : index;
        addSwapIfReady();
        drawEditor();
      };
      box.appendChild(button);
    });
    if (!entries.length) box.innerHTML = `<span class="muted">에너지 없음</span>`;
  };
  function drawEditor() {
    if (!firstUid || !secondUid) {
      body.innerHTML = `<p class="muted">첫 번째와 두 번째 캐릭터를 선택하세요.</p>`;
      return;
    }
    const first = findUnit(state_ui_battle_state.game, firstUid);
    const second = findUnit(state_ui_battle_state.game, secondUid);
    if (!first || !second) return;
    body.innerHTML = `<div class="vortex-pair-editor">
          <section class="vortex-energy-side"><h3>1 · ${first.name}</h3><div id="vortexEnergyA" class="vortex-energy-list"></div></section>
          <section class="vortex-energy-side"><h3>2 · ${second.name}</h3><div id="vortexEnergyB" class="vortex-energy-list"></div></section>
        </div>
        <div id="vortexPreview" class="effect-box">${vortexMessage || `색 교환 ${swaps.length}회`}</div>
        <div class="choice-list">
          <button id="vortexUndo"${swaps.length ? "" : " disabled"}>마지막 교환 취소</button>
          <button id="vortexDone" class="primary">완료</button>
        </div>`;
    const {
      marksA,
      marksB
    } = pairMarks();
    drawEnergyButtons(body.querySelector("#vortexEnergyA"), slotsA, "A", marksA);
    drawEnergyButtons(body.querySelector("#vortexEnergyB"), slotsB, "B", marksB);
    body.querySelector("#vortexUndo").onclick = () => {
      undoSwapAt(swaps.length - 1);
      drawEditor();
    };
    body.querySelector("#vortexDone").onclick = () => {
      const key = [firstUid, secondUid].sort().join("/");
      const action = pairActions.get(key);
      if (!action) return;
      executeChosenPlayerAction({
        ...action,
        paymentPlan: {
          ...(plan || action.paymentPlan || {
            R: 0,
            W: 0,
            B: 0
          })
        },
        vortexTargets: [firstUid, secondUid],
        vortexSwaps: swaps.map(swap => swap.refs.map(ref => ({
          ...ref
        })))
      });
    };
  }
  root.querySelector("#vortexCancel").onclick = () => document.getElementById("modal").classList.remove("open");
  drawTargets();
  drawEditor();
  document.getElementById("modal").classList.add("open");
}
let activeChoiceTarget;
let onlineLobbyScrollMemory;
let onlineLobbyFullRenderUntil;
let onlineLobbyRestoreSerial;
function onlineLobbySessionKey(mode) {
  const id = state_ui_deck.p2p?.matchId || state_ui_deck.p2p?.roomCode || state_ui_deck.p2p?.queueEntryId || state_ui_deck.p2p?.playerId || "pending";
  return `${mode}:${String(id)}`;
}
function onlineLobbyMemory(mode) {
  const key = onlineLobbySessionKey(mode);
  if (!onlineLobbyScrollMemory.has(key)) onlineLobbyScrollMemory.set(key, {
    grid: 0,
    modal: 0,
    content: 0
  });
  return onlineLobbyScrollMemory.get(key);
}
function onlineLobbyPickerMode() {
  if (document.getElementById("onlineRoomDeck")) return "standard";
  if (document.getElementById("bossDeckGrid") && state_ui_deck.p2p?.sessionMode === "bossRaid") return "boss";
  return null;
}
function onlineLobbyGrid(mode) {
  return document.getElementById(mode === "boss" ? "bossDeckGrid" : "onlineRoomDeck");
}
export function captureOnlineLobbyScroll(mode = onlineLobbyPickerMode()) {
  if (!mode) return null;
  const memory = onlineLobbyMemory(mode),
    grid = onlineLobbyGrid(mode),
    modalBox = document.querySelector("#modal .modalbox"),
    content = document.getElementById("modalContent");
  if (grid?.isConnected) memory.grid = Math.max(0, Number(grid.scrollTop) || 0);
  if (modalBox?.isConnected) memory.modal = Math.max(0, Number(modalBox.scrollTop) || 0);
  if (content?.isConnected) memory.content = Math.max(0, Number(content.scrollTop) || 0);
  return {
    ...memory
  };
}
export function restoreOnlineLobbyScroll(mode, snapshot = null) {
  if (!mode) return false;
  const memory = snapshot || onlineLobbyMemory(mode),
    token = ++onlineLobbyRestoreSerial;
  const apply = () => {
    if (token !== onlineLobbyRestoreSerial || onlineLobbyPickerMode() !== mode) return false;
    const grid = onlineLobbyGrid(mode),
      modalBox = document.querySelector("#modal .modalbox"),
      content = document.getElementById("modalContent");
    if (grid) grid.scrollTop = Math.min(Number(memory.grid) || 0, Math.max(0, grid.scrollHeight - grid.clientHeight));
    if (modalBox) modalBox.scrollTop = Math.min(Number(memory.modal) || 0, Math.max(0, modalBox.scrollHeight - modalBox.clientHeight));
    if (content) content.scrollTop = Math.min(Number(memory.content) || 0, Math.max(0, content.scrollHeight - content.clientHeight));
    return true;
  };
  apply();
  TimerManager.requestAnimationFrame(() => {
    apply();
    TimerManager.requestAnimationFrame(apply);
  });
  return true;
}
function onlineLobbyPortalBackButton() {
  const root = document.getElementById("modalContent");
  if (!root) return null;
  const standard = root.querySelector("#onlineInvaderReplaceCancel,#invaderPortalOnlineCancel,#invaderPortalOnlineEmptyBack");
  if (standard) return {
    mode: "standard",
    button: standard
  };
  if (state_ui_deck.p2p?.connected && state_ui_deck.p2p?.sessionMode === "bossRaid" && !state_ui_deck.p2p?.battleStarted) {
    const boss = root.querySelector("#bossInvaderReplaceCancel,#invaderPortalBossCancel,#invaderPortalBossEmptyBack");
    if (boss) return {
      mode: "boss",
      button: boss
    };
  }
  return null;
}
export function paintChoiceTarget() {
  document.querySelectorAll(".choice-target-selected").forEach(node => node.classList.remove("choice-target-selected"));
  const modal = document.getElementById("modal");
  if (!activeChoiceTarget || !modal?.classList.contains("open")) return;
  const ref = activeChoiceTarget;
  const uid = ref.uid != null && systems.CSS?.escape ? CSS.escape(String(ref.uid)) : null;
  let target = uid ? document.querySelector(`.battle-unit-card[data-uid="${uid}"],.summon-card[data-uid="${uid}"]`) : null;
  if (!target && ref.team != null && ref.slot != null) {
    target = document.querySelector(`.battle-unit-card[data-zone="field"][data-team="${ref.team}"][data-slot="${ref.slot}"]`) || document.querySelector(`.slot[data-slotteam="${ref.team}"][data-slotindex="${ref.slot}"]`);
  }
  target?.classList.add("choice-target-selected");
}
export function clearChoiceTarget() {
  activeChoiceTarget = null;
  document.querySelectorAll(".choice-target-selected").forEach(node => node.classList.remove("choice-target-selected"));
}

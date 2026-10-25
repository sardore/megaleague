import { state_runtime_presentation } from "../runtime/presentation.js";
import { state_runtime_state } from "../runtime/state.js";
import { paintChoiceTarget } from "./interactions.js";
import { timeClockVisualSaturation } from "../presentation/clock-saturation.js";
import { renderRaidBattleStatus } from "../features/boss-raid.js";
import { specDecorateBattle } from "../features/spectators.js";
import { syncOnlineChatUI } from "../online/chat.js";
import { ensureOnlineLeaveButton } from "../online/transport.js";
import { renderAromaField, scrubUserFacingUndefined } from "../features/elixian.js";
import { renderSummonZones } from "../features/summons.js";
import { timeUpdateSuppressedTeamAttribute, timeSuppressedUidSet, timeSyncSuppressionVisuals } from "../features/timeora.js";
import { state_engine_actions, other, unitAt } from "../engine/actions.js";
import { renderBattleBoard, grandVisualOwner } from "./setup.js";
import { activeAbigate, isNonAttackSkill, resolvedSkillForAction, setBattleLogOpen } from "../app/controls.js";
import { effectiveSkillCost, state_catalog_cards } from "../catalog/cards.js";
import { findUnit } from "../engine/combat.js";
import { lifeRainHealPool } from "../engine/effects.js";
import { allEnergy, energyStore, findPaymentPlan, reqAcceptsCounts, spendPaymentPlan, switchCost, transformedSkillReq } from "../engine/energy.js";
import { actionSkillHasEffect, actionSkillHasTag, card, cardHasCapability, skillDefHasEffect, skillOf } from "../engine/entities.js";
import { execute } from "../engine/execution.js";
import { colorAmount, enumerateDiscardSpecs } from "../features/character-rules.js";
import { state_features_dragon_memory } from "../features/dragon-memory.js";
import { openFoxStrikeChoice } from "../features/foxious.js";
import { openGenociderDisplosion } from "../features/genocider.js";
import { normalizeGameNumberText } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
import { afterAction, openMysticExtras, openTargetEnergyInteraction } from "./action-choices.js";
import { combatInt, energyAmountText, state_ui_battle_state } from "./battle-state.js";
import { openChoice } from "./results.js";
export function render() {
  const current = state_ui_battle_state.game;
  timeUpdateSuppressedTeamAttribute(current, timeSuppressedUidSet(current));
  const previous = state_engine_actions.timeTraitGame;
  state_engine_actions.timeTraitGame = current;
  try {
    syncGrandFieldBackground(current);
    renderBattleBoard();
    renderSummonZones();
    renderAromaField();
    scrubUserFacingUndefined();
    ensureOnlineLeaveButton();
    timeSyncSuppressionVisuals(current);
    syncOnlineChatUI();
    if (current?.mode === "spectator") specDecorateBattle();
    renderRaidBattleStatus();
    timeClockVisualSaturation.sync();
    paintChoiceTarget();
    state_runtime_state.StateFactory.updateActive(current);
    state_runtime_presentation.BattleRenderer.decorateDom();
  } finally {
    state_engine_actions.timeTraitGame = previous;
  }
}
export function syncGrandFieldBackground(g) {
  let arena = document.querySelector(".arena");
  if (!arena) return;
  arena.classList.remove("grand-P", "grand-A");
  document.querySelector(".player-side")?.classList.remove("grand-benefit", "grand-penalty");
  document.querySelector(".ai-side")?.classList.remove("grand-benefit", "grand-penalty");
  arena.classList.toggle("no-field-motion", false);
  if (g?.fieldEffect?.type === "grand") {
    let visualOwner = grandVisualOwner(g);
    arena.classList.add(`grand-${visualOwner}`);
    let good = visualOwner === "P" ? ".player-side" : ".ai-side",
      bad = visualOwner === "P" ? ".ai-side" : ".player-side";
    document.querySelector(good)?.classList.add("grand-benefit");
    document.querySelector(bad)?.classList.add("grand-penalty");
  }
}
export function renderLog() {
  let box = state_ui_battle_state.$("#log");
  const distanceFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
  const followLatest = state_ui_battle_state.lastLog === 0 || distanceFromBottom <= 28;
  const previousTop = box.scrollTop;
  let mobileClose = box.querySelector(".mobile-log-close");
  if (!mobileClose) {
    mobileClose = document.createElement("button");
    mobileClose.type = "button";
    mobileClose.className = "mobile-log-close";
    mobileClose.textContent = "로그 닫기";
    mobileClose.setAttribute("aria-label", "전투 로그 닫기");
    mobileClose.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      setBattleLogOpen(false);
    };
    box.prepend(mobileClose);
  }
  for (; state_ui_battle_state.lastLog < state_ui_battle_state.game.logs.length; state_ui_battle_state.lastLog++) {
    const l = state_ui_battle_state.game.logs[state_ui_battle_state.lastLog] || {};
    const message = normalizeGameNumberText(l.msg);
    if (!message) continue;
    const d = document.createElement("div");
    d.className = l.cls || "";
    d.textContent = message;
    box.appendChild(d);
  }
  if (followLatest) box.scrollTop = box.scrollHeight;else box.scrollTop = previousTop;
}
export function actionButton(box, label, fn, cls = "") {
  let b = document.createElement("button");
  b.textContent = normalizeGameNumberText(label) || "행동";
  if (cls) b.className = cls;
  b.onclick = fn;
  box.appendChild(b);
  return b;
}
export function paymentCostForAction(u, a) {
  let sk = card(u).skills.find(x => x.id === a.skill);
  return effectiveSkillCost(state_ui_battle_state.game, state_ui_battle_state.game?.order?.[state_ui_battle_state.game.turn]?.[0] || "P", u, sk, a.costOverride ?? (skillDefHasEffect(sk, "hurricaneDive") ? "W*" : sk?.cost || ""));
}
export function residualEnergyEntries(u, actor, plan) {
  let left = energyStore(u, actor).map((e, index) => ({
    ...e,
    index
  }));
  for (const c of "RWB") {
    let need = plan?.[c] || 0;
    for (let i = left.length - 1; i >= 0 && need > 0.001; i--) {
      if (left[i].c !== c) continue;
      let take = Math.min(left[i].a, need);
      left[i].a -= take;
      need -= take;
    }
  }
  return left.filter(e => e.a > 0.001);
}
export function residualDualEnergyEntries(u, baseActor, plan) {
  let out = [];
  for (const who of ["beast", "rider"]) {
    let left = energyStore(u, who).map((e, index) => ({
      ...e,
      index,
      actor: who
    }));
    if (who === baseActor) {
      for (const c of "RWB") {
        let need = plan?.[c] || 0;
        for (let i = left.length - 1; i >= 0 && need > 0.001; i--) {
          if (left[i].c !== c) continue;
          let take = Math.min(left[i].a, need);
          left[i].a -= take;
          need -= take;
        }
      }
    }
    out.push(...left.filter(e => e.a > 0.001));
  }
  return out;
}
export function openManualPayment(actions, done, title = "기술 코스트 선택") {
  if (!state_ui_battle_state.game || !Array.isArray(actions) || !actions.length) return;
  const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    a0 = actions[0],
    actor = a0.actor || null;
  if (!u) return;
  const store = energyStore(u, actor),
    picked = new Set();
  const requirements = actions.map(a => {
    const cost = paymentCostForAction(u, a);
    const transformed = transformedSkillReq(state_ui_battle_state.game, t, u, cost);
    const need = Object.values(transformed.req).reduce((n, x) => n + Number(x || 0), 0);
    return {
      action: a,
      cost,
      transformed,
      need
    };
  });
  const uniqueLabels = [...new Set(requirements.map(x => x.transformed.tokens.join(" ") || "없음"))];
  state_ui_battle_state.$("#modalContent").innerHTML = `<h2>${title}</h2><p>필요 코스트: <b>${uniqueLabels.join(" 또는 ")}</b>. 실제로 지불할 에너지를 선택하세요.</p><div class="energy manual-payment-energy"></div><div id="manualPaymentPreview" class="effect-box"></div><div class="choice-list"><button id="manualPaymentCancel">취소</button><button id="manualPaymentConfirm" class="primary" disabled>이 에너지로 지불</button></div>`;
  const box = state_ui_battle_state.$("#modalContent .manual-payment-energy"),
    preview = state_ui_battle_state.$("#manualPaymentPreview"),
    confirm = state_ui_battle_state.$("#manualPaymentConfirm");
  const counts = () => {
    const c = {
      R: 0,
      W: 0,
      B: 0
    };
    for (const i of picked) {
      const e = store[i];
      if (e) c[e.c] += Number(e.a || 0);
    }
    return c;
  };
  const planMatches = (reqInfo, c) => {
    const total = c.R + c.W + c.B;
    if (Math.abs(total - reqInfo.need) > .001) return false;
    if (!reqAcceptsCounts(reqInfo.transformed.req, c, u)) return false;
    const p = reqInfo.action.paymentPlan;
    if (p && (Math.abs(Number(p.R || 0) - c.R) > .001 || Math.abs(Number(p.W || 0) - c.W) > .001 || Math.abs(Number(p.B || 0) - c.B) > .001)) return false;
    return true;
  };
  const refresh = () => {
    const c = counts(),
      total = c.R + c.W + c.B;
    const matchingInfo = requirements.filter(x => planMatches(x, c));
    const matching = matchingInfo.map(x => x.action);
    const targetNeeds = [...new Set(requirements.map(x => energyAmountText(x.need)))].join(" 또는 ");
    const abyssInfo = actionSkillHasEffect(a0, "abyssCannon") ? ` · 예상 기본 피해 ${Math.max(0, 100 - 40 * (4 - (Number(a0.baseCostCount) || 0)))}D · 독 조건 ${c.R > 0 && c.W > 0 && c.B > 0 ? "충족" : "불충족"}` : "";
    preview.textContent = `선택 ${c.R ? `R${energyAmountText(c.R)} ` : ""}${c.W ? `W${energyAmountText(c.W)} ` : ""}${c.B ? `B${energyAmountText(c.B)}` : ""} · ${matching.length ? "지불 가능" : `총 ${energyAmountText(total)}/${targetNeeds}, 코스트 조건 불충족`}${abyssInfo}`;
    confirm.disabled = !matching.length;
    return {
      c,
      matching
    };
  };
  store.forEach((e, i) => {
    const b = document.createElement("button");
    b.className = `e ${e.c}`;
    b.textContent = `${e.c}${Number(e.a) === .5 ? "½" : ""}`;
    b.title = `${e.c} 에너지 ${energyAmountText(e.a)}`;
    b.onclick = () => {
      picked.has(i) ? picked.delete(i) : picked.add(i);
      b.classList.toggle("chosen", picked.has(i));
      refresh();
    };
    box.appendChild(b);
  });
  state_ui_battle_state.$("#manualPaymentCancel").onclick = () => state_ui_battle_state.$("#modal").classList.remove("open");
  confirm.onclick = () => {
    const {
      c,
      matching
    } = refresh();
    if (!matching.length) return;
    done(matching.map(a => ({
      ...a,
      paymentPlan: {
        ...c
      }
    })), {
      ...c
    });
  };
  refresh();
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function openExtraAnyEnergy(actions, plan) {
  let [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    base = actions[0],
    entries = residualEnergyEntries(u, base.actor || null, plan || {
      R: 0,
      W: 0,
      B: 0
    }),
    picked = new Set();
  state_ui_battle_state.$("#modalContent").innerHTML = `<h2>${skillOf(u, base.skill)?.name || "기술"} · 추가 에너지</h2><p>기본 코스트와 별도로 투입할 에너지를 선택하세요.</p><div class="energy variable-extra-energy"></div><div id="variableExtraPreview" class="effect-box"></div><button id="variableExtraConfirm" class="primary">사용 확정</button>`;
  const box = state_ui_battle_state.$("#modalContent .variable-extra-energy"),
    preview = state_ui_battle_state.$("#variableExtraPreview"),
    confirm = state_ui_battle_state.$("#variableExtraConfirm");
  const selectedAmount = () => +[...picked].reduce((n, i) => n + Number(entries[i]?.a || 0), 0).toFixed(1);
  const refresh = () => {
    const amount = selectedAmount(),
      match = actions.find(a => Math.abs(Number(a.extraEnergyAmount || 0) - amount) < 1e-6);
    preview.textContent = `추가 ${energyAmountText(amount)}E · 예상 회복 ${combatInt(amount * 30)}HP`;
    confirm.disabled = !match;
    return match;
  };
  entries.forEach((e, i) => {
    const b = document.createElement("button");
    b.className = `e ${e.c}`;
    b.textContent = `${e.c}${e.a === 0.5 ? "½" : ""}`;
    b.onclick = () => {
      picked.has(i) ? picked.delete(i) : picked.add(i);
      b.classList.toggle("chosen", picked.has(i));
      refresh();
    };
    box.appendChild(b);
  });
  confirm.onclick = () => {
    const match = refresh();
    if (!match) return;
    const extraEnergyPlan = [...picked].map(i => ({
      c: entries[i].c,
      a: entries[i].a,
      actor: entries[i].actor || null
    }));
    state_ui_battle_state.$("#modal").classList.remove("open");
    executeChosenPlayerAction({
      ...match,
      paymentPlan: plan ? {
        ...plan
      } : null,
      extraEnergyPlan
    });
  };
  refresh();
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function openRampageExtraPayment(actions, plan) {
  let [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    base = actions[0],
    entries = residualDualEnergyEntries(u, base.actor || "beast", plan),
    picked = new Set();
  state_ui_battle_state.$("#modalContent").innerHTML = `<h2>날뛰기 추가 에너지</h2><p>기본 * 코스트와 별도로 제거할 빙마·기수 에너지를 직접 선택하세요. 선택하지 않아도 사용할 수 있습니다.</p><div class="energy rampage-extra-energy"></div><div id="rampageExtraPreview" class="effect-box"></div><button id="rampageExtraConfirm" class="primary">이대로 사용</button>`;
  let box = state_ui_battle_state.$("#modalContent .rampage-extra-energy"),
    preview = state_ui_battle_state.$("#rampageExtraPreview"),
    confirm = state_ui_battle_state.$("#rampageExtraConfirm"),
    selectedAmount = () => [...picked].reduce((n, i) => n + entries[i].a, 0),
    refresh = () => {
      let n = +selectedAmount().toFixed(1),
        match = actions.find(a => Math.abs((a.extra || 0) - n) < 0.001);
      preview.textContent = `추가 제거 ${energyAmountText(n)}E · 총 제거 ${energyAmountText(1 + n)}E · 예상 피해 ${combatInt((1 + n) * 10)}D`;
      confirm.disabled = !match;
      return match;
    };
  entries.forEach((e, i) => {
    let b = document.createElement("button");
    b.className = `e ${e.c}`;
    b.textContent = `${e.actor === "beast" ? "빙" : "기"}${e.c}${e.a === 0.5 ? "½" : ""}`;
    b.title = `${e.actor === "beast" ? "빙마" : "기수"} ${e.c} 에너지 ${e.a}`;
    b.onclick = () => {
      picked.has(i) ? picked.delete(i) : picked.add(i);
      b.classList.toggle("chosen", picked.has(i));
      refresh();
    };
    box.appendChild(b);
  });
  confirm.onclick = () => {
    let match = refresh();
    if (!match) return;
    let extraEnergyPlan = [...picked].map(i => ({
      actor: entries[i].actor,
      c: entries[i].c,
      a: entries[i].a
    }));
    executeChosenPlayerAction({
      ...match,
      paymentPlan: {
        ...plan
      },
      extraEnergyPlan
    });
  };
  refresh();
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function openSwitchPayment(a) {
  let [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    actor = cardHasCapability(u, "dualActor") ? "beast" : null,
    need = switchCost(u),
    store = energyStore(u, actor),
    picked = new Set();
  if (!need) {
    if (execute(state_ui_battle_state.game, t, s, a)) afterAction();
    return;
  }
  state_ui_battle_state.$("#modalContent").innerHTML = `<h2>교체 코스트 선택</h2><p>교체 Cost ${"*".repeat(need)}. 지불할 에너지를 직접 선택하세요.</p><div class="energy switch-payment-energy"></div><div id="switchPaymentPreview" class="effect-box"></div><button id="switchPaymentConfirm" class="primary" disabled>교체 확정</button>`;
  let box = state_ui_battle_state.$("#modalContent .switch-payment-energy"),
    preview = state_ui_battle_state.$("#switchPaymentPreview"),
    confirm = state_ui_battle_state.$("#switchPaymentConfirm"),
    refresh = () => {
      let c = {
        R: 0,
        W: 0,
        B: 0
      };
      for (const i of picked) c[store[i].c] += store[i].a;
      let total = c.R + c.W + c.B,
        valid = Math.abs(total - need) < 0.001 && Math.floor(c.R + 0.001) + Math.floor(c.W + 0.001) + Math.floor(c.B + 0.001) >= need;
      preview.textContent = `선택 ${c.R ? `R${c.R} ` : ""}${c.W ? `W${c.W} ` : ""}${c.B ? `B${c.B}` : ""} · ${valid ? "지불 가능" : `${total}/${need}`}`;
      confirm.disabled = !valid;
      return {
        valid,
        c
      };
    };
  store.forEach((e, i) => {
    let b = document.createElement("button");
    b.className = `e ${e.c}`;
    b.textContent = `${e.c}${e.a === 0.5 ? "½" : ""}`;
    b.onclick = () => {
      picked.has(i) ? picked.delete(i) : picked.add(i);
      b.classList.toggle("chosen", picked.has(i));
      refresh();
    };
    box.appendChild(b);
  });
  confirm.onclick = () => {
    let r = refresh();
    if (!r.valid) return;
    state_ui_battle_state.$("#modal").classList.remove("open");
    if (execute(state_ui_battle_state.game, t, s, {
      ...a,
      switchPaymentPlan: r.c
    })) afterAction();
  };
  refresh();
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function finalizeChosenPlayerAction(a) {
  const overflowIntercept = systems.__megaEnergyOverflowChoice?.interceptFinalize?.(a);
  if (overflowIntercept?.handled) return overflowIntercept.value;
  let [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn];
  state_ui_battle_state.$("#modal").classList.remove("open");
  if (execute(state_ui_battle_state.game, t, s, a)) afterAction();
}
export function openLifeRainSlider(a) {
  let [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    actor = unitAt(state_ui_battle_state.game, t, s),
    units = state_ui_battle_state.game.teams[t].field.filter(u => u && !u.dead),
    total = lifeRainHealPool(state_ui_battle_state.game, actor, t);
  if (units.length < 2) {
    a.split = total;
    finalizeChosenPlayerAction(a);
    return;
  }
  let initial = Math.max(0, Math.min(total, Math.round(a.split ?? total / 2)));
  state_ui_battle_state.$("#modalContent").innerHTML = `<h2>라이프레인 회복 분배</h2><p>총 회복 자원 <b>${total}</b>을 두 필드 아군에게 분배합니다.</p><div class="heal-allocation"><div class="heal-allocation-head"><span>${units[0].name}</span><span>${units[1].name}</span></div><div class="heal-allocation-track"><span id="lifeSplitLeft" class="heal-allocation-left"></span><span id="lifeSplitRight" class="heal-allocation-right"></span><span id="lifeSplitKnob" class="heal-allocation-knob"></span><input id="lifeSplitSlider" type="range" min="0" max="${total}" step="1" value="${initial}" aria-label="라이프레인 회복 분배"></div><div class="heal-allocation-values"><span id="lifeSplitLeftValue"></span><span id="lifeSplitRightValue"></span></div></div><button id="lifeSplitConfirm" class="primary">분배 확정</button>`;
  let slider = state_ui_battle_state.$("#lifeSplitSlider"),
    left = state_ui_battle_state.$("#lifeSplitLeft"),
    right = state_ui_battle_state.$("#lifeSplitRight"),
    knob = state_ui_battle_state.$("#lifeSplitKnob"),
    lv = state_ui_battle_state.$("#lifeSplitLeftValue"),
    rv = state_ui_battle_state.$("#lifeSplitRightValue");
  const show = () => {
    let n = Number(slider.value),
      pct = total ? 100 * n / total : 50;
    left.style.width = `${pct}%`;
    right.style.width = `${100 - pct}%`;
    knob.style.left = `${pct}%`;
    lv.textContent = `${units[0].name} +${n}`;
    rv.textContent = `${units[1].name} +${total - n}`;
  };
  slider.oninput = show;
  show();
  state_ui_battle_state.$("#lifeSplitConfirm").onclick = () => {
    a.split = Number(slider.value);
    finalizeChosenPlayerAction(a);
  };
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function executeChosenPlayerAction(a) {
  if (actionSkillHasEffect(a, "lifeRain")) return openLifeRainSlider(a);
  if (actionSkillHasEffect(a, "eternaHeal") && a.healSplitPct == null) return openEternaHealOptions(a);
  maybeChooseDeepMind(a, finalizeChosenPlayerAction);
}
export function openLightCandelabraResolution(actions, plan) {
  let first = actions[0],
    [t] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    target = unitAt(state_ui_battle_state.game, first.target.team, first.target.slot),
    paidW = Math.min(3, Math.floor((plan?.W || 0) + 0.001));
  if (!target || target.dead) return;
  if (first.target.team === t || paidW < 3) {
    executeChosenPlayerAction(first);
    return;
  }
  let choices = [],
    seen = new Set();
  for (const a of actions) {
    if (!a.sealedSkillId || seen.has(a.sealedSkillId)) continue;
    seen.add(a.sealedSkillId);
    let skill = card(target).skills.find(x => x.id === a.sealedSkillId);
    if (!skill) continue;
    choices.push({
      label: `${skill.name} 봉인`,
      fn: () => executeChosenPlayerAction(a)
    });
  }
  if (!choices.length) {
    executeChosenPlayerAction(first);
    return;
  }
  openChoice(`<h2>빛의촛대 · 기술봉인 판정</h2><p>W를 3개 지불했습니다. ${target.name}의 봉인할 기술을 선택하세요.</p>`, choices);
}
export function openHolyFlameHealChoice(actions) {
  let choices = [],
    seen = new Set();
  for (const a of actions) {
    if (!a.healTargetUid || seen.has(a.healTargetUid)) continue;
    let target = findUnit(state_ui_battle_state.game, a.healTargetUid);
    if (!target || target.dead) continue;
    seen.add(a.healTargetUid);
    choices.push({
      label: `${target.name} 회복`,
      fn: () => executeChosenPlayerAction(a)
    });
  }
  if (choices.length <= 1) {
    executeChosenPlayerAction(actions[0]);
    return;
  }
  openChoice(`<h2>홀리플레임 · 회복 대상</h2><p>공격 판정에 함께 적용할 아군 회복 대상을 선택하세요.</p>`, choices);
}
export function openHurricaneExtraChoice(actions, plan) {
  let [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    base = actions[0],
    entries = residualEnergyEntries(u, base.actor || null, plan).filter(e => e.c === "W"),
    picked = new Set();
  state_ui_battle_state.$("#modalContent").innerHTML = `<h2>허리케인 다이브 · 추가 W</h2><p>기본 코스트 결제가 끝났습니다. 추가로 지불할 W를 선택하세요. 선택하지 않으면 즉시 30D입니다.</p><div class="energy hurricane-extra-energy"></div><div id="hurricaneExtraPreview" class="effect-box"></div><button id="hurricaneExtraConfirm" class="primary">이대로 사용</button>`;
  let box = state_ui_battle_state.$("#modalContent .hurricane-extra-energy"),
    preview = state_ui_battle_state.$("#hurricaneExtraPreview"),
    confirm = state_ui_battle_state.$("#hurricaneExtraConfirm"),
    refresh = () => {
      let n = +[...picked].reduce((sum, i) => sum + entries[i].a, 0).toFixed(1),
        match = actions.find(a => Math.abs((a.extraW || 0) - n) < 0.001);
      preview.textContent = match ? `추가 W ${energyAmountText(n)} · ${n ? `${combatInt(n)}턴 후 ${combatInt(30 + 70 * n)}D` : "즉시 30D"}` : `추가 W ${energyAmountText(n)} · 가능한 추가 지불은 0, 1, 2입니다.`;
      confirm.disabled = !match;
      return match;
    };
  entries.forEach((e, i) => {
    let b = document.createElement("button");
    b.className = "e W";
    b.textContent = `W${e.a === 0.5 ? "½" : ""}`;
    b.onclick = () => {
      picked.has(i) ? picked.delete(i) : picked.add(i);
      b.classList.toggle("chosen", picked.has(i));
      refresh();
    };
    box.appendChild(b);
  });
  confirm.onclick = () => {
    let match = refresh();
    if (match) executeChosenPlayerAction(match);
  };
  refresh();
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function simulatedResidualStore(u, plan = null, actor = null) {
  const copy = energyStore(u, actor).map(e => ({
    ...e
  }));
  const fake = {
    ...u
  };
  if (cardHasCapability(u, "dualActor")) {
    fake.beastEnergy = actor === "rider" ? (u.beastEnergy || []).map(e => ({
      ...e
    })) : copy;
    fake.riderEnergy = actor === "rider" ? copy : (u.riderEnergy || []).map(e => ({
      ...e
    }));
  } else fake.energy = copy;
  if (plan) spendPaymentPlan(fake, plan, actor);
  return energyStore(fake, actor).map(e => ({
    ...e
  }));
}
export function openEternaHealOptions(a) {
  const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    actor = unitAt(state_ui_battle_state.game, t, s);
  const allies = state_ui_battle_state.game.teams[t].field.filter(u => u && !u.dead);
  if (!actor || !allies.length) return finalizeChosenPlayerAction(a);
  let chosenUid = allies.some(u => u.uid === actor.uid) ? actor.uid : allies[0].uid;
  let discardSpecs = [];
  const target = unitAt(state_ui_battle_state.game, a.target.team, a.target.slot);
  const poolPreview = Math.max(0, Math.round(colorAmount(target, "R") * 60 / 2));
  const root = state_ui_battle_state.$("#modalContent");
  root.innerHTML = `<h2>이터너힐 · 회복과 R 분배</h2><p>예상 회복 자원 ${poolPreview}. 회복 비율과 마지막 R 대상만 정하면 됩니다.</p>
          <div class="heal-allocation"><div class="heal-allocation-head"><span>${allies[0]?.name || "아군1"}</span><span>${allies[1]?.name || allies[0]?.name || "아군2"}</span></div>
          <div class="heal-allocation-track"><span id="eternaSplitLeft" class="heal-allocation-left"></span><span id="eternaSplitRight" class="heal-allocation-right"></span><span id="eternaSplitKnob" class="heal-allocation-knob"></span><input id="eternaSplitSlider" type="range" min="0" max="${poolPreview}" step="1" value="${Math.round(poolPreview / 2)}" aria-label="이터너힐 회복량 분배"></div>
          <div class="heal-allocation-values"><span id="eternaSplitLeftValue"></span><span id="eternaSplitRightValue"></span></div></div>
          <h3>마지막 R 1 대상</h3><div id="eternaRTargets" class="choice-list"></div><div id="eternaDiscardBox" class="effect-box tiny"></div>
          <button id="eternaHealConfirm" class="primary">사용 확정</button>`;
  const slider = state_ui_battle_state.$("#eternaSplitSlider"),
    left = state_ui_battle_state.$("#eternaSplitLeft"),
    right = state_ui_battle_state.$("#eternaSplitRight"),
    knob = state_ui_battle_state.$("#eternaSplitKnob"),
    lv = state_ui_battle_state.$("#eternaSplitLeftValue"),
    rv = state_ui_battle_state.$("#eternaSplitRightValue");
  const refreshSplit = () => {
    const amount = Number(slider.value),
      pct = poolPreview > 0 ? amount / poolPreview * 100 : 50;
    left.style.width = `${pct}%`;
    right.style.width = `${100 - pct}%`;
    knob.style.left = `${pct}%`;
    lv.textContent = `${allies[0]?.name || "아군1"} +${amount}`;
    rv.textContent = `${allies[1]?.name || allies[0]?.name || "아군2"} +${Math.max(0, poolPreview - amount)}`;
  };
  const refreshDiscard = () => {
    const chosen = findUnit(state_ui_battle_state.game, chosenUid);
    discardSpecs = [];
    if (!chosen) return;
    let entries = chosen.uid === actor.uid ? simulatedResidualStore(actor, a.paymentPlan || null) : energyStore(chosen).map(e => ({
      ...e
    }));
    const need = Math.max(0, entries.reduce((n, e) => n + e.a, 0) + 1 - (card(chosen).maxEnergy || 4));
    const box = state_ui_battle_state.$("#eternaDiscardBox");
    box.innerHTML = "";
    if (need <= .001) {
      box.textContent = "R을 바로 받을 수 있습니다.";
      return;
    }
    const opts = enumerateDiscardSpecs(entries.map(e => ({
      c: e.c,
      a: e.a
    })), need);
    if (!opts.length) {
      box.textContent = "R을 받을 공간이 없어 부여가 취소됩니다.";
      return;
    }
    discardSpecs = opts[0].specs;
    box.innerHTML = `<b>에너지 최대:</b> ${discardSpecs.map(e => e.c + (e.a === .5 ? "½" : "")).join("+")}를 버리고 R을 받습니다.`;
    opts.slice(0, 8).forEach((op, i) => {
      const b = document.createElement("button");
      b.textContent = `${op.specs.map(e => e.c + (e.a === .5 ? "½" : "")).join("+")} 버리기`;
      if (i === 0) b.classList.add("selected");
      b.onclick = () => {
        discardSpecs = op.specs;
        box.querySelectorAll("button").forEach(x => x.classList.remove("selected"));
        b.classList.add("selected");
      };
      box.appendChild(b);
    });
  };
  const targetBox = state_ui_battle_state.$("#eternaRTargets");
  allies.forEach(u => {
    const b = document.createElement("button");
    b.textContent = u.name;
    if (u.uid === chosenUid) b.classList.add("selected");
    b.onclick = () => {
      chosenUid = u.uid;
      targetBox.querySelectorAll("button").forEach(x => x.classList.remove("selected"));
      b.classList.add("selected");
      refreshDiscard();
    };
    targetBox.appendChild(b);
  });
  slider.oninput = refreshSplit;
  refreshSplit();
  refreshDiscard();
  state_ui_battle_state.$("#eternaHealConfirm").onclick = () => {
    const amount = Number(slider.value),
      pct = poolPreview > 0 ? amount / poolPreview * 100 : 50;
    finalizeChosenPlayerAction({
      ...a,
      healSplitPct: pct,
      healSplitAmountPreview: amount,
      rTargetUid: chosenUid,
      rDiscardSpecs: discardSpecs
    });
  };
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function openAbyssCannonChoice(actions) {
  return systems.__interactionChoiceR25?.openAbyssCannonChoice?.(actions);
}
export function openVortexEditor(actions, plan) {
  return systems.__interactionChoiceR25?.openVortexEditor?.(actions, plan);
}
export function maybeChooseDeepMind(a, next) {
  const [t] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    actor = unitAt(state_ui_battle_state.game, ...state_ui_battle_state.game.order[state_ui_battle_state.game.turn]),
    sk = resolvedSkillForAction(actor, a);
  const abi = activeAbigate(state_ui_battle_state.game, t);
  if (!abi || !isNonAttackSkill(sk) || a.deepMindTargetUid) return next(a);
  const targets = state_ui_battle_state.game.teams[other(t)].field.filter(u => u && !u.dead && allEnergy(u) > .001);
  if (!targets.length) return next(a);
  openChoice(`<h2>아비게이트 · 딥마인드</h2><p>HP 10 회복 후 에너지 0.5를 제거할 상대를 선택하세요.</p>`, targets.map(u => ({
    label: `${u.name} · 에너지 ${energyAmountText(allEnergy(u))}`,
    fn: () => next({
      ...a,
      deepMindTargetUid: u.uid
    })
  })));
}
export function dispatchPlayerSkill(actions) {
  const firstAction = actions?.[0];
  if (!firstAction) return;
  if (actionSkillHasEffect(firstAction, "elixianShiningWind")) {
    const variants = [];
    for (const a of actions) {
      const actor = unitAt(state_ui_battle_state.game, ...state_ui_battle_state.game.order[state_ui_battle_state.game.turn]);
      const key = `${a.costOverride || paymentCostForAction(actor, a)}:${a.target?.team}:${a.target?.slot}`;
      if (!variants.some(x => `${x.costOverride || paymentCostForAction(actor, x)}:${x.target?.team}:${x.target?.slot}` === key)) variants.push(a);
    }
    return openManualPayment(variants, matching => executeChosenPlayerAction(matching[0]), "샤이닝윈드 코스트");
  }
  if (actionSkillHasEffect(firstAction, "genociderDisplosion")) return openGenociderDisplosion(actions);
  if (actionSkillHasTag(firstAction, "copy")) {
    if (!state_ui_battle_state.game || !actions.length) return;
    state_features_dragon_memory.dmPendingFlow = state_features_dragon_memory.dmPendingFlow || {
      actionId: firstAction.actionId,
      actorUid: unitAt(state_ui_battle_state.game, ...state_ui_battle_state.game.order[state_ui_battle_state.game.turn])?.uid,
      stage: "payment"
    };
    state_features_dragon_memory.dmPendingFlow.stage = "payment";
    const copiedName = state_catalog_cards.CARDS.find(c => c.id === firstAction.copyCard)?.skills.find(s => s.id === firstAction.copySkill)?.name || "복사 기술";
    return openManualPayment(actions, (matching, plan) => {
      const chosen = matching[0];
      if (!chosen || state_features_dragon_memory.dmPendingFlow?.executing) return;
      state_features_dragon_memory.dmPendingFlow.executing = true;
      executeChosenPlayerAction({
        ...chosen,
        paymentPlan: {
          ...plan
        },
        actionId: chosen.actionId || state_features_dragon_memory.dmPendingFlow.actionId
      });
    }, `드래곤메모리 · ${copiedName} 코스트`);
  }
  if (actionSkillHasEffect(firstAction, "foxStrike")) return openFoxStrikeChoice(actions);
  let [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    a = actions[0],
    transformed = transformedSkillReq(state_ui_battle_state.game, t, u, paymentCostForAction(u, a)),
    hasCost = transformed.tokens.length > 0;
  let continueWith = (variants, plan) => {
    let first = variants[0];
    if (skillOf(u, first.skill)?.extraAnyEnergy) return openExtraAnyEnergy(variants, plan);
    if (actionSkillHasEffect(first, "mysticBurst")) return openMysticExtras(variants, plan);
    if (["targetEnergyRemoval", "targetEnergyTransfer"].includes(skillOf(u, first.skill)?.interaction?.kind)) return openTargetEnergyInteraction(variants, unitAt(state_ui_battle_state.game, first.target.team, first.target.slot));
    if (actionSkillHasEffect(first, "hurricaneDive")) return openHurricaneExtraChoice(variants, plan);
    if (actionSkillHasEffect(first, "rampage")) return openRampageExtraPayment(variants, plan);
    if (actionSkillHasEffect(first, "lightCandelabra")) return openLightCandelabraResolution(variants, plan);
    if (actionSkillHasEffect(first, "holyFlame")) return openHolyFlameHealChoice(variants);
    if (actionSkillHasEffect(first, "abyssCannon")) return openAbyssCannonChoice(variants);
    if (actionSkillHasEffect(first, "abyssVortex")) return openVortexEditor(variants, plan || {
      R: 0,
      W: 0,
      B: 0
    });
    executeChosenPlayerAction(first);
  };
  if (!hasCost) {
    continueWith(actions, a.paymentPlan || null);
    return;
  }
  let needsColorChoice = transformed.req.any > 0 || transformed.req.wb > 0 || transformed.req.rb > 0;
  if (needsColorChoice) {
    openManualPayment(actions, continueWith, `${card(u).skills.find(x => x.id === a.skill)?.name || "기술"} 코스트`);
    return;
  }
  let autoPlan = findPaymentPlan(state_ui_battle_state.game, t, u, paymentCostForAction(u, a), a.actor || null);
  continueWith(actions, autoPlan);
}

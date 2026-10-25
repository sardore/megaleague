import { presentRaidReward, scheduleRaidTurn, commitRaidActionPresentation } from "../features/boss-raid.js";
import { specIsHostMatch, specStartHostBroadcast } from '../features/spectators.js';
import { aiReason, maskedStateFor } from "../ai/search.js";
import { chooseAI } from "../ai/specialists.js";
import { forcedRuleAction, legalActions, prepareCurrentTurn, unitAt } from "../engine/actions.js";
import { findUnit, heal, nonAttackDamage, traitsActive } from "../engine/combat.js";
import { applyBloomAllocation, collectTargetEnergyEntries, previewNaturalGatherProposal } from "../engine/effects.js";
import { allEnergy, energyStore, gainEnergy, gainTraitEnergyNow, status, totalEnergy } from "../engine/energy.js";
import { card, cardHasCapability, newGame, skillOf } from "../engine/entities.js";
import { endTurn, execute } from "../engine/execution.js";
import { removeDeepMindHalf } from "../features/character-rules.js";
import { timeAccelerationIsActive, timeMarkTimeline, timeOpenGatherOverflow, timePeekGather, state_features_timeora } from "../features/timeora.js";
import { state_online_commands } from "../online/commands.js";
import { broadcastOnlineState, cloneOnlineVisualEvents } from "../online/connection.js";
import { sendAuthoritativeOnlineState } from "../online/snapshots.js";
import { applyManualSummonAction, chooseSummonAIAction, normalizePendingSummonTurns, summonTeamLocallyControlled } from "../online/emotes.js";
import { randomId, stableOnlinePlayerId } from "../online/transport.js";
import { log } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
import { openCustomNaturalGather, state_ui_action_panel } from "./action-panel.js";
import { clearLocalAutoTurnTimer, combatInt, energyAmountText, scheduleLocalAutoTurnTimer, state_ui_battle_state } from "./battle-state.js";
import { escapeUIHTML } from "./cards.js";
import { startBgm, state_ui_deck } from "./deck.js";
import { render, residualEnergyEntries } from "./payment.js";
import { openChoice, state_ui_results } from "./results.js";
import { buildAIDeck } from "./setup.js";
import { state_ui_targeting } from "./targeting.js";
export function openTimeAccelerationGather(a, t, s, u) {
  const peek = timePeekGather(u, state_ui_battle_state.game, t),
    root = state_ui_battle_state.$("#modalContent");
  root.innerHTML = `<h2>시간 가속 · 첫 에너지 ${peek.first}</h2><p>첫 결과를 유지하면 총 ${energyAmountText(peek.amt + .5)}E를 수급합니다. 버리면 한 번만 재추첨하며 1E만 수급합니다.</p><div class="choice-list"><button id="timeGatherKeep" class="primary">첫 결과 유지 · 총 ${energyAmountText(peek.amt + .5)}E 수급</button><button id="timeGatherReroll">재추첨 · 1E 수급</button><button id="timeGatherCancel">취소</button></div>`;
  state_ui_battle_state.$("#timeGatherKeep").onclick = () => timeOpenGatherOverflow(a, "keep", peek);
  state_ui_battle_state.$("#timeGatherReroll").onclick = () => timeOpenGatherOverflow(a, "reroll", peek);
  state_ui_battle_state.$("#timeGatherCancel").onclick = () => state_ui_battle_state.$("#modal").classList.remove("open");
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function playerGather(a) {
  const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    actor = a.actor || null;
  if (u && timeAccelerationIsActive(state_ui_battle_state.game, u)) return openTimeAccelerationGather(a, t, s, u);
  if (u && (cardHasCapability(u, "jungleMud") || cardHasCapability(u, "alternatingCharge"))) return openCustomNaturalGather(a, t, s, u);
  const store = energyStore(u, actor),
    amt = status(u, "slow") ? 0.5 : 1,
    existingHalf = amt === 0.5 ? store.find(e => e.a === 0.5) : null,
    proposal = previewNaturalGatherProposal(state_ui_battle_state.game, t, s, u, amt, actor, "natural-gather"),
    col = proposal?.color,
    max = card(u).maxEnergy || 4;
  if (!proposal || !col) return;
  a.gatherProposal = proposal;
  if (existingHalf) log(state_ui_battle_state.game, `${u.name}: 기존 ${col} 반에너지와 합치기 위해 자연 수급 색이 ${col}로 고정.`);
  if (totalEnergy(u, actor) + amt <= max + .001) {
    const executed = execute(state_ui_battle_state.game, t, s, a);
    if (executed) afterAction();
    return;
  }
  const overflow = totalEnergy(u, actor) + amt - max,
    root = state_ui_battle_state.$("#modalContent"),
    seen = new Set(),
    items = [];
  store.forEach((e, i) => {
    if (Number(e.a || 0) + .001 < overflow) return;
    const key = `${e.c}:${e.a}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      i,
      e
    });
  });
  root.innerHTML = `<h2>에너지 최대</h2><p>새 ${col}${amt === 0.5 ? "½" : ""}을 보관하려면 기존 에너지 <b>하나만</b> 버리세요.${Math.abs(totalEnergy(u, actor) - 3.5) < .001 ? " 현재 3.5E이므로 반에너지 하나도 버릴 수 있습니다." : ""}</p><div class="choice-list energy-single-discard"></div><div class="choice-list"><button id="discardNew">새 에너지 버리기</button><button id="gatherCancel">취소</button></div>`;
  const list = root.querySelector('.energy-single-discard');
  for (const {
    i,
    e
  } of items) {
    const b = document.createElement('button');
    b.textContent = `${e.c}${e.a === .5 ? '½' : ''} 하나 버리고 새 ${col}${amt === .5 ? '½' : ''} 보관`;
    b.onclick = () => {
      state_ui_battle_state.$("#modal").classList.remove("open");
      a.replaceIndex = i;
      delete a.replaceIndices;
      delete a.discardNew;
      if (execute(state_ui_battle_state.game, t, s, a)) afterAction();
    };
    list.appendChild(b);
  }
  if (!items.length) list.innerHTML = `<p class="muted">에너지 하나만 버려서는 새 에너지를 보관할 수 없습니다.</p>`;
  root.querySelector("#discardNew").onclick = () => {
    state_ui_battle_state.$("#modal").classList.remove("open");
    a.discardNew = true;
    delete a.replaceIndex;
    delete a.replaceIndices;
    if (execute(state_ui_battle_state.game, t, s, a)) afterAction();
  };
  root.querySelector("#gatherCancel").onclick = () => state_ui_battle_state.$("#modal").classList.remove("open");
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function openMysticExtras(actions, plan) {
  let [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    entries = residualEnergyEntries(u, actions[0]?.actor || null, plan).filter(e => e.a >= 1 - 1e-6),
    chosen = new Set(),
    picked = {
      R: 0,
      W: 0,
      B: 0
    };
  state_ui_battle_state.$("#modalContent").innerHTML = `<h2>미스틱버스트 2단계 — 추가 에너지</h2><p>기본 WB* 결제 후 남은 에너지 중 추가할 것을 고르세요.</p><div id="mysticExtraEnergy" class="energy mystic-extra-energy"></div><div id="mysticPreview" class="effect-box"></div><button id="mysticConfirm" class="primary">사용 확정</button>`;
  let box = state_ui_battle_state.$("#mysticExtraEnergy"),
    preview = state_ui_battle_state.$("#mysticPreview"),
    renderPreview = () => {
      preview.textContent = `추가 ${"R".repeat(picked.R)}${"W".repeat(picked.W)}${"B".repeat(picked.B) || "없음"} · 예상 ${100 + 30 * picked.R}D · 회복 ${50 * picked.W} · 무작위 상태 ${picked.B}`;
    };
  entries.forEach((e, i) => {
    let b = document.createElement("button");
    b.className = `e ${e.c}`;
    b.textContent = e.c;
    b.onclick = () => {
      chosen.has(i) ? chosen.delete(i) : chosen.add(i);
      b.classList.toggle("chosen", chosen.has(i));
      picked = {
        R: 0,
        W: 0,
        B: 0
      };
      for (const j of chosen) picked[entries[j].c] += 1;
      renderPreview();
    };
    box.appendChild(b);
  });
  renderPreview();
  state_ui_battle_state.$("#mysticConfirm").onclick = () => {
    let a = actions.find(x => x.extraColors.R === picked.R && x.extraColors.W === picked.W && x.extraColors.B === picked.B);
    if (!a) return;
    state_ui_battle_state.$("#modal").classList.remove("open");
    let [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn];
    if (!execute(state_ui_battle_state.game, t, s, a)) return;
    afterAction();
  };
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function openTargetEnergyInteraction(actions, target) {
  const base = actions[0],
    [actorTeam, actorSlot] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    actor = unitAt(state_ui_battle_state.game, actorTeam, actorSlot),
    skill = skillOf(actor, base.skill),
    kind = skill?.interaction?.kind,
    transfer = kind === "targetEnergyTransfer",
    effect = skill?.effects?.find(e => e?.type === "mutualEnergyTrade") || {},
    picked = new Set(),
    entries = collectTargetEnergyEntries(target),
    maxPicks = transfer ? Math.max(1, Number(skill?.interaction?.count || 1)) : Infinity,
    commit = action => {
      state_ui_battle_state.$("#modal").classList.remove("open");
      const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn];
      if (execute(state_ui_battle_state.game, t, s, action)) afterAction();
    };
  // Nothing to pick from: the rest of the skill (damage etc.) still happens, so run it without an empty chooser.
  if (!entries.length) return commit({
    ...base,
    interactionAmount: 0,
    interactionPlan: []
  });
  state_ui_battle_state.$("#modalContent").innerHTML = `<h2>${escapeUIHTML(skill?.name || "기술")} · 에너지 ${transfer ? "강탈" : "제거"}</h2><p>${target.name}의 ${transfer ? "강탈할" : "제거할"} 에너지 아이콘을 선택하세요.</p><div class="energy interaction-energy"></div><div id="interactionPreview" class="effect-box"></div><button id="interactionConfirm">확정</button>`;
  const box = state_ui_battle_state.$("#modalContent .interaction-energy"),
    preview = state_ui_battle_state.$("#interactionPreview"),
    confirm = state_ui_battle_state.$("#interactionConfirm"),
    renderPreview = () => {
      const selected = [...picked].map(i => entries[i]),
        n = selected.reduce((sum, entry) => sum + Number(entry?.a || 0), 0);
      if (transfer) preview.textContent = selected.length ? `선택 ${selected.map(e => `${e.c}${e.a === 0.5 ? "½" : ""}`).join(" + ")} · ${energyAmountText(n)} 강탈` : "강탈할 에너지 하나를 선택하세요.";else {
        const selfDamage = Number(effect.selfDamagePerEnergy ?? effect.perEnergyDamage ?? 0) * n,
          enemyDamage = Number(effect.perEnergyDamage ?? 0) * n;
        preview.textContent = `에너지 ${energyAmountText(n)} 제거 · 자신 ${combatInt(selfDamage)} / 대상 ${combatInt(enemyDamage)} 피해`;
      }
      confirm.disabled = transfer && picked.size !== maxPicks;
      return n;
    };
  entries.forEach((e, i) => {
    const b = document.createElement("button");
    b.className = `e ${e.c}`;
    b.textContent = `${e.actor === "beast" ? "빙" : e.actor === "rider" ? "기" : ""}${e.c}${e.a === 0.5 ? "½" : ""}`;
    b.onclick = () => {
      if (transfer && !picked.has(i) && picked.size >= maxPicks) picked.clear();
      picked.has(i) ? picked.delete(i) : picked.add(i);
      [...box.children].forEach((button, index) => button.classList.toggle("chosen", picked.has(index)));
      renderPreview();
    };
    box.appendChild(b);
  });
  renderPreview();
  confirm.onclick = () => {
    if (transfer && picked.size !== maxPicks) return;
    const n = renderPreview();
    commit({
      ...base,
      interactionAmount: n,
      interactionPlan: [...picked].map(i => ({
        ...entries[i]
      }))
    });
  };
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function playerChooseTarget(tar) {
  const feature = systems.__interactionChoiceR25;
  feature?.beforeTarget?.(tar);
  const result = state_ui_targeting.TargetSelectionApplication.choose(tar);
  feature?.afterTarget?.();
  return result;
}
export function processPendingTraitChoice() {
  const raidReward = state_ui_battle_state.game?.pendingTraitChoices?.[0];
  if (raidReward?.kind === "bossReward") return presentRaidReward(raidReward);
  if (!state_ui_battle_state.game?.pendingTraitChoices?.length) return false;
  const pending = state_ui_battle_state.game.pendingTraitChoices[0];
  if (pending?.kind === "deepMind") {
    state_ui_battle_state.game.pendingTraitChoices.shift();
    const source = findUnit(state_ui_battle_state.game, pending.sourceUid),
      targets = (pending.targetUids || []).map(uid => findUnit(state_ui_battle_state.game, uid)).filter(u => u && !u.dead && allEnergy(u) > .001);
    if (!source || source.dead || !traitsActive(source) || !targets.length) return processPendingTraitChoice();
    openChoice(`<h2>아비게이트 · 딥마인드</h2><p>에너지 0.5를 제거할 상대를 선택하세요.</p>`, targets.map(u => ({
      label: `${u.name} · ${energyAmountText(allEnergy(u))}E`,
      fn: () => {
        removeDeepMindHalf(state_ui_battle_state.game, u, source);
        render();
        broadcastOnlineState();
        if (!processPendingTraitChoice()) scheduleAI();
      }
    })));
    return true;
  }
  if (pending?.kind === "bloomHeal") {
    state_ui_battle_state.game.pendingTraitChoices.shift();
    openBloomHealSlider(pending);
    return true;
  }
  let q = state_ui_battle_state.game.pendingTraitChoices.shift(),
    u = findUnit(state_ui_battle_state.game, q.uid);
  if (!u || u.dead || !traitsActive(u)) return processPendingTraitChoice();
  if (q.kind === "yggLight") {
    let items = q.targetUids.map(uid => findUnit(state_ui_battle_state.game, uid)).filter(x => x && !x.dead).map(target => ({
      label: `${target.name} ${q.damage ? "30 피해" : "30 회복"}`,
      fn: () => {
        q.damage ? nonAttackDamage(state_ui_battle_state.game, target, 30, "치유의 빛") : heal(state_ui_battle_state.game, target, 30, u, {
          reason: "ygg-light",
          effectId: "yggLight"
        });
        render();
        if (!processPendingTraitChoice()) scheduleAI();
      }
    }));
    if (!items.length) return processPendingTraitChoice();
    openChoice(`<h2>이그드라실 · 치유의 빛</h2><p>${q.damage ? "회복할 대상이 없습니다. 피해 대상을 선택하세요." : "회복 대상을 선택하세요."}</p>`, items);
    return true;
  }
  let store = energyStore(u),
    max = card(u).maxEnergy || 4,
    rejectItem = {
      label: "이번 특성 발동 거절",
      fn: () => {
        log(state_ui_battle_state.game, `${u.name}: 에너지 직조 발동을 거절.`);
        render();
        if (!processPendingTraitChoice()) scheduleAI();
      }
    },
    items = [];
  if (totalEnergy(u) + q.amount <= max + 0.001) {
    items.push({
      label: `${q.col}${q.amount === 0.5 ? "½" : ""} 획득`,
      fn: () => {
        gainTraitEnergyNow(state_ui_battle_state.game, u, q.col, q.amount, q.reason);
        render();
        if (!processPendingTraitChoice()) scheduleAI();
      }
    });
  } else {
    const need = totalEnergy(u) + q.amount - max,
      token = e => `${e.c}${e.a === 0.5 ? "½" : ""}`,
      seen = new Set();
    store.forEach((e, i) => {
      if (Number(e.a || 0) + 1e-6 < need) return;
      const key = `${e.c}:${e.a}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({
        label: `${token(e)} 하나 버리고 ${q.col}${q.amount === 0.5 ? "½" : ""} 획득`,
        fn: () => {
          const ok = gainEnergy(state_ui_battle_state.game, u, q.col, q.amount, i);
          if (ok) log(state_ui_battle_state.game, `${u.name} 특성 · 에너지 직조: ${q.reason}, ${token(e)} 하나 교체 후 ${q.col}${q.amount === 0.5 ? "½" : ""} 획득.`);
          render();
          if (!processPendingTraitChoice()) scheduleAI();
        }
      });
    });
  }
  items.push(rejectItem);
  openChoice(`<h2>플래피스 · 에너지 직조</h2><p>${q.reason}. 특성을 발동할까요?</p>`, items);
  return true;
}
export function openBloomHealSlider(q) {
  let units = q.targetUids.map(uid => findUnit(state_ui_battle_state.game, uid)).filter(x => x && !x.dead),
    pool = q.pool;
  if (units.length < 2) {
    applyBloomAllocation(state_ui_battle_state.game, units, pool, null, findUnit(state_ui_battle_state.game, q.uid), {
      reason: "blooming-life",
      effectId: "bloomingLife"
    });
    render();
    if (!processPendingTraitChoice()) scheduleAI();
    return;
  }
  let maxLeft = Math.max(0, pool),
    initial = Math.max(0, Math.min(maxLeft, Math.round(maxLeft / 20) * 10));
  state_ui_battle_state.$("#modalContent").innerHTML = `<h2>피어나는생명 회복 분배</h2><p>회복 자원 ${pool}을 10단위 막대로 배분합니다.</p><div class="heal-allocation"><div class="heal-allocation-head"><span>${units[0].name}</span><span>${units[1].name}</span></div><div class="heal-allocation-track"><span id="bloomSplitLeft" class="heal-allocation-left"></span><span id="bloomSplitRight" class="heal-allocation-right"></span><span id="bloomSplitKnob" class="heal-allocation-knob"></span><input id="bloomSlider" type="range" min="0" max="${maxLeft}" step="10" value="${initial}" aria-label="피어나는생명 회복 분배"></div><div class="heal-allocation-values"><span id="bloomSplitLeftValue"></span><span id="bloomSplitRightValue"></span></div></div><button id="bloomSplitConfirm" class="primary">분배 확정</button>`;
  let slider = state_ui_battle_state.$("#bloomSlider"),
    left = state_ui_battle_state.$("#bloomSplitLeft"),
    right = state_ui_battle_state.$("#bloomSplitRight"),
    knob = state_ui_battle_state.$("#bloomSplitKnob"),
    leftValue = state_ui_battle_state.$("#bloomSplitLeftValue"),
    rightValue = state_ui_battle_state.$("#bloomSplitRightValue"),
    show = () => {
      let n = Number(slider.value),
        pct = maxLeft ? n / maxLeft * 100 : 50;
      left.style.width = `${pct}%`;
      right.style.width = `${100 - pct}%`;
      knob.style.left = `${pct}%`;
      leftValue.textContent = `${units[0].name} +${n}`;
      rightValue.textContent = `${units[1].name} +${pool - n}`;
    };
  slider.oninput = show;
  show();
  state_ui_battle_state.$("#bloomSplitConfirm").onclick = () => {
    state_ui_battle_state.$("#modal").classList.remove("open");
    applyBloomAllocation(state_ui_battle_state.game, units, pool, Number(slider.value), findUnit(state_ui_battle_state.game, q.uid), {
      reason: "blooming-life",
      effectId: "bloomingLife"
    });
    render();
    if (!processPendingTraitChoice()) scheduleAI();
  };
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function afterAction() {
  if (state_ui_battle_state.game?.bossRaid) return commitRaidActionPresentation();
  systems.__interactionChoiceR25?.clearTarget?.();
  if ((state_ui_battle_state.game?.mode === "online" || state_ui_battle_state.game?.bossRaid?.online) && state_ui_deck.p2p?.role === "guest" && state_online_commands.OnlineActionAdmissionOwner.hasPending()) {
    state_ui_battle_state.pendingSkill = null;
    systems.OnlineRuntime?.projection?.request?.("guest-command-pending", {
      phase: "IN_BATTLE",
      canonicalRevision: Number(state_ui_battle_state.game?.networkRevision || 0),
      surfaceIntent: "PRESERVE_LOCAL_INPUT"
    });
    return;
  }
  state_ui_battle_state.pendingSkill = null;
  if (state_ui_battle_state.game?.pendingClockTurnAdvance) {
    if (state_ui_battle_state.game.mode === "online" && state_ui_deck.p2p?.role === "host") {
      // Publish effects before local rendering drains them. The turn is still
      // awaiting its clock barrier; its single canonical revision follows later.
      sendAuthoritativeOnlineState(cloneOnlineVisualEvents(state_ui_battle_state.visualEvents), null, true);
    }
    render();
    return;
  }
  const onlineVisuals = state_ui_battle_state.game?.mode === "online" && state_ui_deck.p2p.role === "host" ? cloneOnlineVisualEvents(state_ui_battle_state.visualEvents) : [];
  if (state_ui_battle_state.game?.mode === "online" && state_ui_deck.p2p?.role === "host") {
    broadcastOnlineState(onlineVisuals);
    if (state_ui_battle_state.game.winner) systems.OnlineRuntime?.markBattleEnded?.({
      source: "host-terminal-action-commit",
      canonicalRevision: Number(state_ui_battle_state.game.networkRevision || 0)
    });else systems.OnlineRuntime?.projection?.request?.("host-action-commit", {
      phase: "IN_BATTLE",
      canonicalRevision: Number(state_ui_battle_state.game.networkRevision || 0)
    });
  } else render();
  if (!processPendingTraitChoice()) scheduleAI();
}
export function scheduleAI() {
  if (state_ui_battle_state.game?.bossRaid) return scheduleRaidTurn();
  if (state_features_timeora.timeInputLocked || state_ui_battle_state.game?.pendingClockTurnAdvance) return;
  if (state_ui_battle_state.game?._timeAwaitingNextAiAction) timeMarkTimeline(state_ui_battle_state.game, "aiPlanningStarted", {
    actorEntityId: state_ui_battle_state.game.activeEntityId || null
  });
  const pendingSummon = state_ui_battle_state.game && normalizePendingSummonTurns(state_ui_battle_state.game);
  if (pendingSummon) {
    if (state_ui_battle_state.game.winner || state_ui_battle_state.busy) return;
    if (summonTeamLocallyControlled(state_ui_battle_state.game, pendingSummon.q.team) && state_ui_battle_state.game.mode !== "aivai") return;
    if (state_ui_battle_state.game.mode === "online") return;
    state_ui_battle_state.busy = true;
    state_ui_action_panel.ActionPanelConvergenceOwner.request("automatic-start");
    const summonToken = state_ui_battle_state.game.token,
      summonUid = pendingSummon.u.uid;
    scheduleLocalAutoTurnTimer("manual-summon-ai", (Math.max(Number(state_ui_battle_state.$("#speed")?.value || 900), state_ui_battle_state.visualHoldMs)), () => {
      if (!state_ui_battle_state.game || state_ui_battle_state.game.token !== summonToken) {
        state_ui_battle_state.busy = false;
        return;
      }
      const live = normalizePendingSummonTurns(state_ui_battle_state.game);
      if (!live || live.u.uid !== summonUid) {
        state_ui_battle_state.busy = false;
        render();
        return;
      }
      const action = chooseSummonAIAction(state_ui_battle_state.game, live.q.team, live.u);
      if (!applyManualSummonAction(state_ui_battle_state.game, live.q.team, live.u.uid, action)) applyManualSummonAction(state_ui_battle_state.game, live.q.team, live.u.uid, {
        type: "summonGather"
      });
      state_ui_battle_state.busy = false;
      afterAction();
    });
    return;
  }
  if (!state_ui_battle_state.game || state_ui_battle_state.game.winner || state_ui_battle_state.busy || state_ui_battle_state.game.pendingTraitChoices?.length) return;
  if (state_ui_battle_state.game.mode === "online" && state_ui_deck.p2p?.role === "host" && (state_ui_deck.p2p.onlineStartPending || state_ui_deck.p2p.startCommitPacket && !state_ui_deck.p2p.startCommitAck)) {
    state_ui_battle_state.busy = true;
    systems.OnlineRuntime?.projection?.request?.("battle-start-commit-pending", {
      phase: "IN_BATTLE",
      canonicalRevision: Number(state_ui_battle_state.game.networkRevision || 0),
      surfaceIntent: "PRESERVE_LOCAL_INPUT"
    });
    return;
  }
  prepareCurrentTurn(state_ui_battle_state.game);
  let [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    token = state_ui_battle_state.game.token,
    serial = state_ui_battle_state.game.turnSerial,
    actions = legalActions(state_ui_battle_state.game, t, s),
    noLegalActions = actions.length === 0,
    forcedAction = forcedRuleAction(actions),
    forced = !!forcedAction || noLegalActions;
  if (state_ui_battle_state.game.mode === "online") {
    // PvP automatic commands are game rules, not AI turns. The host alone executes them
    // and sends the resulting authoritative state to both clients.
    if (!forced || state_ui_deck.p2p?.role !== "host") return;
    if (state_ui_battle_state.onlineAutoCommandOwner) return;
    const automaticOwner = {
      game: state_ui_battle_state.game,
      token,
      serial,
      actionId: forcedAction?.actionId || `${state_ui_battle_state.game.battleId || state_ui_battle_state.game.matchId}:automatic:${serial}:${noLegalActions ? "no-legal-actions" : forcedAction?.type || "forced"}`
    };
    state_ui_battle_state.onlineAutoCommandOwner = automaticOwner;
    state_ui_battle_state.onlineAutoCommandActive = true;
    state_ui_battle_state.busy = true;
    systems.OnlineRuntime?.projection?.request?.("automatic-scheduled", {
      phase: "IN_BATTLE",
      canonicalRevision: Number(state_ui_battle_state.game.networkRevision || 0),
      surfaceIntent: "PRESERVE_LOCAL_INPUT"
    });
    const runAutomatic = () => {
      if (state_ui_battle_state.onlineAutoCommandOwner !== automaticOwner) return;
      automaticOwner.timerId = 0;
      if (!state_ui_battle_state.game || state_ui_battle_state.game.token !== token || state_ui_battle_state.game.turnSerial !== serial || state_ui_battle_state.game.winner) {
        state_ui_battle_state.onlineAutoCommandOwner = null;
        state_ui_battle_state.onlineAutoCommandActive = false;
        state_ui_battle_state.busy = false;
        systems.OnlineRuntime?.projection?.request?.("automatic-stale", {
          phase: "IN_BATTLE",
          canonicalRevision: Number(state_ui_battle_state.game.networkRevision || 0)
        });
        return;
      }
      let executed = false;
      try {
        const automaticAction = noLegalActions ? {
          type: "noLegalPass",
          actionId: automaticOwner.actionId,
          expectedTurnSerial: serial
        } : forcedAction;
        executed = !!execute(state_ui_battle_state.game, t, s, automaticAction, {
          admissionSource: "host-automatic"
        });
      } catch (error) {
        executed = false;
        systems.__megaRecordRecoveredError?.(error, "scheduleAI.online-automatic");
        if (systems.DEBUG_BATTLE_EVENTS) console.error("[online auto-command]", error);
      }
      if (state_ui_battle_state.onlineAutoCommandOwner !== automaticOwner) return;
      state_ui_battle_state.onlineAutoCommandOwner = null;
      state_ui_battle_state.onlineAutoCommandActive = false;
      state_ui_battle_state.busy = false;
      if (!executed) {
        systems.__megaRecordRecoveredError?.(new Error("ONLINE_AUTOMATIC_ACTION_REJECTED"), "scheduleAI.online-automatic");
        systems.OnlineRuntime?.projection?.request?.("automatic-rejected", {
          phase: "IN_BATTLE",
          canonicalRevision: Number(state_ui_battle_state.game.networkRevision || 0)
        });
        return;
      }
      afterAction();
    };
    const delay = (Math.max(Number(state_ui_battle_state.$("#speed")?.value || 900), state_ui_battle_state.visualHoldMs));
    const scope = systems.OnlineRuntime?.sessionScope;
    if (!scope || scope.closed) {
      state_ui_battle_state.onlineAutoCommandOwner = null;
      state_ui_battle_state.onlineAutoCommandActive = false;
      state_ui_battle_state.busy = false;
      return;
    }
    automaticOwner.timerId = scope.setTimeout(runAutomatic, delay, "pvp-online-automatic", {
      phase: "IN_BATTLE"
    });
    return;
  }
  if (t === "P" && state_ui_battle_state.game.mode === "human" && !forced) return;
  state_ui_battle_state.busy = true;
  state_ui_action_panel.ActionPanelConvergenceOwner.request("automatic-dispatch");
  scheduleLocalAutoTurnTimer(forced ? `scheduled:${forcedAction?.type || "forced"}` : "ai-turn", (Math.max(Number(state_ui_battle_state.$("#speed")?.value || 900), state_ui_battle_state.visualHoldMs)), () => {
    if (!state_ui_battle_state.game || state_ui_battle_state.game.token !== token || state_ui_battle_state.game.turnSerial !== serial) {
      state_ui_battle_state.busy = false;
      return;
    }
    if (state_ui_battle_state.game.winner) {
      state_ui_battle_state.busy = false;
      return;
    }
    let a = null,
      reason = "",
      executed = false;
    try {
      const view = maskedStateFor(state_ui_battle_state.game, t);
      a = noLegalActions ? null : forced ? forcedAction : chooseAI(view, t, s, false);
      reason = a && !forced ? aiReason(view, t, s, a) : "";
      if (noLegalActions) {
        log(state_ui_battle_state.game, `${u?.name || "빈 슬롯"}: 가능한 행동이 없어 턴을 자동으로 넘김.`, "turn");
        endTurn(state_ui_battle_state.game, t, s, false);
        executed = true;
      } else executed = a ? execute(state_ui_battle_state.game, t, s, a) : false;
      if (a && executed && reason) log(state_ui_battle_state.game, `AI 판단: ${reason}`, "aiwhy");
    } catch (error) {
      systems.__megaRecordRecoveredError?.(error, "scheduleAI.local-auto");
      if (systems.DEBUG_BATTLE_EVENTS) console.error("[local auto-turn]", error);
    }
    if (!executed) {
      try {
        const live = legalActions(state_ui_battle_state.game, t, s),
          fallback = live[0];
        if (fallback) executed = execute(state_ui_battle_state.game, t, s, fallback);
      } catch (error) {
        systems.__megaRecordRecoveredError?.(error, "scheduleAI.local-fallback");
      }
      if (!executed) {
        log(state_ui_battle_state.game, `${u?.name || "빈 슬롯"}: AI 행동 처리 실패, 턴을 안전하게 종료.`, "turn");
        endTurn(state_ui_battle_state.game, t, s, false);
      }
    }
    state_ui_battle_state.busy = false;
    render();
    try {
      if (!processPendingTraitChoice()) scheduleAI();
    } catch (error) {
      systems.__megaRecordRecoveredError?.(error, "scheduleAI.local-continuation");
      state_ui_battle_state.busy = false;
      state_ui_action_panel.ActionPanelConvergenceOwner.request("automatic-cleanup");
      scheduleAI();
    }
  });
}
export function startBattle(seedOverride, onlineConfig = null) {
  const isOnline = onlineConfig?.mode === "online";
  const onlineScope = isOnline ? String(onlineConfig?.matchId || state_ui_deck.p2p?.matchId || seedOverride || onlineConfig?.coinResult?.id || state_ui_deck.p2p?.roomCode || "online") : null;
  if (isOnline && state_ui_deck.p2p?.__startedOnlineScope === onlineScope && state_ui_battle_state.game?.mode === "online") {
    if (systems.DEBUG_BATTLE_EVENTS) console.warn("[online] duplicate start blocked", onlineScope);
    return state_ui_battle_state.game;
  }
  const sharedRules = isOnline ? {
    ...state_ui_deck.ONLINE_COMMON_RULES,
    ...(onlineConfig?.rules || state_ui_deck.p2p.rules || {}),
    variance: false,
    difficulty: "normal"
  } : null;
  const battleLeague = state_ui_deck.LeagueFormatOwner.normalizeLeague(isOnline ? sharedRules.league || state_ui_deck.leagueSelection : state_ui_deck.leagueSelection),
    fallbackComposition = battleLeague === "comprehensive" ? state_ui_deck.LeagueFormatOwner.normalizeComposition(isOnline ? state_ui_deck.p2p?.localComposition || sharedRules.composition || state_ui_deck.comprehensiveComposition : state_ui_deck.comprehensiveComposition) : state_ui_deck.comprehensiveComposition;
  let seed = seedOverride || state_ui_battle_state.$("#seedInput").value.trim() || String(Date.now()),
    pDeck = onlineConfig?.pDeck || [...state_ui_battle_state.selected],
    aDeck = onlineConfig?.aDeck || buildAIDeck(seed, battleLeague, fallbackComposition),
    battlePlusStar = onlineConfig?.plusStar || {
      P: state_ui_deck.plusStarSelection,
      A: onlineConfig?.remotePlusStar || null
    },
    battleCompositions = state_ui_deck.LeagueFormatOwner.normalizeTeamCompositions(battleLeague, onlineConfig?.leagueCompositions || onlineConfig?.compositions || sharedRules?.compositions || {
      P: fallbackComposition,
      A: isOnline ? state_ui_deck.p2p?.remoteComposition || null : fallbackComposition
    }, {
      P: pDeck,
      A: aDeck
    }, battlePlusStar),
    battleComposition = battleCompositions.P;
  if (!state_ui_deck.LeagueFormatOwner.completeValid(pDeck, battleLeague, battleCompositions.P, battlePlusStar?.P || null, "P") || !state_ui_deck.LeagueFormatOwner.completeValid(aDeck, battleLeague, battleCompositions.A, battlePlusStar?.A || null, "A")) return;
  clearLocalAutoTurnTimer("battle-start");
  state_ui_battle_state.localBackgroundAutoTurnOwner = null;
  state_ui_battle_state.localBattleBackgrounded = false;
  state_ui_battle_state.game = newGame(pDeck, aDeck, {
    seed,
    variance: isOnline ? false : state_ui_battle_state.$("#variance").checked,
    difficulty: isOnline ? "normal" : state_ui_battle_state.$("#difficulty").value,
    mode: onlineConfig?.mode || state_ui_battle_state.$("#mode").value,
    league: battleLeague,
    leagueComposition: battleLeague === "comprehensive" ? battleComposition : null,
    leagueCompositions: battleCompositions,
    firstTeam: onlineConfig?.firstTeam || null,
    onlineCoin: onlineConfig?.coinResult || null,
    plusStar: battlePlusStar
  });
  if (isOnline && state_ui_battle_state.game?.mode === "online") {
    state_ui_deck.p2p.playerId ||= stableOnlinePlayerId();
    state_ui_deck.p2p.matchId ||= state_ui_battle_state.game.matchId || seedOverride || randomId("match");
    state_ui_battle_state.game.matchId = state_ui_deck.p2p.matchId;
    state_ui_battle_state.game.battleStarted = true;
    state_ui_battle_state.game.onlineMatchType = state_ui_deck.p2p.sessionMode || state_ui_deck.p2p.matchType || "roomCode";
    state_ui_deck.p2p.battleStarted = true;
    state_ui_deck.p2p.__startedOnlineScope = onlineScope;
    state_online_commands.onlineAuthoritativeRevision = 0;
    state_ui_deck.p2p.lastAuthoritativeRevision = 0;
    state_online_commands.OnlineActionAdmissionOwner.resetBattle();
    state_online_commands.OnlineActionAdmissionOwner.startProbe();
  }
  state_ui_battle_state.lastBattleConfig = {
    pDeck: [...pDeck],
    aDeck: [...aDeck],
    seed,
    league: battleLeague,
    leagueComposition: battleLeague === "comprehensive" ? battleComposition : null,
    leagueCompositions: battleCompositions,
    plusStar: {
      ...(state_ui_battle_state.game.teams ? {
        P: state_ui_battle_state.game.teams.P.plusStarSlotId,
        A: state_ui_battle_state.game.teams.A.plusStarSlotId
      } : {})
    }
  };
  state_ui_battle_state.game.token = ++state_ui_battle_state.battleToken;
  state_ui_battle_state.onlineAutoCommandOwner = null;
  state_ui_battle_state.onlineAutoCommandActive = false;
  state_ui_battle_state.busy = false;
  state_ui_battle_state.lastLog = 0;
  state_ui_battle_state.visualEvents = [];
  state_ui_battle_state.visualHoldMs = 0;
  state_ui_battle_state.$("#log").innerHTML = "";
  log(state_ui_battle_state.game, `${state_ui_battle_state.game.matchType} 시작. 피해 난수 ${state_ui_battle_state.game.variance ? "ON" : "OFF"}. 상대 후열은 미공개.`, "turn");
  state_ui_results.NavigationApplication.request("game");
  if (isOnline) {
    state_ui_battle_state.$("#modal")?.classList.remove("open", "online-room-r22", "online-room-closing");
    document.body.classList.remove("online-lobby-open");
  }
  render();
  startBgm();
  scheduleAI();
  if (typeof specIsHostMatch === "function" && specIsHostMatch()) {
    const timerId = systems.OnlineRuntime?.sessionScope?.setTimeout?.(specStartHostBroadcast, 120, "spectator-host-start-broadcast", {
      phase: "IN_BATTLE"
    });
  }
}

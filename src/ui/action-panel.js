// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_ui_action_panel = {
  ActionPanelViewModelOwner: undefined,
  ActionRenderEngine: undefined,
  ActionPanelConvergenceOwner: undefined
};
import { eternaLocksTeam } from "../app/controls.js";
import { state_catalog_cards } from "../catalog/cards.js";
import { unitAt } from "../engine/actions.js";
import { memoryOptions } from "../engine/effects.js";
import { energyStore, status, totalEnergy, transformedSkillReq } from "../engine/energy.js";
import { actionSkillHasEffect, actionSkillHasTag, card, cardHasCapability, firstSkillByTag, skillDefHasEffect } from "../engine/entities.js";
import { execute } from "../engine/execution.js";
import { openDragonMemoryMenu } from "../features/elixian.js";
import { previewCustomGatherProposal } from "../features/summons.js";
import { state_online_commands } from "../online/commands.js";
import { log, normalizeGameNumberText } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
import { afterAction, playerGather, scheduleAI, startBattle } from "./action-choices.js";
import { scheduleLocalAutoTurnTimer, state_ui_battle_state } from "./battle-state.js";
import { state_ui_deck } from "./deck.js";
import { actionButton, openSwitchPayment } from "./payment.js";
import { state_ui_results } from "./results.js";
import { state_ui_setup } from "./setup.js";
import { actionPanelSurfaceContext, chooseOrExecute } from "./targeting.js";
export function initializeUiActionPanel() {
  state_ui_action_panel.ActionPanelViewModelOwner = Object.freeze({
    build(g = state_ui_battle_state.game, projection = null) {
      const surface = actionPanelSurfaceContext(g);
      const inputProjection = projection || state_ui_setup.LocalInputEligibility.evaluate(g, surface.eligibilityContext);
      const pair = surface.eligibilityContext?.actorTeam != null ? [surface.eligibilityContext.actorTeam, surface.eligibilityContext.actorSlot ?? null] : g?.order?.[g?.turn] || [];
      const actor = surface.eligibilityContext?.actor || (pair.length ? unitAt(g, pair[0], pair[1]) : null);
      const freezeAction = action => Object.freeze({
        ...(action || {}),
        paymentPlans: Array.isArray(action?.paymentPlans) ? Object.freeze(action.paymentPlans.map(plan => Object.freeze({
          ...plan
        }))) : action?.paymentPlans,
        paymentRequirements: action?.paymentRequirements ? Object.freeze({
          ...action.paymentRequirements
        }) : null
      });
      const actions = Object.freeze([...(inputProjection.actions || [])].map(freezeAction));
      const actionKeys = Object.freeze(actions.map((action, index) => [index, action?.type || "", action?.skill || "", action?.actor || "", action?.target?.team || "", action?.target?.slot ?? "", action?.targetUid || action?.targetInstanceId || "", action?.label || "", action?.costOverride || action?.displayCost || action?.paymentRequirements?.cost || "", action?.actionId || "", action?.transactionId || ""].join(":")));
      const pendingInteraction = !!(typeof state_ui_battle_state.pendingSkill !== "undefined" && state_ui_battle_state.pendingSkill) || !!g?.pendingTargetSelection || !!g?.pendingPayment || !!surface.manualSummon?.pendingSubmitted;
      const canonicalRevision = Number(g?.networkRevision ?? g?.revision ?? 0);
      const authoritativeDigest = String(g?.authoritativeDigest || g?.stateDigest || g?.digest || "");
      const surfaceSignature = surface.manualSummon ? {
        actionId: surface.manualSummon.actionId,
        transactionId: surface.manualSummon.transactionId,
        sourceInstanceId: surface.manualSummon.sourceInstanceId,
        candidateIdentity: surface.manualSummon.candidateIdentity,
        pendingSubmitted: surface.manualSummon.pendingSubmitted
      } : surface.boss ? {
        online: surface.boss.online,
        localControl: surface.boss.localControl
      } : null;
      const signature = JSON.stringify({
        battleId: g?.battleId || g?.matchId || null,
        canonicalRevision,
        authoritativeDigest,
        turnSerial: Number(g?.turnSerial || 0),
        surfaceKind: surface.kind,
        surfaceSignature,
        currentActorUid: inputProjection.currentActorUid || null,
        currentActorTeam: inputProjection.currentActorCanonicalTeam || null,
        localTeam: inputProjection.canonicalLocalTeam || null,
        canAct: inputProjection.canAct === true,
        reasons: [...(inputProjection.reasons || [])],
        busy: !!state_ui_battle_state.busy,
        pendingInteraction,
        pendingActionId: inputProjection.pendingActionId || surface.manualSummon?.actionId || null,
        terminal: !!(g?.winner || g?.ended),
        actionKeys
      });
      return Object.freeze({
        game: g,
        projection: inputProjection,
        actions,
        actionKeys,
        signature,
        canonicalRevision,
        authoritativeDigest,
        turnSerial: Number(g?.turnSerial || 0),
        battleId: g?.battleId || g?.matchId || null,
        actor,
        actorTeam: pair[0] ?? null,
        actorSlot: pair[1] ?? null,
        surfaceKind: surface.kind,
        manualSummon: surface.manualSummon,
        boss: surface.boss,
        pendingInteraction,
        terminal: !!(g?.winner || g?.ended)
      });
    }
  });
  state_ui_action_panel.ActionRenderEngine = (() => {
    const routes = new Map(),
      decorators = new Map();
    let renderSerial = 0,
      lastRender = null;
    const ordered = map => [...map.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const registerRoute = (id, priority, when, render) => {
      if (!id || typeof when !== "function" || typeof render !== "function") throw new TypeError("invalid action render route");
      routes.set(String(id), {
        id: String(id),
        priority: Number(priority) || 0,
        when,
        render
      });
      return () => routes.delete(String(id));
    };
    const registerDecorator = (id, priority, decorate, when = () => true) => {
      if (!id || typeof decorate !== "function" || typeof when !== "function") throw new TypeError("invalid action render decorator");
      decorators.set(String(id), {
        id: String(id),
        priority: Number(priority) || 0,
        decorate,
        when
      });
      return () => decorators.delete(String(id));
    };
    const context = viewModel => {
      const pair = state_ui_battle_state.game?.order?.[state_ui_battle_state.game.turn] || [];
      return {
        game: state_ui_battle_state.game,
        team: pair[0],
        slot: pair[1],
        unit: pair.length ? unitAt(state_ui_battle_state.game, pair[0], pair[1]) : null,
        box: document.getElementById("actionButtons"),
        viewModel
      };
    };
    const render = (viewModel = null, requestReason = "unspecified") => {
      const panelView = viewModel || state_ui_action_panel.ActionPanelViewModelOwner.build(state_ui_battle_state.game);
      let ctx = context(panelView),
        result;
      const route = ordered(routes).find(entry => entry.when(ctx));
      result = route ? route.render(ctx) : renderBaseActions(panelView);
      ctx = context(panelView);
      for (const entry of ordered(decorators)) if (entry.when(ctx)) entry.decorate(ctx, result);
      const projection = panelView.projection;
      const buttons = [...(ctx.box?.querySelectorAll("button") || [])];
      const actionButtons = buttons.filter(button => !button.dataset.actionPanelMeta);
      const fingerprint = actionButtons.map(button => `${button.disabled ? "0" : "1"}:${button.textContent?.replace(/\s+/g, " ").trim() || ""}`).join("|");
      lastRender = Object.freeze({
        renderSerial: ++renderSerial,
        renderedAt: Date.now(),
        requestReason: String(requestReason || "unspecified"),
        routeId: route?.id || "base",
        battleId: panelView.battleId,
        sessionGeneration: Number(systems.OnlineRuntime?.debug?.().generation || 0),
        networkRevision: panelView.canonicalRevision,
        authoritativeRevision: Number(projection.authoritativeRevision || 0),
        actionPanelViewModelRevision: panelView.canonicalRevision,
        renderedDomRevision: panelView.canonicalRevision,
        viewModelSignature: panelView.signature,
        turnSerial: panelView.turnSerial,
        actorUid: projection.currentActorUid || null,
        actorCanonicalTeam: projection.currentActorCanonicalTeam || null,
        localCanonicalTeam: projection.canonicalLocalTeam || null,
        canAct: projection.canAct,
        reasons: [...projection.reasons],
        legalActionCount: Number(projection.legalActionCount || 0),
        manualLegalActionCount: Number(projection.manualLegalActionCount || 0),
        buttonCount: buttons.length,
        actionButtonCount: actionButtons.length,
        enabledButtonCount: actionButtons.filter(button => !button.disabled).length,
        buttonFingerprint: fingerprint,
        gatherRendered: actionButtons.some(button => button.textContent?.includes("에너지 모으기"))
      });
      return result;
    };
    return Object.freeze({
      registerRoute,
      registerDecorator,
      render,
      base: () => state_ui_action_panel.ActionPanelConvergenceOwner.request("action-render-base-api", {
        force: true
      }),
      reset: (reason = "session-boundary") => {
        renderSerial = 0;
        lastRender = null;
        const box = document.getElementById("actionButtons");
        if (box) box.innerHTML = "";
        return Object.freeze({
          reason: String(reason),
          renderSerial,
          lastRender: null
        });
      },
      snapshot: () => ({
        routes: ordered(routes).map(x => ({
          id: x.id,
          priority: x.priority
        })),
        decorators: ordered(decorators).map(x => ({
          id: x.id,
          priority: x.priority
        })),
        renderSerial,
        lastRender: lastRender ? {
          ...lastRender,
          reasons: [...lastRender.reasons]
        } : null
      })
    });
  })();
  state_ui_action_panel.ActionPanelConvergenceOwner = (() => {
    let requestSerial = 0,
      commitSerial = 0,
      skippedDuplicateCount = 0,
      lastRequest = null;
    const domState = () => {
      const root = document.getElementById("actionButtons");
      const buttons = [...(root?.querySelectorAll("button") || [])];
      const actionButtons = buttons.filter(button => !button.dataset.actionPanelMeta);
      return Object.freeze({
        rootConnected: !!root?.isConnected,
        buttonCount: buttons.length,
        actionButtonCount: actionButtons.length,
        enabledActionButtonCount: actionButtons.filter(button => !button.disabled).length,
        fingerprint: actionButtons.map(button => `${button.disabled ? "0" : "1"}:${button.textContent?.replace(/\s+/g, " ").trim() || ""}`).join("|")
      });
    };
    const mustBeEmpty = view => {
      const reasons = view.projection.reasons || [];
      return view.terminal || reasons.some(reason => ["REMOTE_ACTOR_TURN", "SPECTATOR_READ_ONLY", "AI_CONTROLLED_MODE", "PENDING_AUTHORITATIVE_ACTION", "PENDING_ONLINE_ACTION", "APPLICATION_BUSY", "TRANSPORT_NOT_CONNECTED", "BATTLE_START_NOT_COMMITTED", "RECONNECTING", "CLOCK_INPUT_LOCK", "ACTIVE_INPUT_LOCK"].includes(reason));
    };
    const matches = (view, renderState = state_ui_action_panel.ActionRenderEngine.snapshot(), dom = domState()) => {
      const prior = renderState.lastRender;
      if (!prior || prior.viewModelSignature !== view.signature) return false;
      if (Number(prior.actionPanelViewModelRevision || 0) !== Number(view.canonicalRevision || 0)) return false;
      if (Number(prior.renderedDomRevision || 0) !== Number(view.canonicalRevision || 0)) return false;
      if (prior.actorUid !== (view.projection.currentActorUid || null)) return false;
      if (prior.localCanonicalTeam !== (view.projection.canonicalLocalTeam || null)) return false;
      if (prior.buttonFingerprint !== dom.fingerprint) return false;
      if (mustBeEmpty(view)) return dom.actionButtonCount === 0;
      if (view.projection.canAct && view.projection.manualLegalActionCount > 0) return dom.enabledActionButtonCount > 0;
      return true;
    };
    const suspend = (reason = "action-panel-suspend") => {
      const root = document.getElementById("actionButtons"),
        buttons = [...(root?.querySelectorAll("button") || [])];
      if (root) root.dataset.actionPanelSuspended = String(reason || "suspended");
      for (const button of buttons) {
        if (button.dataset.actionPanelMeta === "terminal") continue;
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }
      const state = domState();
      lastRequest = Object.freeze({
        requestId: ++requestSerial,
        reason: String(reason),
        committed: true,
        coherent: true,
        suspended: true,
        signature: null,
        canonicalRevision: Number(state_ui_battle_state.game?.networkRevision || 0),
        turnSerial: Number(state_ui_battle_state.game?.turnSerial || 0),
        actorUid: null,
        dom: state,
        at: Date.now()
      });
      return lastRequest;
    };
    const request = (reason = "action-panel-convergence", options = {}) => {
      const view = state_ui_action_panel.ActionPanelViewModelOwner.build(state_ui_battle_state.game);
      const root = document.getElementById("actionButtons");
      if (root) delete root.dataset.actionPanelSuspended;
      const before = state_ui_action_panel.ActionRenderEngine.snapshot(),
        beforeDom = domState();
      const coherent = !options.force && matches(view, before, beforeDom);
      const requestId = ++requestSerial;
      if (coherent) {
        skippedDuplicateCount++;
        lastRequest = Object.freeze({
          requestId,
          reason: String(reason),
          committed: false,
          coherent: true,
          signature: view.signature,
          canonicalRevision: view.canonicalRevision,
          turnSerial: view.turnSerial,
          actorUid: view.projection.currentActorUid || null,
          dom: beforeDom,
          at: Date.now()
        });
        return lastRequest;
      }
      state_ui_action_panel.ActionRenderEngine.render(view, reason);
      commitSerial++;
      const after = state_ui_action_panel.ActionRenderEngine.snapshot(),
        afterDom = domState();
      const converged = matches(view, after, afterDom);
      lastRequest = Object.freeze({
        requestId,
        reason: String(reason),
        committed: true,
        coherent: converged,
        signature: view.signature,
        canonicalRevision: view.canonicalRevision,
        turnSerial: view.turnSerial,
        actorUid: view.projection.currentActorUid || null,
        dom: afterDom,
        at: Date.now()
      });
      return lastRequest;
    };
    return Object.freeze({
      request,
      suspend,
      matches,
      reset: (reason = "session-boundary") => {
        requestSerial = 0;
        commitSerial = 0;
        skippedDuplicateCount = 0;
        lastRequest = null;
        state_ui_action_panel.ActionRenderEngine.reset(reason);
        return Object.freeze({
          reason: String(reason),
          requestSerial,
          commitSerial,
          lastRequest: null,
          render: state_ui_action_panel.ActionRenderEngine.snapshot(),
          dom: {
            ...domState()
          }
        });
      },
      snapshot: () => ({
        requestSerial,
        commitSerial,
        skippedDuplicateCount,
        lastRequest: lastRequest ? {
          ...lastRequest,
          dom: {
            ...lastRequest.dom
          }
        } : null,
        render: state_ui_action_panel.ActionRenderEngine.snapshot(),
        dom: {
          ...domState()
        }
      })
    });
  })();
}
export function renderBaseActions(viewModel = null) {
  const panelView = viewModel || state_ui_action_panel.ActionPanelViewModelOwner.build(state_ui_battle_state.game);
  let box = state_ui_battle_state.$("#actionButtons"),
    t = panelView.actorTeam,
    s = panelView.actorSlot,
    u = panelView.actor;
  const inputProjection = panelView.projection;
  box.innerHTML = "";
  let dual = cardHasCapability(u, "dualActor") && state_ui_battle_state.game.dualActorController?.uid === u.uid ? ` · ${state_ui_battle_state.game.dualActorController.actor === "beast" ? "빙마 행동" : "기수 행동"}` : "";
  state_ui_battle_state.$("#actionTitle").textContent = state_ui_battle_state.game.winner ? "전투 종료" : state_ui_battle_state.busy ? state_ui_battle_state.game?.mode === "online" ? state_ui_battle_state.onlineAutoCommandActive ? "예약 행동 처리 중…" : state_online_commands.OnlineActionAdmissionOwner.hasPending() ? "행동 동기화 중…" : "온라인 처리 중…" : "AI 계산 중…" : inputProjection.ownsCurrentActor ? u && !u.dead ? `${u.name}${dual}` : `슬롯 ${s + 1} 출전` : state_ui_battle_state.game.mode === "online" ? "상대 행동 대기 중…" : "자동 진행 중";
  state_ui_battle_state.$("#actionHint").textContent = state_ui_battle_state.pendingSkill ? "유효한 대상을 선택하세요." : state_ui_battle_state.game.fieldEffect?.type === "grand" ? `그랜드필드: ${state_ui_battle_state.game.fieldEffect.team === "P" ? "플레이어" : "AI"} 진영 소유` : "";
  if (state_ui_battle_state.game.winner) {
    box.innerHTML = '<button id="sameRestart" data-action-panel-meta="terminal">같은 조건으로 재시작</button><button data-nav="setup" data-action-panel-meta="terminal">메인 메뉴</button>';
    state_ui_battle_state.$("#sameRestart").onclick = () => startBattle(state_ui_battle_state.game.seed);
    box.querySelector("[data-nav]").onclick = () => state_ui_results.NavigationApplication.request("setup");
    return;
  }
  let controllable = inputProjection.ownsCurrentActor,
    acts = inputProjection.actions;
  if (!acts.length) {
    state_ui_battle_state.$("#actionHint").textContent = "행동 불가 · 자동으로 턴을 넘깁니다.";
    return;
  }
  if (state_ui_battle_state.busy || !controllable || !inputProjection.canAct) return;
  if (!u || u.dead) {
    acts.forEach(a => actionButton(box, a.label, () => {
      const executed = execute(state_ui_battle_state.game, t, s, a);
      if (executed) afterAction();
    }));
    return;
  }
  let speedDelay = acts.find(a => a.type === "speedDelay");
  if (speedDelay) {
    let token = state_ui_battle_state.game.token,
      serial = state_ui_battle_state.game.turnSerial;
    state_ui_battle_state.busy = true;
    state_ui_action_panel.ActionPanelConvergenceOwner.request("interaction-choice");
    scheduleLocalAutoTurnTimer("speed-delay", (550), () => {
      if (!state_ui_battle_state.game || state_ui_battle_state.game.winner || state_ui_battle_state.game.token !== token || state_ui_battle_state.game.turnSerial !== serial) {
        state_ui_battle_state.busy = false;
        return;
      }
      const executed = execute(state_ui_battle_state.game, t, s, speedDelay);
      state_ui_battle_state.busy = false;
      if (executed) afterAction();
    });
    return;
  }
  let scheduled = acts.find(a => a.type === "scheduled");
  if (scheduled) {
    if (state_ui_battle_state.game.mode === "online") {
      state_ui_battle_state.$("#actionTitle").textContent = state_ui_deck.p2p?.role === "host" ? "예약 행동 처리 중…" : "예약 행동 동기화 중…";
      scheduleAI();
      return;
    }
    const executed = execute(state_ui_battle_state.game, t, s, scheduled);
    if (executed) afterAction();
    return;
  }
  if (!inputProjection.canAct) return;
  for (const a of acts.filter(a => ["gather", "switch", "dualPass"].includes(a.type))) {
    actionButton(box, a.label, () => a.type === "gather" ? playerGather(a) : a.type === "switch" ? openSwitchPayment(a) : (() => {
      const executed = execute(state_ui_battle_state.game, t, s, a);
      if (executed) afterAction();
    })());
  }
  if (eternaLocksTeam(state_ui_battle_state.game, t) && state_ui_battle_state.game.teams[t].bench.some(x => x && !x.dead)) {
    const lock = actionButton(box, "교체 불가 · 이터너", () => {});
    lock.disabled = true;
    lock.title = "이터너의 특성으로 교체할 수 없습니다.";
  }
  const memorySkill = firstSkillByTag(u, "copy");
  if (memorySkill && !u.skillSeals?.[memorySkill.id] && memoryOptions(state_ui_battle_state.game, t, u).length) {
    const memoryButton = document.createElement("button");
    memoryButton.className = "skillbtn";
    memoryButton.dataset.skillId = memorySkill.id;
    memoryButton.innerHTML = `<b>${normalizeGameNumberText(memorySkill.name)}</b> <span class="cost">0</span><br><span class="tiny">${normalizeGameNumberText(memorySkill.desc)}</span>`;
    memoryButton.onclick = openDragonMemoryMenu;
    box.appendChild(memoryButton);
  }
  let skillActs = acts.filter(a => a.type === "skill" && !actionSkillHasTag(a, "copy")),
    groups = new Map();
  for (const a of skillActs) {
    let key = a.skill;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  for (const candidates of groups.values()) {
    let a = candidates[0],
      sk = card(u).skills.find(x => x.id === a.skill) || {
        id: a.skill || "",
        name: a.label || "기술",
        desc: "",
        cost: a.costOverride || "",
        target: "self"
      },
      label = sk.name || a.label || "기술";
    let rawCost = a.costOverride ?? (skillDefHasEffect(sk, "hurricaneDive") ? "W*" : sk.cost),
      shownCost = a.displayCost || transformedSkillReq(state_ui_battle_state.game, t, u, rawCost).tokens.join(" ") || "없음",
      b = document.createElement("button");
    b.className = "skillbtn";
    if (sk?.id) b.dataset.skillId = sk.id;
    if (actionSkillHasEffect(a, "foxStrike")) {
      const singleOk = candidates.some(x => x.strikeMode === "single"),
        doubleOk = candidates.some(x => x.strikeMode === "double");
      b.innerHTML = `<span class="skill-heading"><b>${label}</b><span class="fox-cost-inline"><span class="${singleOk ? "" : "fox-cost-off"}">*</span><span>or</span><span class="${doubleOk ? "" : "fox-cost-off"}">**</span></span></span><br><span class="tiny">일반 80D · 강화 140D</span>`;
    } else {
      b.innerHTML = `<span class="skill-heading"><b>${normalizeGameNumberText(label) || "기술"}</b><span class="cost">${normalizeGameNumberText(shownCost) || "없음"}</span></span><br><span class="tiny">${normalizeGameNumberText(state_catalog_cards.EffectiveCardPresentationOwner.skill(u, sk).description)}</span>`;
    }
    b.onclick = () => chooseOrExecute(candidates, sk.target === "enemySlot");
    box.appendChild(b);
  }
}
export function openCustomNaturalGather(a, t, s, u) {
  const store = energyStore(u),
    amt = status(u, "slow") ? .5 : 1,
    existingHalf = amt === .5 ? store.find(e => e.a === .5) : null,
    proposal = previewCustomGatherProposal(state_ui_battle_state.game, t, s, u, amt),
    col = proposal?.color,
    max = card(u).maxEnergy || 4,
    overflow = totalEnergy(u) + amt - max;
  if (!proposal || !col) return;
  a.gatherProposal = proposal;
  delete a.forcedDirectColor;
  if (existingHalf) log(state_ui_battle_state.game, `${u.name}: 기존 ${col} 반에너지와 합치기 위해 자연 수급 색이 ${col}로 고정.`);
  if (overflow <= .001) {
    if (execute(state_ui_battle_state.game, t, s, a)) afterAction();
    return;
  }
  const seen = new Set(),
    root = state_ui_battle_state.$("#modalContent");
  root.innerHTML = `<h2>${u.name} 에너지 최대</h2><p>이번 직접 수급은 <b>${col}${amt === .5 ? "½" : ""}</b>. 기존 에너지 하나만 버릴 수 있습니다.${Math.abs(totalEnergy(u) - 3.5) < .001 ? " 현재 3.5E이므로 반에너지 하나도 선택 가능합니다." : ""}</p><div id="jcDiscard" class="choice-list"></div><div class="choice-list"><button id="jcDiscardNew">새 에너지 포기</button><button id="jcGatherCancel">취소</button></div>`;
  const box = state_ui_battle_state.$("#jcDiscard");
  store.forEach((e, i) => {
    if (e.a + .001 < overflow) return;
    const key = `${e.c}:${e.a}`;
    if (seen.has(key)) return;
    seen.add(key);
    const b = document.createElement("button");
    b.textContent = `${e.c}${e.a === .5 ? "½" : ""} 하나 버리기`;
    b.onclick = () => {
      state_ui_battle_state.$("#modal").classList.remove("open");
      a.replaceIndex = i;
      delete a.replaceIndices;
      if (execute(state_ui_battle_state.game, t, s, a)) afterAction();
    };
    box.appendChild(b);
  });
  if (!box.children.length) box.innerHTML = '<p class="muted">에너지 하나만 버려서는 새 에너지를 보관할 수 없습니다.</p>';
  state_ui_battle_state.$("#jcDiscardNew").onclick = () => {
    state_ui_battle_state.$("#modal").classList.remove("open");
    a.discardNew = true;
    delete a.replaceIndex;
    delete a.replaceIndices;
    if (execute(state_ui_battle_state.game, t, s, a)) afterAction();
  };
  state_ui_battle_state.$("#jcGatherCancel").onclick = () => state_ui_battle_state.$("#modal").classList.remove("open");
  state_ui_battle_state.$("#modal").classList.add("open");
}

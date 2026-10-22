import { TimerManager } from "../runtime/timers.js";
// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_features_foxious = {
  FOXIOUS_CARD: undefined,
  FOX_CYCLE: undefined
};
import { state_catalog_cards } from "../catalog/cards.js";
import { enemyTargets, unitAt } from "../engine/actions.js";
import { dealDamage, queueVisual, traitsActive } from "../engine/combat.js";
import { canPayAction, costTokens, status, transformedSkillReq } from "../engine/energy.js";
import { cardHasCapability, clone, firstSkillByEffect, firstSkillByTag, skillIdByEffect, skillIdByEffectGlobal, skillRefHasEffect } from "../engine/entities.js";
import { pointForUid } from "./summons.js";
import { registerOnlineConnectionRoute } from "../online/connection.js";
import { state_online_lobby } from "../online/lobby.js";
import { onlineMatchScope, scheduleOnlineStartReplayRequest, traceOnlineStart, state_online_start } from "../online/start.js";
import { log } from "../presentation/audio.js";
import { positionFx, visualNode } from "../presentation/coordinates.js";
import { systems } from "../runtime/systems.js";
import { combatInt, state_ui_battle_state } from "../ui/battle-state.js";
import { state_ui_cards } from "../ui/cards.js";
import { registerCardDefinition, state_ui_deck } from "../ui/deck.js";
import { executeChosenPlayerAction, openManualPayment } from "../ui/payment.js";
import { openChoice } from "../ui/results.js";
export function initializeFeaturesFoxious() {
  state_features_foxious.FOXIOUS_CARD = state_catalog_cards.C("foxious", "폭시어스", 60, "순환형 실드 딜러", "메가리그", "", [state_catalog_cards.S("foxStrike", "스트라이크", "* or **", "1코스트 또는 2코스트 방식을 선택한다. 일반 공격은 항상 80D. 어떤 방식으로 사용해도 단일 요구색이 W→B→R→W로 전환된다. 현재 요구색과 같은 색 2개를 **로 지불하면 140D.", "enemy", [{
    type: "foxStrike"
  }], ["damage", "energy"])], {
    grade: "4☆",
    shield: 180,
    speed: 1,
    releaseOrder: 15,
    tags: [],
    traits: []
  });
  registerCardDefinition(state_features_foxious.FOXIOUS_CARD);
  state_ui_cards.CARD_EMOJI_MAP.foxious = ["💥", "🐉"];
  state_features_foxious.FOX_CYCLE = {
    W: "B",
    B: "R",
    R: "W"
  };
  registerOnlineConnectionRoute("coinToss", "online-coin", handleOnlineCoinTossPacket, 40);

  /* 엘릭시안 16th 4☆ + 드래곤메모리/복사 판정 보강 */
}
export function rawReqFromCost(cost) {
  const tokens = costTokens(cost),
    req = {
      R: 0,
      W: 0,
      B: 0,
      any: 0,
      wb: 0
    };
  for (const x of tokens) {
    if (x === "*") req.any++;else if (x === "WorB") req.wb++;else req[x]++;
  }
  return {
    req,
    tokens,
    text: tokens.join("")
  };
}
export function circuitIgnoresCostChanges(u) {
  return !!(u && cardHasCapability(u, "fragmentTrait") && traitsActive(u));
}
export function foxSingleCost(u) {
  return u?.strikeSingleColor || "*";
}
export function foxPaidCounts(paid = []) {
  const x = {
    R: 0,
    W: 0,
    B: 0
  };
  for (const e of paid) x[e.c] = (x[e.c] || 0) + (Number(e.a) || 0);
  return x;
}
export function foxPlanColors(plan = {}) {
  return ["R", "W", "B"].filter(c => (plan[c] || 0) >= 1 - 1e-6);
}
export function executeFoxWithPlan(actions, mode, plan) {
  const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    chosen = actions[0];
  const finish = (baseColor = null) => executeChosenPlayerAction({
    ...chosen,
    strikeMode: mode,
    costOverride: mode === "single" ? foxSingleCost(u) : "**",
    paymentPlan: {
      ...plan
    },
    strikeBaseColor: baseColor
  });
  if (!u.strikeSingleColor) {
    const colors = foxPlanColors(plan);
    if (colors.length === 1) return finish(colors[0]);
    return openChoice(`<h2>스트라이크 순환색</h2><p>이번 사용에서 다음 요구색을 정할 기준색을 고르세요.</p>`, colors.map(c => ({
      label: `${c} → 다음 ${state_features_foxious.FOX_CYCLE[c]}`,
      fn: () => finish(c)
    })));
  }
  finish(u.strikeSingleColor);
}
export function openFoxStrikeChoice(actions) {
  const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    cur = foxSingleCost(u),
    single = actions.filter(a => a.strikeMode === "single"),
    dbl = actions.filter(a => a.strikeMode === "double");
  const root = state_ui_battle_state.$("#modalContent"),
    normal = 80;
  root.innerHTML = `<h2>폭시어스 · 스트라이크</h2><div class="fox-strike-state"><div class="fox-cost-row"><b>Cost:</b><span class="${single.length ? "" : "fox-cost-off"}">*</span><span>or</span><span class="${dbl.length ? "" : "fox-cost-off"}">**</span></div><div class="tiny fox-state-row"><span>현재 단일 요구 ${cur}</span><span>일반 ${normal}D</span><span>강화 140D</span></div></div><div class="fox-strike-mode-grid"><button id="foxSingle" ${single.length ? "" : "disabled"}><span class="skill-heading"><b>1코스트</b><span class="cost">${transformedSkillReq(state_ui_battle_state.game, t, u, cur).tokens.join(" ") || "없음"}</span></span><br><span class="tiny">사용 후 요구색 전환</span></button><button id="foxDouble" ${dbl.length ? "" : "disabled"}><span class="skill-heading"><b>2코스트</b><span class="cost">**</span></span><br><span class="tiny">같은 요구색 2개면 140D</span></button></div>`;
  const pay = (variants, mode, cost) => {
    const transformed = transformedSkillReq(state_ui_battle_state.game, t, u, cost);
    if (!transformed.tokens.length) return executeFoxWithPlan(variants, mode, {
      R: 0,
      W: 0,
      B: 0
    });
    openManualPayment(variants, (matching, plan) => executeFoxWithPlan(matching, mode, plan), `스트라이크 · ${mode === "single" ? "1코스트" : "2코스트"}`);
  };
  state_ui_battle_state.$("#foxSingle").onclick = () => pay(single, "single", cur);
  state_ui_battle_state.$("#foxDouble").onclick = () => pay(dbl, "double", "**");
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function playFoxStrikeVisual(v) {
  const arena = state_ui_battle_state.$(".arena");
  if (!arena) return;
  const from = pointForUid(arena, v.uid),
    to = pointForUid(arena, v.targetUid);
  if (!from || !to) return;
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const singlePalette = {
    R: ["#ff314f", "#ff7a4a", "#ffb0a0"],
    W: ["#f6ffff", "#9eefff", "#dffcff"],
    B: ["#10131f", "#38406b", "#776aa8"]
  };
  const palette = v.enhanced ? ["#ff1744", "#ff7a00", "#9a38ff"] : v.mode === "single" ? singlePalette[v.usedColor] || singlePalette.W : ["#ff8a00", "#ffd84a", "#fff0a0"];
  const streak = visualNode(arena, `fox-strike-streak${v.enhanced ? " enhanced" : ""}`, "", 720);
  if (streak) {
    streak.style.left = `${from.x}px`;
    streak.style.top = `${from.y}px`;
    streak.style.width = `${Math.max(28, Math.hypot(dx, dy))}px`;
    streak.style.setProperty("--beam-angle", `${Math.atan2(dy, dx)}rad`);
    streak.style.setProperty("--strike-a", palette[0]);
    streak.style.setProperty("--strike-b", palette[1]);
  }
  TimerManager.setTimeout(() => {
    const count = v.enhanced ? 34 : 20;
    const power = v.enhanced ? 1.55 : 1;
    for (let i = 0; i < count; i++) {
      const isTriangle = i % 3 !== 0,
        isBig = i % 5 === 0;
      const frag = visualNode(arena, `fox-strike-fragment ${isTriangle ? "triangle" : "square"}${isBig ? " big" : ""}${v.enhanced ? " enhanced" : ""}`, "", 980);
      if (!frag) continue;
      const ang = Math.PI * 2 * i / count + (Math.random() - .5) * .28;
      const dist = (44 + Math.random() * 86) * power;
      frag.style.left = `${to.x}px`;
      frag.style.top = `${to.y}px`;
      frag.style.setProperty("--frag-color", palette[i % palette.length]);
      frag.style.setProperty("--dx", `${Math.cos(ang) * dist}px`);
      frag.style.setProperty("--dy", `${Math.sin(ang) * dist}px`);
      frag.style.setProperty("--rot", `${(Math.random() * 420 - 210).toFixed(1)}deg`);
      frag.style.setProperty("--delay", `${(Math.random() * .08).toFixed(3)}s`);
    }
    const ring = visualNode(arena, `fox-strike-shock${v.enhanced ? " enhanced" : ""}`, "", 900);
    if (ring) {
      ring.style.left = `${to.x}px`;
      ring.style.top = `${to.y}px`;
    }
    const shownDamage = Math.max(0, combatInt(v.amount || 0));
    const pop = visualNode(arena, `fox-strike-pop${v.enhanced ? " enhanced" : ""}`, `${shownDamage}D`, 900);
    if (pop) {
      pop.style.left = `${to.x}px`;
      pop.style.top = `${to.y - 30}px`;
    }
    if (v.next) {
      const cyc = visualNode(arena, "fox-strike-cycle", `다음 ${v.next}`, 1150);
      positionFx(cyc, {
        x: from.x,
        y: from.y - 28
      });
    }
  }, 190);
}

/* 다층 실드, 온라인 선후공 동전, 실브래 드래곤메모리 보강 */
export function shieldLayerHTML(shield, maxHp) {
  const total = Math.max(0, combatInt(shield || 0));
  const cap = Math.max(1, combatInt(maxHp || 1));
  const layers = Math.max(1, Math.ceil(total / cap));
  let html = "";
  for (let i = 0; i < layers; i++) {
    const amount = Math.max(0, Math.min(cap, total - i * cap));
    const pct = Math.round(Math.max(0, Math.min(100, amount / cap * 100)));
    html += `<div class="unit-bar shield-bar" data-shield-layer="${i + 1}/${layers}" aria-label="실드 ${total}, ${i + 1}번째 줄 ${amount}/${cap}"><span class="unit-bar-fill shield-fill" style="width:${pct}%"></span></div>`;
  }
  return `<div class="shield-stack" aria-label="실드 총 ${total}">${html}</div>`;
}
export function showOnlineCoinToss(result = {}) {
  const normalized = {
    ...result,
    firstTeam: result?.firstTeam === "A" ? "A" : "P",
    face: result?.face === "mono" ? "mono" : result?.firstTeam === "A" ? "mono" : "gold"
  };
  const scope = onlineMatchScope(normalized);
  if (state_ui_deck.p2p?.__coinShown) return;
  if (state_ui_deck.p2p?.__coinScope === scope && state_ui_deck.p2p?.coinResult) {
    const old = state_ui_deck.p2p.coinResult;
    if (old.firstTeam !== normalized.firstTeam && systems.DEBUG_BATTLE_EVENTS) console.warn("[online] conflicting coin result ignored", {
      scope,
      old,
      incoming: normalized
    });
    return;
  }
  if (state_online_start.onlineCoinShownScopes.has(scope)) return;
  const key = String(normalized.id || `${state_ui_deck.p2p.matchId || state_ui_deck.p2p.roomCode || "online"}:${normalized.firstTeam || "P"}:${normalized.face || ""}`);
  if (state_online_lobby.shownOnlineCoinIds.has(key)) return;
  state_online_start.onlineCoinShownScopes.add(scope);
  state_online_lobby.shownOnlineCoinIds.add(key);
  while (state_online_lobby.shownOnlineCoinIds.size > 24) state_online_lobby.shownOnlineCoinIds.delete(state_online_lobby.shownOnlineCoinIds.values().next().value);
  state_ui_deck.p2p.__coinScope = scope;
  state_ui_deck.p2p.__coinShown = true;
  state_ui_deck.p2p.coinResult = clone(normalized);
  document.querySelector(".online-coin-overlay")?.remove();
  const firstTeam = normalized.firstTeam;
  const localTeam = state_ui_deck.p2p.role === "guest" ? "A" : "P";
  const gold = firstTeam === "P";
  const overlay = document.createElement("div");
  overlay.className = "online-coin-overlay";
  overlay.innerHTML = `<div class="online-coin-stage"><div class="online-coin-title">선후공 동전 던지기</div><div class="online-coin ${gold ? "result-gold" : "result-mono"}"><div class="online-coin-face online-coin-gold">◆</div><div class="online-coin-face online-coin-mono">◐</div></div><div class="online-coin-result">${gold ? "금색" : "흑백"} · ${firstTeam === localTeam ? "내가 선공" : "상대가 선공"}</div></div>`;
  document.body.appendChild(overlay);
  const sessionScope = systems.OnlineRuntime?.sessionScope;
  const timerId = sessionScope?.setTimeout?.(() => overlay.remove(), 2050, "online-coin-presentation", {
    phase: "SESSION"
  });
  if (!timerId) {
    overlay.remove();
    systems.__megaRecordRecoveredError?.(new Error("ONLINE_COIN_SESSION_SCOPE_UNAVAILABLE"), "showOnlineCoinToss");
  }
}
export function handleOnlineCoinTossPacket(msg) {
  if (state_ui_deck.p2p?.role !== "guest" || state_ui_deck.p2p?.sessionMode === "bossRaid" || msg?.mode !== "PVP") return false;
  const incoming = String(msg?.matchId || ""),
    local = String(state_ui_deck.p2p?.matchId || "");
  if (!incoming || !local || incoming !== local) return false;
  showOnlineCoinToss(msg.result || {});
  if (state_ui_deck.p2p?.role === "guest" && !state_ui_deck.p2p?.battleStarted) {
    traceOnlineStart("COIN_TOSS_START_PENDING", {
      matchId: msg.matchId,
      coinResult: msg.result || {}
    }, {
      requestScheduled: true
    });
    scheduleOnlineStartReplayRequest("coin-toss-start-pending", 1);
  }
  return true;
}
export function listStrikeActions(g, t, s) {
  let actions = [],
    u = unitAt(g, t, s);
  if (!u || u.dead || !firstSkillByEffect(u, "foxStrike")) return actions;
  if (u.scheduledAction || status(u, "freeze") || status(u, "skillSeal") || u.skillSeals?.[skillIdByEffect(u, "foxStrike")]) return actions;
  const targets = enemyTargets(g, t),
    single = foxSingleCost(u);
  if (canPayAction(g, t, u, single)) for (const target of targets) actions.push({
    type: "skill",
    skill: skillIdByEffectGlobal("foxStrike"),
    strikeMode: "single",
    costOverride: single,
    target,
    label: `스트라이크 · 단일 ${single}`
  });
  if (canPayAction(g, t, u, "**")) for (const target of targets) actions.push({
    type: "skill",
    skill: skillIdByEffectGlobal("foxStrike"),
    strikeMode: "double",
    costOverride: "**",
    target,
    label: `스트라이크 · **`
  });
  return actions;
}
export function applyStrikeEffect(g, actor, target, e, skill, ctx) {
  if (firstSkillByTag(actor, "copy") && skillRefHasEffect(ctx?.action?.copySkill, "foxStrike")) return applyMemoryStrikeEffect(g, actor, target, e, skill, ctx);
  const action = ctx?.action || {},
    paid = ctx?.paid || [],
    counts = foxPaidCounts(paid),
    cur = actor.strikeSingleColor || null;
  const enhanced = action.strikeMode === "double" && !!cur && (counts[cur] || 0) >= 2 - 1e-6;
  const amount = enhanced ? 140 : 80;
  const dealt = dealDamage(g, actor, target, {
    amount
  }, skill, ctx?.sim);
  const basis = cur || action.strikeBaseColor || ["R", "W", "B"].find(c => (counts[c] || 0) >= 1 - 1e-6) || null;
  let next = null;
  if (basis && state_features_foxious.FOX_CYCLE[basis]) {
    next = state_features_foxious.FOX_CYCLE[basis];
    actor.strikeSingleColor = next;
  }
  actor.strikeUses++;
  actor.lastTarget = target?.uid || null;
  log(g, `${actor.name}: 스트라이크 ${enhanced ? "강화 " : ""}→ ${dealt}D${next ? ` · 다음 단일 코스트 ${next}` : ""}.`);
  queueVisual(g, {
    type: "foxStrikeFx",
    uid: actor.uid,
    targetUid: target?.uid || null,
    enhanced,
    mode: action.strikeMode,
    usedColor: basis,
    amount: dealt,
    rawAmount: amount,
    next
  });
  return dealt;
}
export function applyMemoryStrikeEffect(g, actor, target, e, skill, ctx) {
  if (!(e.type === "foxStrike" && !!firstSkillByTag(actor, "copy") && skillRefHasEffect(ctx?.action?.copySkill, "foxStrike"))) return;
  const paid = ctx.paid || [];
  const paidColors = paid.filter(x => x && "RWB".includes(x.c) && Number(x.a) > 0).map(x => x.c);
  let basis = actor.memoryStrikeSingleColor;
  if (!basis) basis = paidColors.length ? g.rng.pick(paidColors) : null;
  const amount = actor.memoryStrikeUses === 0 ? 90 : 80;
  const dealt = dealDamage(g, actor, target, {
    amount
  }, skill, ctx.sim);
  const next = basis && state_features_foxious.FOX_CYCLE[basis] ? state_features_foxious.FOX_CYCLE[basis] : null;
  if (next) actor.memoryStrikeSingleColor = next;
  actor.memoryStrikeUses++;
  actor.lastTarget = target?.uid || null;
  log(g, `${actor.name}: 드래곤메모리 스트라이크 → ${dealt}D${basis ? ` · 기준색 ${basis}` : ""}${next ? ` · 다음 기본 코스트 ${next}` : ""}.`);
  queueVisual(g, {
    type: "foxStrikeFx",
    uid: actor.uid,
    targetUid: target?.uid || null,
    enhanced: false,
    mode: "single",
    usedColor: basis,
    amount: dealt,
    rawAmount: amount,
    next
  });
  return dealt;
}

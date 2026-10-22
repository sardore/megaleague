import { TimerManager } from "../runtime/timers.js";
// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_online_emotes = {
  BATTLE_EMOTE_PROTOCOL: undefined,
  battleEmoteSeenIds: undefined,
  battleEmotePending: undefined
};
import { state_runtime_entities } from "../runtime/entities.js";
import { other } from "../engine/actions.js";
import { clearAllEnergy, dealDamage, findUnit, heal, queueVisual, teamOf } from "../engine/combat.js";
import { cloneRngForPreview, naturalColors } from "../engine/effects.js";
import { allEnergy, canPayAction, energyStore, findPaymentPlan, gainEnergy, spendPaymentPlan, status, totalEnergy } from "../engine/energy.js";
import { actionSkillHasRuntimeKind, card, cardCapability, firstSkillByRuntimeKind, skillDefHasRuntimeKind, skillOf } from "../engine/entities.js";
import { allBattleUnits, bestSummonEnemy, removeRecentEnergyExternal, targetRef } from "../features/summons.js";
import { state_online_commands } from "./commands.js";
import { p2pSend, registerOnlineConnectionRoute } from "./connection.js";
import { log } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
import { renderBaseActions, state_ui_action_panel } from "../ui/action-panel.js";
import { energyAmountText, state_ui_battle_state } from "../ui/battle-state.js";
import { state_ui_deck } from "../ui/deck.js";
import { actionButton } from "../ui/payment.js";
import { openChoice } from "../ui/results.js";
import { localTeamFor } from "../ui/setup.js";
export function initializeOnlineEmotes() {
  state_online_emotes.BATTLE_EMOTE_PROTOCOL = "mega-online-emote-r1";
  state_online_emotes.battleEmoteSeenIds = new Set();
  state_online_emotes.battleEmotePending = new Map();
  registerOnlineConnectionRoute("emote", "battle-emote", receiveOnlineEmote, 20);
  registerOnlineConnectionRoute("emoteAckR1", "battle-emote-ack", receiveOnlineEmoteAck, 20);

  /* 소환물 수동 조작 */

  state_ui_action_panel.ActionRenderEngine.registerRoute("manual-summon", 200, ctx => ctx?.viewModel?.surfaceKind === "manual-summon", ctx => renderManualSummonActions(ctx?.viewModel));
}
export function battleEmoteMatchId() {
  return String(state_ui_deck.p2p?.matchId || state_ui_battle_state.game?.matchId || state_ui_deck.p2p?.roomCode || "");
}
export function rememberBattleEmote(id) {
  id = String(id || "");
  if (!id || state_online_emotes.battleEmoteSeenIds.has(id)) return false;
  state_online_emotes.battleEmoteSeenIds.add(id);
  if (state_online_emotes.battleEmoteSeenIds.size > 160) state_online_emotes.battleEmoteSeenIds.delete(state_online_emotes.battleEmoteSeenIds.values().next().value);
  return true;
}
export function showBattleEmote(emoji, who = "상대") {
  const n = document.createElement('div');
  n.className = 'battle-emote';
  n.style.zIndex = "26000";
  n.textContent = `${who} ${emoji}`;
  document.body.appendChild(n);
  TimerManager.setTimeout(() => n.remove(), 2300);
  return n;
}
export function sendBattleEmoteControl(packet) {
  try {
    const sent = systems.OnlineRuntime?.sendControl?.(packet);
    if (sent) return true;
    if (state_ui_deck.p2p?.conn?.open) return p2pSend(packet) !== false;
  } catch (error) {
    systems.__megaRecordRecoveredError?.(error, "battle-emote-control-send");
  }
  return false;
}
export function cancelBattleEmoteRetry(timerId) {
  return !!timerId && systems.OnlineRuntime?.sessionScope?.cancel?.(timerId) === true;
}
export function scheduleBattleEmoteRetry(entry) {
  if (!entry || state_online_emotes.battleEmotePending.get(entry.packet.emoteId) !== entry) return false;
  if (Date.now() - entry.createdAt >= 15000) {
    state_online_emotes.battleEmotePending.delete(entry.packet.emoteId);
    return false;
  }
  if (entry.timerId) cancelBattleEmoteRetry(entry.timerId);
  const delays = [250, 500, 900, 1500, 2200],
    delay = delays[Math.min(entry.attempts, delays.length - 1)];
  const retry = () => {
    entry.timerId = 0;
    if (state_online_emotes.battleEmotePending.get(entry.packet.emoteId) !== entry) return;
    entry.attempts++;
    entry.lastSentAt = Date.now();
    entry.lastSendSucceeded = sendBattleEmoteControl(entry.packet);
    scheduleBattleEmoteRetry(entry);
  };
  const scope = systems.OnlineRuntime?.sessionScope;
  if (!scope || scope.closed) {
    state_online_emotes.battleEmotePending.delete(entry.packet.emoteId);
    return false;
  }
  entry.timerId = scope.setTimeout(retry, delay, `emote-retry:${entry.packet.emoteId}`, {
    phase: "SESSION"
  });
  return true;
}
export function resetBattleEmoteReliability(reason = "session-reset") {
  for (const entry of state_online_emotes.battleEmotePending.values()) cancelBattleEmoteRetry(entry.timerId);
  state_online_emotes.battleEmotePending.clear();
  state_online_emotes.battleEmoteSeenIds.clear();
  document.querySelectorAll(".battle-emote").forEach(node => node.remove());
  return String(reason);
}
export function sendOnlineEmote(emoji) {
  const value = String(emoji || "👍").slice(0, 4),
    matchId = battleEmoteMatchId();
  const emoteId = `emote:${systems.OnlineRuntime?.identity?.().generation || 0}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const packet = Object.freeze({
    type: "emote",
    protocol: state_online_emotes.BATTLE_EMOTE_PROTOCOL,
    emoji: value,
    emoteId,
    matchId,
    sentAt: Date.now()
  });
  const entry = {
    packet,
    createdAt: Date.now(),
    attempts: 1,
    lastSentAt: Date.now(),
    lastSendSucceeded: false,
    timerId: 0
  };
  rememberBattleEmote(emoteId);
  state_online_emotes.battleEmotePending.set(emoteId, entry);
  entry.lastSendSucceeded = sendBattleEmoteControl(packet);
  scheduleBattleEmoteRetry(entry);
  showBattleEmote(value, "나");
  return true;
}
export function sendOnlineEmoteAck(msg) {
  const emoteId = String(msg?.emoteId || "");
  if (!emoteId) return false;
  return sendBattleEmoteControl({
    type: "emoteAckR1",
    protocol: state_online_emotes.BATTLE_EMOTE_PROTOCOL,
    emoteId,
    matchId: String(msg?.matchId || battleEmoteMatchId()),
    receivedAt: Date.now()
  });
}
export function receiveOnlineEmote(msg) {
  if (msg?.protocol && msg.protocol !== state_online_emotes.BATTLE_EMOTE_PROTOCOL) return false;
  const incomingMatch = String(msg?.matchId || ""),
    localMatch = battleEmoteMatchId();
  if (incomingMatch && localMatch && incomingMatch !== localMatch) return false;
  sendOnlineEmoteAck(msg);
  if (msg?.emoteId && !rememberBattleEmote(msg.emoteId)) return true;
  showBattleEmote(String(msg?.emoji || "👍").slice(0, 4), "상대");
  return true;
}
export function receiveOnlineEmoteAck(msg) {
  if (msg?.protocol !== state_online_emotes.BATTLE_EMOTE_PROTOCOL) return false;
  const incomingMatch = String(msg?.matchId || ""),
    localMatch = battleEmoteMatchId();
  if (incomingMatch && localMatch && incomingMatch !== localMatch) return false;
  const id = String(msg?.emoteId || ""),
    entry = state_online_emotes.battleEmotePending.get(id);
  if (!entry) return true;
  cancelBattleEmoteRetry(entry.timerId);
  state_online_emotes.battleEmotePending.delete(id);
  return true;
}
export function ensurePendingSummonIdentity(g, q, u) {
  if (!q) return q;
  const battleId = g?.battleId || g?.matchId || "battle";
  const serial = Number(q.summonSerial ?? u?.summonSerial ?? 0);
  q.actionId ||= `${battleId}:summon:${Number(g?.turnSerial || 0)}:${q.summonUid}:${serial}`;
  q.transactionId ||= `${q.actionId}:tx`;
  return q;
}
export function normalizePendingSummonTurns(g) {
  g.pendingSummonTurns ||= [];
  while (g.pendingSummonTurns.length) {
    const q = g.pendingSummonTurns[0],
      u = findUnit(g, q.summonUid),
      owner = findUnit(g, q.ownerUid);
    if (!u || u.dead || !u.isSummon || !owner || owner.dead || teamOf(g, u) !== q.team) {
      g.pendingSummonTurns.shift();
      continue;
    }
    ensurePendingSummonIdentity(g, q, u);
    return {
      q,
      u,
      owner
    };
  }
  return null;
}
export function finishSummonQueueAction(g, q, u, usedSkill) {
  const current = g?.pendingSummonTurns?.[0];
  if (!current || current.actionId !== q?.actionId || current.summonUid !== u?.uid) return false;
  g.pendingSummonTurns.shift();
  u.turns = Number(u.turns || 0) + 1;
  if (cardCapability(u, "resetDeathBaselineOnTurn", false)) u.deathBaseline = Number(g.teams?.[q.team]?.deathSerial || 0);
  state_runtime_entities.BattleEventEngine?.emit?.(g, "SUMMON_ACTION_COMPLETED", {
    teamId: q.team,
    sourceEntityId: u.uid,
    payload: {
      actionId: q.actionId,
      usedSkill: !!usedSkill,
      remaining: g.pendingSummonTurns.length
    }
  });
  return true;
}
export function summonSkillCost(g, t, u, skillRef) {
  const sk = skillOf(u, skillRef);
  if (skillDefHasRuntimeKind(sk, "summonRageClaw")) {
    const n = Math.max(0, (g.teams[t].deathSerial || 0) - (u.deathBaseline || 0));
    return '*'.repeat(Math.max(0, 3 - n));
  }
  return sk?.cost || '';
}
export function summonTargetRefs(g, t, ally) {
  const team = ally ? t : other(t);
  return allBattleUnits(g, team, true).map(u => ({
    u,
    ref: targetRef(g, team, u)
  }));
}
export function summonActionOptions(g, t, u) {
  const out = [{
    type: 'summonGather',
    label: '에너지 모으기'
  }];
  if (status(u, 'freeze') || status(u, 'paralyze')) return out;
  const skills = {
    heal: firstSkillByRuntimeKind(u, "summonHeal"),
    peck: firstSkillByRuntimeKind(u, "summonEnergyPeck"),
    constrict: firstSkillByRuntimeKind(u, "summonConstrict"),
    rage: firstSkillByRuntimeKind(u, "summonRageClaw")
  };
  const behavior = cardCapability(u, 'summonBehavior', '');
  if (behavior === 'support') {
    const heal = skills.heal,
      healCost = summonSkillCost(g, t, u, heal);
    if (heal && !u.skillSeals?.[heal.id] && canPayAction(g, t, u, healCost)) for (const {
      u: target
    } of summonTargetRefs(g, t, true)) out.push({
      type: 'summonSkill',
      skill: heal.id,
      targetUid: target.uid,
      label: `${heal.name} → ${target.name}`
    });
    const peck = skills.peck,
      peckCost = summonSkillCost(g, t, u, peck);
    if (peck && !u.skillSeals?.[peck.id] && canPayAction(g, t, u, peckCost)) for (const {
      u: target
    } of summonTargetRefs(g, t, false)) out.push({
      type: 'summonSkill',
      skill: peck.id,
      targetUid: target.uid,
      label: `${peck.name} → ${target.name}`
    });
  } else if (behavior === 'constrict') {
    const sk = skills.constrict,
      cost = summonSkillCost(g, t, u, sk);
    if (sk && !u.skillSeals?.[sk.id] && canPayAction(g, t, u, cost)) for (const {
      u: target
    } of summonTargetRefs(g, t, false)) out.push({
      type: 'summonSkill',
      skill: sk.id,
      targetUid: target.uid,
      label: `${sk.name} → ${target.name}`
    });
  } else if (behavior === 'rage') {
    const sk = skills.rage,
      n = Math.max(0, (g.teams[t].deathSerial || 0) - (u.deathBaseline || 0)),
      cost = summonSkillCost(g, t, u, sk),
      effect = sk?.effects?.find(e => e.type === 'summonRageClaw'),
      damage = Number(effect?.base || 80) + Number(effect?.perDeath || 60) * n;
    if (sk && !u.skillSeals?.[sk.id] && canPayAction(g, t, u, cost)) for (const {
      u: target
    } of summonTargetRefs(g, t, false)) out.push({
      type: 'summonSkill',
      skill: sk.id,
      targetUid: target.uid,
      label: `${sk.name} ${cost || '무코스트'} · ${damage}D → ${target.name}`
    });
  }
  return out;
}
export function manualSummonSurfaceContext(g) {
  const current = normalizePendingSummonTurns(g);
  if (!current) return null;
  const {
      q,
      u,
      owner
    } = current,
    amount = status(u, "slow") ? .5 : 1;
  const previewRng = cloneRngForPreview(g.rng),
    colors = naturalColors(g, q.team, u, amount, null, "summon-gather-preview"),
    color = previewRng?.pick(colors);
  const actions = summonActionOptions(g, q.team, u).map(action => {
    const base = {
      ...action,
      actionId: q.actionId,
      transactionId: q.transactionId,
      sourceInstanceId: u.uid
    };
    if (action.type === "summonGather") return {
      ...base,
      gather: {
        color,
        amount,
        max: Number(card(u).maxEnergy || 4)
      }
    };
    const cost = summonSkillCost(g, q.team, u, action.skill),
      plan = cost ? findPaymentPlan(g, q.team, u, cost) : {
        R: 0,
        W: 0,
        B: 0
      };
    return {
      ...base,
      paymentRequirements: {
        cost
      },
      paymentPlans: plan ? [plan] : []
    };
  });
  const pendingActionId = state_online_commands.OnlineActionAdmissionOwner.pendingActionId(),
    pendingSubmitted = pendingActionId === q.actionId;
  return Object.freeze({
    kind: "manual-summon",
    eligibilityContext: Object.freeze({
      surfaceKind: "manual-summon",
      actorTeam: q.team,
      actorSlot: null,
      actor: u,
      actorUid: u.uid,
      canonicalLocalTeam: localTeamFor(g),
      standardOnline: g.mode === "online",
      skipActiveIdentityChecks: true,
      actions,
      pendingSubmitted,
      pendingActionId
    }),
    manualSummon: Object.freeze({
      actionId: q.actionId,
      transactionId: q.transactionId,
      sourceInstanceId: u.uid,
      candidateIdentity: `${q.actionId}:${u.uid}`,
      pendingSubmitted,
      summonName: u.name,
      ownerName: owner.name,
      remaining: g.pendingSummonTurns.length,
      actions: Object.freeze(actions.map(action => Object.freeze(action)))
    }),
    boss: null
  });
}
export function applyManualSummonAction(g, t, summonUid, a) {
  const cur = normalizePendingSummonTurns(g);
  if (!cur || cur.q.team !== t || cur.u.uid !== summonUid || !a) return false;
  const {
    q,
    u,
    owner
  } = cur;
  if (a.type === 'summonGather') {
    const amt = status(u, 'slow') ? .5 : 1,
      colors = naturalColors(g, t, u, amt, null, 'summon-gather-execute'),
      rolled = g.rng.pick(colors);
    if (a.color && a.color !== rolled) return false;
    const max = card(u).maxEnergy || 4,
      store = energyStore(u);
    if (totalEnergy(u) + amt > max + .001) {
      if (a.discardNew) {
        log(g, `${u.name}: ${rolled}${amt === .5 ? '½' : ''} 에너지 포기(최대치).`);
      } else {
        const indices = [...new Set(Array.isArray(a.replaceIndices) ? a.replaceIndices : [])].filter(i => Number.isInteger(i) && i >= 0 && i < store.length);
        const removed = indices.reduce((n, i) => n + (store[i]?.a || 0), 0),
          need = totalEnergy(u) + amt - max;
        if (removed + 1e-6 < need) return false;
        const old = indices.map(i => store[i]).filter(Boolean).map(e => `${e.c}${e.a === .5 ? '½' : ''}`).join('+');
        if (!gainEnergy(g, u, rolled, amt, indices)) return false;
        log(g, `${u.name}: ${old} 버림 → ${rolled}${amt === .5 ? '½' : ''} 획득.`);
      }
    } else {
      gainEnergy(g, u, rolled, amt);
      log(g, `${u.name}: ${rolled}${amt === .5 ? '½' : ''} 에너지 획득.`);
    }
    u.lastAction = 'gather';
    finishSummonQueueAction(g, q, u, false);
    return true;
  }
  if (a.type !== 'summonSkill') return false;
  const sk = card(u).skills.find(x => x.id === a.skill),
    cost = summonSkillCost(g, t, u, a.skill),
    target = findUnit(g, a.targetUid);
  if (!sk || u.skillSeals?.[a.skill] || !target || target.dead || !validSummonPayment(g, t, u, cost, a.paymentPlan)) return false;
  const targetTeam = teamOf(g, target),
    allySkill = actionSkillHasRuntimeKind(a, "summonHeal");
  if (allySkill ? targetTeam !== t : targetTeam !== other(t)) return false;
  if (cost) spendPaymentPlan(u, a.paymentPlan);
  let used = true;
  if (actionSkillHasRuntimeKind(a, "summonHeal")) {
    const got = heal(g, target, 20, u, {
      reason: "summon-heal",
      effectId: "healingWing"
    });
    log(g, `${u.name}: 힐링윙 → ${target.name}, HP ${got} 회복.`);
    queueVisual(g, {
      type: 'jcSummonAction',
      kind: 'heal',
      uid: u.uid,
      targetUid: target.uid
    });
  } else if (actionSkillHasRuntimeKind(a, "summonEnergyPeck")) {
    const r = removeRecentEnergyExternal(g, target, 1, u);
    log(g, `${u.name}: 쪼아먹기 → ${target.name}, 최근 에너지 ${energyAmountText(r)} 제거.`);
    queueVisual(g, {
      type: 'jcSummonAction',
      kind: 'peck',
      uid: u.uid,
      targetUid: target.uid
    });
  } else if (actionSkillHasRuntimeKind(a, "summonConstrict")) {
    const d = dealDamage(g, u, target, {
      amount: 70
    }, sk, false);
    const e = clearAllEnergy(u),
      r = removeRecentEnergyExternal(g, target, e / 2, u);
    log(g, `${u.name}: 조이기 70D, 잔여E ${energyAmountText(e)} 제거, ${target.name} E ${energyAmountText(r)} 제거.`);
    queueVisual(g, {
      type: 'jcSummonAction',
      kind: 'coil',
      uid: u.uid,
      targetUid: target.uid
    });
  } else if (actionSkillHasRuntimeKind(a, "summonRageClaw")) {
    const n = Math.max(0, (g.teams[t].deathSerial || 0) - (u.deathBaseline || 0)),
      amount = 80 + 60 * n;
    const d = dealDamage(g, u, target, {
      amount
    }, sk, false);
    log(g, `${u.name}: 분노발톱 · 최근 사망 ${n}, ${amount}D → ${target.name}.`);
    queueVisual(g, {
      type: 'jcSummonAction',
      kind: 'claw',
      uid: u.uid,
      targetUid: target.uid,
      n
    });
  } else return false;
  u.lastAction = 'skill';
  finishSummonQueueAction(g, q, u, used);
  return true;
}
export function submitManualSummonAction(a) {
  const cur = normalizePendingSummonTurns(state_ui_battle_state.game);
  if (!cur || !a) return;
  const {
    q,
    u,
    owner
  } = cur;
  if (a.actionId && a.actionId !== q.actionId) return;
  if (a.transactionId && a.transactionId !== q.transactionId) return;
  if (Number.isFinite(Number(a.authoritativeRevision)) && Number(a.authoritativeRevision) !== Number(state_ui_battle_state.game.networkRevision || 0)) return;
  return state_online_commands.OnlineActionAdmissionOwner.submitManualSummon(state_ui_battle_state.game, q, u, owner, a);
}
export function openSummonGatherChoice(base) {
  const cur = normalizePendingSummonTurns(state_ui_battle_state.game);
  if (!cur || !base || base.actionId !== cur.q.actionId) return;
  const {
      q,
      u
    } = cur,
    col = base.gather?.color,
    amt = Number(base.gather?.amount || 1),
    max = Number(base.gather?.max || card(u).maxEnergy || 4),
    store = energyStore(u);
  if (totalEnergy(u) + amt <= max + .001) {
    submitManualSummonAction({
      type: 'summonGather',
      color: col
    });
    return;
  }
  const need = totalEnergy(u) + amt - max,
    chosen = new Set(),
    root = state_ui_battle_state.$('#modalContent');
  root.innerHTML = `<h2>${u.name} · 에너지 모으기</h2><p>이번 수급은 <b>${col}${amt === .5 ? '½' : ''}</b>입니다. 합계 ${energyAmountText(need)} 이상 버릴 에너지를 선택하세요.</p><div id="summonDiscardList" class="choice-list"></div><p id="summonDiscardTotal" class="tiny"></p><div class="choice-list"><button id="summonDiscardNew">새 에너지 버리기</button><button id="summonKeepNew" class="primary" disabled>선택한 에너지 버리고 획득</button><button id="summonGatherCancel">취소</button></div>`;
  const list = state_ui_battle_state.$('#summonDiscardList'),
    label = state_ui_battle_state.$('#summonDiscardTotal'),
    keep = state_ui_battle_state.$('#summonKeepNew');
  const refresh = () => {
    const total = [...chosen].reduce((n, i) => n + (store[i]?.a || 0), 0);
    label.textContent = `선택 ${energyAmountText(total)} / 필요 ${energyAmountText(need)}`;
    keep.disabled = total + 1e-6 < need;
  };
  store.forEach((e, i) => {
    const b = document.createElement('button');
    b.className = `e ${e.c}`;
    b.textContent = `${e.c}${e.a === .5 ? '½' : ''}`;
    b.onclick = () => {
      chosen.has(i) ? chosen.delete(i) : chosen.add(i);
      b.classList.toggle('chosen', chosen.has(i));
      refresh();
    };
    list.appendChild(b);
  });
  refresh();
  state_ui_battle_state.$('#summonDiscardNew').onclick = () => {
    state_ui_battle_state.$('#modal').classList.remove('open');
    submitManualSummonAction({
      type: 'summonGather',
      color: col,
      discardNew: true
    });
  };
  keep.onclick = () => {
    state_ui_battle_state.$('#modal').classList.remove('open');
    submitManualSummonAction({
      type: 'summonGather',
      color: col,
      replaceIndices: [...chosen]
    });
  };
  state_ui_battle_state.$('#summonGatherCancel').onclick = () => state_ui_battle_state.$('#modal').classList.remove('open');
  state_ui_battle_state.$('#modal').classList.add('open');
}
export function chooseSummonSkillPayment(base) {
  const cur = normalizePendingSummonTurns(state_ui_battle_state.game);
  if (!cur || !base || base.actionId !== cur.q.actionId) return;
  const cost = base.paymentRequirements?.cost || '',
    plans = Array.isArray(base.paymentPlans) ? base.paymentPlans : [];
  if (!plans.length) return;
  if (plans.length === 1) {
    submitManualSummonAction({
      ...base,
      paymentPlan: plans[0]
    });
    return;
  }
  openChoice(`<h2>${cur.u.name} · ${card(cur.u).skills.find(x => x.id === base.skill)?.name}</h2><p>지불할 에너지 색을 선택하세요.</p>`, plans.map(plan => ({
    label: `R ${energyAmountText(plan.R)} / W ${energyAmountText(plan.W)} / B ${energyAmountText(plan.B)}`,
    fn: () => submitManualSummonAction({
      ...base,
      paymentPlan: plan
    })
  })));
}
export function summonTeamLocallyControlled(g, t) {
  return g.mode === 'human' && t === 'P' || g.mode === 'online' && t === state_ui_deck.onlineSide;
}
export function renderManualSummonActions(viewModel) {
  const box = state_ui_battle_state.$('#actionButtons'),
    surface = viewModel?.manualSummon;
  box.innerHTML = '';
  if (!surface) return renderBaseActions(viewModel);
  state_ui_battle_state.$('#actionTitle').textContent = `${surface.summonName} 행동`;
  state_ui_battle_state.$('#actionHint').textContent = `${surface.ownerName} 차례 종료 후 소환물 행동 · 남은 ${surface.remaining}마리`;
  if (!viewModel.projection.canAct || surface.pendingSubmitted) return;
  for (const a of surface.actions) {
    actionButton(box, a.label, () => a.type === 'summonGather' ? openSummonGatherChoice(a) : chooseSummonSkillPayment(a));
  }
}
export function chooseSummonAIAction(g, t, u) {
  const opts = summonActionOptions(g, t, u).filter(a => a.type === 'summonSkill');
  let pick = null;
  if (cardCapability(u, 'summonBehavior', '') === 'support') {
    const injured = summonTargetRefs(g, t, true).map(x => x.u).filter(x => x.hp < x.maxHp).sort((a, b) => b.maxHp - b.hp - (a.maxHp - a.hp))[0];
    const enemy = summonTargetRefs(g, t, false).map(x => x.u).filter(x => allEnergy(x) > .001).sort((a, b) => allEnergy(b) - allEnergy(a))[0];
    if (enemy) pick = opts.find(a => actionSkillHasRuntimeKind(a, "summonEnergyPeck") && a.targetUid === enemy.uid);
    if (!pick && injured) pick = opts.find(a => actionSkillHasRuntimeKind(a, "summonHeal") && a.targetUid === injured.uid);
  } else {
    const enemy = bestSummonEnemy(g, t);
    pick = enemy && opts.find(a => a.targetUid === enemy.uid);
  }
  if (!pick) return {
    type: 'summonGather'
  };
  const cost = summonSkillCost(g, t, u, pick.skill),
    plan = cost ? findPaymentPlan(g, t, u, cost) : {
      R: 0,
      W: 0,
      B: 0
    };
  return {
    ...pick,
    paymentPlan: plan
  };
}

/* 폭시어스 + 서킷 코스트 절연 + 온라인 룸 카드 UX */

// Validate the exact selected payment before mutating a summon or its target.
export function validSummonPayment(g, team, summon, cost, plan) {
  if (!plan || ["R", "W", "B"].some(c => !Number.isFinite(Number(plan[c] || 0)) || Number(plan[c] || 0) < 0)) return !cost && !plan;
  return !!findPaymentPlan(g, team, summon, cost, null, candidate => ["R", "W", "B"].every(color => Math.abs(candidate[color] - Number(plan[color] || 0)) < 0.001));
}

import { TimerManager } from "../runtime/timers.js";
// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_features_summons = {
  SUMMON_DEFS: undefined
};
import { isLocallyControlledTeam } from "../app/controls.js";
import { state_catalog_cards } from "../catalog/cards.js";
import { other, unitAt } from "../engine/actions.js";
import { applyStatus, dealDamage, findUnit, nonAttackDamage, queueVisual, teamOf, traitsActive } from "../engine/combat.js";
import { cloneRngForPreview, drawRandomEnergyColor, naturalColors, registerScheduledAction } from "../engine/effects.js";
import { allEnergy, bestEnergyReplacementPlan, canPayAction, energyStore, gainEnergy, notifyReactiveEnergyMutation, status, totalEnergy } from "../engine/energy.js";
import { card, cardCapability, cardHasCapability, firstSkillByEffect, makeUnit, registerRuntimeSkillContainer, skillIdByEffect, skillIdByEffectGlobal, state_engine_entities } from "../engine/entities.js";
import { advanceDualOrEnd } from "../engine/execution.js";
import { clearColorEnergy, colorAmount, energyStoresWithLabels, grantEnergyWithDiscard } from "./character-rules.js";
import { ensurePendingSummonIdentity, normalizePendingSummonTurns } from "../online/emotes.js";
import { log } from "../presentation/audio.js";
import { positionFx, visualNode, state_presentation_coordinates } from "../presentation/coordinates.js";
import { systems } from "../runtime/systems.js";
import { playerChooseTarget } from "../ui/action-choices.js";
import { combatInt, energyAmountText, energyHTML, state_ui_battle_state } from "../ui/battle-state.js";
import { displaySideFor } from "../ui/setup.js";
export function initializeFeaturesSummons() {
  state_features_summons.SUMMON_DEFS = {
    summonToucan: {
      id: "summonToucan",
      name: "왕부리새",
      grade: "소환물",
      maxHp: 60,
      maxEnergy: 4,
      baseDefense: 0,
      traits: [],
      summonBehavior: "support",
      summonIcon: "🦜",
      summonColor: "#d4ed62",
      skills: [state_catalog_cards.S("healingWing", "힐링윙", "*", "아군 하나 HP20 회복.", "ally", [{
        type: "summonHeal",
        amount: 20
      }], ["heal"], {
        nonAttack: true,
        runtimeKind: "summonHeal",
        aiProfile: {
          kind: "healMostInjured"
        }
      }), state_catalog_cards.S("peckEat", "쪼아먹기", "B*", "적 최근 에너지 1개 제거.", "enemy", [{
        type: "summonRemoveRecentEnergy",
        amount: 1
      }], ["energy"], {
        nonAttack: true,
        runtimeKind: "summonEnergyPeck",
        aiProfile: {
          kind: "drainEnemyEnergy"
        }
      })]
    },
    summonAnaconda: {
      id: "summonAnaconda",
      name: "아나콘다",
      grade: "소환물",
      maxHp: 120,
      maxEnergy: 4,
      baseDefense: 0,
      traits: [],
      summonBehavior: "constrict",
      summonIcon: "🐍",
      summonColor: "#155d35",
      skills: [state_catalog_cards.S("constrict", "조이기", "R", "70D 후 잔여 에너지 전부 제거, 그 절반만큼 대상 최근 에너지 제거.", "enemy", [{
        type: "summonConstrict",
        amount: 70
      }], ["damage", "energy"], {
        runtimeKind: "summonConstrict"
      })]
    },
    summonJaguar: {
      id: "summonJaguar",
      name: "재규어",
      grade: "소환물",
      maxHp: 160,
      maxEnergy: 4,
      baseDefense: 0,
      traits: [],
      summonBehavior: "rage",
      summonIcon: "🐆",
      summonColor: "#2b7d42",
      resetDeathBaselineOnTurn: true,
      skills: [state_catalog_cards.S("rageClaw", "분노발톱", "***-", "최근 아군 사망 수 n에 따라 Cost max(0,3-n), 80+60nD.", "enemy", [{
        type: "summonRageClaw",
        base: 80,
        perDeath: 60
      }], ["damage"], {
        runtimeKind: "summonRageClaw"
      })]
    }
  };
  registerRuntimeSkillContainer(state_features_summons.SUMMON_DEFS);
}
export function fragmentDefense(u, g) {
  return cardHasCapability(u, "fragmentTrait") && traitsActive(u, g) ? Math.round((colorAmount(u, "R") + colorAmount(u, "B")) * 10) : 0;
}
export function circuitBlocksExternal(target, source) {
  return !!(target && cardHasCapability(target, "fragmentTrait") && traitsActive(target) && (!source || source.uid !== target.uid));
}
export function countCompleteW(u) {
  return Math.max(0, Math.floor(colorAmount(u, "W") + 1e-6));
}
export function allBattleUnits(g, t, includeSummons = true) {
  return [...(g.teams[t]?.field || []), ...(includeSummons ? g.teams[t]?.summons || [] : [])].filter(u => u && !u.dead);
}
export function targetRef(g, t, u) {
  const fi = g.teams[t].field.findIndex(x => x?.uid === u.uid);
  return fi >= 0 ? {
    team: t,
    slot: fi,
    uid: u.uid
  } : {
    team: t,
    slot: `summon:${u.uid}`,
    uid: u.uid,
    summonUid: u.uid
  };
}
export function makeSummon(g, t, owner, type) {
  const def = state_features_summons.SUMMON_DEFS[type],
    u = makeUnit(owner.card, `sm-${type}-${g.turnSerial}-${Math.random().toString(36).slice(2, 7)}`);
  u.card = type;
  u.name = def.name;
  u.hp = u.maxHp = def.maxHp;
  u.shield = 0;
  u.baseDefense = u.defense = u.defenseMod = 0;
  u.energy = [];
  u.statuses = {};
  u.skillSeals = {};
  u.dead = false;
  u.isSummon = true;
  u.ownerUid = owner.uid;
  u.summonSerial = g._summonSerial = (g._summonSerial || 0) + 1;
  u.deathBaseline = g.teams[t].deathSerial || 0;
  return u;
}
export function removeRecentEnergyExternal(g, target, amount, source) {
  if (circuitBlocksExternal(target, source)) {
    log(g, `${target.name} 특성 · 프레그먼트: 외부 에너지 조작 차단.`);
    return 0;
  }
  let left = amount,
    removed = 0,
    store = target.energy || [];
  for (let i = store.length - 1; i >= 0 && left > 1e-6; i--) {
    let take = Math.min(store[i].a, left);
    store[i].a -= take;
    left -= take;
    removed += take;
    if (store[i].a < .01) store.splice(i, 1);
  }
  if (source) source.energyDisrupt = (source.energyDisrupt || 0) + removed;
  if (removed) log(g, `${target.name}: 최근 에너지 ${energyAmountText(removed)}개 분량 제거.`);
  const result = +removed.toFixed(1);
  notifyReactiveEnergyMutation(g, target, false, "최근 에너지 제거");
  return result;
}
export function stealRecentEnergy(g, actor, target) {
  if (circuitBlocksExternal(target, actor)) {
    log(g, `${target.name} 특성 · 프레그먼트: 에너지 강탈 차단.`);
    return 0;
  }
  const store = target.energy || [];
  if (!store.length) return 0;
  const e = store.pop(),
    ok = grantEnergyWithDiscard(g, actor, e.c, e.a);
  if (!ok) {
    store.push(e);
    return 0;
  }
  actor.energyDisrupt = (actor.energyDisrupt || 0) + e.a;
  log(g, `${actor.name}: ${target.name}의 최근 ${e.c}${e.a === .5 ? "½" : ""} 강탈.`);
  notifyReactiveEnergyMutation(g, target, false, "에너지 강탈됨");
  notifyReactiveEnergyMutation(g, actor, true, "에너지 강탈");
  return e.a;
}
export function summonLimitReached(g, t, owner) {
  return (g.teams[t].summons || []).filter(x => x && !x.dead && x.ownerUid === owner.uid).length >= 2;
}
export function summonUnit(g, t, owner, type) {
  if (summonLimitReached(g, t, owner)) {
    log(g, `${owner.name}: 살아 있는 소환물 2마리 제한.`);
    return null;
  }
  const u = makeSummon(g, t, owner, type);
  g.teams[t].summons.push(u);
  log(g, `${owner.name}: ${u.name} 소환(HP ${u.maxHp}).`);
  queueVisual(g, {
    type: "jcSummonFx",
    uid: owner.uid,
    targetUid: u.uid,
    summonType: type
  });
  return u;
}
export function summonTargets(g, t) {
  return allBattleUnits(g, other(t), true);
}
export function bestSummonEnemy(g, t) {
  return summonTargets(g, t).sort((a, b) => a.hp - b.hp || allEnergy(b) - allEnergy(a))[0] || null;
}
export function processJunglesSummons(g, t, owner) {
  if (!g || g.winner || !owner || owner.dead) return;
  g.pendingSummonTurns ||= [];
  const queued = new Set(g.pendingSummonTurns.map(q => q.summonUid));
  const list = (g.teams[t]?.summons || []).filter(u => u && !u.dead && u.ownerUid === owner.uid && !queued.has(u.uid)).sort((a, b) => b.summonSerial - a.summonSerial);
  for (const u of list) {
    const q = {
      team: t,
      ownerUid: owner.uid,
      summonUid: u.uid,
      summonSerial: u.summonSerial
    };
    ensurePendingSummonIdentity(g, q, u);
    g.pendingSummonTurns.push(q);
  }
  if (list.length) log(g, `${owner.name}: 소환물 행동 ${list.length}회 대기.`, 'turn');
}
export function customGatherColor(g, t, u, rng = g?.rng, source = "custom-gather") {
  if (cardHasCapability(u, "jungleMud") && traitsActive(u)) return "B";
  if (cardHasCapability(u, "alternatingCharge") && traitsActive(u)) {
    const prev = u.circuitLastGatherColor;
    if (prev === "W") return drawRandomEnergyColor(g, {
      recipient: u,
      team: t,
      source: `${source}-circuit-alternating-r-or-b`,
      candidates: ["R", "B"],
      amount: status(u, "slow") ? .5 : 1,
      rng
    });
    if (prev === "R" || prev === "B") return "W";
  }
  return null;
}
export function previewCustomGatherProposal(g, t, s, u, amount) {
  const amt = Number(amount || 0),
    store = energyStore(u),
    existingHalf = amt === .5 ? store.find(e => e.a === .5) : null,
    rngState = Number(g?.rng?.s ?? 0),
    previewRng = cloneRngForPreview(g?.rng),
    before = Number(previewRng?.s ?? rngState),
    colors = naturalColors(g, t, u, amt, null, "custom-natural-preview");
  const color = existingHalf?.c || customGatherColor(g, t, u, previewRng, "custom-gather-preview") || (colors.length === 1 ? colors[0] : previewRng?.pick(colors));
  if (!color) return null;
  return Object.freeze({
    version: 1,
    kind: "custom-gather",
    turnSerial: Number(g.turnSerial || 0),
    team: t,
    slot: Number(s),
    uid: u.uid || null,
    actor: null,
    amount: amt,
    color,
    candidates: Object.freeze([...colors]),
    rngState,
    rngUsed: Number(previewRng?.s ?? before) !== before
  });
}
export function consumeCustomGatherProposal(g, t, s, u, amount, proposal) {
  if (!proposal || proposal.kind !== "custom-gather" || !g || !u) return null;
  const amt = Number(amount || 0),
    colors = naturalColors(g, t, u, amt, null, "custom-natural-execute"),
    store = energyStore(u),
    existingHalf = amt === .5 ? store.find(e => e.a === .5) : null;
  if (Number(proposal.turnSerial) !== Number(g.turnSerial || 0) || proposal.team !== t || Number(proposal.slot) !== Number(s) || proposal.uid !== (u.uid || null) || Math.abs(Number(proposal.amount || 0) - amt) > .001 || !Array.isArray(proposal.candidates) || proposal.candidates.join("") !== colors.join("")) return null;
  if (proposal.rngUsed && Number(g?.rng?.s ?? 0) !== Number(proposal.rngState)) return null;
  const stateBefore = Number(g?.rng?.s ?? 0),
    actual = existingHalf?.c || customGatherColor(g, t, u, g.rng, "custom-gather-execute") || (colors.length === 1 ? colors[0] : g.rng.pick(colors));
  if (actual !== proposal.color) {
    if (proposal.rngUsed) g.rng.s = stateBefore;
    return null;
  }
  return actual;
}
export function executeCustomGather(g, t, s, u, a) {
  const amt = status(u, "slow") ? .5 : 1,
    store = energyStore(u),
    max = card(u).maxEnergy || 4,
    existingHalf = amt === .5 ? store.find(e => e.a === .5) : null,
    col = a.gatherProposal ? consumeCustomGatherProposal(g, t, s, u, amt, a.gatherProposal) : existingHalf?.c || a.forcedDirectColor || customGatherColor(g, t, u, g.rng, "custom-gather") || a.color || g.rng.pick(naturalColors(g, t, u, amt, null, "custom-natural-fallback"));
  if (!col) return false;
  if (existingHalf) log(g, `${u.name}: 기존 ${col} 반에너지와 합치기 위해 자연 수급 색이 ${col}로 고정.`);
  let gained = false;
  if (totalEnergy(u) + amt > max + .001) {
    if (a.discardNew === true) {
      gained = false;
      log(g, `${u.name}: 새 ${col}${amt === .5 ? "½" : ""} 에너지를 버림.`);
    } else {
      let ri = a.replaceIndex ?? a.replaceIndices;
      if (ri == null && (!isLocallyControlledTeam(g, t) || g.mode === "aivai")) ri = bestEnergyReplacementPlan(u, col, amt);
      const one = Array.isArray(ri) ? ri[0] : ri;
      gained = one != null && gainEnergy(g, u, col, amt, one);
      if (gained) log(g, `${u.name}: 기존 에너지 하나를 버리고 ${col}${amt === .5 ? "½" : ""} 에너지 획득.`);else log(g, `${u.name}: ${col}${amt === .5 ? "½" : ""} 에너지 포기(최대치).`);
    }
  } else {
    gained = gainEnergy(g, u, col, amt);
    if (gained) log(g, `${u.name}: ${col}${amt === .5 ? "½" : ""} 에너지 획득.`);
  }
  if (gained && cardHasCapability(u, "alternatingCharge") && traitsActive(u)) u.circuitLastGatherColor = col;
  u.lastAction = "gather";
  advanceDualOrEnd(g, t, s, u, false, false);
  return true;
}
export function vortexSlotIdentity(ref) {
  if (!ref || !Number.isInteger(Number(ref.index))) return "";
  return `${ref.uid}:${ref.actor || "main"}:${Number(ref.index)}`;
}
export function applyRestrictedVortex(g, actor, action) {
  const ids = action?.vortexTargets || [];
  if (ids.length !== 2 || ids[0] === ids[1]) return 0;
  const A = findUnit(g, ids[0]),
    B = findUnit(g, ids[1]);
  if (!A || !B || A.dead || B.dead || !g.teams[teamOf(g, A)].field.some(x => x?.uid === A.uid) || !g.teams[teamOf(g, B)].field.some(x => x?.uid === B.uid)) return 0;
  let count = 0,
    blocked = 0;
  const usedSlots = new Set();
  for (const pair of action.vortexSwaps || []) {
    const [sa, sb] = pair || [],
      keyA = vortexSlotIdentity(sa),
      keyB = vortexSlotIdentity(sb);
    if (!sa || !sb || !keyA || !keyB || keyA === keyB || sa.uid === sb.uid || ![A.uid, B.uid].includes(sa.uid) || ![A.uid, B.uid].includes(sb.uid) || usedSlots.has(keyA) || usedSlots.has(keyB)) continue;
    const ua = findUnit(g, sa.uid),
      ub = findUnit(g, sb.uid);
    if (circuitBlocksExternal(ua, actor) || circuitBlocksExternal(ub, actor)) {
      blocked++;
      continue;
    }
    const ea = energyStore(ua, sa.actor || null)[Number(sa.index)],
      eb = energyStore(ub, sb.actor || null)[Number(sb.index)];
    if (!ea || !eb || ea.c === eb.c) continue;
    usedSlots.add(keyA);
    usedSlots.add(keyB);
    const color = ea.c;
    ea.c = eb.c;
    eb.c = color;
    count++;
  }
  log(g, `${actor.name}: 심해의소용돌이 대상 ${A.name} ↔ ${B.name}, 색 교환 ${count}회${blocked ? `, 차단 ${blocked}회` : ""}.`);
  queueVisual(g, {
    type: "vortexSwapFx",
    uid: actor.uid,
    swaps: count
  });
  return count;
}
export function resolveVoltageBurst(g, t, u, target, skill, sim = false) {
  const m = clearColorEnergy(u, "W", u),
    amount = Math.round(m * m * 15),
    d = target && !target.dead ? dealDamage(g, u, target, {
      amount
    }, skill, sim) : 0;
  for (let i = 0; i < Math.floor(m); i++) grantEnergyWithDiscard(g, u, "B", 1);
  if (m % 1 > .001) grantEnergyWithDiscard(g, u, "B", .5);
  queueVisual(g, {
    type: "voltageBurstFx",
    uid: u.uid,
    targetUid: target?.uid,
    m,
    amount
  });
  log(g, `${u.name}: 볼티지버스트 W ${energyAmountText(m)} 제거 → ${amount}D, B ${energyAmountText(m)} 획득.`);
  u.scheduledAction = null;
  return d;
}
export function vortexEnergySlots(u) {
  const out = [];
  for (const {
    actor,
    store
  } of energyStoresWithLabels(u)) store.forEach((e, index) => out.push({
    uid: u.uid,
    actor,
    index,
    c: e.c,
    a: e.a
  }));
  return out;
}
export function summonPanelHTML(g, t, u) {
  const e = energyHTML(u),
    sts = Object.entries(u.statuses || {}).map(([k, v]) => `${state_engine_entities.STATUS[k] || k}${v}`).join(" ") || "없음",
    owner = findUnit(g, u.ownerUid),
    def = card(u),
    behavior = cardCapability(u, "summonBehavior", ""),
    n = behavior === "rage" ? Math.max(0, (g.teams[t].deathSerial || 0) - (u.deathBaseline || 0)) : 0,
    skill = behavior === "support" ? "힐링윙 / 쪼아먹기" : behavior === "constrict" ? "조이기" : behavior === "rage" ? `분노발톱 · 사망 ${n} · Cost ${"*".repeat(Math.max(0, 3 - n)) || "없음"} · ${80 + 60 * n}D` : (def.skills || []).map(x => x.name).join(" / ") || "없음",
    cur = normalizePendingSummonTurns(g),
    state = cur?.u.uid === u.uid ? "현재 행동 중" : (g.pendingSummonTurns || []).some(q => q.summonUid === u.uid) ? "행동 대기" : "정글즈 차례 후 행동";
  return `<div class="summon-card ${u.dead ? "dead" : ""}" data-zone="field" data-team="${t}" data-slot="summon:${u.uid}" data-uid="${u.uid}"><div class="summon-head"><span class="summon-emoji">${cardCapability(u, "summonIcon", "◆")}</span>${u.name}</div><div class="summon-detail">HP ${combatInt(u.hp)}/${u.maxHp}<br>E ${e}<br>상태 ${sts}<br>${skill}<br><span class="summon-ready">${state}</span></div></div>`;
}
export function pointForUid(arena, uid) {
  return state_presentation_coordinates.VfxCoordinateOwner.point(arena, state_presentation_coordinates.battleVisualElement(uid));
}
export function playJcVisual(v) {
  const arena = document.querySelector('.arena');
  if (!arena) return;
  const from = pointForUid(arena, v.uid),
    to = pointForUid(arena, v.targetUid || v.uid);
  if (!from || !to) {
    systems.PresentationFailureChannel?.emit?.({
      surface: "vfx",
      phase: "VFX_ANCHOR_RESOLUTION_FAILED",
      error: "jc anchor unavailable",
      battleId: state_ui_battle_state.game?.battleId || state_ui_battle_state.game?.matchId || null
    });
    return;
  }
  if (v.type === "groundZeroDelayed") {
    const orb = visualNode(arena, 'jc-fx gz-orb', '', 900);
    orb?.style.setProperty('--from-x', `${from.x}px`);
    orb?.style.setProperty('--from-y', `${from.y}px`);
    orb?.style.setProperty('--to-x', `${to.x}px`);
    orb?.style.setProperty('--to-y', `${to.y}px`);
    TimerManager.setTimeout(() => {
      const boom = visualNode(arena, 'jc-fx gz-mega', '', 1400),
        ring = visualNode(arena, 'jc-fx gz-mega-ring', '', 1400);
      positionFx(boom, to);
      positionFx(ring, to);
      arena.classList.add('groundzero-shake');
      TimerManager.setTimeout(() => arena.classList.remove('groundzero-shake'), 900);
    }, 760);
    return;
  }
  if (v.type === "jcVineFx") {
    const dx = to.x - from.x,
      dy = to.y - from.y,
      line = visualNode(arena, 'jc-fx vine-line', '', 1000);
    line?.style.setProperty('--from-x', `${from.x}px`);
    line?.style.setProperty('--from-y', `${from.y}px`);
    line?.style.setProperty('--beam-length', `${Math.hypot(dx, dy)}px`);
    line?.style.setProperty('--beam-angle', `${Math.atan2(dy, dx)}rad`);
    const wrap = visualNode(arena, 'jc-fx vine-wrap', '', 1000);
    positionFx(wrap, to);
    const leaf = visualNode(arena, 'jc-fx leaf-half', 'W½', 1100);
    positionFx(leaf, from);
    if (v.stolen) {
      const sp = visualNode(arena, 'jc-fx steal-spark', '', 1100);
      sp?.style.setProperty('--from-x', `${to.x}px`);
      sp?.style.setProperty('--from-y', `${to.y}px`);
      sp?.style.setProperty('--to-x', `${from.x}px`);
      sp?.style.setProperty('--to-y', `${from.y}px`);
    }
    return;
  }
  if (v.type === "jcSummonFx") {
    const n = visualNode(arena, 'jc-fx summon-burst', '', 1200);
    positionFx(n, from);
    n?.style.setProperty('--summon-color', state_features_summons.SUMMON_DEFS[v.summonType]?.summonColor || '#d4ed62');
    return;
  }
  if (v.type === "jcSummonAction") {
    const cls = v.kind === "coil" ? 'coil-fx' : v.kind === "claw" ? 'claw-fx' : 'feather-fx',
      n = visualNode(arena, `jc-fx ${cls}`, v.kind === "heal" ? '🪶' : '', 1100);
    positionFx(n, to);
    return;
  }
  if (v.type === "circuitRoundFx") {
    const ring = visualNode(arena, 'jc-fx circuit-ring', '', 1100);
    positionFx(ring, from);
    for (const uid of v.targetUids || []) {
      const pt = pointForUid(arena, uid),
        r = visualNode(arena, 'jc-fx circuit-ring', '', 900);
      positionFx(r, pt);
    }
    return;
  }
  if (v.type === "circuitArmsFx") {
    const dx = to.x - from.x,
      dy = to.y - from.y;
    for (let k = 0; k < 2; k++) {
      const blade = visualNode(arena, 'jc-fx circuit-blade', '', 900);
      blade?.style.setProperty('--from-x', `${from.x}px`);
      blade?.style.setProperty('--from-y', `${from.y + (k ? 9 : -9)}px`);
      blade?.style.setProperty('--beam-length', `${Math.hypot(dx, dy)}px`);
      blade?.style.setProperty('--beam-angle', `${Math.atan2(dy, dx) + (k ? -.04 : .04)}rad`);
    }
    const pop = visualNode(arena, 'jc-fx fragment-pop', `방어 +${v.defense}`, 1100);
    positionFx(pop, from);
    return;
  }
  if (v.type === "voltagePrepareFx") {
    for (let i = 0; i < v.rings; i++) {
      const ring = visualNode(arena, 'jc-fx voltage-orbit', '', 1300);
      positionFx(ring, from);
      ring?.style.setProperty('--ring-index', i);
    }
    return;
  }
  if (v.type === "voltageFailFx") {
    const ring = visualNode(arena, 'jc-fx circuit-ring', '실패', 900);
    positionFx(ring, from);
    return;
  }
  if (v.type === "voltageBurstFx") {
    for (let i = 0; i < Math.max(1, Math.ceil(v.m)); i++) {
      const ring = visualNode(arena, 'jc-fx voltage-orbit', '', 1000);
      positionFx(ring, from);
      ring?.style.setProperty('--ring-index', i);
    }
    TimerManager.setTimeout(() => {
      const core = visualNode(arena, 'jc-fx voltage-core', '', 1200);
      positionFx(core, to);
      visualNode(state_presentation_coordinates.battleEntityElement(v.targetUid), 'float-num status-pop', `${v.amount}D`, 900);
    }, 360);
    return;
  }
}
export function listSummonSkillActions(g, t, s) {
  let a = [],
    u = unitAt(g, t, s);
  if (!u || u.dead) return a;
  if (!!firstSkillByEffect(u, "junglesVineWhip")) {
    const fieldOnly = a;
    const sk = firstSkillByEffect(u, "junglesVineWhip");
    if (sk && !u.skillSeals?.[skillIdByEffect(u, "junglesVineWhip")] && canPayAction(g, t, u, sk.cost)) for (const target of summonTargets(g, t)) fieldOnly.push({
      type: "skill",
      skill: skillIdByEffectGlobal("junglesVineWhip"),
      target: targetRef(g, other(t), target),
      label: sk.name
    });
    a = fieldOnly;
  }
  if (!!firstSkillByEffect(u, "circuitVoltageBurst") || !!firstSkillByEffect(u, "circuitArmsBlade")) {
    const enemies = summonTargets(g, t),
      arms = firstSkillByEffect(u, "circuitArmsBlade"),
      volt = firstSkillByEffect(u, "circuitVoltageBurst");
    if (arms && !u.skillSeals?.[skillIdByEffect(u, "circuitArmsBlade")] && canPayAction(g, t, u, arms.cost)) for (const target of enemies) a.push({
      type: "skill",
      skill: skillIdByEffectGlobal("circuitArmsBlade"),
      target: targetRef(g, other(t), target),
      label: arms.name
    });
    if (volt && !u.skillSeals?.[skillIdByEffect(u, "circuitVoltageBurst")] && countCompleteW(u) >= 1) for (const target of enemies) a.push({
      type: "skill",
      skill: skillIdByEffectGlobal("circuitVoltageBurst"),
      target: targetRef(g, other(t), target),
      voltageN: countCompleteW(u),
      label: volt.name
    });
  }
  if (!!firstSkillByEffect(u, "abyssVortex")) {
    const sk = firstSkillByEffect(u, "abyssVortex");
    if (sk && !u.skillSeals?.[skillIdByEffect(u, "abyssVortex")] && canPayAction(g, t, u, sk.cost)) {
      const fields = [...g.teams.P.field, ...g.teams.A.field].filter(x => x && !x.dead);
      for (let i = 0; i < fields.length; i++) for (let j = i + 1; j < fields.length; j++) a.push({
        type: "skill",
        skill: skillIdByEffectGlobal("abyssVortex"),
        target: {
          team: t,
          slot: s,
          uid: u.uid
        },
        vortexTargets: [fields[i].uid, fields[j].uid],
        vortexSwaps: [],
        label: sk.name
      });
    }
  }
  return a;
}
export function applySummonEffect(g, actor, target, e, skill, ctx) {
  const t = ctx?.team || teamOf(g, actor),
    a = ctx?.action || {};
  if (e.type === "abyssVortex") return applyRestrictedVortex(g, actor, a);
  if (e.type === "suctionPad" && circuitBlocksExternal(target, actor)) {
    const allied = teamOf(g, target) === t;
    if (allied) {
      const d = nonAttackDamage(g, target, 20, "흡착 발판");
    }
    log(g, `${target.name} 특성 · 프레그먼트: 흡착 발판의 R 부여 차단.`);
    return 0;
  }
  if (e.type === "junglesVineWhip") {
    const d = dealDamage(g, actor, target, {
      amount: 20
    }, skill, ctx.sim);
    grantEnergyWithDiscard(g, actor, "W", .5, a.wDiscardSpecs || null);
    const first = !actor.vineWhipFirstUsed,
      afflicted = Object.keys(actor.statuses || {}).some(k => status(actor, k) > 0);
    actor.vineWhipFirstUsed = true;
    let stolen = 0;
    if (first || afflicted) stolen = stealRecentEnergy(g, actor, target);
    queueVisual(g, {
      type: "jcVineFx",
      uid: actor.uid,
      targetUid: target.uid,
      stolen
    });
    return d;
  }
  if (state_features_summons.SUMMON_DEFS[e.type]) return summonUnit(g, t, actor, e.type);
  if (e.type === "circuitRoundKick") {
    let total = 0,
      targets = allBattleUnits(g, other(t), true);
    for (const x of targets) total += dealDamage(g, actor, x, {
      amount: 30
    }, skill, ctx.sim);
    queueVisual(g, {
      type: "circuitRoundFx",
      uid: actor.uid,
      targetUids: targets.map(x => x.uid)
    });
    return total;
  }
  if (e.type === "circuitArmsBlade") {
    const amount = target.maxHp * .25,
      d = dealDamage(g, actor, target, {
        amount
      }, skill, ctx.sim);
    if (!target.dead) applyStatus(g, target, "paralyze", 1, actor);
    for (const c of ["B", "R"]) {
      grantEnergyWithDiscard(g, actor, c, 1);
    }
    queueVisual(g, {
      type: "circuitArmsFx",
      uid: actor.uid,
      targetUid: target.uid,
      defense: fragmentDefense(actor)
    });
    return d;
  }
  if (e.type === "circuitVoltageBurst") {
    const n = Math.max(1, a.voltageN || countCompleteW(actor));
    if (n <= 1) return resolveVoltageBurst(g, t, actor, target, skill, ctx.sim);
    registerScheduledAction(g, actor, {
      kind: "voltageBurst",
      targetTeam: teamOf(g, target),
      targetSlot: targetRef(g, teamOf(g, target), target).slot,
      targetUid: target.uid,
      remaining: n - 1,
      initialN: n
    });
    queueVisual(g, {
      type: "voltagePrepareFx",
      uid: actor.uid,
      rings: 1,
      total: n
    });
    log(g, `${actor.name}: 볼티지버스트 준비 1/${n}.`);
    return 0;
  }
  return;
}
export function renderSummonZones() {
  if (!state_ui_battle_state.game) return;
  for (const t of ["P", "A"]) {
    const pre = displaySideFor(state_ui_battle_state.game, t),
      side = document.querySelector(`.${pre}-side`),
      list = (state_ui_battle_state.game.teams[t].summons || []).filter(u => u && !u.dead);
    let zone = side?.querySelector('.summon-zone');
    if (!list.length) {
      zone?.remove();
      continue;
    }
    if (!zone && side) {
      zone = document.createElement('div');
      zone.className = 'summon-zone';
      const slots = side.querySelector('.slots');
      slots?.insertAdjacentElement('afterend', zone);
    }
    if (zone) zone.innerHTML = `<div class="summon-zone-title">소환물 ${list.length}/2</div><div class="summon-list">${list.map(u => summonPanelHTML(state_ui_battle_state.game, t, u)).join('')}</div>`;
  }
  if (state_ui_battle_state.pendingSkill) for (const tar of state_ui_battle_state.pendingSkill.targets || []) {
    const uid = tar?.uid ? CSS.escape(String(tar.uid)) : "";
    const el = uid ? document.querySelector(`.card[data-zone="field"][data-uid="${uid}"],.summon-panel[data-uid="${uid}"]`) : document.querySelector(`.card[data-zone="field"][data-team="${tar.team}"][data-slot="${tar.slot}"]`);
    if (el) {
      el.classList.add('targetable');
      el.onclick = () => playerChooseTarget(tar);
    }
  }
  return;
}

// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_features_elixian = {
  ELIXIAN_CARD: undefined
};
import { skillRequirementsMet, state_catalog_cards } from "../catalog/cards.js";
import { enemyTargets, other, unitAt } from "../engine/actions.js";
import { afterBodyHpChange, applyStatus, checkDeath, dealDamage, heal, queueVisual, teamOf, traitsActive } from "../engine/combat.js";
import { addHpProtectionBarrier, memoryOptions } from "../engine/effects.js";
import { healingBecomesDamage } from '../engine/status-rules.js';
import { allEnergy, canPayAction, gainEnergy, status } from "../engine/energy.js";
import { card, cardHasCapability, firstSkillByEffect, firstSkillByTag, skillDefHasEffect, skillDefHasTag, state_engine_entities } from "../engine/entities.js";
import { dmChooseMemoryOption, dmCostLabel, dmLocalTurn } from "./dragon-memory.js";
import { log, normalizeGameNumberText } from "../presentation/audio.js";
import { combatInt, state_ui_battle_state } from "../ui/battle-state.js";
import { escapeUIHTML, state_ui_cards } from "../ui/cards.js";
import { registerCardDefinition } from "../ui/deck.js";
import { displaySideFor } from "../ui/setup.js";
export function initializeFeaturesElixian() {
  state_features_elixian.ELIXIAN_CARD = state_catalog_cards.C("elixian", "엘릭시안", 200, "회복·필드 지원", "메가리그", "잔향: 사망하면 같은 슬롯의 다음 출전 아군이 자기 차례 시작마다 HP 10을 영구 회복한다.", [state_catalog_cards.S("shiningWind", "샤이닝윈드", "RorB", "아군 전체 HP 20 회복, W½ 획득. 초과 회복은 대상별 최대 80 HP 보호막으로(감소 없음).", "self", [{
    type: "elixianShiningWind"
  }], ["heal", "hpProtectionBarrier", "energy"]), state_catalog_cards.S("aromaField", "아로마필드", "*", "자기 진영 능력치 증감을 0으로 초기화, 필드 전개: 아군 회복 +10, 상대 회복 -10·방어 -10. 필드 효과는 하나만 유지되어 새 필드가 기존 필드를 교체하고, 전개한 캐릭터가 후퇴하거나 쓰러지면 끝난다.", "self", [{
    type: "elixianAromaField"
  }], ["field", "heal", "debuff"], {
    nonAttack: true
  }), state_catalog_cards.S("multiArrow", "멀티애로", "W", "20D. 대상 등급이 자신보다 높으면 2회, 같거나 낮으면 3회 공격. 각 타격은 별도 판정.", "enemy", [{
    type: "elixianMultiArrow"
  }], ["damage", "multi"]), state_catalog_cards.S("lastGift", "라스트기프트", "**", "적 전체 냉동·마비 1턴. 남은 HP 전부를 선택한 아군에게 최대 HP까지 이전 후 사망, 잔향을 남김.", "allyOther", [{
    type: "elixianLastGift"
  }], ["heal", "status", "sacrifice"], {
    nonAttack: true
  })], {
    grade: "4☆",
    shield: 10,
    releaseOrder: 16,
    resonanceTrait: true,
    tags: ["support", "aroma"]
  });
  registerCardDefinition(state_features_elixian.ELIXIAN_CARD);
  state_ui_cards.CARD_EMOJI_MAP.elixian = ["🦋", "💗"];
}
export function elixianHealAmount(g, target, base) {
  let amount = Math.max(0, Math.round(Number(base) || 0)),
    t = teamOf(g, target);
  if (t && g.fieldEffect?.type === "aroma") amount += g.fieldEffect.team === t ? 10 : -10;
  return Math.max(0, amount);
}
export function totalHpProtection(u) {
  return Math.max(0, combatInt((u?.hpProtectionBarriers || []).reduce((n, x) => n + Number(x.amount || 0), 0)));
}
export function elixianHpProtection(u) {
  return Math.max(0, combatInt((u?.hpProtectionBarriers || []).reduce((n, x) => n + (x.kind === "elixian" ? Number(x.amount || 0) : 0), 0)));
}
export function syncAromaCombatFlags(g) {
  if (!g?.teams) return;
  for (const t of ["P", "A"]) for (const u of [...(g.teams[t].field || []), ...(g.teams[t].bench || []), ...(g.teams[t].graveyard || [])]) if (u) u.aromaDamagePenalty = false;
  if (g.fieldEffect?.type !== "aroma") return;
  const bad = other(g.fieldEffect.team);
  for (const u of g.teams[bad].field || []) if (u && !u.dead) u.aromaDamagePenalty = true;
}
export function copySkillTargetRefs(g, t, s, actor, sk) {
  const own = g.teams[t].field.map((u, i) => u && !u.dead ? {
    team: t,
    slot: i,
    uid: u.uid
  } : null).filter(Boolean);
  const enemies = enemyTargets(g, t);
  switch (sk?.target) {
    case "self":
    case "field":
      return [{
        team: t,
        slot: s,
        uid: actor.uid
      }];
    case "ally":
      return own;
    case "allyOther":
    case "allyOtherAny":
      return own.filter(x => x.uid !== actor.uid);
    case "anyCharacter":
      return [...own, ...enemies];
    case "lowestEnergyEnemy":
      {
        if (!enemies.length) return [];
        const min = Math.min(...enemies.map(x => allEnergy(unitAt(g, x.team, x.slot))));
        return enemies.filter(x => Math.abs(allEnergy(unitAt(g, x.team, x.slot)) - min) < .001);
      }
    case "enemySlot":
      return g.teams[other(t)].field.map((u, i) => ({
        team: other(t),
        slot: i,
        uid: u?.uid || null
      }));
    case "enemy":
    default:
      return enemies;
  }
}
export function copiedSkillAllowed(actor, sk) {
  if (!sk || skillDefHasTag(sk, "copy") || !skillRequirementsMet(actor, sk)) return false;
  if (skillDefHasEffect(sk, "firestorm") && actor.hp > 90) return false;
  return true;
}
export function appendCopiedSkillActions(actions, g, t, s, actor, baseSkillId, option, prefix) {
  const sk = option.skill,
    actualCost = option.cost ?? sk.cost ?? "";
  if (!copiedSkillAllowed(actor, sk) || !canPayAction(g, t, actor, actualCost)) return;
  const targets = copySkillTargetRefs(g, t, s, actor, sk);
  for (const target of targets) {
    const action = {
      type: "skill",
      skill: baseSkillId,
      copySkill: sk.id,
      copyCard: option.card.id,
      copyTargetType: sk.target,
      costOverride: actualCost,
      target,
      label: `${prefix}: ${option.card.name} · ${sk.name}`
    };
    if (skillDefHasEffect(sk, "foxStrike")) {
      action.strikeMode = "single";
      // actualCost already includes Dragon Memory's extra *.
      action.costOverride = actualCost;
    }
    actions.push(action);
  }
}
export function openDragonMemoryMenu() {
  if (!state_ui_battle_state.game || state_ui_battle_state.busy) return;
  const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    actor = unitAt(state_ui_battle_state.game, t, s);
  if (!actor || actor.dead || !firstSkillByTag(actor, "copy") || !dmLocalTurn(state_ui_battle_state.game, t)) return;
  const options = memoryOptions(state_ui_battle_state.game, t, actor);
  const root = state_ui_battle_state.$("#modalContent");
  root.innerHTML = `<h2>드래곤메모리</h2><p>후열에 있는 드래곤의 첫 번째 기술 중 하나를 선택하세요.</p><div id="dragonMemoryChoices" class="choice-list"></div>`;
  const list = state_ui_battle_state.$("#dragonMemoryChoices");
  if (!options.length) list.innerHTML = `<div class="effect-box tiny">복사할 수 있는 후열 드래곤이 없습니다.</div>`;
  for (const option of options) {
    const labels = option.costVariants.map(cost => dmCostLabel(state_ui_battle_state.game, t, actor, cost));
    const payable = copiedSkillAllowed(actor, option.skill) && option.costVariants.some(cost => canPayAction(state_ui_battle_state.game, t, actor, cost));
    const button = document.createElement("button");
    button.className = "dragon-memory-choice";
    button.disabled = !payable;
    button.innerHTML = `<b>${escapeUIHTML(option.card.name)} · ${escapeUIHTML(option.skill.name)}</b> <span class="cost">${escapeUIHTML(labels.join(" 또는 "))}</span><br><span class="tiny">${escapeUIHTML(state_catalog_cards.EffectiveCardPresentationOwner.skill(option.unit, option.skill).description)}${payable ? "" : " · 현재 에너지로 사용 불가"}</span>`;
    button.onclick = () => {
      if (!button.disabled) dmChooseMemoryOption(option);
    };
    list.appendChild(button);
  }
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function installAromaLayer(side, good) {
  if (!side) return;
  side.classList.add(good ? "aroma-benefit" : "aroma-penalty");
}
export function ensureArenaAromaFx() {
  const arena = document.querySelector(".arena");
  if (!arena) return null;
  let layer = document.getElementById("arenaAromaFx");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "arenaAromaFx";
    layer.innerHTML = `<div class="arena-aroma-pane top-pane"></div><div class="arena-aroma-pane bottom-pane"></div><div class="arena-aroma-divider"></div>`;
    arena.appendChild(layer);
  }
  return layer;
}
export function aromaButterfliesHtml() {
  return `<span class="aroma-butterfly" style="--left:10%;--top:78%;--delay:-1.2s;--size:54px"></span><span class="aroma-butterfly" style="--left:34%;--top:74%;--delay:-4.1s;--size:48px"></span><span class="aroma-butterfly" style="--left:58%;--top:70%;--delay:-6.2s;--size:58px"></span><span class="aroma-butterfly" style="--left:80%;--top:76%;--delay:-8.3s;--size:46px"></span>`;
}
export function aromaVortexHtml() {
  return `<span class="aroma-vortex" style="--left:22%;--top:58%;--delay:-1.6s"></span><span class="aroma-vortex" style="--left:52%;--top:46%;--delay:-4.3s"></span><span class="aroma-vortex" style="--left:80%;--top:60%;--delay:-6.8s"></span>`;
}
export function installArenaAromaEffect(goodDisplay) {
  const layer = ensureArenaAromaFx();
  if (!layer) return;
  const arena = document.querySelector(".arena"),
    ai = document.querySelector(".ai-side"),
    player = document.querySelector(".player-side");
  const ar = arena.getBoundingClientRect(),
    aiRect = ai?.getBoundingClientRect(),
    pRect = player?.getBoundingClientRect();
  const splitPx = aiRect && pRect ? Math.max(0, Math.min(ar.height, (aiRect.bottom + pRect.top) / 2 - ar.top)) : ar.height / 2;
  layer.style.setProperty("--split", `${Math.round(splitPx)}px`);
  const topPane = layer.querySelector(".top-pane"),
    bottomPane = layer.querySelector(".bottom-pane");
  const goodTop = goodDisplay === "ai",
    signature = goodTop ? "good-top" : "good-bottom";
  layer.classList.toggle("good-top", goodTop);
  layer.classList.toggle("good-bottom", !goodTop);
  /* 렌더·온라인 heartbeat마다 innerHTML을 다시 쓰면 CSS 애니메이션 시간이 0으로 리셋된다. */
  if (layer.dataset.aromaSignature !== signature || !topPane.childElementCount || !bottomPane.childElementCount) {
    layer.dataset.aromaSignature = signature;
    topPane.innerHTML = goodTop ? aromaButterfliesHtml() : aromaVortexHtml();
    bottomPane.innerHTML = goodTop ? aromaVortexHtml() : aromaButterfliesHtml();
  }
}
export function scrubUserFacingUndefined(root = document.body) {
  if (!root) return;
  /*
   * 사용자에게 보이는 일반 텍스트만 정리한다.
   * STYLE/SCRIPT까지 normalizeGameNumberText()에 넣으면
   * `.screen.active .arena`의 공백이 제거되어 `.screen.active.arena`가 되는 등
   * CSS descendant selector가 렌더할 때마다 파괴된다.
   */
  const blocked = "script,style,template,noscript";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest(blocked)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const clean = normalizeGameNumberText(node.nodeValue);
    if (clean !== node.nodeValue) node.nodeValue = clean;
  }
  root.querySelectorAll?.("[title],[aria-label]").forEach(el => {
    if (el.closest?.(blocked)) return;
    for (const attr of ["title", "aria-label"]) {
      if (el.hasAttribute(attr)) el.setAttribute(attr, normalizeGameNumberText(el.getAttribute(attr)));
    }
  });
}
export function listResonanceActions(g, t, s) {
  let actions = [],
    u = unitAt(g, t, s);
  if (!u || u.dead) return actions;
  if (u.scheduledAction || status(u, "freeze") || status(u, "skillSeal")) return actions;
  if (!cardHasCapability(u, "resonanceTrait")) return actions;
  const shining = firstSkillByEffect(u, "elixianShiningWind"),
    aroma = firstSkillByEffect(u, "elixianAromaField"),
    multi = firstSkillByEffect(u, "elixianMultiArrow"),
    gift = firstSkillByEffect(u, "elixianLastGift");
  if (shining && !u.skillSeals?.[shining.id]) {
    for (const paidColor of ["R", "B"]) if (canPayAction(g, t, u, paidColor)) actions.push({
      type: "skill",
      skill: shining.id,
      costOverride: paidColor,
      displayCost: "RorB",
      target: {
        team: t,
        slot: s,
        uid: u.uid
      },
      label: shining.name
    });
  }
  if (aroma && !u.skillSeals?.[aroma.id] && canPayAction(g, t, u, aroma.cost)) actions.push({
    type: "skill",
    skill: aroma.id,
    target: {
      team: t,
      slot: s,
      uid: u.uid
    },
    label: aroma.name
  });
  if (multi && !u.skillSeals?.[multi.id] && canPayAction(g, t, u, multi.cost)) for (const target of enemyTargets(g, t)) actions.push({
    type: "skill",
    skill: multi.id,
    target,
    label: multi.name
  });
  if (gift && !u.skillSeals?.[gift.id] && canPayAction(g, t, u, gift.cost)) for (const target of g.teams[t].field.map((x, i) => x && !x.dead && x.uid !== u.uid ? {
    team: t,
    slot: i,
    uid: x.uid
  } : null).filter(Boolean)) actions.push({
    type: "skill",
    skill: gift.id,
    target,
    label: `${gift.name} → ${unitAt(g, target.team, target.slot).name}`
  });
  return actions;
}
export function applyResonanceEffect(g, actor, target, e, skill, ctx) {
  const t = ctx?.team || teamOf(g, actor);
  if (e.type === "elixianShiningWind") {
    let healing = 0,
      barriers = 0;
    for (const ally of g.teams[t].field || []) {
      if (!ally || ally.dead) continue;
      const adjusted = status(ally, "healSeal") ? 0 : elixianHealAmount(g, ally, 20);
      const inverted = healingBecomesDamage(ally);
      const got = heal(g, ally, 20, actor, {
          reason: "shining-wind",
          effectId: skill?.id || "shiningWind",
          sim: ctx?.sim
        }),
        overflow = inverted ? 0 : Math.max(0, adjusted - got);
      healing += got;
      if (overflow > 0) barriers += addHpProtectionBarrier(g, ally, overflow, actor.uid, "elixian");
    }
    gainEnergy(g, actor, "W", .5);
    log(g, `${actor.name}: 샤이닝윈드 · 아군 전체 회복 ${healing}, HP 보호막 ${barriers}, W½ 획득.`);
    queueVisual(g, {
      type: "elixianPulseFx",
      uid: actor.uid,
      shining: true
    });
    return healing;
  }
  if (e.type === "elixianAromaField") {
    for (const ally of g.teams[t].field || []) {
      if (!ally || ally.dead) continue;
      const decreaseImmune = traitsActive(ally) && card(ally).statDecreaseImmune;
      ally.attackMod = decreaseImmune ? Math.max(0, Number(ally.attackMod || 0)) : 0;
      ally.attackDecrease = 0;
      ally.defenseMod = decreaseImmune ? Math.max(0, Number(ally.defenseMod || 0)) : 0;
      ally.defense = ally.baseDefense + ally.defenseMod;
    }
    if (g.fieldEffect) log(g, `기존 필드 효과가 아로마필드로 교체됨.`);
    g.fieldEffect = {
      type: "aroma",
      ownerUid: actor.uid,
      team: t,
      serial: (g.fieldSerial || 0) + 1
    };
    g.fieldSerial = g.fieldEffect.serial;
    syncAromaCombatFlags(g);
    log(g, `${actor.name}: 아로마필드 전개 · 자기 진영 회복 +10, 상대 회복 -10, 상대 방어 -10.`);
    queueVisual(g, {
      type: "elixianPulseFx",
      uid: actor.uid,
      aroma: true
    });
    return 0;
  }
  if (e.type === "elixianMultiArrow") {
    const readGrade = (unit, role) => {
      const raw = card(unit)?.grade;
      const match = String(raw ?? "").trim().match(/^(\d+(?:\.\d+)?)\s*☆?$/);
      const value = match ? Number(match[1]) : NaN;
      if (!Number.isFinite(value)) {
        const detail = {
          role,
          entityId: unit?.entityId || unit?.uid || null,
          cardId: unit?.card || null,
          rawGrade: raw
        };
        const error = new Error(`Invalid ${role} grade: ${String(raw)}`);
        error.code = "INVALID_CARD_GRADE";
        error.gradeValidationDetail = detail;
        throw error;
      }
      return value;
    };
    const actorGrade = readGrade(actor, "actor");
    const targetGrade = readGrade(target, "target");
    const hits = targetGrade > actorGrade ? 2 : 3;
    const dealt = dealDamage(g, actor, target, {
      amount: 20,
      hits
    }, skill, ctx?.sim);
    actor.lastTarget = target?.uid || null;
    log(g, `${actor.name}: 멀티애로 ${hits}회 별도 공격 판정, 총 ${dealt}D.`);
    return dealt;
  }
  if (e.type === "elixianLastGift") {
    for (const enemy of g.teams[other(t)].field || []) {
      if (!enemy || enemy.dead) continue;
      applyStatus(g, enemy, "freeze", 1, actor);
      applyStatus(g, enemy, "paralyze", 1, actor);
    }
    const stock = Math.max(0, combatInt(actor.hp));
    let got = 0;
    if (!status(target, "healSeal")) {
      const old = target.hp;
      got = Math.max(0, Math.min(stock, target.maxHp - target.hp));
      target.hp += got;
      afterBodyHpChange(g, target, old);
      state_engine_entities.GenericBattleStatisticsOwner.recordHealing(g, {
        source: actor,
        target,
        requestedAmount: stock,
        actualAppliedAmount: got,
        reason: "last-gift",
        effectId: "elixianLastGift",
        sim: !!ctx?.sim
      });
      log(g, `${target.name}: 라스트기프트로 HP ${got} 이전 회복.`, "heal");
      queueVisual(g, target, "heal", got);
    } else log(g, `${target.name}: 회복봉인으로 라스트기프트 HP 이전 실패.`);
    actor.hp = 0;
    log(g, `${actor.name}: 남은 HP ${stock}을 넘기고 스스로 퇴장.`);
    checkDeath(g, actor, null);
    queueVisual(g, {
      type: "elixianPulseFx",
      uid: actor.uid,
      targetUid: target?.uid || null,
      lastGift: true
    });
    return got;
  }
  return;
}
export function renderAromaField() {
  document.querySelectorAll(".side.aroma-benefit,.side.aroma-penalty").forEach(x => x.classList.remove("aroma-benefit", "aroma-penalty"));
  if (state_ui_battle_state.game?.fieldEffect?.type !== "aroma") document.getElementById("arenaAromaFx")?.remove();
  if (!state_ui_battle_state.game) return;
  syncAromaCombatFlags(state_ui_battle_state.game);
  if (state_ui_battle_state.game.fieldEffect?.type === "aroma") {
    const goodDisplay = displaySideFor(state_ui_battle_state.game, state_ui_battle_state.game.fieldEffect.team),
      badDisplay = displaySideFor(state_ui_battle_state.game, other(state_ui_battle_state.game.fieldEffect.team));
    installAromaLayer(document.querySelector(`.${goodDisplay}-side`), true);
    installAromaLayer(document.querySelector(`.${badDisplay}-side`), false);
    installArenaAromaEffect(goodDisplay);
    const hint = state_ui_battle_state.$("#actionHint");
    if (hint && !state_ui_battle_state.pendingSkill) hint.textContent = `아로마필드: ${state_ui_battle_state.game.fieldEffect.team === "P" ? "플레이어" : "AI"} 진영 회복 +10 · 상대 회복 -10 / 방어 -10`;
  }
  return;
}

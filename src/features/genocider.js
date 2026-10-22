// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_features_genocider = {
  GENO_CLIENT_VERSION: undefined,
  GENOCIDER_BASE_HP: undefined,
  GENOCIDER_CARD: undefined,
  reactiveEnergyCurrentGame: undefined,
  elixianCardNerf: undefined
};
import { state_catalog_cards } from "../catalog/cards.js";
import { enemyTargets, prepareCurrentTurn, unitAt } from "../engine/actions.js";
import { dealDamage, heal, queueVisual, traitsActive } from "../engine/combat.js";
import { energyStore, normalizeEnergy, reqAcceptsCounts, status, transformedSkillReq } from "../engine/energy.js";
import { actionSkillHasEffect, card, cardCapability, firstSkillByEffect, skillDefHasEffect, skillIdByEffect, skillIdByEffectGlobal, skillOf } from "../engine/entities.js";
import { advanceDualOrEnd, recordPaidSkill } from "../engine/execution.js";
import { policySlots, PASS } from "../engine/policies.js";
import { pointForUid } from "./summons.js";
import { log, queueCombatNotice } from "../presentation/audio.js";
import { state_presentation_coordinates } from "../presentation/coordinates.js";
import { systems } from "../runtime/systems.js";
import { state_ui_action_panel } from "../ui/action-panel.js";
import { combatInt, energyAmountText, state_ui_battle_state } from "../ui/battle-state.js";
import { state_ui_cards } from "../ui/cards.js";
import { registerCardDefinition } from "../ui/deck.js";
import { createGenoSiphonParticles } from "../ui/invaders.js";
import { finalizeChosenPlayerAction } from "../ui/payment.js";
export function initializeFeaturesGenocider() {
  state_features_genocider.GENO_CLIENT_VERSION = "mega-timeora-18-20260723-r17";
  state_features_genocider.GENOCIDER_BASE_HP = 240;
  state_features_genocider.GENOCIDER_CARD = state_catalog_cards.C("genocider", "제노사이더", state_features_genocider.GENOCIDER_BASE_HP, "B 축적·소모형 침략자", "메가리그", "감속 무효. 어둠 포식: 보유 B 1개당 최대 HP +60. 새로 증가한 B 1개당 HP 30 회복.", [state_catalog_cards.S("slashClaw", "슬래시클로", "*", "2회 공격. Cost 소비 직전 보유 B 1개당 타격당 피해 +10D.", "enemy", [{
    type: "genociderSlashClaw"
  }], ["damage", "multi"]), state_catalog_cards.S("displosion", "디스플로전", "B+", "기본 B 1개와 원하는 만큼의 추가 B를 지불. HP 60 회복 후 추가 B 1개당 80D.", "enemy", [{
    type: "genociderDisplosion"
  }], ["damage", "heal", "variableCost"])], {
    grade: "4☆",
    releaseOrder: 17,
    faction: "초차원의 침략자",
    maxEnergy: 4,
    slowImmune: true,
    reactiveEnergyMaxHp: {
      color: "B",
      baseMaxHp: state_features_genocider.GENOCIDER_BASE_HP,
      maxHpPer: 60,
      healPerGain: 30,
      label: "어둠 포식",
      vfxType: "genociderAbsorbFx",
      observedStateKey: "_genoObservedB"
    },
    tags: ["transdimensional-invader"]
  });
  registerCardDefinition(state_features_genocider.GENOCIDER_CARD);
  state_ui_cards.CARD_EMOJI_MAP.genocider = ["◼", "✦"];

  /* R49 generic reactive-energy trait lifecycle.
     A card opts in only through card.reactiveEnergyMaxHp; mutation owners never know card ids. */
  state_features_genocider.reactiveEnergyCurrentGame = null;
  policySlots.legal7 = {
    transform(currentActions, g, t, s) {
      let actions = currentActions,
        u = unitAt(g, t, s);
      if (!u || u.dead || !reactiveEnergyRule(u)) return actions;
      actions = actions.filter(a => !actionSkillHasEffect(a, "genociderDisplosion"));
      if (u.scheduledAction || status(u, "freeze") || status(u, "skillSeal") || u.skillSeals?.[skillIdByEffect(u, "genociderDisplosion")]) return actions;
      for (const target of enemyTargets(g, t)) {
        for (let extra = 0; extra <= 4; extra += .5) {
          const picks = genoFindDisplosionPicks(g, t, u, +extra.toFixed(1));
          if (!picks) continue;
          actions.push({
            type: "skill",
            skill: skillIdByEffectGlobal("genociderDisplosion"),
            target,
            displayCost: "B+",
            displosionExtraB: +extra.toFixed(1),
            genociderPayment: {
              picks
            },
            label: `디스플로전 · 추가 B ${energyAmountText(extra)} · 기준 위력 ${combatInt(extra * 80)}D`
          });
        }
      }
      for (const a of actions) if (actionSkillHasEffect(a, "genociderSlashClaw")) a.displayCost = "*";
      return actions;
    }
  };
  policySlots.effect7 = function (g, actor, target, e, skill, ctx) {
    if (e.type === "genociderSlashClaw") {
      const snapshot = Number(actor._genociderSlashSnapshot ?? reactiveEnergyAmount(actor)),
        amount = combatInt(20 + snapshot * 10);
      let total = 0;
      for (let hit = 1; hit <= 2; hit++) {
        if (!target || target.dead || actor.dead) break;
        const dealtHit = dealDamage(g, actor, target, {
          amount
        }, {
          ...skill,
          name: `슬래시클로 ${hit}타`
        }, ctx?.sim);
        log(g, `${actor.name}의 슬래시클로 ${hit}타 → ${dealtHit}D.`);
        total += dealtHit;
        queueVisual(g, {
          type: "genociderClawFx",
          uid: actor.uid,
          targetUid: target.uid,
          hit,
          actualAmount: dealtHit,
          rawAmount: amount
        });
      }
      return total;
    }
    if (e.type === "genociderDisplosion") return 0;
    return PASS;
  };
  state_ui_action_panel.ActionRenderEngine.registerDecorator("genocider", 400, () => decorateGenociderActions());
  state_features_genocider.elixianCardNerf = state_catalog_cards.CARDS.find(c => c.id === "elixian");
  if (state_features_genocider.elixianCardNerf) {
    state_features_genocider.elixianCardNerf.trait = "잔향: 사망하면 같은 슬롯의 다음 출전 아군이 자기 차례 시작마다 HP 10을 영구 회복한다.";
    state_features_genocider.elixianCardNerf.traits = [state_features_genocider.elixianCardNerf.trait];
    state_features_genocider.elixianCardNerf.healAmplification = 0;
  }

  /* ===================== legacy matchmaking application compatibility ===================== */
}
export function allReactiveEnergyUnits(g) {
  if (!g?.teams) return [];
  const seen = new Set(),
    out = [];
  for (const t of ["P", "A"]) for (const u of [...(g.teams[t].field || []), ...(g.teams[t].bench || []), ...(g.teams[t].graveyard || [])]) if (u && !seen.has(u.uid)) {
    seen.add(u.uid);
    out.push(u);
  }
  return out;
}
export function reactiveEnergyRule(u) {
  const rule = cardCapability(u, "reactiveEnergyMaxHp", null);
  return rule && typeof rule === "object" ? rule : null;
}
export function reactiveEnergyObservedKey(u, rule = reactiveEnergyRule(u)) {
  if (!rule) return null;
  return String(rule.observedStateKey || `_reactiveEnergyObserved_${String(rule.color || "any")}`);
}
export function reactiveEnergyAmount(u, rule = reactiveEnergyRule(u)) {
  if (!u || !rule) return 0;
  const color = String(rule.color || "");
  return +energyStore(u).reduce((n, e) => n + (!color || e.c === color ? Number(e.a || 0) : 0), 0).toFixed(3);
}
export function initReactiveEnergyUnit(u) {
  const rule = reactiveEnergyRule(u);
  if (!u || !rule) return u;
  const key = reactiveEnergyObservedKey(u, rule);
  if (!Number.isFinite(Number(u[key]))) u[key] = reactiveEnergyAmount(u, rule);
  return u;
}
export function syncReactiveEnergyMaxHp(g, u, reason = "", showNotice = true) {
  const rule = reactiveEnergyRule(u);
  if (!u || !rule) return 0;
  initReactiveEnergyUnit(u);
  const baseMaxHp = Math.max(0, Number(rule.baseMaxHp ?? card(u).maxHp ?? u.maxHp ?? 0));
  const oldMax = Math.max(0, Number(u.maxHp || baseMaxHp));
  const resource = traitsActive(u) ? reactiveEnergyAmount(u, rule) : 0;
  const nextMax = combatInt(baseMaxHp + resource * Number(rule.maxHpPer || 0));
  u.maxHp = Math.max(baseMaxHp, nextMax);
  if (u.hp > u.maxHp) {
    u.hp = u.maxHp;
    if (g) log(g, `${u.name}: 최대 HP 변화로 현재 HP가 ${u.hp}/${u.maxHp}로 조정됐다.`);
  }
  if (showNotice && g && oldMax !== u.maxHp) {
    const delta = u.maxHp - oldMax;
    queueCombatNotice(g, u, `최대 HP ${delta > 0 ? "+" : ""}${delta}`, "effect");
  }
  return u.maxHp - oldMax;
}
export function reconcileReactiveEnergy(g, u, allowHeal = true, reason = "에너지 변화") {
  const rule = reactiveEnergyRule(u);
  if (!u || !rule) return;
  initReactiveEnergyUnit(u);
  const key = reactiveEnergyObservedKey(u, rule);
  const before = Number(u[key] || 0),
    after = reactiveEnergyAmount(u, rule);
  const delta = +(after - before).toFixed(3);
  u[key] = after;
  syncReactiveEnergyMaxHp(g, u, reason, Math.abs(delta) > .001);
  if (delta > .001 && allowHeal && traitsActive(u) && Number(rule.healPerGain || 0) > 0) {
    const requested = combatInt(delta * Number(rule.healPerGain || 0));
    const got = heal(g, u, requested, u, {
      reason: "reactive-energy-gain",
      effectId: "reactiveEnergyMaxHp"
    });
    const colorLabel = String(rule.color || "에너지");
    log(g, `${u.name} 특성 · ${rule.label || "에너지 반응"}: ${colorLabel} ${energyAmountText(delta)} 증가, 최대 HP ${u.maxHp}, HP ${got} 회복.`, "heal");
    if (rule.vfxType) queueVisual(g, {
      type: String(rule.vfxType),
      uid: u.uid,
      amount: delta,
      maxHp: u.maxHp
    });
  }
}
export function reconcileAllReactiveEnergyUnits(g, allowHeal = true, reason = "상태 갱신") {
  for (const u of allReactiveEnergyUnits(g)) if (reactiveEnergyRule(u)) reconcileReactiveEnergy(g, u, allowHeal, reason);
}
export function genoReqFromTokens(tokens = []) {
  const req = {
    R: 0,
    W: 0,
    B: 0,
    any: 0,
    wb: 0
  };
  for (const token of tokens) {
    if (token === "*") req.any++;else if (token === "WorB") req.wb++;else if ("RWB".includes(token)) req[token]++;
  }
  return req;
}
export function genoBaseDisplosionTokens(g, t, u) {
  let tokens = ["B"];
  if (g?.fieldEffect?.type === "grand" && g.fieldEffect.team === t) tokens = ["*"];
  return tokens;
}
export function genoExternalDisplosionTokens(g, t, u) {
  return transformedSkillReq(g, t, u, "").tokens.slice();
}
export function genoCountsFromEntries(entries) {
  const c = {
    R: 0,
    W: 0,
    B: 0
  };
  for (const e of entries || []) if (e && "RWB".includes(e.c)) c[e.c] += Number(e.a || 0);
  return c;
}
export function genoReqNeed(req) {
  return req.R + req.W + req.B + req.any + req.wb;
}
export function genoEntriesSatisfy(req, entries) {
  const counts = genoCountsFromEntries(entries),
    total = counts.R + counts.W + counts.B;
  return Math.abs(total - genoReqNeed(req)) < .001 && reqAcceptsCounts(req, counts);
}
export function genoFindSubset(entries, req) {
  const need = genoReqNeed(req),
    n = entries.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const picked = [];
    for (let i = 0; i < n; i++) if (mask & 1 << i) picked.push(entries[i]);
    const total = picked.reduce((s, e) => s + e.a, 0);
    if (Math.abs(total - need) < .001 && genoEntriesSatisfy(req, picked)) return picked;
  }
  return null;
}
export function genoFindDisplosionPicks(g, t, u, extraB = 0) {
  const store = energyStore(u),
    entries = store.map((e, index) => ({
      index,
      c: e.c,
      a: e.a
    }));
  const baseReq = genoReqFromTokens(genoBaseDisplosionTokens(g, t, u));
  const extReq = genoReqFromTokens(genoExternalDisplosionTokens(g, t, u));
  const n = entries.length;
  for (let maskBase = 0; maskBase < 1 << n; maskBase++) {
    const base = entries.filter((_, i) => maskBase & 1 << i);
    if (!genoEntriesSatisfy(baseReq, base)) continue;
    const rem1 = entries.filter((_, i) => !(maskBase & 1 << i));
    for (let maskExtra = 0; maskExtra < 1 << rem1.length; maskExtra++) {
      const extra = rem1.filter((e, i) => maskExtra & 1 << i && e.c === "B");
      if (rem1.some((e, i) => maskExtra & 1 << i && e.c !== "B")) continue;
      if (Math.abs(extra.reduce((s, e) => s + e.a, 0) - extraB) > .001) continue;
      const extraSet = new Set(extra.map(e => e.index));
      const rem2 = rem1.filter(e => !extraSet.has(e.index));
      const external = genoFindSubset(rem2, extReq);
      if (!external) continue;
      return [...base.map(e => ({
        ...e,
        role: "base"
      })), ...extra.map(e => ({
        ...e,
        role: "extra"
      })), ...external.map(e => ({
        ...e,
        role: "external"
      }))];
    }
  }
  return null;
}
export function genoValidateDisplosionPicks(g, t, u, picks) {
  if (!Array.isArray(picks) || new Set(picks.map(p => p.index)).size !== picks.length) return null;
  const store = energyStore(u),
    resolved = [];
  for (const p of picks) {
    const e = store[p.index];
    if (!e || e.c !== p.c || Math.abs(e.a - p.a) > .001 || !["base", "extra", "external"].includes(p.role)) return null;
    resolved.push({
      ...p
    });
  }
  const base = resolved.filter(p => p.role === "base"),
    extra = resolved.filter(p => p.role === "extra"),
    external = resolved.filter(p => p.role === "external");
  if (!genoEntriesSatisfy(genoReqFromTokens(genoBaseDisplosionTokens(g, t, u)), base)) return null;
  if (!extra.every(p => p.c === "B")) return null;
  if (!genoEntriesSatisfy(genoReqFromTokens(genoExternalDisplosionTokens(g, t, u)), external)) return null;
  return {
    resolved,
    base,
    extra,
    external,
    extraB: +extra.reduce((s, e) => s + e.a, 0).toFixed(1)
  };
}
export function genoRemoveExactPicks(u, picks) {
  const store = energyStore(u),
    paid = [];
  for (const p of [...picks].sort((a, b) => b.index - a.index)) {
    const e = store[p.index];
    if (!e) continue;
    paid.push({
      c: e.c,
      a: e.a,
      component: p.role
    });
    store.splice(p.index, 1);
  }
  normalizeEnergy(u);
  return paid.reverse();
}
export function openGenoComponentPicker(title, req, excluded, done, description = "") {
  const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    store = energyStore(u),
    picked = new Set();
  const available = store.map((e, index) => ({
    index,
    c: e.c,
    a: e.a
  })).filter(e => !excluded.has(e.index));
  const need = genoReqNeed(req);
  state_ui_battle_state.$("#modalContent").innerHTML = `<h2>${title}</h2><p>${description}</p><p>필요 코스트: <b>${req.R ? "R".repeat(req.R) : ""}${req.W ? "W".repeat(req.W) : ""}${req.B ? "B".repeat(req.B) : ""}${req.wb ? "WorB ".repeat(req.wb) : ""}${req.any ? "*".repeat(req.any) : "" || "없음"}</b></p><div class="energy geno-component-energy"></div><div id="genoComponentPreview" class="effect-box"></div><div class="choice-list"><button id="genoComponentCancel">취소</button><button id="genoComponentConfirm" class="primary" disabled>선택 확정</button></div>`;
  const box = state_ui_battle_state.$("#modalContent .geno-component-energy"),
    preview = state_ui_battle_state.$("#genoComponentPreview"),
    confirm = state_ui_battle_state.$("#genoComponentConfirm");
  const refresh = () => {
    const chosen = available.filter(e => picked.has(e.index)),
      valid = genoEntriesSatisfy(req, chosen);
    preview.textContent = `선택 ${chosen.map(e => e.c + (e.a === .5 ? "½" : "")).join(" ") || "없음"} · ${valid ? "조건 충족" : `총 ${energyAmountText(chosen.reduce((n, e) => n + e.a, 0))}/${energyAmountText(need)}`}`;
    confirm.disabled = !valid;
    return {
      chosen,
      valid
    };
  };
  for (const e of available) {
    const b = document.createElement("button");
    b.className = `e ${e.c}`;
    b.textContent = `${e.c}${e.a === .5 ? "½" : ""}`;
    b.onclick = () => {
      picked.has(e.index) ? picked.delete(e.index) : picked.add(e.index);
      b.classList.toggle("chosen", picked.has(e.index));
      refresh();
    };
    box.appendChild(b);
  }
  state_ui_battle_state.$("#genoComponentCancel").onclick = () => {
    state_ui_battle_state.$("#modal").classList.remove("open");
  };
  confirm.onclick = () => {
    const x = refresh();
    if (x.valid) done(x.chosen);
  };
  refresh();
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function openGenoExtraBPicker(action, basePicks) {
  const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    store = energyStore(u),
    excluded = new Set(basePicks.map(e => e.index)),
    picked = new Set();
  const candidates = store.map((e, index) => ({
    index,
    c: e.c,
    a: e.a
  })).filter(e => !excluded.has(e.index) && e.c === "B");
  const extReq = genoReqFromTokens(genoExternalDisplosionTokens(state_ui_battle_state.game, t, u));
  state_ui_battle_state.$("#modalContent").innerHTML = `<h2>디스플로전 · 추가 B</h2><p>공격에 추가 투입할 B를 선택하세요. 독 등 별도 비용은 다음 단계에서 따로 선택합니다.</p><div class="energy geno-extra-b"></div><div id="genoExtraPreview" class="effect-box"></div><div class="choice-list"><button id="genoExtraCancel">취소</button><button id="genoExtraConfirm" class="primary">다음</button></div>`;
  const box = state_ui_battle_state.$("#modalContent .geno-extra-b"),
    preview = state_ui_battle_state.$("#genoExtraPreview"),
    confirm = state_ui_battle_state.$("#genoExtraConfirm");
  const refresh = () => {
    const extra = candidates.filter(e => picked.has(e.index)),
      extraB = +extra.reduce((n, e) => n + e.a, 0).toFixed(1),
      used = new Set([...excluded, ...extra.map(e => e.index)]),
      remaining = store.map((e, index) => ({
        index,
        c: e.c,
        a: e.a
      })).filter(e => !used.has(e.index)),
      external = genoFindSubset(remaining, extReq),
      postB = Math.max(0, reactiveEnergyAmount(u) - basePicks.filter(e => e.c === "B").reduce((n, e) => n + e.a, 0) - extraB - (external || []).filter(e => e.c === "B").reduce((n, e) => n + e.a, 0)),
      postMax = state_features_genocider.GENOCIDER_BASE_HP + (traitsActive(u) ? postB * 60 : 0),
      postHp = Math.min(postMax, u.hp),
      healPreview = Math.max(0, Math.min(60, postMax - postHp));
    preview.textContent = `총 소비 B ${energyAmountText(basePicks.filter(e => e.c === "B").reduce((n, e) => n + e.a, 0) + extraB + (external || []).filter(e => e.c === "B").reduce((n, e) => n + e.a, 0))} · 기본 B ${energyAmountText(basePicks.filter(e => e.c === "B").reduce((n, e) => n + e.a, 0))} · 추가 B ${energyAmountText(extraB)} · 별도 비용 ${genoExternalDisplosionTokens(state_ui_battle_state.game, t, u).join(" ") || "없음"} · 기준 위력 ${combatInt(extraB * 80)}D · 사용 후 최대 HP ${combatInt(postMax)} · 예상 회복 후 HP ${combatInt(postHp + healPreview)}/${combatInt(postMax)}`;
    confirm.disabled = !external;
    return {
      extra,
      extraB,
      external
    };
  };
  for (const e of candidates) {
    const b = document.createElement("button");
    b.className = "e B";
    b.textContent = `B${e.a === .5 ? "½" : ""}`;
    b.onclick = () => {
      picked.has(e.index) ? picked.delete(e.index) : picked.add(e.index);
      b.classList.toggle("chosen", picked.has(e.index));
      refresh();
    };
    box.appendChild(b);
  }
  state_ui_battle_state.$("#genoExtraCancel").onclick = () => {
    state_ui_battle_state.$("#modal").classList.remove("open");
  };
  confirm.onclick = () => {
    const x = refresh();
    if (!x.external) return;
    const used = new Set([...excluded, ...x.extra.map(e => e.index)]);
    if (!genoReqNeed(extReq)) {
      finalizeChosenPlayerAction({
        ...action,
        genociderPayment: {
          picks: [...basePicks.map(e => ({
            ...e,
            role: "base"
          })), ...x.extra.map(e => ({
            ...e,
            role: "extra"
          }))]
        },
        displosionExtraB: x.extraB
      });
      return;
    }
    openGenoComponentPicker("디스플로전 · 별도 추가 비용", extReq, used, external => finalizeChosenPlayerAction({
      ...action,
      genociderPayment: {
        picks: [...basePicks.map(e => ({
          ...e,
          role: "base"
        })), ...x.extra.map(e => ({
          ...e,
          role: "extra"
        })), ...external.map(e => ({
          ...e,
          role: "external"
        }))]
      },
      displosionExtraB: x.extraB
    }), "독과 필드 등으로 추가된 비용을 선택하세요. 이 비용으로 낸 B는 공격력에 포함되지 않습니다.");
  };
  refresh();
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function openGenociderDisplosion(actions) {
  if (!state_ui_battle_state.game || !actions?.length) return;
  const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    action = actions[0];
  const baseReq = genoReqFromTokens(genoBaseDisplosionTokens(state_ui_battle_state.game, t, u));
  openGenoComponentPicker("디스플로전 · 기본 비용", baseReq, new Set(), base => openGenoExtraBPicker(action, base), "기본 비용을 먼저 선택하세요. 아직 에너지는 차감되지 않습니다.");
}
export function executeGenociderDisplosion(g, t, s, a, {
  sim = false
} = {}) {
  prepareCurrentTurn(g);
  const actor = unitAt(g, t, s),
    target = a?.target && unitAt(g, a.target.team, a.target.slot);
  if (!actor || actor.dead || !reactiveEnergyRule(actor) || !target || target.dead || status(actor, "freeze") || status(actor, "skillSeal") || actor.skillSeals?.[skillIdByEffect(actor, "genociderDisplosion")]) return false;
  const verified = genoValidateDisplosionPicks(g, t, actor, a.genociderPayment?.picks);
  if (!verified) return false;
  const beforeB = reactiveEnergyAmount(actor),
    paid = genoRemoveExactPicks(actor, verified.resolved);
  reconcileReactiveEnergy(g, actor, false, "디스플로전 코스트 소비");
  const healed = heal(g, actor, 60, actor, {
      reason: "genocider-displosion",
      effectId: "displosion",
      sim
    }),
    amount = combatInt(verified.extraB * 80);
  log(g, `${actor.name}: 디스플로전 사용 · 기본 비용 ${verified.base.map(e => e.c).join("") || "없음"}, 추가 B ${energyAmountText(verified.extraB)}, 별도 비용 ${verified.external.map(e => e.c).join("") || "없음"}.`);
  log(g, `${actor.name}: B ${energyAmountText(beforeB)} → ${energyAmountText(reactiveEnergyAmount(actor))}, 최대 HP ${actor.maxHp}, 실제 회복 ${healed}.`, "heal");
  const dealt = dealDamage(g, actor, target, {
    amount
  }, {
    ...firstSkillByEffect(actor, "genociderDisplosion"),
    name: "디스플로전"
  }, sim);
  actor.skillUses++;
  actor.lastAction = "skill";
  actor.lastSkill = skillIdByEffect(actor, "genociderDisplosion");
  actor.lastTarget = target.uid;
  recordPaidSkill(g, t, actor, paid);
  queueVisual(g, {
    type: "genociderExplosionFx",
    uid: actor.uid,
    targetUid: target.uid,
    power: verified.extraB,
    amount: dealt,
    actualAmount: dealt,
    rawAmount: amount
  });
  advanceDualOrEnd(g, t, s, actor, true, false);
  return true;
}
export function decorateGenociderActions() {
  if (!state_ui_battle_state.game) return;
  const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s);
  if (!reactiveEnergyRule(u)) return;
  for (const b of document.querySelectorAll("#actionButtons .skillbtn")) {
    const sk = skillOf(u, b.dataset.skillId);
    if (skillDefHasEffect(sk, "genociderSlashClaw")) {
      const tiny = b.querySelector(".tiny");
      if (tiny) tiny.textContent = `현재 기준 위력 ${combatInt(20 + reactiveEnergyAmount(u) * 10)}D ×2`;
    }
    if (skillDefHasEffect(sk, "genociderDisplosion")) {
      const cost = b.querySelector(".cost");
      if (cost) cost.textContent = "B+";
    }
  }
}
export function playGenociderVisual(v) {
  const actor = state_presentation_coordinates.battleEntityElement(v?.uid);
  const target = v?.targetUid ? state_presentation_coordinates.battleEntityElement(v.targetUid) : actor;
  const arena = document.querySelector('.arena');
  const placeNode = (node, point) => {
    if (!node || !point) return;
    node.style.left = `${point.x}px`;
    node.style.top = `${point.y}px`;
  };
  if (v?.type === "genociderAbsorbFx") {
    if (!actor) return;
    const node = createGenoSiphonParticles(actor, Math.max(.5, Number(v.amount || 0)), "geno-devour-absorb");
    systems.TimerManager.setTimeout(() => node?.remove(), 900);
    state_ui_battle_state.visualHoldMs = Math.max(state_ui_battle_state.visualHoldMs, 900);
    return;
  }
  if (v?.type === "genociderClawFx") {
    if (!target) return;
    const show = () => {
      const node = document.createElement("div");
      node.className = "geno-claw-fx";
      node.style.setProperty("--claw-tilt", v.hit === 2 ? "15deg" : "-22deg");
      for (const [y, shift] of [["16%", -2], ["47%", 8], ["79%", -6]]) {
        const line = document.createElement("i");
        line.className = "geno-claw-streak";
        line.style.setProperty("--claw-y", y);
        line.style.marginLeft = `${shift}px`;
        node.appendChild(line);
      }
      target.appendChild(node);
      systems.TimerManager.setTimeout(() => node.remove(), 760);
    };
    systems.TimerManager.setTimeout(show, v.hit === 2 ? 170 : 0);
    state_ui_battle_state.visualHoldMs = Math.max(state_ui_battle_state.visualHoldMs, 1120);
    return;
  }
  if (v?.type === "genociderExplosionFx") {
    const power = Math.max(0, Number(v.power || 0));
    const actual = Math.max(0, combatInt(v.actualAmount ?? v.amount ?? 0));
    const actorPoint = arena ? pointForUid(arena, v.uid) : null;
    const targetPoint = arena ? pointForUid(arena, v.targetUid || v.uid) : null;
    const siphonLife = Math.min(1500, 760 + power * 180);
    const vortexLife = Math.min(2200, 980 + power * 280);
    const impactLife = Math.min(1700, 940 + power * 220);
    const totalLife = Math.min(3000, 1380 + power * 520);
    if (actor && actorPoint && arena) {
      const siphon = createGenoSiphonParticles(actor, power + 1.1, "geno-displosion-siphon");
      systems.TimerManager.setTimeout(() => siphon?.remove(), siphonLife);
      systems.TimerManager.setTimeout(() => {
        if (!arena.isConnected || !actorPoint) return;
        const vortex = document.createElement("div");
        vortex.className = "geno-displosion-vortex";
        vortex.style.setProperty("--geno-power", String(power));
        vortex.style.setProperty("--v-time", `${Math.min(1.95, 1.05 + power * .28)}s`);
        placeNode(vortex, actorPoint);
        arena.appendChild(vortex);
        systems.TimerManager.setTimeout(() => vortex.remove(), vortexLife);
      }, 180);
    }
    systems.TimerManager.setTimeout(() => {
      if (!arena || !targetPoint) return;
      const impact = document.createElement("div");
      impact.className = "geno-displosion-impact";
      impact.style.setProperty("--geno-power", String(power));
      impact.style.setProperty("--i-time", `${Math.min(1.55, .92 + power * .2)}s`);
      placeNode(impact, targetPoint);
      const shardCount = 12 + Math.round(power * 8);
      for (let i = 0; i < shardCount; i++) {
        const shard = document.createElement("i");
        shard.className = "geno-impact-shard";
        shard.style.setProperty("--geno-power", String(power));
        shard.style.setProperty("--shard-angle", `${Math.round(i * 360 / shardCount)}deg`);
        shard.style.setProperty("--s-time", `${Math.min(1.15, .76 + power * .08)}s`);
        impact.appendChild(shard);
      }
      arena.appendChild(impact);
      systems.TimerManager.setTimeout(() => impact.remove(), impactLife);
    }, Math.min(1600, 520 + power * 260));
    state_ui_battle_state.visualHoldMs = Math.max(state_ui_battle_state.visualHoldMs, totalLife);
  }
}

/* 엘릭시안: 기본 상시 회복량 증폭만 제거. 아로마필드 회복 보정은 유지한다. */

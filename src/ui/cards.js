import { raidCardForUnit, formatRaidCardTooltip } from "../features/boss-raid.js";
import { characterSpriteHTML } from "./character-sprites.js";
import { TimerManager } from "../runtime/timers.js";
import { render } from "./payment.js";
import { zombieDoorHTML } from "./zombie-door.js";
import { undeadAuraHTML } from '../presentation/weller.js';

// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_ui_cards = {
  CARD_EMOJI_MAP: undefined,
  cardTooltipState: undefined
};
import { state_catalog_cards } from "../catalog/cards.js";
import { eclipseBlocks, findUnit, teamOf } from "../engine/combat.js";
import { energyStore } from "../engine/energy.js";
import { fillFreezeActive, statusLabel } from "../engine/status-rules.js";
import { card, cardDefinition, cardHasCapability, isTargetMagnet, skillDefHasEffect, state_engine_entities } from "../engine/entities.js";
import { zombieCaveAffixBadge, zombieCaveBadge, zombieCaveSlotInfo, zombieCaveDoorInfo } from "../features/zombie-cave.js";
import { elixianHpProtection, totalHpProtection } from "../features/elixian.js";
import { shieldLayerHTML } from "../features/foxious.js";
import { reactiveEnergyAmount } from "../features/genocider.js";
import { timeClockCardHTMLState, timeClockMiniHTML } from "../features/timeora.js";
import { combatInt, effectsHTML, energyHTML, storeHTML, state_ui_battle_state } from "./battle-state.js";
export function initializeUiCards() {
  state_ui_cards.CARD_EMOJI_MAP = {
    hermit: ["🐚"],
    stareel: ["🌟", "🐍"],
    mole: ["🏹", "🐹"],
    boar: ["🐗"],
    mantis: ["⚔️", "🦗"],
    fang: ["🦷"],
    frog: ["💣", "🐸"],
    turtle: ["🐢"],
    mushroom: ["🛡️", "🍄"],
    bee: ["🩺", "🐝"],
    tail: ["🕊️"],
    ember: ["🔥", "🦊"],
    snail: ["🐌"],
    chameleon: ["🦎"],
    cloud: ["🌩️"],
    hawk: ["🦅"],
    wayli: ["💦", "🐋"],
    bkeno: ["🌋"],
    huve: ["⛰️", "☄️"],
    master: ["🍃"],
    tube: ["🛟"],
    bush: ["🌿"],
    sandcastle: ["🏰"],
    frost: ["🧊"],
    helmetShark: ["🦈"],
    snakeArmor: ["🐍", "🛡️"],
    phantomMuner: ["🎩", "🃏"],
    magSnail: ["♨️", "🐌"],
    thornJellyfish: ["⚡", "🫧"],
    sunflower: ["🌻"],
    megaWing: ["💨", "🪽"],
    sweetna: ["🍬"],
    iruma: ["🌼", "🌱"],
    iceknight: ["❄️", "🐎"],
    awakenedIruma: ["🌸", "🌿", "✨"],
    dragonfish: ["🐉", "🐟"],
    silvrae: ["🛡️", "🐉"],
    flameflower: ["🔥", "🪶"],
    lunari: ["🌒", "🪶"],
    horizintal: ["🌅"],
    ruby: ["🔥", "💎"],
    kingprawn: ["👑", "🦐"],
    yggdrasil: ["🌳"],
    angel: ["✨", "🪽"],
    grange: ["☀️", "🏜️"],
    flappis: ["🌪️", "🪽"],
    eterna: ["🩸", "🪼"],
    toxious: ["☣️", "🐉"],
    abigate: ["🌀", "🐚"],
    jungles: ["🌳", "🌿"],
    circuit: ["⚡", "🔩"],
    jetski: ["🌊", "🛥️"],
    aquamarine: ["💎", "🌊"],
    galewing: ["💨", "🪽"],
    axshrimp: ["🪓", "🦐"],
    heroncaptain: ["🧊", "🪶"],
    shuvi: ["🩸"]
  };
  state_ui_cards.cardTooltipState = {
    element: null,
    anchor: null,
    pinned: false,
    uid: "",
    cardId: "",
    infoSurface: "",
    infoSlotIndex: "",
    infoTeam: "P",
    longPressTimer: 0,
    pointerId: null,
    startX: 0,
    startY: 0,
    longPressFired: false,
    suppressClickUntil: 0,
    suppressCard: null
  };
}
export function cardEmoji(cardId = "") {
  const parts = state_ui_cards.CARD_EMOJI_MAP[cardId] || ["❔"];
  return parts.map((emoji, index) => `<span class="emoji-part" style="--emoji-index:${index}">${emoji}</span>`).join("");
}
export function pictogramHTML(kind = "default", cardId = "") {
  const sprite = characterSpriteHTML(cardId, kind);
  if (sprite) return sprite;
  const cls = kind === "small" || kind === "portrait" ? "small" : "";
  return `<div class="char-emoji ${cls}" data-card-image="${cardId}" role="img" aria-label="${cardId || "캐릭터"} 이모지">${cardEmoji(cardId)}</div>`;
}
export function scheduledInfoHTML(u, ownerTeam = null) {
  if (!u?.scheduledAction) return "";
  let a = u.scheduledAction,
    names = {
      sweet: "슈가스웜프 후속 공격",
      bloom: "피어나는생명",
      rubyFollow: "파이어스톰 후속 공격",
      zigzag: "지그재그굴착",
      hurricane: "허리케인 다이브",
      suppressedCurse: "억누른저주",
      delayedAttack: card(u).skills.find(skill => skill.id === a.skillId)?.name || "예약 공격"
    },
    target = "";
  const effectiveShape = a.effectiveActionSpec?.effectiveTargetShape || null;
  if (effectiveShape === "enemyField") {
    target = " · 적 필드 전체 예약";
  } else if (a.targetTeam != null && Number.isInteger(a.targetSlot)) {
    let relation = ownerTeam && a.targetTeam === ownerTeam ? "아군" : "적";
    target = ` · ${relation} ${a.targetSlot + 1}번 슬롯 예약`;
  }
  return `${names[a.kind] || "예약 행동"}${a.remaining ? ` · ${a.remaining}턴` : ""}${target}`;
}
export function unitLocation(g, uid) {
  if (!g) return null;
  for (const team of ["P", "A"]) {
    for (const zone of ["field", "bench", "graveyard"]) {
      let slot = g.teams[team][zone].findIndex(u => u?.uid === uid);
      if (slot >= 0) return {
        team,
        zone,
        slot
      };
    }
  }
  return null;
}
export function cardTooltipHTML(c, u = null) {
  if (u?.bossRed) c = {
    ...raidCardForUnit(u),
    id: "timeora"
  };
  if (!c) return "";
  const liveUnit = u?.presentationOnly ? null : u;
  let location = liveUnit ? unitLocation(state_ui_battle_state.game, liveUnit.uid) : null,
    statusRows = liveUnit ? [...Object.entries(liveUnit.statuses || {}).map(([s, d]) => `<span class="tag">${fillFreezeActive(liveUnit, s) ? statusLabel(liveUnit, s) : `${state_engine_entities.STATUS[s] || s} ${d}`}</span>`), ...Object.entries(liveUnit.skillSeals || {}).map(([skillId, d]) => {
      let skillName = c.skills.find(x => x.id === skillId)?.name || skillId;
      return `<span class="tag">${skillName} 기술봉인 ${d}</span>`;
    })].join("") || '<span class="muted">없음</span>' : "",
    damageCap = liveUnit ? liveUnit.damageCap ?? liveUnit.damageLimit ?? liveUnit.hitDamageCap ?? null : null,
    liveStats = liveUnit ? `<div class="card-info-section"><b>현재 전투 수치</b><div class="card-info-stats"><span>HP ${combatInt(liveUnit.hp)}/${combatInt(liveUnit.maxHp)}</span><span>실드 ${combatInt(liveUnit.shield || 0)}</span>${state_ui_battle_state.CombatStatPresentationOwner.render(liveUnit)}${damageCap != null ? `<span>피해 상한 ${combatInt(damageCap)}</span>` : ""}${liveUnit.hpProtectionBarriers?.length ? `<span>HP 보호막 ${combatInt(liveUnit.hpProtectionBarriers.reduce((n, x) => n + Number(x.amount || 0), 0))}</span>` : ""}</div><div class="tiny" style="margin-top:7px"><b>에너지:</b> ${cardHasCapability(liveUnit, "dualActor") ? `빙마 ${energyHTML(liveUnit, "beast")} · 기수 ${energyHTML(liveUnit, "rider")}` : energyHTML(liveUnit)}</div><div class="tiny" style="margin-top:7px"><b>상태:</b> ${statusRows}</div>${effectsHTML(liveUnit)}${scheduledInfoHTML(liveUnit, location?.team) ? `<div class="effect-box tiny"><b>특수 상태</b><br>${scheduledInfoHTML(liveUnit, location?.team)}</div>` : ""}</div>` : `<div class="card-info-section"><b>기본 수치</b><div class="card-info-stats"><span>HP ${c.maxHp}</span><span>실드 ${c.shield || 0}</span>${(c.baseDefense || 0) !== 0 ? `<span>방어 ${c.baseDefense || 0}</span>` : ""}<span>최대E ${c.maxEnergy}</span>${c.speed ? `<span>Speed ${c.speed > 0 ? "+" : ""}${c.speed}</span>` : ""}</div></div>`;
  const effectiveView = state_catalog_cards.EffectiveCardPresentationOwner.resolve(c, u, {
    surface: "tooltip",
    sourceRevision: state_ui_battle_state.game?.networkRevision || 0
  });
  let html = `<div class="card-info-head"><div><h3 class="card-title-line"><span>${effectiveView.displayName}</span><span class="tiny">${effectiveView.rarity}</span></h3><div class="card-info-sub">${c.grade} · ${c.role}${c.tags?.includes("dragon") ? ' · <span class="dragon-mark">🐉 드래곤</span>' : ""}${location ? ` · ${location.zone === "field" ? "필드" : location.zone === "bench" ? "후열" : "퇴장"} ${location.slot + 1}` : ""}</div></div><button type="button" class="card-info-close" aria-label="설명 닫기">×</button></div>${liveStats}${effectiveView.traitDescription ? `<div class="card-info-section"><b>특성</b><div class="tiny">${effectiveView.traitDescription}</div></div>` : ""}<div class="card-info-section"><b>기술</b>${effectiveView.skills.map(sk => `<div class="skill-line"><span class="skill-heading"><b>${sk.name}</b><span class="cost">${sk.cost || "없음"}</span></span><div class="tiny">${sk.description}</div></div>`).join("")}</div>`;
  if (c?.reactiveEnergyMaxHp && u) {
    const slash = combatInt(20 + reactiveEnergyAmount(u) * 10);
    html = html.replace(`<b>슬래시클로</b> <span class="cost">*</span><div class="tiny">${c.skills.find(x => skillDefHasEffect(x, "genociderSlashClaw"))?.desc || ""}</div>`, `<b>슬래시클로</b> <span class="cost">*</span><div class="tiny">현재 기준 위력 ${slash}D ×2</div>`);
  }
  if (cardHasCapability(c, "timeControl")) {
    const clock = u && state_ui_battle_state.game && findUnit(state_ui_battle_state.game, u.uid) === u ? timeClockMiniHTML(u, state_ui_battle_state.game) : "";
    html = html.replace('</div><div class="card-info-section"><b>특성</b>', `</div>${clock}<div class="card-info-section"><b>특성</b>`);
  }
  return formatRaidCardTooltip(html, u);
}
export function ensureCardTooltip() {
  if (state_ui_cards.cardTooltipState.element) return state_ui_cards.cardTooltipState.element;
  let tip = document.createElement("div");
  tip.className = "card-info-tooltip";
  tip.setAttribute("role", "dialog");
  tip.setAttribute("aria-live", "polite");
  document.body.appendChild(tip);
  tip.addEventListener("click", e => {
    if (e.target.closest(".card-info-close")) hideCardTooltip();
  });
  state_ui_cards.cardTooltipState.element = tip;
  return tip;
}
export function positionCardTooltip(anchor) {
  let tip = ensureCardTooltip();
  if (!anchor || !tip.classList.contains("open")) return;
  if (state_ui_cards.cardTooltipState.pinned && matchMedia("(hover: none), (pointer: coarse)").matches) {
    tip.style.left = "10px";
    tip.style.right = "10px";
    tip.style.top = "auto";
    tip.style.bottom = "max(10px, env(safe-area-inset-bottom))";
    return;
  }
  tip.style.right = "auto";
  tip.style.bottom = "auto";
  let r = anchor.getBoundingClientRect(),
    gap = 10,
    tw = Math.min(390, innerWidth - 20),
    th = Math.min(tip.scrollHeight || 420, innerHeight * 0.74),
    left = r.right + gap;
  if (left + tw > innerWidth - 10) left = r.left - tw - gap;
  if (left < 10) left = Math.max(10, Math.min(innerWidth - tw - 10, r.left + r.width / 2 - tw / 2));
  let top = r.top;
  if (top + th > innerHeight - 10) top = r.bottom - th;
  top = Math.max(10, Math.min(innerHeight - th - 10, top));
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}
export function showCardTooltip(anchor, pinned = false) {
  if (!anchor) return;
  let uid = anchor.dataset.uid || "",
    cardId = anchor.dataset.cardId || (uid && state_ui_battle_state.game ? findUnit(state_ui_battle_state.game, uid)?.card : "") || "",
    u = uid && state_ui_battle_state.game ? findUnit(state_ui_battle_state.game, uid) : null,
    c = cardDefinition(u?.card || cardId);
  if (!c) return;
  if (!u) u = state_catalog_cards.EffectiveCardPresentationOwner.syntheticUnitFromAnchor(anchor, c);
  hideCardTooltip(false);
  let tip = ensureCardTooltip();
  state_ui_cards.cardTooltipState.anchor = anchor;
  state_ui_cards.cardTooltipState.pinned = pinned;
  state_ui_cards.cardTooltipState.uid = uid;
  state_ui_cards.cardTooltipState.cardId = c.id;
  state_ui_cards.cardTooltipState.infoSurface = anchor.dataset.infoSurface || anchor.dataset.infoCard || "";
  state_ui_cards.cardTooltipState.infoSlotIndex = anchor.dataset.infoSlotIndex || "";
  state_ui_cards.cardTooltipState.infoTeam = anchor.dataset.infoTeam || "P";
  tip.innerHTML = cardTooltipHTML(c, u);
  tip.classList.add("open");
  tip.classList.toggle("pinned", pinned);
  anchor.classList.add("card-tooltip-open");
  TimerManager.requestAnimationFrame(() => positionCardTooltip(anchor));
}
export function hideCardTooltip(clearState = true) {
  TimerManager.clear(state_ui_cards.cardTooltipState.longPressTimer);
  state_ui_cards.cardTooltipState.longPressTimer = 0;
  state_ui_cards.cardTooltipState.anchor?.classList.remove("card-tooltip-open");
  let tip = state_ui_cards.cardTooltipState.element;
  if (tip) {
    tip.classList.remove("open", "pinned");
    tip.innerHTML = "";
  }
  if (clearState) {
    state_ui_cards.cardTooltipState.anchor = null;
    state_ui_cards.cardTooltipState.pinned = false;
    state_ui_cards.cardTooltipState.uid = "";
    state_ui_cards.cardTooltipState.cardId = "";
    state_ui_cards.cardTooltipState.infoSurface = "";
    state_ui_cards.cardTooltipState.infoSlotIndex = "";
    state_ui_cards.cardTooltipState.infoTeam = "P";
  }
}
export function refreshCardTooltip() {
  let tip = state_ui_cards.cardTooltipState.element;
  if (!tip?.classList.contains("open")) return;
  let anchor = state_ui_cards.cardTooltipState.anchor?.isConnected ? state_ui_cards.cardTooltipState.anchor : null;
  if (!anchor && state_ui_cards.cardTooltipState.uid) anchor = document.querySelector(`[data-info-card][data-uid="${CSS.escape(state_ui_cards.cardTooltipState.uid)}"]`);
  if (!anchor && state_ui_cards.cardTooltipState.infoSurface) {
    const slot = state_ui_cards.cardTooltipState.infoSlotIndex !== "" ? `[data-info-slot-index="${CSS.escape(state_ui_cards.cardTooltipState.infoSlotIndex)}"]` : "";
    anchor = document.querySelector(`[data-info-card][data-info-surface="${CSS.escape(state_ui_cards.cardTooltipState.infoSurface)}"][data-card-id="${CSS.escape(state_ui_cards.cardTooltipState.cardId)}"]${slot}`);
  }
  if (!anchor) return hideCardTooltip();
  let u = state_ui_cards.cardTooltipState.uid && state_ui_battle_state.game ? findUnit(state_ui_battle_state.game, state_ui_cards.cardTooltipState.uid) : null,
    c = cardDefinition(u?.card || state_ui_cards.cardTooltipState.cardId);
  if (!u) u = state_catalog_cards.EffectiveCardPresentationOwner.syntheticUnitFromAnchor(anchor, c);
  state_ui_cards.cardTooltipState.anchor?.classList.remove("card-tooltip-open");
  state_ui_cards.cardTooltipState.anchor = anchor;
  anchor.classList.add("card-tooltip-open");
  tip.innerHTML = cardTooltipHTML(c, u);
  positionCardTooltip(anchor);
}
export function installCardTooltipInteractions() {
  document.addEventListener("pointerover", e => {
    if (e.pointerType && e.pointerType !== "mouse") return;
    let cardEl = e.target.closest?.("[data-info-card]");
    if (!cardEl || cardEl.contains(e.relatedTarget) || state_ui_cards.cardTooltipState.pinned) return;
    showCardTooltip(cardEl, false);
  });
  document.addEventListener("pointerout", e => {
    if (e.pointerType && e.pointerType !== "mouse") return;
    let cardEl = e.target.closest?.("[data-info-card]");
    if (!cardEl || cardEl.contains(e.relatedTarget) || state_ui_cards.cardTooltipState.pinned) return;
    if (state_ui_cards.cardTooltipState.anchor === cardEl) hideCardTooltip();
  });
  document.addEventListener("pointerdown", e => {
    if (state_ui_cards.cardTooltipState.pinned && !e.target.closest?.(".card-info-tooltip") && e.target.closest?.(".card") !== state_ui_cards.cardTooltipState.anchor) hideCardTooltip();
    if (e.pointerType === "mouse" || e.target.closest?.("button, input, select, textarea, a")) return;
    let cardEl = e.target.closest?.("[data-info-card]");
    if (!cardEl) return;
    TimerManager.clear(state_ui_cards.cardTooltipState.longPressTimer);
    state_ui_cards.cardTooltipState.pointerId = e.pointerId;
    state_ui_cards.cardTooltipState.startX = e.clientX;
    state_ui_cards.cardTooltipState.startY = e.clientY;
    state_ui_cards.cardTooltipState.longPressFired = false;
    state_ui_cards.cardTooltipState.longPressTimer = TimerManager.setTimeout(() => {
      state_ui_cards.cardTooltipState.longPressFired = true;
      state_ui_cards.cardTooltipState.suppressClickUntil = Date.now() + 900;
      state_ui_cards.cardTooltipState.suppressCard = cardEl;
      showCardTooltip(cardEl, true);
      navigator.vibrate?.(18);
    }, 500);
  }, true);
  document.addEventListener("pointermove", e => {
    if (e.pointerId !== state_ui_cards.cardTooltipState.pointerId || !state_ui_cards.cardTooltipState.longPressTimer) return;
    if (Math.hypot(e.clientX - state_ui_cards.cardTooltipState.startX, e.clientY - state_ui_cards.cardTooltipState.startY) > 11) {
      TimerManager.clear(state_ui_cards.cardTooltipState.longPressTimer);
      state_ui_cards.cardTooltipState.longPressTimer = 0;
    }
  }, true);
  const endPress = e => {
    if (e.pointerId !== state_ui_cards.cardTooltipState.pointerId) return;
    TimerManager.clear(state_ui_cards.cardTooltipState.longPressTimer);
    state_ui_cards.cardTooltipState.longPressTimer = 0;
    state_ui_cards.cardTooltipState.pointerId = null;
  };
  document.addEventListener("pointerup", endPress, true);
  document.addEventListener("pointercancel", endPress, true);
  document.addEventListener("click", e => {
    if (Date.now() < state_ui_cards.cardTooltipState.suppressClickUntil && e.target.closest?.("[data-info-card]") === state_ui_cards.cardTooltipState.suppressCard) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener("contextmenu", e => {
    if (e.target.closest?.("[data-info-card]")) e.preventDefault();
  });
  addEventListener("resize", () => positionCardTooltip(state_ui_cards.cardTooltipState.anchor));
  addEventListener("scroll", () => positionCardTooltip(state_ui_cards.cardTooltipState.anchor), true);
}
export function unitEnergyHudHTML(u) {
  if (cardHasCapability(u, "dualActor")) {
    let beast = energyStore(u, "beast"),
      rider = energyStore(u, "rider");
    if (!beast.length && !rider.length) return "";
    return `<div class="unit-energy-hud"><span class="energy-owner">빙</span>${storeHTML(beast)}<span class="energy-owner">기</span>${storeHTML(rider)}</div>`;
  }
  return u.energy?.length ? `<div class="unit-energy-hud">${storeHTML(u.energy)}</div>` : "";
}
export function escapeUIHTML(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
export function unitInvulnerabilityState(u) {
  if (!u || u.dead) return null;
  if (u.fullInvulnerableUntilOwnTurn) return {
    label: "전 피해 무적",
    title: "다음 자기 차례 시작 전까지 모든 피해 무효"
  };
  if (u.scheduledAction?.kind === "zigzag") return {
    label: "전 피해 무적",
    title: "지그재그굴착: 대기 중 모든 피해 무효"
  };
  if (cardHasCapability(u, "eclipse") && eclipseBlocks(u)) return {
    label: "공격 무적",
    title: "이클립스: 상대 공격기술 피해 무효"
  };
  if (u.fireWingUntil != null) return {
    label: "공격 무적",
    title: "화염날개: 다음 자기 차례 전까지 공격기술 피해 무효"
  };
  return null;
}
export function unitEffectBadgesHTML(u) {
  if (!u || u.dead) return "";
  let badges = [],
    add = (text, kind = "effect", title = text) => badges.push({
      text,
      kind,
      title
    }),
    invulnerable = unitInvulnerabilityState(u);
  if (invulnerable) add(invulnerable.label, "invulnerable", invulnerable.title);
  if (u.scheduledAction?.kind === "bloom") add("CC 무효", "ccimmune", "피어나는생명 대기 중: 상태이상 적용 무효");
  for (const [sid, duration] of Object.entries(u.statuses || {})) {
    if (Number(duration) > 0) add(fillFreezeActive(u, sid) ? statusLabel(u, sid) : `${state_engine_entities.STATUS[sid] || sid} ${duration}`, "status", statusLabel(u, sid, duration));
  }
  for (const [skillId, duration] of Object.entries(u.skillSeals || {})) {
    if (Number(duration) <= 0) continue;
    const skillName = card(u).skills.find(x => x.id === skillId)?.name || skillId;
    add(`${skillName} 봉인 ${duration}`, "status", `${skillName} 기술봉인 ${duration}턴`);
  }
  const zombieBadge = zombieCaveBadge(state_ui_battle_state.game, u);
  if (zombieBadge) add(zombieBadge.text, zombieBadge.kind, zombieBadge.title);
  const affixBadge = zombieCaveAffixBadge(state_ui_battle_state.game, u);
  if (affixBadge) add(affixBadge.text, affixBadge.kind, affixBadge.title);
  if (u.hideHits > 0) add(`피해 -30 ×${u.hideHits}`, "guard", `모래숨기: 다음 공격 타격 ${u.hideHits}회 피해 -30`);
  if (u.queuedHeals?.length) add("예약 회복", "pending", `예약 회복 ${u.queuedHeals.map(x => `${combatInt(x.amount)}×${combatInt(x.remaining)}`).join(", ")}`);
  if (u.scheduledAction && !["zigzag", "bloom"].includes(u.scheduledAction.kind)) add("예약 행동", "pending", scheduledInfoHTML(u, typeof state_ui_battle_state.game !== "undefined" && state_ui_battle_state.game ? teamOf(state_ui_battle_state.game, u) : null) || "예약 행동");
  let visible = badges.slice(0, 4),
    hidden = badges.length - visible.length;
  if (hidden > 0) visible.push({
    text: `+${hidden}`,
    kind: "more",
    title: `추가 효과 ${hidden}개`
  });
  const combatStatChips = state_ui_battle_state.CombatStatPresentationOwner.render(u, {
    className: "unit-effect-badge stat"
  });
  if (!visible.length && !combatStatChips) return "";
  return `<div class="unit-effect-badges">${combatStatChips}${visible.map(b => `<span class="unit-effect-badge ${b.kind}" title="${escapeUIHTML(b.title)}">${escapeUIHTML(b.text)}</span>`).join("")}</div>`;
}
export function unitBarsHTML(u) {
  let hp = combatInt(u.hp),
    maxHp = Math.max(1, combatInt(u.maxHp)),
    shield = combatInt(u.shield || 0),
    barrier = totalHpProtection(u),
    pink = elixianHpProtection(u),
    standard = Math.max(0, barrier - pink),
    hpPct = Math.round(Math.max(0, Math.min(100, hp / maxHp * 100))),
    barrierPct = Math.round(Math.max(0, Math.min(100, barrier / maxHp * 100))),
    pinkRatio = barrier ? Math.round(pink / barrier * 100) : 0;
  let overlay = "";
  if (barrier > 0) {
    const cls = pink && standard ? "mixed-barrier" : pink ? "elixian-barrier" : "";
    const bg = pink && standard ? `background:linear-gradient(90deg,rgba(255,59,165,.94) 0 ${pinkRatio}%,rgba(255,190,64,.92) ${pinkRatio}% 100%);` : "";
    overlay = `<span class="hp-protection-overlay ${cls}" style="width:${barrierPct}%;${bg}" title="HP 보호막 ${barrier}"></span>`;
  }
  return `<div class="unit-hud"><div class="unit-bar hp-bar" aria-label="HP ${hp}/${maxHp}${barrier ? `, HP 보호막 ${barrier}` : ""}"><span class="unit-bar-fill hp-fill" style="width:${hpPct}%"></span>${overlay}<span class="unit-bar-value">${hp}/${maxHp}</span></div>${shieldLayerHTML(shield, maxHp)}${unitEnergyHudHTML(u)}</div>`;
}
/* 등급별 카드 프레임 색: 3☆ 노랑 · 3.5☆ 하늘 · 4☆ 주황+노랑 · 4.5☆ 보라+파랑·하늘. 플러스스타는 +0.5☆로 본다. */
export function gradeTierClass(c, effectiveCard) {
  const base = Number.parseFloat(String(c?.grade || ""));
  if (!Number.isFinite(base)) return "";
  const tier = base + (effectiveCard?.plusStar ? 0.5 : 0);
  return tier >= 3 ? `grade-t${Math.round(tier * 10)}` : "";
}
/* 싱글 리그는 필드가 1칸이라 남는 가로 공간에 이 캐릭터의 기술 목록을 미리 보여 준다. */
function duelSkillListHTML(effectiveCard, bench) {
  if (bench || state_ui_battle_state.game?.league !== "duel" || !effectiveCard?.skills?.length) return "";
  return `<div class="unit-skill-list">${effectiveCard.skills.map(sk => `<div class="skill-line"><span class="skill-heading"><b>${sk.name}</b><span class="cost">${sk.cost || "없음"}</span></span><div class="tiny">${sk.description || ""}</div></div>`).join("")}</div>`;
}
/* 죽은 유닛 카드는 사망을 일으킨 행동의 연출(기술·피해 표시)이 끝날 때까지 화면에 남겨 두고 서서히 사라지게 한다.
   연출은 카드 DOM에서 시전자·대상 위치를 찾으므로, 사망 즉시 카드를 지우면 치명타 기술 연출이 통째로 사라진다.
   "이 화면에서 살아 있던 유닛이 죽었을 때"만 연출 대상이고(접속·복원 때 이미 죽어 있던 유닛은 바로 숨김),
   기준 시각은 사망이 처음 그려진 시점이라 다시 그려도 같은 시점부터 이어진다. 전투가 바뀌면 초기화. */
const DEATH_FADE_MS = 2400;
export const DeathPresentationOwner = (() => {
  let battleKey = null;
  const seenAlive = new Set(), firstDead = new Map();
  return Object.freeze({
    /* 사망 연출이 진행 중이면 경과 ms, 아니면 null. 모든 유닛을 그릴 때 호출한다. */
    observe(g, u) {
      const now = performance.now(), key = g?.battleId || g?.matchId || "battle";
      if (key !== battleKey) {
        battleKey = key;
        seenAlive.clear();
        firstDead.clear();
      }
      if (!u.dead) {
        seenAlive.add(u.uid);
        firstDead.delete(u.uid);
        return null;
      }
      if (!firstDead.has(u.uid)) {
        firstDead.set(u.uid, seenAlive.has(u.uid) ? now : -Infinity);
        /* 연출이 끝나면 한 번 더 그려서 빈 칸(입장 카운트다운·문)이 제때 나타나게 한다. */
        if (seenAlive.has(u.uid)) setTimeout(() => { if (state_ui_battle_state.game === g) render(); }, DEATH_FADE_MS + 40);
      }
      const t = firstDead.get(u.uid);
      return t === -Infinity || now - t >= DEATH_FADE_MS ? null : now - t;
    }
  });
})();
/* 빈 슬롯 카드. 좀비굴의 적 칸이면 같은 카드 자리에 다음 입장까지 남은 라운드를 보여 준다. */
const lastEntranceCount = new Map();
function emptySlotHTML(team, slot) {
  const g = state_ui_battle_state.game,
    door = zombieCaveDoorInfo(g, team, slot),
    info = door ? null : zombieCaveSlotInfo(g, team, slot);
  if (door) return zombieDoorHTML(g, door);
  if (!info) return `<div class="card muted"><h3>빈 슬롯</h3><p>이 슬롯의 차례는 계속 순환합니다.</p></div>`;
  const key = `${g.matchId}:${slot}`,
    ticked = lastEntranceCount.has(key) && lastEntranceCount.get(key) !== info.remaining;
  lastEntranceCount.set(key, info.remaining);
  const fill = Math.max(0, Math.min(1, info.remaining / Math.max(1, info.rounds)));
  return `<div class="card muted zc-entrance ${ticked ? "zc-tick" : ""}" data-zc-remaining="${info.remaining}" style="--zc-fill:${fill}"><h3>다음 좀비 입장</h3><div class="zc-count"><span>${info.remaining}</span></div><p>${info.remaining ? `${info.remaining}라운드 뒤 입장` : "곧 입장"}</p></div>`;
}
export function unitHTML(u, team, slot, bench = false, displayTeam = team) {
  const dying = u ? DeathPresentationOwner.observe(state_ui_battle_state.game, u) : null;
  if (u?.dead && dying == null) return bench ? "" : emptySlotHTML(team, slot);
  if (!u) return emptySlotHTML(team, slot);
  const bossRedRole = !!(u.bossRed || state_ui_battle_state.game?.bossRaid && team === "A" && cardHasCapability(u, "fateClock"));
  if (bossRedRole) u.bossRed = true;
  let c = card(u),
    effectiveCard = state_catalog_cards.EffectiveCardPresentationOwner.resolve(c, u, {
      surface: "battle-card",
      contextIdentity: `${state_ui_battle_state.game?.battleId || "battle"}:${team}:${slot}`,
      sourceRevision: state_ui_battle_state.game?.networkRevision || 0
    });
  const magnetClass = !bench && isTargetMagnet(state_ui_battle_state.game, u) ? "target-magnet" : "";
  /* 운명의 시계 상태(특성 정지 채도 등)는 카드가 만들어질 때 함께 붙는다. 렌더 뒤에 클래스를 붙이면 새 카드가 잠깐 원색으로 보인다. */
  const clockCard = !bench && !u.dead && state_ui_battle_state.game ? timeClockCardHTMLState(state_ui_battle_state.game, u) : {
    className: "",
    style: ""
  };
  const cardStyle = [dying != null ? `animation-delay:-${Math.round(dying)}ms` : "", clockCard.style].filter(Boolean).join(";");
  const redClass = bossRedRole ? "red-timeora-card boss-red-live-card" : "";
  const stageClass = bossRedRole ? "unit-stage boss-red-live-stage" : "unit-stage";
  return `<div class="card battle-unit-card ${bench ? "bench-card" : "field-card"} ${displayTeam === "P" ? "player" : "ai"} ${c.grade !== "2☆" ? "mega-card" : ""} ${u.dead ? "" : gradeTierClass(c, effectiveCard)} ${redClass} ${magnetClass} ${effectiveCard.visualModifiers.glowClass} ${unitInvulnerabilityState(u) ? "invulnerable-active" : ""} ${u.scheduledAction?.kind === "bloom" ? "cc-immune-active" : ""} ${u.dead ? "dead death-fade" : ""} ${u.zombified ? "zombified" : ""} ${clockCard.className}"${cardStyle ? ` style="${cardStyle}"` : ""} data-info-card="unit" data-info-surface="battle-card" data-card-id="${effectiveCard.effectiveCharacterId}" data-effective-character-id="${effectiveCard.effectiveCharacterId}" data-effective-plus-star="${effectiveCard.plusStar}" data-effective-deck-slot="${effectiveCard.exactDeckSlot || ""}" data-zone="${bench ? "bench" : "field"}" data-team="${team}" data-slot="${slot}" data-uid="${u.uid}" data-entity-id="${u.uid}"${bossRedRole ? ' data-boss-red-timeora="true"' : ""}><div class="character-effect-popup-layer"></div>${undeadAuraHTML(u)}${unitBarsHTML(u)}<div class="${stageClass}">${pictogramHTML(bench ? "small" : "default", effectiveCard.effectiveCharacterId)}${unitEffectBadgesHTML(u)}<div class="unit-nameplate">${effectiveCard.displayName}</div></div>${duelSkillListHTML(effectiveCard, bench)}</div>`;
}
export function safeCssValue(value) {
  const raw = String(value ?? "");
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(raw) : raw.replace(/"/g, '\\"');
}

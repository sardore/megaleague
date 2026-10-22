import { state_catalog_cards } from "../catalog/cards.js";
import { other } from "../engine/actions.js";
import { traitsActive } from "../engine/combat.js";
import { RNG, card, cardHasCapability, resolvePlusStarChoice } from "../engine/entities.js";
import { systems } from "../runtime/systems.js";
import { processPendingTraitChoice, scheduleAI, startBattle } from "../ui/action-choices.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { hideCardTooltip, installCardTooltipInteractions } from "../ui/cards.js";
import { setComprehensiveComposition, setLeague, state_ui_deck } from "../ui/deck.js";
import { render } from "../ui/payment.js";
import { randomBattleDeck, runSimulation, showCodex, state_ui_results } from "../ui/results.js";
import { renderSetup } from "../ui/setup.js";
export function initializeAppControls() {
  state_ui_battle_state.$("#randomDeck").onclick = () => {
    let r = new RNG(Date.now());
    state_ui_battle_state.selected = randomBattleDeck(r, state_ui_deck.leagueSelection, state_ui_deck.comprehensiveComposition);
    state_ui_deck.irumaForm = state_ui_battle_state.selected.includes("awakenedIruma") ? "awakenedIruma" : "iruma";
    state_ui_deck.bkenoForm = state_ui_battle_state.selected.includes("huve") ? "huve" : "bkeno";
    state_ui_deck.horizonForm = state_ui_battle_state.selected.includes("horizintal") ? "horizintal" : state_ui_battle_state.selected.includes("lunari") ? "lunari" : "flameflower";
    state_ui_deck.plusStarSelection = resolvePlusStarChoice(state_ui_deck.plusStarSelection, state_ui_battle_state.selected, "P");
    renderSetup(false);
  };
  state_ui_battle_state.$("#startBtn").onclick = () => startBattle();
  state_ui_battle_state.$("#menuCodexBtn").onclick = showCodex;
  state_ui_battle_state.$("#closeModal").onclick = () => {
    hideCardTooltip();
    if (systems.OnlineRuntime?.ui?.closeOwnedModal?.("global-modal-close")) {
      systems.__megaSyncOnlineChatUI?.();
      return;
    }
    state_ui_battle_state.$("#modal").classList.remove("open");
    systems.__megaSyncOnlineChatUI?.();
    if (state_ui_battle_state.game && !state_ui_battle_state.game.winner) {
      render();
      if (!processPendingTraitChoice()) scheduleAI();
    }
  };
  state_ui_battle_state.$("#collapseLog").onclick = () => setBattleLogOpen(state_ui_battle_state.$("#log").classList.contains("hidden"));
  if (window.matchMedia("(max-width: 900px)").matches) setBattleLogOpen(false);
  state_ui_battle_state.$("#simBtn").onclick = runSimulation;
  state_ui_battle_state.$("#leagueMode").onchange = e => setLeague(e.target.value);
  state_ui_battle_state.$$(".leagueTab").forEach(x => x.onclick = () => setLeague(x.dataset.league));
  state_ui_battle_state.$$(".composition-choice").forEach(x => x.onclick = () => setComprehensiveComposition(x.dataset.composition));
  state_ui_battle_state.$("#aiModeBtn").onclick = () => {
    state_ui_battle_state.$("#mode").value = "aivai";
    state_ui_battle_state.$("#simResult").scrollIntoView?.({
      behavior: "smooth"
    });
  };
  state_ui_battle_state.$$('[data-nav]').forEach(x => x.onclick = () => state_ui_results.NavigationApplication.request(x.dataset.nav));
  installCardTooltipInteractions();
  setLeague("mega");
  /* Invite-link auto join is owned once by canonical OnlineRuntime after initialization. */
  /* ─────────────────────────────────────────────────────────────
     10th~12th 4☆: 이터너 · 톡시어스 · 아비게이트
     기존 엔진 위에 얹는 확장 계층. 새 전투 시스템은 만들지 않는다.
  ───────────────────────────────────────────────────────────── */
}
export function setBattleLogOpen(open) {
  const logBox = state_ui_battle_state.$("#log"),
    mobile = window.matchMedia("(max-width: 900px)").matches;
  logBox.classList.toggle("hidden", !open);
  state_ui_battle_state.$("#logPanel")?.classList.toggle("log-open", !!open);
  state_ui_battle_state.$("#collapseLog").textContent = open ? mobile ? "닫기" : "접기" : mobile ? "로그" : "펼치기";
}
export function activeFieldCapability(g, t, capability, requireTrait = true) {
  return g?.teams?.[t]?.field?.find(u => u && !u.dead && cardHasCapability(u, capability) && (!requireTrait || traitsActive(u))) || null;
}
export function activeEterna(g, t) {
  return activeFieldCapability(g, t, "switchLockTrait", true);
}
export function activeAbigate(g, t) {
  return activeFieldCapability(g, t, "deepMind", true);
}
export function eternaLocksTeam(g, t) {
  return !!activeEterna(g, other(t));
}
export function downPressureSource(g, t) {
  return activeAbigate(g, other(t));
}
export function isLocallyControlledTeam(g, t) {
  if (typeof state_ui_battle_state.game === "undefined" || g !== state_ui_battle_state.game) return false;
  if (g.mode === "human") return t === "P";
  if (g.mode === "online") return t === state_ui_deck.onlineSide;
  return false;
}
export function resolvedSkillForAction(actor, action = {}) {
  if (!actor || !action) return null;
  if (action.copySkill) {
    const source = state_catalog_cards.CARDS.find(c => c.id === action.copyCard);
    const copied = source?.skills?.find(skill => skill.id === action.copySkill);
    if (copied) return copied;
  }
  return card(actor)?.skills?.find(skill => skill.id === action.skill) || null;
}
export function isNonAttackSkill(sk) {
  if (!sk) return false;
  if (sk.nonAttack === true) return true;
  if (sk.nonAttack === false) return false;
  /*
   * 커스텀 공격 효과는 effect.type 목록만으로 전부 열거할 수 없다.
   * 카드 데이터가 이미 사용하는 damage/attack 태그를 우선 판정해
   * 새 공격기가 추가돼도 딥마인드가 잘못 발동하지 않게 한다.
   */
  const tags = new Set((sk.tags || []).map(tag => String(tag).trim().toLowerCase()));
  if (tags.has("damage") || tags.has("attack")) return false;
  const attackTypes = new Set(["damage", "proportionalDamage", "firstBurst", "lifeRain", "rampage", "shatterLance", "firestorm", "prawnCharge", "holyFlame", "lightCandelabra", "grandField", "hurricaneDive", "eternaHeal", "groundZero", "dustWave", "abyssCannon", "junglesVineWhip", "circuitRoundKick", "circuitArmsBlade", "circuitVoltageBurst"]);
  return !(sk.effects || []).some(e => attackTypes.has(e.type));
}

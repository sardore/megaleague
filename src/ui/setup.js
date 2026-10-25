// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_ui_setup = {
  DeckDraftApplication: undefined,
  LocalInputEligibility: undefined
};
import { state_catalog_cards } from "../catalog/cards.js";
import { legalActions, prepareCurrentTurn, unitAt } from "../engine/actions.js";
import { aliveUnits, costGap, parseCost } from "../engine/energy.js";
import { RNG, makeUnit, rebindPlusStarChoice, resolvePlusStarChoice, skillDefHasTag, state_engine_entities } from "../engine/entities.js";
import { showEnd } from "../online/connection.js";
import { playVisuals } from "../presentation/animations.js";
import { battlefieldCardForUid } from "../presentation/coordinates.js";
import { systems } from "../runtime/systems.js";
import { playerChooseTarget } from "./action-choices.js";
import { state_ui_action_panel } from "./action-panel.js";
import { state_ui_battle_state } from "./battle-state.js";
import { pictogramHTML, refreshCardTooltip, unitHTML } from "./cards.js";
import { nextLeagueFormId, normalizeSetupFormsForLeague, poolForLeague, setSetupFormState, setupCardId, setupFormState, syncLeagueSelectionSurface, state_ui_deck } from "./deck.js";
import { isInvaderCardId, mountInvaderPortal, sanitizeSelectedInvaders, syncInvaderPortalState } from "./invaders.js";
import { renderLog } from "./payment.js";
import { characterTileClass, characterTileInner, syncTileGrid, tileKeyAttr } from "./tiles.js";
export function initializeUiSetup() {
  state_ui_setup.DeckDraftApplication = (() => {
    const snapshot = () => Object.freeze({
      deck: Object.freeze([...state_ui_battle_state.selected]),
      plusStar: state_ui_deck.plusStarSelection || null
    });
    const normalizePlusStar = () => {
      state_ui_deck.plusStarSelection = resolvePlusStarChoice(state_ui_deck.plusStarSelection, state_ui_battle_state.selected, "P");
      return snapshot();
    };
    /* 덱 내용을 바꾸는 모든 경로의 단일 출구. 칸이 밀려도 플러스스타가 같은 카드에 남도록 한 곳에서 다시 묶는다. */
    const replaceDeck = nextDeck => {
      const previous = [...state_ui_battle_state.selected],
        choice = state_ui_deck.plusStarSelection;
      state_ui_battle_state.selected.splice(0, state_ui_battle_state.selected.length, ...nextDeck);
      state_ui_deck.plusStarSelection = rebindPlusStarChoice(choice, previous, state_ui_battle_state.selected, "P");
    };
    const reset = () => {
      state_ui_battle_state.selected = [];
      state_ui_deck.plusStarSelection = null;
      return snapshot();
    };
    const commit = (nextDeck, nextChoice) => {
      state_ui_battle_state.selected.splice(0, state_ui_battle_state.selected.length, ...(Array.isArray(nextDeck) ? nextDeck : []));
      state_ui_deck.plusStarSelection = nextChoice || null;
      return normalizePlusStar();
    };
    const draftRules = context => {
      const source = context && typeof context === "object" ? context : {};
      return Object.freeze({
        mode: state_ui_deck.LeagueFormatOwner.normalizeLeague(source.mode || state_ui_deck.leagueSelection),
        composition: state_ui_deck.LeagueFormatOwner.normalizeComposition(source.composition || state_ui_deck.comprehensiveComposition),
        plusStar: Object.prototype.hasOwnProperty.call(source, "plusStar") ? source.plusStar : state_ui_deck.plusStarSelection,
        team: source.team || "P"
      });
    };
    const toggleCard = (rawId, capacity = state_ui_deck.LeagueFormatOwner.deckSize(state_ui_deck.leagueSelection), context = null) => {
      const rules = draftRules(context);
      const id = setupCardId(rawId);
      const card = state_catalog_cards.CARDS.find(entry => entry.id === id);
      if (!card) return false;
      let index = state_ui_battle_state.selected.indexOf(id);
      const group = card.formGroup;
      if (group) index = state_ui_battle_state.selected.findIndex(value => state_catalog_cards.CARDS.find(entry => entry.id === value)?.formGroup === group);
      if (index >= 0) replaceDeck(state_ui_battle_state.selected.filter((_, at) => at !== index));else {
        if (state_ui_battle_state.selected.length >= capacity) return false;
        if (group && state_ui_battle_state.selected.some(value => state_catalog_cards.CARDS.find(entry => entry.id === value)?.formGroup === group)) return false;
        const admission = state_ui_deck.LeagueFormatOwner.admit(state_ui_battle_state.selected, id, rules.mode, rules.composition, rules.plusStar, rules.team);
        if (!admission.ok) return false;
        state_ui_battle_state.selected.push(id);
        state_ui_deck.plusStarSelection = admission.plusStar;
      }
      normalizePlusStar();
      return true;
    };
    const changeForm = (group, next, context = null) => {
      const rules = draftRules(context);
      if (!group || !next || !state_ui_deck.LeagueFormatOwner.cardAllowed(next, rules.mode, rules.composition)) return false;
      const index = state_ui_battle_state.selected.findIndex(value => state_catalog_cards.CARDS.find(entry => entry.id === value)?.formGroup === group);
      if (index >= 0) {
        const draft = [...state_ui_battle_state.selected];
        draft[index] = next;
        if (!state_ui_deck.LeagueFormatOwner.partialValid(draft, rules.mode, rules.composition, rules.plusStar, rules.team)) return false;
        state_ui_battle_state.selected[index] = next;
      }
      setSetupFormState(group, next);
      normalizePlusStar();
      return true;
    };
    const replaceAt = (index, id, context = null) => {
      const rules = draftRules(context);
      if (!Number.isInteger(index) || index < 0 || index >= state_ui_battle_state.selected.length || !state_catalog_cards.CARDS.some(entry => entry.id === id)) return false;
      const draft = [...state_ui_battle_state.selected];
      draft[index] = id;
      if (!state_ui_deck.LeagueFormatOwner.partialValid(draft, rules.mode, rules.composition, rules.plusStar, rules.team)) return false;
      state_ui_battle_state.selected[index] = id;
      normalizePlusStar();
      return true;
    };
    const sanitizeInvaders = () => {
      let seen = false;
      const clean = [];
      for (const id of state_ui_battle_state.selected) {
        if (isInvaderCardId(id)) {
          if (seen) continue;
          seen = true;
        }
        if (!clean.includes(id) && clean.length < state_ui_deck.LeagueFormatOwner.deckSize(state_ui_deck.leagueSelection)) clean.push(id);
      }
      if (clean.length !== state_ui_battle_state.selected.length || clean.some((id, index) => state_ui_battle_state.selected[index] !== id)) replaceDeck(clean);
      normalizePlusStar();
      return snapshot();
    };
    const clearInvaders = () => {
      const next = state_ui_battle_state.selected.filter(id => !isInvaderCardId(id));
      if (next.length !== state_ui_battle_state.selected.length) replaceDeck(next);
      normalizePlusStar();
      return snapshot();
    };
    const applyInvader = (id, capacity = state_ui_deck.LeagueFormatOwner.deckSize(state_ui_deck.leagueSelection), context = null) => {
      const rules = draftRules(context);
      if (!isInvaderCardId(id) || !state_ui_deck.LeagueFormatOwner.cardAllowed(id, rules.mode, rules.composition)) return Object.freeze({
        applied: false,
        needsReplacement: false
      });
      sanitizeInvaders();
      const oldIndex = state_ui_battle_state.selected.findIndex(isInvaderCardId);
      if (oldIndex >= 0) {
        const draft = [...state_ui_battle_state.selected];
        draft[oldIndex] = id;
        if (!state_ui_deck.LeagueFormatOwner.partialValid(draft, rules.mode, rules.composition, rules.plusStar, rules.team)) return Object.freeze({
          applied: false,
          needsReplacement: false
        });
        state_ui_battle_state.selected[oldIndex] = id;
        normalizePlusStar();
        return Object.freeze({
          applied: true,
          needsReplacement: false
        });
      }
      if (state_ui_battle_state.selected.length < capacity) {
        if (!state_ui_deck.LeagueFormatOwner.partialValid([...state_ui_battle_state.selected, id], rules.mode, rules.composition, rules.plusStar, rules.team)) return Object.freeze({
          applied: false,
          needsReplacement: false
        });
        state_ui_battle_state.selected.push(id);
        normalizePlusStar();
        return Object.freeze({
          applied: true,
          needsReplacement: false
        });
      }
      return Object.freeze({
        applied: false,
        needsReplacement: true
      });
    };
    const reconcileAndPublish = () => {
      normalizePlusStar();
      // Online lobby publication is owned exclusively by LobbyEngine; the legacy unhandled `deck` packet is retired.
      return snapshot();
    };
    return Object.freeze({
      snapshot,
      normalizePlusStar,
      reset,
      commit,
      toggleCard,
      changeForm,
      replaceAt,
      sanitizeInvaders,
      clearInvaders,
      applyInvader,
      reconcileAndPublish
    });
  })();
  state_ui_setup.LocalInputEligibility = (() => {
    let providers = Object.freeze({
      locks: () => [],
      clock: () => ({
        locked: false
      }),
      online: () => ({}),
      bossControls: () => true
    });
    const bindProviders = next => {
      providers = Object.freeze({
        ...providers,
        ...(next || {})
      });
      return true;
    };
    const evaluate = (g, context = null) => {
      const reasons = [];
      const surfaceKind = context?.surfaceKind || (g?.bossRaid ? "boss-raid" : "base");
      const pair = context?.actorTeam != null ? [context.actorTeam, context.actorSlot ?? null] : g?.order?.[g?.turn] || [];
      const currentActorCanonicalTeam = pair[0] ?? null;
      const currentActorSlot = pair[1] == null ? null : pair[1];
      const actor = context?.actor || (currentActorCanonicalTeam != null && currentActorSlot != null ? unitAt(g, currentActorCanonicalTeam, currentActorSlot) : null);
      const currentActorUid = context?.actorUid || actor?.entityId || actor?.uid || null;
      const canonicalLocalTeam = context?.canonicalLocalTeam || (g ? localTeamFor(g) : null);
      const displayLocalSide = canonicalLocalTeam ? displaySideFor(g, canonicalLocalTeam) : null;
      const standardOnline = context?.standardOnline ?? (g?.mode === "online" && !g?.bossRaid?.online);
      const online = providers.online?.(g) || {};
      const runtime = online.runtime || {};
      const locks = [...(providers.locks?.() || [])];
      const clock = providers.clock?.() || {};
      let actions = [];
      try {
        if (Array.isArray(context?.actions)) actions = [...context.actions];else if (g && currentActorCanonicalTeam != null && currentActorSlot != null) actions = legalActions(g, currentActorCanonicalTeam, currentActorSlot) || [];
      } catch (error) {
        reasons.push("LEGAL_ACTION_EVALUATION_FAILED");
      }
      const replacementRequired = (!actor || actor.dead) && actions.some(action => action.type === "deploy");
      const mandatoryAutomaticAction = actions.some(action => action.type === "scheduled" || action.type === "speedDelay");
      const manualActions = actions.filter(action => action.type !== "scheduled" && action.type !== "speedDelay");
      if (!g) reasons.push("NO_GAME");else {
        if (g.ended || g.winner) reasons.push("BATTLE_ENDED");
        if (!pair.length) reasons.push("CURRENT_ACTOR_MISSING");
        if ((!actor || actor.dead) && !replacementRequired) reasons.push("CURRENT_ACTOR_NOT_ALIVE");
        if (!context?.skipActiveIdentityChecks && g.activeTeamId && g.activeTeamId !== currentActorCanonicalTeam) reasons.push("ACTIVE_TEAM_MISMATCH");
        if (!context?.skipActiveIdentityChecks && g.activeEntityId && currentActorUid && g.activeEntityId !== currentActorUid) reasons.push("ACTIVE_ENTITY_MISMATCH");
        if (g.mode === "spectator") reasons.push("SPECTATOR_READ_ONLY");
        if (g.mode === "aivai" || g.mode === "ai-ai") reasons.push("AI_CONTROLLED_MODE");
        if (currentActorCanonicalTeam !== canonicalLocalTeam) reasons.push("REMOTE_ACTOR_TURN");
        if (standardOnline) {
          const expectedTeam = online.role === "host" ? "P" : online.role === "guest" ? "A" : null;
          if (!online.connected) reasons.push("TRANSPORT_NOT_CONNECTED");
          if (!online.battleStarted) reasons.push("BATTLE_START_NOT_COMMITTED");
          if (expectedTeam && canonicalLocalTeam !== expectedTeam) reasons.push("ROLE_CANONICAL_TEAM_MISMATCH");
          if (runtime.generation > 0 && !runtime.committed) reasons.push("SESSION_NOT_COMMITTED");
          if (runtime.generation > 0 && runtime.state !== "IN_BATTLE") reasons.push(`SESSION_${runtime.state || "UNKNOWN"}`);
          if (online.reconnecting) reasons.push("RECONNECTING");
        }
        if (g?.bossRaid?.online) {
          if (!online.connected) reasons.push("TRANSPORT_NOT_CONNECTED");
          if (!online.battleStarted) reasons.push("BATTLE_START_NOT_COMMITTED");
          if (runtime.generation > 0 && (!runtime.committed || runtime.state !== "IN_BATTLE")) reasons.push(`SESSION_${runtime.state || "NOT_COMMITTED"}`);
          if (online.reconnecting) reasons.push("RECONNECTING");
        }
        if (g?.bossRaid?.online && !providers.bossControls?.(g)) reasons.push("BOSS_SLOT_NOT_LOCAL");
        if (locks.length) reasons.push("ACTIVE_INPUT_LOCK");
        if (clock.locked) reasons.push("CLOCK_INPUT_LOCK");
        if (g.pendingTransaction || g.pendingAction || g.pendingPayment || context?.pendingSubmitted) reasons.push("PENDING_AUTHORITATIVE_ACTION");
        if (online.pendingActionId || context?.pendingActionId) reasons.push("PENDING_ONLINE_ACTION");
        if (online.busy) reasons.push("APPLICATION_BUSY");
        if (!actions.length) reasons.push("NO_LEGAL_ACTIONS");
        if (mandatoryAutomaticAction) reasons.push("MANDATORY_AUTOMATIC_ACTION");
      }
      const uniqueReasons = [...new Set(reasons)];
      const ownsCurrentActor = !!g && currentActorCanonicalTeam === canonicalLocalTeam && !["SPECTATOR_READ_ONLY", "AI_CONTROLLED_MODE"].some(reason => uniqueReasons.includes(reason));
      const canAct = ownsCurrentActor && uniqueReasons.length === 0 && manualActions.length > 0;
      return Object.freeze({
        canAct,
        reasons: uniqueReasons,
        ownsCurrentActor,
        canonicalLocalTeam,
        displayLocalSide,
        currentActorCanonicalTeam,
        currentActorSlot,
        currentActorUid,
        currentActorCharacterId: actor?.card || null,
        activeEntityId: g?.activeEntityId || null,
        actorAlive: !!actor && !actor.dead,
        replacementRequired,
        mandatoryAutomaticAction,
        legalActionCount: actions.length,
        manualLegalActionCount: manualActions.length,
        gatherLegal: actions.some(action => action.type === "gather"),
        actions,
        activeLocks: locks.map(lock => ({
          ...lock
        })),
        pendingActionId: online.pendingActionId || g?.pendingAction?.actionId || null,
        authoritativeRevision: Number(online.authoritativeRevision || 0),
        localAppliedRevision: Number(g?.networkRevision || 0),
        sessionState: runtime.state || null,
        reconnectState: online.reconnecting ? "RECONNECTING" : "CONNECTED",
        surfaceKind
      });
    };
    return Object.freeze({
      evaluate,
      canAct: g => evaluate(g).canAct,
      bindProviders
    });
  })();
}
/* 편성 타일을 그리는 유일한 경로. 등급 색·별·플러스스타 금테·슬롯 번호·툴팁 슬롯은 모두 여기서 한 번에 정해진다.
   덱이 바뀌는 모든 경우(카드 선택·플러스스타·폼 전환·침략자·온라인 동기화)가 updateDeckSetup을 거쳐 이 함수로 다시 그린다. */
function renderDeckTiles() {
  const ids = state_ui_deck.LeagueFormatOwner.setupPool(state_ui_deck.leagueSelection, state_ui_deck.comprehensiveComposition, state_ui_battle_state.selected, state_ui_deck.plusStarSelection, "P");
  syncTileGrid(state_ui_battle_state.$("#deckCards"), ids.map(id => {
    const c = state_catalog_cards.CARDS.find(x => x.id === id);
    if (!c) return "";
    const slotIndex = state_ui_battle_state.selected.indexOf(c.id),
      effectiveCard = state_catalog_cards.EffectiveCardPresentationOwner.resolve(c, null, {
        deck: state_ui_battle_state.selected,
        plusStarChoice: state_ui_deck.plusStarSelection,
        team: "P",
        slotIndex,
        surface: "local-composition"
      }),
      plusActive = effectiveCard.plusStar,
      legalForms = c.formGroup ? state_ui_deck.LeagueFormatOwner.eligibleForms(c.formGroup, state_ui_battle_state.selected, state_ui_deck.leagueSelection, state_ui_deck.comprehensiveComposition, state_ui_deck.plusStarSelection, "P") : [],
      nextForm = c.formGroup ? nextLeagueFormId(c.formGroup, c.id, state_ui_battle_state.selected, state_ui_deck.leagueSelection, state_ui_deck.comprehensiveComposition, state_ui_deck.plusStarSelection, "P") : null,
      chosen = state_ui_battle_state.selected.includes(c.id),
      slotBlocked = !chosen && !state_ui_deck.LeagueFormatOwner.admit(state_ui_battle_state.selected, c.id, state_ui_deck.leagueSelection, state_ui_deck.comprehensiveComposition, state_ui_deck.plusStarSelection, "P").ok,
      toggle = c.formGroup && legalForms.length > 1 && nextForm ? `<button class="form-toggle" data-form-toggle="${c.formGroup}" title="${c.name} → ${state_catalog_cards.CARDS.find(x => x.id === nextForm)?.name || c.name}">⇄</button>` : "",
      plus = state_catalog_cards.PLUS_STAR_ELIGIBLE.has(c.id) ? `<button class="plusstar-toggle${plusActive ? " active" : ""}" data-action="toggle-plusstar" data-plusstar-card="${c.id}" data-plus-star="${c.id}" aria-pressed="${plusActive}">🎆</button>` : "";
    return `<div class="card compact-card selectable ${characterTileClass(c, effectiveCard, effectiveCard.visualModifiers.glowClass)} ${slotBlocked ? "league-slot-blocked" : ""}"${tileKeyAttr(c)} data-info-card="setup" data-info-surface="local-composition" data-info-team="P" data-info-slot-index="${slotIndex}" data-card-id="${c.id}" data-id="${c.id}" data-effective-character-id="${effectiveCard.effectiveCharacterId}" data-effective-plus-star="${effectiveCard.plusStar}" data-effective-deck-slot="${effectiveCard.exactDeckSlot || ""}" aria-disabled="${slotBlocked}">${characterTileInner(c, effectiveCard, { slotIndex, toggles: `${toggle}${plus}` })}</div>`;
  }).join(""));
  state_ui_battle_state.$$('[data-form-toggle]').forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      const group = button.dataset.formToggle,
        current = button.closest('[data-card-id]')?.dataset.cardId || setupFormState(group),
        next = nextLeagueFormId(group, current, state_ui_battle_state.selected);
      if (!next || next === current || !state_ui_setup.DeckDraftApplication.changeForm(group, next)) return;
      renderSetup(false);
    };
  });
  state_ui_battle_state.$$("#deckCards .card").forEach(cardEl => {
    cardEl.onclick = event => {
      if (event?.target?.closest?.(".form-toggle,.plusstar-toggle")) return;
      if (cardEl.classList.contains("league-slot-blocked")) return;
      if (!state_ui_setup.DeckDraftApplication.toggleCard(cardEl.dataset.id)) return;
      updateDeckSetup();
    };
  });
}
export function updateDeckSetup() {
  sanitizeSelectedInvaders();
  state_ui_setup.DeckDraftApplication.reconcileAndPublish();
  renderDeckTiles();
  const localDeckRoot = document.getElementById("deckCards");
  const localPlusContext = {
    surface: "local-composition",
    scope: "setup",
    team: "P"
  };
  state_engine_entities.PlusStarBannerPresentationOwner.bind(localDeckRoot, button => {
    const result = state_engine_entities.PlusStarInteractionOwner.apply({
      ...localPlusContext,
      deck: state_ui_battle_state.selected,
      currentChoice: state_ui_deck.plusStarSelection,
      cardId: button.dataset.plusstarCard,
      capacity: state_ui_deck.LeagueFormatOwner.deckSize(state_ui_deck.leagueSelection),
      validate: (proposal, choice) => state_ui_deck.LeagueFormatOwner.partialValid(proposal, state_ui_deck.leagueSelection, state_ui_deck.comprehensiveComposition, choice, "P"),
      commit: (nextDeck, nextChoice) => state_ui_setup.DeckDraftApplication.commit(nextDeck, nextChoice),
      feedback: message => {
        const help = document.getElementById("deckHelp");
        if (help) help.textContent = message;
      }
    });
    if (result.ok) renderSetup(false);
  });
  state_ui_battle_state.$$("#deckCards .card").forEach(x => {
    x.classList.remove("selected", "active", "chosen", "green-border");
    x.removeAttribute("aria-selected");
    x.removeAttribute("aria-pressed");
    delete x.dataset.selected;
  });
  state_ui_battle_state.$$("#deckCards .card").forEach(x => {
    let id = x.dataset.id,
      actual = setupCardId(id),
      group = state_catalog_cards.CARDS.find(c => c.id === actual)?.formGroup,
      chosen = state_ui_battle_state.selected.includes(actual),
      blocked = !chosen && group && state_ui_battle_state.selected.some(v => v !== actual && state_catalog_cards.CARDS.find(c => c.id === v)?.formGroup === group);
    const slotBlocked = !chosen && !state_ui_deck.LeagueFormatOwner.admit(state_ui_battle_state.selected, actual, state_ui_deck.leagueSelection, state_ui_deck.comprehensiveComposition, state_ui_deck.plusStarSelection, "P").ok;
    x.classList.toggle("selected", chosen);
    x.classList.toggle("form-blocked", !!blocked);
    x.classList.toggle("league-slot-blocked", !!slotBlocked);
    x.setAttribute("aria-disabled", String(!!slotBlocked));
    x.setAttribute("aria-selected", String(chosen));
    x.setAttribute("aria-pressed", String(chosen));
    x.dataset.selected = String(chosen);
    const order = x.querySelector(".tile-order");
    if (order) order.textContent = chosen ? String(state_ui_battle_state.selected.indexOf(actual) + 1) : "";
  });
  const complete = state_ui_deck.LeagueFormatOwner.completeValid(state_ui_battle_state.selected, state_ui_deck.leagueSelection, state_ui_deck.comprehensiveComposition, state_ui_deck.plusStarSelection, "P");
  state_ui_battle_state.$("#deckCount").textContent = `${state_ui_battle_state.selected.length} / ${state_ui_deck.LeagueFormatOwner.deckSize(state_ui_deck.leagueSelection)}`;
  state_ui_battle_state.$("#deckCount").classList.toggle("valid", complete);
  state_ui_battle_state.$("#deckCount").classList.toggle("invalid", state_ui_battle_state.selected.length > 0 && !complete);
  state_ui_battle_state.$("#startBtn").disabled = !complete;
  syncLeagueSelectionSurface();
  state_engine_entities.PlusStarBannerPresentationOwner.sync(localDeckRoot, localPlusContext, state_ui_battle_state.selected, state_ui_deck.plusStarSelection);
  syncInvaderPortalState();
}
export function renderSetup(reset = true) {
  if (reset) state_ui_setup.DeckDraftApplication.reset();
  normalizeSetupFormsForLeague();
  updateDeckSetup();
  mountInvaderPortal();
  updateDeckSetup();
}

export function deckConflictPenalty(ids) {
  if (!ids.includes("flameflower")) return 0;
  let penalty = 0;
  if (ids.includes("kingprawn")) penalty -= 80;
  if (ids.includes("iceknight")) penalty -= 70;
  if (ids.includes("dragonfish")) penalty -= 35;
  return penalty;
}
/* Mega league has no grade rule, so strength has to come from the score: without it the AI treated a 2☆ like a 4.5☆
   and brought about two 2☆ cards to every deck. Each star above 2☆ is worth 7 points, with wider noise so mega decks stay varied. */
export function gradeStrength(c) {
  const stars = parseFloat(c?.grade);
  return Number.isFinite(stars) ? Math.max(0, stars - 2) * 7 : 0;
}
export function deckScore(ids, league = "mega") {
  let cs = ids.map(id => state_catalog_cards.CARDS.find(c => c.id === id)),
    roles = new Set(cs.map(c => c.role.split(" ")[0])).size,
    expensive = cs.flatMap(c => c.skills).filter(s => parseCost(s.cost).any + parseCost(s.cost).R + parseCost(s.cost).W + parseCost(s.cost).B >= 3).length,
    support = cs.filter(c => c.skills.some(s => s.tags.some(t => ["heal", "shield", "support"].includes(t)))).length,
    tanks = cs.filter(c => c.role.includes("탱커")).length,
    cheap = cs.filter(c => c.skills.some(s => s.tags.includes("damage") && costGap(makeUnit(c.id, "score"), s.cost) <= 1)).length;
  const grade = state_ui_deck.LeagueFormatOwner.free(league) ? cs.reduce((sum, c) => sum + gradeStrength(c), 0) : 0;
  return grade + roles * 10 + Math.min(1, support) * 12 + Math.min(1, tanks) * 12 + Math.min(2, cheap) * 5 + (expensive ? support * 6 : 0) + deckConflictPenalty(ids);
}
export function arrangeAIDeck(ids) {
  let d = [...ids],
    memoryIndex = d.findIndex(id => state_catalog_cards.CARDS.find(c => c.id === id)?.skills.some(s => skillDefHasTag(s, "copy")));
  if (memoryIndex < 0) return d;
  let memoryId = d[memoryIndex],
    dragonIndex = d.findIndex((id, i) => i !== memoryIndex && state_catalog_cards.CARDS.find(c => c.id === id)?.tags.includes("dragon"));
  if (dragonIndex < 0) return d;
  let dragonId = d[dragonIndex],
    rest = d.filter((_, i) => i !== memoryIndex && i !== dragonIndex);
  return [memoryId, ...rest.slice(0, 1), dragonId, ...rest.slice(1)];
}
export function validFormDeck(ids) {
  let groups = ids.map(id => state_catalog_cards.CARDS.find(c => c.id === id)?.formGroup).filter(Boolean);
  return new Set(groups).size === groups.length && new Set(ids).size === ids.length && (ids || []).filter(isInvaderCardId).length <= 1;
}
export function buildAIDeck(seed, league = "mega", composition = state_ui_deck.comprehensiveComposition) {
  league = state_ui_deck.LeagueFormatOwner.normalizeLeague(league);
  composition = state_ui_deck.LeagueFormatOwner.normalizeComposition(composition);
  let rng = new RNG(seed + "-ai-deck"),
    deck = [],
    pool = [...poolForLeague(league, composition)];
  while (deck.length < state_ui_deck.LeagueFormatOwner.deckSize(league)) {
    const ranked = pool.filter(id => state_ui_deck.LeagueFormatOwner.partialValid([...deck, id], league, composition)).map(id => ({
      id,
      score: deckScore([...deck, id], league) + rng.next() * (state_ui_deck.LeagueFormatOwner.free(league) ? 12 : 4)
    })).sort((a, b) => b.score - a.score);
    if (!ranked.length) throw new Error(`AI deck composition exhausted: ${league}/${composition}/${deck.join(",")}`);
    const pick = ranked[0].id;
    deck.push(pick);
    pool = pool.filter(id => id !== pick);
  }
  if (!state_ui_deck.LeagueFormatOwner.completeValid(deck, league, composition)) throw new Error(`AI deck composition invalid: ${league}/${composition}`);
  return league === "mega" ? arrangeAIDeck(deck) : deck;
}
export function localTeamFor(g) {
  return g?.mode === "online" || g?.mode === "spectator" ? state_ui_deck.onlineSide : "P";
}
export function displaySideFor(g, t) {
  return t === localTeamFor(g) ? "player" : "ai";
}
export function grandVisualOwner(g) {
  if (g?.fieldEffect?.type !== "grand") return null;
  return g.fieldEffect.team === localTeamFor(g) ? "P" : "A";
}
export function renderBattleBoard() {
  if (typeof systems.ActionFaultInjector === "object") {
    try {
      systems.ActionFaultInjector.hit("render-before");
    } catch (error) {
      systems.PresentationFailureChannel?.emit?.({
        surface: "render",
        phase: "render-before",
        error: String(error),
        battleId: state_ui_battle_state.game?.battleId || state_ui_battle_state.game?.matchId || null,
        revision: Number(state_ui_battle_state.game?.networkRevision || 0)
      });
      queueMicrotask(() => systems.LifecycleManager?.continuity?.authoritativeSettled?.({
        reason: "presentation-failure",
        surface: "render"
      }));
      throw error;
    }
  }
  if (!state_ui_battle_state.game) return;
  prepareCurrentTurn(state_ui_battle_state.game);
  const inputProjection = state_ui_setup.LocalInputEligibility.evaluate(state_ui_battle_state.game);
  let localSide = inputProjection.canonicalLocalTeam;
  document.querySelector(".player-side .side-head b").textContent = state_ui_battle_state.game.mode === "online" ? "내 진영" : "플레이어 진영";
  document.querySelector(".ai-side .side-head b").textContent = state_ui_battle_state.game.mode === "online" ? "상대 진영" : "AI 진영";
  for (const t of ["A", "P"]) {
    let tm = state_ui_battle_state.game.teams[t],
      isLocal = t === localSide,
      pre = displaySideFor(state_ui_battle_state.game, t),
      displayTeam = isLocal ? "P" : "A";
    state_ui_battle_state.$(`#${pre}Slots`).innerHTML = tm.field.map((u, i) => `<div class="slot" data-slotteam="${t}" data-slotindex="${i}">${tm.traps[i] ? '<span class="trap">⚡ 전기태클</span>' : ""}${unitHTML(u, t, i, false, displayTeam)}</div>`).join("");
    if (t !== localSide) {
      let known = tm.bench.filter(u => u && !u.dead && state_ui_battle_state.game.revealed[t].includes(u.uid)),
        hidden = tm.bench.filter(u => u && !u.dead && !state_ui_battle_state.game.revealed[t].includes(u.uid)).length,
        parts = known.map((u, i) => unitHTML(u, t, i, true, "A"));
      if (hidden) parts.push(`<div class="unknown-bench"><b>정체불명 후열</b><span>남은 카드 ${hidden}장</span></div>`);
      state_ui_battle_state.$(`#${pre}Bench`).innerHTML = parts.join("") || '<span class="muted">후열 없음</span>';
    } else state_ui_battle_state.$(`#${pre}Bench`).innerHTML = tm.bench.map((u, i) => unitHTML(u, t, i, true, "P")).join("") || '<span class="muted">후열 없음</span>';
    state_ui_battle_state.$(`#${pre}Alive`).textContent = `생존 ${aliveUnits(tm).length}/${state_ui_deck.LeagueFormatOwner.deckSize(state_ui_battle_state.game.league)} · 교체 ${tm.switchUses || 0}/3`;
  }
  let turns = [];
  for (let i = 0; i < state_ui_battle_state.game.order.length; i++) {
    let oi = (state_ui_battle_state.game.turn + i) % state_ui_battle_state.game.order.length,
      [t, s] = state_ui_battle_state.game.order[oi],
      u = unitAt(state_ui_battle_state.game, t, s);
    turns.push(`<span class="turntoken ${i ? "" : "now"}">${i ? "다음" : "현재"} ${t === localSide ? "내" : state_ui_battle_state.game.mode === "online" ? "상대" : "AI"}-${s + 1}: ${u && !u.dead ? u.name : "빈 슬롯"}</span>`);
  }
  state_ui_battle_state.$("#turnStrip").innerHTML = turns.join("");
  state_ui_battle_state.$$(".card").forEach(x => x.classList.remove("active-turn", "targetable"));
  let [ct, cs] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    cu = unitAt(state_ui_battle_state.game, ct, cs),
    activeEntityId = inputProjection.currentActorUid || cu?.entityId || cu?.uid || null,
    el = activeEntityId ? battlefieldCardForUid(state_ui_battle_state.game, activeEntityId) : null;
  document.querySelector(".arena")?.setAttribute("data-active-entity-id", activeEntityId || "");
  document.querySelector(".arena")?.setAttribute("data-active-canonical-team", inputProjection.currentActorCanonicalTeam || "");
  if (el?.isConnected) el.classList.add("active-turn");
  if (state_ui_battle_state.pendingSkill) {
    for (const tar of state_ui_battle_state.pendingSkill.targets) {
      let q = state_ui_battle_state.pendingSkill.slotTarget ? `.slot[data-slotteam="${tar.team}"][data-slotindex="${tar.slot}"]` : `.card[data-zone="field"][data-team="${tar.team}"][data-slot="${tar.slot}"]`;
      let e = state_ui_battle_state.$(q);
      if (e) {
        e.classList.add("targetable");
        e.onclick = () => playerChooseTarget(tar);
      }
    }
  }
  renderLog();
  state_ui_action_panel.ActionPanelConvergenceOwner.request("interaction-cancel");
  playVisuals();
  refreshCardTooltip();
  if (state_ui_battle_state.game.winner) showEnd();
}

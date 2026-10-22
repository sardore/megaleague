import { raidCardForUnit } from "../features/boss-raid.js";
import { TimerManager } from "../runtime/timers.js";

// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_engine_entities = {
  STATUS: undefined,
  PlusStarBannerPresentationOwner: undefined,
  PlusStarInteractionOwner: undefined,
  GenericBattleStatisticsOwner: undefined,
  UNKNOWN_CARD: undefined,
  EXTRA_RUNTIME_SKILL_CONTAINERS: undefined,
  CARD_REGISTRY: undefined,
  CARD_REGISTRY_SIGNATURE: undefined,
  RUNTIME_SKILL_INDEX_SIGNATURE: undefined,
  RUNTIME_SKILL_INDEX: undefined
};
import { state_runtime_transactions } from "../runtime/transactions.js";
import { state_runtime_input } from "../runtime/input.js";
import { state_runtime_state } from "../runtime/state.js";
import { state_runtime_config } from "../runtime/config.js";
import { state_runtime_entities } from "../runtime/entities.js";
import { effectiveSkillTarget, state_catalog_cards } from "../catalog/cards.js";
import { other, unitAt } from "./actions.js";
import { findUnit, teamOf } from "./combat.js";
import { allEnergy, initializeDeployment, totalEnergy } from "./energy.js";
import { syncAromaCombatFlags } from "../features/elixian.js";
import { allReactiveEnergyUnits, initReactiveEnergyUnit, reactiveEnergyAmount, reactiveEnergyObservedKey, reactiveEnergyRule, syncReactiveEnergyMaxHp } from "../features/genocider.js";
import { systems } from "../runtime/systems.js";
import { refreshCardTooltip } from "../ui/cards.js";
import { state_ui_deck } from "../ui/deck.js";
import { validFormDeck } from "../ui/setup.js";
export function initializeEngineEntities() {
  state_engine_entities.STATUS = {
    poison: "독",
    slow: "감속",
    paralyze: "마비",
    burn: "화상",
    freeze: "냉동",
    traitSeal: "특성봉인",
    skillSeal: "기술봉인",
    healSeal: "회복봉인"
  };
  state_engine_entities.PlusStarBannerPresentationOwner = (() => {
    const pending = new Set(),
      bindings = new WeakMap();
    const scopeKey = context => `${context.surface || "composition"}|${context.scope || "local"}|${context.team || "P"}`;
    const choiceKey = (context, choice) => `${scopeKey(context)}|${choice?.slotIndex ?? -1}|${choice?.cardId || "none"}`;
    const queueActivation = (context, choice) => {
      if (choice) pending.add(choiceKey(context, choice));
    };
    const burst = (banner, identity) => {
      if (!banner || banner.querySelector(':scope > .plusstar-particle-layer')) return false;
      const layer = document.createElement('span');
      layer.className = 'plusstar-particle-layer';
      layer.dataset.plusstarBurst = identity;
      banner.appendChild(layer);
      const animations = [];
      for (let i = 0; i < 16; i++) {
        const particle = document.createElement('span');
        particle.className = 'plusstar-gold-particle';
        const angle = Math.PI * 2 * i / 16 + i % 3 * .09,
          radius = 34 + i % 5 * 8,
          dx = Math.cos(angle) * radius,
          dy = Math.sin(angle) * radius;
        particle.style.setProperty('--particle-size', `${4 + i % 4 * 2}px`);
        layer.appendChild(particle);
        if (typeof particle.animate === 'function') animations.push(particle.animate([{
          opacity: 0,
          transform: 'translate(-50%,-50%) scale(.25)'
        }, {
          opacity: 1,
          transform: `translate(calc(-50% + ${dx * .28}px),calc(-50% + ${dy * .28}px)) scale(1.15)`,
          offset: .26
        }, {
          opacity: .78,
          transform: `translate(calc(-50% + ${dx * .74}px),calc(-50% + ${dy * .74}px)) scale(.72)`,
          offset: .7
        }, {
          opacity: 0,
          transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.12)`
        }], {
          duration: 620 + i % 4 * 70,
          delay: i % 5 * 22,
          easing: 'cubic-bezier(.12,.66,.25,1)',
          fill: 'forwards'
        }).finished.catch(() => {}));
      }
      Promise.allSettled(animations).then(() => layer.remove());
      return true;
    };
    const sync = (root, context, deck, choice) => {
      if (!root) return false;
      const resolved = resolvePlusStarChoice(choice, deck, context.team || 'P');
      root.querySelectorAll('[data-action="toggle-plusstar"]').forEach(button => {
        const cardId = button.dataset.plusstarCard,
          banner = button.closest('.card,.boss-deck-card');
        const explicit = Number(banner?.dataset?.infoSlotIndex),
          slotIndex = Number.isInteger(explicit) && explicit >= 0 ? explicit : deck.indexOf(cardId);
        const effectiveCard = state_catalog_cards.EffectiveCardPresentationOwner.resolve(card(cardId), null, {
          deck,
          plusStarChoice: choice,
          team: context.team || "P",
          slotIndex,
          surface: context.surface || "composition",
          contextIdentity: scopeKey(context)
        });
        const active = effectiveCard.plusStar;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
        state_catalog_cards.EffectiveCardPresentationOwner.syncElement(banner, effectiveCard);
        if (!active) banner?.querySelector(':scope > .plusstar-particle-layer')?.remove();
        if (active) {
          const key = choiceKey(context, resolved);
          if (pending.delete(key)) burst(banner, key);
        }
      });
      if (typeof refreshCardTooltip === "function") refreshCardTooltip();
      return true;
    };
    const bind = (root, handler) => {
      if (!root) return false;
      bindings.set(root, handler);
      if (root.dataset.plusstarDelegated === 'true') return true;
      root.dataset.plusstarDelegated = 'true';
      root.addEventListener('click', event => {
        const button = event.target.closest?.('[data-action="toggle-plusstar"]');
        if (!button || !root.contains(button)) return;
        event.preventDefault();
        event.stopPropagation();
        const current = bindings.get(root);
        if (typeof current === 'function') current(button, event);
      });
      return true;
    };
    return Object.freeze({
      queueActivation,
      sync,
      bind
    });
  })();
  state_engine_entities.PlusStarInteractionOwner = Object.freeze({
    apply({
      surface,
      scope,
      team = 'P',
      deck,
      currentChoice,
      cardId,
      capacity = 4,
      validate = validFormDeck,
      commit,
      feedback
    }) {
      const beforeDeck = [...(deck || [])],
        beforeChoice = resolvePlusStarChoice(currentChoice, beforeDeck, team),
        candidate = state_catalog_cards.CARDS.find(c => c.id === cardId);
      const reject = message => {
        if (typeof feedback === 'function') feedback(message);
        return Object.freeze({
          ok: false,
          message,
          deck: beforeDeck,
          choice: beforeChoice
        });
      };
      if (!candidate || !state_catalog_cards.PLUS_STAR_ELIGIBLE.has(cardId)) return reject('PlusStar를 사용할 수 없는 캐릭터입니다.');
      let nextDeck = [...beforeDeck],
        slotIndex = nextDeck.indexOf(cardId),
        nextChoice = null,
        activated = false;
      if (slotIndex >= 0 && beforeChoice?.slotIndex === slotIndex && beforeChoice?.cardId === cardId) nextChoice = null;else {
        if (slotIndex < 0) {
          if (nextDeck.length >= capacity) return reject('덱이 가득 차 PlusStar 캐릭터를 선택할 수 없습니다.');
          const proposal = [...nextDeck, cardId];
          if (!validate(proposal, null)) return reject('기존 덱 규칙 때문에 이 캐릭터를 선택할 수 없습니다.');
          nextDeck = proposal;
          slotIndex = nextDeck.length - 1;
        }
        nextChoice = resolvePlusStarChoice({
          slotIndex,
          cardId
        }, nextDeck, team);
        if (!nextChoice) return reject('PlusStar exact slot identity를 확정하지 못했습니다.');
        activated = true;
      }
      if (!validate(nextDeck, nextChoice)) return reject('덱 검증에 실패했습니다.');
      if (typeof commit !== 'function') return reject('편성 commit owner가 없습니다.');
      commit(nextDeck, nextChoice);
      const context = {
        surface,
        scope,
        team
      };
      if (activated) state_engine_entities.PlusStarBannerPresentationOwner.queueActivation(context, nextChoice);
      return Object.freeze({
        ok: true,
        activated,
        deactivated: !nextChoice,
        deck: [...nextDeck],
        choice: nextChoice,
        context
      });
    }
  });
  state_engine_entities.GenericBattleStatisticsOwner = Object.freeze({
    version: "generic-battle-statistics-r2",
    metricIds: Object.freeze(["damageDealt", "damageTaken", "healingDealt", "healingTaken"]),
    state(g) {
      if (!g) return null;
      if (!g.genericBattleStatistics || g.genericBattleStatistics.version !== this.version) {
        const byInstanceId = {};
        for (const team of ["P", "A"]) for (const zone of ["field", "bench", "graveyard", "summons"]) for (const unit of g.teams?.[team]?.[zone] || []) {
          if (!unit?.uid || byInstanceId[unit.uid]) continue;
          byInstanceId[unit.uid] = {
            instanceId: unit.uid,
            damageDealt: Math.max(0, Number(unit.damageDealt) || 0),
            damageTaken: Math.max(0, Number(unit.damageTaken) || 0),
            healingDealt: Math.max(0, Number(unit.healingDealt) || 0),
            healingTaken: Math.max(0, Number(unit.healingTaken) || 0)
          };
        }
        g.genericBattleStatistics = {
          version: this.version,
          byInstanceId,
          appliedEventIds: {}
        };
      }
      g.genericBattleStatistics.byInstanceId ||= {};
      g.genericBattleStatistics.appliedEventIds ||= {};
      return g.genericBattleStatistics;
    },
    resolveSource(g, source = null) {
      if (source && typeof source === "object" && (source.uid || source.entityId)) return source;
      if (typeof source === "string") return typeof state_runtime_entities.EntityRegistry !== "undefined" ? state_runtime_entities.EntityRegistry.get(g, source) : typeof findUnit === "function" ? findUnit(g, source) : null;
      const tx = g?.pendingTransaction;
      if (tx && typeof unitAt === "function" && tx.teamId != null && Number.isInteger(Number(tx.slot))) return unitAt(g, tx.teamId, Number(tx.slot));
      return null;
    },
    row(g, unit) {
      if (!g || !unit?.uid) return null;
      const state = this.state(g),
        id = String(unit.uid);
      state.byInstanceId[id] ||= {
        instanceId: id,
        damageDealt: 0,
        damageTaken: 0,
        healingDealt: 0,
        healingTaken: 0
      };
      return state.byInstanceId[id];
    },
    sync(unit, row) {
      if (!unit || !row) return;
      for (const key of this.metricIds) unit[key] = Math.max(0, Number(row[key]) || 0);
    },
    actualDamage(before = {}, after = {}) {
      const shieldBefore = Math.max(0, Number(before.shield) || 0),
        shieldAfter = Math.max(0, Number(after.shield) || 0);
      const hpBefore = Math.max(0, Number(before.hp) || 0),
        hpAfter = Math.max(0, Number(after.hp) || 0);
      return Math.max(0, shieldBefore - shieldAfter) + Math.max(0, hpBefore - hpAfter);
    },
    applyEvent(g, event) {
      if (!g || !event || !["DAMAGE_APPLIED", "HEAL_APPLIED", "HEALING_APPLIED"].includes(event.type)) return 0;
      const state = this.state(g),
        eventId = String(event.eventId || `${event.type}:${event.sequence || 0}:${event.sourceEntityId || ""}:${event.recipientEntityId || ""}`);
      if (state.appliedEventIds[eventId]) return 0;
      state.appliedEventIds[eventId] = true;
      const payload = event.payload || {},
        actual = Math.max(0, Number(payload.actualAppliedAmount ?? payload.amount) || 0);
      if (!(actual > 0)) return 0;
      const source = this.resolveSource(g, event.sourceEntityId),
        target = event.recipientEntityId ? typeof state_runtime_entities.EntityRegistry !== "undefined" ? state_runtime_entities.EntityRegistry.get(g, event.recipientEntityId) : typeof findUnit === "function" ? findUnit(g, event.recipientEntityId) : null : null;
      if (event.type === "DAMAGE_APPLIED") {
        if (target) {
          const row = this.row(g, target);
          row.damageTaken += actual;
          this.sync(target, row);
        }
        if (source && source !== target) {
          const row = this.row(g, source);
          row.damageDealt += actual;
          this.sync(source, row);
        }
      } else {
        if (target) {
          const row = this.row(g, target);
          row.healingTaken += actual;
          this.sync(target, row);
        }
        if (source) {
          const row = this.row(g, source);
          row.healingDealt += actual;
          this.sync(source, row);
        }
      }
      return actual;
    },
    recordDamage(g, {
      source = null,
      target = null,
      before = {},
      after = {},
      damageType = "generic",
      effectId = null,
      actionId = null,
      transactionId = null,
      sim = false
    } = {}) {
      if (sim || !target) return 0;
      const actual = this.actualDamage(before, after);
      if (!(actual > 0)) return 0;
      const resolvedSource = this.resolveSource(g, source),
        event = systems.BattleEventEngine?.emit?.(g, "DAMAGE_APPLIED", {
          sourceEntityId: resolvedSource?.entityId || resolvedSource?.uid || null,
          recipientEntityId: target.entityId || target.uid || null,
          teamId: typeof teamOf === "function" ? teamOf(g, target) : null,
          payload: {
            detailed: true,
            damageType,
            effectId,
            actionId: actionId || g?.pendingTransaction?.actionId || null,
            transactionId: transactionId || g?.pendingTransaction?.transactionId || null,
            amount: actual,
            actualAppliedAmount: actual,
            hpBefore: Math.max(0, Number(before.hp) || 0),
            hpAfter: Math.max(0, Number(after.hp) || 0),
            shieldBefore: Math.max(0, Number(before.shield) || 0),
            shieldAfter: Math.max(0, Number(after.shield) || 0)
          }
        });
      return event ? this.applyEvent(g, event) : 0;
    },
    recordHealing(g, {
      source = null,
      target = null,
      requestedAmount = 0,
      actualAppliedAmount = 0,
      reason = null,
      effectId = null,
      actionId = null,
      transactionId = null,
      sim = false
    } = {}) {
      if (sim || !target) return 0;
      const actual = Math.max(0, Number(actualAppliedAmount) || 0);
      if (!(actual > 0)) return 0;
      const resolvedSource = this.resolveSource(g, source),
        event = systems.BattleEventEngine?.emit?.(g, "HEAL_APPLIED", {
          sourceEntityId: resolvedSource?.entityId || resolvedSource?.uid || null,
          recipientEntityId: target.entityId || target.uid || null,
          teamId: typeof teamOf === "function" ? teamOf(g, target) : null,
          payload: {
            detailed: true,
            sourceInstanceId: resolvedSource?.uid || null,
            targetInstanceId: target.uid || null,
            requestedAmount: Math.max(0, Number(requestedAmount) || 0),
            actualAppliedAmount: actual,
            amount: actual,
            reason: reason || null,
            effectId: effectId || null,
            actionId: actionId || g?.pendingTransaction?.actionId || null,
            transactionId: transactionId || g?.pendingTransaction?.transactionId || null
          }
        });
      return event ? this.applyEvent(g, event) : 0;
    },
    metric(g, unit, key) {
      if (!g || !unit?.uid) return 0;
      const state = this.state(g),
        row = state?.byInstanceId?.[String(unit.uid)];
      return Math.max(0, Number(row?.[key] ?? unit?.[key]) || 0);
    },
    projectedMetric(g, unit, key) {
      if (!g || !unit?.uid) return 0;
      const teamId = typeof teamOf === "function" ? teamOf(g, unit) : null;
      const owned = teamId ? (g.teams?.[teamId]?.summons || []).filter(entity => entity?.ownerUid === unit.uid) : [];
      return this.metric(g, unit, key) + owned.reduce((sum, entity) => sum + this.metric(g, entity, key), 0);
    },
    snapshot(g) {
      return JSON.parse(JSON.stringify(this.state(g) || {
        version: this.version,
        byInstanceId: {},
        appliedEventIds: {}
      }));
    }
  });
  state_engine_entities.UNKNOWN_CARD = {
    id: "unknown",
    name: "미공개 카드",
    grade: "?",
    maxHp: 190,
    baseDefense: 0,
    maxEnergy: 4,
    tags: [],
    formGroup: null,
    trait: "미공개 후보군 기대값",
    traits: [],
    skills: [state_catalog_cards.S("unknownSkill", "미공개 기술", "**", "후열 후보군의 평균 기술.", "enemy", [{
      type: "damage",
      amount: 80
    }], ["damage"])],
    role: "미공개",
    complexity: "미공개"
  };
  state_engine_entities.EXTRA_RUNTIME_SKILL_CONTAINERS = [];
  state_engine_entities.CARD_REGISTRY = new Map();
  state_engine_entities.CARD_REGISTRY_SIGNATURE = "";
  state_engine_entities.RUNTIME_SKILL_INDEX_SIGNATURE = "";
  state_engine_entities.RUNTIME_SKILL_INDEX = new Map();
}
export function hashSeed(s) {
  let h = 2166136261 >>> 0;
  for (const c of String(s)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function actionFaultHit(phase) {
  const injector = typeof window !== "undefined" ? systems.ActionFaultInjector : null;
  if (injector && typeof injector.hit === "function") injector.hit(phase);
}
export class RNG {
  constructor(seed) {
    this.s = hashSeed(seed) || 1;
  }
  next() {
    actionFaultHit("rng-before");
    let t = this.s += 0x6d2b79f5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    const value = ((t ^ t >>> 14) >>> 0) / 4294967296;
    actionFaultHit("rng-after");
    return value;
  }
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  pick(a) {
    return a[Math.floor(this.next() * a.length)];
  }
}
export function makeUnit(id, uid) {
  let __result;
  __makeUnitCore: {
    const c = card(id),
      baseDefense = c.baseDefense ?? 0,
      openingGuardSkill = firstSkillByRuntimeKind(c, "openingGuard"),
      strikeSkill = firstSkillByEffect(c, "foxStrike"),
      copySkill = firstSkillByTag(c, "copy"),
      recallSkill = firstSkillByEffect(c, "timeRecall");
    const u = {
      uid,
      entityId: uid,
      card: id,
      name: c.name,
      deckSlotId: null,
      plusStar: false,
      hp: c.maxHp,
      maxHp: c.maxHp,
      shield: c.shield || 0,
      baseDefense,
      defenseMod: 0,
      defense: baseDefense,
      attackMod: 0,
      energy: [],
      beastEnergy: [],
      riderEnergy: [],
      dualInitialized: false,
      everDeployed: false,
      speedDelayTurns: 0,
      eclipseEligible: true,
      statuses: {},
      skillSeals: {},
      hideHits: 0,
      hpProtectionBarriers: [],
      barrierTurnEpoch: 0,
      queuedHeals: [],
      sequence: null,
      scheduledAction: null,
      damageTransfer: null,
      fireWingUntil: null,
      fullInvulnerableUntilOwnTurn: false,
      queuedSkillCostReduction: 0,
      turnSkillCostReduction: 0,
      yggThresholdArmed: !!c.thresholdEnergy,
      firstGuardUsesRemaining: openingGuardSkill ? 1 : 0,
      usedOnce: {},
      dead: false,
      lastAction: null,
      lastTarget: null,
      lastSkill: null,
      lastAttackDamage: 0,
      turns: 0,
      damageDealt: 0,
      damageTaken: 0,
      healingDealt: 0,
      healingTaken: 0,
      skillUses: 0,
      statusScore: 0,
      reflectDealt: 0,
      shieldAbsorbed: 0,
      energyDisrupt: 0,
      switches: 0
    };
    if (strikeSkill) {
      u.strikeSingleColor = null;
      u.strikeUses = 0;
    }
    if (copySkill) {
      u.memoryStrikeSingleColor = null;
      u.memoryStrikeUses = 0;
      u.memoryUsed = false;
      u.memoryUses = 0;
    }
    if (c.timeControl) {
      u.timeHourDeg = 0;
      u.timeMinuteDeg = 90;
      u.timeRecallHistory = [];
      if (recallSkill) u.usedOnce[recallSkill.id] = false;
    }
    {
      __result = u;
      break __makeUnitCore;
    }
  }
  const unit = __result;
  if (unit) {
    unit.entityId ||= unit.uid || uid;
    unit.uid ||= unit.entityId;
    if (typeof state_runtime_entities.EnergyEngine !== "undefined") state_runtime_entities.EnergyEngine.ensureStore(unit);
  }
  return unit;
}
export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

/* R41 공통 카드/기술 질의 계층.
   신규 기믹은 카드마다 파생 필드를 추가하지 않고 이 계층에 원본 데이터를 질문한다. */
export function runtimeCardDefinitions() {
  return [...state_catalog_cards.CARDS, ...state_engine_entities.EXTRA_RUNTIME_SKILL_CONTAINERS.flatMap(x => Array.isArray(x) ? x : Object.values(x || {}))];
}
export function syncCardRegistry() {
  const defs = runtimeCardDefinitions();
  const signature = defs.map(c => c?.id || "").join("|");
  if (signature === state_engine_entities.CARD_REGISTRY_SIGNATURE && state_engine_entities.CARD_REGISTRY.size === defs.filter(Boolean).length) return;
  state_engine_entities.CARD_REGISTRY.clear();
  for (const def of defs) {
    if (!def?.id) continue;
    if (state_engine_entities.CARD_REGISTRY.has(def.id)) console.error(`[R41] duplicate card id: ${def.id}`);
    state_engine_entities.CARD_REGISTRY.set(def.id, def);
  }
  state_engine_entities.CARD_REGISTRY_SIGNATURE = signature;
}
export function card(u) {
  const raidCard = raidCardForUnit(u);
  if (raidCard) return raidCard;
  syncCardRegistry();
  const id = typeof u === "string" ? u : u?.card ?? u?.id;
  return state_engine_entities.CARD_REGISTRY.get(id) || state_engine_entities.UNKNOWN_CARD;
}
export function skillsOf(ref) {
  const def = card(ref);
  return Array.isArray(def?.skills) ? def.skills : [];
}
export function skillOf(ref, skillRef) {
  if (skillRef && typeof skillRef === "object" && skillRef.id) return skillRef;
  const id = typeof skillRef === "string" ? skillRef : skillRef?.id;
  return skillsOf(ref).find(skill => skill.id === id) || null;
}
export function firstSkillOf(ref) {
  return skillsOf(ref)[0] || null;
}
export function cardHasTag(ref, tag) {
  return skillsafeArray(card(ref)?.tags).includes(tag);
}
export function skillHasTag(ref, skillRef, tag) {
  return skillsafeArray(skillOf(ref, skillRef)?.tags).includes(tag);
}
/* Skill semantics are resolved from card data, never from hard-coded skill ids. */
export function registerRuntimeSkillContainer(container) {
  if (container && !state_engine_entities.EXTRA_RUNTIME_SKILL_CONTAINERS.includes(container)) state_engine_entities.EXTRA_RUNTIME_SKILL_CONTAINERS.push(container);
  state_engine_entities.CARD_REGISTRY_SIGNATURE = "";
  state_engine_entities.RUNTIME_SKILL_INDEX_SIGNATURE = "";
  return container;
}
export function syncRuntimeSkillIndex() {
  syncCardRegistry();
  const containers = [...state_catalog_cards.CARDS, ...state_engine_entities.EXTRA_RUNTIME_SKILL_CONTAINERS.flatMap(x => Array.isArray(x) ? x : Object.values(x || {}))];
  const signature = containers.map(def => `${def?.id || "?"}:${(def?.skills || []).map(sk => sk?.id || "").join(",")}`).join("|");
  if (signature === state_engine_entities.RUNTIME_SKILL_INDEX_SIGNATURE) return;
  state_engine_entities.RUNTIME_SKILL_INDEX.clear();
  for (const def of containers) for (const sk of skillsafeArray(def?.skills)) {
    if (!sk?.id) continue;
    if (!state_engine_entities.RUNTIME_SKILL_INDEX.has(sk.id)) state_engine_entities.RUNTIME_SKILL_INDEX.set(sk.id, []);
    state_engine_entities.RUNTIME_SKILL_INDEX.get(sk.id).push(sk);
  }
  state_engine_entities.RUNTIME_SKILL_INDEX_SIGNATURE = signature;
}
export function runtimeSkillDefs(skillRef) {
  if (skillRef && typeof skillRef === "object" && skillRef.id) return [skillRef];
  syncRuntimeSkillIndex();
  const id = typeof skillRef === "string" ? skillRef : skillRef?.id;
  return id ? state_engine_entities.RUNTIME_SKILL_INDEX.get(id) || [] : [];
}
export function skillDefHasEffect(skill, effectType) {
  return !!skill && skillsafeArray(skill.effects).some(effect => effect?.type === effectType);
}
export function skillRefHasEffect(skillRef, effectType) {
  return runtimeSkillDefs(skillRef).some(skill => skillDefHasEffect(skill, effectType));
}
export function actionSkillHasEffect(action, effectType) {
  return !!action && skillRefHasEffect(action.skill, effectType);
}
export function skillDefHasTag(skill, tag) {
  return !!skill && skillsafeArray(skill.tags).includes(tag);
}
export function skillRefHasTag(skillRef, tag) {
  return runtimeSkillDefs(skillRef).some(skill => skillDefHasTag(skill, tag));
}
export function actionSkillHasTag(action, tag) {
  return !!action && skillRefHasTag(action.skill, tag);
}
export function skillDefHasRuntimeKind(skill, kind) {
  return !!skill && skill.runtimeKind === kind;
}
export function skillRefHasRuntimeKind(skillRef, kind) {
  return runtimeSkillDefs(skillRef).some(skill => skillDefHasRuntimeKind(skill, kind));
}
export function actionSkillHasRuntimeKind(action, kind) {
  return !!action && skillRefHasRuntimeKind(action.skill, kind);
}
export function firstSkillByEffect(ref, effectType) {
  return skillsOf(ref).find(skill => skillDefHasEffect(skill, effectType)) || null;
}
export function firstSkillByTag(ref, tag) {
  return skillsOf(ref).find(skill => skillDefHasTag(skill, tag)) || null;
}
export function firstSkillByRuntimeKind(ref, kind) {
  return skillsOf(ref).find(skill => skillDefHasRuntimeKind(skill, kind)) || null;
}
export function firstRuntimeSkillByEffect(effectType) {
  syncRuntimeSkillIndex();
  for (const defs of state_engine_entities.RUNTIME_SKILL_INDEX.values()) for (const skill of defs) if (skillDefHasEffect(skill, effectType)) return skill;
  return null;
}
export function firstRuntimeSkillByTag(tag) {
  syncRuntimeSkillIndex();
  for (const defs of state_engine_entities.RUNTIME_SKILL_INDEX.values()) for (const skill of defs) if (skillDefHasTag(skill, tag)) return skill;
  return null;
}
export function skillIdByEffect(ref, effectType) {
  return firstSkillByEffect(ref, effectType)?.id || null;
}
export function skillIdByTag(ref, tag) {
  return firstSkillByTag(ref, tag)?.id || null;
}
export function skillIdByEffectGlobal(effectType) {
  return firstRuntimeSkillByEffect(effectType)?.id || null;
}
export function skillIdByTagGlobal(tag) {
  return firstRuntimeSkillByTag(tag)?.id || null;
}
export function skillsafeArray(value) {
  return Array.isArray(value) ? value : [];
}
/* R49 DATA-DRIVEN CHARACTER CONTRACT
   Runtime owners query declarative card capabilities; they must not need character ids.
   Character ids belong in card data / assets / tests, not combat-rule branches. */
export function cardCapability(ref, key, fallback = null) {
  const def = card(ref);
  return def && Object.prototype.hasOwnProperty.call(def, key) ? def[key] : fallback;
}
export function cardHasCapability(ref, key) {
  return !!cardCapability(ref, key, false);
}
export function resolveSkillTargets(g, t, s, u, skillRef, options = {}) {
  const skill = skillOf(u, skillRef);
  if (!skill || !g?.teams?.[t]) return [];
  const own = (g.teams[t].field || []).map((x, i) => x && !x.dead ? {
    team: t,
    slot: i,
    uid: x.uid
  } : null).filter(Boolean);
  const enemyTeam = other(t);
  const enemies = (g.teams[enemyTeam]?.field || []).map((x, i) => x && !x.dead ? {
    team: enemyTeam,
    slot: i,
    uid: x.uid
  } : null).filter(Boolean);
  const effectiveTarget = effectiveSkillTarget(u, skill);
  if (effectiveTarget === "enemyField") return enemies;
  switch (effectiveTarget) {
    case "self":
    case "field":
      return [{
        team: t,
        slot: s,
        uid: u.uid
      }];
    case "ally":
      return own;
    case "allyOtherAny":
      return own.filter(x => x.uid !== u.uid);
    case "allyOther":
      {
        let refs = own.filter(x => x.uid !== u.uid);
        if ((skill.effects || []).some(e => e.type === "transferPaidEnergy")) refs = refs.filter(ref => totalEnergy(unitAt(g, ref.team, ref.slot)) <= (card(unitAt(g, ref.team, ref.slot)).maxEnergy || 4) - 1 + 1e-6);
        return refs;
      }
    case "anyCharacter":
      return [...own, ...enemies];
    case "lowestEnergyEnemy":
      {
        if (!enemies.length) return [];
        const min = Math.min(...enemies.map(ref => allEnergy(unitAt(g, ref.team, ref.slot))));
        return enemies.filter(ref => Math.abs(allEnergy(unitAt(g, ref.team, ref.slot)) - min) < 1e-6);
      }
    case "enemySlot":
      return (g.teams[enemyTeam]?.field || []).map((x, i) => ({
        team: enemyTeam,
        slot: i,
        uid: x?.uid || null
      }));
    case "enemyHealAlly":
    case "enemy":
      return enemies;
    default:
      return options.defaultEnemy ? enemies : [];
  }
}
export function resolvePlusStarChoice(choice, deck, team = "P") {
  const ids = Array.isArray(deck) ? deck : [];
  if (choice == null) return null;
  let index = -1,
    claimedCard = null;
  if (typeof choice === "object") {
    claimedCard = typeof choice.cardId === "string" ? choice.cardId : null;
    if (Number.isInteger(Number(choice.slotIndex))) index = Number(choice.slotIndex);else if (Number.isInteger(Number(choice.index))) index = Number(choice.index);else if (typeof choice.slotId === "string" && /:-?\d+$/.test(choice.slotId)) index = Number(choice.slotId.split(":").pop());
  } else if (typeof choice === "number" || /^\d+$/.test(String(choice))) index = Number(choice);else if (typeof choice === "string" && /:-?\d+$/.test(choice)) index = Number(choice.split(":").pop());else if (typeof choice === "string") {
    claimedCard = choice;
    index = ids.indexOf(choice);
  }
  if (!Number.isInteger(index) || index < 0 || index >= ids.length) return null;
  const cardId = ids[index];
  if (claimedCard && claimedCard !== cardId) return null;
  if (!state_catalog_cards.PLUS_STAR_ELIGIBLE.has(cardId)) return null;
  return {
    slotId: `${team}:${index}`,
    slotIndex: index,
    cardId
  };
}
export function resolvePlusStarChoices(choice, deck, team = "P") {
  const requested = Array.isArray(choice) ? choice : [choice];
  const bySlot = new Map();
  for (const entry of requested) {
    const resolved = resolvePlusStarChoice(entry, deck, team);
    if (resolved && !bySlot.has(resolved.slotId)) bySlot.set(resolved.slotId, resolved);
  }
  return [...bySlot.values()];
}
export function isPlusStarChoiceForCard(choice, deck, cardId, team = "P") {
  return resolvePlusStarChoices(choice, deck, team).some(resolved => resolved.cardId === cardId);
}
export function newGame(pDeck, aDeck, opt = {}) {
  const old = typeof state_runtime_config.currentGame === "function" ? state_runtime_config.currentGame() : null;
  if (typeof state_runtime_state.StateFactory !== "undefined" && old?.battleId) {
    TimerManager.clearScope(old.battleId);
    state_runtime_input.InputLockManager.releaseBattle(old.battleId);
    state_runtime_transactions.ActionTransactionManager.clearBattle(old.battleId);
  }
  let __result;
  __newGameCore: {
    let n = 0,
      plusChoice = opt.plusStar || {},
      resolvedPlus = {
        P: resolvePlusStarChoices(plusChoice?.P, pDeck, "P"),
        A: resolvePlusStarChoices(plusChoice?.A, aDeck, "A")
      },
      unit = (id, team, index) => {
        const value = makeUnit(id, `u${n++}`),
          slotId = `${team}:${index}`;
        value.deckSlotId = slotId;
        const choices = resolvedPlus[team];
        value.plusStar = state_catalog_cards.PLUS_STAR_ELIGIBLE.has(id) && choices.some(choice => choice.slotId === slotId && choice.cardId === id);
        value.name = state_catalog_cards.EffectiveCardPresentationOwner.resolve(value, value, {
          surface: "battle-initialization",
          sourceRevision: 0
        }).displayName;
        return value;
      },
      p = pDeck.map((id, index) => unit(id, "P", index)),
      a = aDeck.map((id, index) => unit(id, "A", index)),
      league = state_ui_deck.LeagueFormatOwner.normalizeLeague(opt.league || state_ui_deck.LeagueFormatOwner.inferLeague(pDeck)),
      leagueCompositions = state_ui_deck.LeagueFormatOwner.normalizeTeamCompositions(league, opt.leagueCompositions || opt.leagueComposition || null, {
        P: pDeck,
        A: aDeck
      }, plusChoice),
      leagueComposition = leagueCompositions.P,
      seed = String(opt.seed || Date.now()),
      g = {
        teams: {
          P: {
            field: [p[0], p[1]],
            bench: [p[2], p[3]],
            graveyard: [],
            traps: [null, null],
            switchUses: 0,
            plusStarSlotIds: p.filter(x => x.plusStar).map(x => x.deckSlotId),
            plusStarSlotId: p.find(x => x.plusStar)?.deckSlotId || null
          },
          A: {
            field: [a[0], a[1]],
            bench: [a[2], a[3]],
            graveyard: [],
            traps: [null, null],
            switchUses: 0,
            plusStarSlotIds: a.filter(x => x.plusStar).map(x => x.deckSlotId),
            plusStarSlotId: a.find(x => x.plusStar)?.deckSlotId || null
          }
        },
        revealed: {
          P: [p[0]?.uid, p[1]?.uid].filter(Boolean),
          A: [a[0]?.uid, a[1]?.uid].filter(Boolean)
        },
        publicHistory: [],
        order: [["P", 0], ["A", 0], ["P", 1], ["A", 1]],
        turn: 0,
        round: 1,
        turnSerial: 0,
        scheduledActionSerial: 0,
        consumedScheduledActionIds: [],
        preparedKey: null,
        dualActorController: null,
        fieldEffect: null,
        pendingTraitChoices: [],
        winner: null,
        paused: false,
        variance: opt.variance !== false,
        difficulty: opt.difficulty || "normal",
        mode: opt.mode || "human",
        league,
        leagueComposition,
        leagueCompositions,
        matchType: state_ui_deck.LeagueFormatOwner.definition(league).label,
        seed,
        matchId: opt.matchId || `${seed}-${Date.now()}-${n}`,
        rng: new RNG(seed),
        logs: [],
        pending: null,
        lastDamageTotal: 0,
        noDamageTurns: 0,
        stats: {
          turns: 0
        }
      };
    for (const t of ["P", "A"]) g.teams[t].field.forEach(u => initializeDeployment(g, u));

    // Canonical per-battle feature state: initialized once at construction, not by stacked wrappers.
    for (const t of ["P", "A"]) {
      g.teams[t].summons ||= [];
      g.teams[t].deathSerial ||= 0;
      g.teams[t].pendingElixianResonance ||= [false, false];
    }
    g.circuitChain = null;
    g.pendingSummonTurns ||= [];
    if (opt?.firstTeam === "A") g.order = [["A", 0], ["P", 0], ["A", 1], ["P", 1]];else if (opt?.firstTeam === "P") g.order = [["P", 0], ["A", 0], ["P", 1], ["A", 1]];
    if (opt?.onlineCoin) g.onlineCoin = clone(opt.onlineCoin);
    syncAromaCombatFlags(g);
    for (const u of allReactiveEnergyUnits(g)) {
      const rule = reactiveEnergyRule(u);
      if (!rule) continue;
      initReactiveEnergyUnit(u);
      u[reactiveEnergyObservedKey(u, rule)] = reactiveEnergyAmount(u, rule);
      syncReactiveEnergyMaxHp(g, u, "전투 시작", false);
    }
    {
      __result = g;
      break __newGameCore;
    }
  }
  const g = __result;
  if (typeof state_runtime_state.StateFactory !== "undefined" && g) {
    state_runtime_state.StateFactory.decorate(g, opt);
    state_runtime_entities.BattleEventEngine.emit(g, "BATTLE_CREATED", {
      payload: {
        mode: g.mode,
        league: g.league,
        decks: g.decks
      }
    });
  }
  return g;
}

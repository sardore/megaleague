// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_ui_deck = {
  ONLINE_COMMON_RULES: undefined,
  LeagueFormatOwner: undefined,
  leagueSelection: undefined,
  comprehensiveComposition: undefined,
  irumaForm: undefined,
  bkenoForm: undefined,
  horizonForm: undefined,
  plusStarSelection: undefined,
  onlineSide: undefined,
  p2p: undefined,
  shownPvpResults: undefined,
  shownEndResults: undefined,
  bgm: undefined,
  BGM_AUDIO_SRC: undefined,
  MEGA_SETUP_IDS: undefined
};
import { state_catalog_cards } from "../catalog/cards.js";
import { card, resolvePlusStarChoice, syncCardRegistry, state_engine_entities } from "../engine/entities.js";
import { ensureGameSfx, state_presentation_audio } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "./battle-state.js";
import { renderSetup } from "./setup.js";
export function initializeUiDeck() {
  state_ui_deck.ONLINE_COMMON_RULES = Object.freeze({
    variance: false,
    difficulty: "normal"
  });
  state_ui_deck.LeagueFormatOwner = Object.freeze({
    definitions: Object.freeze({
      two: Object.freeze({
        id: "two",
        label: "2☆ 컵",
        shortRule: "2☆ 4장",
        accent: "green",
        requirements: Object.freeze({
          "2☆": 4
        })
      }),
      regular: Object.freeze({
        id: "regular",
        label: "정규리그",
        shortRule: "2☆ ×2 · 3☆ ×2",
        accent: "yellow",
        requirements: Object.freeze({
          "2☆": 2,
          "3☆": 2
        })
      }),
      comprehensive: Object.freeze({
        id: "comprehensive",
        label: "종합리그",
        shortRule: "선택한 등급 구성",
        accent: "orange",
        requirements: null
      }),
      mega: Object.freeze({
        id: "mega",
        label: "메가리그",
        shortRule: "등급 제한 없음",
        accent: "purple",
        requirements: null
      }),
      duel: Object.freeze({
        id: "duel",
        label: "싱글 리그",
        shortRule: "등급 무제한 · 3마리",
        accent: "gray",
        requirements: null
      })
    }),
    comprehensivePatterns: Object.freeze({
      "2234": Object.freeze({
        id: "2234",
        label: "2☆ ×2 + 3☆ + 4☆",
        requirements: Object.freeze({
          "2☆": 2,
          "3☆": 1,
          "4☆": 1
        })
      }),
      "2335": Object.freeze({
        id: "2335",
        label: "2☆ + 3☆ + 3.5☆ ×2",
        requirements: Object.freeze({
          "2☆": 1,
          "3☆": 1,
          "3.5☆": 2
        })
      })
    }),
    normalizeLeague(mode) {
      return this.definitions[mode] ? mode : "mega";
    },
    /* 등급 제한이 없는 리그(메가·싱글)과 리그별 덱 장수. 싱글은 필드 1 + 후열 2 = 3마리. */
    free(mode) {
      mode = this.normalizeLeague(mode);
      return mode === "mega" || mode === "duel";
    },
    deckSize(mode) {
      return this.normalizeLeague(mode) === "duel" ? 3 : 4;
    },
    normalizeComposition(value) {
      return this.comprehensivePatterns[value] ? value : "2234";
    },
    definition(mode) {
      return this.definitions[this.normalizeLeague(mode)];
    },
    pattern(mode, composition = state_ui_deck.comprehensiveComposition) {
      mode = this.normalizeLeague(mode);
      if (this.free(mode)) return null;
      if (mode === "comprehensive") return this.comprehensivePatterns[this.normalizeComposition(composition)];
      return Object.freeze({
        id: mode,
        label: this.definitions[mode].shortRule,
        requirements: this.definitions[mode].requirements
      });
    },
    requirements(mode, composition = state_ui_deck.comprehensiveComposition) {
      return this.pattern(mode, composition)?.requirements || null;
    },
    allowedGrades(mode, composition = state_ui_deck.comprehensiveComposition) {
      const req = this.requirements(mode, composition);
      return req ? new Set(Object.keys(req)) : new Set(state_catalog_cards.CARDS.map(c => c.grade));
    },
    cardAllowed(cardRef, mode = state_ui_deck.leagueSelection, composition = state_ui_deck.comprehensiveComposition) {
      const c = typeof cardRef === "string" ? state_catalog_cards.CARDS.find(x => x.id === cardRef) : cardRef;
      return !!c && (this.free(mode) || this.allowedGrades(mode, composition).has(c.grade));
    },
    identityValid(ids) {
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length) return false;
      const groups = ids.map(id => state_catalog_cards.CARDS.find(c => c.id === id)?.formGroup).filter(Boolean);
      if (new Set(groups).size !== groups.length) return false;
      let invaders = 0;
      for (const id of ids) {
        const c = state_catalog_cards.CARDS.find(x => x.id === id);
        if (!c) return false;
        if (c.tags?.includes("transdimensional-invader") && ++invaders > 1) return false;
      }
      return true;
    },
    effectiveGrade(id, ids = [], plusStarChoice = null, team = "P") {
      const def = state_catalog_cards.CARDS.find(c => c.id === id);
      if (!def) return null;
      const index = Array.isArray(ids) ? ids.indexOf(id) : -1;
      const resolved = index >= 0 ? resolvePlusStarChoice(plusStarChoice, ids, team) : null;
      if (!resolved || resolved.slotIndex !== index || resolved.cardId !== id) return def.grade;
      const n = Number.parseFloat(String(def.grade || ""));
      return Number.isFinite(n) ? `${n + 0.5}☆` : def.grade;
    },
    counts(ids, plusStarChoice = null, team = "P") {
      const out = Object.create(null);
      const deck = Array.isArray(ids) ? ids : [];
      for (const id of deck) {
        const grade = this.effectiveGrade(id, deck, plusStarChoice, team);
        if (grade) out[grade] = (out[grade] || 0) + 1;
      }
      return out;
    },
    partialValid(ids, mode = state_ui_deck.leagueSelection, composition = state_ui_deck.comprehensiveComposition, plusStarChoice = null, team = "P") {
      if (!this.identityValid(ids) || ids.length > this.deckSize(mode)) return false;
      mode = this.normalizeLeague(mode);
      if (this.free(mode)) return true;
      const req = this.requirements(mode, composition),
        counts = this.counts(ids, plusStarChoice, team);
      for (const [grade, n] of Object.entries(counts)) if (!(grade in req) || n > req[grade]) return false;
      return true;
    },
    completeValid(ids, mode = state_ui_deck.leagueSelection, composition = state_ui_deck.comprehensiveComposition, plusStarChoice = null, team = "P") {
      if (!Array.isArray(ids) || ids.length !== this.deckSize(mode) || !this.partialValid(ids, mode, composition, plusStarChoice, team)) return false;
      if (this.free(mode)) return true;
      const req = this.requirements(mode, composition),
        counts = this.counts(ids, plusStarChoice, team);
      return Object.entries(req).every(([grade, n]) => (counts[grade] || 0) === n);
    },
    inferLeague(ids) {
      if (this.completeValid(ids, "two", "2234")) return "two";
      if (this.completeValid(ids, "regular", "2234")) return "regular";
      if (this.completeValid(ids, "comprehensive", "2234") || this.completeValid(ids, "comprehensive", "2335")) return "comprehensive";
      return "mega";
    },
    inferComposition(ids, plusStarChoice = null, team = "P") {
      return this.completeValid(ids, "comprehensive", "2335", plusStarChoice, team) ? "2335" : "2234";
    },
    normalizeTeamCompositions(mode, input = null, decks = {}, plusStar = {}) {
      if (this.normalizeLeague(mode) !== "comprehensive") return Object.freeze({
        P: null,
        A: null
      });
      const source = input && typeof input === "object" ? input : {
        P: input,
        A: input
      };
      const resolve = team => {
        const requested = String(source?.[team] || "").trim();
        if (this.comprehensivePatterns[requested]) return requested;
        return this.inferComposition(decks?.[team] || [], plusStar?.[team] || null, team);
      };
      return Object.freeze({
        P: resolve("P"),
        A: resolve("A")
      });
    },
    progressText(ids, mode = state_ui_deck.leagueSelection, composition = state_ui_deck.comprehensiveComposition, plusStarChoice = null, team = "P") {
      mode = this.normalizeLeague(mode);
      if (this.free(mode)) return `${ids.length}/${this.deckSize(mode)} · 자유 편성`;
      const req = this.requirements(mode, composition),
        counts = this.counts(ids, plusStarChoice, team);
      return Object.entries(req).map(([grade, n]) => `${grade} ${counts[grade] || 0}/${n}`).join(" · ");
    },
    eligibleForms(group, deck = state_ui_battle_state.selected, mode = state_ui_deck.leagueSelection, composition = state_ui_deck.comprehensiveComposition, plusStarChoice = null, team = "P") {
      if (!group) return [];
      const family = state_catalog_cards.FormFamilyOwner.members(group);
      const index = (deck || []).findIndex(id => state_catalog_cards.CARDS.find(c => c.id === id)?.formGroup === group);
      return family.filter(id => {
        if (!this.cardAllowed(id, mode, composition)) return false;
        if (index < 0) return true;
        const next = [...deck];
        next[index] = id;
        return this.partialValid(next, mode, composition, plusStarChoice, team);
      });
    },
    setupPool(mode = state_ui_deck.leagueSelection, composition = state_ui_deck.comprehensiveComposition, deck = state_ui_battle_state.selected, plusStarChoice = null, team = "P") {
      const entries = [],
        seenGroups = new Set();
      const pushEntry = (id, orderId = id) => {
        const sourceIndex = state_catalog_cards.CARDS.findIndex(card => card.id === orderId);
        const orderCard = sourceIndex >= 0 ? state_catalog_cards.CARDS[sourceIndex] : state_catalog_cards.CARDS.find(card => card.id === id);
        entries.push({
          id,
          orderGrade: Number.parseFloat(String(orderCard?.grade || "0")),
          sourceIndex: sourceIndex >= 0 ? sourceIndex : Number.MAX_SAFE_INTEGER
        });
      };
      for (const c of state_catalog_cards.CARDS) {
        if (c.tags?.includes("transdimensional-invader")) continue;
        if (c.formGroup) {
          if (seenGroups.has(c.formGroup)) continue;
          seenGroups.add(c.formGroup);
          const legal = this.eligibleForms(c.formGroup, deck, mode, composition, plusStarChoice, team);
          if (!legal.length) continue;
          const current = setupFormState(c.formGroup),
            shown = legal.includes(current) ? current : legal[0];
          // A form family owns one composition slot. Its visible form may change rarity,
          // but its placement is ordered by the first form legal in the current format.
          pushEntry(shown, legal[0]);
        } else if (this.cardAllowed(c, mode, composition)) pushEntry(c.id);
      }
      return entries.sort((left, right) => right.orderGrade - left.orderGrade || left.sourceIndex - right.sourceIndex).map(entry => entry.id);
    },
    allPool(mode = state_ui_deck.leagueSelection, composition = state_ui_deck.comprehensiveComposition) {
      return state_catalog_cards.CARDS.filter(c => this.cardAllowed(c, mode, composition)).map(c => c.id);
    },
    invaderAllowed(mode = state_ui_deck.leagueSelection, composition = state_ui_deck.comprehensiveComposition) {
      return state_catalog_cards.CARDS.some(c => c.tags?.includes("transdimensional-invader") && this.cardAllowed(c, mode, composition));
    },
    rulesText(mode = state_ui_deck.leagueSelection, composition = state_ui_deck.comprehensiveComposition) {
      mode = this.normalizeLeague(mode);
      if (mode === "two") return "2☆ 캐릭터만 4장 선택";
      if (mode === "regular") return "2☆ 2장 + 3☆ 2장";
      if (mode === "comprehensive") return `종합 구성 · ${this.pattern(mode, composition).label}`;
      if (mode === "duel") return "전체 등급 자유 편성 · 3마리 (필드 1 + 후열 2)";
      return "전체 등급 자유 편성";
    }
  });
  state_ui_deck.leagueSelection = "mega";
  state_ui_deck.comprehensiveComposition = "2234";
  state_ui_deck.irumaForm = "iruma";
  state_ui_deck.bkenoForm = "bkeno";
  state_ui_deck.horizonForm = "flameflower";
  state_ui_deck.plusStarSelection = null;
  state_ui_deck.onlineSide = "P";
  state_ui_deck.p2p = {
    peer: null,
    conn: null,
    role: null,
    connected: false,
    remoteDeck: null,
    remotePlusStar: null,
    localComposition: null,
    remoteComposition: null,
    roomCode: "",
    rules: null
  };
  state_ui_deck.shownPvpResults = new WeakSet();
  state_ui_deck.shownEndResults = new WeakSet();
  state_ui_deck.bgm = {
    audio: null,
    started: false
  };
  state_ui_deck.BGM_AUDIO_SRC = "assets/media/27a2c0a4c8739c864484.mp3";
  // game-sfx-unlock
  document.addEventListener("pointerdown", () => {
    ensureGameSfx();
    if (bgmBattleActive() && (!state_ui_deck.bgm.audio || state_ui_deck.bgm.audio.paused || state_ui_deck.bgm.needsGesture)) startBgm();
  }, {
    passive: true,
    capture: true
  });
  document.addEventListener("keydown", () => {
    if (bgmBattleActive() && (!state_ui_deck.bgm.audio || state_ui_deck.bgm.audio.paused || state_ui_deck.bgm.needsGesture)) startBgm();
  }, {
    passive: true,
    capture: true
  });
  document.addEventListener("click", event => {
    const button = event.target.closest?.("button");
    if (button && !button.disabled) state_presentation_audio.PresentationAudioOwner.play("ui");
  }, {
    passive: true
  });
  state_ui_deck.MEGA_SETUP_IDS = state_catalog_cards.MEGA_IDS.filter(id => {
    const def = card(id);
    if (!def.formGroup) return true;
    const family = state_catalog_cards.FormFamilyOwner.members(def.formGroup);
    return family[0] === id;
  });
}
export function ensureBgmAudio() {
  if (state_ui_deck.bgm.audio) return true;
  try {
    const audio = new Audio();
    audio.src = state_ui_deck.BGM_AUDIO_SRC;
    audio.preload = "auto";
    audio.loop = true;
    audio.playsInline = true;
    audio.setAttribute?.("playsinline", "");
    audio.setAttribute?.("webkit-playsinline", "");
    audio.addEventListener("error", () => {
      console.warn("BGM 오디오를 불러오지 못했습니다.");
    });
    state_ui_deck.bgm.audio = audio;
    updateBgmVolume();
    audio.load?.();
    return true;
  } catch (err) {
    console.warn("BGM 초기화 실패", err);
    return false;
  }
}
export function updateBgmVolume() {
  if (state_ui_deck.bgm.audio) state_ui_deck.bgm.audio.volume = 1;
}
export function bgmBattleActive() {
  const battleScreen = state_ui_battle_state.$("#game");
  return !!(state_ui_battle_state.game && battleScreen?.classList.contains("active") && !state_ui_battle_state.game.paused && !state_ui_battle_state.game.winner);
}
export function startBgm() {
  if (!bgmBattleActive()) {
    if (state_ui_deck.bgm.audio && !state_ui_deck.bgm.audio.paused) state_ui_deck.bgm.audio.pause();
    state_ui_deck.bgm.started = false;
    return Promise.resolve(false);
  }
  if (!ensureBgmAudio()) return Promise.resolve(false);
  updateBgmVolume();
  let playPromise;
  try {
    playPromise = state_ui_deck.bgm.audio.play();
  } catch (_) {
    state_ui_deck.bgm.started = false;
    state_ui_deck.bgm.needsGesture = true;
    return Promise.resolve(false);
  }
  return Promise.resolve(playPromise).then(() => {
    state_ui_deck.bgm.started = true;
    state_ui_deck.bgm.needsGesture = false;
    return true;
  }).catch(() => {
    // 모바일 브라우저가 자동재생을 막은 경우 다음 실제 입력에서 즉시 다시 시도한다.
    state_ui_deck.bgm.started = false;
    state_ui_deck.bgm.needsGesture = true;
    return false;
  });
}
export function stopBgm() {
  if (state_ui_deck.bgm.audio) state_ui_deck.bgm.audio.pause();
  state_ui_deck.bgm.started = false;
}
export function refreshLeaguePoolsFromCardData() {
  const mega = state_catalog_cards.CARDS.filter(c => c.league === "mega").map(c => c.id);
  state_catalog_cards.MEGA_IDS.splice(0, state_catalog_cards.MEGA_IDS.length, ...mega);
  const setup = mega.filter(id => {
    const def = card(id);
    if (!def.formGroup) return true;
    const family = state_catalog_cards.FormFamilyOwner.members(def.formGroup);
    return family[0] === id;
  });
  state_ui_deck.MEGA_SETUP_IDS.splice(0, state_ui_deck.MEGA_SETUP_IDS.length, ...setup);
}
export function registerCardDefinition(def) {
  if (!def?.id) throw new Error("card definition requires id");
  const existing = state_catalog_cards.CARDS.find(c => c.id === def.id);
  if (!existing) state_catalog_cards.CARDS.push(def);
  state_engine_entities.CARD_REGISTRY_SIGNATURE = "";
  syncCardRegistry();
  refreshLeaguePoolsFromCardData();
  return existing || def;
}
export function setupFormState(group) {
  if (group === "iruma") return state_ui_deck.irumaForm;
  if (group === "brkeno") return state_ui_deck.bkenoForm;
  if (group === "horizon") return state_ui_deck.horizonForm;
  return null;
}
export function setSetupFormState(group, id) {
  if (group === "iruma") state_ui_deck.irumaForm = id;else if (group === "brkeno") state_ui_deck.bkenoForm = id;else if (group === "horizon") state_ui_deck.horizonForm = id;
}
export function setupCardId(id) {
  const group = state_catalog_cards.CARDS.find(c => c.id === id)?.formGroup;
  return setupFormState(group) || id;
}
export function otherFormId(id) {
  return state_catalog_cards.FormFamilyOwner.next(id);
}
export function nextLeagueFormId(group, current, deck = state_ui_battle_state.selected, mode = state_ui_deck.leagueSelection, composition = state_ui_deck.comprehensiveComposition, plusStarChoice = state_ui_deck.plusStarSelection, team = "P") {
  const legal = state_ui_deck.LeagueFormatOwner.eligibleForms(group, deck, mode, composition, plusStarChoice, team);
  if (!legal.length) return null;
  const index = Math.max(0, legal.indexOf(current));
  return legal[(index + 1) % legal.length];
}
export function normalizeSetupFormsForLeague() {
  for (const group of state_catalog_cards.FormFamilyOwner.groups()) {
    const legal = state_ui_deck.LeagueFormatOwner.eligibleForms(group, [], state_ui_deck.leagueSelection, state_ui_deck.comprehensiveComposition);
    if (legal.length && !legal.includes(setupFormState(group))) setSetupFormState(group, legal[0]);
  }
}
export function poolForLeague(mode = state_ui_deck.leagueSelection, composition = state_ui_deck.comprehensiveComposition) {
  return state_ui_deck.LeagueFormatOwner.allPool(mode, composition);
}
export function leagueBannerMarkup(mode, className = "leagueTab") {
  mode = state_ui_deck.LeagueFormatOwner.normalizeLeague(mode);
  const rows = {
      two: {
        mark: "II",
        rule: "2☆ 캐릭터만으로 4장 편성",
        slots: ["2☆ ×4"]
      },
      regular: {
        mark: "R",
        rule: "2☆ 두 장 + 3☆ 두 장",
        slots: ["2☆ ×2", "3☆ ×2"]
      },
      comprehensive: {
        mark: "Σ",
        rule: "두 등급 구성 중 하나를 선택",
        slots: ["A · 2☆ ×2 + 3☆ + 4☆", "B · 2☆ + 3☆ + 3.5☆ ×2"]
      },
      mega: {
        mark: "M",
        rule: "전체 등급 자유 편성",
        slots: ["ALL RARITIES"]
      },
      duel: {
        mark: "S",
        rule: "등급 무제한, 3마리로 필드 1칸 승부",
        slots: ["ALL ×3"]
      }
    },
    row = rows[mode],
    def = state_ui_deck.LeagueFormatOwner.definition(mode),
    active = mode === state_ui_deck.leagueSelection;
  return `<button class="${className} league-banner ${mode}${active ? " active" : ""}" data-league="${mode}" aria-pressed="${active}"><span class="league-banner-top"><span class="league-mark">${row.mark}</span><span class="league-banner-name">${def.label}</span></span><span class="league-banner-rule">${row.rule}</span><span class="league-banner-slots">${row.slots.map(slot => `<span class="league-slot">${slot}</span>`).join("")}</span></button>`;
}
export function onlineLeagueEntryHTML() {
  const def = state_ui_deck.LeagueFormatOwner.definition(state_ui_deck.leagueSelection);
  const pattern = state_ui_deck.leagueSelection === "comprehensive" ? state_ui_deck.LeagueFormatOwner.pattern("comprehensive", state_ui_deck.comprehensiveComposition) : null;
  return `<div class="online-league-panel"><div class="online-league-panel-head"><b>온라인 리그</b><span>${def.label}${pattern ? ` · ${pattern.label}` : ""}</span></div><div class="online-league-chooser">${["two", "regular", "comprehensive", "mega"].map(mode => leagueBannerMarkup(mode, "onlineLeagueTab")).join("")}</div>${state_ui_deck.leagueSelection === "comprehensive" ? `<div class="comprehensive-pattern-picker online-composition-picker">${Object.values(state_ui_deck.LeagueFormatOwner.comprehensivePatterns).map(pattern => `<button class="composition-choice onlineCompositionChoice${pattern.id === state_ui_deck.comprehensiveComposition ? " active" : ""}" data-composition="${pattern.id}" aria-pressed="${pattern.id === state_ui_deck.comprehensiveComposition}"><span><strong>${pattern.id === "2234" ? "구성 A" : "구성 B"} · ${pattern.label}</strong><span>${pattern.id === "2234" ? "2☆ 기반 + 4☆ 핵심" : "3.5☆ 중심 균형 조합"}</span></span></button>`).join("")}</div>` : ""}</div>`;
}
export function bindOnlineLeagueEntryControls(root) {
  if (!root) return false;
  root.querySelectorAll(".onlineLeagueTab").forEach(button => {
    button.onclick = () => {
      const next = state_ui_deck.LeagueFormatOwner.normalizeLeague(button.dataset.league);
      if (next !== state_ui_deck.leagueSelection) setLeague(next, true);else syncLeagueSelectionSurface();
      systems.OnlineRuntime?.ui?.showEntry?.({
        source: "ONLINE_LEAGUE_CHANGED"
      });
    };
  });
  root.querySelectorAll(".onlineCompositionChoice").forEach(button => {
    button.onclick = () => {
      const next = state_ui_deck.LeagueFormatOwner.normalizeComposition(button.dataset.composition);
      if (next !== state_ui_deck.comprehensiveComposition) setComprehensiveComposition(next, true);else syncLeagueSelectionSurface();
      systems.OnlineRuntime?.ui?.showEntry?.({
        source: "ONLINE_COMPOSITION_CHANGED"
      });
    };
  });
  return true;
}
export function syncLeagueSelectionSurface() {
  const def = state_ui_deck.LeagueFormatOwner.definition(state_ui_deck.leagueSelection),
    summary = state_ui_battle_state.$("#leagueSelectionSummary"),
    picker = state_ui_battle_state.$("#comprehensivePatternPicker");
  if (picker) picker.hidden = state_ui_deck.leagueSelection !== "comprehensive";
  const runtimeState = String(systems.OnlineRuntime?.debug?.().state || "IDLE"),
    runtimeActive = !["IDLE", "CLOSED", "FAILED"].includes(runtimeState);
  state_ui_battle_state.$$(".leagueTab").forEach(button => {
    const active = button.dataset.league === state_ui_deck.leagueSelection;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    if (!runtimeActive) button.disabled = false;
  });
  if (!runtimeActive) {
    const leagueMode = state_ui_battle_state.$("#leagueMode");
    if (leagueMode) leagueMode.disabled = false;
    state_ui_battle_state.$$(".composition-choice").forEach(button => button.disabled = false);
  }
  state_ui_battle_state.$$(".composition-choice").forEach(button => {
    const active = button.dataset.composition === state_ui_deck.comprehensiveComposition;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (summary) {
    summary.classList.remove("two", "regular", "comprehensive", "mega", "duel");
    summary.classList.add(state_ui_deck.leagueSelection);
    summary.innerHTML = `<div><div class="league-summary-name">${def.label}</div><div class="league-summary-rule">${state_ui_deck.LeagueFormatOwner.rulesText(state_ui_deck.leagueSelection, state_ui_deck.comprehensiveComposition)}</div></div><div class="league-summary-progress">${state_ui_deck.LeagueFormatOwner.progressText(state_ui_battle_state.selected, state_ui_deck.leagueSelection, state_ui_deck.comprehensiveComposition, state_ui_deck.plusStarSelection, "P")}</div>`;
  }
  const onlineButton = state_ui_battle_state.$("#onlineBtn");
  if (onlineButton) {
    const short = {
      two: "2☆컵",
      regular: "정규",
      comprehensive: "종합",
      mega: "메가",
      duel: "싱글"
    }[state_ui_deck.leagueSelection] || def.label;
    onlineButton.textContent = `온라인 · ${short}`;
  }
}
export function setComprehensiveComposition(value, reset = true) {
  state_ui_deck.comprehensiveComposition = state_ui_deck.LeagueFormatOwner.normalizeComposition(value);
  if (state_ui_deck.leagueSelection !== "comprehensive") return syncLeagueSelectionSurface();
  normalizeSetupFormsForLeague();
  renderSetup(reset);
}
export function setLeague(mode, reset = true) {
  state_ui_deck.leagueSelection = state_ui_deck.LeagueFormatOwner.normalizeLeague(mode);
  state_ui_battle_state.$("#leagueMode").value = state_ui_deck.leagueSelection;
  normalizeSetupFormsForLeague();
  const def = state_ui_deck.LeagueFormatOwner.definition(state_ui_deck.leagueSelection);
  state_ui_battle_state.$("#deckTitle").childNodes[0].textContent = `${def.label} 덱 편성 `;
  state_ui_battle_state.$("#deckHelp").textContent = `${state_ui_deck.LeagueFormatOwner.rulesText(state_ui_deck.leagueSelection, state_ui_deck.comprehensiveComposition)}. 카드 ${state_ui_deck.LeagueFormatOwner.deckSize(state_ui_deck.leagueSelection)}장을 선택합니다. 폼 캐릭터는 현재 리그에서 사용 가능한 폼만 전환됩니다.`;
  syncLeagueSelectionSurface();
  renderSetup(reset);
}

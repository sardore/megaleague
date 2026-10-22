import { bossSearchChooseR32 } from '../ai/boss-planner.js';
import { bossResolveSuppressionR36, bossRotateClocksR36, bossChooseAIController } from '../ai/boss-tactics.js';
import { captureOnlineLobbyScroll, restoreOnlineLobbyScroll } from '../ui/interactions.js';
import { playVisualsCanonical } from "../presentation/animations.js";
import { aiReason, maskedStateFor, aiReasonCore } from "../ai/search.js";
import { actionHeuristic, chooseAI, actionHeuristicSpecialist } from "../ai/specialists.js";
import { state_catalog_cards } from "../catalog/cards.js";
import { enemyTargets, legalActions, prepareCurrentTurn, unitAt } from "../engine/actions.js";
import { createShield, dealDamage, heal, removeEnergy, teamOf, checkDeathCore, queueSkillVisualCore } from "../engine/combat.js";
import { state_engine_effects } from "../engine/effects.js";
import { canPayAction, status, totalEnergy, transformedSkillReq } from "../engine/energy.js";
import { RNG, actionSkillHasEffect, card, cardHasCapability, clone, isPlusStarChoiceForCard, makeUnit, newGame, registerRuntimeSkillContainer, resolvePlusStarChoice, skillDefHasEffect, skillIdByEffect, skillIdByEffectGlobal, skillRefHasEffect, state_engine_entities, cardCore } from "../engine/entities.js";
import { endTurn, execute } from "../engine/execution.js";
import { policySlots, PASS } from "../engine/policies.js";
import { timeClockMiniHTML, timeHyperReason, timeNormDeg, timePaidAmountFromAction, timeRecallValue, timeSetInputLock, timeSyncSuppressionVisuals, state_features_timeora, timeClockMiniHTMLCore, timeColorForTeamCore, timeThemeForTeamCore } from "./timeora.js";
import { onlineCurrentMatchId, onlineSafeSend, state_online_commands } from "../online/commands.js";
import { cloneOnlineVisualEvents, p2pSend, registerOnlineConnectionRoute, serializeOnlineBattleProjection, showEnd, state_online_connection, showEndCore } from "../online/connection.js";
import { renderManualSummonActions } from "../online/emotes.js";
import { sendAuthoritativeOnlineState } from "../online/snapshots.js";
import { onlineStartPacketDigest, scheduleOnlineStartPublicationRetry, traceOnlineStart } from "../online/start.js";
import { log } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
import { afterAction, processPendingTraitChoice, scheduleAI, processPendingTraitChoiceCore, afterActionCore, scheduleAICore } from "../ui/action-choices.js";
import { renderBaseActions, state_ui_action_panel } from "../ui/action-panel.js";
import { scheduleLocalAutoTurnTimer, state_ui_battle_state } from "../ui/battle-state.js";
import { pictogramHTML, state_ui_cards, cardTooltipHTMLCore } from "../ui/cards.js";
import { otherFormId, setSetupFormState, setupFormState, startBgm, state_ui_deck } from "../ui/deck.js";
import { invaderCards, isInvaderCardId } from "../ui/invaders.js";
import { render } from "../ui/payment.js";
import { state_ui_results } from "../ui/results.js";
import { validFormDeck } from "../ui/setup.js";
export function initializeFeaturesBossRaid() {
  BOSS_RAID_VERSION = "red-timeora-raid-r8";
  BOSS_LOBBY_PROTOCOL = "mega-red-timeora-raid-lobby-r8";
  RED_TIMEORA_CARD = state_catalog_cards.C("red_timeora", "타임오러", 280, "동기화 시간 군단", "보스전", "붉은 동기화: 네 개체가 하나의 공용 운명의 시계를 사용한다. 직전에 기술을 사용한 상대의 행동에도 시계가 반응하며, 각 개체는 시간 가속과 타임프로텍트를 사용해 정렬을 최우선으로 행동한다.", [state_catalog_cards.S("timeRecall", "타임리콜", "**", "대상 하나의 HP와 상태이상을 2턴 전 자기 차례 시작 시점으로 되돌린다.", "anyCharacter", [{
    type: "timeRecall"
  }], ["support", "rewind"], {
    nonAttack: true,
    once: true
  }), state_catalog_cards.S("bossTimeStrike", "타임 크래시", "*", "항상 * 40D 또는 ** 70D 중 선택. 시계 정렬을 위한 가변 저코스트 공격.", "enemy", [{
    type: "bossTimeStrike"
  }], ["damage", "clock", "impact"]), state_catalog_cards.S("hyperClock", "하이퍼클락", "WWorB*", "100D. 특성봉인 또는 공용 시계 정렬 시 160D.", "enemy", [{
    type: "hyperClock"
  }], ["damage", "clock"])], {
    grade: "BOSS",
    maxEnergy: 4,
    tags: ["dragon", "time", "boss"],
    timeProtect: 20,
    timeAcceleration: true,
    fateClock: true,
    hiddenUntilRevealed: false
  });
  registerRuntimeSkillContainer([RED_TIMEORA_CARD]);
  state_ui_cards.CARD_EMOJI_MAP.red_timeora = ["⏳️"];
  bossRaidSelection = [];
  bossPlusStarSelection = null;
  bossRaidNetwork = null;
  bossMatchUiAllowed = false;
  bossLobbyHeartbeatTimer = 0;
  bossLobbyRevision = 0;
  bossRewardModalSerial = null;
  bossRewardDelayTimer = 0;
  bossRewardPickRetryTimer = 0;
  bossRewardPickPending = null;
  bossRewardResolving = false;
  bossRewardLocalReadyAt = new Map();
  bossVictoryDelayTimer = 0;
  bossVictoryReadyAt = 0;
  bossVictoryMatchId = "";
  bossIntroPromise = null;
  bossOnlineAiTimer = 0;
  bossPendingStartGame = null;
  LEGACY_CARD_ALIASES = Object.freeze({
    red_timeora: Object.freeze({
      bossRed: true
    })
  });
  BossLobbyApplication = (() => {
    const snapshot = () => Object.freeze({
      deck: Object.freeze([...bossRaidSelection]),
      plusStar: bossPlusStarSelection || null,
      ready: !!state_ui_deck.p2p?.bossLocalReady,
      connected: !!state_ui_deck.p2p?.connected,
      transportUsable: bossTransportUsable()
    });
    const normalizeDraft = (count = 2) => {
      bossRaidSelection = bossSanitizeDeck(bossRaidSelection, count);
      bossPlusStarSelection = resolvePlusStarChoice(bossPlusStarSelection, bossRaidSelection, "P");
      return snapshot();
    };
    const synchronizeCommittedDeck = (count = 2) => {
      normalizeDraft(count);
      state_ui_deck.p2p.bossLocalDeck = [...bossRaidSelection];
      state_ui_deck.p2p.bossLocalPlusStar = bossPlusStarSelection;
      if (!bossDeckValid(state_ui_deck.p2p.bossLocalDeck, count)) state_ui_deck.p2p.bossLocalReady = false;
      return snapshot();
    };
    const publish = (reason = "boss-lobby-state") => {
      if (!bossLobbyActive()) return false;
      synchronizeCommittedDeck(2);
      const ready = !!state_ui_deck.p2p.bossLocalReady && bossDeckValid(state_ui_deck.p2p.bossLocalDeck, 2);
      state_ui_deck.p2p.bossLocalReady = ready;
      try {
        p2pSend({
          type: "bossLobbyState",
          protocol: BOSS_LOBBY_PROTOCOL,
          matchId: state_ui_deck.p2p.matchId || null,
          revision: ++bossLobbyRevision,
          deck: [...state_ui_deck.p2p.bossLocalDeck],
          plusStar: state_ui_deck.p2p.bossLocalPlusStar,
          ready,
          at: Date.now()
        });
        return true;
      } catch {
        return false;
      }
    };
    const draftChanged = (online, count = online ? 2 : 4, reason = "boss-draft-change") => {
      normalizeDraft(count);
      if (online) {
        synchronizeCommittedDeck(2);
        state_ui_deck.p2p.bossLocalReady = false;
        publish(reason);
        bossRefreshOnlineLobby();
      }
      return snapshot();
    };
    const toggleCard = (id, count, online) => {
      const index = bossRaidSelection.indexOf(id),
        card = state_catalog_cards.CARDS.find(x => x.id === id);
      if (index >= 0) bossRaidSelection.splice(index, 1);else {
        if (bossRaidSelection.length >= count) return false;
        if (card?.formGroup && bossRaidSelection.some(value => state_catalog_cards.CARDS.find(x => x.id === value)?.formGroup === card.formGroup)) return false;
        bossRaidSelection.push(id);
      }
      draftChanged(online, count, "boss-card-toggle");
      return true;
    };
    const changeForm = (group, next, count, online) => {
      const selectedIndex = bossRaidSelection.findIndex(value => state_catalog_cards.CARDS.find(card => card.id === value)?.formGroup === group);
      setSetupFormState(group, next);
      if (selectedIndex >= 0) bossRaidSelection[selectedIndex] = next;
      draftChanged(online, count, "boss-form-change");
      return true;
    };
    const commitPlusStar = (nextDeck, nextChoice, count, online) => {
      bossRaidSelection.splice(0, bossRaidSelection.length, ...nextDeck);
      bossPlusStarSelection = nextChoice;
      draftChanged(online, count, "boss-plusstar-change");
      return true;
    };
    const applyInvader = (id, count, online) => {
      const old = bossRaidSelection.findIndex(cardId => typeof isInvaderCardId === "function" && isInvaderCardId(cardId));
      if (old >= 0) {
        bossRaidSelection[old] = id;
        draftChanged(online, count, "boss-invader-replace");
        return Object.freeze({
          applied: true,
          needsReplacement: false
        });
      }
      if (bossRaidSelection.length < count) {
        bossRaidSelection.push(id);
        draftChanged(online, count, "boss-invader-add");
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
    const replaceInvader = (index, id, count, online) => {
      if (!Number.isInteger(index) || index < 0 || index >= bossRaidSelection.length) return false;
      bossRaidSelection[index] = id;
      draftChanged(online, count, "boss-invader-slot-replace");
      return true;
    };
    const clearInvader = (count, online) => {
      bossRaidSelection = bossRaidSelection.filter(id => !(typeof isInvaderCardId === "function" && isInvaderCardId(id)));
      draftChanged(online, count, "boss-invader-clear");
      return true;
    };
    const preparePortal = online => {
      if (online && state_ui_deck.p2p.bossLocalReady) {
        state_ui_deck.p2p.bossLocalReady = false;
        publish("boss-portal-open");
        bossRefreshOnlineLobby();
      }
      return snapshot();
    };
    const requestReady = (desired, reason = "boss-ready-change") => {
      normalizeDraft(2);
      if (!bossDeckValid(bossRaidSelection, 2)) return false;
      const transportReady = bossTransportUsable();
      if (!transportReady) bossResumeOnlineSession(reason);
      synchronizeCommittedDeck(2);
      state_ui_deck.p2p.bossLocalReady = !!desired;
      if (bossTransportUsable()) publish(reason);
      bossRefreshOnlineLobby();
      if (bossTransportUsable()) bossMaybeStartOnline();
      return true;
    };
    const toggleReady = (reason = "boss-ready-toggle") => requestReady(!state_ui_deck.p2p.bossLocalReady, reason);
    const resetDraft = (reason = "boss-draft-reset") => {
      bossRaidSelection = [];
      bossPlusStarSelection = null;
      return Object.freeze({
        reason,
        ...snapshot()
      });
    };
    const runtimeSetLobbyDeck = (deck, ready = true, plusStar = null) => {
      bossRaidSelection = bossSanitizeDeck(deck, 2);
      bossPlusStarSelection = resolvePlusStarChoice(plusStar, bossRaidSelection, "P");
      synchronizeCommittedDeck(2);
      state_ui_deck.p2p.bossLocalReady = !!ready && bossDeckValid(bossRaidSelection, 2);
      publish("runtime-set-lobby-deck");
      bossRefreshOnlineLobby();
      bossMaybeStartOnline();
      return {
        deck: [...bossRaidSelection],
        plusStar: state_ui_deck.p2p.bossLocalPlusStar,
        ready: state_ui_deck.p2p.bossLocalReady
      };
    };
    return Object.freeze({
      snapshot,
      normalizeDraft,
      publish,
      draftChanged,
      toggleCard,
      changeForm,
      commitPlusStar,
      applyInvader,
      replaceInvader,
      clearInvader,
      preparePortal,
      requestReady,
      toggleReady,
      resetDraft,
      runtimeSetLobbyDeck
    });
  })();
  /* 붉은 공용 시계의 특성 정지는 TimeClockTraitSuppressionPolicy가 처리한다.
     보스 카드별 예외가 아니라 공용 시계 소유자 집합 전체가 자동으로 면역이다. */

  policySlots.legal10 = {
    transform(currentActions, g, t, s) {
      let actions = currentActions,
        u = unitAt(g, t, s);
      if (g?.bossRaid && t === "A") actions = actions.filter(a => a?.type !== "switch");
      if (g?.bossRaid && t === "P") {
        const owner = g.bossRaid.slotOwners?.[s] || u?.bossOwner || "solo";
        if (!u || u.dead) actions = actions.filter(a => a.type !== "deploy" || g.teams.P.bench.find(x => x?.uid === a.unit)?.bossOwner === owner || !g.bossRaid.online);else actions = actions.filter(a => a.type !== "switch" || g.teams.P.bench[a.bench]?.bossOwner === u.bossOwner || !g.bossRaid.online);
      }
      if (!u?.bossRed) return actions;
      actions = actions.filter(a => !(a.type === "skill" && actionSkillHasEffect(a, "bossTimeStrike")));
      if (!u.skillSeals?.[skillIdByEffect(u, "bossTimeStrike")] && !status(u, "skillSeal")) {
        for (const cost of ["*", "**"]) {
          if (!canPayAction(g, t, u, cost)) continue;
          const damage = cost.length === 1 ? 40 : 70;
          for (const target of enemyTargets(g, t)) actions.push({
            type: "skill",
            skill: skillIdByEffectGlobal("bossTimeStrike"),
            costOverride: cost,
            displayCost: `${cost} · ${damage}D`,
            bossTimeStrikeDamage: damage,
            target,
            label: `타임 크래시 ${cost} ${damage}D`
          });
        }
      }
      return actions;
    }
  };
  policySlots.effect9 = function (g, actor, target, e, skill, ctx = {}) {
    if (e?.type === "bossTimeStrike") return dealDamage(g, actor, target, {
      amount: Number(ctx?.action?.bossTimeStrikeDamage || 40)
    }, skill, ctx.sim);
    if (e?.type === "hyperClock" && g?.bossRaid && actor?.bossRed && g.bossRaid.hyperGuard > 0) {
      const reason = ctx?.action?.timeHyperReason || timeHyperReason(actor),
        raw = reason ? 160 : 100,
        amount = Math.max(0, raw - 60);
      g.bossRaid.hyperGuard--;
      log(g, `레이드 보상 · 시간 방벽: 하이퍼클락 ${raw}D → ${amount}D.`, "turn");
      const result = dealDamage(g, actor, target, {
        amount
      }, skill, ctx.sim);
      if (!ctx.sim && g === state_ui_battle_state.game) state_ui_battle_state.visualEvents.push({
        type: "hyperClockFx",
        uid: actor.uid,
        targetUid: target?.uid || null,
        team: "__bossRed",
        bossRed: true,
        enhanced: !!reason,
        reason,
        amount: result,
        rawAmount: raw
      });
      return result;
    }
    return PASS;
  };
  policySlots.after2 = (result, meta, g, actor, target, e, skill, ctx = {}) => {
    if (g?.bossRaid && actor?.bossRed && !ctx.sim && g === state_ui_battle_state.game) for (let i = meta.visualStart; i < state_ui_battle_state.visualEvents.length; i++) {
      const v = state_ui_battle_state.visualEvents[i];
      if (v && ["hyperClockFx", "timeRecallFx"].includes(v.type)) {
        v.team = "__bossRed";
        v.bossRed = true;
      }
    }
  };

  /*
   * 붉은 공용 시계 위상 모델
   * - 시침과 분침의 상대각을 30도 단위 12칸으로 변환한다.
   * - 같은 방향(0)과 정반대(6)는 모두 정렬이며 정렬 위상차 0이다.
   * - 정렬점에서 30도 멀어질 때마다 위상차가 정확히 1 증가한다.
   * - 붉은 타임오러 자신의 nE 기술은 시침 +n칸, 분침 +3n칸이므로 상대 위상은 -2n칸 변한다.
   * - 플레이어의 nE 기술은 시침만 +n칸이므로 상대 위상은 +n칸 변한다.
   */

  BOSS_REWARDS = [{
    id: "energyPair",
    rarity: "common",
    weight: 34,
    name: "시간 결정 묶음",
    desc: "현재 필드 아군 둘에게 무작위 에너지 1개씩 지급."
  }, {
    id: "teamHeal",
    rarity: "common",
    weight: 30,
    name: "응급 복구",
    desc: "생존한 아군 전체 HP 30 회복."
  }, {
    id: "shieldPatch",
    rarity: "common",
    weight: 22,
    name: "방벽 재구축",
    desc: "현재 필드 아군에게 실드 35 부여."
  }, {
    id: "clockReverse",
    rarity: "uncommon",
    weight: 18,
    name: "역행 침",
    desc: "붉은 공용 시침을 60° 역회전."
  }, {
    id: "bossDrain",
    rarity: "uncommon",
    weight: 15,
    name: "시간 누수",
    desc: "생존한 붉은 타임오러의 에너지 1개씩 제거."
  }, {
    id: "hyperGuard",
    rarity: "rare",
    weight: 10,
    name: "시간 방벽",
    desc: "다음 적 하이퍼클락 피해를 60 감소."
  }, {
    id: "revive",
    rarity: "rare",
    weight: 8,
    name: "되감긴 생명",
    desc: "사망한 아군 하나를 HP 80으로 후열에 복귀."
  }, {
    id: "overdrive",
    rarity: "rare",
    weight: 7,
    name: "연합 오버드라이브",
    desc: "생존 아군 HP 20 회복 후 현재 필드에 에너지 1개씩 지급."
  }, {
    id: "summonTimeora",
    rarity: "legendary",
    weight: 0,
    chance: .05,
    name: "금빛 시간의 지원",
    desc: "아군 타임오러를 선택자의 후열에 소환. 후보 등장 확률 정확히 5%."
  }];
  if (!systems.__megaBossRewardDelegationR44) {
    document.addEventListener("click", bossHandleRewardClick, true);
    systems.__megaBossRewardDelegationR44 = true;
  }
  state_ui_action_panel.ActionRenderEngine.registerRoute("boss-raid", 300, () => !!state_ui_battle_state.game?.bossRaid, ctx => renderBossActions(ctx));
  for (const type of ["bossLobbyState", "bossRewardOffer", "bossRewardPick"]) registerOnlineConnectionRoute(type, "boss-application", bossHandlePacket, 65);
  policySlots.render9 = {
    transform(currentResult) {
      const r = currentResult;
      bossDecorateRender();
      return r;
    }
  };
  systems.__redTimeoraBossRaid = {
    version: BOSS_RAID_VERSION,
    resolveSuppression: bossResolveSuppressionR36,
    rotateClocksR36: bossRotateClocksR36,
    chooseAIController: bossChooseAIController,
    searchChooseR32: bossSearchChooseR32,
    basicChoose: bossChooseBasic,
    serialize: bossSerialize,
    revive: bossRevive,
    openMenu: showBossRaidMenu,
    open: showBossRaidMenu,
    showOnlineLobby: showBossOnlineLobby,
    startOnline: bossStartMatchmaking,
    peerFallbackProtocol: null,
    matchmakingBuild: "ONLINE-RUNTIME-REBASE-R1",
    peerSlotCount: 0,
    peerSlotId: () => null,
    matchmakingDebug: () => systems.OnlineRuntime?.debug?.() || null,
    runtimeCommit: ({
      remotePlayerId,
      role,
      matchId
    } = {}, connection = null) => {
      const s = bossRaidNetwork;
      if (!s?.active || !connection) return false;
      bossFinalizeMatch(s, remotePlayerId, role, matchId, connection);
      return !!s.matched;
    },
    runtimeResume: reason => bossResumeOnlineSession(reason || "runtime-resume", false),
    runtimePause: reason => bossPauseOnlineSession(reason || "runtime-background"),
    runtimeSetLobbyDeck: (deck, ready = true, plusStar = null) => BossLobbyApplication.runtimeSetLobbyDeck(deck, ready, plusStar),
    sendLobbyState: reason => BossLobbyApplication.publish(reason || "external-send-lobby-state"),
    resume: bossResumeOnlineSession,
    portalSubviewOpen: bossLobbySubviewOpen,
    launch: bossLaunch,
    commitPendingStart: bossCommitPendingStart,
    abortPendingStart: bossAbortPendingStart,
    createGame: bossCreateGame,
    create: bossCreateGame,
    combinedDeckValid: bossCombinedDeckValid,
    pool: bossRaidPool,
    showDeckPicker: showBossDeckPicker,
    localControlsCurrent: bossLocalControlsCurrent,
    passEmpty: bossPassEmptySlot,
    guestActionPending: () => state_online_commands.OnlineActionAdmissionOwner.hasPending(),
    clearGuestPending: () => state_online_commands.OnlineActionAdmissionOwner.clearPending({
      unlock: true,
      resolution: "boss-clear"
    }),
    abortMatchmaking: () => bossAbortMatchmaking({
      showMenu: false,
      closeModal: true
    }),
    closeSession: bossCloseSession,
    debug: bossDebug,
    presentationContext: () => ({
      deck: [...bossRaidSelection],
      plusStar: bossPlusStarSelection
    }),
    mapClockOverlayEvents(events) {
      return (events || []).map(event => ({
        ...event,
        clocks: (event.clocks || []).map(c => {
          const isBoss = !!(state_ui_battle_state.game?.bossRaid && c && (c.bossShared || c.uid === "boss-shared-clock" || c.team === "A" || c.team === "__bossRed"));
          return isBoss ? {
            ...c,
            bossShared: true,
            uid: "boss-shared-clock",
            team: "__bossRed"
          } : c;
        })
      }));
    },
    matchmakingUiAllowed: () => bossMatchUiAllowed
  };
  Object.freeze(systems.__redTimeoraBossRaid);
  installBossButton();

  /* R37: 공용 모달 닫기로 보스 수색을 숨길 때 네트워크까지 즉시 폐기한다. */
  document.getElementById("closeModal")?.addEventListener("click", event => {
    const s = bossRaidNetwork;
    if (!s?.active || s.matched || !bossMatchUiAllowed) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    bossAbortMatchmaking({
      showMenu: false,
      closeModal: true
    });
  }, true);
  bossRulesReady = true;
}
let BOSS_RAID_VERSION;
let BOSS_LOBBY_PROTOCOL;
let RED_TIMEORA_CARD;
let bossRaidSelection;
let bossPlusStarSelection;
let bossRaidNetwork;
let bossMatchUiAllowed;
let bossLobbyHeartbeatTimer;
let bossLobbyRevision;
let bossRewardModalSerial;
let bossRewardDelayTimer;
let bossRewardPickRetryTimer;
let bossRewardPickPending;
let bossRewardResolving;
let bossRewardLocalReadyAt;
let bossVictoryDelayTimer;
let bossVictoryReadyAt;
let bossVictoryMatchId;
let bossIntroPromise;
let bossOnlineAiTimer;
let bossPendingStartGame;
let LEGACY_CARD_ALIASES;
function bossRaidPool() {
  /* 보스 편성에서는 기본형/각성형을 모두 실제 카드로 노출한다.
     MEGA_SETUP_IDS는 일반 편성용 대표 슬롯이라 각성이루마·휴브가 빠지므로 사용하지 않는다. */
  const raw = [...(typeof state_catalog_cards.MEGA_IDS !== "undefined" ? state_catalog_cards.MEGA_IDS : state_ui_deck.MEGA_SETUP_IDS), ...(typeof invaderCards === "function" ? invaderCards().map(c => c.id) : [])];
  const out = [],
    seen = new Set();
  for (const v of raw) {
    const id = String(v || ""),
      c = state_catalog_cards.CARDS.find(x => x.id === id);
    if (!c || id === "timeora" || id === "red_timeora" || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
function bossDeckValid(deck, count) {
  if (!Array.isArray(deck) || deck.length !== count) return false;
  const groups = new Set(),
    ids = new Set();
  let invaders = 0;
  for (const id of deck) {
    const c = state_catalog_cards.CARDS.find(x => x.id === id);
    if (!c || id === "timeora" || id === "red_timeora" || ids.has(id)) return false;
    ids.add(id);
    if (c.formGroup) {
      if (groups.has(c.formGroup)) return false;
      groups.add(c.formGroup);
    }
    if (typeof isInvaderCardId === "function" && isInvaderCardId(id) && ++invaders > 1) return false;
  }
  return true;
}
function bossCombinedDeckValid(a, b) {
  return bossDeckValid(a, 2) && bossDeckValid(b, 2);
}
function bossSanitizeDeck(deck, count = 2) {
  const allowed = new Set(bossRaidPool()),
    clean = [],
    groups = new Set();
  let invaderUsed = false;
  for (const raw of Array.isArray(deck) ? deck : []) {
    const id = String(raw || ""),
      c = state_catalog_cards.CARDS.find(x => x.id === id);
    if (!c || !allowed.has(id) || clean.includes(id)) continue;
    if (c.formGroup && groups.has(c.formGroup)) continue;
    if (typeof isInvaderCardId === "function" && isInvaderCardId(id)) {
      if (invaderUsed) continue;
      invaderUsed = true;
    }
    if (c.formGroup) groups.add(c.formGroup);
    clean.push(id);
    if (clean.length >= count) break;
  }
  return clean;
}
function bossTransportUsable() {
  if (state_ui_deck.p2p?.sessionMode !== "bossRaid" || state_ui_deck.p2p?.battleStarted) return false;
  if (state_ui_deck.p2p?.connected || state_ui_deck.p2p?.conn?.open) return true;
  const s = bossRaidNetwork;
  return !!(s?.active && s?.matched && s?.conn === state_ui_deck.p2p?.conn);
}
function bossLobbyActive() {
  return !!(state_ui_deck.p2p?.sessionMode === "bossRaid" && !state_ui_deck.p2p?.battleStarted && bossTransportUsable());
}
function bossLobbySubviewOpen() {
  const root = document.getElementById("modalContent");
  return !!(root?.dataset?.bossLobbySubview || root?.querySelector?.(".invader-selector"));
}
let BossLobbyApplication;
function bossStartLobbyHeartbeat() {
  if (bossLobbyHeartbeatTimer) return;
  const scope = systems.OnlineRuntime?.sessionScope;
  if (!scope || scope.closed) return false;
  bossLobbyHeartbeatTimer = scope.setInterval(() => BossLobbyApplication.publish("heartbeat"), 850, "boss-lobby-heartbeat", {
    phase: "SESSION"
  });
  BossLobbyApplication.publish("lobby-state");
}
function bossStopLobbyHeartbeat() {
  if (bossLobbyHeartbeatTimer) systems.OnlineRuntime?.sessionScope?.cancel?.(bossLobbyHeartbeatTimer);
  bossLobbyHeartbeatTimer = 0;
}
function bossRefreshOnlineLobby() {
  const mine = bossDeckValid(bossRaidSelection, 2),
    theirs = bossDeckValid(state_ui_deck.p2p.bossRemoteDeck || [], 2);
  const conflict = false;
  const ready = document.getElementById("bossDeckConfirm");
  if (ready) {
    ready.textContent = state_ui_deck.p2p.bossLocalReady ? "준비 취소" : "준비 완료";
    /* R42: 덱과 충돌만 버튼의 합법성을 결정한다. 재연결 직후의 낡은
       connected=false 값 때문에 이미 열린 대기실 버튼이 영구 비활성화되지 않는다. */
    ready.disabled = !mine || conflict || !!state_ui_deck.p2p.battleStarted;
    ready.classList.toggle("room-ready-on", !!state_ui_deck.p2p.bossLocalReady && !conflict);
    ready.dataset.transportState = bossTransportUsable() ? "online" : "recovering";
  }
  const status = document.getElementById("bossDeckStatus");
  if (status) {
    status.textContent = `내 덱 ${bossRaidSelection.length}/2${state_ui_deck.p2p.bossLocalReady ? " · 준비 완료" : ""} · 동료 ${state_ui_deck.p2p.bossRemoteDeck?.length || 0}/2${state_ui_deck.p2p.bossRemoteReady ? " · 준비 완료" : ""}`;
  }
}
function bossRandomId(prefix = "boss") {
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  return `${prefix}-${Date.now().toString(36)}-${[...a].map(x => x.toString(36)).join("")}`;
}
function bossClock(g) {
  g.bossRaid.sharedClock ||= {
    hourDeg: 0,
    minuteDeg: 90
  };
  return g.bossRaid.sharedClock;
}
function isBossRedTimeora(g, u, teamHint = null) {
  if (!u) return false;
  const team = teamHint || (g?.teams && typeof teamOf === "function" ? teamOf(g, u) : null);
  return !!(u.bossRed || g?.bossRaid && team === "A" && cardHasCapability(u, "fateClock"));
}
export function bossRedUnits(g) {
  const units = [...(g?.teams?.A?.field || []), ...(g?.teams?.A?.bench || []), ...(g?.teams?.A?.graveyard || [])];
  return units.filter(u => isBossRedTimeora(g, u, "A")).map(u => {
    u.bossRed = true;
    return u;
  });
}
function bossSyncClock(g) {
  if (!g?.bossRaid) return;
  const c = bossClock(g);
  for (const u of bossRedUnits(g)) {
    u.timeHourDeg = timeNormDeg(c.hourDeg);
    u.timeMinuteDeg = timeNormDeg(c.minuteDeg);
  }
}
function bossClockAligned(g) {
  if (!g?.bossRaid) return false;
  const c = bossClock(g),
    d = timeNormDeg(c.hourDeg - c.minuteDeg);
  return Math.abs(d) < .001 || Math.abs(d - 180) < .001;
}
function bossPlayTimeStrikeFx(v) {
  const target = v.targetUid ? document.querySelector(`.card[data-uid="${CSS.escape(String(v.targetUid))}"]`) : null,
    r = target?.getBoundingClientRect(),
    x = r ? r.left + r.width / 2 : innerWidth / 2,
    y = r ? r.top + r.height / 2 : innerHeight / 2;
  const layer = document.createElement("div");
  layer.className = "boss-crack-layer";
  layer.style.setProperty("--x", `${x}px`);
  layer.style.setProperty("--y", `${y}px`);
  const core = document.createElement("div");
  core.className = "boss-crack-core";
  [0, 38, 79, 123, 171, 219, 267, 314].forEach((rot, i) => {
    const line = document.createElement("i");
    line.style.setProperty("--rot", `${rot}deg`);
    line.style.setProperty("--len", `${72 + i % 3 * 29}px`);
    core.appendChild(line);
  });
  layer.appendChild(core);
  document.body.appendChild(layer);
  document.querySelector(".app")?.classList.add("boss-screen-hit");
  systems.TimerManager.setTimeout(() => document.querySelector(".app")?.classList.remove("boss-screen-hit"), 360);
  systems.TimerManager.setTimeout(() => layer.remove(), 560);
}
function bossPhaseMod(v) {
  v = Math.round(Number(v) || 0) % 12;
  return v < 0 ? v + 12 : v;
}
function bossPhaseAlignedStep(step) {
  step = bossPhaseMod(step);
  return step === 0 || step === 6;
}
function bossPhaseDistanceStep(step) {
  step = bossPhaseMod(step);
  return Math.min(step, 12 - step, Math.abs(step - 6));
}
function bossPlayerAlignmentCost(step, maxCost = 4) {
  step = bossPhaseMod(step);
  for (let n = 1; n <= maxCost; n++) if (bossPhaseAlignedStep(step + n)) return n;
  return Infinity;
}
function bossSelfAlignmentCost(step, maxCost = 4) {
  step = bossPhaseMod(step);
  for (let n = 1; n <= maxCost; n++) if (bossPhaseAlignedStep(step - 2 * n)) return n;
  return Infinity;
}
function bossPhaseInfo(hour, minute) {
  const step = bossPhaseMod(Math.round(timeNormDeg(Number(hour || 0) - Number(minute || 0)) / 30));
  return {
    step,
    distance: bossPhaseDistanceStep(step),
    aligned: bossPhaseAlignedStep(step),
    playerNudge: bossPlayerAlignmentCost(step),
    selfAlignCost: bossSelfAlignmentCost(step)
  };
}
function bossClockPhase(g) {
  const c = bossClock(g);
  return bossPhaseInfo(c.hourDeg, c.minuteDeg);
}
function bossActionPaidUnits(g, t, u, a) {
  if (a?.type !== "skill") return 0;
  let amount = 0;
  try {
    amount = Number(timePaidAmountFromAction(g, t, u, a) || 0);
  } catch (error) {
    systems.__megaRecordRecoveredError(error, "redTimeoraBossRaidScript:L300");
  }
  if (!(amount > 0)) {
    const sk = card(u)?.skills?.find(x => x.id === a?.skill),
      cost = a?.costOverride ?? sk?.cost ?? "";
    try {
      amount = Number(transformedSkillReq(g, t, u, cost)?.tokens?.length || 0) + Number(a?.extraW || 0);
    } catch (error) {
      systems.__megaRecordRecoveredError(error, "redTimeoraBossRaidScript:L303");
    }
  }
  return Math.ceil(Math.max(0, amount) - 1e-9);
}
function bossActionPhasePlan(g, t, s, a) {
  const u = unitAt(g, t, s),
    before = bossClockPhase(g),
    n = bossActionPaidUnits(g, t, u, a);
  const delta = a?.type === "skill" && n ? u?.bossRed ? -2 * n : n : 0;
  const afterStep = bossPhaseMod(before.step + delta),
    after = {
      step: afterStep,
      distance: bossPhaseDistanceStep(afterStep),
      aligned: bossPhaseAlignedStep(afterStep),
      playerNudge: bossPlayerAlignmentCost(afterStep),
      selfAlignCost: bossSelfAlignmentCost(afterStep)
    };
  return {
    n,
    delta,
    before,
    after,
    improvement: before.distance - after.distance
  };
}
function bossPhaseNudgeScore(cost) {
  if (cost === 1) return 185;
  if (cost === 2) return 105;
  if (cost === 3) return 52;
  if (cost === 4) return 18;
  return -48;
}
function bossPhaseActionScore(g, t, s, a) {
  const u = unitAt(g, t, s),
    plan = bossActionPhasePlan(g, t, s, a),
    before = plan.before,
    after = plan.after;
  if (a?.type === "gather") {
    const energy = totalEnergy(u),
      need = Number.isFinite(before.selfAlignCost) ? Math.max(0, before.selfAlignCost - energy) : 0;
    let score = 72 + Math.max(0, 3.5 - energy) * 31 + need * 58;
    if (before.aligned) score += 285;
    if (before.playerNudge === 1) score += 245;else if (before.playerNudge === 2) score += 112;
    if (energy >= 4) score -= 245;
    return score;
  }
  if (a?.type !== "skill") return 0;
  let score = plan.improvement * 118;
  if (after.aligned && !before.aligned) score += 610;
  if (before.aligned && !after.aligned) score += actionSkillHasEffect(a, "hyperClock") ? 80 : -430;
  score += bossPhaseNudgeScore(after.playerNudge);
  if (before.playerNudge === 1 && !after.aligned && after.playerNudge !== 1) score -= 205;
  if (after.playerNudge === 1 && before.playerNudge !== 1) score += 135;
  if (Number.isFinite(after.selfAlignCost)) {
    const energyAfter = Math.max(0, totalEnergy(u) - plan.n);
    score += energyAfter >= after.selfAlignCost ? 92 : Math.max(0, 62 - (after.selfAlignCost - energyAfter) * 24);
  }
  if (actionSkillHasEffect(a, "bossTimeStrike") && skillRefHasEffect(u?.lastSkill, "bossTimeStrike") && !after.aligned && after.playerNudge !== 1) score -= 190;
  if (actionSkillHasEffect(a, "hyperClock") && before.aligned) score += 390;
  return score;
}
function bossBestAction(g, t, s, list, extra = () => 0) {
  return [...list].sort((a, b) => actionHeuristic(g, t, s, b) + extra(b) - (actionHeuristic(g, t, s, a) + extra(a)))[0] || null;
}
function bossChooseBasic(g, t, s, deep = false) {
  const u = unitAt(g, t, s);
  if (!g?.bossRaid || !u?.bossRed) return null;
  if (u.scheduledAction) return {
    type: "scheduled"
  };
  const actions = legalActions(g, t, s),
    phase = bossClockPhase(g);
  const hypers = actions.filter(a => actionSkillHasEffect(a, "hyperClock")),
    recalls = actions.filter(a => actionSkillHasEffect(a, "timeRecall"));
  const bestHyper = bossBestAction(g, t, s, hypers, a => {
    const z = a.target ? unitAt(g, a.target.team, a.target.slot) : null;
    return z && z.hp + z.shield <= (phase.aligned ? 160 : 100) ? 500 : 0;
  });
  if (phase.aligned && bestHyper) return bestHyper;
  const recallRank = recalls.map(a => ({
    a,
    value: timeRecallValue(a.target ? unitAt(g, a.target.team, a.target.slot) : null),
    plan: bossActionPhasePlan(g, t, s, a)
  })).sort((x, y) => y.value + (y.plan.after.aligned ? 170 : 0) - (x.value + (x.plan.after.aligned ? 170 : 0)));
  if (recallRank[0]?.value >= 145) return recallRank[0].a;
  const ranked = actions.map(a => ({
    a,
    score: actionHeuristic(g, t, s, a),
    plan: bossActionPhasePlan(g, t, s, a)
  })).sort((x, y) => y.score - x.score);
  const best = ranked[0];
  if (best) return best.a;
  return null;
}
function bossAssignRed(u, index) {
  u.bossRed = true;
  u.name = "타임오러";
  u.maxHp = 280;
  u.hp = 280;
  u.shield = 0;
  u.baseDefense = 0;
  u.defense = 0;
  u.defenseMod = 0;
  u.usedOnce ||= {};
  u.usedOnce[skillIdByEffect(u, "timeRecall")] = false;
  u.energy = [];
  u.timeHourDeg = 0;
  u.timeMinuteDeg = 90;
}
function bossCreateGame(hostDeck, guestDeck = null, online = false, plusState = null) {
  const solo = !online,
    ordered = solo ? [...hostDeck] : [hostDeck[0], guestDeck[0], hostDeck[1], guestDeck[1]],
    seed = bossRandomId("raid-seed");
  const hostChoice = resolvePlusStarChoice(plusState?.host ?? (online ? state_ui_deck.p2p?.bossLocalPlusStar : bossPlusStarSelection), hostDeck, "P");
  const guestChoice = online ? resolvePlusStarChoice(plusState?.guest ?? state_ui_deck.p2p?.bossRemotePlusStar, guestDeck, "A") : null;
  const combinedPlus = solo ? hostChoice : [hostChoice ? {
    slotIndex: hostChoice.slotIndex * 2,
    cardId: hostChoice.cardId
  } : null, guestChoice ? {
    slotIndex: guestChoice.slotIndex * 2 + 1,
    cardId: guestChoice.cardId
  } : null].filter(Boolean);
  const g = newGame(ordered.slice(0, 4), ["timeora", "timeora", "timeora", "timeora"], {
    seed,
    variance: false,
    difficulty: "boss45",
    mode: online ? "bossOnline" : "bossSolo",
    league: "mega",
    plusStar: {
      P: combinedPlus
    }
  });
  const pAll = [...g.teams.P.field, ...g.teams.P.bench];
  pAll.forEach((u, i) => {
    u.bossOwner = solo ? "solo" : i % 2 === 0 ? "host" : "guest";
  });
  const aAll = [...g.teams.A.field, ...g.teams.A.bench];
  aAll.forEach(bossAssignRed);
  g.revealed.P = pAll.map(u => u.uid);
  g.revealed.A = aAll.map(u => u.uid);
  g.mode = online ? "bossOnline" : "bossSolo";
  g.matchType = "보스전 · 붉은 시간의 군단";
  g.difficulty = "4.5";
  g.variance = false;
  g.bossRaid = {
    version: BOSS_RAID_VERSION,
    online,
    difficulty: 4.5,
    bossId: "red-timeora-legion",
    sharedClock: {
      hourDeg: 0,
      minuteDeg: 90
    },
    kills: 0,
    rewardSerial: 0,
    hyperGuard: 0,
    slotOwners: online ? ["host", "guest"] : ["solo", "solo"],
    hostDeck: [...hostDeck],
    guestDeck: guestDeck ? [...guestDeck] : null,
    hostPlusStar: hostChoice,
    guestPlusStar: guestChoice,
    rewardResolvedSerial: 0
  };
  g.matchId = online ? state_ui_deck.p2p.matchId || bossRandomId("raid-match") : bossRandomId("raid-solo");
  g.token = ++state_ui_battle_state.battleToken;
  bossSyncClock(g);
  return g;
}
function bossPrepareGame(g) {
  systems.TimerManager.clear(bossRewardDelayTimer);
  bossRewardDelayTimer = 0;
  bossRewardLocalReadyAt.clear();
  systems.TimerManager.clear(bossVictoryDelayTimer);
  bossVictoryDelayTimer = 0;
  bossVictoryReadyAt = 0;
  bossVictoryMatchId = "";
  if (bossOnlineAiTimer) systems.OnlineRuntime?.sessionScope?.cancel?.(bossOnlineAiTimer);
  bossOnlineAiTimer = 0;
  state_ui_battle_state.game = g;
  state_ui_battle_state.lastBattleConfig = null;
  state_ui_battle_state.busy = true;
  state_ui_battle_state.pendingSkill = null;
  state_ui_battle_state.lastLog = 0;
  state_ui_battle_state.visualEvents = [];
  state_ui_battle_state.visualHoldMs = 0;
  document.getElementById("log").innerHTML = "";
  log(g, "붉은 시간의 군단 보스전 시작 · 타임오러 사용 불가 · 적 공용 시계 활성.", "turn");
  state_ui_results.NavigationApplication.request("game");
  render();
  startBgm();
}
function bossPlayIntro() {
  if (bossIntroPromise) return bossIntroPromise;
  let cancelIntro = null;
  const introPromise = new Promise(resolve => {
    const el = document.createElement("div");
    el.className = "boss-raid-intro";
    el.innerHTML = `<div class="boss-intro-core"><div class="boss-intro-hourglasses"><span>⏳</span><span>⏳</span><span>⏳</span><span>⏳</span></div><div class="boss-intro-title">붉은 시간의 군단</div><div class="boss-intro-sub">SHARED CLOCK RAID</div></div>`;
    let done = false,
      backgrounded = false,
      endingTimer = 0,
      finishTimer = 0;
    const onHide = () => {
      backgrounded = true;
    };
    const finish = () => {
      if (done) return;
      done = true;
      systems.TimerManager.clear(endingTimer);
      systems.TimerManager.clear(finishTimer);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onResume);
      document.removeEventListener("visibilitychange", onVisibility);
      el.remove();
      bossIntroPromise = null;
      resolve();
    };
    cancelIntro = finish;
    const onResume = () => {
      if (backgrounded) finish();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") backgrounded = true;else if (backgrounded) finish();
    };
    document.body.appendChild(el);
    window.addEventListener("pagehide", onHide, {
      passive: true
    });
    window.addEventListener("pageshow", onResume, {
      passive: true
    });
    document.addEventListener("visibilitychange", onVisibility, {
      passive: true
    });
    endingTimer = systems.TimerManager.setTimeout(() => {
      if (!done) el.classList.add("ending");
    }, 1850);
    finishTimer = systems.TimerManager.setTimeout(finish, 2400);
  });
  const scope = state_ui_battle_state.game?.bossRaid?.online ? systems.OnlineRuntime?.sessionScope : null;
  bossIntroPromise = scope && !scope.closed ? scope.track(introPromise, "boss-raid-intro", {
    phase: "IN_BATTLE",
    cancel: () => cancelIntro?.()
  }) : introPromise;
  return bossIntroPromise;
}
async function bossLaunch(g) {
  if (g?.bossRaid?.online) bossStopLobbyHeartbeat();
  bossPrepareGame(g);
  if (g?.bossRaid?.online) {
    state_online_commands.onlineAuthoritativeRevision = Number(g?.networkRevision || 0);
    state_ui_deck.p2p.lastAuthoritativeRevision = Number(g?.networkRevision || 0);
    systems.OnlineRuntime?.markBattleStarted?.({
      source: "boss-launch",
      canonicalRevision: Number(g?.networkRevision || g?.turnSerial || 0)
    });
    state_online_commands.OnlineActionAdmissionOwner.startProbe();
  }
  await bossPlayIntro();
  if (state_ui_battle_state.game !== g) return;
  state_ui_battle_state.busy = false;
  render();
  if (g?.bossRaid && (!g.bossRaid.online || state_ui_deck.p2p?.role === "host")) systems.TimerManager.setTimeout(() => systems.__megaSpectatorR18?.startHost?.(), 80);
  bossSendState(true);
  scheduleAI();
}
let BOSS_REWARDS;
function bossWeightedReward(g, excluded) {
  const pool = BOSS_REWARDS.filter(r => r.id !== "summonTimeora" && !excluded.has(r.id) && Number(r.weight || 0) > 0);
  let total = pool.reduce((n, r) => n + r.weight, 0);
  if (!total) return null;
  let roll = g.rng.next() * total,
    pick = pool.at(-1);
  for (const r of pool) {
    roll -= r.weight;
    if (roll <= 0) {
      pick = r;
      break;
    }
  }
  return pick;
}
function bossRollRewards(g) {
  const out = [],
    used = new Set(),
    hasAlliedTimeora = [...g.teams.P.field, ...g.teams.P.bench].some(u => cardHasCapability(u, "timeControl") && !u.bossRed),
    legend = BOSS_REWARDS.find(r => r.id === "summonTimeora");
  const legendaryAppears = !hasAlliedTimeora && legend && g.rng.next() < Number(legend.chance || .05),
    normalCount = legendaryAppears ? 2 : 3;
  while (out.length < normalCount) {
    const r = bossWeightedReward(g, used);
    if (!r) break;
    used.add(r.id);
    out.push({
      ...r
    });
  }
  if (legendaryAppears) {
    const at = Math.floor(g.rng.next() * (out.length + 1));
    out.splice(at, 0, {
      ...legend
    });
  }
  return out.slice(0, 3);
}
function bossGainOne(g, u) {
  if (!u || u.dead) return false;
  const max = card(u).maxEnergy || 4;
  if (totalEnergy(u) >= max - .001) return false;
  const t = teamOf(g, u) || "P",
    result = state_engine_effects.ENERGY_GAIN_SERVICE.grant({
      game: g,
      recipient: u,
      team: t,
      source: "boss-reward-random-energy",
      candidates: ["R", "W", "B"],
      amount: 1
    });
  return !!result.gained;
}
function bossApplyReward(g, reward, chooserRole) {
  const alive = [...g.teams.P.field, ...g.teams.P.bench].filter(u => u && !u.dead),
    field = g.teams.P.field.filter(u => u && !u.dead);
  if (reward.id === "energyPair") {
    for (const u of field.slice(0, 2)) bossGainOne(g, u);
  } else if (reward.id === "teamHeal") for (const u of alive) heal(g, u, 30, null, {
    reason: "boss-reward",
    effectId: "teamHeal"
  });else if (reward.id === "shieldPatch") for (const u of field) createShield(g, u, 35, 120);else if (reward.id === "clockReverse") {
    const c = bossClock(g);
    c.hourDeg = timeNormDeg(c.hourDeg - 60);
    bossSyncClock(g);
    state_ui_battle_state.visualEvents.push({
      type: "timeClockRotationFx",
      actionSerial: ++state_features_timeora.timeVisualSerial,
      actorUid: null,
      clocks: [{
        uid: "boss-shared-clock",
        team: "A",
        beforeHour: timeNormDeg(c.hourDeg + 60),
        beforeMinute: c.minuteDeg,
        afterHour: c.hourDeg,
        afterMinute: c.minuteDeg,
        hourDelta: 300,
        minuteDelta: 0,
        aligned: bossClockAligned(g),
        bossShared: true
      }]
    });
  } else if (reward.id === "bossDrain") for (const u of bossRedUnits(g).filter(x => !x.dead)) removeEnergy(g, u, 1, null);else if (reward.id === "hyperGuard") g.bossRaid.hyperGuard = Number(g.bossRaid.hyperGuard || 0) + 1;else if (reward.id === "revive") {
    const dead = g.teams.P.graveyard?.find(u => u?.dead) || [...g.teams.P.field, ...g.teams.P.bench].find(u => u?.dead);
    if (dead) {
      dead.dead = false;
      dead.hp = Math.min(dead.maxHp, 80);
      const fi = g.teams.P.field.findIndex(x => x?.uid === dead.uid),
        bi = g.teams.P.bench.findIndex(x => x?.uid === dead.uid);
      if (fi >= 0) g.teams.P.field[fi] = null;
      if (bi < 0) g.teams.P.bench.push(dead);
    }
  } else if (reward.id === "overdrive") {
    for (const u of alive) heal(g, u, 20, null, {
      reason: "boss-reward",
      effectId: "overdrive"
    });
    for (const u of field) bossGainOne(g, u);
  } else if (reward.id === "summonTimeora") {
    const u = makeUnit("timeora", bossRandomId("reward-timeora"));
    u.name = "지원 타임오러";
    u.bossOwner = g.bossRaid.online ? chooserRole || "host" : "solo";
    g.teams.P.bench.push(u);
    g.revealed.P.push(u.uid);
  }
  log(g, `레이드 보상 획득 · ${reward.name}: ${reward.desc}`, "turn");
}
function bossRewardKey(q) {
  return `${state_ui_battle_state.game?.matchId || "boss"}:${q?.serial || 0}`;
}
function bossRewardWaitForVisuals(q) {
  const key = bossRewardKey(q),
    delay = Math.max(0, Number(q?.visualDelayMs || 0));
  if (!bossRewardLocalReadyAt.has(key)) bossRewardLocalReadyAt.set(key, Date.now() + delay);
  const remain = Math.max(0, bossRewardLocalReadyAt.get(key) - Date.now());
  if (remain <= 0) return false;
  state_ui_battle_state.busy = true;
  systems.TimerManager.clear(bossRewardDelayTimer);
  bossRewardDelayTimer = systems.TimerManager.setTimeout(() => {
    bossRewardDelayTimer = 0;
    if (state_ui_battle_state.game?.pendingTraitChoices?.[0]?.kind === "bossReward") processPendingTraitChoice();
  }, remain + 24);
  return true;
}
function bossRewardHTML(q) {
  const labels = {
    common: "일반",
    uncommon: "고급",
    rare: "희귀",
    legendary: "전설"
  };
  return `<div class="boss-reward-shell"><h2 class="boss-reward-title">붉은 타임오러 처치 보상</h2><p data-boss-reward-status>세 보상 중 하나를 선택하세요. 강한 보상일수록 등장 확률이 낮습니다.</p><div class="boss-reward-grid">${q.options.map((r, i) => `<button type="button" class="boss-reward-card ${r.rarity}" data-boss-reward="${i}"><span class="boss-reward-rarity">${labels[r.rarity] || r.rarity}</span><span class="boss-reward-name">${r.name}</span><span class="boss-reward-desc">${r.desc}</span></button>`).join("")}</div></div>`;
}
function bossRewardSetStatus(text) {
  const el = document.querySelector("[data-boss-reward-status]");
  if (el) el.textContent = text;
}
function bossRewardSetDisabled(flag) {
  document.querySelectorAll("[data-boss-reward]").forEach(button => button.disabled = !!flag);
}
function bossClearRewardPickPending(reenable = false) {
  systems.TimerManager.clear(bossRewardPickRetryTimer);
  bossRewardPickRetryTimer = 0;
  bossRewardPickPending = null;
  if (reenable) {
    bossRewardSetDisabled(false);
    bossRewardSetStatus("세 보상 중 하나를 선택하세요. 강한 보상일수록 등장 확률이 낮습니다.");
  }
}
function bossSendGuestRewardPick(q, index) {
  bossClearRewardPickPending(false);
  const packet = {
    type: "bossRewardPick",
    mode: "BOSS_COOP",
    matchId: onlineCurrentMatchId(),
    serial: Number(q.serial || 0),
    index: Number(index),
    pickerRole: "guest"
  };
  bossRewardPickPending = {
    serial: packet.serial,
    index: packet.index,
    startedAt: Date.now(),
    packet
  };
  bossRewardSetDisabled(true);
  bossRewardSetStatus("보상 선택을 동료에게 전송 중…");
  const send = () => {
    const pending = bossRewardPickPending;
    if (!pending || pending.serial !== packet.serial) return;
    const cur = state_ui_battle_state.game?.pendingTraitChoices?.[0];
    if (!cur || cur.kind !== "bossReward" || Number(cur.serial) !== packet.serial) {
      bossClearRewardPickPending(false);
      return;
    }
    if (Date.now() - pending.startedAt > 6500) {
      bossClearRewardPickPending(true);
      bossRewardSetStatus("전송 확인이 지연되었습니다. 다시 선택하세요.");
      return;
    }
    try {
      p2pSend(packet);
    } catch (error) {
      systems.__megaRecordRecoveredError(error, "redTimeoraBossRaidScript:L497");
    }
  };
  send();
  bossRewardPickRetryTimer = systems.TimerManager.setInterval(send, 550);
}
function bossFinishReward(q, index, pickerRole = null) {
  if (bossRewardResolving || !state_ui_battle_state.game?.bossRaid) return false;
  const cur = state_ui_battle_state.game.pendingTraitChoices?.[0];
  if (!cur || cur.kind !== "bossReward" || Number(cur.serial) !== Number(q?.serial) || Number(state_ui_battle_state.game.bossRaid.rewardResolvedSerial || 0) >= Number(q?.serial || 0)) return false;
  const reward = cur.options?.[Number(index)];
  if (!reward) return false;
  bossRewardResolving = true;
  const visualMark = Array.isArray(state_ui_battle_state.visualEvents) ? state_ui_battle_state.visualEvents.length : 0;
  try {
    state_ui_battle_state.game.bossRaid.rewardResolvedSerial = Number(cur.serial || 0);
    state_ui_battle_state.game.pendingTraitChoices.shift();
    bossClearRewardPickPending(false);
    bossRewardLocalReadyAt.delete(bossRewardKey(cur));
    systems.TimerManager.clear(bossRewardDelayTimer);
    bossRewardDelayTimer = 0;
    bossApplyReward(state_ui_battle_state.game, reward, pickerRole || cur.chooserRole || "host");
    const rewardVisuals = state_ui_battle_state.game.bossRaid.online && state_ui_deck.p2p.role === "host" ? cloneOnlineVisualEvents((state_ui_battle_state.visualEvents || []).slice(visualMark)) : [];
    bossRewardModalSerial = null;
    const modal = document.getElementById("modal");
    modal?.classList.remove("open");
    if (modal) modal.style.pointerEvents = "";
    state_ui_battle_state.busy = false;
    render();
    bossSendState(true, rewardVisuals);
    if (!processPendingTraitChoice()) scheduleAI();
    return true;
  } catch (error) {
    console.error("[boss reward]", error);
    bossRewardSetDisabled(false);
    bossRewardSetStatus("선택 처리에 실패했습니다. 다시 선택하세요.");
    return false;
  } finally {
    bossRewardResolving = false;
  }
}
function bossHandleRewardClick(event) {
  const button = event.target?.closest?.("[data-boss-reward]");
  if (!button || button.disabled || bossRewardResolving) return;
  const current = state_ui_battle_state.game?.pendingTraitChoices?.[0];
  const serial = Number(button.dataset.bossRewardSerial || 0);
  if (!current || current.kind !== "bossReward" || Number(current.serial) !== serial) {
    bossRewardModalSerial = null;
    processPendingTraitChoice();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const index = Number(button.dataset.bossReward);
  if (state_ui_battle_state.game.bossRaid.online && state_ui_deck.p2p.role === "guest") bossSendGuestRewardPick(current, index);else if (!bossFinishReward(current, index, state_ui_battle_state.game.bossRaid.online ? state_ui_deck.p2p.role : "solo")) {
    bossRewardSetDisabled(false);
    bossRewardSetStatus("선택 처리에 실패했습니다. 다시 선택하세요.");
  }
}
function bossBindRewardButtons(q) {
  const current = state_ui_battle_state.game?.pendingTraitChoices?.[0];
  if (!current || current.kind !== "bossReward" || Number(current.serial) !== Number(q?.serial)) return false;
  const pendingSame = Number(bossRewardPickPending?.serial) === Number(current.serial);
  document.querySelectorAll("[data-boss-reward]").forEach(button => {
    button.type = "button";
    button.dataset.bossRewardSerial = String(current.serial);
    button.disabled = pendingSame || bossRewardResolving;
    button.onclick = null;
    button.style.pointerEvents = "auto";
  });
  return true;
}
function bossOpenReward(q) {
  try {
    if (typeof timeSetInputLock === "function") timeSetInputLock(false, false);
  } catch (error) {
    systems.__megaRecordRecoveredError(error, "redTimeoraBossRaidScript:L575");
  }
  document.body.classList.remove("time-input-locked");
  const modal = document.getElementById("modal");
  if (!modal) return false;
  modal.style.pointerEvents = "auto";
  modal.removeAttribute("aria-hidden");
  if (bossRewardModalSerial === q.serial && modal.classList.contains("open")) return bossBindRewardButtons(q);
  bossRewardModalSerial = q.serial;
  document.getElementById("modalContent").innerHTML = bossRewardHTML(q);
  modal.classList.add("open");
  return bossBindRewardButtons(q);
}
function bossLocalControlsCurrent(g = state_ui_battle_state.game) {
  if (!g?.bossRaid || g.winner) return false;
  const [t, s] = g.order[g.turn],
    u = unitAt(g, t, s);
  if (t !== "P") return false;
  if (!g.bossRaid.online) return true;
  return u?.bossOwner === state_ui_deck.p2p.role || !u && g.bossRaid.slotOwners?.[s] === state_ui_deck.p2p.role;
}
function renderBossActions(ctx = null) {
  const viewModel = ctx?.viewModel || state_ui_action_panel.ActionPanelViewModelOwner.build(state_ui_battle_state.game),
    local = !!viewModel?.boss?.localControl;
  const r = viewModel.surfaceKind === "manual-summon" ? renderManualSummonActions(viewModel) : renderBaseActions(viewModel);
  const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    current = unitAt(state_ui_battle_state.game, t, s);
  if (!state_ui_battle_state.game.winner && !local) document.getElementById("actionTitle").textContent = t === "A" ? "붉은 타임오러 계산 중…" : "동료 행동 대기 중…";
  if (local && t === "P" && !current && !state_ui_battle_state.game.winner) {
    const pass = [...document.querySelectorAll("#actionButtons button")].find(button => (button.textContent || "").includes("빈 슬롯 넘기기"));
    if (pass) pass.onclick = () => {
      if (execute(state_ui_battle_state.game, t, s, {
        type: "bossPassEmpty"
      })) afterAction();
    };
  }
  if (state_ui_battle_state.game.winner) {
    const box = document.getElementById("actionButtons");
    box.innerHTML = '<button id="bossRaidAgain" data-action-panel-meta="terminal">보스전 메뉴</button><button data-nav="setup" data-action-panel-meta="terminal">메인 메뉴</button>';
    document.getElementById("bossRaidAgain").onclick = showBossRaidMenu;
    box.querySelector('[data-nav]').onclick = () => state_ui_results.NavigationApplication.request("setup");
  }
  return r;
}
function bossSerialize(g = state_ui_battle_state.game) {
  return serializeOnlineBattleProjection(g);
}
function bossRevive(raw) {
  const g = JSON.parse(raw),
    rng = new RNG(g.seed);
  rng.s = g.rng?.s || rng.s;
  g.rng = rng;
  g.token = ++state_ui_battle_state.battleToken;
  g.mode = "bossOnline";
  bossSyncClock(g);
  return g;
}
function bossSendState(force = false, visuals = []) {
  if (!state_ui_battle_state.game?.bossRaid) return false;
  const packetVisuals = cloneOnlineVisualEvents(Array.isArray(visuals) ? visuals : []);
  const canHostSpectators = !state_ui_battle_state.game.bossRaid.online || state_ui_deck.p2p.role === "host" && state_ui_deck.p2p.connected;
  let sent = false;
  if (state_ui_battle_state.game.bossRaid.online && state_ui_deck.p2p.role === "host" && state_ui_deck.p2p.connected) {
    const ack = state_ui_deck.p2p?.__pendingAuthoritativeAck || null;
    if (state_ui_deck.p2p) state_ui_deck.p2p.__pendingAuthoritativeAck = null;
    sent = sendAuthoritativeOnlineState(packetVisuals, ack, force);
  }
  const spectator = systems.__megaSpectatorR18;
  if (spectator && canHostSpectators) {
    const spectatorVisuals = packetVisuals.length ? packetVisuals : cloneOnlineVisualEvents(state_ui_battle_state.visualEvents);
    if (spectatorVisuals.length) spectator.queueVisuals?.(spectatorVisuals);
    systems.TimerManager.setTimeout(() => {
      spectator.broadcastAnnounce?.();
      spectator.broadcastSnapshot?.(!!force);
    }, 0);
  }
  return sent;
}
function bossPassEmptySlot(g, t, s) {
  if (!g?.bossRaid || unitAt(g, t, s)) return false;
  endTurn(g, t, s, false);
  return true;
}
function bossHandlePacket(msg) {
  if (!msg || typeof msg !== "object") return false;
  if (msg.type === "bossLobbyState" && msg.protocol === BOSS_LOBBY_PROTOCOL) {
    if (state_ui_deck.p2p?.sessionMode !== "bossRaid" || state_ui_deck.p2p?.battleStarted) return false;
    if (msg.matchId && state_ui_deck.p2p.matchId && msg.matchId !== state_ui_deck.p2p.matchId) return false;
    state_ui_deck.p2p.bossRemoteDeck = bossSanitizeDeck(msg.deck, 2);
    state_ui_deck.p2p.bossRemotePlusStar = resolvePlusStarChoice(msg.plusStar, state_ui_deck.p2p.bossRemoteDeck, "A");
    state_ui_deck.p2p.bossRemoteReady = !!msg.ready && bossDeckValid(state_ui_deck.p2p.bossRemoteDeck, 2);
    showBossOnlineLobby();
    bossMaybeStartOnline();
    return true;
  }
  if (msg.type === "bossRewardOffer" && state_ui_deck.p2p.role === "guest") {
    if (state_ui_deck.p2p?.sessionMode !== "bossRaid" || !state_ui_battle_state.game?.bossRaid?.online || msg.mode !== "BOSS_COOP" || String(msg.matchId || "") !== String(state_ui_deck.p2p.matchId || state_ui_battle_state.game.matchId || "")) return false;
    if (state_ui_battle_state.game.pendingTraitChoices?.[0]?.serial !== msg.reward?.serial) {
      state_ui_battle_state.game.pendingTraitChoices ||= [];
      state_ui_battle_state.game.pendingTraitChoices.unshift(msg.reward);
    }
    processPendingTraitChoice();
    return true;
  }
  if (msg.type === "bossRewardPick" && state_ui_deck.p2p.role === "host") {
    if (state_ui_deck.p2p?.sessionMode !== "bossRaid" || !state_ui_battle_state.game?.bossRaid?.online || msg.mode !== "BOSS_COOP" || String(msg.matchId || "") !== String(state_ui_deck.p2p.matchId || state_ui_battle_state.game.matchId || "")) return false;
    const q = state_ui_battle_state.game?.pendingTraitChoices?.[0];
    if (q?.kind === "bossReward" && Number(q.serial) === Number(msg.serial)) bossFinishReward(q, Number(msg.index), msg.pickerRole || "guest");else bossSendState(true);
    return true;
  }
  return false;
}
function bossDecorateRender() {
  document.body.classList.toggle("boss-raid-active", !!state_ui_battle_state.game?.bossRaid);
  document.querySelectorAll(".slot.boss-active-slot").forEach(x => x.classList.remove("boss-active-slot"));
  if (!state_ui_battle_state.game?.bossRaid) {
    document.getElementById("bossSharedClockHud")?.remove();
    timeSyncSuppressionVisuals(state_ui_battle_state.game);
    return;
  }
  bossSyncClock(state_ui_battle_state.game);
  for (const u of bossRedUnits(state_ui_battle_state.game)) {
    u.bossRed = true;
    const el = document.querySelector(`.battle-unit-card[data-uid="${CSS.escape(String(u.uid))}"]`);
    el?.classList.add("red-timeora-card", "boss-red-live-card", "clock-owner-active");
    el?.setAttribute("data-boss-red-timeora", "true");
    el?.querySelector(".unit-stage")?.classList.add("boss-red-live-stage");
  }
  const activeCard = document.querySelector(".side .slot > .battle-unit-card.active-turn");
  activeCard?.closest(".slot")?.classList.add("boss-active-slot");
  for (const u of [...state_ui_battle_state.game.teams.P.field, ...state_ui_battle_state.game.teams.P.bench]) {
    if (!u?.bossOwner || u.bossOwner === "solo") continue;
    const el = document.querySelector(`.battle-unit-card[data-uid="${CSS.escape(String(u.uid))}"]`);
    if (el && !el.querySelector(".raid-owner-badge")) {
      const b = document.createElement("span");
      b.className = `raid-owner-badge ${u.bossOwner}`;
      b.textContent = u.bossOwner === "host" ? "P1" : "P2";
      el.appendChild(b);
    }
  }
  document.getElementById("bossSharedClockHud")?.remove();
  const aiHead = document.querySelector(".ai-side .side-head b"),
    pHead = document.querySelector(".player-side .side-head b");
  if (aiHead) aiHead.textContent = "붉은 시간 군단";
  if (pHead) pHead.textContent = state_ui_battle_state.game.bossRaid.online ? "레이드 연합 · P1/P2" : "레이드 연합";
  const aliveLabel = document.getElementById("AAlive");
  if (aliveLabel) aliveLabel.textContent = `생존 ${[...(state_ui_battle_state.game.teams.A.field || []), ...(state_ui_battle_state.game.teams.A.bench || [])].filter(u => u && !u.dead).length}/4 · 교체 불가`;
  timeSyncSuppressionVisuals(state_ui_battle_state.game);
}
function bossVisibleNormalPool() {
  const out = [],
    seenGroups = new Set();
  for (const rawId of bossRaidPool()) {
    if (typeof isInvaderCardId === "function" && isInvaderCardId(rawId)) continue;
    const raw = state_catalog_cards.CARDS.find(x => x.id === rawId);
    if (!raw) continue;
    const id = raw.formGroup ? setupFormState(raw.formGroup) || raw.id : raw.id;
    const cardDef = state_catalog_cards.CARDS.find(x => x.id === id);
    if (!cardDef) continue;
    if (cardDef.formGroup) {
      if (seenGroups.has(cardDef.formGroup)) continue;
      seenGroups.add(cardDef.formGroup);
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
function bossDeckCardHTML(id, selected, plusActive, surface = "boss-composition") {
  const c = state_catalog_cards.CARDS.find(x => x.id === id),
    next = c?.formGroup ? otherFormId(c.id) : null;
  const formToggle = next ? `<button type="button" class="form-toggle" data-boss-form="${c.formGroup}">${c.name} → ${state_catalog_cards.CARDS.find(x => x.id === next)?.name || c.name}</button>` : "";
  const slotIndex = bossRaidSelection.indexOf(id),
    effectiveCard = state_catalog_cards.EffectiveCardPresentationOwner.resolve(c, null, {
      deck: bossRaidSelection,
      plusStarChoice: bossPlusStarSelection,
      team: "P",
      slotIndex,
      surface
    });
  const plusToggle = state_catalog_cards.PLUS_STAR_ELIGIBLE.has(id) ? `<button type="button" class="plusstar-toggle ${effectiveCard.plusStar ? "active" : ""}" data-action="toggle-plusstar" data-plusstar-card="${id}" data-boss-plus-star="${id}" aria-pressed="${effectiveCard.plusStar}">🎆</button>` : "";
  return `<div class="boss-deck-card ${selected ? "selected" : ""} ${effectiveCard.visualModifiers.glowClass}" data-info-card="setup" data-info-surface="${surface}" data-info-team="P" data-info-slot-index="${slotIndex}" data-card-id="${id}" data-boss-card="${id}" data-effective-character-id="${effectiveCard.effectiveCharacterId}" data-effective-plus-star="${effectiveCard.plusStar}" data-effective-deck-slot="${effectiveCard.exactDeckSlot || ""}">${pictogramHTML("small", effectiveCard.effectiveCharacterId)}<h3 class="card-title-line"><span>${effectiveCard.displayName}</span><span class="tiny">${effectiveCard.rarity}</span></h3><div class="tiny muted">HP ${c.maxHp} · 실드 ${c.shield || 0}</div>${formToggle}${plusToggle}</div>`;
}
function bossCurrentInvader() {
  return bossRaidSelection.find(id => typeof isInvaderCardId === "function" && isInvaderCardId(id)) || null;
}
function bossApplyInvaderFromPortal(id, count, online, index) {
  const result = BossLobbyApplication.applyInvader(id, count, online);
  if (result.applied) {
    showBossDeckPicker(count, online);
    return;
  }
  const card = state_catalog_cards.CARDS.find(x => x.id === id);
  const root = document.getElementById("modalContent");
  root.dataset.bossLobbySubview = "portal-replace";
  root.innerHTML = `<div class="invader-selector"><h2>${card?.name || id} 적용</h2><p>덱이 가득 찼습니다. 교체할 캐릭터를 선택하세요.</p><div class="invader-replace-list">${bossRaidSelection.map((cardId, i) => `<button data-boss-invader-replace="${i}">${state_catalog_cards.CARDS.find(x => x.id === cardId)?.name || cardId} 교체</button>`).join("")}</div><button id="bossInvaderReplaceCancel">취소</button></div>`;
  document.querySelectorAll("[data-boss-invader-replace]").forEach(button => button.onclick = () => {
    if (BossLobbyApplication.replaceInvader(Number(button.dataset.bossInvaderReplace), id, count, online)) showBossDeckPicker(count, online);
  });
  document.getElementById("bossInvaderReplaceCancel").onclick = () => bossRenderInvaderPortal(count, online, index);
}
function bossRenderInvaderPortal(count, online, index = 0) {
  BossLobbyApplication.preparePortal(online);
  state_ui_battle_state.InvaderPortalView.renderSelector({
    prefix: "invaderPortalBoss",
    index,
    selectedId: bossCurrentInvader(),
    onIndex: next => bossRenderInvaderPortal(count, online, next),
    onApply: (id, normalized) => bossApplyInvaderFromPortal(id, count, online, normalized),
    onClear: () => {
      BossLobbyApplication.clearInvader(count, online);
      showBossDeckPicker(count, online);
    },
    onCancel: () => showBossDeckPicker(count, online),
    emptyButtonLabel: "대기실로 돌아가기"
  });
  const root = document.getElementById("modalContent");
  if (root) root.dataset.bossLobbySubview = "portal";
}
function showBossDeckPicker(count = 4, online = false) {
  const initialScroll = typeof captureOnlineLobbyScroll === "function" ? captureOnlineLobbyScroll("boss") : null;
  BossLobbyApplication.normalizeDraft(count);
  const root = document.getElementById("modalContent");
  if (!root) return;
  delete root.dataset.bossLobbySubview;
  const currentInvader = bossCurrentInvader();
  root.innerHTML = `<div class="boss-lobby"><h2>${online ? "붉은 레이드 온라인 대기실" : "솔로 레이드 덱 편성"}</h2><div id="bossDeckStatus" class="boss-lobby-status"></div><div id="bossDeckGrid" class="boss-deck-grid"></div>${state_ui_battle_state.InvaderPortalView.buttonHTML({
    buttonId: "bossInvaderPortalButton",
    selectedId: currentInvader,
    areaClass: "online-invader-portal-area"
  })}<div class="choice-list"><button id="bossDeckConfirm" class="primary">${online ? "준비 완료" : "보스전 시작"}</button><button id="bossDeckBack">뒤로</button></div><p class="tiny muted">타임오러는 편성할 수 없습니다. 침략자는 초차원 포탈에서 최대 한 명만 선택합니다. ${online ? "각 플레이어가 2명을 선택하며 자기 슬롯·폼·PlusStar만 조작합니다." : "4명을 선택하며 PlusStar는 덱에서 최대 한 명입니다."}</p></div>`;
  const draw = () => {
    const drawScroll = typeof captureOnlineLobbyScroll === "function" ? captureOnlineLobbyScroll("boss") : null;
    const inv = bossCurrentInvader(),
      status = document.getElementById("bossDeckStatus");
    if (status) status.textContent = `선택 ${bossRaidSelection.length}/${count}${inv ? ` · 침략자 ${state_catalog_cards.CARDS.find(x => x.id === inv)?.name || inv}` : ""}${online ? ` · 동료 ${state_ui_deck.p2p.bossRemoteDeck?.length || 0}/2` : ""}`;
    const grid = document.getElementById("bossDeckGrid");
    if (!grid) return;
    const normalPool = bossVisibleNormalPool();
    grid.innerHTML = normalPool.map(id => bossDeckCardHTML(id, bossRaidSelection.includes(id), isPlusStarChoiceForCard(bossPlusStarSelection, bossRaidSelection, id, "P"), online ? "boss-coop" : "boss-composition")).join("");
    grid.querySelectorAll("[data-boss-card]").forEach(el => el.onclick = event => {
      if (event.target.closest(".form-toggle,.plusstar-toggle")) return;
      const id = el.dataset.bossCard;
      if (BossLobbyApplication.toggleCard(id, count, online)) draw();
    });
    grid.querySelectorAll("[data-boss-form]").forEach(button => button.onclick = event => {
      event.stopPropagation();
      const group = button.dataset.bossForm,
        visible = button.closest("[data-boss-card]")?.dataset.bossCard,
        next = otherFormId(visible);
      if (!next) return;
      BossLobbyApplication.changeForm(group, next, count, online);
      showBossDeckPicker(count, online);
    });
    const bossPlusContext = {
      surface: online ? "boss-coop-lobby" : "boss-composition",
      scope: String(state_ui_deck.p2p.matchId || state_ui_deck.p2p.roomCode || "boss"),
      team: "P"
    };
    state_engine_entities.PlusStarBannerPresentationOwner.bind(grid, button => {
      const result = state_engine_entities.PlusStarInteractionOwner.apply({
        ...bossPlusContext,
        deck: bossRaidSelection,
        currentChoice: bossPlusStarSelection,
        cardId: button.dataset.plusstarCard,
        capacity: count,
        validate: proposal => bossSanitizeDeck(proposal, count).length === proposal.length && validFormDeck(proposal),
        commit: (nextDeck, nextChoice) => BossLobbyApplication.commitPlusStar(nextDeck, nextChoice, count, online),
        feedback: message => {
          const status = document.getElementById("bossDeckStatus");
          if (status) status.textContent = message;
        }
      });
      if (result.ok) draw();
    });
    state_engine_entities.PlusStarBannerPresentationOwner.sync(grid, bossPlusContext, bossRaidSelection, bossPlusStarSelection);
    const confirm = document.getElementById("bossDeckConfirm");
    if (confirm) confirm.disabled = !bossDeckValid(bossRaidSelection, count);
    state_ui_battle_state.InvaderPortalView.sync("bossInvaderPortalButton", bossCurrentInvader());
    if (online) bossRefreshOnlineLobby();
    if (typeof restoreOnlineLobbyScroll === "function") restoreOnlineLobbyScroll("boss", drawScroll);
  };
  draw();
  document.getElementById("bossInvaderPortalButton").onclick = () => bossRenderInvaderPortal(count, online, 0);
  document.getElementById("bossDeckBack").onclick = () => online ? bossCancelMatchmaking() : showBossRaidMenu();
  document.getElementById("bossDeckConfirm").onclick = () => {
    if (!bossDeckValid(bossRaidSelection, count)) return;
    if (online) {
      BossLobbyApplication.toggleReady("ready-button");
    } else {
      const g = bossCreateGame([...bossRaidSelection], null, false, {
        host: bossPlusStarSelection
      });
      document.querySelector(".boss-lobby")?.classList.add("boss-lobby-closing");
      systems.TimerManager.setTimeout(() => {
        document.getElementById("modal").classList.remove("open");
        bossLaunch(g);
      }, 480);
    }
  };
  document.getElementById("modal").classList.add("open");
  if (typeof restoreOnlineLobbyScroll === "function") restoreOnlineLobbyScroll("boss", initialScroll);
}
function showBossOnlineLobby(force = false) {
  if (!bossTransportUsable()) {
    if (!force) bossResumeOnlineSession("open-lobby");
    return false;
  }
  const root = document.getElementById("modalContent");
  if (!force && bossLobbySubviewOpen()) {
    document.getElementById("modal")?.classList.add("open");
    bossStartLobbyHeartbeat();
    return;
  }
  const grid = document.getElementById("bossDeckGrid");
  if (force || !root?.querySelector(".boss-lobby") || !grid?.childElementCount) showBossDeckPicker(2, true);
  document.getElementById("modal")?.classList.add("open");
  bossRefreshOnlineLobby();
  bossStartLobbyHeartbeat();
}
function bossMaybeStartOnline() {
  if (state_ui_deck.p2p.role !== "host" || state_ui_deck.p2p.battleStarted || state_ui_deck.p2p.onlineStartPending || !state_ui_deck.p2p.bossLocalReady || !state_ui_deck.p2p.bossRemoteReady || !bossCombinedDeckValid(state_ui_deck.p2p.bossLocalDeck || bossRaidSelection, state_ui_deck.p2p.bossRemoteDeck || [])) return false;
  const g = bossCreateGame(state_ui_deck.p2p.bossLocalDeck || bossRaidSelection, state_ui_deck.p2p.bossRemoteDeck, true, {
    host: state_ui_deck.p2p.bossLocalPlusStar,
    guest: state_ui_deck.p2p.bossRemotePlusStar
  });
  const startTransactionId = `start:${g.matchId}:boss`;
  const startPacket = {
    type: "start",
    mode: "BOSS_COOP",
    protocol: "mega-online-start-r1",
    state: bossSerialize(g),
    matchId: g.matchId,
    battleId: `boss:${g.matchId}`,
    startTransactionId,
    sessionGeneration: Number(systems.OnlineRuntime?.identity?.().generation || 0)
  };
  startPacket.packetDigest = onlineStartPacketDigest(startPacket);
  bossPendingStartGame = g;
  state_ui_deck.p2p.onlineStartPending = true;
  state_ui_deck.p2p.battleStarted = false;
  state_ui_deck.p2p.startCommitPacket = clone(startPacket);
  state_ui_deck.p2p.startCommitAck = null;
  state_ui_deck.p2p.startCommitTrace = {
    state: "COMMITTED_AWAITING_ACK",
    scope: g.matchId,
    at: Date.now(),
    publicationCount: 0,
    republishCount: 0
  };
  const sent = !!systems.OnlineRuntime?.sendControl?.(startPacket);
  state_ui_deck.p2p.startCommitTrace.publicationCount = sent ? 1 : 0;
  traceOnlineStart("START_PACKET_SENT", startPacket, {
    sent,
    mode: "BOSS_COOP"
  });
  scheduleOnlineStartPublicationRetry(startPacket, 1);
  const status = document.querySelector(".boss-lobby-status");
  if (status) status.textContent = "전투 시작 확인 중…";
  bossRefreshOnlineLobby();
  return true;
}
function bossCommitPendingStart(packet) {
  const g = bossPendingStartGame;
  if (!g || String(g.matchId || "") !== String(packet?.matchId || "")) return false;
  bossPendingStartGame = null;
  state_ui_deck.p2p.onlineStartPending = false;
  state_ui_deck.p2p.battleStarted = true;
  g.battleStarted = true;
  bossStopLobbyHeartbeat();
  document.getElementById("modal")?.classList.remove("open", "boss-lobby-closing");
  bossLaunch(g);
  return true;
}
function bossAbortPendingStart(reason = "boss-start-aborted") {
  bossPendingStartGame = null;
  state_ui_deck.p2p.onlineStartPending = false;
  state_ui_deck.p2p.battleStarted = false;
  state_ui_deck.p2p.bossLocalReady = false;
  if (bossTransportUsable()) {
    bossStartLobbyHeartbeat();
    BossLobbyApplication.publish(`start-aborted:${reason}`);
    bossRefreshOnlineLobby();
  }
  return true;
}
function bossMatchStatus(text) {
  const s = bossRaidNetwork;
  if (!bossMatchUiAllowed || !s || !s.active || s.matched) return false;
  document.getElementById("modalContent").innerHTML = `<div class="boss-lobby"><h2>붉은 레이드 동료 탐색</h2><div class="boss-lobby-status">${text}</div><div style="display:grid;place-items:center;padding:26px"><span class="boss-red-hourglass" style="font-size:64px">⏳</span></div><div class="choice-list"><button id="bossMatchCancel">매칭 취소</button></div></div>`;
  document.getElementById("bossMatchCancel").onclick = bossCancelMatchmaking;
  document.getElementById("modal").classList.add("open");
  return true;
}
function bossStopNetwork() {
  bossStopLobbyHeartbeat();
  if (bossRaidNetwork) bossRaidNetwork.active = false;
  bossRaidNetwork = null;
}
function bossAbortMatchmaking({
  showMenu = false,
  closeModal = true
} = {}) {
  /* R38: 보스 수색 취소는 보스 연결만 정리한다. 일반 온라인 세션이 숨겨진 상태에서
     솔로 보스전을 열어도 일반 conn/peer/connected 상태를 건드리지 않는다. */
  const bossSession = state_ui_deck.p2p.sessionMode === "bossRaid" || state_ui_deck.p2p.matchType === "bossRaid";
  const hadBossSearch = !!bossRaidNetwork;
  bossMatchUiAllowed = false;
  bossStopNetwork();
  if (systems.OnlineRuntime?.debug?.().mode === "BOSS_COOP") systems.OnlineRuntime.cleanup.close("boss-matchmaking-abort", {
    notify: true
  });
  if (bossSession) {
    try {
      state_ui_deck.p2p.conn?.close?.();
    } catch (error) {
      systems.__megaRecordRecoveredError(error, "redTimeoraBossRaidScript:L969");
    }
    try {
      state_ui_deck.p2p.peer?.destroy?.();
    } catch (error) {
      systems.__megaRecordRecoveredError(error, "redTimeoraBossRaidScript:L970");
    }
    state_ui_deck.p2p.conn = null;
    state_ui_deck.p2p.peer = null;
    state_ui_deck.p2p.connected = false;
    state_ui_deck.p2p.connectionInterrupted = false;
    state_ui_deck.p2p.battleStarted = false;
    state_ui_deck.p2p.sessionMode = null;
    state_ui_deck.p2p.matchType = null;
    state_ui_deck.p2p.matchId = null;
    state_ui_deck.p2p.remotePeerId = null;
    state_ui_deck.p2p.bossLocalDeck = [];
    state_ui_deck.p2p.bossRemoteDeck = [];
    state_ui_deck.p2p.bossLocalPlusStar = null;
    state_ui_deck.p2p.bossRemotePlusStar = null;
    state_ui_deck.p2p.bossLocalReady = false;
    state_ui_deck.p2p.bossRemoteReady = false;
  } else if (hadBossSearch) {
    /* 매칭 성립 전 검색 자원은 bossStopNetwork()가 정리한다. 일반 온라인 상태는 보존한다. */
    state_ui_deck.p2p.bossLocalDeck = [];
    state_ui_deck.p2p.bossRemoteDeck = [];
    state_ui_deck.p2p.bossLocalPlusStar = null;
    state_ui_deck.p2p.bossRemotePlusStar = null;
    state_ui_deck.p2p.bossLocalReady = false;
    state_ui_deck.p2p.bossRemoteReady = false;
  }
  if (closeModal) document.getElementById("modal")?.classList.remove("open");
  if (showMenu) showBossRaidMenu();
  return true;
}
function bossCancelMatchmaking() {
  return bossAbortMatchmaking({
    showMenu: true,
    closeModal: false
  });
}
function bossDebug() {
  const s = bossRaidNetwork;
  return {
    active: !!s?.active,
    matched: !!s?.matched,
    networkPresent: !!s,
    guestPending: state_online_commands.OnlineActionAdmissionOwner.hasPending(),
    lobbyHeartbeat: !!bossLobbyHeartbeatTimer,
    sessionMode: state_ui_deck.p2p?.sessionMode || null
  };
}
function bossCloseSession() {
  bossMatchUiAllowed = false;
  bossPendingStartGame = null;
  bossStopNetwork();
  if (state_ui_deck.p2p) {
    state_ui_deck.p2p.bossLocalDeck = [];
    state_ui_deck.p2p.bossRemoteDeck = [];
    state_ui_deck.p2p.bossLocalPlusStar = null;
    state_ui_deck.p2p.bossRemotePlusStar = null;
    state_ui_deck.p2p.bossLocalReady = false;
    state_ui_deck.p2p.bossRemoteReady = false;
    state_ui_deck.p2p.__bossStartReceivedMatchId = null;
    if (state_ui_deck.p2p.startRetryTimerId) systems.OnlineRuntime?.sessionScope?.cancel?.(state_ui_deck.p2p.startRetryTimerId);
    state_ui_deck.p2p.startRetryTimerId = 0;
    state_ui_deck.p2p.onlineStartPending = false;
    state_ui_deck.p2p.startCommitPacket = null;
    state_ui_deck.p2p.startCommitAck = null;
    state_ui_deck.p2p.startCommitTrace = null;
  }
  return bossDebug();
}
function bossFinalizeMatch(s, remote, role, matchId, rawConnection = null) {
  if (!s.active || s.matched || !rawConnection) return;
  s.matched = true;
  s.active = true;
  state_ui_deck.p2p.remotePeerId = rawConnection.peer || remote;
  state_ui_deck.p2p.conn = rawConnection;
  state_ui_deck.p2p.connected = true;
  state_ui_deck.p2p.role = role;
  state_ui_deck.p2p.matchId = matchId || bossRandomId("boss-match");
  state_ui_deck.p2p.roomCode = "붉은 레이드";
  state_ui_deck.p2p.sessionMode = "bossRaid";
  state_ui_deck.p2p.matchType = "bossRaid";
  state_ui_deck.p2p.bossLocalDeck = [];
  state_ui_deck.p2p.bossRemoteDeck = [];
  state_ui_deck.p2p.bossLocalPlusStar = null;
  state_ui_deck.p2p.bossRemotePlusStar = null;
  state_ui_deck.p2p.bossLocalReady = false;
  state_ui_deck.p2p.bossRemoteReady = false;
  state_ui_deck.p2p.battleStarted = false;
  bossPendingStartGame = null;
  state_ui_deck.p2p.onlineStartPending = false;
  state_ui_deck.p2p.__bossStartReceivedMatchId = null;
  const boundBossConn = rawConnection;
  const boundBossMatchId = state_ui_deck.p2p.matchId;
  state_online_commands.onlineAuthoritativeRevision = 0;
  state_online_commands.OnlineActionAdmissionOwner.resetBattle();
  state_ui_deck.p2p.lastAuthoritativeRevision = 0;
  state_ui_deck.p2p.lastVisualPacketId = null;
  const onConnectionOpen = () => {
    if (state_ui_deck.p2p.conn !== boundBossConn || state_ui_deck.p2p.sessionMode !== "bossRaid" || state_ui_deck.p2p.matchId !== boundBossMatchId) return;
    state_ui_deck.p2p.connected = true;
    state_ui_deck.p2p.connectionInterrupted = false;
    if (state_ui_battle_state.game?.bossRaid?.online) {
      state_ui_battle_state.game.connectionInterrupted = false;
      if (state_ui_deck.p2p.role === "host") sendAuthoritativeOnlineState([], null, true);else onlineSafeSend({
        type: "stateRequest",
        protocol: state_online_commands.ONLINE_TURN_SYNC_VERSION,
        mode: "BOSS_COOP",
        matchId: state_ui_deck.p2p.matchId,
        actionId: state_online_commands.OnlineActionAdmissionOwner.pendingActionId(),
        knownTurnSerial: state_ui_battle_state.game.turnSerial,
        knownRevision: state_ui_deck.p2p.lastAuthoritativeRevision || 0,
        resumeReason: "connection-open"
      });
    } else {
      bossStartLobbyHeartbeat();
      BossLobbyApplication.publish("lobby-state");
      bossRefreshOnlineLobby();
    }
    systems.__megaSyncOnlineChatUI?.();
  };
  const onConnectionClose = () => {
    if (state_ui_deck.p2p.conn !== boundBossConn || state_ui_deck.p2p.sessionMode !== "bossRaid" || state_ui_deck.p2p.matchId !== boundBossMatchId) return;
    state_ui_deck.p2p.connected = false;
    state_ui_deck.p2p.connectionInterrupted = true;
    if (state_ui_battle_state.game?.bossRaid?.online) state_ui_battle_state.game.connectionInterrupted = true;else {
      bossRefreshOnlineLobby();
      systems.OnlineRuntime?.sessionScope?.setTimeout?.(() => bossResumeOnlineSession("connection-reopen"), 120, "boss-lobby-reopen", {
        phase: "LOBBY"
      });
    }
  };
  state_online_connection.OnlineConnectionEngine.bind(boundBossConn, {
    phase: "session",
    owner: "online-runtime-boss",
    role,
    source: "native-relay",
    onOpen: onConnectionOpen,
    onClose: onConnectionClose
  });
  bossRaidSelection = [];
  bossPlusStarSelection = null;
  state_ui_deck.p2p.bossLocalPlusStar = null;
  state_ui_deck.p2p.bossRemotePlusStar = null;
  showBossOnlineLobby(true);
  systems.__megaSyncOnlineChatUI?.();
}
function bossResumeOnlineSession(reason = "resume", requestTransport = true) {
  if (requestTransport && systems.OnlineRuntime?.debug?.().mode === "BOSS_COOP") systems.OnlineRuntime.lifecycle.foreground(reason);
  if (bossLobbyActive()) {
    bossStopLobbyHeartbeat();
    bossStartLobbyHeartbeat();
    BossLobbyApplication.publish("lobby-state");
    bossRefreshOnlineLobby();
    return true;
  }
  if (!state_ui_battle_state.game?.bossRaid?.online) return false;
  if (state_ui_deck.p2p?.conn?.open) {
    if (state_ui_battle_state.game.winner) {
      systems.TimerManager.clear(bossVictoryDelayTimer);
      bossVictoryDelayTimer = 0;
      showEnd();
    }
    if (state_ui_battle_state.game.pendingTraitChoices?.[0]?.kind === "bossReward") {
      systems.TimerManager.clear(bossRewardDelayTimer);
      bossRewardDelayTimer = 0;
      const pending = bossRewardPickPending,
        current = state_ui_battle_state.game.pendingTraitChoices[0];
      if (state_ui_deck.p2p.role === "guest" && pending && Number(pending.serial) === Number(current.serial)) bossSendGuestRewardPick(current, pending.index);else processPendingTraitChoice();
    }
    if (state_ui_deck.p2p.role === "host") {
      bossSendState(true);
      const [team] = state_ui_battle_state.game.order?.[state_ui_battle_state.game.turn] || [];
      if (team === "A" && !state_ui_battle_state.game.winner && !state_ui_battle_state.game.pendingTraitChoices?.length) {
        if (bossOnlineAiTimer) systems.OnlineRuntime?.sessionScope?.cancel?.(bossOnlineAiTimer);
        bossOnlineAiTimer = 0;
        state_ui_battle_state.busy = false;
        scheduleAI();
      }
    } else {
      onlineSafeSend({
        type: "stateRequest",
        protocol: state_online_commands.ONLINE_TURN_SYNC_VERSION,
        mode: "BOSS_COOP",
        matchId: state_ui_deck.p2p.matchId,
        actionId: state_online_commands.OnlineActionAdmissionOwner.pendingActionId(),
        knownTurnSerial: state_ui_battle_state.game.turnSerial,
        knownRevision: state_ui_deck.p2p.lastAuthoritativeRevision || 0,
        resumeReason: reason
      });
    }
    return true;
  }
  return false;
}
function bossPauseOnlineSession(reason = "background") {
  if (bossOnlineAiTimer) systems.OnlineRuntime?.sessionScope?.cancel?.(bossOnlineAiTimer);
  bossOnlineAiTimer = 0;
  if (state_ui_battle_state.game?.bossRaid?.online) {
    state_ui_battle_state.busy = true;
    return true;
  }
  return false;
}
function bossStartMatchmaking() {
  bossMatchUiAllowed = false;
  bossStopNetwork();
  systems.NetworkEngine.closeOnline({
    reason: "boss-matchmaking-start",
    clearChat: false,
    returnToLobby: false
  });
  const s = bossRaidNetwork = {
    active: true,
    matched: false
  };
  bossMatchUiAllowed = true;
  systems.OnlineRuntime?.ui?.showMatchmaking?.("BOSS_COOP");
  const started = systems.OnlineRuntime?.matchmaking?.start?.("BOSS_COOP");
  if (!started && systems.OnlineRuntime?.debug?.().state !== "FAILED") bossMatchStatus("공용 online runtime을 시작하지 못했습니다.");
  return started;
}
function showBossRaidMenu() {
  if (bossRaidNetwork?.active && !bossRaidNetwork.matched) bossAbortMatchmaking({
    showMenu: false,
    closeModal: false
  });
  bossMatchUiAllowed = false;
  BossLobbyApplication.resetDraft("boss-menu-open");
  document.getElementById("modalContent").innerHTML = `<div class="boss-select-shell"><h2>보스전</h2><div class="boss-select-card"><div class="boss-select-title"><span class="boss-red-hourglass">⏳</span><span>붉은 시간의 군단</span></div><div class="boss-difficulty">난이도 4.5</div><div class="boss-select-desc">동기화된 붉은 타임오러 4명이 하나의 공용 시계를 사용합니다. 처치할 때마다 희귀도 기반 보상 3개 중 하나를 선택합니다.<br><b>사용 불가: 타임오러</b></div></div><div class="boss-mode-buttons"><button id="bossSolo" class="primary">솔로 · 캐릭터 4명</button><button id="bossMulti">온라인 협동 · 각자 2명</button><button id="bossSpectate">진행 중 보스전 관전</button></div><button id="bossMenuClose">닫기</button></div>`;
  document.getElementById("bossSolo").onclick = () => {
    bossAbortMatchmaking({
      showMenu: false,
      closeModal: false
    });
    showBossDeckPicker(4, false);
  };
  document.getElementById("bossMulti").onclick = bossStartMatchmaking;
  document.getElementById("bossSpectate").onclick = () => systems.__megaSpectatorR18?.openBoss?.();
  document.getElementById("bossMenuClose").onclick = () => bossAbortMatchmaking({
    showMenu: false,
    closeModal: true
  });
  document.getElementById("modal").classList.add("open");
}
function installBossButton() {
  if (document.getElementById("bossRaidBtn")) return;
  const online = document.getElementById("onlineBtn"),
    b = document.createElement("button");
  b.id = "bossRaidBtn";
  b.textContent = "보스전";
  b.onclick = showBossRaidMenu;
  online?.insertAdjacentElement("afterend", b);
}
let bossRulesReady = false;
export function bossCard(u) {
  if (!bossRulesReady) return cardCore.apply(this, arguments);
  const legacy = LEGACY_CARD_ALIASES[u?.card];
  return u?.bossRed || legacy?.bossRed ? RED_TIMEORA_CARD : cardCore(u);
}
export function bossTimeThemeForTeam(g, t) {
  if (!bossRulesReady) return timeThemeForTeamCore.apply(this, arguments);
  return g?.bossRaid && (t === "A" || t === "__bossRed") ? "red" : timeThemeForTeamCore(g, t);
}
export function bossTimeColorForTeam(g, t) {
  if (!bossRulesReady) return timeColorForTeamCore.apply(this, arguments);
  return g?.bossRaid && (t === "A" || t === "__bossRed") ? "#ff4058" : timeColorForTeamCore(g, t);
}
export function bossTimeClockMiniHTML(u, g) {
  if (!bossRulesReady) return timeClockMiniHTMLCore.apply(this, arguments);
  if (!u?.bossRed) return timeClockMiniHTMLCore(u, g);
  const c = bossClock(g),
    aligned = bossClockAligned(g);
  return `<div class="time-mini-clock-wrap boss-red-clock-wrap"><div class="time-mini-clock red"><span class="time-clock-hand hour" style="transform:translateX(-50%) rotate(${timeNormDeg(c.hourDeg)}deg)"></span><span class="time-clock-hand minute" style="transform:translateX(-50%) rotate(${timeNormDeg(c.minuteDeg)}deg)"></span><span class="time-clock-pin"></span><span class="time-clock-word">Time</span></div><div><b>붉은 공용 시계</b><br><span>시침 ${timeNormDeg(c.hourDeg)}° · 분침 ${timeNormDeg(c.minuteDeg)}°</span><br><span class="time-mini-state ${aligned ? "aligned" : ""}">${aligned ? "정렬 · 플레이어 특성 정지" : "비정렬"}</span></div></div>`;
}
export function bossCardTooltipHTML(c, u = null) {
  if (!bossRulesReady) return cardTooltipHTMLCore.apply(this, arguments);
  /* 전투 유닛은 내부적으로 timeora 카드를 유지하므로, 붉은 개체의 설명창만 전용 카드 데이터로 렌더링한다. */
  let html = cardTooltipHTMLCore(u?.bossRed ? {
    ...RED_TIMEORA_CARD,
    id: "timeora"
  } : c, u);
  if (!u?.bossRed || !state_ui_battle_state.game?.bossRaid) return html;
  html = html.replace(/time-mini-clock (?:blue|gold)/g, "time-mini-clock red").replace(/time-mini-clock-wrap/g, "time-mini-clock-wrap boss-red-clock-wrap");
  if (!html.includes("boss-red-clock-wrap")) html = html.replace('</div><div class="card-info-section"><b>특성</b>', `</div>${timeClockMiniHTML(u, state_ui_battle_state.game)}<div class="card-info-section"><b>특성</b>`);
  html = html.replace(/붉은 타임오러(?: \d+)?/g, "타임오러");
  return `<div class="boss-red-timeora-tooltip-content">${html}</div>`;
}
export function bossQueueSkillVisual(g, actor, target, skill, effects = []) {
  if (!bossRulesReady) return queueSkillVisualCore.apply(this, arguments);
  if (g?.bossRaid && skillDefHasEffect(skill, "bossTimeStrike")) {
    if (typeof state_ui_battle_state.game !== "undefined" && g === state_ui_battle_state.game) state_ui_battle_state.visualEvents.push({
      type: "bossTimeStrikeFx",
      uid: actor.uid,
      targetUid: target?.uid || null
    });
    return;
  }
  return queueSkillVisualCore(g, actor, target, skill, effects);
}
export function bossPlayVisuals() {
  if (!bossRulesReady) return playVisualsCanonical.apply(this, arguments);
  const custom = state_ui_battle_state.visualEvents.filter(v => v?.type === "bossTimeStrikeFx"),
    rest = state_ui_battle_state.visualEvents.filter(v => v?.type !== "bossTimeStrikeFx");
  state_ui_battle_state.visualEvents = rest;
  custom.forEach((v, i) => systems.TimerManager.setTimeout(() => bossPlayTimeStrikeFx(v), i * 100));
  if (custom.length) state_ui_battle_state.visualHoldMs = Math.max(state_ui_battle_state.visualHoldMs, 620);
  return playVisualsCanonical();
}
export function bossActionHeuristic(g, t, s, a) {
  if (!bossRulesReady) return actionHeuristicSpecialist.apply(this, arguments);
  let score = actionHeuristicSpecialist(g, t, s, a),
    u = unitAt(g, t, s);
  if (!g?.bossRaid || !u?.bossRed) return score;
  score += bossPhaseActionScore(g, t, s, a);
  if (actionSkillHasEffect(a, "bossTimeStrike")) score += Number(a.bossTimeStrikeDamage || 40) * .9;
  if (actionSkillHasEffect(a, "hyperClock")) {
    const target = a.target ? unitAt(g, a.target.team, a.target.slot) : null,
      raw = bossClockPhase(g).aligned ? 160 : 100;
    score += raw + (target && target.hp + target.shield <= raw ? 430 : 0);
  }
  if (actionSkillHasEffect(a, "timeRecall") && a.target) {
    const target = unitAt(g, a.target.team, a.target.slot),
      v = timeRecallValue(target);
    score += (a.target.team === t ? v * 1.35 : -v * 1.2) + Math.max(0, v) * .5;
  }
  return score;
}
export function bossAiReason(g, t, s, a) {
  if (!bossRulesReady) return aiReasonCore.apply(this, arguments);
  const u = unitAt(g, t, s);
  if (g?.bossRaid && u?.bossRed) {
    const p = bossActionPhasePlan(g, t, s, a);
    if (actionSkillHasEffect(a, "bossTimeStrike")) return p.after.aligned ? "타임 크래시로 공용 시계를 즉시 정렬한다." : "타임 크래시로 공용 시계를 정렬에 가까운 상태로 조정한다.";
    if (a?.type === "gather") return "시간 가속으로 필요한 에너지를 준비하면서 유리한 시계 상태를 유지한다.";
    if (actionSkillHasEffect(a, "hyperClock")) return p.before.aligned ? "정렬된 공용 시계를 이용해 강화 하이퍼클락을 사용한다." : "하이퍼클락으로 공격하면서 다음 시계 정렬 경로를 유지한다.";
    if (actionSkillHasEffect(a, "timeRecall")) return "타임리콜로 큰 복구 이득을 얻을 수 있어 우선 사용한다.";
  }
  return aiReasonCore(g, t, s, a);
}
export function bossCheckDeath(g, u, killer) {
  if (!bossRulesReady) return checkDeathCore.apply(this, arguments);
  const was = !!u?.dead,
    result = checkDeathCore(g, u, killer);
  if (g?.bossRaid && u?.bossRed && !was && u.dead) {
    g.bossRaid.kills = Number(g.bossRaid.kills || 0) + 1;
    const finalKill = !!g.winner || g.bossRaid.kills >= 4;
    if (finalKill) {
      log(g, "마지막 타임오러 처치 · 붉은 시간의 군단 붕괴.", "turn");
    } else {
      g.pendingTraitChoices ||= [];
      g.pendingTraitChoices.push({
        kind: "bossReward",
        serial: ++g.bossRaid.rewardSerial,
        chooserRole: g.bossRaid.online ? "any" : "solo",
        final: false,
        options: bossRollRewards(g)
      });
      log(g, `붉은 타임오러 처치 ${g.bossRaid.kills}/4 · 전리품 선택 발생.`, "turn");
    }
  }
  return result;
}
export function bossShowEnd() {
  if (!bossRulesReady) return showEndCore.apply(this, arguments);
  if (!state_ui_battle_state.game?.bossRaid) return showEndCore();
  if (state_ui_battle_state.game.pendingTraitChoices?.some(q => q?.kind === "bossReward")) return;
  if (state_ui_battle_state.game.winner) {
    const matchId = String(state_ui_battle_state.game.matchId || "");
    if (bossVictoryMatchId !== matchId) {
      bossVictoryMatchId = matchId;
      bossVictoryReadyAt = Date.now() + (true ? Math.max(0, Number(state_ui_battle_state.visualHoldMs || 0)) + 150 : 0);
    }
    const remain = bossVictoryReadyAt - Date.now();
    if (remain > 0) {
      systems.TimerManager.clear(bossVictoryDelayTimer);
      bossVictoryDelayTimer = systems.TimerManager.setTimeout(() => {
        bossVictoryDelayTimer = 0;
        if (state_ui_battle_state.game?.bossRaid && state_ui_battle_state.game.winner && String(state_ui_battle_state.game.matchId || "") === matchId) showEndCore();
      }, remain + 24);
      return;
    }
  }
  return showEndCore();
}
export function bossProcessPendingTraitChoice() {
  if (!bossRulesReady) return processPendingTraitChoiceCore.apply(this, arguments);
  const q = state_ui_battle_state.game?.pendingTraitChoices?.[0];
  if (q?.kind !== "bossReward") return processPendingTraitChoiceCore();
  if (bossRewardWaitForVisuals(q)) return true;
  state_ui_battle_state.busy = true;
  if (state_ui_battle_state.game.bossRaid.online && state_ui_deck.p2p.role === "host" && !q.sent) {
    q.sent = true;
    p2pSend({
      type: "bossRewardOffer",
      mode: "BOSS_COOP",
      matchId: onlineCurrentMatchId(),
      reward: q
    });
    bossSendState(true);
  }
  return bossOpenReward(q);
}
export function bossScheduleAI() {
  if (!bossRulesReady) return scheduleAICore.apply(this, arguments);
  if (!state_ui_battle_state.game?.bossRaid) return scheduleAICore();
  if (state_ui_battle_state.game.winner || state_ui_battle_state.busy || state_ui_battle_state.game.pendingTraitChoices?.length) return;
  prepareCurrentTurn(state_ui_battle_state.game);
  const [t, s] = state_ui_battle_state.game.order[state_ui_battle_state.game.turn],
    u = unitAt(state_ui_battle_state.game, t, s),
    actions = legalActions(state_ui_battle_state.game, t, s),
    noLegalActions = actions.length === 0;
  if (state_ui_battle_state.game.bossRaid.online && state_ui_deck.p2p.role === "guest") {
    state_ui_battle_state.busy = false;
    systems.OnlineRuntime?.projection?.request?.("boss-guest-wait", {
      phase: "IN_BATTLE",
      canonicalRevision: Number(state_ui_battle_state.game.networkRevision || 0)
    });
    return;
  }
  if (t === "P" && !noLegalActions) {
    systems.OnlineRuntime?.projection?.request?.("boss-player-turn", {
      phase: "IN_BATTLE",
      canonicalRevision: Number(state_ui_battle_state.game.networkRevision || 0)
    });
    return;
  }
  const token = state_ui_battle_state.game.token,
    serial = state_ui_battle_state.game.turnSerial;
  state_ui_battle_state.busy = true;
  if (state_ui_battle_state.game.bossRaid.online) systems.OnlineRuntime?.projection?.request?.("boss-automatic-start", {
    phase: "IN_BATTLE",
    canonicalRevision: Number(state_ui_battle_state.game.networkRevision || 0),
    surfaceIntent: "PRESERVE_LOCAL_INPUT"
  });else state_ui_action_panel.ActionPanelConvergenceOwner.request("boss-automatic-start");
  let onlineTimerId = 0;
  const run = () => {
    if (state_ui_battle_state.game?.bossRaid?.online && bossOnlineAiTimer !== onlineTimerId) return;
    bossOnlineAiTimer = 0;
    if (!state_ui_battle_state.game || state_ui_battle_state.game.token !== token || state_ui_battle_state.game.turnSerial !== serial) {
      state_ui_battle_state.busy = false;
      return;
    }
    if (noLegalActions) {
      const ok = execute(state_ui_battle_state.game, t, s, {
        type: "noLegalPass",
        actionId: `${state_ui_battle_state.game.battleId || state_ui_battle_state.game.matchId}:boss-automatic:${serial}:no-legal-actions`
      }, state_ui_battle_state.game.bossRaid.online ? {
        admissionSource: "host-automatic"
      } : {});
      state_ui_battle_state.busy = false;
      if (ok) afterAction();else systems.__megaRecordRecoveredError?.(new Error("BOSS_NO_LEGAL_ACTION_REJECTED"), "boss.scheduleAI");
      return;
    }
    const view = maskedStateFor(state_ui_battle_state.game, t),
      liveVisualEvents = state_ui_battle_state.visualEvents,
      liveVisualHoldMs = state_ui_battle_state.visualHoldMs;
    let a = null,
      reason = "";
    try {
      state_ui_battle_state.visualEvents = [];
      state_ui_battle_state.visualHoldMs = 0;
      a = u?.scheduledAction ? {
        type: "scheduled"
      } : chooseAI(view, t, s, false);
      if (a && !u?.scheduledAction) reason = aiReason(view, t, s, a) || "";
    } finally {
      state_ui_battle_state.visualEvents = liveVisualEvents;
      state_ui_battle_state.visualHoldMs = liveVisualHoldMs;
    }
    let ok = a ? execute(state_ui_battle_state.game, t, s, a, state_ui_battle_state.game.bossRaid.online ? {
      admissionSource: "host-automatic"
    } : {}) : false;
    if (a && ok && reason) log(state_ui_battle_state.game, `보스 AI 판단: ${reason}`, "aiwhy");
    state_ui_battle_state.busy = false;
    if (ok) afterAction();else systems.__megaRecordRecoveredError?.(new Error("BOSS_AUTOMATIC_ACTION_REJECTED"), "boss.scheduleAI");
  };
  const delay = Math.max(520, Number(document.getElementById("speed")?.value || 900));
  if (state_ui_battle_state.game.bossRaid.online) {
    if (bossOnlineAiTimer) systems.OnlineRuntime?.sessionScope?.cancel?.(bossOnlineAiTimer);
    const scope = systems.OnlineRuntime?.sessionScope;
    if (!scope || scope.closed) {
      state_ui_battle_state.busy = false;
      return;
    }
    onlineTimerId = scope.setTimeout(run, delay, "boss-online-ai", {
      phase: "IN_BATTLE"
    });
    bossOnlineAiTimer = onlineTimerId;
  } else scheduleLocalAutoTurnTimer(noLegalActions ? "boss-no-legal-actions" : "boss-ai", delay, run);
}
export function bossAfterAction() {
  if (!bossRulesReady) return afterActionCore.apply(this, arguments);
  if (!state_ui_battle_state.game?.bossRaid) return afterActionCore();
  state_ui_battle_state.pendingSkill = null;
  if (state_ui_battle_state.game.bossRaid.online && state_ui_deck.p2p.role === "guest" && state_online_commands.OnlineActionAdmissionOwner.hasPending()) {
    systems.OnlineRuntime?.projection?.request?.("boss-guest-command-pending", {
      phase: "IN_BATTLE",
      canonicalRevision: Number(state_ui_battle_state.game.networkRevision || 0),
      surfaceIntent: "PRESERVE_LOCAL_INPUT"
    });
    return;
  }
  const teammateVisuals = state_ui_battle_state.game.bossRaid.online && state_ui_deck.p2p.role === "host" ? cloneOnlineVisualEvents(state_ui_battle_state.visualEvents) : [];
  const reward = state_ui_battle_state.game.pendingTraitChoices?.[0];
  if (reward?.kind === "bossReward" && reward.visualDelayMs == null) reward.visualDelayMs = true ? Math.max(0, Number(state_ui_battle_state.visualHoldMs || 0)) + 140 : 0;
  if (state_ui_battle_state.game.bossRaid.online && state_ui_deck.p2p.role === "host") {
    bossSendState(false, teammateVisuals);
    systems.OnlineRuntime?.projection?.request?.("boss-host-action-commit", {
      phase: "IN_BATTLE",
      canonicalRevision: Number(state_ui_battle_state.game.networkRevision || 0)
    });
  } else render();
  if (!processPendingTraitChoice()) scheduleAI();
}

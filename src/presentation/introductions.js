import { TimerManager } from "../runtime/timers.js";
import { state_engine_actions } from "../engine/actions.js";
import { findUnit } from "../engine/combat.js";
import { transformedSkillReq } from "../engine/energy.js";
import { cardHasCapability, skillOf } from "../engine/entities.js";
import { reactiveEnergyRule, syncReactiveEnergyMaxHp } from "../features/genocider.js";
import { timeFieldTimeoras, timeIsAligned, timeNormDeg, timeSetInputLock, timeShouldClockReact, state_features_timeora } from "../features/timeora.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { showCardTooltip, state_ui_cards } from "../ui/cards.js";
export function initializePresentationIntroductions() {
  /* 시작 연출 canonical owner: exact-once Horizon, monotonic timing, 약 4초. */
  (function startHorizonIntro() {
    const intro = document.getElementById("horizonStartupIntro");
    if (!intro || systems.__horizonStartupIntroPlayed) {
      intro?.remove();
      return;
    }
    systems.__horizonStartupIntroPlayed = true;
    const start = performance.now();
    systems.__horizonIntroTiming = {
      start,
      end: null,
      durationMs: null,
      eventLoopStalls: [],
      runs: 1
    };
    timeSetInputLock(true, false);
    const nativeSetTimeout = window.setTimeout.bind(window),
      nativeClearTimeout = window.clearTimeout.bind(window),
      nativeSetInterval = window.setInterval.bind(window),
      nativeClearInterval = window.clearInterval.bind(window);
    let last = start,
      done = false,
      backgrounded = false,
      endingTimer = 0,
      finishTimer = 0,
      watchdogTimer = 0;
    const monitor = nativeSetInterval(() => {
      const now = performance.now(),
        gap = now - last;
      if (gap > 140) systems.__horizonIntroTiming.eventLoopStalls.push(Math.round(gap));
      last = now;
    }, 100);
    const onHide = () => {
      backgrounded = true;
    };
    const finish = () => {
      if (done) return;
      done = true;
      nativeClearInterval(monitor);
      nativeClearTimeout(endingTimer);
      nativeClearTimeout(finishTimer);
      nativeClearTimeout(watchdogTimer);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onResume);
      document.removeEventListener("visibilitychange", onVisibility);
      intro.removeEventListener("transitionend", onTransitionEnd);
      intro.setAttribute("aria-hidden", "true");
      intro.remove();
      try {
        timeSetInputLock(false, false);
      } catch (error) {
        document.body.classList.remove("time-input-locked");
        systems.__megaRecordRecoveredError?.(error, "startHorizonIntro.finish");
      }
      const end = performance.now();
      Object.assign(systems.__horizonIntroTiming, {
        end,
        durationMs: end - start
      });
    };
    const onResume = () => {
      if (backgrounded) finish();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") backgrounded = true;else if (backgrounded) finish();
    };
    const onTransitionEnd = event => {
      if (event.target === intro && event.propertyName === "opacity" && intro.classList.contains("ending")) finish();
    };
    window.addEventListener("pagehide", onHide, {
      passive: true
    });
    window.addEventListener("pageshow", onResume, {
      passive: true
    });
    document.addEventListener("visibilitychange", onVisibility, {
      passive: true
    });
    intro.addEventListener("transitionend", onTransitionEnd);
    endingTimer = nativeSetTimeout(() => {
      if (done) return;
      intro.classList.add("ending");
      finishTimer = nativeSetTimeout(finish, 700);
    }, 3650);
    watchdogTimer = nativeSetTimeout(finish, 5200);
  })();

  /* PC 길게 누르기/우클릭에서도 타임오러의 실시간 소형 시계를 고정 표시한다. */
  (function installTimeoraMouseClockInspect() {
    let timer = 0,
      startX = 0,
      startY = 0,
      anchor = null;
    document.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || state_features_timeora.timeInputLocked) return;
      const el = e.target.closest?.('.card[data-zone="field"][data-uid]'),
        unit = el && state_ui_battle_state.game ? findUnit(state_ui_battle_state.game, el.dataset.uid) : null;
      if (!el || !cardHasCapability(unit, "timeControl")) return;
      anchor = el;
      startX = e.clientX;
      startY = e.clientY;
      TimerManager.clear(timer);
      timer = TimerManager.setTimeout(() => {
        showCardTooltip(el, true);
        state_ui_cards.cardTooltipState.suppressClickUntil = Date.now() + 800;
        state_ui_cards.cardTooltipState.suppressCard = el;
        timer = 0;
      }, 480);
    }, true);
    document.addEventListener('pointermove', e => {
      if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 9) {
        TimerManager.clear(timer);
        timer = 0;
      }
    }, true);
    for (const name of ['pointerup', 'pointercancel']) document.addEventListener(name, () => {
      TimerManager.clear(timer);
      timer = 0;
      anchor = null;
    }, true);
    document.addEventListener('contextmenu', e => {
      const el = e.target.closest?.('.card[data-zone="field"][data-uid]'),
        unit = el && state_ui_battle_state.game ? findUnit(state_ui_battle_state.game, el.dataset.uid) : null;
      if (!el || !cardHasCapability(unit, "timeControl") || state_features_timeora.timeInputLocked) return;
      e.preventDefault();
      showCardTooltip(el, true);
    }, true);
  })();

  /* 타임오러 연속 특성·AI·온라인 상태 검증 보강 */
}
export function timeSyncContinuousTraitStates(g, reason = "운명의 시계 상태 갱신") {
  if (!g) return;
  const oldGame = state_engine_actions.timeTraitGame;
  state_engine_actions.timeTraitGame = g;
  try {
    for (const team of ["P", "A"]) for (const u of g.teams[team]?.field || []) {
      if (reactiveEnergyRule(u)) syncReactiveEnergyMaxHp(g, u, reason, true);
    }
  } finally {
    state_engine_actions.timeTraitGame = oldGame;
  }
}
export function timePredictedClockState(g, t, s, actor, a) {
  const owner = timeFieldTimeoras(g, t).find(x => timeShouldClockReact(g, x, actor, t, s));
  if (!owner || a?.type !== "skill") return null;
  const plan = a.paymentPlan,
    n = Math.ceil(Math.max(0, plan ? Number(plan.R || 0) + Number(plan.W || 0) + Number(plan.B || 0) : transformedSkillReq(g, t, actor, a.costOverride ?? skillOf(actor, a.skill)?.cost ?? "").tokens.length));
  if (!n) return null;
  const hour = timeNormDeg(owner.timeHourDeg + 30 * n),
    minute = timeNormDeg(owner.timeMinuteDeg + (owner.uid === actor.uid ? 90 * n : 0)),
    d = timeNormDeg(hour - minute),
    aligned = Math.abs(d) < .001 || Math.abs(d - 180) < .001;
  return {
    owner,
    n,
    hour,
    minute,
    aligned,
    beforeAligned: timeIsAligned(owner)
  };
}

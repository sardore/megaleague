import { timeClockFaceNode, timeColorForTeam, timeJitterHand, timeMarkTimeline, timeNormDeg, timeThemeForTeam, timeWaitNamedAnimation } from "../features/timeora.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { localTeamFor } from "../ui/setup.js";
export function initializePresentationClockMirror() {
  TIME_MIRROR_VISUAL_VERSION = "timeora-mirror-clock-r17";
  systems.__timeClockOverlayImpl = async function (clockEvents) {
    if (systems.__megaEnergyOverflowChoice?.clockVisualDuplicate?.(clockEvents)) return;
    const saturationLease = systems.timeClockVisualSaturation?.acquire?.(state_ui_battle_state.game, clockEvents) || null;
    try {
      clockEvents = systems.__redTimeoraBossRaid?.mapClockOverlayEvents?.(clockEvents) || clockEvents;
      const clocks = timeMirrorNormalizeClockEvents(clockEvents);
      if (!clocks.length) return;
      const overlay = document.createElement("div");
      overlay.className = "time-clock-action-overlay";
      overlay.dataset.visualVersion = TIME_MIRROR_VISUAL_VERSION;
      const clockThemes = [...new Set(clocks.map(c => timeThemeForTeam(state_ui_battle_state.game, c.team)))];
      overlay.dataset.clockTheme = clockThemes.length === 1 ? clockThemes[0] : "mixed";
      const stack = document.createElement("div");
      stack.className = "time-clock-stack";
      const mirrorTeams = [...new Set(clocks.map(c => c.team).filter(Boolean))];
      if (mirrorTeams.length > 1) stack.classList.add("time-mirror-stack");
      overlay.appendChild(stack);
      document.body.appendChild(overlay);
      const animations = [];
      const alignedClocks = [];
      let hasRotation = false;
      let hasBlocked = false;
      const localTeam = localTeamFor(state_ui_battle_state.game);
      clocks.sort((a, b) => {
        const aLocal = a.team === localTeam ? 1 : 0;
        const bLocal = b.team === localTeam ? 1 : 0;
        return aLocal - bLocal || String(a.uid).localeCompare(String(b.uid));
      });
      for (const c of clocks) {
        const theme = timeThemeForTeam(state_ui_battle_state.game, c.team);
        const face = timeClockFaceNode(theme, c.beforeHour, c.beforeMinute);
        face.dataset.clockUid = c.uid;
        face.dataset.clockTeam = c.team || "";
        stack.appendChild(face);
        const hh = face.querySelector(".hour");
        const mh = face.querySelector(".minute");
        if (c.blocked) {
          hasBlocked = true;
          animations.push(timeJitterHand(hh, c.beforeHour, 760), timeJitterHand(mh, c.beforeMinute, 820));
        } else {
          hasRotation = hasRotation || c.hourDelta > 0 || c.minuteDelta > 0;
          const hourDuration = 860 + Math.min(1100, c.hourDelta * 4);
          const minuteDuration = 860 + Math.min(1500, c.minuteDelta * 3);
          animations.push(timeMirrorAnimateHandExact(hh, c.beforeHour, c.hourDelta, hourDuration), timeMirrorAnimateHandExact(mh, c.beforeMinute, c.minuteDelta, minuteDuration));
          if (c.aligned) alignedClocks.push(c);
        }
      }
      await Promise.allSettled(animations);
      if (alignedClocks.length) {
        const teams = [...new Set(alignedClocks.map(c => c.team))];
        overlay.style.setProperty("--align-color", timeColorForTeam(state_ui_battle_state.game, teams[0]));
        overlay.style.setProperty("--align-color-2", timeColorForTeam(state_ui_battle_state.game, teams[1] || teams[0]));
        overlay.classList.add("clock-aligned-impact");
        await timeWaitNamedAnimation(overlay, "timeOverlayAlignedImpact", 1040);
      } else if (hasBlocked && !hasRotation) {
        overlay.classList.add("clock-jam");
        await timeWaitNamedAnimation(overlay, "timeClockJamPulse", 820);
      } else {
        overlay.classList.add("clock-impact");
        await timeWaitNamedAnimation(overlay, "timeOverlayImpact", 760);
      }
      overlay.classList.add("clock-ending");
      await timeWaitNamedAnimation(overlay, "timeScreenFade", 600);
      timeMarkTimeline(state_ui_battle_state.game, "clockVisualCompleted", {
        overlayConnected: overlay.isConnected
      });
      overlay.remove();
      timeMarkTimeline(state_ui_battle_state.game, "clockOverlayRemoved", {
        overlayConnected: overlay.isConnected
      });
    } finally {
      saturationLease?.release?.();
    }
  };
}
let TIME_MIRROR_VISUAL_VERSION;
function timeMirrorNormalizeClockEvents(clockEvents) {
  const uniqueEvents = [];
  const seenEvents = new Set();
  for (let eventIndex = 0; eventIndex < (clockEvents || []).length; eventIndex++) {
    const event = clockEvents[eventIndex] || {};
    const signature = event.actionSerial != null ? `serial:${event.actionSerial}` : `fallback:${event.actorUid || ""}:${(event.clocks || []).map(c => `${c.uid}:${c.beforeHour}:${c.beforeMinute}:${c.afterHour}:${c.afterMinute}:${c.blocked ? 1 : 0}`).join("|")}`;
    if (seenEvents.has(signature)) continue;
    seenEvents.add(signature);
    uniqueEvents.push(event);
  }
  const merged = new Map();
  for (const event of uniqueEvents) {
    for (const raw of event.clocks || []) {
      if (!raw?.uid) continue;
      const c = {
        ...raw,
        beforeHour: timeNormDeg(raw.beforeHour),
        beforeMinute: timeNormDeg(raw.beforeMinute),
        afterHour: timeNormDeg(raw.afterHour),
        afterMinute: timeNormDeg(raw.afterMinute),
        hourDelta: Math.max(0, Number(raw.hourDelta || 0)),
        minuteDelta: Math.max(0, Number(raw.minuteDelta || 0)),
        blocked: !!raw.blocked,
        aligned: !!raw.aligned
      };
      const prev = merged.get(c.uid);
      if (!prev) {
        merged.set(c.uid, {
          ...c,
          allBlocked: c.blocked,
          eventCount: 1
        });
        continue;
      }
      prev.afterHour = c.afterHour;
      prev.afterMinute = c.afterMinute;
      prev.hourDelta += c.hourDelta;
      prev.minuteDelta += c.minuteDelta;
      prev.aligned = c.aligned;
      prev.allBlocked = prev.allBlocked && c.blocked;
      prev.blocked = prev.allBlocked;
      prev.eventCount++;
    }
  }
  return [...merged.values()];
}
function timeMirrorAnimateHandExact(el, from, delta, duration) {
  const start = Number(from) || 0;
  const travel = Math.max(0, Number(delta) || 0);
  const finish = start + travel;
  if (!travel) {
    el.style.transform = `translateX(-50%) rotate(${timeNormDeg(start)}deg)`;
    return Promise.resolve();
  }
  const animation = el.animate([{
    transform: `translateX(-50%) rotate(${start}deg)`
  }, {
    transform: `translateX(-50%) rotate(${finish}deg)`
  }], {
    duration,
    easing: "cubic-bezier(.12,.82,.14,1)",
    fill: "forwards"
  });
  return animation.finished.catch(() => {}).then(() => {
    el.style.transform = `translateX(-50%) rotate(${timeNormDeg(finish)}deg)`;
    try {
      animation.cancel();
    } catch (error) {
      systems.__megaRecordRecoveredError(error, "timeoraMirrorClockVisualFix:L66");
    }
  });
}

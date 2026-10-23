import { state_presentation_coordinates } from './coordinates.js';
import { TimerManager } from '../runtime/timers.js';
import { isZombie } from '../engine/status-rules.js';

// Single source of truth for how long each Weller phase plays (ms) and how long the
// battle flow is held for it. No text is ever drawn: every phase is shapes and motion only.
const PHASE_TIMING = {
  curse: { duration: 1000, hold: 1000 },
  curseBurst: { duration: 1550, hold: 1600 },
  graveDown: { duration: 1900, hold: 1900 },
  graveUp: { duration: 1600, hold: 1600 },
  recovery: { duration: 1000, hold: 1000 },
  undeadApply: { duration: 1000, hold: 1000 }
};
const timingOf = phase => PHASE_TIMING[phase] || PHASE_TIMING.curse;

export function wellerVisualHold(events) {
  return events.reduce((hold, event) => Math.max(hold, timingOf(event.phase).hold), 0);
}

// One shared SVG turbulence filter: it displaces whatever it is applied to with slowly drifting
// noise, which is what makes the aura and the rituals ripple irregularly instead of as clean shapes.
const WAVE_SVG = `<svg id="undead-wave-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
<filter id="undead-wave" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.007 0.014" numOctaves="2" seed="7" result="n"><animate attributeName="baseFrequency" dur="7s" values="0.007 0.014;0.011 0.02;0.007 0.014" repeatCount="indefinite"/></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="26" xChannelSelector="R" yChannelSelector="G"/></filter>
<filter id="weller-wave" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.016 0.022" numOctaves="3" seed="3" result="n"><animate attributeName="baseFrequency" dur="2.4s" values="0.016 0.022;0.026 0.034;0.016 0.022" repeatCount="indefinite"/></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="34" xChannelSelector="R" yChannelSelector="G"/></filter>
</defs></svg>`;
function ensureWaveFilters() {
  if (typeof document === 'undefined' || !document.body || document.getElementById('undead-wave-defs')) return;
  document.body.insertAdjacentHTML('beforeend', WAVE_SVG);
}

/* The aura is pure markup; weller.css draws feathered violet swells inside the card (nothing crosses its border). */
export function undeadAuraHTML(unit) {
  if (unit.dead || !isZombie(unit) || !(unit.statuses?.undead > 0)) return '';
  // Last remaining turn: the swell gutters instead of showing text.
  const fading = unit.statuses.undead <= 1 ? ' fading' : '';
  return `<div class="undead-aura${fading}" aria-hidden="true"><i class="uw c"></i><i class="uw a"></i><i class="uw b"></i></div>`;
}

// Rituals are fluid, not geometric: glow, rings, a rising column and soul tongues are all drawn
// as soft gradients and then rippled by the shared turbulence filter. No text anywhere.
function ritualHTML(phase, event) {
  const stage = Math.min(2, Number(event.stage) || 0);
  const soulCount = phase === 'recovery' ? 6 : 14;
  const souls = Array.from({ length: soulCount }, (_, i) => `<i class="weller-soul" style="--a0:${i * (360 / soulCount)}deg;--r0:${62 + i % 3 * 14}px;--sd:${i % 5 * 55}ms;--tone:${i % 3}"></i>`).join('');
  const rings = phase === 'curse' ? Array.from({ length: stage }, (_, i) => `<i class="weller-ring stage" style="--ring:${i + 1}"></i>`).join('') : '';
  const tomb = phase === 'graveDown' || phase === 'graveUp' ? '<i class="weller-tomb"><i class="weller-lid"></i></i>' : '';
  return `<div class="weller-ritual"><div class="weller-fluid"><i class="weller-pool"></i><div class="weller-floor"><i class="weller-ring"></i><i class="weller-ring inner"></i>${rings}</div><i class="weller-pillar"></i><i class="weller-shock"></i><i class="weller-shock two"></i>${souls}<i class="weller-core"></i></div>${tomb}</div><i class="weller-flash"></i>`;
}

// Arena shake on the beats that land hard; reuses the arena shake keyframes.
const SHAKE = { curseBurst: 620, graveDown: 640 };

export function playWellerVisual(event) {
  ensureWaveFilters();
  const arena = document.querySelector('.arena');
  const source = state_presentation_coordinates.battleEntityElement(event.uid);
  const target = state_presentation_coordinates.battleEntityElement(event.targetUid || event.uid);
  if (!arena || !target) return;
  const anchor = state_presentation_coordinates.VfxCoordinateOwner.point(arena, target);
  if (!anchor) return;
  const phase = event.phase || 'curse';
  const fx = document.createElement('div');
  fx.className = `weller-fx weller-${phase}${event.succeeds === false ? ' failed' : ''}`;
  fx.setAttribute('aria-hidden', 'true');
  fx.dataset.wellerPhase = phase;
  fx.style.setProperty('--weller-x', `${anchor.x}px`);
  fx.style.setProperty('--weller-y', `${anchor.y}px`);
  fx.innerHTML = ritualHTML(phase, event);
  arena.appendChild(fx);
  if (phase === 'curse' && source && source !== target) {
    const from = state_presentation_coordinates.VfxCoordinateOwner.point(arena, source);
    if (from) {
      const link = document.createElement('i');
      link.className = 'weller-curse-link';
      link.style.left = `${from.x}px`;
      link.style.top = `${from.y}px`;
      link.style.width = `${Math.hypot(anchor.x - from.x, anchor.y - from.y)}px`;
      link.style.transform = `rotate(${Math.atan2(anchor.y - from.y, anchor.x - from.x)}rad)`;
      fx.appendChild(link);
    }
  }
  if (SHAKE[phase] && !(phase === 'graveDown' && event.succeeds === false)) {
    TimerManager.setTimeout(() => {
      arena.classList.add('weller-shake');
      TimerManager.setTimeout(() => arena.classList.remove('weller-shake'), 520, { reason: 'weller-shake-end' });
    }, SHAKE[phase], { reason: 'weller-shake' });
  }
  TimerManager.setTimeout(() => fx.remove(), timingOf(phase).duration, { reason: `weller-${phase}` });
}

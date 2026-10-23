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

export function undeadAuraHTML(unit) {
  if (unit.dead || !isZombie(unit) || !(unit.statuses?.undead > 0)) return '';
  // A shared animation clock preserves particle positions when a snapshot redraws cards.
  const time = performance.now() / 1000;
  // Last remaining turn: the aura gutters like a dying flame instead of showing text.
  const fading = unit.statuses.undead <= 1 ? ' fading' : '';
  const hands = [14, 47, 79].map((x, i) => `<i class="undead-hand" style="--hand-x:${x}%;--hand-tilt:${i === 1 ? 0 : i ? 10 : -10}deg;--hand-delay:-${(time + i * 1.3) % 4.2}s"></i>`).join('');
  const wisps = Array.from({ length: 10 }, (_, i) => `<i class="undead-wisp" style="--wisp-x:${8 + i * 8.4}%;--wisp-delay:-${(time + i * .217) % 2.6}s;--wisp-drift:${i % 2 ? 12 : -12}px"></i>`).join('');
  const embers = Array.from({ length: 4 }, (_, i) => `<i class="undead-ember" style="--ember-x:${18 + i * 21}%;--ember-delay:-${(time + i * .9) % 3.4}s"></i>`).join('');
  return `<div class="undead-aura${fading}" aria-hidden="true" style="--aura-pulse-delay:-${time % 2}s"><i class="undead-fog"></i><div class="undead-floor"><i class="undead-sigil"></i><i class="undead-sigil inner"></i></div>${hands}${wisps}${embers}</div>`;
}

const HAND_SLOTS = [
  { x: 12, tilt: -16, size: .8, delay: 0 },
  { x: 30, tilt: -7, size: 1, delay: 90 },
  { x: 50, tilt: 0, size: 1.15, delay: 40 },
  { x: 70, tilt: 8, size: 1, delay: 130 },
  { x: 88, tilt: 17, size: .8, delay: 60 }
];

// Every phase is built from the same parts (rune floor, bony hands, souls, light) and
// the phase class on .weller-fx decides which parts play and how. No text anywhere.
function ritualHTML(phase, event) {
  const stage = Math.min(2, Number(event.stage) || 0);
  const handCount = phase === 'curse' ? 2 + stage : phase === 'recovery' ? 0 : 5;
  const hands = HAND_SLOTS.slice(0, handCount).map(h => `<i class="weller-hand" style="--hx:${h.x}%;--tilt:${h.tilt}deg;--hs:${h.size};--hd:${h.delay}ms"></i>`).join('');
  const soulCount = phase === 'recovery' ? 6 : 14;
  const souls = Array.from({ length: soulCount }, (_, i) => `<i class="weller-soul" style="--a0:${i * (360 / soulCount)}deg;--r0:${62 + i % 3 * 14}px;--sd:${i % 5 * 55}ms;--tone:${i % 3}"></i>`).join('');
  const rings = phase === 'curse' ? Array.from({ length: stage }, (_, i) => `<i class="weller-rune stage" style="--ring:${i + 1}"></i>`).join('') : '';
  const tomb = phase === 'graveDown' || phase === 'graveUp' ? '<i class="weller-tomb"><i class="weller-lid"></i></i>' : '';
  const skull = phase === 'curseBurst' || phase === 'graveDown' ? '<i class="weller-skull"><i class="weller-teeth"></i></i>' : '';
  return `<div class="weller-ritual"><i class="weller-pool"></i><div class="weller-floor"><i class="weller-rune"></i><i class="weller-rune inner"></i><i class="weller-star"></i><i class="weller-star down"></i>${rings}<i class="weller-crack"></i></div>${hands}<i class="weller-pillar"></i>${skull}${tomb}<i class="weller-shock"></i><i class="weller-shock two"></i>${souls}<i class="weller-core"></i></div><i class="weller-flash"></i>`;
}

// Arena shake on the beats that land hard; reuses the arena shake keyframes.
const SHAKE = { curseBurst: 620, graveDown: 640 };

export function playWellerVisual(event) {
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

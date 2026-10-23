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
  return `<div class="undead-aura" aria-hidden="true" style="--aura-pulse-delay:-${time % 2}s"><i class="undead-halo"></i><i class="undead-halo second"></i>${Array.from({length:10},(_,i)=>`<i class="undead-wisp" style="--wisp-x:${8+i*8.4}%;--wisp-delay:-${(time+i*.217)%2.6}s;--wisp-drift:${i%2?12:-12}px"></i>`).join('')}</div>`;
}

function ritualHTML(phase, event) {
  const souls = Array.from({ length: 12 }, (_, i) => `<i class="weller-soul" style="--soul-angle:${i * 30}deg;--soul-delay:${i % 4 * 45}ms"></i>`).join('');
  // Curse progress is shown as extra seal rings (stage 1 -> 2 rings, stage 2 -> 3 rings).
  const stageRings = phase === 'curse' ? Array.from({ length: Math.min(2, Number(event.stage) || 0) }, (_, i) => `<i class="weller-sigil stage" style="--ring:${i + 1}"></i>`).join('') : '';
  const tomb = phase === 'graveDown' ? '<i class="weller-tomb"></i>' : '';
  return `<div class="weller-ritual"><i class="weller-sigil"></i><i class="weller-sigil inner"></i>${stageRings}<i class="weller-shadow"></i><i class="weller-core"></i><i class="weller-pillar"></i><i class="weller-shock"></i>${souls}${tomb}</div>`;
}

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
  TimerManager.setTimeout(() => fx.remove(), timingOf(phase).duration, { reason: `weller-${phase}` });
}

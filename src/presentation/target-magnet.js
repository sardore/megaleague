import { state_presentation_coordinates } from './coordinates.js';
import { TimerManager } from '../runtime/timers.js';

// One shared presentation for every "target magnet" (a unit that pulls the enemy's single-target skills onto itself).
// Shapes and motion only, never text. Called by the battle visual pipeline (every acting side) and by the target
// selection UI (instant feedback while the player is still choosing), so the same moment is only played once.
export const TARGET_MAGNET_MS = 900;
const recent = new Map();

export function playTargetMagnetVisual(event) {
  const arena = document.querySelector('.arena');
  const magnet = state_presentation_coordinates.battleEntityElement(event.uid);
  if (!arena || !magnet) return false;
  const key = `${event.sourceUid || ''}:${event.uid}:${event.turnSerial ?? ''}`;
  const now = Date.now();
  if (now - (recent.get(key) || -Infinity) < 2500) return false;
  recent.set(key, now);
  if (recent.size > 40) for (const [k, t] of recent) if (now - t > 5000) recent.delete(k);
  const to = state_presentation_coordinates.VfxCoordinateOwner.point(arena, magnet);
  if (!to) return false;
  const fx = document.createElement('div');
  fx.className = 'target-magnet-fx';
  fx.setAttribute('aria-hidden', 'true');
  fx.style.setProperty('--tm-x', `${to.x}px`);
  fx.style.setProperty('--tm-y', `${to.y}px`);
  fx.style.setProperty('--tm-t', `${TARGET_MAGNET_MS}ms`);
  fx.innerHTML = '<i class="tm-ring"></i><i class="tm-ring tm-ring-b"></i><i class="tm-core"></i>';
  const sourceEl = event.sourceUid ? state_presentation_coordinates.battleEntityElement(event.sourceUid) : null;
  const from = sourceEl && sourceEl !== magnet ? state_presentation_coordinates.VfxCoordinateOwner.point(arena, sourceEl) : null;
  if (from) {
    const link = document.createElement('i');
    link.className = 'tm-link';
    link.style.left = `${from.x}px`;
    link.style.top = `${from.y}px`;
    link.style.width = `${Math.hypot(to.x - from.x, to.y - from.y)}px`;
    link.style.transform = `rotate(${Math.atan2(to.y - from.y, to.x - from.x)}rad)`;
    fx.appendChild(link);
  }
  arena.appendChild(fx);
  magnet.classList.add('target-magnet-hit');
  TimerManager.setTimeout(() => {
    fx.remove();
    magnet.classList.remove('target-magnet-hit');
  }, TARGET_MAGNET_MS + 80);
  return true;
}

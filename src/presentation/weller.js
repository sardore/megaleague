import { state_presentation_coordinates } from './coordinates.js';
import { TimerManager } from '../runtime/timers.js';
import { isZombie } from '../engine/status-rules.js';

export function undeadAuraHTML(unit) {
  if (unit.dead || !isZombie(unit) || !(unit.statuses?.undead > 0)) return '';
  // A shared animation clock preserves particle positions when a snapshot redraws cards.
  const time = performance.now() / 1000;
  return `<div class="undead-aura" aria-hidden="true" style="--aura-pulse-delay:-${time % 2}s"><i class="undead-halo"></i><i class="undead-halo second"></i>${Array.from({length:10},(_,i)=>`<i class="undead-wisp" style="--wisp-x:${8+i*8.4}%;--wisp-delay:-${(time+i*.217)%2.6}s;--wisp-drift:${i%2?12:-12}px"></i>`).join('')}</div>`;
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
  fx.className = `weller-fx weller-${phase}${event.succeeds===false?' failed':''}`;
  fx.setAttribute('aria-hidden','true');
  fx.dataset.wellerPhase = phase;
  fx.style.setProperty('--weller-x',`${anchor.x}px`);
  fx.style.setProperty('--weller-y',`${anchor.y}px`);
  fx.innerHTML = `<div class="weller-ritual"><i class="weller-sigil"></i><i class="weller-sigil inner"></i><i class="weller-shadow"></i><span class="weller-rune">${phase==='graveDown'?'†':phase==='graveUp'?'☠':phase==='recovery'?'✦':'封'}</span><i class="weller-pillar"></i><i class="weller-shock"></i>${Array.from({length:12},(_,i)=>`<i class="weller-soul" style="--soul-angle:${i*30}deg;--soul-delay:${i%4*45}ms"></i>`).join('')}${phase==='graveDown'?'<div class="weller-tomb"><span>†</span><small>GRAVE</small></div>':''}<b class="weller-caption">${phase==='graveDown'?(event.succeeds===false?'HP 조건 미충족':'GRAVE DOWN'):phase==='graveUp'?'GRAVE UP':phase==='curseBurst'?'저주 해방':phase==='curse'?`억누른저주${event.stage?' · '+event.stage:''}`:phase==='undeadApply'?'언데드':'불사의 맥동'}</b></div>`;
  arena.appendChild(fx);
  if (phase==='curse' && source && source!==target) {
    const from=state_presentation_coordinates.VfxCoordinateOwner.point(arena,source);
    if(from){
      const link=document.createElement('i');link.className='weller-curse-link';
      link.style.left=`${from.x}px`;link.style.top=`${from.y}px`;
      link.style.width=`${Math.hypot(anchor.x-from.x,anchor.y-from.y)}px`;
      link.style.transform=`rotate(${Math.atan2(anchor.y-from.y,anchor.x-from.x)}rad)`;
      fx.appendChild(link);
    }
  }
  const duration=phase==='graveDown'?1900:phase==='curseBurst'?1550:phase==='graveUp'?1600:1000;
  TimerManager.setTimeout(()=>fx.remove(),duration,{reason:`weller-${phase}`});
}

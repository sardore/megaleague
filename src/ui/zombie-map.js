import { ZOMBIE_REGIONS, zombieRegionInfo } from '../features/zombie-cave.js';
import { state_ui_battle_state } from './battle-state.js';

/*
 * 좀비굴 지도 화면. 기호를 늘어놓는 대신 지형 그림 위에 길이 놓인다.
 * - 한 칸은 지형 한 조각. 이어지는 같은 지형은 번져서 하나의 땅으로 보인다.
 * - 아래가 지금 서 있는 곳, 위로 갈수록 앞날(흐려진다).
 * - 갈 수 있는 곳만 버튼이고, 눌러서 정보를 본 뒤 "이 길로 간다"로 확정한다.
 */
const W = 300,
  ROW = 78,
  ROWS = 5; // 앞날 4줄 + 지금 서 있는 줄
const H = ROW * ROWS;
const laneX = lane => 50 + 100 * lane;
const rowY = k => ROW * (3 - k) + ROW / 2; // k=0이 지금 고를 줄. 화면에선 아래에서 두 번째.
const youY = ROW * 4 + ROW / 2;

/* 지형별 색(어두운 쪽, 밝은 쪽). */
const GROUND = Object.freeze({
  graveyard: ['#102a1a', '#2f5d3c'],
  sewer: ['#232a0c', '#5b6620'],
  hospital: ['#10243a', '#2f5f8e'],
  slaughter: ['#34100f', '#82262a'],
  lab: ['#24133a', '#5d3190']
});

/* 지형 그림: 칸 안쪽 좌표(100x78). 모양만으로 그린다. */
const ART = Object.freeze({
  graveyard: `<path d="M8 70V54a8 8 0 0 1 16 0v16zM70 72V58a6 6 0 0 1 12 0v14z" fill="#5d7066"/><path d="M13 58h6M74 62h4" stroke="#2b362f" stroke-width="1.4"/><path d="M52 74V44M52 56l-12-12M52 52l14-14M46 48l-8-4" stroke="#05100a" stroke-width="3.2" stroke-linecap="round" fill="none"/><circle cx="84" cy="20" r="7" fill="#d8f3d0" fill-opacity=".55"/>`,
  sewer: `<path d="M0 18h64a6 6 0 0 1 6 6v10" stroke="#3a3f26" stroke-width="9" fill="none"/><path d="M0 18h64a6 6 0 0 1 6 6v10" stroke="#8a9444" stroke-width="2" fill="none" stroke-dasharray="2 8"/><path d="M6 60q8-5 16 0t16 0 16 0 16 0 16 0M14 68q8-5 16 0t16 0 16 0 16 0" stroke="#9fb34a" stroke-width="2" fill="none" stroke-opacity=".7"/><circle cx="20" cy="46" r="3" fill="#c9dd6a" fill-opacity=".6"/><circle cx="78" cy="48" r="2" fill="#c9dd6a" fill-opacity=".6"/>`,
  hospital: `<path d="M16 72V34h46v38z" fill="#1d3b5a"/><path d="M16 34l23-14 23 14z" fill="#274b70"/><path d="M36 26h6M39 23v6" stroke="#ff7a86" stroke-width="2.6"/><path d="M24 44h8v8h-8zM46 44h8v8h-8zM24 58h8v8h-8z" fill="#9fd0ff" fill-opacity=".75"/><path d="M70 72V52h14v20z" fill="#18324c"/><path d="M70 62h14" stroke="#9fd0ff" stroke-opacity=".5"/>`,
  slaughter: `<path d="M0 10h100" stroke="#2a0b0b" stroke-width="4"/><path d="M22 10v22m0 0a5 5 0 1 0 8 0M62 10v18m0 0a5 5 0 1 0 8 0" stroke="#c9ccd0" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M84 70l-14-14 5-5 14 14z" fill="#9aa0a8"/><path d="M12 66q10-8 20-2t18 0-6 8-22 2z" fill="#a1161c" fill-opacity=".75"/><circle cx="58" cy="48" r="2.4" fill="#c0262c"/><circle cx="46" cy="58" r="1.8" fill="#c0262c"/>`,
  lab: `<path d="M14 72V30a7 7 0 0 1 14 0v42z" fill="#2b4a3f" fill-opacity=".85"/><path d="M16 52h10v18H16z" fill="#7dffb0" fill-opacity=".75"/><path d="M58 72l8-30h8l8 30z" fill="#3b2a66"/><path d="M66 42V30h8v12" stroke="#c9a8ff" stroke-width="2" fill="none"/><circle cx="70" cy="24" r="4" fill="#d9c0ff" fill-opacity=".8"/><path d="M42 20l-6 12h8l-6 14" stroke="#ffe27a" stroke-width="2.4" fill="none" stroke-linejoin="round"/>`
});

function mapSvg(m) {
  const defs = Object.entries(GROUND).map(([key, [dark, light]]) => `<linearGradient id="zcg-${key}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${dark}"/><stop offset="1" stop-color="${light}"/></linearGradient>`).join('');
  const grounds = [], arts = [];
  m.rows.forEach((row, k) => row.forEach(n => {
    const o = 1 - 0.17 * k;
    grounds.push(`<rect x="${n.lane * 100 - 8}" y="${rowY(k) - ROW / 2 - 8}" width="116" height="${ROW + 16}" fill="url(#zcg-${n.region})" opacity="${o}"/>`);
    arts.push(`<g opacity="${Math.min(0.95, o)}" transform="translate(${n.lane * 100} ${rowY(k) - ROW / 2})">${ART[n.region]}</g>`);
  }));
  const here = m.here;
  grounds.push(`<rect x="${m.from * 100 - 8}" y="${youY - ROW / 2 - 8}" width="116" height="${ROW + 16}" fill="url(#zcg-${here})"/>`);
  arts.push(`<g transform="translate(${m.from * 100} ${youY - ROW / 2})">${ART[here]}</g>`);
  const path = (x1, y1, x2, y2) => `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
  const roads = [];
  m.edges.forEach((row, k) => row.forEach((tos, i) => tos.forEach(to => roads.push(`<path class="zc-road" d="${path(laneX(i), rowY(k), laneX(to), rowY(k + 1))}"/>`))));
  m.reach.forEach(to => roads.push(`<path class="zc-road go" d="${path(laneX(m.from), youY, laneX(to), rowY(0))}"/>`));
  return `<svg class="zc-terrain" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs>${defs}<filter id="zcBlur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="9"/></filter></defs><g filter="url(#zcBlur)">${grounds.join('')}</g><g class="zc-art">${arts.join('')}</g><g class="zc-roads">${roads.join('')}</g></svg>`;
}

export function zombieMapHTML(q, kind) {
  const m = q.map,
    optIndex = lane => q.options.findIndex(o => o.lane === lane);
  const rows = [...m.rows.keys()].reverse().map(k => `<div class="zc-maprow">${m.rows[k].map(n => {
    const i = k === 0 ? optIndex(n.lane) : -1,
      info = ZOMBIE_REGIONS[n.region];
    if (i >= 0) return `<button type="button" class="zc-pin reach" style="--c:${info.rgb};--i:${n.lane}" data-zc-pick="${i}"><span class="zc-flag"></span><span class="zc-pinlabel">${info.name}</span></button>`;
    return k === 0 ? `<span class="zc-pin blocked" style="--c:${info.rgb}"><span class="zc-pinlabel">${info.name}</span></span>` : `<span class="zc-pin far" style="--c:${info.rgb}"><span class="zc-pinlabel">${info.name}</span></span>`;
  }).join('')}</div>`).join('');
  const infos = q.options.map((o, i) => {
    const r = zombieRegionInfo(o.region);
    return `<div class="zc-info" data-zc-info="${i}" hidden style="--c:${r.rgb}"><b>${r.name}</b><span>${r.blurb}</span><span class="zc-foes">등장 ${r.zombies.join(' · ')}</span></div>`;
  }).join('');
  return `<div class="boss-reward-shell ${kind} node-pick"><div class="boss-reward-floor"><span>지하</span><b>${q.floor}</b><span>층 도달</span></div><h2 class="boss-reward-title">갈 길을 고르세요</h2><p class="boss-reward-hint" data-boss-reward-status>이어진 땅으로만 갈 수 있습니다. 지형마다 나오는 좀비가 다릅니다.</p><div class="zc-map">${mapSvg(m)}${rows}<span class="zc-here" style="--x:${m.from}"></span></div><div class="zc-infobox"><span class="zc-info-empty">길을 눌러 정보를 확인하세요.</span>${infos}</div><button type="button" class="zc-go" data-zc-go disabled>이 길로 간다</button></div>`;
}

/* 길 선택(확정 전). 확정 버튼에 고른 번호와 보상 직렬을 실어 기존 보상 확정 흐름이 그대로 받는다. */
export function zombieMapPick(event) {
  const pick = event.target?.closest?.('[data-zc-pick]');
  if (!pick) return;
  const shell = pick.closest('.node-pick');
  shell.querySelectorAll('[data-zc-pick]').forEach(b => b.classList.toggle('sel', b === pick));
  shell.querySelectorAll('[data-zc-info]').forEach(el => { el.hidden = el.dataset.zcInfo !== pick.dataset.zcPick; });
  const empty = shell.querySelector('.zc-info-empty');
  if (empty) empty.hidden = true;
  const go = shell.querySelector('[data-zc-go]');
  go.dataset.bossReward = pick.dataset.zcPick;
  go.dataset.bossRewardSerial = String(state_ui_battle_state.game?.pendingTraitChoices?.[0]?.serial || 0);
  go.disabled = false;
}

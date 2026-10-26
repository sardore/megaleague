import { zombieRegionInfo } from '../features/zombie-cave.js';

/*
 * 좀비굴 문. 지역의 좀비를 모두 처치하면 적 두 칸이 돌벽과 문이 된다.
 * - 보상을 고르는 동안은 문이 닫혀 있다.
 * - 문 선택이 열리면 문이 양옆으로 열리고, 칸 전체가 다음 지형 그림 버튼으로 바뀐다.
 * - 칸은 렌더 때마다 새로 만들어지므로 열린 뒤 흐른 시간만큼 애니메이션을 앞당겨 다시 시작하지 않게 한다.
 */
const openedAt = new Map();

/* 돌벽, 아치, 철띠 두른 문 두 짝, 횃불. 모양만으로 그린다(viewBox 200x140). */
const DOOR_SVG = `<svg class="zc-doorsvg" viewBox="0 0 200 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<defs>
<pattern id="zcBrick" width="44" height="22" patternUnits="userSpaceOnUse"><rect width="44" height="22" fill="#2b2f2c"/><path d="M0 .5H44M0 11.5H44M10.5 0V11M32.5 11V22" stroke="#101311" stroke-width="1.6"/><path d="M2 2H20M24 2H40M2 13H8M14 13H30M36 13H42" stroke="#4a504b" stroke-width="1" stroke-opacity=".7"/></pattern>
<linearGradient id="zcWood" x1="0" x2="1"><stop offset="0" stop-color="#2a1b10"/><stop offset=".5" stop-color="#4a3220"/><stop offset="1" stop-color="#26180e"/></linearGradient>
<linearGradient id="zcStone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a9088"/><stop offset="1" stop-color="#434842"/></linearGradient>
<radialGradient id="zcVig" cx=".5" cy=".55" r=".75"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".78"/></radialGradient>
<radialGradient id="zcLight" cx=".5" cy=".7" r=".6"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".95"/><stop offset="1" stop-color="#ff9a3a" stop-opacity="0"/></radialGradient>
<radialGradient id="zcTorch" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb347" stop-opacity=".55"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></radialGradient>
<clipPath id="zcArch"><path d="M62 140V64a38 38 0 0 1 76 0V140z"/></clipPath>
</defs>
<rect width="200" height="140" fill="url(#zcBrick)"/>
<g fill="#1c2a1c" fill-opacity=".55"><path d="M0 0h46q-6 10-2 22t-8 14q-10-6-18 4T0 30z"/><path d="M200 0h-52q6 12 2 26t10 14q10-4 18 6t22-6z"/></g>
<path d="M62 140V64a38 38 0 0 1 76 0V140z" fill="#05080a"/>
<g clip-path="url(#zcArch)"><rect x="50" y="20" width="100" height="120" fill="url(#zcLight)" class="zc-glow"/></g>
<g class="zc-dl"><path d="M62 140V64a38 38 0 0 1 38-38V140z" fill="url(#zcWood)"/><path d="M72 140V50M82 140V34M92 140V28" stroke="#150d07" stroke-width="1.2" stroke-opacity=".8"/><rect x="62" y="62" width="38" height="7" fill="#15181a"/><rect x="62" y="104" width="38" height="7" fill="#15181a"/><g fill="#8b929a"><circle cx="68" cy="65.5" r="1.6"/><circle cx="80" cy="65.5" r="1.6"/><circle cx="92" cy="65.5" r="1.6"/><circle cx="68" cy="107.5" r="1.6"/><circle cx="80" cy="107.5" r="1.6"/><circle cx="92" cy="107.5" r="1.6"/></g><circle cx="94" cy="86" r="4.2" fill="none" stroke="#a7aeb6" stroke-width="1.8"/></g>
<g class="zc-dr"><path d="M138 140V64a38 38 0 0 0-38-38V140z" fill="url(#zcWood)"/><path d="M128 140V50M118 140V34M108 140V28" stroke="#150d07" stroke-width="1.2" stroke-opacity=".8"/><rect x="100" y="62" width="38" height="7" fill="#15181a"/><rect x="100" y="104" width="38" height="7" fill="#15181a"/><g fill="#8b929a"><circle cx="108" cy="65.5" r="1.6"/><circle cx="120" cy="65.5" r="1.6"/><circle cx="132" cy="65.5" r="1.6"/><circle cx="108" cy="107.5" r="1.6"/><circle cx="120" cy="107.5" r="1.6"/><circle cx="132" cy="107.5" r="1.6"/></g><circle cx="106" cy="86" r="4.2" fill="none" stroke="#a7aeb6" stroke-width="1.8"/></g>
<path d="M54 140V64a46 46 0 0 1 92 0V140h-8V64a38 38 0 0 0-76 0V140z" fill="url(#zcStone)" stroke="#161a17" stroke-width="1.4"/>
<path d="M88 14h24l-4 14H92z" fill="#9aa097" stroke="#161a17" stroke-width="1.2"/><path d="M96 19h8M97 23h6" stroke="#4a504b" stroke-width="1.2"/>
<g class="zc-torch"><circle cx="30" cy="62" r="22" fill="url(#zcTorch)" class="zc-tglow"/><path d="M27 70h6l-1 18h-4z" fill="#1a1410"/><path d="M24 70q6-4 12 0" stroke="#3b3128" stroke-width="2" fill="none"/><path class="zc-flame" d="M30 40c5 8 8 12 6 20-1 5-4 8-6 8s-5-3-6-8c-2-8 2-12 6-20z" fill="#ff8a1c"/><path class="zc-flame in" d="M30 50c3 5 5 8 4 13-1 3-2 5-4 5s-3-2-4-5c-1-5 1-8 4-13z" fill="#ffe27a"/></g>
<g class="zc-torch r"><circle cx="170" cy="62" r="22" fill="url(#zcTorch)" class="zc-tglow"/><path d="M167 70h6l-1 18h-4z" fill="#1a1410"/><path d="M164 70q6-4 12 0" stroke="#3b3128" stroke-width="2" fill="none"/><path class="zc-flame" d="M170 40c5 8 8 12 6 20-1 5-4 8-6 8s-5-3-6-8c-2-8 2-12 6-20z" fill="#ff8a1c"/><path class="zc-flame in" d="M170 50c3 5 5 8 4 13-1 3-2 5-4 5s-3-2-4-5c-1-5 1-8 4-13z" fill="#ffe27a"/></g>
<rect width="200" height="140" fill="url(#zcVig)"/>
<rect y="126" width="200" height="14" fill="#06080a" fill-opacity=".7"/>
</svg>`;

/* 칸 하나. info는 zombieCaveDoorInfo의 결과. */
export function zombieDoorHTML(g, info) {
  const key = `${g.matchId || 'match'}:${info.serial}`;
  let elapsed = 0;
  if (info.open) {
    if (!openedAt.has(key)) openedAt.set(key, Date.now());
    elapsed = Date.now() - openedAt.get(key);
  }
  const region = info.option ? zombieRegionInfo(info.option.region) : null;
  const portal = info.open && region ? `<button type="button" class="zc-portal ${info.option.region}" data-boss-reward="${info.index}" data-boss-reward-serial="${info.serial}"><span class="zc-portal-art"></span><span class="zc-portal-name">${region.name}</span><span class="zc-portal-foes">${region.zombies.slice(0, 3).join(' · ')}</span></button>` : '';
  return `<div class="card zc-door-cell ${info.open ? 'open' : 'closed'}" style="--e:-${elapsed}ms">${DOOR_SVG}<span class="zc-dust a"></span><span class="zc-dust b"></span>${portal}</div>`;
}

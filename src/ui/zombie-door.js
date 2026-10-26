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
<linearGradient id="zcIron" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a6169"/><stop offset=".35" stop-color="#2a2f34"/><stop offset="1" stop-color="#0c0e10"/></linearGradient>
<radialGradient id="zcNail" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#e6ebf0"/><stop offset=".6" stop-color="#7a828a"/><stop offset="1" stop-color="#23272b"/></radialGradient>
<linearGradient id="zcShade" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".35" stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>
<linearGradient id="zcWood" x1="0" x2="1"><stop offset="0" stop-color="#2a1b10"/><stop offset=".5" stop-color="#4a3220"/><stop offset="1" stop-color="#26180e"/></linearGradient>
<linearGradient id="zcStone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a9088"/><stop offset="1" stop-color="#434842"/></linearGradient>
<radialGradient id="zcVig" cx=".5" cy=".55" r=".75"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".78"/></radialGradient>
<radialGradient id="zcLight" cx=".5" cy=".7" r=".6"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".95"/><stop offset="1" stop-color="#ff9a3a" stop-opacity="0"/></radialGradient>
<radialGradient id="zcTorch" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb347" stop-opacity=".55"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></radialGradient>
<clipPath id="zcArch"><path d="M62 140V64a38 38 0 0 1 76 0V140z"/></clipPath>
</defs>
<g fill="none" stroke="#000" stroke-linejoin="round"><path d="M50 140V64a50 50 0 0 1 100 0V140" stroke-opacity=".08" stroke-width="16"/><path d="M52 140V64a48 48 0 0 1 96 0V140" stroke-opacity=".12" stroke-width="10"/><path d="M53 140V64a47 47 0 0 1 94 0V140" stroke-opacity=".2" stroke-width="5"/></g>
<path d="M62 140V64a38 38 0 0 1 76 0V140z" fill="#05080a"/>
<g clip-path="url(#zcArch)"><rect x="50" y="20" width="100" height="120" fill="url(#zcLight)" class="zc-glow"/></g>
<g class="zc-dl"><path d="M62 140V64a38 38 0 0 1 38-38V140z" fill="url(#zcWood)"/><path d="M72 140V50M82 140V34M92 140V28" stroke="#150d07" stroke-width="1.4" stroke-opacity=".85"/><path d="M73.2 140V50M83.2 140V34M93.2 140V28" stroke="#c89860" stroke-opacity=".28" stroke-width=".7"/><path d="M62 140V64a38 38 0 0 1 38-38V140z" fill="url(#zcShade)"/><rect x="62" y="62" width="38" height="7" fill="url(#zcIron)"/><rect x="62" y="104" width="38" height="7" fill="url(#zcIron)"/><g fill="url(#zcNail)"><circle cx="68" cy="65.5" r="1.8"/><circle cx="80" cy="65.5" r="1.8"/><circle cx="92" cy="65.5" r="1.8"/><circle cx="68" cy="107.5" r="1.8"/><circle cx="80" cy="107.5" r="1.8"/><circle cx="92" cy="107.5" r="1.8"/></g><circle cx="94" cy="86" r="4.2" fill="none" stroke="#a7aeb6" stroke-width="1.8"/></g>
<g class="zc-dr"><path d="M138 140V64a38 38 0 0 0-38-38V140z" fill="url(#zcWood)"/><path d="M128 140V50M118 140V34M108 140V28" stroke="#150d07" stroke-width="1.4" stroke-opacity=".85"/><path d="M129.2 140V50M119.2 140V34M109.2 140V28" stroke="#c89860" stroke-opacity=".28" stroke-width=".7"/><path d="M138 140V64a38 38 0 0 0-38-38V140z" fill="url(#zcShade)"/><rect x="100" y="62" width="38" height="7" fill="url(#zcIron)"/><rect x="100" y="104" width="38" height="7" fill="url(#zcIron)"/><g fill="url(#zcNail)"><circle cx="108" cy="65.5" r="1.8"/><circle cx="120" cy="65.5" r="1.8"/><circle cx="132" cy="65.5" r="1.8"/><circle cx="108" cy="107.5" r="1.8"/><circle cx="120" cy="107.5" r="1.8"/><circle cx="132" cy="107.5" r="1.8"/></g><circle cx="106" cy="86" r="4.2" fill="none" stroke="#a7aeb6" stroke-width="1.8"/></g>
<path d="M54 140V64a46 46 0 0 1 92 0V140h-8V64a38 38 0 0 0-76 0V140z" fill="url(#zcStone)" stroke="#161a17" stroke-width="1.4"/>
<path d="M54 64a46 46 0 0 1 14-33M146 64a46 46 0 0 0-14-33M72 24a46 46 0 0 1 20-10M128 24a46 46 0 0 0-20-10" stroke="#101311" stroke-width="1.4" fill="none"/><path d="M62 140V64a38 38 0 0 1 76 0" stroke="#c9d0c6" stroke-opacity=".35" stroke-width=".8" fill="none"/><path d="M88 14h24l-4 14H92z" fill="#9aa097" stroke="#161a17" stroke-width="1.2"/><path d="M96 19h8M97 23h6" stroke="#4a504b" stroke-width="1.2"/>
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
  const portal = info.open && region ? `<button type="button" class="zc-portal ${info.option.region}"${g.mode === 'spectator' ? ' disabled' : ''} data-boss-reward="${info.index}" data-boss-reward-serial="${info.serial}"><span class="zc-portal-art"></span><span class="zc-portal-name">${region.name}</span><span class="zc-portal-foes">${region.zombies.slice(0, 3).join(' · ')}</span></button>` : '';
  return `<div class="card zc-door-cell ${info.open ? 'open' : 'closed'}" style="--e:-${elapsed}ms">${DOOR_SVG}<span class="zc-dust a"></span><span class="zc-dust b"></span>${portal}</div>`;
}

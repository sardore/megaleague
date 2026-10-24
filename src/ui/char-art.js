/* 캐릭터 아트 레지스트리.
   카드 id마다 이모지 대신 쓸 벡터 그림(SVG)을 등록하면, 이모지를 그리는 모든 화면(전투 카드·선택 타일·후열 칩·결과·도감)이
   cardEmoji() 한 곳을 통해 자동으로 그림으로 바뀐다. 등록이 없으면 기존 이모지를 그대로 쓴다.

   art = {
     viewBox: "x y w h",     // 가로:세로 약 1.2:1을 권장(이모지 한 글자 칸과 같은 크기 규칙을 쓴다)
     defs:   "<linearGradient id='{id}-x'/>", // 이 그림만 쓰는 그라데이션. id는 {id}-이름 으로 쓰면 문서 공용 defs에 한 번만 실린다
     body:   "<g class='rig rig-xxx'>...</g>", // 부품(리그)별 그룹. 움직임은 CSS의 .rig-* 규칙이 맡는다
   }
   부품 이름 규칙: rig-float(몸 전체 둥실), rig-sway(흔들림), rig-flap(날갯짓), rig-blink(눈 깜빡임), rig-drip(흘러내림),
   rig-ripple(퍼지는 물결), rig-flow(흐르는 선), rig-pulse(깜빡이는 빛). 새 캐릭터도 같은 이름을 쓰면 같은 움직임을 얻는다. */
const registry = new Map();
const DEFS_ID = "char-art-defs";
/* 그라데이션은 문서에 한 번만 두고 모든 그림이 같은 id로 참조한다.
   그림마다 defs를 품으면 같은 id가 중복되고, 숨겨진 사본이 먼저 잡히면 색이 사라진다. 마크업이 매번 같아서 타일 갱신 비교도 흔들리지 않는다. */
function scoped(cardId, text) {
  return String(text).replaceAll("{id}", `ca-${cardId}`);
}
function syncDefs() {
  if (typeof document === "undefined" || !document.body) return;
  let host = document.getElementById(DEFS_ID);
  if (!host) {
    host = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    host.id = DEFS_ID;
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("width", "0");
    host.setAttribute("height", "0");
    host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    document.body.prepend(host);
  }
  const markup = [...registry].map(([cardId, art]) => (art.defs ? scoped(cardId, art.defs) : "")).join("");
  if (host.dataset.signature !== String(markup.length) + ":" + registry.size) {
    host.innerHTML = `<defs>${markup}</defs>`;
    host.dataset.signature = String(markup.length) + ":" + registry.size;
  }
}
export function registerCharacterArt(cardId, art) {
  if (!cardId || !art?.viewBox || !art?.body) throw new Error(`invalid character art: ${cardId}`);
  registry.set(String(cardId), Object.freeze({ ...art }));
}
export function hasCharacterArt(cardId) {
  return registry.has(String(cardId));
}
export function characterArtHTML(cardId) {
  const art = registry.get(String(cardId));
  if (!art) return "";
  syncDefs();
  return `<svg class="char-art char-art-${cardId}" viewBox="${art.viewBox}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${scoped(cardId, art.body)}</svg>`;
}
/* 이 그림이 공용 defs에 싣는 id 목록(참조 누락 검사·디버깅용) */
export function characterArtDefIds(cardId) {
  const art = registry.get(String(cardId));
  return art?.defs ? [...scoped(cardId, art.defs).matchAll(/\sid="([^"]+)"/g)].map(m => m[1]) : [];
}

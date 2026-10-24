import { pictogramHTML } from "./cards.js";

/* 캐릭터 선택창(덱 편성·온라인 대기실·보스 편성·도감)이 공통으로 쓰는 정사각형 타일.
   표시 내용과 등급 색은 이 한 곳에서만 정한다. 등급 색 토큰(--g-main/--g-sub)은 game.css의 등급 색 규칙을 그대로 쓴다. */
export function gradeNumber(grade) {
  const n = Number.parseFloat(String(grade || ""));
  return Number.isFinite(n) ? n : null;
}
export function gradeToneClass(grade) {
  const n = gradeNumber(grade);
  return n == null ? "" : `grade-tone-${Math.round(n * 10)}`;
}
export function tileStarsHTML(grade) {
  const n = gradeNumber(grade);
  if (n == null) return "";
  const full = Math.floor(n),
    half = n - full >= 0.5;
  return `<span class="tile-stars" aria-label="${n}성">${"★".repeat(full)}${half ? '<i class="half">★</i>' : ""}</span>`;
}
export function characterTileClass(grade, ...extra) {
  return ["char-tile", gradeToneClass(grade), ...extra].filter(Boolean).join(" ");
}
/* toggles: 폼 전환·플러스스타 같은 모서리 버튼 HTML. 정보 문구(폼 목록)는 버튼 title로 옮겨 타일을 정사각형으로 유지한다. */
export function characterTileInner(c, effectiveCard, { slotIndex = -1, toggles = "" } = {}) {
  const grade = effectiveCard?.rarity || c.grade;
  const sub = [`HP ${c.maxHp}`, c.shield ? `실드 ${c.shield}` : ""].filter(Boolean).join(" · ");
  return `<div class="tile-art">${pictogramHTML("small", effectiveCard?.effectiveCharacterId || c.id)}</div>${tileStarsHTML(grade)}<i class="tile-order">${slotIndex >= 0 ? slotIndex + 1 : ""}</i><div class="tile-corner">${toggles}</div><div class="tile-label"><b class="tile-name">${effectiveCard?.displayName || c.name}</b><span class="tile-sub">${sub}</span></div>`;
}

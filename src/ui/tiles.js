import { gradeTierClass, pictogramHTML } from "./cards.js";
import { TimerManager } from "../runtime/timers.js";

/* 캐릭터 선택창(덱 편성·온라인 대기실·보스 편성·도감)이 공통으로 쓰는 정사각형 타일.
   표시 내용·등급 색·플러스스타 금테·갱신 방식은 이 한 곳에서만 정한다.
   등급 색 토큰(--g-main/--g-sub)은 game.css의 등급 색 규칙을 그대로 쓴다. */
export function gradeNumber(grade) {
  const n = Number.parseFloat(String(grade || ""));
  return Number.isFinite(n) ? n : null;
}
export function tileStarsHTML(grade) {
  const n = gradeNumber(grade);
  if (n == null) return `<span class="tile-stars"></span>`;
  const full = Math.floor(n),
    half = n - full >= 0.5;
  return `<span class="tile-stars" aria-label="${n}성">${"★".repeat(full)}${half ? '<i class="half">★</i>' : ""}</span>`;
}
/* 등급 색 클래스는 전투 카드와 같은 gradeTierClass(3☆ 이상만, 2☆는 색 없음)를 그대로 쓴다. 플러스스타는 금테 클래스. */
export function characterTileClass(c, effectiveCard, ...extra) {
  return ["char-tile", gradeTierClass(c, effectiveCard), effectiveCard?.plusStar ? "plus-star" : "", ...extra].filter(Boolean).join(" ");
}
/* 폼 전환으로 카드 id가 바뀌어도 같은 칸으로 이어지게 하는 키(폼 패밀리가 있으면 패밀리, 없으면 카드 id). */
export function tileKey(c) {
  return c.formGroup || c.id;
}
export function tileKeyAttr(c) {
  return ` data-tile-key="${tileKey(c)}"`;
}
/* toggles: 폼 전환·플러스스타 같은 모서리 버튼 HTML. 정보 문구(폼 목록)는 버튼 title로 옮겨 타일을 정사각형으로 유지한다. */
export function characterTileInner(c, effectiveCard, { slotIndex = -1, toggles = "" } = {}) {
  const grade = effectiveCard?.rarity || c.grade;
  return `<i class="tile-gold" aria-hidden="true"></i><div class="tile-art">${pictogramHTML("small", effectiveCard?.effectiveCharacterId || c.id)}</div>${tileStarsHTML(grade)}<i class="tile-order">${slotIndex >= 0 ? slotIndex + 1 : ""}</i><div class="tile-corner">${toggles}</div><b class="tile-name">${effectiveCard?.displayName || c.name}</b>`;
}

/* 타일 갱신: 같은 칸이면 요소를 지우지 않고 제자리에서 바꾼다. 그래서 등급 색(CSS 변수 전환)·금테(전환)가 부드럽게 이어지고,
   등급·플러스스타가 바뀐 순간에는 짧은 재등급 연출을, 캐릭터가 바뀌면(폼 전환) 그림 교체 연출을 한 번 재생한다. */
const TONE = /grade-t\d+/;
function toneOf(el) {
  return (el.className.match(TONE) || [""])[0];
}
function morphTile(old, neu) {
  const regrade = toneOf(old) !== toneOf(neu) || old.classList.contains("plus-star") !== neu.classList.contains("plus-star");
  const swapped = old.dataset.cardId !== neu.dataset.cardId || old.querySelector(".tile-art")?.innerHTML !== neu.querySelector(".tile-art")?.innerHTML;
  const keep = ["tile-regrade", "tile-swap"].filter(name => old.classList.contains(name));
  for (const attr of [...old.attributes]) if (!neu.hasAttribute(attr.name) && attr.name !== "class" && attr.name !== "style") old.removeAttribute(attr.name);
  for (const attr of [...neu.attributes]) if (attr.name !== "class") old.setAttribute(attr.name, attr.value);
  old.className = [neu.className, ...keep].join(" ");
  for (const sel of [".tile-art", ".tile-corner", ".tile-order", ".tile-name"]) {
    const from = neu.querySelector(sel),
      to = old.querySelector(sel);
    if (from && to && to.innerHTML !== from.innerHTML) to.innerHTML = from.innerHTML;
  }
  const stars = old.querySelector(".tile-stars"),
    nextStars = neu.querySelector(".tile-stars");
  if (stars && nextStars && stars.outerHTML !== nextStars.outerHTML) stars.replaceWith(nextStars);
  old.onclick = neu.onclick;
  old.onkeydown = neu.onkeydown;
  const flash = (name, ms) => {
    old.classList.remove(name);
    void old.offsetWidth;
    old.classList.add(name);
    TimerManager.setTimeout(() => old.classList.remove(name), ms);
  };
  if (regrade) flash("tile-regrade", 700);
  if (swapped) flash("tile-swap", 520);
}
/* items: HTML 문자열 또는 요소 배열. 칸 수와 칸별 키가 같으면 제자리 갱신, 아니면(리그 변경 등) 통째로 교체한다. */
export function syncTileGrid(container, items) {
  if (!container) return;
  const next = typeof items === "string" ? [...Object.assign(document.createElement("template"), { innerHTML: items }).content.children] : [...items];
  const old = [...container.children];
  const same = old.length === next.length && next.length > 0 && next.every((el, i) => el.dataset.tileKey && el.dataset.tileKey === old[i].dataset.tileKey);
  if (!same) {
    container.replaceChildren(...next);
    return;
  }
  next.forEach((el, i) => morphTile(old[i], el));
}

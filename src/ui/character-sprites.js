// One registry for character art across deck tiles, lobbies and combat.
// New characters only need an entry here and an image placed under assets/media.
export const CHARACTER_SPRITES = Object.freeze({
  sweetna: Object.freeze({
    src: "./assets/media/sweetna.webp?v=hq1254-20261025",
    focusX: 52,
    focusY: 42,
    portraitScale: 1.32,
  }),
});

export function characterSpriteHTML(cardId, mode = "full") {
  const sprite = CHARACTER_SPRITES[cardId];
  if (!sprite) return "";
  const variant = mode === "portrait" ? "portrait" : mode === "small" ? "small" : "full";
  const style = `--sprite-focus-x:${sprite.focusX}%;--sprite-focus-y:${sprite.focusY}%;--sprite-portrait-scale:${sprite.portraitScale};`;
  return `<span class="character-sprite character-sprite--${variant}" data-card-image="${cardId}" role="img" aria-label="${cardId} 캐릭터 일러스트" style="${style}"><img class="character-sprite__image" src="${sprite.src}" alt="" decoding="async" loading="lazy" draggable="false"></span>`;
}

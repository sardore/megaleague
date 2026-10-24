import { test } from "node:test";
import assert from "node:assert/strict";
import { CHARACTER_SPRITES, characterSpriteHTML } from "../../src/ui/character-sprites.js";

test("Sweetna's composition tile displays an upper-body face-focused portrait", () => {
  const html = characterSpriteHTML("sweetna", "portrait");
  assert.match(html, /character-sprite--portrait/);
  assert.match(html, /sweetna\.webp/);
  assert.match(html, /sprite-focus-x:52%/);
  assert.match(html, /sprite-focus-y:42%/);
  assert.match(html, /sprite-portrait-scale:1\.9/);
});

test("other surfaces render full-body sprites and bench cards use compact sprites", () => {
  assert.match(characterSpriteHTML("sweetna"), /character-sprite--full/);
  assert.match(characterSpriteHTML("sweetna", "full"), /character-sprite--full/);
  assert.match(characterSpriteHTML("sweetna", "small"), /character-sprite--small/);
});

test("unregistered characters continue to use emoji through pictogramHTML", () => {
  assert.equal(characterSpriteHTML("not-registered", "portrait"), "");
  assert.ok(Object.isFrozen(CHARACTER_SPRITES));
  assert.ok(Object.isFrozen(CHARACTER_SPRITES.sweetna));
});

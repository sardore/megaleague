import { test } from "node:test";
import assert from "node:assert/strict";
import { CHARACTER_SPRITES, characterSpriteHTML } from "../../src/ui/character-sprites.js";

test("Sweetna's composition tile displays an upper-body face-focused portrait", () => {
  const html = characterSpriteHTML("sweetna", "portrait");
  assert.match(html, /character-sprite--portrait/);
  assert.match(html, /sweetna\.webp/);
  assert.match(html, /sprite-focus-x:52%/);
  assert.match(html, /sprite-focus-y:42%/);
  assert.match(html, /sprite-portrait-scale:1\.32/);
});

test("Master has no sprite and keeps its emoji", () => {
  assert.equal(characterSpriteHTML("master", "portrait"), "");
  assert.equal(characterSpriteHTML("master"), "");
  assert.equal(CHARACTER_SPRITES.master, undefined);
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

test("Sweetna image asset is high-resolution with transparent pixels", async () => {
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(new URL("../../assets/media/sweetna.webp", import.meta.url));
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
  assert.equal(bytes.toString("ascii", 12, 16), "VP8X");
  const width = bytes.readUIntLE(24, 3) + 1;
  const height = bytes.readUIntLE(27, 3) + 1;
  assert.equal(width, 1254);
  assert.equal(height, 1254);
  assert.ok((bytes[20] & 0x10) !== 0, "Alpha channel must be present");
  assert.ok(bytes.byteLength > 40000, "Small preview sprites must not replace the master asset");
});

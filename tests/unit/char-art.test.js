import test from 'node:test';
import assert from 'node:assert/strict';
import { characterArtDefIds, characterArtHTML, hasCharacterArt, registerCharacterArt } from '../../src/ui/char-art.js';
import '../../src/ui/char-art/index.js';

test('registered characters render an svg and unregistered ones fall back to the emoji path', () => {
  for (const id of ['sweetna', 'jetski']) {
    assert.equal(hasCharacterArt(id), true);
    const html = characterArtHTML(id);
    assert.match(html, /^<svg class="char-art char-art-/);
    assert.equal(html.includes('{id}'), false, 'scope placeholder must be replaced');
  }
  assert.equal(hasCharacterArt('hermit'), false);
  assert.equal(characterArtHTML('hermit'), '');
});

test('the markup is deterministic so tile morphing never sees a change', () => {
  assert.equal(characterArtHTML('sweetna'), characterArtHTML('sweetna'));
});

test('every gradient an art references is defined by the same art', () => {
  for (const id of ['sweetna', 'jetski']) {
    const used = [...characterArtHTML(id).matchAll(/url\(#([^)]+)\)/g)].map(m => m[1]);
    const defined = new Set(characterArtDefIds(id));
    assert.ok(used.length > 0);
    for (const name of used) assert.ok(defined.has(name), `${id}: ${name} is referenced but not defined`);
  }
});

test('invalid registrations are rejected', () => {
  assert.throws(() => registerCharacterArt('', { viewBox: '0 0 1 1', body: '<g/>' }));
  assert.throws(() => registerCharacterArt('x', { body: '<g/>' }));
});

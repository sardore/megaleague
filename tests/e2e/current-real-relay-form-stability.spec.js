import { test, expect, chromium } from '@playwright/test';

const APP = process.env.CP32_CURRENT_APP_URL || 'http://127.0.0.1:4173/?relay=ws%3A%2F%2F127.0.0.1%3A8787%2Fonline';

async function waitStartupClear(page) {
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.locator('#deckCards .card').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.horizon-startup-intro').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
}

async function familySurface(page, group) {
  return await page.evaluate(groupName => {
    const grid = document.getElementById('deckCards');
    if (!grid) return null;
    const cards = [...grid.children];
    const toggle = grid.querySelector(`[data-form-toggle="${groupName}"]`);
    const card = toggle?.closest('[data-card-id]') || null;
    if (!card) return null;
    return {
      index: cards.indexOf(card),
      cardId: card.dataset.cardId || null,
      label: toggle?.textContent?.trim() || null,
      count: cards.length,
    };
  }, group);
}

async function cycleFormWithoutMoving(page, group, cycles) {
  const first = await familySurface(page, group);
  expect(first, `${group}: form family surface must exist`).toBeTruthy();
  const anchorIndex = first.index;
  const seen = [first.cardId];

  for (let i = 0; i < cycles; i++) {
    const before = await familySurface(page, group);
    const button = page.locator(`[data-form-toggle="${group}"]`);
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    await button.tap();
    await expect.poll(async () => (await familySurface(page, group))?.cardId, {
      timeout: 10000,
      message: `${group}: form id must change after toggle`,
    }).not.toBe(before.cardId);
    const after = await familySurface(page, group);
    seen.push(after.cardId);
    expect(after.count, `${group}: grid cardinality must stay fixed`).toBe(first.count);
    expect(after.index, `${group}: changing rarity by form must not move the family's placement`).toBe(anchorIndex);
  }
  return seen;
}

test('form change keeps one stable composition placement even when rarity rises', async () => {
  test.setTimeout(90000);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console:${m.text()}`); });
  try {
    await waitStartupClear(page);
    const brkeno = await cycleFormWithoutMoving(page, 'brkeno', 2);
    const iruma = await cycleFormWithoutMoving(page, 'iruma', 2);
    const horizon = await cycleFormWithoutMoving(page, 'horizon', 3);
    expect(new Set(brkeno).size).toBeGreaterThan(1);
    expect(new Set(iruma).size).toBeGreaterThan(1);
    expect(new Set(horizon).size).toBeGreaterThan(2);
    expect(errors, 'browser errors').toEqual([]);
  } finally {
    await context.close();
    await browser.close();
  }
});

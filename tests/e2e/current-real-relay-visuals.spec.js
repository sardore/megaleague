import { test, expect, chromium } from '@playwright/test';
import { pairByRoomCode, waitRemoteCount, startBattle, canonicalBattleState, touchCanonicalAction } from '../helpers/player-path.js';

const APP = process.env.CP32_CURRENT_APP_URL || 'http://127.0.0.1:4173/?relay=ws%3A%2F%2F127.0.0.1%3A8787%2Fonline';
test('both players see each skill once through the real relay', async () => {
  const browser = await chromium.launch();
  const host = await browser.newPage({ viewport:{width:412,height:915},hasTouch:true,isMobile:true });
  const guest = await browser.newPage({ viewport:{width:390,height:844},hasTouch:true,isMobile:true });
  const errors = [];
  for(const page of [host,guest])page.on('pageerror',error=>errors.push(String(error)));
  try {
    await Promise.all([host.goto(APP),guest.goto(APP)]);
    await pairByRoomCode(host,guest);
    for(const page of [host,guest]) {
      const wayli = page.locator('#onlineRoomDeck .online-room-card[data-card-id="wayli"]');
      await wayli.scrollIntoViewIfNeeded(); await wayli.tap({position:{x:30,y:25}});
      for(let i=1;i<4;i++) {
        const card = page.locator('#onlineRoomDeck .online-room-card:not(.selected)[aria-disabled="false"]').first();
        await card.scrollIntoViewIfNeeded(); await card.tap({position:{x:30,y:25}});
      }
    }
    await Promise.all([waitRemoteCount(host,4),waitRemoteCount(guest,4)]);
    await startBattle(host,guest);
    for(const page of [host,guest])await page.evaluate(()=>{
      window.skillRenders = [];
      new MutationObserver(records=>{
        for(const record of records)for(const node of record.addedNodes) {
          if(node.classList?.contains('skill-fx-label')&&node.textContent==='물총세례') {
            const r=node.getBoundingClientRect();
            window.skillRenders.push({text:node.textContent,x:r.x,y:r.y,width:r.width,height:r.height});
          }
        }
      }).observe(document.body,{childList:true,subtree:true});
    });
    const attacked = new Set();
    for(let step=0;step<8 && attacked.size<2;step++) {
      await expect.poll(async()=>{
        const h=await canonicalBattleState(host),g=await canonicalBattleState(guest);
        return h.revision===g.revision && h.turnSerial===g.turnSerial && !h.locks.length && !g.locks.length;
      }).toBe(true);
      const h=await canonicalBattleState(host),actor=h.actorTeam==='P'?host:guest;
      const skill=h.actorCard==='wayli';
      await touchCanonicalAction({host,guest,actor,label:skill?/물총세례/:/에너지\s*모으기/});
      if(skill) {
        attacked.add(h.actorTeam);
        for(const page of [host,guest])await expect.poll(()=>page.evaluate(()=>window.skillRenders.length)).toBe(attacked.size);
      }
    }
    expect([...attacked].sort()).toEqual(['A','P']);
    for(const page of [host,guest]) {
      const renders=await page.evaluate(()=>window.skillRenders);
      expect(renders).toHaveLength(2);
      expect(renders.every(r=>r.width>0&&r.height>0&&r.x>=0&&r.y>=0)).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
});

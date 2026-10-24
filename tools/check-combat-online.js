import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import http from 'node:http';
import assert from 'node:assert/strict';

const bundle = await build({ entryPoints: ['tests/helpers/combat-online-probe.js'], bundle: true,
  write: false, outdir: 'probe', loader: { '.css': 'empty' }, format: 'iife' });
const html = (await fs.readFile('index.html', 'utf8')).replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/, '<script src="/probe.js"></script>');
const server = http.createServer(async (req, res) => {
  if (req.url === '/probe.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
  if (req.url === '/') { res.end(html); return; }
  try { res.end(await fs.readFile('.' + req.url.split('?')[0])); } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
const failures = [];
async function check(name, run) {
  const page = await browser.newPage();
  try {
    const pageFailure = new Promise((_, reject) => page.once('pageerror', reject));
    await Promise.race([(async () => {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.probe);
      await run(page);
    })(), pageFailure]);
    console.log(`PASS ${name}`);
  } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack || error.message}`); if (process.env.MEGA_FAIL_FAST) throw error; }
  finally { await page.close(); }
}
try {
  await check('raid uses its own card, shared clock and battle presentation', async page => {
    const result = await page.evaluate(() => {
      const p=probe, g=p.systems.__redTimeoraBossRaid.createGame(['wayli','hermit','ruby','kingprawn']);
      p.battle.game=g; const boss=g.teams.A.field[0];
      p.render();
      return {id:p.card(boss).id, skills:p.card(boss).skills.map(s=>s.id),clock:p.timeClockMiniHTML(boss,g),tooltip:p.cardTooltipHTML(boss),errors:p.systems.__megaRecoveredErrors};
    });
    assert.equal(result.id,'red_timeora');
    assert.ok(result.skills.includes('bossTimeStrike'));
    assert.match(result.clock,/boss/);
    assert.match(result.tooltip,/공용|동기화/);
  });
  await check('raid hyperclock consumes one guard and emits a red clock effect', async page => {
    const result = await page.evaluate(() => {
      const p=probe,g=p.systems.__redTimeoraBossRaid.createGame(['wayli','hermit','ruby','kingprawn']);
      p.battle.game=g;p.battle.visualEvents=[];g.bossRaid.hyperGuard=1;
      const actor=g.teams.A.field[0],target=g.teams.P.field[0],skill=p.card(actor).skills.find(s=>s.id==='hyperClock');
      const hp=target.hp;
      p.effectApply(g,actor,target,{type:'hyperClock'},skill,{team:'A',slot:0,sim:false,action:{}});
      return {loss:hp-target.hp,guard:g.bossRaid.hyperGuard,event:p.battle.visualEvents.find(e=>e.type==='hyperClockFx')};
    });
    assert.equal(result.guard,0);assert.equal(result.loss,40);
    assert.equal(result.event.bossRed,true);assert.equal(result.event.team,'__bossRed');
  });
  await check('raid defeat grants one reward through the common death path', async page => {
    const result = await page.evaluate(() => {
      const p=probe,g=p.systems.__redTimeoraBossRaid.createGame(['wayli','hermit','ruby','kingprawn']);
      const boss=g.teams.A.field[0];boss.hp=0;
      p.combat.checkDeath(g,boss,g.teams.P.field[0]);
      p.combat.checkDeath(g,boss,g.teams.P.field[0]);
      return {dead:boss.dead,kills:g.bossRaid.kills,rewards:g.pendingTraitChoices.filter(c=>c.kind==='bossReward')};
    });
    assert.equal(result.dead,true);assert.equal(result.kills,1);
    assert.equal(result.rewards.length,1);assert.equal(result.rewards[0].options.length,3);
  });
  await check('combat uses the supplied battle, independent of the displayed battle', async page => {
    const result = await page.evaluate(() => {
      const p = window.probe, api = window.Megaleague;
      const make = () => api.newGame(['wayli','hermit','wayli','hermit'], ['timeora','hermit','wayli','hermit'], { variance: false, seed: 'stats' });
      const g = make(), w = g.teams.P.field[0], t = g.teams.A.field[0];
      t.timeHourDeg = 0; t.timeMinuteDeg = 90;
      w.attackMod = 40; t.defenseMod = 50;
      p.battle.game = g;
      const active = p.combat.damageRange(g, w, t, { amount: 30, crit: 0 }, { id: 'waterbarrage' });
      t.timeMinuteDeg = 0;
      const suppressed = p.combat.damageRange(g, w, t, { amount: 30, crit: 0 }, { id: 'waterbarrage' });
      const other = make(); other.teams.A.field[0].timeMinuteDeg = 90;
      p.battle.game = other;
      const isolated = p.combat.damageRange(g, w, t, { amount: 30, crit: 0 }, { id: 'waterbarrage' });
      return { active, suppressed, isolated };
    });
    assert.deepEqual(result.suppressed, result.isolated);
    assert.equal(result.active.mean, 30);
    assert.equal(result.suppressed.mean, 0);
  });
  await check('reliable snapshots retain skill visuals', async page => {
    const result = await page.evaluate(() => {
      const p = window.probe;
      p.battle.game = Megaleague.newGame(['wayli','hermit','wayli','hermit'], ['wayli','hermit','wayli','hermit'], {mode:'online'});
      Object.assign(p.deck.p2p, {role:'host', matchId:'probe', conn:{open:true,send:()=>false}});
      p.snapshots.sendAuthoritativeOnlineState([{type:'skillFx',uid:'u0',targetUid:'u4',skillName:'물총세례',kind:'water'}]);
      return p.deck.p2p.__reliableStatePacket;
    });
    assert.equal(result.visuals.length, 1);
    assert.ok(result.visualPacketId);
  });
  await check('long multi-hit visual batches are not silently truncated', async page => {
    assert.equal(await page.evaluate(() => probe.cloneOnlineVisualEvents(Array.from({length:100}, (_,i)=>({type:'damage',amount:i}))).length), 100);
  });
  for (const kind of ['same-state', 'same-revision', 'input-preserved', 'new-state', 'terminal']) {
    await check(`remote skill renders exactly once: ${kind}`, async page => {
      const result = await page.evaluate(async kind => {
        const p = window.probe, sent = p.setupGuest(), g = p.battle.game;
        if (kind === 'input-preserved') {
          g.turn = g.order.findIndex(([team])=>team === 'A');
          p.battle.pendingSkill = {test:true,targets:[]};
          document.querySelector('#modal').classList.add('open');
        }
        if (kind === 'same-revision') { p.deck.p2p.lastAuthoritativeRevision = 7; g.networkRevision=7; }
        const incoming = JSON.parse(p.serializeOnlineGame());
        if (kind === 'input-preserved') incoming.networkRevision=7;
        if (kind === 'new-state') incoming.teams.P.field[0].hp -= 10;
        if (kind === 'terminal') incoming.winner = 'P';
        const msg = {type:'authoritativeState',mode:'PVP',matchId:'visual-test',revision:7,
          state:JSON.stringify(incoming),turn:g.turn,turnSerial:g.turnSerial,
          visualPacketId:'skill-1',visuals:[{type:'skillFx',uid:'u0',targetUid:'u4',kind:'projectile',skillName:'물총세례'}]};
        let count = 0;
        const observer = new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.classList?.contains('skill-fx-label'))count++;});
        observer.observe(document.body,{childList:true,subtree:true});
        p.snapshots.applyAuthoritativeOnlineState(msg);
        await new Promise(resolve=>setTimeout(resolve,80));
        p.snapshots.applyAuthoritativeOnlineState(msg);
        await new Promise(resolve=>setTimeout(resolve,80));
        observer.disconnect();
        return {count,revision:p.battle.game.networkRevision,acks:sent.filter(m=>m.type === 'stateAck').map(m=>m.visualAckIds),pending:!!p.battle.pendingSkill};
      },kind);
      assert.equal(result.count,1);
      assert.ok(result.acks.every(ids=>ids.includes('skill-1')));
      if(kind === 'input-preserved')assert.equal(result.pending,true);
      assert.equal(result.revision,7);
    });
  }
  await check('peer coordinates are resolved in the receiving layout', async page => {
    const result = await page.evaluate(() => {
      const p = window.probe; p.setupGuest();
      const event = {type:'leafBlade',uid:'u0',targetUid:'u4',targetUids:['u4'],
        vfxAnchorSnapshot:{source:{x:-999,y:-999},targets:{u4:{x:-999,y:-999}}}};
      const resolved = p.coordinates.VfxCoordinateOwner.resolveEvent(event);
      return {x:resolved?.source?.x,targetX:resolved?.targets?.u4?.x};
    });
    assert.ok(result.x>0); assert.ok(result.targetX>0);
  });
  await check('guest clock presentation cannot advance authoritative turns', async page => {
    const result = await page.evaluate(() => {
      const p = window.probe; p.setupGuest();
      const g = p.battle.game, before = g.turnSerial;
      g.pendingClockTurnAdvance = {teamId:'P',slotIndex:0,actorEntityId:'u0',turnSerial:before};
      const advanced = p.timeCommitPendingTurnAdvance(g);
      return {advanced,before,after:g.turnSerial,pending:!!g.pendingClockTurnAdvance};
    });
    assert.equal(result.advanced,false); assert.equal(result.before,result.after); assert.equal(result.pending,true);
  });
  await check('clock barrier publishes effects before rendering without a second action revision', async page => {
    const result = await page.evaluate(() => {
      const p = window.probe, sent = p.setupGuest();
      p.deck.p2p.role='host'; p.deck.onlineSide='P';
      p.battle.game.pendingClockTurnAdvance={teamId:'P',slotIndex:0,actorEntityId:'u0'};
      const revision=p.commands.onlineAuthoritativeRevision;
      p.battle.visualEvents=[{type:'skillFx',uid:'u0',targetUid:'u4',kind:'projectile',skillName:'물총세례'}];
      p.afterAction();
      const packet=sent.find(m=>m.type==='authoritativeState');
      return {count:packet?.visuals?.length||0,revision:packet?.revision,before:revision,remaining:p.battle.visualEvents.length};
    });
    assert.equal(result.count,1); assert.equal(result.revision,result.before); assert.equal(result.remaining,0);
  });
  await check('shared stats: all cards, aura, suppression, caps, and prediction versus damage', async page => {
    const result = await page.evaluate(() => {
      const p = window.probe, api = window.Megaleague, errors = [];
      let count = 0;
      for(const c of api.CARDS) {
        const g = api.newGame(['wayli','hermit','wayli','hermit'], [c.id,'timeora','wayli','hermit'],{variance:false,seed:'matrix'});
        p.battle.game = g;
        const w = g.teams.P.field[0], t = g.teams.A.field[0], clock = g.teams.A.field[1];
        clock.timeHourDeg = 0; clock.timeMinuteDeg = 90;
        w.attackMod = 70; w.defenseMod = -30; t.attackMod = -40; t.defenseMod = 50;
        t.aromaDamagePenalty = true;
        if(p.combat.rawDamage({amount:30},w,t,{id:'probe'},g)!==30)errors.push(`${c.id}: attack ignore`);
        if(p.combat.effectiveDefense(w,t,{},false,g)!==(api.card(t).baseDefenseTraitBound?0:Number(t.baseDefense||0)))errors.push(`${c.id}: defense ignore`);
        if(p.combat.rawDamage({amount:30},t,w,{id:'probe'},g)!==30)errors.push(`${c.id}: reciprocal ignore`);
        count += 3;
      }
      const g = api.newGame(['hermit','wayli','hermit','wayli'],['hermit','timeora','hermit','wayli'],{variance:false,seed:'comparison'});
      p.battle.game = g;
      const a=g.teams.P.field[0],t=g.teams.A.field[0],clock=g.teams.A.field[1];
      clock.timeHourDeg=0;clock.timeMinuteDeg=90;
      a.attackMod=40;t.baseDefense=0;t.defenseMod=30;t.shield=0;t.hp=1000;t.maxHp=1000;
      const preview=p.combat.damageRange(g,a,t,{amount:100,crit:0},{id:'probe'}).mean;
      const before=t.hp;
      p.combat.dealDamage(g,a,t,{amount:100,crit:0},{id:'probe'},true);
      if(before-t.hp!==preview)errors.push(`preview ${preview}, actual ${before-t.hp}`);
      if(p.visibleDefense(t)!==50)errors.push(`display ${p.visibleDefense(t)}`);
      t.defenseMod=0;
      const auraDisplay=p.battle.CombatStatPresentationOwner.project(t).find(stat=>stat.key==='defense');
      if(auraDisplay?.value!==20||auraDisplay?.effectiveValue!==20)errors.push('continuous aura chip missing');
      t.defenseMod=30;
      if(p.combat.effectiveDefense(a,t,{defCap:5},false,g)!==5)errors.push('combined cap');
      if(p.combat.damageRange(g,a,t,{amount:100,crit:0,ignoreAttackMod:true},{id:'probe'}).mean!==50)errors.push('ignoreAttackMod prediction');
      return {errors,count};
    });
    assert.deepEqual(result.errors,[]);
    console.log(`  ${result.count} card/stat combinations checked`);
  });
  await check('all card damage predictions use the actual mitigation rules', async page => {
    const errors = await page.evaluate(() => {
      const p=window.probe,api=window.Megaleague,errors=[];
      for(const c of api.CARDS) {
        const g=api.newGame(['wayli','hermit','wayli','hermit'],[c.id,'hermit','wayli','hermit'],{variance:false,seed:'mitigation'});
        p.battle.game=g;
        const a=g.teams.P.field[0],t=g.teams.A.field[0];
        t.shield=0;t.hp=t.maxHp=10000;
        const preview=p.combat.damageRange(g,a,t,{amount:100,crit:0},{id:'probe'}).mean,before=t.hp;
        p.combat.dealDamage(g,a,t,{amount:100,crit:0},{id:'probe'},true);
        const actual=before-t.hp;
        if(Math.abs(preview-actual)>.50001)errors.push({card:c.id,preview,actual});
      }
      return errors;
    });
    assert.deepEqual(errors,[]);
  });
  await check('same-revision rejection resolves a pending guest command', async page => {
    const result=await page.evaluate(()=>{
      const p=window.probe;p.setupGuest();const g=p.battle.game;
      g.turn=g.order.findIndex(([team])=>team==='A');
      g.networkRevision=7;p.deck.p2p.lastAuthoritativeRevision=7;p.deck.p2p.connected=true;
      const [team,slot]=g.order[g.turn];
      window.Megaleague.execute(g,team,slot,{type:'gather'});
      const actionId=p.commands.OnlineActionAdmissionOwner.pendingActionId();
      p.snapshots.applyAuthoritativeOnlineState({type:'authoritativeState',mode:'PVP',matchId:'visual-test',
        revision:6,turn:g.turn,turnSerial:g.turnSerial-1,state:p.serializeOnlineGame()});
      const pendingAfterStale=p.commands.OnlineActionAdmissionOwner.hasPending();
      p.snapshots.applyAuthoritativeOnlineState({type:'authoritativeState',mode:'PVP',matchId:'visual-test',
        revision:7,turn:g.turn,turnSerial:g.turnSerial,state:p.serializeOnlineGame(),
        actionResolution:{actionId,status:'rejected',reason:'invalid-action'}});
      return {actionId,pendingAfterStale,pending:p.commands.OnlineActionAdmissionOwner.hasPending(),busy:p.battle.busy};
    });
    assert.ok(result.actionId);assert.equal(result.pendingAfterStale,true);assert.equal(result.pending,false);assert.equal(result.busy,false);
  });
  await check('boss and regular aura providers share the stat and ignore path', async page => {
    const result=await page.evaluate(()=>{
      const p=window.probe,g=window.Megaleague.newGame(['hermit','wayli','hermit','wayli'],['hermit','wayli','hermit','wayli']);
      p.battle.game=g;
      const source=g.teams.A.field[1],target=g.teams.A.field[0];
      source.bossRed=true;
      return {aura:p.combat.effectiveDefense(g.teams.P.field[0],target,{},false,g),
        ignored:p.combat.effectiveDefense(g.teams.P.field[1],target,{},false,g)};
    });
    assert.equal(result.aura,20);assert.equal(result.ignored,0);
  });
  await check('online lobby deck sanitizing keeps a plus-star deck that is only legal with its plus-star choice', async page => {
    const r = await page.evaluate(() => {
      const p = window.probe, cards = p.catalog.CARDS, plain = g => cards.filter(c => c.grade === g && !c.formGroup && !c.tags?.includes('transdimensional-invader'));
      const eligible = [...p.catalog.PLUS_STAR_ELIGIBLE];
      const three = plain('3☆'), plus = three.find(c => eligible.includes(c.id)), base = three.find(c => !eligible.includes(c.id));
      const deck = [plain('2☆')[0].id, base.id, plain('3.5☆')[0].id, plus.id], choice = { cardId: plus.id, slotIndex: 3 };
      return { deck, sanitizedWithChoice: p.cloneAndSanitizeOnlineDeck(deck, 'comprehensive', '2335', choice, 'P'),
        sanitizedGuest: p.cloneAndSanitizeOnlineDeck(deck, 'comprehensive', '2335', choice, 'A'),
        withoutChoice: p.cloneAndSanitizeOnlineDeck(deck, 'comprehensive', '2335') };
    });
    assert.deepEqual(r.sanitizedWithChoice, r.deck, 'the plus-star card must not be dropped');
    assert.equal(r.withoutChoice.length, 3, 'without a plus-star choice the same deck is illegal (sanity)');
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
if (failures.length) process.exitCode = 1;

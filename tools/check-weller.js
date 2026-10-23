import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import http from 'node:http';
import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['tests/helpers/weller-probe.js'],bundle:true,write:false,outdir:'probe',loader:{'.css':'empty'},format:'iife'});
const html=(await fs.readFile('index.html','utf8')).replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/,'<script src="/probe.js"></script>');
const server=http.createServer(async(req,res)=>{
  if(req.url==='/probe.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(req.url==='/'){res.end(html);return;}
  try{res.end(await fs.readFile('.'+req.url.split('?')[0]));}catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch();let passed=0;
async function check(name,run){
  const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  try{await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.wellerFixture);await run(page);assert.deepEqual(errors,[]);passed++;console.log('PASS '+name);}finally{await page.close();}
}
try{
 await check('4-star Zombie and R* / B* cost both work through the action executor',async page=>{
  const r=await page.evaluate(()=>['R','B'].map(color=>{const{g,w,target}=wellerFixture();w.energy=[{c:color,a:1},{c:'W',a:1}];const action=Megaleague.legalActions(g,'P',0).find(a=>a.skill==='suppressedCurse');const ok=Megaleague.execute(g,'P',0,action,{sim:true});return{ok,cost:probe.card(w).skills[0].cost,grade:probe.card(w).grade,zombie:probe.statusRules.isZombie(w),energy:probe.energy.totalEnergy(w),attack:target.attackMod,barrier:w.hpProtectionBarriers.reduce((s,l)=>s+l.amount,0)};}));
  for(const x of r)assert.deepEqual(x,{ok:true,cost:'RorB*',grade:'4☆',zombie:true,energy:0,attack:-10,barrier:60});
 });
 await check('curse stacks at 1/2 turns, bursts at 3, locks the owner like other reserved skills, and preparation is idempotent',async page=>{
  const r=await page.evaluate(()=>{const{g,w,target,prepareOwn,apply}=wellerFixture();apply('suppressedCurse');const rows=[],locks=[];const state=()=>JSON.stringify({a:target.attackMod,b:w.hpProtectionBarriers,c:w.scheduledAction?.elapsed,h:target.hp});for(let i=0;i<3;i++){prepareOwn();const before=state();probe.actions.prepareCurrentTurn(g);if(before!==state())throw Error('duplicate tick');const acts=Megaleague.legalActions(g,'P',0);locks.push(acts.map(a=>a.type).join());if(!Megaleague.execute(g,'P',0,acts[0],{sim:true}))throw Error('scheduled action refused');rows.push([target.attackMod,w.hpProtectionBarriers.reduce((s,l)=>s+l.amount,0)]);}return{rows,locks,pending:!!w.scheduledAction,raw:g.logs.filter(l=>String(l.msg).includes('억누른저주')).map(l=>l.msg)};});
  assert.deepEqual(r.locks,['scheduled','scheduled','scheduled']);assert.deepEqual(r.rows,[[-20,40],[-30,20],[0,0]]);assert.equal(r.pending,false);
 });
await check('curse consumes all attack decreases and preserves positive attack bonuses',async page=>{
  const r=await page.evaluate(()=>{const{g,w,target,prepareOwn,apply}=wellerFixture();probe.effects.setAttack(g,target,50);probe.effects.setAttack(g,target,-20);apply('suppressedCurse',target,false);probe.battle.game=g;probe.battle.visualEvents=[];for(let i=0;i<3;i++){prepareOwn();Megaleague.execute(g,'P',0,Megaleague.legalActions(g,'P',0)[0]);}return{attack:target.attackMod,decrease:probe.effects.totalAttackDecrease(target),burst:probe.battle.visualEvents.find(e=>e.type==='wellerFx'&&e.phase==='curseBurst')?.rawAmount};});
  assert.deepEqual(r,{attack:50,decrease:0,burst:200});
 });
 await check('slime mitigation shares prediction, attack and nonattack paths',async page=>{
  const r=await page.evaluate(()=>{const{g,w}=wellerFixture(),a=g.teams.A.field[1];probe.effects.addHpProtectionBarrier(g,w,60,w.uid);const range=probe.combat.damageRange(g,a,w,{amount:100,crit:0},{id:'test',name:'test'});probe.combat.dealDamage(g,a,w,{amount:100,crit:0},{id:'test',name:'test'},true);const b=w.hpProtectionBarriers.reduce((n,l)=>n+l.amount,0);probe.combat.nonAttackDamage(g,w,20,'test');return{mean:range.mean,barrier:b,hp:w.hp};});
  assert.deepEqual(r,{mean:50,barrier:10,hp:160});
 });
 await check('barrier blocks skills and retreat in both enumeration and command execution',async page=>{
  const r=await page.evaluate(()=>{const{g,w,target}=wellerFixture();probe.effects.addHpProtectionBarrier(g,w,60,w.uid,'suppressedCurse',{decayPerTurn:20});w.energy=[{c:'R',a:4}];const before=probe.energy.totalEnergy(w),actions=Megaleague.legalActions(g,'P',0);const ok=Megaleague.execute(g,'P',0,{type:'skill',skill:'graveDown',target:{team:'A',slot:0,uid:target.uid}},{sim:true});const sw=Megaleague.execute(g,'P',0,{type:'switch',bench:0},{sim:true});return{actions:actions.map(a=>a.type),ok,sw,same:before===probe.energy.totalEnergy(w)};});
  assert.ok(r.actions.includes('gather'));assert.ok(!r.actions.includes('skill')&&!r.actions.includes('switch'));assert.equal(r.ok,false);assert.equal(r.sw,false);assert.equal(r.same,true);
 });
 await check('single targets redirect while area skills and suppressed traits remain valid',async page=>{
  const r=await page.evaluate(()=>{const{g,w}=wellerFixture();probe.effects.addHpProtectionBarrier(g,w,60,w.uid);const a=g.teams.A.field[1];const refs=target=>probe.entities.resolveSkillTargets(g,'A',1,a,{id:'fixture',target,effects:[]}).map(r=>r.uid);const first={single:refs('enemy'),any:refs('anyCharacter'),area:refs('enemyField')};w.statuses.traitSeal=2;return{first,unsealed:refs('enemy'),uid:w.uid,other:g.teams.P.field[1].uid};});
  assert.deepEqual(r.first.single,[r.uid]);assert.deepEqual(r.first.any,[r.uid]);assert.deepEqual(r.first.area,[r.uid,r.other]);assert.deepEqual(r.unsealed,[r.uid,r.other]);
 });
 await check('Grave Up precedes death, restores 40 per turn and is consumed once',async page=>{
  const r=await page.evaluate(()=>{const{g,w,prepareOwn}=wellerFixture();probe.combat.nonAttackDamage(g,w,999,'lethal');const initial={hp:w.hp,dead:w.dead,undead:w.statuses.undead,barrier:w.hpProtectionBarriers.reduce((n,l)=>n+l.amount,0),consumed:w.graveUpConsumed};const rows=[];for(let i=0;i<4;i++){prepareOwn();rows.push([w.hp,w.hpProtectionBarriers.reduce((n,l)=>n+l.amount,0)]);probe.execution.endTurn(g,'P',0,false);}probe.combat.nonAttackDamage(g,w,999,'second lethal');return{initial,rows,dead:w.dead,undead:w.statuses.undead||0};});
  assert.deepEqual(r.initial,{hp:0,dead:false,undead:4,barrier:160,consumed:true});assert.deepEqual(r.rows,[[40,120],[80,80],[120,40],[160,0]]);assert.equal(r.dead,true);assert.equal(r.undead,0);
 });
 await check('undead applied in own action retains four full turns; cleansing at HP zero kills',async page=>{
  const r=await page.evaluate(()=>{const{g,w}=wellerFixture();probe.combat.nonAttackDamage(g,w,999,'lethal');probe.execution.endTurn(g,'P',0,false);const duration=w.statuses.undead;probe.combat.clearStatuses(g,w);return{duration,dead:w.dead,kills:g.teams.P.deathSerial};});
  assert.deepEqual(r,{duration:4,dead:true,kills:1});
 });
 await check('generic Zombie tag prevents death and ordinary undead converts healing, including pools',async page=>{
  const r=await page.evaluate(()=>{const{g,target}=wellerFixture();probe.registerCardDefinition({...probe.card(target),id:'syntheticZombie',name:'다른 좀비',tags:['zombie'],graveUp:false});target.card='syntheticZombie';target.hp=0;probe.combat.applyStatus(g,target,'undead',2);probe.combat.checkDeath(g,target);const held=!target.dead;target.card='turtle';target.hp=target.maxHp;target.baseDefense=0;probe.combat.heal(g,target,40);const loss=target.maxHp-target.hp;target.fullInvulnerableUntilOwnTurn=true;probe.effects.distributeHealPool(g,[target],100);const after=target.hp;return{held,loss,after,hp:target.hp};});
  assert.equal(r.held,true);assert.equal(r.loss,40);assert.equal(r.after,r.hp);
 });
 await check('Grave Down uses a strict HP comparison and common death interception',async page=>{
  const r=await page.evaluate(()=>{const{g,w,target,apply}=wellerFixture();target.hp=w.hp;apply('graveDown');const equal=target.hp;target.hp=w.hp-1;target.shield=900;probe.effects.addHpProtectionBarrier(g,target,100,target.uid);apply('graveDown');const dead=target.dead;const zombie=g.teams.P.bench[0];zombie.card='weller';zombie.maxHp=160;zombie.hp=100;apply('graveDown',zombie);return{equal,dead,shield:target.shield,held:!zombie.dead,undead:zombie.statuses.undead,barrier:zombie.hpProtectionBarriers.reduce((n,l)=>n+l.amount,0)};});
  assert.deepEqual(r,{equal:160,dead:true,shield:900,held:true,undead:4,barrier:160});
 });
 await check('snapshot restore retains recovery, curse schedule, consumed trait and undead',async page=>{
  const r=await page.evaluate(()=>{const{g,w,apply}=wellerFixture();apply('suppressedCurse');probe.combat.nonAttackDamage(g,w,999,'lethal');probe.battle.game=g;const state=probe.serializeOnlineGame();const restored=probe.state_runtime_snapshots.OnlineSnapshotEngine.restoreState(state,{source:'test'});const u=restored.teams.P.field[0];probe.combat.checkDeath(restored,u);return{undead:u.statuses.undead,remaining:u.graveUpRecovery.remaining,curses:u.scheduledAction?.kind==='suppressedCurse'?1:0,consumed:u.graveUpConsumed,dead:u.dead,kills:restored.teams.P.deathSerial||0};});
  assert.deepEqual(r,{undead:4,remaining:4,curses:1,consumed:true,dead:false,kills:0});
 });
 await check('persistent purple aura survives redraw and disappears on cure; skills render at the target',async page=>{
  await page.waitForSelector('#horizonStartupIntro',{state:'detached'});
  await page.evaluate(()=>{const{g,w,target}=wellerFixture();probe.battle.game=g;document.querySelector('#setup').classList.remove('active');document.querySelector('#game').classList.add('active');probe.combat.applyStatus(g,w,'undead',4);probe.render();probe.battle.visualEvents=[{type:'wellerFx',phase:'graveDown',uid:w.uid,targetUid:target.uid,succeeds:true}];probe.playVisuals();});
  await page.waitForSelector('.weller-graveDown');assert.equal(await page.locator('.undead-aura .undead-wisp').count(),10);
  await page.waitForTimeout(650);await fs.mkdir('artifacts/weller',{recursive:true});await page.screenshot({path:'artifacts/weller/grave-down-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  for(const phase of ['curse','graveUp','curseBurst','graveDown']){
    await page.evaluate(phase=>{document.querySelectorAll('.weller-fx').forEach(e=>e.remove());const g=probe.battle.game;probe.render();probe.battle.visualEvents=[{type:'wellerFx',phase,uid:g.teams.P.field[0].uid,targetUid:phase==='graveUp'?g.teams.P.field[0].uid:g.teams.A.field[0].uid,succeeds:true,stage:1}];probe.playVisuals();},phase);
    await page.waitForTimeout(550);await page.screenshot({path:`artifacts/weller/${phase}-desktop.png`,fullPage:true});
  }
  const r=await page.evaluate(()=>{probe.render();const kept=document.querySelectorAll('.undead-aura').length;probe.combat.clearStatuses(probe.battle.game,probe.battle.game.teams.P.field[0]);probe.render();return{kept,ended:document.querySelectorAll('.undead-aura').length};});assert.deepEqual(r,{kept:1,ended:0});
 });
 await check('remote undead state rebuilds the aura and a retried effect renders once',async page=>{
  const r=await page.evaluate(async()=>{
    const p=probe,sent=p.setupGuest(),incoming=JSON.parse(p.serializeOnlineGame());
    const unit=incoming.teams.P.field[0];unit.card='weller';unit.maxHp=160;unit.hp=0;unit.statuses.undead=4;unit.graveUpConsumed=true;unit.graveUpRecovery={remaining:4,amount:40};unit.hpProtectionBarriers=[{amount:160,kind:'graveUp',decayPerTurn:40,sourceUid:unit.uid}];
    const message={type:'authoritativeState',mode:'PVP',matchId:'visual-test',revision:7,state:JSON.stringify(incoming),turn:incoming.turn,turnSerial:incoming.turnSerial,visualPacketId:'weller-retry',visuals:[{type:'wellerFx',phase:'graveUp',uid:unit.uid,targetUid:unit.uid}]};
    let count=0;const observer=new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n.classList?.contains('weller-graveUp'))count++;});observer.observe(document.body,{childList:true,subtree:true});
    p.snapshots.applyAuthoritativeOnlineState(message);await new Promise(r=>setTimeout(r,100));p.snapshots.applyAuthoritativeOnlineState(message);await new Promise(r=>setTimeout(r,100));observer.disconnect();
    return{count,aura:document.querySelectorAll('.undead-aura').length,ack:sent.some(m=>m.visualAckIds?.includes('weller-retry')),hp:p.battle.game.teams.P.field[0].hp,remaining:p.battle.game.teams.P.field[0].graveUpRecovery.remaining};
  });
  assert.deepEqual(r,{count:1,aura:1,ack:true,hp:0,remaining:4});
 });
 console.log(`${passed} Weller checks passed`);
}finally{await browser.close();server.close();}

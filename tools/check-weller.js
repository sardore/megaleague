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
 await check('curse is a slot reservation like every other delayed skill: it follows the enemy slot, and an emptied slot fizzles it',async page=>{
  const r=await page.evaluate(()=>{
    const slotCurse=(mutate)=>{const{g,w,target,prepareOwn,apply}=wellerFixture();apply('suppressedCurse');const ref={team:w.scheduledAction.targetTeam,slot:w.scheduledAction.targetSlot,uid:w.scheduledAction.targetUid};const heir=g.teams.A.bench[0];mutate(g,target,heir);let afterFirst=null;for(let i=0;i<3;i++){prepareOwn();const acts=Megaleague.legalActions(g,'P',0);Megaleague.execute(g,'P',0,acts[0],{sim:true});if(i===0)afterFirst=heir.attackMod;}return{ref,pending:!!w.scheduledAction,afterFirst,heirHp:heir.hp,heirMax:heir.maxHp,targetHp:target.hp,log:g.logs.map(l=>String(l.msg)).filter(m=>m.includes('슬롯')||m.includes('억누른저주')).slice(-2)};};
    const follow=slotCurse((g,target,heir)=>{heir.attackMod=0;g.teams.A.field[0]=heir;heir.hp=heir.maxHp=300;});
    const fizzle=slotCurse((g,target,heir)=>{target.dead=true;target.hp=0;});
    return{follow,fizzle};
  });
  assert.equal(r.follow.ref.team,'A');assert.equal(r.follow.ref.slot,0);assert.equal('uid' in r.follow.ref&&r.follow.ref.uid!==undefined,false,'reservation must not carry a unit uid');
  assert.equal(r.follow.pending,false);assert.equal(r.follow.afterFirst,-10,'the stack must land on the unit now occupying the reserved slot');
  assert.equal(r.fizzle.pending,false);assert.ok(r.fizzle.log.some(m=>m.includes('슬롯')),'empty reserved slot must fizzle through the common path');
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
 await check('Grave Up heals exactly the barrier it loses: absorbed damage is not refunded',async page=>{
  const r=await page.evaluate(()=>{const{g,w,prepareOwn}=wellerFixture();probe.combat.nonAttackDamage(g,w,999,'lethal');probe.combat.nonAttackDamage(g,w,260,'chip');const left=w.hpProtectionBarriers.reduce((n,l)=>n+l.amount,0);prepareOwn();const hp1=w.hp,b1=w.hpProtectionBarriers.reduce((n,l)=>n+l.amount,0);probe.execution.endTurn(g,'P',0,false);prepareOwn();return{left,hp1,b1,hp2:w.hp,b2:w.hpProtectionBarriers.reduce((n,l)=>n+l.amount,0)};});
  assert.deepEqual(r,{left:30,hp1:30,b1:0,hp2:30,b2:0});
 });
 await check('a unit forcing single targets is marked persistently on its card (no one-shot popup)',async page=>{
  const r=await page.evaluate(()=>{const{g,w}=wellerFixture();probe.battle.game=g;const before=probe.entities.isTargetMagnet(g,w);probe.effects.addHpProtectionBarrier(g,w,60,w.uid,'suppressedCurse',{decayPerTurn:20});const during=probe.entities.isTargetMagnet(g,w);probe.render();const el=document.querySelector(`.battle-unit-card.target-magnet[data-entity-id="${w.uid}"]`);return{before,during,marked:!!el};});
  assert.deepEqual(r,{before:false,during:true,marked:true});
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
  const r=await page.evaluate(()=>{const{g,w,apply}=wellerFixture();apply('suppressedCurse');probe.combat.nonAttackDamage(g,w,999,'lethal');probe.battle.game=g;const state=probe.serializeOnlineGame();const restored=probe.state_runtime_snapshots.OnlineSnapshotEngine.restoreState(state,{source:'test'});const u=restored.teams.P.field[0];probe.combat.checkDeath(restored,u);return{undead:u.statuses.undead,barrier:u.hpProtectionBarriers.filter(x=>x.healOnDecay==='graveUp').reduce((n,x)=>n+x.amount,0),curses:u.scheduledAction?.kind==='suppressedCurse'?1:0,consumed:u.graveUpConsumed,dead:u.dead,kills:restored.teams.P.deathSerial||0};});
  assert.deepEqual(r,{undead:4,barrier:160,curses:1,consumed:true,dead:false,kills:0});
 });
 await check('persistent purple aura survives redraw and disappears on cure; skills render at the target',async page=>{
  await page.waitForSelector('#startupIntro',{state:'detached'});
  await page.evaluate(()=>{const{g,w,target}=wellerFixture();probe.battle.game=g;document.querySelector('#setup').classList.remove('active');document.querySelector('#game').classList.add('active');probe.combat.applyStatus(g,w,'undead',4);probe.render();probe.battle.visualEvents=[{type:'wellerFx',phase:'graveDown',uid:w.uid,targetUid:target.uid,succeeds:true}];probe.playVisuals();});
  await page.waitForSelector('.weller-graveDown');assert.equal(await page.locator('.undead-aura').count(),1);assert.equal(await page.locator('.undead-aura .uw').count(),3);await page.waitForTimeout(600);await page.screenshot({path:'artifacts/weller/aura-mobile.png',clip:{x:0,y:240,width:412,height:160}});
  await page.waitForTimeout(650);await fs.mkdir('artifacts/weller',{recursive:true});await page.screenshot({path:'artifacts/weller/grave-down-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  for(const phase of ['curse','graveUp','curseBurst','graveDown']){
    await page.evaluate(phase=>{document.querySelectorAll('.weller-fx').forEach(e=>e.remove());const g=probe.battle.game;probe.render();probe.battle.visualEvents=[{type:'wellerFx',phase,uid:g.teams.P.field[0].uid,targetUid:phase==='graveUp'?g.teams.P.field[0].uid:g.teams.A.field[0].uid,succeeds:true,stage:1}];probe.playVisuals();},phase);
    await page.waitForTimeout(550);await page.screenshot({path:`artifacts/weller/${phase}-desktop.png`,fullPage:true});
  }
  await page.evaluate(()=>{document.querySelectorAll('.weller-fx').forEach(e=>e.remove());probe.render();});await page.waitForTimeout(1400);await page.locator('.battle-unit-card:has(.undead-aura)').first().screenshot({path:'artifacts/weller/aura-card.png'});
  const r=await page.evaluate(()=>{probe.render();const kept=document.querySelectorAll('.undead-aura').length;probe.combat.clearStatuses(probe.battle.game,probe.battle.game.teams.P.field[0]);probe.render();return{kept,ended:document.querySelectorAll('.undead-aura').length};});assert.deepEqual(r,{kept:1,ended:0});
 });
 await check('remote undead state rebuilds the aura and a retried effect renders once',async page=>{
  const r=await page.evaluate(async()=>{
    const p=probe,sent=p.setupGuest(),incoming=JSON.parse(p.serializeOnlineGame());
    const unit=incoming.teams.P.field[0];unit.card='weller';unit.maxHp=160;unit.hp=0;unit.statuses.undead=4;unit.graveUpConsumed=true;unit.hpProtectionBarriers=[{amount:160,kind:'graveUp',decayPerTurn:40,healOnDecay:'graveUp',sourceUid:unit.uid}];
    const message={type:'authoritativeState',mode:'PVP',matchId:'visual-test',revision:7,state:JSON.stringify(incoming),turn:incoming.turn,turnSerial:incoming.turnSerial,visualPacketId:'weller-retry',visuals:[{type:'wellerFx',phase:'graveUp',uid:unit.uid,targetUid:unit.uid}]};
    let count=0;const observer=new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n.classList?.contains('weller-graveUp'))count++;});observer.observe(document.body,{childList:true,subtree:true});
    p.snapshots.applyAuthoritativeOnlineState(message);await new Promise(r=>setTimeout(r,100));p.snapshots.applyAuthoritativeOnlineState(message);await new Promise(r=>setTimeout(r,100));observer.disconnect();
    return{count,aura:document.querySelectorAll('.undead-aura').length,ack:sent.some(m=>m.visualAckIds?.includes('weller-retry')),hp:p.battle.game.teams.P.field[0].hp,barrier:p.battle.game.teams.P.field[0].hpProtectionBarriers[0].amount};
  });
  assert.deepEqual(r,{count:1,aura:1,ack:true,hp:0,barrier:160});
 });
 await check('a rolled-back scheduled execution can be retried on the same turn (deterministic id is not blacklisted)',async page=>{
  const r=await page.evaluate(()=>{const{g,target,prepareOwn,apply}=wellerFixture();probe.battle.game=g;apply('suppressedCurse',target,false);for(let i=0;i<3;i++)prepareOwn();
    const view=()=>({atk:g.teams.A.field[0].attackMod,serial:g.turnSerial,pending:!!g.teams.P.field[0].scheduledAction});
    const act=()=>Megaleague.legalActions(g,'P',0).find(a=>a.type==='scheduled');
    const start=view();probe.tx.ActionFaultInjector.arm('validation-after');let threw=false;try{Megaleague.execute(g,'P',0,act(),{sim:false});}catch{threw=true;}probe.tx.ActionFaultInjector.clear();
    const rolledBack=view();const retry=Megaleague.execute(g,'P',0,act(),{sim:false});const done=view();
    return{threw,start,rolledBack,retry,done};});
  assert.equal(r.threw,true);assert.deepEqual(r.rolledBack,r.start);assert.equal(r.retry,true);assert.equal(r.done.atk,r.start.atk-10);
 });
 await check('운명의 시계 연출의 채도 저하는 시계 주인을 뺀 아군·적군 모두에 걸린다 (판정 영역과 같은 규칙)',async page=>{
  const r=await page.evaluate(()=>{document.getElementById('startupIntro')?.remove();const g=Megaleague.newGame(['timeora','hermit','turtle','mole'],['turtle','mole','hermit','mushroom'],{mode:'ai',variance:false,seed:'sat'});
   g.order=[['P',0],['A',0],['P',1],['A',1]];g.turn=0;g.turnSerial=0;g.preparedKey=null;probe.battle.game=g;document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById('game').classList.add('active');
   const t=g.teams.P.field[0];t.timeHourDeg=90;t.timeMinuteDeg=0;probe.actions.prepareCurrentTurn(g);probe.render();
   const lease=probe.sat.acquire(g,[{clocks:[{uid:t.uid,team:'P',aligned:true,blocked:false}]}]);
   const held=[...document.querySelectorAll('.battle-unit-card[data-zone="field"]')].map(el=>[el.dataset.team+':'+el.dataset.cardId,el.classList.contains('clock-visual-saturation-held')]);lease.release();return held;});
  assert.deepEqual(r,[['A:turtle',true],['A:mole',true],['P:timeora',false],['P:hermit',true]]);
 });
 await check('방어 변화 표기는 지금 적용 중인 기본 방어를 기준으로 한다: 특성 정지로 드래곤피시의 -20이 빠져도 +20으로 표시되지 않는다',async page=>{
  const r=await page.evaluate(()=>{document.getElementById('startupIntro')?.remove();const g=Megaleague.newGame(['dragonfish','hermit','turtle','mole'],['turtle','mole','hermit','mushroom'],{mode:'ai',variance:false,seed:'dfish'});probe.battle.game=g;
   const d=g.teams.P.field[0],chips=()=>probe.battle.CombatStatPresentationOwner.project(d).map(c=>[c.key,c.value,c.effectiveValue]);
   const rows={plain:chips()};d.statuses.traitSeal=2;rows.sealed=chips();delete d.statuses.traitSeal;d.defenseMod=15;rows.boosted=chips();d.statuses.traitSeal=2;rows.sealedBoosted=chips();return rows;});
  assert.deepEqual(r.plain,[['defense',0,-20]]);assert.deepEqual(r.sealed,[]);assert.deepEqual(r.boosted,[['defense',15,-5]]);assert.deepEqual(r.sealedBoosted,[['defense',15,15]]);
 });
 await check('운명의 시계 채도 저하는 아군·적, 행동 중·타깃 가능 여부와 무관하게 같은 경로로 즉시 걸리고 재렌더에도 원색으로 돌아가지 않는다',async page=>{
  const r=await page.evaluate(async()=>{document.getElementById('startupIntro')?.remove();const out={};
   for(const side of ['P','A']){
    const mine=['timeora','dragonfish','turtle','mole'],other=['silvrae','mole','hermit','mushroom'];
    const g=Megaleague.newGame(side==='P'?mine:other,side==='P'?other:mine,{mode:'ai',variance:false,seed:'sat'+side});
    g.order=[['P',1],['A',1],['P',0],['A',0]];g.turn=0;g.turnSerial=0;g.preparedKey=null;probe.battle.game=g;g.matchId='sat'+side;
    document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));document.getElementById('game').classList.add('active');
    const owner=g.teams[side].field[0];owner.timeHourDeg=90;owner.timeMinuteDeg=90;probe.actions.prepareCurrentTurn(g);probe.render();
    await new Promise(r=>setTimeout(r,450));probe.render();
    out[side]={cards:[...document.querySelectorAll('.arena .battle-unit-card[data-zone="field"]')].map(el=>[el.dataset.team+el.dataset.slot,getComputedStyle(el).filter,el.classList.contains('active-turn')]),attr:document.body.dataset.fateClockSuppressedTeam||null};
   }
   return out;});
  for(const side of ['P','A']){
   const rows=r[side].cards;assert.equal(rows.length,4);assert.equal(r[side].attr,null);
   for(const [id,filter] of rows)assert.equal(filter,id===side+'0'?'none':'saturate(0.33)',`${side}: ${id}`);
   assert.ok(rows.some(x=>x[2]&&x[1]==='saturate(0.33)'),'the acting unit is desaturated too');
  }
 });
 console.log(`${passed} Weller checks passed`);
}finally{await browser.close();server.close();}

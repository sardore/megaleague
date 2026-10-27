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
  try{await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.wellerFixture);await run(page);assert.deepEqual(errors,[]);passed++;}
  catch(e){console.error('FAIL',name,e);process.exitCode=1;}finally{await page.close();}
}
const setup=id=>`const g=Megaleague.newGame(['${id}','mole','turtle','hermit'],['mole','turtle','hermit','mushroom'],{mode:'ai',variance:false,seed:'nc'});
 g.order=[['P',0],['A',0],['P',1],['A',1]];g.turn=0;g.turnSerial=0;g.preparedKey=null;
 const u=g.teams.P.field[0],t=g.teams.A.field[0];
 const skill=sid=>probe.card(u).skills.find(s=>s.id===sid);
 const usable=()=>{u.energy=[{c:'R',a:3},{c:'W',a:3},{c:'B',a:3}];return [...new Set(Megaleague.legalActions(g,'P',0).filter(a=>a.type==='skill').map(a=>a.skill))].sort();};`;
try{
 await check('helmet shark: stats, dragon class, skill set depends on shield',async page=>{
  const r=await page.evaluate(`(()=>{${setup('helmetShark')}
   const c=probe.card(u);const out={hp:c.maxHp,shield:u.shield,grade:c.grade,dragon:c.tags.includes('dragon')};
   out.withShield=usable();u.shield=0;out.noShield=usable();
   u.shield=0;u.statuses={...u.statuses,traitSeal:2};out.sealedNoShield=usable();u.shield=30;out.sealedShield=usable();return out;})()`);
  assert.deepEqual(r,{hp:130,shield:30,grade:'2☆',dragon:true,withShield:['whirl'],noShield:['dragonRush'],sealedNoShield:['dragonRush','whirl'],sealedShield:['dragonRush','whirl']});
 });
 await check('dragon rush recoil is a third of the damage actually dealt',async page=>{
  const r=await page.evaluate(`(()=>{${setup('helmetShark')}
   u.shield=0;t.hp=t.maxHp=999;t.shield=0;t.defense=0;t.baseDefense=0;t.defenseMod=0;const hp0=u.hp;
   const dealt=probe.effectApply(g,u,t,skill('dragonRush').effects[0],skill('dragonRush'),{team:'P',slot:0,sim:false,action:{}});
   return {dealt,lost:hp0-u.hp,exp:Math.round(dealt/3)};})()`);
  assert.equal(r.dealt,120);assert.equal(r.lost,r.exp);assert.equal(r.lost,40);
 });
 await check('snake armor: base defense 10, +10 attack only without shield (and only while the trait works)',async page=>{
  const r=await page.evaluate(`(()=>{${setup('snakeArmor')}
   t.hp=t.maxHp=999;t.shield=0;t.defense=0;t.baseDefense=0;t.defenseMod=0;
   const hit=()=>{t.hp=999;probe.effectApply(g,u,t,skill('poisonTail').effects[0],skill('poisonTail'),{team:'P',slot:0,sim:false,action:{}});return 999-t.hp;};
   const out={def:u.defense,speed:probe.card(u).speed,shield:u.shield,withShield:hit()};u.shield=0;out.noShield=hit();u.statuses={...u.statuses,traitSeal:2};out.sealed=hit();return out;})()`);
  assert.deepEqual(r,{def:10,speed:-1,shield:40,withShield:70,noShield:80,sealed:70});
 });
 await check('snake armor: dig hits 80D then slows itself and raises its own defense by 10; poison tail rolls 50% poison',async page=>{
  const r=await page.evaluate(`(()=>{${setup('snakeArmor')}
   t.hp=t.maxHp=999;t.shield=0;t.defense=0;t.baseDefense=0;t.defenseMod=0;const d0=u.defense;
   for(const e of skill('dig').effects)probe.effectApply(g,u,t,e,skill('dig'),{team:'P',slot:0,sim:false,action:{}});
   const out={dmg:999-t.hp,slow:probe.energy.status(u,'slow'),defGain:u.defense-d0,targetSlow:probe.energy.status(t,'slow')};
   let poisoned=0;for(let n=0;n<300;n++){t.statuses={};probe.effectApply(g,u,t,skill('poisonTail').effects[1],skill('poisonTail'),{team:'P',slot:0,sim:false,action:{}});if(probe.energy.status(t,'poison'))poisoned++;}
   out.poisonRate=poisoned/300;return out;})()`);
  assert.equal(r.dmg,80);assert.ok(r.slow>0&&r.targetSlow===0,JSON.stringify(r));assert.equal(r.defGain,10);assert.ok(r.poisonRate>.4&&r.poisonRate<.6,JSON.stringify(r));
 });
 await check('sandcastle: wind whitens all target energy, wall decays 40 per own turn start through the common barrier path, quake empties both sides',async page=>{
  const r=await page.evaluate(`(()=>{${setup('sandcastle')}
   const c=probe.card(u);const out={hp:c.maxHp,grade:c.grade,cost:c.skills.map(s=>s.cost)};
   t.hp=t.maxHp=999;t.shield=0;t.defense=0;t.baseDefense=0;t.defenseMod=0;t.energy=[{c:'R',a:1},{c:'B',a:1},{c:'W',a:1}];
   const run=(sid,tgt,i=0)=>probe.effectApply(g,u,tgt,skill(sid).effects[i],skill(sid),{team:'P',slot:0,sim:false,action:{}});
   run('sandWind',t,0);run('sandWind',t,1);out.wind={dmg:999-t.hp,colors:[...new Set(t.energy.map(e=>e.c))],total:t.energy.reduce((n,e)=>n+e.a,0)};
   u.energy=[{c:'R',a:1},{c:'W',a:2}];t.energy=[{c:'B',a:2}];t.hp=999;
   for(let i=0;i<3;i++)run('sandQuake',t,i);out.quake={dmg:999-t.hp,target:t.energy.length,self:u.energy.length};
   const ally=g.teams.P.field[1];run('sandWall',ally);out.wall0=ally.hpProtectionBarriers.map(b=>b.amount);
   for(let i=1;i<=3;i++){ally.barrierTurnEpoch=(ally.barrierTurnEpoch||0)+1;probe.effects.decayHpProtectionBarriers(g,ally,true);out['t'+i]=ally.hpProtectionBarriers.map(b=>b.amount);}
   return out;})()`);
  assert.equal(r.hp,140);assert.equal(r.grade,'2☆');assert.deepEqual(r.cost,['W','**','WW WorB *']);
  assert.deepEqual(r.wind,{dmg:30,colors:['W'],total:3});assert.deepEqual(r.quake,{dmg:120,target:0,self:0});
  assert.deepEqual(r.wall0,[100]);assert.deepEqual([r.t1,r.t2,r.t3],[[60],[20],[]]);
 });
 await check('dual-actor targets: colour change and removal reach both the beast and rider stores',async page=>{
  const r=await page.evaluate(`(()=>{const g=Megaleague.newGame(['sandcastle','mole','turtle','hermit'],['iceknight','turtle','hermit','mushroom'],{mode:'ai',variance:false,seed:'d'});
   const u=g.teams.P.field[0],t=g.teams.A.field[0];const sk=id=>probe.card(u).skills.find(s=>s.id===id);const ctx={team:'P',slot:0,sim:false,action:{}};
   t.energy=[];t.beastEnergy=[{c:'R',a:1},{c:'B',a:1}];t.riderEnergy=[{c:'W',a:1},{c:'R',a:1}];
   probe.effectApply(g,u,t,sk('sandWind').effects[1],sk('sandWind'),ctx);
   const colors=[...t.beastEnergy,...t.riderEnergy].map(e=>e.c).join('');
   probe.effectApply(g,u,t,sk('sandQuake').effects[1],sk('sandQuake'),ctx);
   return {colors,left:t.beastEnergy.length+t.riderEnergy.length};})()`);
  assert.deepEqual(r,{colors:'WWWW',left:0});
 });
 await check('frost: stats and skills; snow breath hits 30D and removes the rightmost target energy',async page=>{
  const r=await page.evaluate(`(()=>{${setup('frost')}
   const c=probe.card(u);const out={hp:c.maxHp,grade:c.grade,cost:c.skills.map(s=>s.cost)};
   t.hp=t.maxHp=999;t.shield=0;t.defense=0;t.baseDefense=0;t.defenseMod=0;t.energy=[{c:'R',a:1},{c:'B',a:1},{c:'W',a:1}];
   for(const e of skill('snowBreath').effects)probe.effectApply(g,u,t,e,skill('snowBreath'),{team:'P',slot:0,sim:false,action:{}});
   out.dmg=999-t.hp;out.left=t.energy.map(e=>e.c).join('');return out;})()`);
  assert.deepEqual(r,{hp:110,grade:'2☆',cost:['W','W'],dmg:30,left:'RB'});
 });
 await check('frost: frostbind freezes until the target energy is full; it never counts down and ends at the owner turn end once full',async page=>{
  const r=await page.evaluate(`(()=>{${setup('frost')}
   const out={};const ctx={team:'P',slot:0,sim:false,action:{}};t.energy=[{c:'R',a:1}];
   probe.effectApply(g,u,t,skill('frostbind').effects[0],skill('frostbind'),ctx);
   out.applied=probe.energy.status(t,'freeze');out.label=probe.statusRules.statusLabel(t,'freeze');
   const endOwn=()=>{g.turn=1;g.turnSerial++;g.preparedKey=null;probe.actions.prepareCurrentTurn(g);probe.execution.endTurn(g,'A',0,false);};
   endOwn();out.afterTurn1=probe.energy.status(t,'freeze');
   t.energy=[{c:'R',a:1},{c:'B',a:1},{c:'W',a:1}];endOwn();out.afterTurn2=probe.energy.status(t,'freeze');
   t.energy=[{c:'R',a:2},{c:'B',a:1},{c:'W',a:1}];endOwn();out.full=probe.energy.status(t,'freeze');
   t.energy=[{c:'R',a:2},{c:'B',a:1},{c:'W',a:1}];
   probe.effectApply(g,u,t,skill('frostbind').effects[0],skill('frostbind'),ctx);out.fullApplied=probe.energy.status(t,'freeze');
   endOwn();out.fullEnded=probe.energy.status(t,'freeze');
   return out;})()`);
  assert.deepEqual(r,{applied:3,label:'냉동 : 에너지를 다 채우기까지',afterTurn1:3,afterTurn2:1,full:0,fullApplied:1,fullEnded:0});
 });
 await check('frost: freeze absorb nullifies any freeze and gives W W; a regular freeze keeps counting down',async page=>{
  const r=await page.evaluate(`(()=>{${setup('frost')}
   const out={};u.energy=[{c:'R',a:1}];
   out.applied=probe.combat.applyStatus(g,u,'freeze',2,t);out.frozen=probe.energy.status(u,'freeze');out.energy=u.energy.map(e=>e.c+e.a).join('');
   u.energy=[{c:'R',a:1},{c:'R',a:1},{c:'B',a:1},{c:'B',a:1}];probe.combat.applyStatus(g,u,'freeze',2,t);out.fullTotal=u.energy.reduce((n,e)=>n+e.a,0);out.fullHasW=u.energy.some(e=>e.c==='W');
   t.statuses={};probe.combat.applyStatus(g,t,'freeze',2,u);t.fillFreeze=false;
   g.turn=1;g.turnSerial++;g.preparedKey=null;probe.actions.prepareCurrentTurn(g);probe.execution.endTurn(g,'A',0,false);
   out.timed=probe.energy.status(t,'freeze');return out;})()`);
  assert.deepEqual(r,{applied:false,frozen:0,energy:'R1W1W1',fullTotal:4,fullHasW:true,timed:1});
 });
 await check('frost: a frozen unit on either side takes 20 at its turn start, including frost itself; not while the trait is sealed; ice knight still absorbs for 20 HP',async page=>{
  const r=await page.evaluate(`(()=>{${setup('frost')}
   const out={};const ally=g.teams.P.field[1];t.hp=t.maxHp=999;ally.hp=ally.maxHp=999;t.statuses={freeze:2};ally.statuses={freeze:2};
   const startOf=(team,slot)=>{g.turn=g.order.findIndex(([x,y])=>x===team&&y===slot);g.turnSerial++;g.preparedKey=null;probe.actions.prepareCurrentTurn(g);};
   startOf('A',0);out.enemy=999-t.hp;startOf('P',1);out.ally=999-ally.hp;
   u.hp=u.maxHp=999;u.statuses={freeze:2};startOf('P',0);out.self=999-u.hp;
   t.hp=999;u.statuses={traitSeal:2};startOf('A',0);out.sealed=999-t.hp;
   const g2=Megaleague.newGame(['iceknight','mole','turtle','hermit'],['mole','turtle','hermit','mushroom'],{mode:'ai',variance:false,seed:'ik'});
   const k=g2.teams.P.field[0];k.hp=100;out.knight=probe.combat.applyStatus(g2,k,'freeze',2,null);out.knightHp=k.hp;out.knightFrozen=probe.energy.status(k,'freeze');
   return out;})()`);
  assert.deepEqual(r,{enemy:20,ally:20,self:20,sealed:0,knight:false,knightHp:120,knightFrozen:0});
 });
 console.log(`${passed} new-card checks passed`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

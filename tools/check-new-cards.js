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
 console.log(`${passed} new-card checks passed`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

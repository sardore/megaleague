import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import http from 'node:http';
import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['tests/helpers/zombie-probe.js'],bundle:true,write:false,outdir:'probe',loader:{'.css':'empty'},format:'iife'});
const html=(await fs.readFile('index.html','utf8')).replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/,'<script src="/probe.js"></script>');
const server=http.createServer(async(req,res)=>{
  if(req.url==='/probe.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(req.url==='/'){res.end(html);return;}
  try{res.end(await fs.readFile('.'+req.url.split('?')[0]));}catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch();let passed=0;
async function check(name,run){
  const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  try{await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.zombieFixture&&window.__redTimeoraBossRaid);await run(page);assert.deepEqual(errors,[]);passed++;console.log('PASS '+name);}finally{await page.close();}
}
try{
 await check('a new cave starts with two walkers, no countdown, and zombie cards stay out of the normal card pool',async page=>{
  const r=await page.evaluate(()=>{const g=zombieFixture();return{field:g.teams.A.field.map(u=>u.card),timers:g.bossRaid.cave.timers,depth:g.bossRaid.cave.depth,kind:g.bossRaid.kind,inPool:Megaleague.CARDS.some(c=>String(c.id).startsWith('zc_')),bench:g.teams.A.bench.length};});
  assert.deepEqual(r,{field:['zc_walker','zc_walker'],timers:[null,null],depth:1,kind:'zombie',inPool:false,bench:0});
 });
 await check('an emptied slot counts down in rounds and the next zombie enters exactly when it ends',async page=>{
  const r=await page.evaluate(()=>{
    const g=zombieFixture(),z=g.teams.A.field[0];g.round=2;
    probe.combatRules.nonAttackDamage(g,z,9999,'test');
    const due=g.bossRaid.cave.timers[0],info1=probe.zc.zombieCaveSlotInfo(g,'A',0);
    g.round=due-1;probe.execution.checkWinner(g);const early=g.teams.A.field[0]?.dead!==false||g.teams.A.field[0]===z;
    const stillEmpty=g.bossRaid.cave.timers[0]===due&&g.teams.A.field[0]===z;
    g.round=due;probe.execution.checkWinner(g);
    const n=g.teams.A.field[0];
    return{due,info1,stillEmpty,spawned:!!n&&n!==z&&!n.dead,timer:g.bossRaid.cave.timers[0],otherUntouched:g.teams.A.field[1].card,winner:g.winner||null,graveyard:g.teams.A.graveyard.length};
  });
  assert.equal(r.due,5);assert.deepEqual(r.info1,{remaining:3,rounds:3});assert.equal(r.stillEmpty,true);assert.equal(r.spawned,true);
  assert.equal(r.timer,null);assert.equal(r.winner,null);assert.equal(r.graveyard,1);
 });
 await check('the winner is decided only when the party is wiped, never when the field is empty of zombies',async page=>{
  const r=await page.evaluate(()=>{
    const g=zombieFixture();
    for(const z of g.teams.A.field)probe.combatRules.nonAttackDamage(g,z,9999,'t');
    probe.execution.checkWinner(g);const afterZombies=g.winner||null;
    for(const u of [...g.teams.P.field,...g.teams.P.bench])if(u){u.hp=0;u.dead=true;}
    probe.execution.checkWinner(g);
    return{afterZombies,final:g.winner};
  });
  assert.deepEqual(r,{afterZombies:null,final:'A'});
 });
 await check('rage starts after 10 survived turns and adds attack on every later turn',async page=>{
  const r=await page.evaluate(()=>{
    const g=zombieFixture(),z=g.teams.A.field[0],rows=[];
    for(let turns=1;turns<=12;turns++){z.turns=turns;probe.zc.zombieCaveOwnTurnEnded(g,'A',z);rows.push([turns,z.attackMod-z.zcBaseAttack,z.zcRage]);}
    const badge=probe.zc.zombieCaveBadge(g,z);
    return{rows,badge:badge?.text,other:g.teams.A.field[1].attackMod-g.teams.A.field[1].zcBaseAttack};
  });
  for(const [turns,gain,rage] of r.rows){const exp=turns<10?0:(turns-9)*10;assert.equal(gain,exp,`turn ${turns}`);assert.equal(rage,exp);}
  assert.equal(r.badge,'격노 +30');assert.equal(r.other,0);
 });
 await check('stat reset removes only positive attack/defense boosts and leaves debuffs and rage-free units alone',async page=>{
  const r=await page.evaluate(()=>{
    const g=zombieFixture(),a=g.teams.P.field[0],b=g.teams.P.field[1];
    a.attackMod=35;a.defenseMod=10;a.defense=a.baseDefense+10;b.attackMod=-15;
    const ra=probe.zc.resetStatBoosts(g,a),rb=probe.zc.resetStatBoosts(g,b);
    return{a:[a.attackMod,a.defenseMod,a.defense===a.baseDefense],ra,b:b.attackMod,rb};
  });
  assert.deepEqual(r,{a:[0,0,true],ra:45,b:-15,rb:0});
 });
 await check('field reset skill and single reset skill both go through the effect dispatcher',async page=>{
  const r=await page.evaluate(()=>{
    const g=zombieFixture();for(const u of g.teams.P.field){u.attackMod=40;u.defenseMod=5;u.defense=u.baseDefense+5;}
    const wight=probe.zc.spawnZombie(g,0,'zc_wight')||(()=>{g.teams.A.field[0].dead=true;return probe.zc.spawnZombie(g,0,'zc_wight');})();
    const sk=probe.card(wight).skills.find(s=>s.id==='zc_oblivion'),t=g.teams.P.field[0];
    probe.effectApply(g,wight,t,sk.effects[1],sk,{team:'A',slot:0,sim:true,action:{}});
    const single=[g.teams.P.field[0].attackMod,g.teams.P.field[1].attackMod];
    const hexer=(()=>{g.teams.A.field[1].dead=true;return probe.zc.spawnZombie(g,1,'zc_hexer');})();
    const sk2=probe.card(hexer).skills.find(s=>s.id==='zc_silence');
    probe.effectApply(g,hexer,t,sk2.effects[0],sk2,{team:'A',slot:1,sim:true,action:{}});
    return{single,field:g.teams.P.field.map(u=>[u.attackMod,u.defenseMod])};
  });
  assert.deepEqual(r.single,[0,40]);assert.deepEqual(r.field,[[0,0],[0,0]]);
 });
 await check('every third kill descends a floor and queues a reward choice; death burst hurts the whole party',async page=>{
  const r=await page.evaluate(()=>{
    const g=zombieFixture();const out=[];
    for(let i=0;i<3;i++){const z=g.teams.A.field[i%2];if(!z||z.dead){g.round+=9;probe.execution.checkWinner(g);}
      probe.combatRules.nonAttackDamage(g,g.teams.A.field[i%2],9999,'t');out.push([g.bossRaid.cave.kills,g.bossRaid.cave.depth,g.pendingTraitChoices?.length||0]);}
    const g2=zombieFixture('b',['mole','boar','mantis','mushroom']);g2.teams.A.field[0].dead=true;const bl=probe.zc.spawnZombie(g2,0,'zc_bloater');
    const before=g2.teams.P.field.map(u=>u.hp);probe.combatRules.nonAttackDamage(g2,bl,9999,'t');
    return{out,burst:g2.teams.P.field.map((u,i)=>before[i]-u.hp),title:g.pendingTraitChoices?.[0]?.title};
  });
  assert.deepEqual(r.out,[[1,1,0],[2,1,0],[3,2,1]]);assert.deepEqual(r.burst,[45,45]);assert.match(r.title,/지하 2층/);
 });
 await check('spawn table is deterministic per seed/serial, Weller appears only from floor 15, rage-resetters never stack on the field',async page=>{
  const r=await page.evaluate(()=>{
    const pick=(depth,serial,seed='s')=>{const g=zombieFixture(seed);g.bossRaid.cave.depth=depth;g.bossRaid.cave.serial=serial;return probe.zc.pickZombieId(g);};
    const same=[0,1,2,3,4].every(n=>pick(8,n)===pick(8,n));
    const early=new Set(),late=new Set();
    for(let n=0;n<400;n++){early.add(pick(14,n,'a'+n));late.add(pick(20,n,'b'+n));}
    const g=zombieFixture('r');g.bossRaid.cave.depth=20;g.teams.A.field[0].card='zc_wight';
    let stacked=false;for(let n=0;n<200;n++){g.bossRaid.cave.serial=n;const id=probe.zc.pickZombieId(g);if(id==='zc_wight'||id==='zc_hexer')stacked=true;}
    return{same,earlyWeller:early.has('weller'),lateWeller:late.has('weller'),kinds:late.size,stacked};
  });
  assert.equal(r.same,true);assert.equal(r.earlyWeller,false);assert.equal(r.lateWeller,true);assert.ok(r.kinds>=14,'late floors must be varied');assert.equal(r.stacked,false);
 });
 await check('every zombie can spawn and act: legal actions exist and no skill throws',async page=>{
  const r=await page.evaluate(()=>{
    const ids=probe.zc.zombieCaveCards().map(c=>c.id).concat('weller'),bad=[];
    for(const id of ids){
      try{
        const g=zombieFixture('all-'+id);g.bossRaid.cave.depth=16;g.teams.A.field[0].dead=true;
        const z=probe.zc.spawnZombie(g,0,id);for(const c of ['R','W','B'])z.energy=[...(z.energy||[]),{c,a:3}];
        g.order=[['A',0],['P',0],['A',1],['P',1]];g.turn=0;g.turnSerial++;g.preparedKey=null;probe.actions.prepareCurrentTurn(g);
        const acts=Megaleague.legalActions(g,'A',0);
        const skills=acts.filter(a=>a.type==='skill');
        if(!acts.length)bad.push(id+':no-actions');
        const a=skills[0]||acts[0];if(!Megaleague.execute(g,'A',0,a,{sim:true}))bad.push(id+':refused');
      }catch(e){bad.push(id+':'+e.message);}
    }
    return{count:ids.length,bad};
  });
  assert.deepEqual(r.bad,[]);assert.ok(r.count>=17);
 });
 await check('cave state survives the online projection round trip',async page=>{
  const r=await page.evaluate(()=>{
    const R=window.__redTimeoraBossRaid,g=zombieFixture('rt');
    probe.combatRules.nonAttackDamage(g,g.teams.A.field[0],9999,'t');g.teams.A.field[1].turns=11;
    const copy=R.revive(R.serialize(g));
    return{cave:JSON.stringify(copy.bossRaid.cave)===JSON.stringify(g.bossRaid.cave),kind:copy.bossRaid.kind,turns:copy.teams.A.field[1].turns,slot:probe.zc.zombieCaveSlotInfo(copy,'A',0)};
  });
  assert.equal(r.cave,true);assert.equal(r.kind,'zombie');assert.equal(r.turns,11);assert.deepEqual(r.slot,{remaining:3,rounds:3});
 });
 await check('the countdown renders inside the empty enemy card and ticks without a separate overlay',async page=>{
  const r=await page.evaluate(()=>{
    const g=zombieFixture('ui');probe.battle.game=g;g.matchId='zc-ui';
    document.querySelector('#setup').classList.remove('active');document.querySelector('#game').classList.add('active');
    probe.combatRules.nonAttackDamage(g,g.teams.A.field[0],9999,'t');probe.render();
    const first=document.querySelector('.zc-entrance');const n1=first?.querySelector('.zc-count span')?.textContent;
    const inSlot=!!first?.closest('.slot, .side');
    g.round+=1;probe.render();const second=document.querySelector('.zc-entrance');
    return{n1,n2:second?.querySelector('.zc-count span')?.textContent,ticked:second?.classList.contains('zc-tick'),inSlot,count:document.querySelectorAll('.zc-entrance').length,badge:!!document.querySelector('.unit-effect-badge.zombie-clock')};
  });
  assert.deepEqual(r,{n1:'3',n2:'2',ticked:true,inSlot:true,count:1,badge:true});
 });
}finally{await browser.close();server.close();}
console.log(`${passed} zombie cave checks passed`);

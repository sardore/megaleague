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
  assert.equal(r.due,4);assert.deepEqual(r.info1,{remaining:2,rounds:2});assert.equal(r.stillEmpty,true);assert.equal(r.spawned,true);
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
 await check('clearing a zone turns the two enemy slots into doors; choosing one starts a much harder zone; death burst hurts the whole party',async page=>{
  const r=await page.evaluate(()=>{
    const g=zombieFixture('z1');const cave=g.bossRaid.cave;cave.zoneSize=3;
    const kill=i=>probe.combatRules.nonAttackDamage(g,g.teams.A.field[i],9999,'t');
    kill(0);const mid={cleared:cave.cleared,pending:g.pendingTraitChoices.length,timer:cave.timers[0]!=null};
    g.round+=9;probe.execution.checkWinner(g);const refill=g.teams.A.field[0];const third=refill&&!refill.dead;
    kill(1);if(third)kill(0);else{g.round+=9;probe.execution.checkWinner(g);kill(0);}
    const left=g.teams.A.field.filter(u=>u&&!u.dead).length;
    const after={cleared:cave.cleared,spawned:cave.spawned,size:cave.zoneSize,left,kinds:g.pendingTraitChoices.map(q=>q.door?'door':'reward'),timers:cave.timers.every(t=>t==null)};
    const door=g.pendingTraitChoices.find(q=>q.door);
    g.round+=20;probe.execution.checkWinner(g);const stillEmpty=g.teams.A.field.every(u=>!u||u.dead);
    const regions=door.options.map(o=>o.region);
    const hp0=probe.zc.zombieCaveHpScale?1:null;
    probe.zc.zombieCaveEnterZone(g,regions[0]);
    const g2=zombieFixture('b',['mole','boar','mantis','mushroom']);g2.teams.A.field[0].dead=true;const bl=probe.zc.spawnZombie(g2,0,'zc_bloater');
    const before=g2.teams.P.field.map(u=>u.hp);probe.combatRules.nonAttackDamage(g2,bl,9999,'t');
    return{mid,after,stillEmpty,regions,entered:{depth:cave.depth,region:cave.region,size:cave.zoneSize,spawned:cave.spawned,cleared:cave.cleared,field:g.teams.A.field.map(u=>u&&!u.dead)},hpScale:probe.zc.ZOMBIE_CAVE.hpScale(2),atkScale:probe.zc.ZOMBIE_CAVE.attackScale(2),burst:g2.teams.P.field.map((u,i)=>before[i]-u.hp),floor:door.floor};
  });
  assert.equal(r.mid.cleared,false);assert.equal(r.mid.pending,0);assert.equal(r.mid.timer,true);
  assert.equal(r.after.cleared,true);assert.equal(r.after.spawned,3);assert.equal(r.after.left,0);assert.deepEqual(r.after.kinds,['reward','door']);assert.equal(r.after.timers,true);assert.equal(r.stillEmpty,true);
  assert.equal(r.regions.length,2);assert.notEqual(r.regions[0],r.regions[1]);
  assert.deepEqual(r.entered,{depth:2,region:r.regions[0],size:5,spawned:2,cleared:false,field:[true,true]});
  assert.ok(r.hpScale>=1.2&&r.atkScale>=10);assert.deepEqual(r.burst,[40,40]);
 });
 await check('doors lead only to the current terrain or a neighbouring one and are deterministic per seed',async page=>{
  const r=await page.evaluate(()=>{
    const ring=['graveyard','sewer','slaughter','lab','hospital'],linked=(a,b)=>{const d=Math.abs(ring.indexOf(a)-ring.indexOf(b));return d===0||d===1||d===4;};
    let ok=true,same=true;
    for(let n=0;n<40;n++){const g=zombieFixture('d'+n);const cave=g.bossRaid.cave;cave.depth=1+n%7;cave.region=ring[n%5];const a=probe.zc.zombieCaveDoorRegions(g),b=probe.zc.zombieCaveDoorRegions(g);if(!a.every(x=>linked(cave.region,x))||a[0]===a[1])ok=false;if(a.join()!==b.join())same=false;}
    return{ok,same};
  });
  assert.equal(r.ok,true);assert.equal(r.same,true);
 });
 await check('regions bias the spawn table',async page=>{
  const r=await page.evaluate(()=>{
    const g=zombieFixture('m1');const cave=g.bossRaid.cave;cave.depth=5;
    const count=region=>{cave.region=region;const hits={};for(let i=0;i<300;i++){cave.serial=i;const id=probe.zc.pickZombieId(g);hits[id]=(hits[id]||0)+1;}return hits;};
    const sew=count('sewer'),sla=count('slaughter');
    const share=(h,ids)=>ids.reduce((n,id)=>n+(h[id]||0),0)/300;
    return{sew:share(sew,probe.zc.ZOMBIE_REGIONS.sewer.ids),sewInSla:share(sla,probe.zc.ZOMBIE_REGIONS.sewer.ids)};
  });
  assert.ok(r.sew>r.sewInSla+0.2,JSON.stringify(r));
 });
 await check('deeper zones field more zombies and make dangerous kinds more likely',async page=>{
  const r=await page.evaluate(()=>{
    const Z=probe.zc.ZOMBIE_CAVE;const g=zombieFixture('dg');const cave=g.bossRaid.cave;
    const danger=depth=>{cave.depth=depth;cave.region=null;let n=0;for(let i=0;i<500;i++){cave.serial=i;const id=probe.zc.pickZombieId(g);if(['zc_juggernaut','zc_plaguelord','zc_hexer','zc_necro','zc_butcher','weller'].includes(id)||id.startsWith('zp:'))n++;}return n/500;};
    return{s:[1,3,6,12].map(Z.zoneSize),early:danger(2),late:danger(9)};
  });
  assert.deepEqual(r.s,[4,6,9,12]);assert.ok(r.late>r.early+0.15,JSON.stringify(r));
 });
 await check('spawn table is deterministic per seed/serial, Weller appears only from zone 8, rage-resetters never stack on the field',async page=>{
  const r=await page.evaluate(()=>{
    const pick=(depth,serial,seed='s')=>{const g=zombieFixture(seed);g.bossRaid.cave.depth=depth;g.bossRaid.cave.serial=serial;return probe.zc.pickZombieId(g);};
    const same=[0,1,2,3,4].every(n=>pick(8,n)===pick(8,n));
    const early=new Set(),late=new Set();
    for(let n=0;n<400;n++){early.add(pick(7,n,'a'+n));late.add(pick(10,n,'b'+n));}
    const g=zombieFixture('r');g.bossRaid.cave.depth=10;g.teams.A.field[0].card='zc_wight';
    let stacked=false;for(let n=0;n<200;n++){g.bossRaid.cave.serial=n;const id=probe.zc.pickZombieId(g);if(id==='zc_wight'||id==='zc_hexer')stacked=true;}
    return{same,earlyWeller:early.has('weller'),lateWeller:late.has('weller'),kinds:late.size,stacked};
  });
  assert.equal(r.same,true);assert.equal(r.earlyWeller,false);assert.equal(r.lateWeller,true);assert.ok(r.kinds>=14,'late floors must be varied');assert.equal(r.stacked,false);
 });
 await check('special affixes appear only from floor 3, are deterministic, and change the spawned zombie',async page=>{
  const r=await page.evaluate(()=>{
    const roll=(depth,n)=>{const g=zombieFixture('af'+n);g.bossRaid.cave.depth=depth;g.teams.A.field[0].dead=true;const z=probe.zc.spawnZombie(g,0,'zc_walker');return{a:z.zcAffix||null,sh:z.shield,atk:z.attackMod-z.zcBaseAttack,after:z.zcRageAfter||null};};
    const early=Array.from({length:60},(_,i)=>roll(2,i).a),late=Array.from({length:200},(_,i)=>roll(12,i));
    const kinds=new Set(late.map(x=>x.a).filter(Boolean));
    return{early:early.some(Boolean),kinds:[...kinds].sort(),again:JSON.stringify(roll(12,7))===JSON.stringify(roll(12,7)),plated:late.find(x=>x.a==='plated')?.sh>0,berserk:late.find(x=>x.a==='berserk')?.after,share:late.filter(x=>x.a).length/late.length};
  });
  assert.equal(r.early,false);assert.deepEqual(r.kinds,['berserk','plated','regen']);assert.equal(r.again,true);assert.equal(r.plated,true);assert.equal(r.berserk,6);assert.ok(r.share>0.4&&r.share<0.9);
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
  assert.deepEqual(r.bad,[]);assert.ok(r.count>=21);
 });
 await check('cave state survives the online projection round trip',async page=>{
  const r=await page.evaluate(()=>{
    const R=window.__redTimeoraBossRaid,g=zombieFixture('rt');
    probe.combatRules.nonAttackDamage(g,g.teams.A.field[0],9999,'t');g.teams.A.field[1].turns=11;
    const copy=R.revive(R.serialize(g));
    return{cave:JSON.stringify(copy.bossRaid.cave)===JSON.stringify(g.bossRaid.cave),kind:copy.bossRaid.kind,turns:copy.teams.A.field[1].turns,slot:probe.zc.zombieCaveSlotInfo(copy,'A',0)};
  });
  assert.equal(r.cave,true);assert.equal(r.kind,'zombie');assert.equal(r.turns,11);assert.deepEqual(r.slot,{remaining:2,rounds:2});
 });
 await check('a player-side reserved action (Sweetna sequence) runs automatically in the cave instead of freezing the turn',async page=>{
  const r=await page.evaluate(async()=>{
    const g=zombieFixture('sw',['sweetna','mole','boar','mantis']);probe.battle.game=g;g.matchId='sw';
    document.querySelector('#setup').classList.remove('active');document.querySelector('#game').classList.add('active');
    const u=g.teams.P.field[0];u.energy=[{c:'R',a:1,energyId:'a'},{c:'W',a:1,energyId:'b'},{c:'B',a:1,energyId:'c'}];
    const cast=Megaleague.legalActions(g,'P',0).find(a=>a.type==='skill'&&a.skill==='sugarswamp');
    const ok=Megaleague.execute(g,'P',0,cast);
    const rows=[];
    for(let i=0;i<14&&!g.winner;i++){
      Megaleague.prepareCurrentTurn(g);const [t,s]=g.order[g.turn];
      if(t==='P'&&s===0&&u.scheduledAction){const before=g.turnSerial;probe.battle.busy=false;probe.scheduleRaidTurn();await new Promise(r=>setTimeout(r,1300));rows.push(g.turnSerial>before);continue;}
      const a=Megaleague.chooseAI(g,t,s,true);Megaleague.execute(g,t,s,a||{type:'noLegalPass'});
    }
    return{ok,rows,left:u.scheduledAction?.remaining??0};
  });
  assert.equal(r.ok,true);assert.ok(r.rows.length>=2&&r.rows.every(Boolean),'every reserved turn advances by itself');assert.equal(r.left,0);
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
  assert.deepEqual(r,{n1:'2',n2:'1',ticked:true,inSlot:true,count:1,badge:true});
 });
 await check('every playable has exactly one region theme, themed picks favour their region, and 4.5-star cards only appear as the doubled-HP last enemy',async page=>{
  const r=await page.evaluate(()=>{
   const regions=probe.zc.ZOMBIE_REGIONS,keys=Object.keys(regions);
   const base=probe.catalog.CARDS.filter(c=>!c.tags?.includes('zombie')&&!c.tags?.includes('transdimensional-invader')&&c.id!=='timeora'&&c.id!=='red_timeora');
   const unassigned=base.filter(c=>keys.filter(k=>regions[k].playables.includes(c.id)).length!==1).map(c=>c.id);
   const bad=keys.flatMap(k=>regions[k].playables).filter(id=>!base.some(c=>c.id===id));
   const g=zombieFixture('theme');const cave=g.bossRaid.cave;cave.depth=9;
   let own=0,other=0,boss45=0;
   for(let i=0;i<600;i++){cave.serial=i;cave.region='sewer';const id=probe.zc.pickZombieId(g);if(!id.startsWith('zp:'))continue;const cid=id.slice(3);if(regions.sewer.playables.includes(cid))own++;else other++;if(['huve','awakenedIruma'].includes(cid))boss45++;}
   const run=(depth)=>{const h=zombieFixture('boss'+depth);const c=h.bossRaid.cave;c.depth=depth;c.region='slaughter';c.zoneSize=4;c.spawned=3;h.teams.A.field[0].dead=true;const z=probe.zc.spawnZombie(h,0);return{card:z.card,boss:!!z.zcBoss,hp:z.maxHp,base:probe.catalog.CARDS.find(x=>x.id===z.card)?.maxHp};};
   const early=run(9),late=run(12);
   return{unassigned,bad,themed:own>other,boss45,earlyBoss:early.boss,lateBoss:late.boss,lateCard:late.card,lateDouble:late.hp>=Math.round(late.base*2*(1+0.2*11)/10)*10-10};
  });
  assert.deepEqual(r,{unassigned:[],bad:[],themed:true,boss45:0,earlyBoss:false,lateBoss:true,lateCard:'huve',lateDouble:true});
 });
}finally{await browser.close();server.close();}
console.log(`${passed} zombie cave checks passed`);

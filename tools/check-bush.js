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
const setup=`const g=Megaleague.newGame(['bush','mole','turtle','hermit'],['mole','turtle','hermit','mushroom'],{mode:'ai',variance:false,seed:'bush-test'});
 g.order=[['P',0],['A',0],['P',1],['A',1]];g.turn=0;g.turnSerial=0;g.preparedKey=null;
 const b=g.teams.P.field[0],t=g.teams.A.field[0];
 const skill=id=>probe.card(b).skills.find(s=>s.id===id);
 const run=(unit,tgt,id,team='P')=>probe.effectApply(g,unit,tgt,skill(id).effects[0],skill(id),{team,slot:0,sim:false,action:{}});`;
try{
 await check('bush trait: at 190+ HP incoming attacks are forced critical; below it they are not',async page=>{
  const r=await page.evaluate(`(()=>{${setup}
   const eff={type:'damage',amount:40};
   return {def:probe.card(b).critTakenAtHp,maxHp:b.maxHp,grade:probe.card(b).grade,speed:probe.card(b).speed,
     atFull:probe.combat.criticalChanceOf(t,b,eff,g),after:(b.hp=189,probe.combat.criticalChanceOf(t,b,eff,g)),other:probe.combat.criticalChanceOf(b,t,eff,g)};})()`);
  assert.deepEqual(r,{def:190,maxHp:190,grade:'2☆',speed:-1,atFull:1,after:0,other:0});
 });
 await check('guard costs 50 HP and gives an ally 50 shield',async page=>{
  const r=await page.evaluate(`(()=>{${setup}
   const ally=g.teams.P.field[1]||b;const before=ally.shield||0;
   for(const e of skill('guard').effects)probe.effectApply(g,b,ally,e,skill('guard'),{team:'P',slot:0,sim:false,action:{}});
   return {hp:b.hp,shield:ally.shield-before};})()`);
  assert.deepEqual(r,{hp:140,shield:50});
 });
 await check('triple throws three 30D orbs and each orb rolls its own 33% status',async page=>{
  const r=await page.evaluate(`(()=>{${setup}
   const eff=skill('triple').effects[0];const dmg=new Set();let freeze=0,para=0,def=0,orbs=0;
   for(let n=0;n<400;n++){t.hp=t.maxHp=9999;t.shield=0;t.status={};t.defenseMod=0;t.defense=0;t.baseDefense=0;
     probe.effectApply(g,b,t,eff,skill('triple'),{team:'P',slot:0,sim:false,action:{}});
     dmg.add(9999-t.hp);orbs+=3;if(probe.energy.status(t,'freeze'))freeze++;if(probe.energy.status(t,'paralyze'))para++;if(t.defenseMod)def+=Math.round(-t.defenseMod/10);}
   return {dmg:[...dmg],freeze,para,def};})()`);
  assert.equal(Math.min(...r.dmg),90);assert.ok(r.dmg.every(d=>d>=90&&d%10===0),'extra damage only comes from the orbs\' own -10 defense');
  assert.ok(r.freeze>40&&r.para>40&&r.def>40,JSON.stringify(r));
 });
 console.log(`${passed} bush checks passed`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

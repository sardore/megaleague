import http from 'node:http';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {chromium} from '@playwright/test';
import './serve.js';
const baselinePath=process.argv[2];
if(!baselinePath)throw new Error('Usage: node tools/check-feature-parity.js BASELINE_HTML_OR_CHECKOUT');
const baselineDirectory=(await fs.stat(baselinePath)).isDirectory();
const baseline=baselineDirectory?null:await fs.readFile(baselinePath);
const baselineServer=http.createServer(async(req,res)=>{
 try {
  if(!baselineDirectory){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(baseline);return;}
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';
  const file=path.resolve(baselinePath,name);
  if(!file.startsWith(path.resolve(baselinePath)+path.sep))throw new Error('Invalid baseline path');
  const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'application/octet-stream';
  res.writeHead(200,{'content-type':type});res.end(await fs.readFile(file));
 }catch{res.writeHead(404);res.end();}
}).listen(4174,'127.0.0.1');
const browser=await chromium.launch({headless:true});
const results=[];
try{
 for(const baselineRun of [true,false]){
  const legacy=baselineRun&&!baselineDirectory;
  const page=await browser.newPage();
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.goto(baselineRun?'http://127.0.0.1:4174':'http://127.0.0.1:4173');
  if(!legacy)await page.waitForFunction(()=>!!window.Megaleague);
  const result=await page.evaluate(({legacy})=>{
   const api=legacy?{CARDS,newGame,prepareCurrentTurn,unitAt,chooseAI,execute,legalActions,endTurn}:window.Megaleague;
   const cards=JSON.parse(JSON.stringify(api.CARDS));
   const snapshots=[],bossSnapshots=[],errors=[],actionCases=[],invalidActions=[];
   const hpEligible=(unit,action)=>{
    const skill=action.type==='skill'?api.card(unit).skills.find(s=>s.id===action.skill):null;
    const override=unit.plusStar&&api.card(unit).plusStar?.skills?.[skill?.id]?.ignoreUseWhenHpAtMost;
    return !Number.isFinite(Number(skill?.useWhenHpAtMost))||unit.hp<=Number(skill.useWhenHpAtMost)||override;
   };
   const units=team=>['field','bench','graveyard','summons'].map(zone=>(team[zone]||[]).map(u=>u?{
    uid:u.uid,card:u.card,hp:u.hp,maxHp:u.maxHp,shield:u.shield,dead:!!u.dead,
    energy:(u.energy||[]).map(e=>[e.c,e.a]),rider:(u.riderEnergy||[]).map(e=>[e.c,e.a]),beast:(u.beastEnergy||[]).map(e=>[e.c,e.a]),
    statuses:u.statuses,usedOnce:u.usedOnce,defense:u.defense,hour:u.timeHourDeg,minute:u.timeMinuteDeg,
    scheduled:u.scheduledAction?{kind:u.scheduledAction.kind,remaining:u.scheduledAction.remaining}:null,
   }:null));
   for(let index=0;index<api.CARDS.length;index++){
    const p=Array.from({length:4},(_,j)=>api.CARDS[(index+j)%api.CARDS.length].id),a=Array.from({length:4},(_,j)=>api.CARDS[(index+j+7)%api.CARDS.length].id);
    for(const variant of ['empty','mixed','red','white','blue','traitSeal','freeze','skillSeal','plus']){
     const fixture=api.newGame(p,a,{seed:`actions-${index}-${variant}`,mode:'ai',difficulty:'normal'});
     fixture.order=[['P',0],['A',0],['P',1],['A',1]];fixture.turn=0;fixture.preparedKey=null;
     api.prepareCurrentTurn(fixture);
     const unit=api.unitAt(fixture,'P',0);unit.speedDelayTurns=0;
     unit.energy=variant==='empty'?[]:(['red','white','blue'].includes(variant)?[{c:{red:'R',white:'W',blue:'B'}[variant],a:4}]:[{c:'R',a:1},{c:'W',a:2},{c:'B',a:1}]);
     if(['traitSeal','freeze','skillSeal'].includes(variant))unit.statuses[variant]=2;
     if(variant==='plus'){unit.plusStar=true;unit.firstGuardUsesRemaining=2;}
     const actions=api.legalActions(fixture,'P',0);
     const eligible=actions.filter(action=>{
      if(!hpEligible(unit,action)){invalidActions.push({card:p[0],variant,skill:action.skill});return false;}
      return true;
     });
     const normalized=eligible.map(action=>{
      const value=JSON.parse(JSON.stringify(action,(key,value)=>['actionId','transactionId','scheduledActionId','effectiveActionSpec'].includes(key)?undefined:value));
      if(value.actor===null)delete value.actor;
      const skill=api.card(unit).skills.find(s=>s.id===value.skill);
      if(value.displayCost===(value.costOverride??skill?.cost))delete value.displayCost;
      return value;
     });
     actionCases.push({card:p[0],variant,actions:normalized});
    }
    const g=api.newGame(p,a,{seed:`parity-${index}`,mode:'ai',difficulty:'normal'});
    for(let turn=0;turn<24&&!g.winner;turn++){
     try{
      api.prepareCurrentTurn(g);const [t,s]=g.order[g.turn];const actor=api.unitAt(g,t,s);
      // Exercise the same valid commands in both engines. The removed fallback
      // advertised HP-gated skills illegally, which could change AI selection.
      const choices=api.legalActions(g,t,s).filter(action=>hpEligible(actor,action));
      const action=choices[(index*31+turn*7)%choices.length];
      if(action)api.execute(g,t,s,action,{sim:true});else api.endTurn(g,t,s,false);
      snapshots.push(JSON.parse(JSON.stringify({index,turn,serial:g.turnSerial,actor:g.order[g.turn],winner:g.winner||null,rng:g.rng.s,P:units(g.teams.P),A:units(g.teams.A)})));
     }catch(error){errors.push({index,turn,message:error.message});break;}
    }
   }
   if(!legacy)for(const online of [false,true]){
    const raid=window.__redTimeoraBossRaid;
    const g=raid.createGame(online?['wayli','hermit']:['wayli','hermit','kingprawn','yggdrasil'],online?['kingprawn','yggdrasil']:null,online);
    g.rng.s=12345;g.order=[['P',0],['A',0],['P',1],['A',1]];g.turn=0;g.preparedKey=null;
    for(let turn=0;turn<32&&!g.winner;turn++){
     api.prepareCurrentTurn(g);const[t,s]=g.order[g.turn];const actor=api.unitAt(g,t,s);
     const choices=api.legalActions(g,t,s).filter(action=>hpEligible(actor,action));
     const action=choices[(turn*7)%choices.length];
     if(action)api.execute(g,t,s,action,{sim:true});else api.endTurn(g,t,s,false);
     bossSnapshots.push(JSON.parse(JSON.stringify({online,turn,serial:g.turnSerial,clock:g.bossRaid.sharedClock,kills:g.bossRaid.kills,winner:g.winner||null,rng:g.rng.s,P:units(g.teams.P),A:units(g.teams.A)})));
    }
   }
   return {cards,snapshots,bossSnapshots,errors,actionCases,invalidActions};
  },{legacy});
  assert.deepEqual(pageErrors,[],'application startup and simulation must not throw');
  results.push(result);await page.close();
 }
 await fs.mkdir('artifacts/results',{recursive:true});
 await Promise.all(results.map((result,index)=>fs.writeFile(`artifacts/results/parity-${index?'candidate':'baseline'}.json`,JSON.stringify(result))));
 const same=(actual,expected,message)=>{
  const index=actual.findIndex((row,i)=>!isDeepStrictEqual(row,expected[i]));
  if(index>=0)assert.deepEqual(actual[index],expected[index],`${message}; first mismatch at ${index}`);
  assert.equal(actual.length,expected.length,message);
 };
 assert.deepEqual(results[1].cards,results[0].cards,'all character definitions must survive');
 assert.deepEqual(results[1].errors,results[0].errors,'simulation failure surface must not regress');
 assert.deepEqual(results[1].invalidActions,[],'HP-gated skills must not bypass their declared requirement');
 same(results[1].actionCases,results[0].actionCases,'all valid action alternatives, ordering, costs and targets must survive');
 same(results[1].snapshots,results[0].snapshots,'seeded battle rules must match');
 if(baselineDirectory)same(results[1].bossSnapshots,results[0].bossSnapshots,'solo and cooperative raid rules must match');
 const report={cards:results[1].cards.length,actionCases:results[1].actionCases.length,comparedTurns:results[1].snapshots.length,comparedRaidTurns:baselineDirectory?results[1].bossSnapshots.length:0,baselineErrors:results[0].errors,baselineInvalidActions:results[0].invalidActions.length};
 await fs.mkdir('artifacts/results',{recursive:true});await fs.writeFile('artifacts/results/feature-parity.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();baselineServer.close();process.exitCode??=0;}
process.exit(process.exitCode);

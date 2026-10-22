import http from 'node:http';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import './serve.js';
const baselinePath=process.argv[2];
if(!baselinePath)throw new Error('Usage: node tools/check-feature-parity.js BASELINE_HTML');
const baseline=await fs.readFile(baselinePath);
const baselineServer=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(baseline);}).listen(4174,'127.0.0.1');
const browser=await chromium.launch({headless:true});
const results=[];
try{
 for(const legacy of [true,false]){
  const page=await browser.newPage();await page.goto(legacy?'http://127.0.0.1:4174':'http://127.0.0.1:4173');
  const result=await page.evaluate(({legacy})=>{
   const api=legacy?{CARDS,newGame,prepareCurrentTurn,unitAt,chooseAI,execute,legalActions,endTurn}:window.Megaleague;
   const cards=JSON.parse(JSON.stringify(api.CARDS));
   const snapshots=[],errors=[];
   const units=team=>['field','bench','graveyard','summons'].map(zone=>(team[zone]||[]).map(u=>u?{
    uid:u.uid,card:u.card,hp:u.hp,maxHp:u.maxHp,shield:u.shield,dead:!!u.dead,
    energy:(u.energy||[]).map(e=>[e.c,e.a]),rider:(u.riderEnergy||[]).map(e=>[e.c,e.a]),beast:(u.beastEnergy||[]).map(e=>[e.c,e.a]),
    statuses:u.statuses,usedOnce:u.usedOnce,defense:u.defense,hour:u.timeHourDeg,minute:u.timeMinuteDeg,
    scheduled:u.scheduledAction?{kind:u.scheduledAction.kind,remaining:u.scheduledAction.remaining}:null,
   }:null));
   for(let index=0;index<api.CARDS.length;index++){
    const p=Array.from({length:4},(_,j)=>api.CARDS[(index+j)%api.CARDS.length].id),a=Array.from({length:4},(_,j)=>api.CARDS[(index+j+7)%api.CARDS.length].id);
    const g=api.newGame(p,a,{seed:`parity-${index}`,mode:'ai',difficulty:'normal'});
    for(let turn=0;turn<24&&!g.winner;turn++){
     try{
      api.prepareCurrentTurn(g);const [t,s]=g.order[g.turn];const actor=api.unitAt(g,t,s);
      const action=api.chooseAI(g,t,s,true);
      if(action)api.execute(g,t,s,action,{sim:true});else api.endTurn(g,t,s,false);
      snapshots.push({index,turn,serial:g.turnSerial,actor:g.order[g.turn],winner:g.winner||null,rng:g.rng.s,P:units(g.teams.P),A:units(g.teams.A)});
     }catch(error){errors.push({index,turn,message:error.message});break;}
    }
   }
   return {cards,snapshots,errors};
  },{legacy});
  results.push(result);await page.close();
 }
 assert.deepEqual(results[1].cards,results[0].cards,'all character definitions must survive');
 assert.deepEqual(results[1].errors,results[0].errors,'simulation failure surface must not regress');
 assert.deepEqual(results[1].snapshots,results[0].snapshots,'seeded battle rules must match');
 const report={cards:results[1].cards.length,comparedTurns:results[1].snapshots.length,baselineErrors:results[0].errors};
 await fs.mkdir('artifacts/results',{recursive:true});await fs.writeFile('artifacts/results/feature-parity.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();baselineServer.close();process.exitCode??=0;}
process.exit(process.exitCode);

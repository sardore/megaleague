import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import http from 'node:http';
import assert from 'node:assert/strict';
/* 한 점에 놓이는 연출(--fx-x/--fx-y)이 커지고 도는 동안 그 점에서 벗어나지 않는지, 빔이 원점으로 튀지 않는지 검사한다. */
const bundle=await build({entryPoints:['tests/helpers/weller-probe.js'],bundle:true,write:false,outdir:'probe',loader:{'.css':'empty'},format:'iife'});
const html=(await fs.readFile('index.html','utf8')).replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/,'<script src="/probe.js"></script>');
const server=http.createServer(async(req,res)=>{
  if(req.url==='/probe.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(req.url==='/'){res.end(html);return;}
  try{res.end(await fs.readFile('.'+req.url.split('?')[0]));}catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch();
const CASES=[['tube','wave'],['tube','tornadoSplash'],['mole','shot'],['turtle','brace'],['bkeno','eruption'],['jetski','jetskiBoost']];
const ANCHORED=['marine-fx-core','marine-fx-ring','skill-fx-cast','skill-fx-impact','skill-fx-ring','eruption-cast','eruption-shockwave'];
try{
  const page=await browser.newPage({viewport:{width:900,height:700}});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.wellerFixture);await page.waitForTimeout(9500);
  for(const [card,sk] of CASES){
    const dev=await page.evaluate(async([card,sk])=>{
      const s=probe.card(card).skills.find(x=>x.id===sk);
      const g=Megaleague.newGame([card,'mole','turtle','hermit'],['mole','turtle','hermit','mushroom'],{mode:'ai',variance:false,seed:'v'});
      probe.battle.game=g;g.order=[['P',0],['A',0],['P',1],['A',1]];g.turn=0;
      document.querySelector('#setup')?.classList.remove('active');document.querySelector('#game').classList.add('active');probe.render();
      document.querySelectorAll('.arena > [class*="-fx-"],.arena > [class*="eruption-"]').forEach(n=>n.remove());
      probe.combat.queueSkillVisual(g,g.teams.P.field[0],g.teams.A.field[0],s,s.effects);probe.playVisuals();
      const arena=document.querySelector('.arena'),out={},t0=performance.now();
      await new Promise(done=>{const tick=()=>{const ar=arena.getBoundingClientRect();
        arena.querySelectorAll(':scope > *').forEach(n=>{const fx=parseFloat(n.style.getPropertyValue('--fx-x')),fy=parseFloat(n.style.getPropertyValue('--fx-y')),r=n.getBoundingClientRect(),cls=n.className.split(' ')[0];
          if(Number.isFinite(fx))out[cls]=Math.max(out[cls]||0,Math.round(Math.hypot(r.left+r.width/2-ar.left-fx,r.top+r.height/2-ar.top-fy)));
          if(cls==='marine-fx-beam')out[cls]=Math.max(out[cls]||0,Math.hypot(r.left-ar.left,r.top-ar.top)<30?999:0);});
        performance.now()-t0<1500?requestAnimationFrame(tick):done();};tick();});
      return out;},[card,sk]);
    for(const cls of ANCHORED)if(cls in dev)assert.ok(dev[cls]<=6,`${card}/${sk} ${cls} drifted ${dev[cls]}px from its anchor`);
    if('marine-fx-beam' in dev)assert.equal(dev['marine-fx-beam'],0,`${card}/${sk} beam jumped to the arena origin`);
  }
  console.log('fx anchor checks passed');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

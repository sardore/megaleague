import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const jsonl=(file,row)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.appendFileSync(file,JSON.stringify(row)+'\n')};
export async function attachEvidence(client,dir,label){
  fs.mkdirSync(dir,{recursive:true});const page=client.page,context=client.context;
  const record=(type,data={})=>jsonl(path.join(dir,'browser-events.jsonl'),{at:new Date().toISOString(),label,type,...data});
  page.on('console',m=>record('console',{level:m.type(),text:m.text()}));
  page.on('pageerror',e=>record('pageerror',{error:String(e)}));
  page.on('requestfailed',r=>record('requestfailed',{url:r.url(),failure:r.failure()}));
  page.on('websocket',ws=>{record('websocket-open',{url:ws.url()});ws.on('framesent',e=>record('websocket-frame-sent',{size:String(e.payload||'').length}));ws.on('framereceived',e=>record('websocket-frame-received',{size:String(e.payload||'').length}));ws.on('close',()=>record('websocket-close',{url:ws.url()}));ws.on('socketerror',e=>record('websocket-error',{error:String(e)}));});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  const cdp=await context.newCDPSession(page);const frames=path.join(dir,'screencast-frames');fs.mkdirSync(frames,{recursive:true});let index=0;
  cdp.on('Page.screencastFrame',async evt=>{try{fs.writeFileSync(path.join(frames,String(index++).padStart(6,'0')+'.jpg'),Buffer.from(evt.data,'base64'));await cdp.send('Page.screencastFrameAck',{sessionId:evt.sessionId})}catch{}});
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:70,maxWidth:412,maxHeight:915,everyNthFrame:1});
  return async()=>{try{await page.screenshot({path:path.join(dir,'final.png'),fullPage:true})}catch{};try{await cdp.send('Page.stopScreencast')}catch{};try{await context.tracing.stop({path:path.join(dir,'trace.zip')})}catch{};
    if(index>0){spawnSync('ffmpeg',['-y','-framerate','10','-i',path.join(frames,'%06d.jpg'),'-c:v','libx264','-pix_fmt','yuv420p',path.join(dir,'video.mp4')],{stdio:'ignore'});}record('evidence-stop',{frameCount:index,pid:client.pid,userDataDir:client.userDataDir});};
}
export function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2));}

import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

const sourcePath=fileURLToPath(new URL('./android-background-player-path.js',import.meta.url));
const generatedPath=path.join(path.dirname(sourcePath),'.android-background-player-path.generated.mjs');
const source=fs.readFileSync(sourcePath,'utf8');
const start=source.indexOf('async function selectedDeck(client)');
const end=source.indexOf('async function state(client,{full=false}={}){');
if(start<0||end<0||end<=start)throw new Error(`ANDROID_RUNTIME_DECK_PATCH_ANCHOR_MISSING:${JSON.stringify({start,end})}`);

async function patchedSelectedDeck(client){
  return evaluate(client,"[...document.querySelectorAll('#onlineRoomDeck .online-room-card.selected')].map(card=>card.dataset.cardId||null).filter(Boolean)");
}

async function patchedLiveDeckCandidates(client){
  return evaluate(client,`(()=>[...document.querySelectorAll('#onlineRoomDeck .online-room-card')].map((card,index)=>{const r=card.getBoundingClientRect(),s=getComputedStyle(card);return{id:card.dataset.cardId||null,index,selected:card.classList.contains('selected'),visible:!!(r.width&&r.height&&s.display!=='none'&&s.visibility!=='hidden'),text:(card.textContent||'').replace(/\\s+/g,' ').trim()};}).filter(row=>row.id))()`);
}

async function patchedSelectDeck(client){
  const initial=await liveDeckCandidates(client);
  if(initial.length<4)throw new Error(`${client.name}_LIVE_DECK_CANDIDATES_LT4:${JSON.stringify(initial)}`);
  record(`deck-candidates-${client.name}.json`,{requested:[...BATTLE_DECK],candidates:initial});
  while((await selectedDeck(client)).length<4){
    const before=await selectedDeck(client);
    const candidate=await evaluate(client,`(()=>{const cards=[...document.querySelectorAll('#onlineRoomDeck .online-room-card:not(.selected)')];for(let index=0;index<cards.length;index++){const card=cards[index],r=card.getBoundingClientRect(),s=getComputedStyle(card);if(!card.dataset.cardId||!r.width||!r.height||s.display==='none'||s.visibility==='hidden')continue;return{id:card.dataset.cardId,index,text:(card.textContent||'').replace(/\\s+/g,' ').trim()};}return null;})()`);
    if(!candidate?.id)throw new Error(`${client.name}_LIVE_DECK_UNSELECTED_CARD_MISSING:${JSON.stringify(await liveDeckCandidates(client))}`);
    await tap(client,'#onlineRoomDeck .online-room-card:not(.selected)',candidate.index);
    await waitUntil(async()=>{const next=await selectedDeck(client);return next.length===before.length+1&&next.includes(candidate.id)?next:false;},{timeout:15000,label:`${client.name}_DECK_LIVE_${candidate.id}`});
  }
  const final=await selectedDeck(client);
  if(final.length!==4)throw new Error(`${client.name}_DECK_COUNT_MISMATCH:${JSON.stringify(final)}`);
  timeline('live-deck-selected',{client:client.name,selected:final});
  record(`deck-selected-${client.name}.json`,{selected:final,candidates:await liveDeckCandidates(client)});
  return final;
}

const replacement=[
  patchedSelectedDeck.toString().replace('patchedSelectedDeck','selectedDeck'),
  patchedLiveDeckCandidates.toString().replace('patchedLiveDeckCandidates','liveDeckCandidates'),
  patchedSelectDeck.toString().replace('patchedSelectDeck','selectDeck'),
].join('\n\n')+'\n\n';

const transformed=source.slice(0,start)+replacement+source.slice(end);
fs.writeFileSync(generatedPath,transformed);
process.once('exit',()=>{try{fs.unlinkSync(generatedPath);}catch{}});
await import(`${pathToFileURL(generatedPath).href}?runtimeDeck=${Date.now()}`);

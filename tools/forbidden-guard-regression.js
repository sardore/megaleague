import fs from 'node:fs';
import {scanJavaScriptText} from './forbidden-operation-scanner.js';

const benign=[
  {name:'forbidden-token-declaration',code:`const forbidden = ['page.setContent(', 'file://'];`},
  {name:'node-self-entry-file-url',code:'if (import.meta.url === `file://${process.argv[1]}`) { console.log("direct"); }'},
  {name:'documentation-string',code:`const note = 'fake relay is forbidden';`},
];
const dangerous=[
  {name:'page-set-content',code:`await page.setContent(html)`,expect:'PAGE_SET_CONTENT'},
  {name:'file-navigation',code:`await page.goto('file:///tmp/game.html')`,expect:'FILE_URL_NAVIGATION'},
  {name:'window-start-battle',code:`window.startBattle()`,expect:'WINDOW_START_BATTLE'},
  {name:'render-battle',code:`renderBattle()`,expect:'RENDER_BATTLE'},
  {name:'document-hidden-define',code:`Object.defineProperty(document, 'hidden', {value:true})`,expect:'DOCUMENT_HIDDEN_DEFINE_PROPERTY'},
  {name:'mock-relay-created',code:`const mockRelay = createRelay(); mockRelay.start();`,expect:'FAKE_MOCK_RELAY_IDENTIFIER'},
];
const results=[];
for(const x of benign){ const hits=scanJavaScriptText(x.code,{file:`fixture:${x.name}`}); results.push({name:x.name,kind:'benign',expected:'PASS',actual:hits.length?'FAIL':'PASS',hits}); }
for(const x of dangerous){ const hits=scanJavaScriptText(x.code,{file:`fixture:${x.name}`}); results.push({name:x.name,kind:'dangerous',expected:'FAIL',actual:hits.some(h=>h.rule===x.expect)?'FAIL':'PASS',expectedRule:x.expect,hits}); }
const benignOk=results.filter(x=>x.kind==='benign').every(x=>x.actual==='PASS');
const dangerousOk=results.filter(x=>x.kind==='dangerous').every(x=>x.actual==='FAIL');
const out={status:benignOk&&dangerousOk?'PASS':'FAIL',benignPass:results.filter(x=>x.kind==='benign'&&x.actual==='PASS').length,benignTotal:benign.length,dangerousDetected:results.filter(x=>x.kind==='dangerous'&&x.actual==='FAIL').length,dangerousTotal:dangerous.length,results};
fs.mkdirSync('artifacts/results',{recursive:true});fs.writeFileSync('artifacts/results/FORBIDDEN_GUARD_REGRESSION.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2)); if(out.status!=='PASS') process.exit(2);

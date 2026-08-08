import fs from 'node:fs';
import path from 'node:path';

const SELF_EXCLUDES = new Set([
  'tools/forbidden-operation-scanner.js',
  'tools/forbidden-guard-regression.js',
]);

function maskNonCode(source) {
  const chars = [...source];
  let i = 0;
  const n = chars.length;
  const blank = (a,b)=>{ for(let j=a;j<b;j++) if(chars[j] !== '\n') chars[j] = ' '; };
  while (i < n) {
    const c = source[i], d = source[i+1];
    if (c === '/' && d === '/') {
      const s=i; i+=2; while(i<n && source[i] !== '\n') i++; blank(s,i); continue;
    }
    if (c === '/' && d === '*') {
      const s=i; i+=2; while(i<n && !(source[i] === '*' && source[i+1] === '/')) i++; i=Math.min(n,i+2); blank(s,i); continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote=c, s=i; i++;
      while(i<n){
        if(source[i] === '\\'){ i+=2; continue; }
        if(source[i] === quote){ i++; break; }
        i++;
      }
      blank(s,i); continue;
    }
    i++;
  }
  return chars.join('');
}

function stringLiterals(source) {
  const out=[]; let i=0;
  while(i<source.length){
    const q=source[i];
    if(q !== '"' && q !== "'" && q !== '`'){ i++; continue; }
    const start=i; i++; let value='';
    while(i<source.length){
      if(source[i] === '\\'){ value += source.slice(i,i+2); i+=2; continue; }
      if(source[i] === q){ i++; break; }
      value += source[i++];
    }
    out.push({start,end:i,quote:q,value});
  }
  return out;
}

function lineOf(source, index) { return source.slice(0,index).split('\n').length; }
function push(hits,file,source,rule,index,detail){ hits.push({file,rule,line:lineOf(source,index),detail}); }

export function scanJavaScriptText(source,{file='<memory>'}={}) {
  const hits=[];
  const code=maskNonCode(source);
  const executableRules=[
    ['PAGE_SET_CONTENT', /\bpage\s*\.\s*setContent\s*\(/g, 'page.setContent call'],
    ['WINDOW_START_BATTLE', /\bwindow\s*\.\s*startBattle\s*\(/g, 'window.startBattle call'],
    ['RENDER_BATTLE', /\brenderBattle\s*\(/g, 'renderBattle call'],
    ['DOCUMENT_HIDDEN_ASSIGN', /\bdocument\s*\.\s*hidden\s*=/g, 'document.hidden assignment'],
    ['STYLE_DISPLAY_ASSIGN', /\.\s*style\s*\.\s*display\s*=/g, 'style.display assignment'],
    ['DOCUMENT_HIDDEN_DEFINE_PROPERTY', /\bObject\s*\.\s*defineProperty\s*\(\s*document\s*,/g, 'Object.defineProperty(document, ...)'],
    ['FAKE_MOCK_RELAY_IDENTIFIER', /\b(?:fake|mock)[A-Za-z0-9_$]*relay[A-Za-z0-9_$]*\b|\brelay[A-Za-z0-9_$]*(?:fake|mock)[A-Za-z0-9_$]*\b/gi, 'fake/mock relay executable identifier'],
  ];
  for(const [rule,re,detail] of executableRules){ let m; while((m=re.exec(code))) push(hits,file,source,rule,m.index,detail); }

  // file:// is forbidden only when used as a browser navigation target, not in Node self-entry detection.
  const goto=/\b(?:page|browserPage|hostPage|guestPage|androidPage)\s*\.\s*goto\s*\(\s*/g;
  let gm;
  const literals=stringLiterals(source);
  while((gm=goto.exec(code))){
    const lit=literals.find(x=>x.start>=gm.index && x.start<=gm.index+220);
    if(lit && /^file:\/\//i.test(lit.value)) push(hits,file,source,'FILE_URL_NAVIGATION',gm.index,`browser navigation to ${lit.value.slice(0,80)}`);
  }

  // A direct WebSocket to localhost is treated as fake networking in validation code.
  const ws=/\bnew\s+WebSocket\s*\(\s*/g; let wm;
  while((wm=ws.exec(code))){
    const lit=literals.find(x=>x.start>=wm.index && x.start<=wm.index+220);
    if(lit && /^wss?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(lit.value)) push(hits,file,source,'LOCAL_FAKE_WEBSOCKET',wm.index,`local WebSocket ${lit.value}`);
  }
  return hits;
}

export function collectValidationJavaScript(root='.') {
  const roots=['tests','tools','playwright.config.js']; const files=[];
  for(const r of roots){
    const abs=path.join(root,r);
    if(!fs.existsSync(abs)) continue;
    if(fs.statSync(abs).isFile()) files.push(r);
    else {
      const walk=(dir)=>{ for(const ent of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
        const rel=path.join(dir,ent.name);
        if(ent.isDirectory()) walk(rel); else if(rel.endsWith('.js')) files.push(rel.replaceAll('\\','/'));
      }}; walk(r);
    }
  }
  return files.sort();
}

export function scanValidationTree(root='.') {
  const hits=[]; const scanned=[];
  for(const file of collectValidationJavaScript(root)){
    if(SELF_EXCLUDES.has(file)) continue;
    const source=fs.readFileSync(path.join(root,file),'utf8');
    const fileHits=scanJavaScriptText(source,{file});
    scanned.push({file,hitCount:fileHits.length}); hits.push(...fileHits);
  }
  return {ok:hits.length===0,hits,scanned,excluded:[...SELF_EXCLUDES]};
}

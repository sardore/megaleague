import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parse} from '@babel/parser';
import traverseImport from '@babel/traverse';
import globals from 'globals';
const traverse=traverseImport.default||traverseImport;
const browser=new Set([...Object.keys(globals.browser),...Object.keys(globals.es2024)]);
const files=fs.readdirSync('src',{recursive:true}).filter(f=>f.endsWith('.js')).map(f=>path.join('src',f));
const failures=[];
for(const file of files){
  const source=fs.readFileSync(file,'utf8');
  const ast=parse(source,{sourceType:'module'});
  const fail=(p,message)=>failures.push(`${file}:${p.node.loc.start.line}: ${message}`);
  traverse(ast,{
    ReferencedIdentifier(p){
      const name=p.node.name;
      if(name==='arguments'&&p.findParent(q=>q.isFunction()&&!q.isArrowFunctionExpression()))return;
      if(!p.scope.getBinding(name)&&!browser.has(name))fail(p,`undeclared dependency ${name}`);
    },
    ImportDeclaration(p){
      const target=p.node.source.value;
      if(target.startsWith('.'))assert.ok(fs.existsSync(path.resolve(path.dirname(file),target)),`Missing import ${file}: ${target}`);
    },
    AssignmentExpression(p){
      const left=p.node.left;
      if(left.type==='Identifier'&&!p.scope.getBinding(left.name))fail(p,`implicit global write ${left.name}`);
      if(left.type==='MemberExpression'&&left.object.type==='Identifier'&&['window','globalThis'].includes(left.object.name))fail(p,'application state cannot be written onto the browser global');
      if(left.type==='MemberExpression'&&left.object.type==='MemberExpression'&&left.object.property?.name==='prototype')fail(p,'prototype patch');
    },
    CallExpression(p){
      const callee=p.node.callee;
      if(callee.type==='MemberExpression'&&['apply','call'].includes(callee.property?.name)&&p.node.arguments[0]?.type==='ThisExpression')fail(p,'receiver-forwarding runtime wrapper');
    },
  });
  assert.ok(!/invokeBossModeHook|actionTransactionExecuteStage|withExecuteContext|onlinePendingCommand|p2p\.pendingActionId/.test(source),`Retired execution path in ${file}`);
  assert.ok(!/policySlots|sealPolicies|bossRulesReady|systems\.TimerManager|state_runtime_config\.TimerManager|__timeClockOverlayImpl/.test(source),`Retired mutable interceptor or service alias in ${file}`);
}
assert.ok(!fs.existsSync('src/engine/policies.js'),'numbered policy registry must stay removed');
const html=fs.readFileSync('index.html','utf8');
assert.equal((html.match(/<script\b/g)||[]).length,1,'one module entry point');
assert.match(html,/<script type="module" src="\.\/assets\/app\.js/);
assert.ok(!html.includes(';base64,'),'binary assets must not be embedded in the page');
assert.ok(Buffer.byteLength(html)<15000,'entry page budget');
assert.ok(fs.statSync('assets/app.js').size<1_000_000,'JavaScript budget');
assert.deepEqual(failures,[]);
console.log(`Source validation passed: ${files.length} modules, explicit imports, one entry point, no global writes or retired execution wrappers.`);

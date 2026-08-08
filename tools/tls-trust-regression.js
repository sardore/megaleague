import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {requestLocalCandidateJson} from '../tests/helpers/local-candidate-tls.js';
import {CANDIDATE_ORIGIN,EXPECTED_SHA256,EXPECTED_SIZE} from '../tests/helpers/constants.js';

const output=process.env.CP32_TLS_REGRESSION_OUTPUT || 'artifacts/preflight/tls-trust-regression.json';
const record={startedAt:new Date().toISOString(),checks:[]};
const push=(name,ok,detail={})=>record.checks.push({name,ok,...detail});

try {
  const health=await requestLocalCandidateJson(`${CANDIDATE_ORIGIN}/healthz`);
  const exact=health?.sha===EXPECTED_SHA256 && health?.size===EXPECTED_SIZE;
  push('LOCAL_CANDIDATE_SELF_SIGNED_OR_PRIVATE_CA_ACCEPTED',exact,{health});
  if(!exact) throw new Error('LOCAL_CANDIDATE_IDENTITY_MISMATCH');

  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cp32-unrelated-tls-'));
  const key=path.join(tmp,'key.pem'), cert=path.join(tmp,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=unrelated.invalid','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
  const unrelated=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');});
  await new Promise((resolve,reject)=>{unrelated.once('error',reject);unrelated.listen(0,'127.0.0.1',resolve);});
  const port=unrelated.address().port;
  let rejected=false, rejection='';
  try { await requestLocalCandidateJson(`https://127.0.0.1:${port}/healthz`); }
  catch(error) { rejected=true; rejection=String(error); }
  await new Promise(resolve=>unrelated.close(resolve));
  fs.rmSync(tmp,{recursive:true,force:true});
  push('UNRELATED_SELF_SIGNED_HTTPS_REJECTED',rejected,{rejection});
  if(!rejected) throw new Error('UNRELATED_SELF_SIGNED_CERT_ACCEPTED');

  const nodeGlobalDisabled=process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0';
  push('GLOBAL_TLS_VERIFY_DISABLED',!nodeGlobalDisabled,{value:process.env.NODE_TLS_REJECT_UNAUTHORIZED??null});
  if(nodeGlobalDisabled) throw new Error('GLOBAL_TLS_VERIFY_DISABLED');
  record.ok=true;
} catch(error) {
  record.ok=false;record.error=String(error);process.exitCode=2;
} finally {
  record.completedAt=new Date().toISOString();
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(record,null,2)+'\n');
  console.log(JSON.stringify(record,null,2));
}

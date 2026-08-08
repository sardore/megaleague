import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EXPECTED_SHA256, EXPECTED_SIZE, TRUSTED_FILE } from './constants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const htmlPath = path.resolve(root, TRUSTED_FILE);
const cert = process.env.CP32_TLS_CERT || path.resolve(root, 'artifacts/preflight/cert.pem');
const key = process.env.CP32_TLS_KEY || path.resolve(root, 'artifacts/preflight/key.pem');
const port = Number(process.env.CP32_CANDIDATE_PORT || 8443);
const bytes = fs.readFileSync(htmlPath);
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
if (sha !== EXPECTED_SHA256 || bytes.length !== EXPECTED_SIZE) throw new Error(`CANDIDATE_SOURCE_IDENTITY_MISMATCH:${sha}:${bytes.length}`);
const server = https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, (req, res) => {
  if (req.url === '/healthz') { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify({ok:true,sha,size:bytes.length})); }
  if ((req.url || '/').split('?')[0] !== '/') { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, {'content-type':'text/html; charset=utf-8','content-length':String(bytes.length),'cache-control':'no-store','x-cp32-sha256':sha});
  res.end(bytes);
});
server.listen(port, '0.0.0.0', () => {
  const record={pid:process.pid,port,sha256:sha,size:bytes.length,startedAt:new Date().toISOString()};
  fs.mkdirSync(path.resolve(root,'artifacts/preflight'),{recursive:true});
  fs.writeFileSync(path.resolve(root,'artifacts/preflight/candidate-server-ready.json'),JSON.stringify(record,null,2));
  console.log(JSON.stringify(record));
});
for (const sig of ['SIGTERM','SIGINT']) process.on(sig,()=>server.close(()=>process.exit(0)));

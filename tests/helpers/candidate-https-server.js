import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EXPECTED_SHA256, EXPECTED_SIZE, TRUSTED_FILE } from './constants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rootPrefix = `${root}${path.sep}`;
const requestedFile = String(process.env.CP32_CANDIDATE_FILE || TRUSTED_FILE).trim() || TRUSTED_FILE;
const htmlPath = path.resolve(root, requestedFile);
if (htmlPath !== root && !htmlPath.startsWith(rootPrefix)) throw new Error(`CANDIDATE_FILE_OUTSIDE_ROOT:${requestedFile}`);
const cert = process.env.CP32_TLS_CERT || path.resolve(root, 'artifacts/preflight/cert.pem');
const key = process.env.CP32_TLS_KEY || path.resolve(root, 'artifacts/preflight/key.pem');
const port = Number(process.env.CP32_CANDIDATE_PORT || 8443);
const bytes = fs.readFileSync(htmlPath);
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
const explicitSha = String(process.env.CP32_CANDIDATE_EXPECTED_SHA || '').trim();
const explicitSizeRaw = String(process.env.CP32_CANDIDATE_EXPECTED_SIZE || '').trim();
const explicitSize = explicitSizeRaw ? Number(explicitSizeRaw) : null;
if (explicitSha && sha !== explicitSha) throw new Error(`CANDIDATE_SOURCE_SHA_MISMATCH:${sha}:${explicitSha}`);
if (explicitSize !== null && (!Number.isSafeInteger(explicitSize) || explicitSize < 0 || bytes.length !== explicitSize)) throw new Error(`CANDIDATE_SOURCE_SIZE_MISMATCH:${bytes.length}:${explicitSizeRaw}`);
if (!process.env.CP32_CANDIDATE_FILE && (sha !== EXPECTED_SHA256 || bytes.length !== EXPECTED_SIZE)) throw new Error(`CANDIDATE_SOURCE_IDENTITY_MISMATCH:${sha}:${bytes.length}`);
const file = path.relative(root, htmlPath).split(path.sep).join('/');
const source = Object.freeze({file, sha, size:bytes.length});
const server = https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, (req, res) => {
  if (req.url === '/healthz') { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify({ok:true,...source})); }
  if ((req.url || '/').split('?')[0] !== '/') { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, {'content-type':'text/html; charset=utf-8','content-length':String(bytes.length),'cache-control':'no-store','x-cp32-sha256':sha,'x-cp32-source-file':file});
  res.end(bytes);
});
server.listen(port, '0.0.0.0', () => {
  const record={pid:process.pid,port,...source,startedAt:new Date().toISOString()};
  fs.mkdirSync(path.resolve(root,'artifacts/preflight'),{recursive:true});
  fs.writeFileSync(path.resolve(root,'artifacts/preflight/candidate-server-ready.json'),JSON.stringify(record,null,2));
  console.log(JSON.stringify(record));
});
for (const sig of ['SIGTERM','SIGINT']) process.on(sig,()=>server.close(()=>process.exit(0)));

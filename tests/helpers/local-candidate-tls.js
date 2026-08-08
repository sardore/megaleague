import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const LOCAL_CANDIDATE_HOSTS = new Set(['127.0.0.1','localhost','10.0.2.2']);

export function requireLocalTrustCertPath() {
  const raw = process.env.CP32_LOCAL_TRUST_CERT || 'artifacts/preflight/cert.pem';
  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved)) throw new Error(`LOCAL_CANDIDATE_TRUST_CERT_MISSING:${resolved}`);
  return resolved;
}

export function requireLocalCandidateSpki() {
  const value = String(process.env.CP32_LOCAL_CERT_SPKI || '').trim();
  if (!value) throw new Error('LOCAL_CANDIDATE_SPKI_MISSING');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('LOCAL_CANDIDATE_SPKI_INVALID');
  return value;
}

export function localCandidateChromiumArgs() {
  return [`--ignore-certificate-errors-spki-list=${requireLocalCandidateSpki()}`];
}

export async function requestLocalCandidateJson(url, { timeout = 15000 } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !LOCAL_CANDIDATE_HOSTS.has(target.hostname)) {
    throw new Error(`LOCAL_CANDIDATE_TLS_SCOPE_VIOLATION:${target.origin}`);
  }
  const ca = fs.readFileSync(requireLocalTrustCertPath());
  return await new Promise((resolve, reject) => {
    const req = https.get(target, { ca, rejectUnauthorized: true, timeout }, (res) => {
      const chunks=[];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body=Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
          return reject(new Error(`LOCAL_CANDIDATE_HTTPS_STATUS:${res.statusCode}:${body.slice(0,200)}`));
        }
        try { resolve(JSON.parse(body)); }
        catch (error) { reject(new Error(`LOCAL_CANDIDATE_HTTPS_JSON:${error}`)); }
      });
    });
    req.on('timeout',()=>req.destroy(new Error('LOCAL_CANDIDATE_HTTPS_TIMEOUT')));
    req.on('error', reject);
  });
}

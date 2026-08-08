import fs from 'node:fs';
import crypto from 'node:crypto';
import { EXPECTED_SHA256, EXPECTED_SIZE, EXPECTED_BUILD } from './constants.js';
export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
export function verifySourceFile(file) {
  const bytes=fs.readFileSync(file), digest=sha256(bytes);
  if (digest!==EXPECTED_SHA256 || bytes.length!==EXPECTED_SIZE) throw new Error(`SOURCE_IDENTITY_MISMATCH:${digest}:${bytes.length}`);
  return {sha256:digest,size:bytes.length};
}
export async function verifyBrowserIdentity(page, url) {
  const response=await page.goto(url,{waitUntil:'domcontentloaded'});
  if (!response) throw new Error('HTTPS_RESPONSE_MISSING');
  const body=await response.body(), responseSha=sha256(body);
  const build=await page.locator('#cp32BuildIdentity').getAttribute('data-build-id');
  const marker=await page.locator('#cp32BuildIdentity').textContent();
  const result={url,status:response.status(),responseSha,responseSize:body.length,build,marker};
  if(responseSha!==EXPECTED_SHA256 || body.length!==EXPECTED_SIZE) throw new Error(`CANDIDATE_IDENTITY_MISMATCH:${JSON.stringify(result)}`);
  if(build!==EXPECTED_BUILD) throw new Error(`BUILD_IDENTITY_MISMATCH:${build}`);
  return result;
}
export async function readProductionIdentity(page,url) {
  const response=await page.goto(url,{waitUntil:'domcontentloaded'}); if(!response)throw new Error('PRODUCTION_HTTPS_FAILED');
  const body=await response.body();
  return {status:response.status(),responseSha:sha256(body),responseSize:body.length,build:await page.locator('#cp32BuildIdentity').getAttribute('data-build-id')};
}

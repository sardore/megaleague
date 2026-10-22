import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const result=await build({
  entryPoints:['src/main.js'],bundle:true,format:'esm',target:['es2022'],
  outfile:'assets/app.js',minify:true,metafile:true,legalComments:'none',
  sourcemap:'external',write:true,
});
let shell=await fs.readFile('src/app/shell.html','utf8');
for(const file of ['assets/app.js','assets/app.css']) {
  const digest=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex').slice(0,12);
  shell=shell.replace('./'+file,'./'+file+'?v='+digest);
}
await fs.writeFile('index.html',shell);
const files=['index.html','assets/app.js','assets/app.css'];
const sizes={};
for(const file of files){const bytes=await fs.readFile(file);sizes[file]={bytes:bytes.length,gzipBytes:zlib.gzipSync(bytes).length};}
await fs.mkdir('artifacts/build',{recursive:true});
await fs.writeFile('artifacts/build/metafile.json',JSON.stringify(result.metafile,null,2));
await fs.writeFile('artifacts/build/sizes.json',JSON.stringify(sizes,null,2));
console.log(JSON.stringify(sizes,null,2));

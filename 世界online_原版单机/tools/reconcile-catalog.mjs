import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {root,decode,applyResult,coverage} from './catalog-core.mjs';
const recorder=path.resolve(root,'../正式服录制工具'),file=path.join(recorder,'collection/catalog-v305.json');
const status=JSON.parse(fs.readFileSync(path.join(recorder,'collection/status.json'),'utf8'));
if(status.collection?.active||status.capture?.status==='recording')throw Error('End and save the recording before reconciling.');
const state=JSON.parse(fs.readFileSync(file,'utf8')),official=JSON.parse(fs.readFileSync(path.join(root,'data/official-v305.json'),'utf8'));
const recovered=[];
for(const [key,failure] of Object.entries(state.failed||{})){
 const q=failure.request;
 const row=q?.kind==='identify'?official.identification.find(i=>i.itemId===q.id):q?.kind==='item'?official.items.find(i=>i.id===q.id):null;
 const source=row?.sources?.findLast(s=>s.capture&&s.blob);
 if(!source)continue;
 const folder=path.resolve(root,'../正式服录制数据',source.capture);
 const captureStatus=JSON.parse(fs.readFileSync(path.join(folder,'status.json'),'utf8'));
 if(captureStatus.status!=='saved')continue;
 const bytes=fs.readFileSync(path.join(folder,source.blob));
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw Error('Recovery blob hash mismatch');
 applyResult(state,q,decode(q,bytes,source));recovered.push(key);
}
const backup=file+'.before-reconcile-'+Date.now();fs.copyFileSync(file,backup);
fs.writeFileSync(file+'.tmp',JSON.stringify(state,null,2)+'\n');fs.renameSync(file+'.tmp',file);
const report={at:new Date().toISOString(),backup,recovered,remainingFailures:Object.keys(state.failed),coverage:coverage(state,official)};
fs.writeFileSync(path.join(root,'analysis/catalog-reconciliation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({recovered:recovered.length,remainingFailures:report.remainingFailures,coverage:report.coverage},null,2));

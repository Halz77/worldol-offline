import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url);
const recorder=path.resolve(root,'../正式服录制工具'),captures=path.resolve(root,'../正式服录制数据');
const {verify}=require(path.join(recorder,'lib/verify.cjs'));
const {DetailRecorder,loadDetailDependencies}=require(path.join(recorder,'lib/details.cjs'));
const deps=await loadDetailDependencies(recorder);
const output=path.join(root,'analysis','recordings-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(output,{recursive:true});
const json=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const results=[];
function* events(folder){for(const name of fs.readdirSync(path.join(folder,'events')).filter(n=>/^\d+\.ndjson$/.test(n)).sort())for(const line of fs.readFileSync(path.join(folder,'events',name),'utf8').split('\n'))if(line)yield JSON.parse(line);}
for(const id of fs.readdirSync(captures).sort()){
 const folder=path.join(captures,id),statusFile=path.join(folder,'status.json');if(!fs.existsSync(statusFile))continue;
 const status=JSON.parse(fs.readFileSync(statusFile,'utf8'));if(status.status!=='saved')continue;
 const sessionFile=path.join(folder,'session.json'),sessionBefore=hash(sessionFile),audit=verify(folder);
 const info={id,startedAt:status.startedAt,endedAt:status.endedAt,appVersion:status.appVersion,integrityPassed:audit.integrityPassed,cleanEnd:audit.cleanEnd,events:audit.events,wsSent:audit.wsSent,wsReceived:audit.wsReceived,gaps:audit.captureGaps,networkFailures:audit.networkFailures,errors:audit.errors};
 const target=path.join(output,id);fs.mkdirSync(target,{recursive:true});json(path.join(target,'audit.json'),audit);
 if(!audit.integrityPassed||!audit.cleanEnd){info.skipped='未通过完整性与正常结束校验';results.push(info);continue;}
 const versionEvidence=[];for(const event of events(folder))if(event.method==='recorder.httpBody'){
  const url=new URL(event.params.url),relative=url.pathname.replace(/^\/resgood\//,'');
  if(relative==='v/gd/305.json'||relative.startsWith('js/')){
   const local=path.join(root,'client',relative),same=fs.existsSync(local)&&hash(local)===event.params.body.sha256;
   versionEvidence.push({seq:event.seq,path:relative,sha256:event.params.body.sha256,same});
  }
 }
 info.clientFiles=versionEvidence;
 if(!audit.wsReceived||!versionEvidence.some(x=>x.same&&x.path==='v/gd/305.json')||versionEvidence.some(x=>!x.same)){
  info.skipped=!audit.wsReceived?'没有游戏下行消息':'客户端版本与本地305未核验一致';results.push(info);console.log(JSON.stringify({id,skipped:info.skipped}));continue;
 }
 const child=spawnSync(process.execPath,[path.join(root,'tools/analyze-capture.mjs'),folder,'--out',path.join(target,'public')],{encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});
 if(child.status!==0){info.publicError=child.stderr.slice(-4000);json(path.join(target,'public-error.json'),{error:info.publicError});}
 else info.public=JSON.parse(fs.readFileSync(path.join(target,'public/summary.json'),'utf8'));
 const archive=Object.assign(new EventEmitter(),{id,dir:folder,record(){throw Error('Analysis cannot write original journal');}});
 const detail=new DetailRecorder(path.join(target,'state'),archive,deps,{}, {detailsFolder:path.join(target,'details')});detail.setVersion('305');
 const itemVariants=new Map(),addItem=detail.addItem.bind(detail);
 detail.addItem=(item,source)=>{addItem(item,source);const sig=crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex'),key=item.id+':'+sig;if(!itemVariants.has(key))itemVariants.set(key,{data:JSON.parse(JSON.stringify(item)),sources:[]});const value=itemVariants.get(key);if(!value.sources.some(s=>s.sha256===source.sha256))value.sources.push(source);};
 try{for(const row of events(folder))if(/^Network.webSocketFrame(Sent|Received)$/.test(row.method)){
  const ref=row.params.response.payload,bytes=fs.readFileSync(path.join(folder,ref.file));
  detail.consume({bytes,seq:row.seq,at:row.receivedAt,target:row.target,requestId:row.params.requestId,opcode:row.params.response.opcode,method:row.method});
 }}finally{detail.finish();}
 json(path.join(target,'item-variants.json'),[...itemVariants.values()]);
 info.details={counts:detail.snapshot().counts,stats:detail.state.stats,warnings:detail.state.warnings};info.itemVariants=itemVariants.size;
 if(hash(sessionFile)!==sessionBefore)throw Error('Source session changed during analysis: '+id);
 results.push(info);json(path.join(output,'captures.json'),results);
 console.log(JSON.stringify({id,public:info.public?.counts,details:info.details.counts,parseErrors:info.details.stats.parseErrors,publicIncomplete:info.public?.decoding.partialOrFailed.length}));
}
json(path.join(output,'captures.json'),results);
json(path.join(root,'analysis/recordings-latest.json'),{output,captures:results.length,ready:results.filter(r=>r.details).length,generatedAt:new Date().toISOString()});
console.log(JSON.stringify({output,captures:results.length,ready:results.filter(r=>r.details).length}));

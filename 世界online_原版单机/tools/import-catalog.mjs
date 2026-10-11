import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {root,decode,initialState,applyResult,coverage,needsRanges,isEquipment} from './catalog-core.mjs';
import {Reader,protobuf,protobufSchemas} from './capture-decoders.mjs';
const file=path.join(root,'data/official-v305.json'),official=JSON.parse(fs.readFileSync(file,'utf8'));
const state=initialState(official),captureRoot=path.resolve(root,'../正式服录制数据');
const schemas=protobufSchemas(fs.readFileSync(path.join(root,'analysis/protobuf.decoded.js'),'utf8'));
const audit={generatedAt:new Date().toISOString(),decoded:0,failed:[],conflicts:[],captures:[]};
const existing=new Map(official.items.map(x=>[x.id,x]));
for(const name of fs.readdirSync(captureRoot)){
  const folder=path.join(captureRoot,name),status=path.join(folder,'status.json');if(!fs.existsSync(status)||JSON.parse(fs.readFileSync(status)).status!=='saved')continue;
  const pending=new Map();let decoded=0;
  for(const f of fs.readdirSync(path.join(folder,'events')).filter(f=>/^\d+\.ndjson$/.test(f)).sort())for(const line of fs.readFileSync(path.join(folder,'events',f),'utf8').trim().split('\n')){
    const e=JSON.parse(line);if(!/^Network.webSocketFrame(Sent|Received)$/.test(e.method))continue;
    const ref=e.params.response.payload,b=fs.readFileSync(path.join(folder,ref.file));if(b.length<4)continue;const type=b.readUInt16BE(2);if(![16051,12060,14001,32101,32102].includes(type))continue;
    if(crypto.createHash('sha256').update(b).digest('hex')!==ref.sha256)throw Error('Capture hash mismatch');
    const sent=e.method.endsWith('Sent'),k=`${e.target}:${e.params.requestId}:${type===32102?32101:type}`;
    if(sent){let q;const r=new Reader(b.subarray(4));if(type===32101){const p=protobuf(r.b,'c2s_HandBookInfo',schemas);q={kind:'catalog',group:p.group,type:p.type};}else if(type===14001)q={kind:'skills',id:r.getShort()};else q={kind:type===16051?'item':'identify',id:r.getInt()};(pending.get(k)||pending.set(k,[]).get(k)).push({...q,requestSeq:e.seq});continue;}
    const q=pending.get(k)?.shift();if(!q)continue;
    if(q.kind==='identify')q.pet=(state.items.find(i=>i.id===q.id)||existing.get(q.id))?.type===41;
    try{const result=decode(q,b,{capture:name,seq:e.seq,requestSeq:q.requestSeq,origin:'recorded-preview'});applyResult(state,q,result);decoded++;audit.decoded++;}catch(error){audit.failed.push({capture:name,seq:e.seq,request:q,error:error.message});}
  }
  audit.captures.push({name,decoded});
}
const collection=path.resolve(root,'../正式服录制工具/collection/catalog-v305.json');
if(fs.existsSync(collection)){
 const c=JSON.parse(fs.readFileSync(collection));if(c.clientVersion!==305)throw Error('Collection version mismatch');
 for(const [list,make] of [[c.items||[],v=>({kind:'item',id:v.id})],[c.identification||[],v=>({kind:'identify',id:v.itemId,pet:v.petScale!==undefined})],[c.skillShops||[],v=>({kind:'skills',id:v.shopId})]])for(const row of list){
  const source=row.source||row.sources?.[0],q=make(row);if(!source?.capture||!source.blob)throw Error('Collection provenance missing');
  const b=fs.readFileSync(path.join(captureRoot,source.capture,source.blob));if(crypto.createHash('sha256').update(b).digest('hex')!==source.sha256)throw Error('Collection blob hash mismatch');
  applyResult(state,q,decode(q,b,source));
 }
 for(const row of c.catalog||[]){const s=row.sources?.[0];if(s?.origin!=='catalog-collector')continue;const q={kind:'catalog',group:s.group,type:s.type};if(state.done[`live-page:${q.group}:${q.type}`])continue;const b=fs.readFileSync(path.join(captureRoot,s.capture,s.blob));if(crypto.createHash('sha256').update(b).digest('hex')!==s.sha256)throw Error('Catalogue hash mismatch');applyResult(state,q,decode(q,b,s));state.done[`live-page:${q.group}:${q.type}`]=true;}
 audit.collectionFailures=c.failed||{};
}
const sources=(a,b)=>[...new Map([...(a||[]),...(b||[])].map(s=>[JSON.stringify(s),s])).values()];
function merge(name,rows,getKey){const index=new Map((official[name]||[]).map(i=>[getKey(i),i]));for(const row of rows){const id=getKey(row),old=index.get(id);if(!old){index.set(id,row);continue;}if(name==='items'&&old.definitionBase64!==row.definitionBase64){audit.conflicts.push({table:name,id,decision:'Existing item kept; new raw definition retained in capture'});old.sources=sources(old.sources,row.sources);continue;}index.set(id,{...old,...row,sources:sources(old.sources,row.sources)});}official[name]=[...index.values()];}
merge('catalog',state.catalog,i=>i.itemId);merge('items',state.items,i=>i.id);merge('skills',state.skillDefinitions,s=>`${s.id}:${s.level}`);merge('identification',state.identification,i=>i.itemId);
// Keep embedded skills as their own evidence category: these are not learned skills.
const embedded=[];for(const item of official.items){
 const entries=[...(item.skill?[{skill:item.skill,slot:'skill'}]:[]),...(item.combinUpSkillList||[]).map((skill,index)=>({skill,slot:`combinUpSkillList:${index}`}))];
 for(const {skill,slot} of entries)embedded.push({...skill,sources:item.sources.map(s=>({...s,origin:'equipment-skill',itemId:item.id,slot}))});
}
const skills=new Map(official.skills.map(s=>[`${s.id}:${s.level}`,s]));for(const s of embedded){const id=`${s.id}:${s.level}`,old=skills.get(id);skills.set(id,old?{...old,sources:sources(old.sources,s.sources)}:s);}
const required=official.items.filter(needsRanges),rangeIds=new Set(official.identification.map(x=>x.itemId));
const itemIds=new Set(official.items.map(i=>i.id)),equipmentCatalog=official.catalog.filter(isEquipment);
const missingEquipment=equipmentCatalog.filter(i=>!itemIds.has(i.itemId)).map(i=>({id:i.itemId,name:i.name}));
const missingRanges=required.filter(i=>!rangeIds.has(i.id)).map(i=>({id:i.id,name:i.name}));
const learnedSkills=[...skills.values()].filter(s=>s.sources?.some(x=>x.origin==='shop'||x.origin==='learned-definition'));
const missingLevels=[];for(const id of new Set(learnedSkills.map(s=>s.id))){const rows=learnedSkills.filter(s=>s.id===id),max=Math.max(...rows.map(s=>s.maxLevel||s.level)),known=new Set(rows.map(s=>s.level));missingLevels.push({id,name:rows[0].name,known:[...known].sort((a,b)=>a-b),recordedMax:max,missing:Array.from({length:max},(_,i)=>i+1).filter(n=>!known.has(n))});}
const report={...audit,counts:{catalog:official.catalog.length,equipmentCatalog:equipmentCatalog.length,itemDetails:official.items.length,equipmentDetails:equipmentCatalog.length-missingEquipment.length,identificationTables:official.identification.length,identificationMissing:missingRanges.length,skillDefinitions:skills.size,skillIds:new Set([...skills.values()].map(s=>s.id)).size,equipmentSkillDefinitions:embedded.length,learnableSkillIds:new Set(learnedSkills.map(s=>s.id)).size},missingEquipment,missingRanges,skillLevels:missingLevels,limits:['Catalogue coverage is not proof of the complete server item database.','Only recorded skill levels are official; unobserved levels and probabilities are not inferred.','Equipment-attached skill definitions do not imply all corresponding combat mechanics are restored.']};
const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(official,null,2)+'\n');fs.renameSync(tmp,file);
fs.writeFileSync(path.join(root,'data/catalog-skills.json'),JSON.stringify([...skills.values()],null,2)+'\n');
fs.writeFileSync(path.join(root,'analysis/catalog-coverage.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({counts:report.counts,decoded:audit.decoded,decodeFailures:audit.failed,conflicts:audit.conflicts.length},null,2));

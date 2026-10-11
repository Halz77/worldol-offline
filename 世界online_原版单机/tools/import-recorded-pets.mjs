// Replay verified recordings into additive pet tables. Never copy account data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readVerifiedCapturePrefix} from './capture-prefix.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url);
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const captures=path.resolve(arg('--captures')||path.join(root,'../正式服录制数据'));
const out=path.resolve(arg('--out')||path.join(root,'analysis/pet-import-'+Date.now()));
const recorder=path.resolve(root,'../正式服录制工具');
const {DetailRecorder,loadDetailDependencies}=require(path.join(recorder,'lib/details.cjs'));
const deps=await loadDetailDependencies(recorder);
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n');};
const dataFile=path.join(root,'data/recorded-content.json'),officialFile=path.join(root,'data/official-v305.json');
const oldData=fs.readFileSync(dataFile),oldOfficial=fs.readFileSync(officialFile),data=JSON.parse(oldData),official=JSON.parse(oldOfficial);
const content=v=>JSON.stringify(v,(k,x)=>['sources','variants','speciesName'].includes(k)?undefined:x);
const mergeSources=(a=[],b=[])=>[...new Map([...a,...b].map(s=>[`${s.capture}:${s.seq}:${s.sha256}`,s])).values()];
const report={revision:'recorded-pets-20260923',generatedAt:new Date().toISOString(),captures:[],added:{},assets:[],conflicts:[]};
const tables=['pets','petCatalog','petSkills','petEquipment','petEggs'];
const key=(table,p)=>table==='petSkills'?`${p.id}:${p.level}`:String(p.id);
const maps=Object.fromEntries(tables.map(t=>[t,new Map(data[t].map(p=>[key(t,p),p]))]));
const samples=new Map(data.petSnapshots.map(p=>[content(p),p]));
const items=new Map(official.items.map(i=>[i.id,i]));
const existingCaptures=new Set([...(data.captures||[]),...(data.petImports||[])].map(c=>c.id));
const names=new Set(data.pets.map(p=>p.name.replace(/[()（）]/g,'')));
const normalizeName=n=>n.replace(/[()（）]/g,'');
const assetCandidates=new Map();
fs.mkdirSync(out,{recursive:true});
for(const id of fs.readdirSync(captures).sort()){
 if(existingCaptures.has(id))continue;
 const folder=path.join(captures,id),indexFile=path.join(folder,'details/index.json');
 if(!fs.existsSync(indexFile)||read(path.join(folder,'status.json')).status!=='saved')continue;
 const prior=read(indexFile);if(!(prior.pets?.length||prior.petSnapshots?.length))continue;
 if(prior.actualClientVersion!=='305')throw Error('Unsupported pet recording version: '+id);
 const {rows,audit}=readVerifiedCapturePrefix(folder);
 if(!audit.cleanEnd||audit.truncatedTail||audit.captureGaps.length)throw Error('Incomplete capture: '+id);
 // A byte-identical native manifest pins the decoder version to this recording.
 const http=rows.filter(r=>r.method==='recorder.httpBody');
 const manifest=http.find(r=>new URL(r.params.url).pathname==='/resgood/v/gd/305.json');
 if(!manifest||manifest.params.body.sha256!==digest(fs.readFileSync(path.join(root,'client/v/gd/305.json'))))throw Error('Native manifest mismatch: '+id);
 for(const row of http){
  const p=new URL(row.params.url).pathname;if(!p.startsWith('/resgood/'))continue;
  const relative=p.slice('/resgood/'.length),target=path.resolve(root,'client',relative);
  if(!target.startsWith(path.resolve(root,'client')+path.sep))throw Error('Asset path escaped');
  if(relative.startsWith('js/')&&fs.existsSync(target)&&digest(fs.readFileSync(target))!==row.params.body.sha256)throw Error('Native JS mismatch: '+relative);
  if(!fs.existsSync(target)&&/\.(png|jpg|jpeg|webp|json|mp3|bin|dat)$/i.test(relative)){
   const prev=assetCandidates.get(relative);if(prev&&prev.sha256!==row.params.body.sha256)throw Error('Conflicting missing asset: '+relative);
   assetCandidates.set(relative,{path:relative,sha256:row.params.body.sha256,from:path.join(folder,row.params.body.file)});
  }
 }
 const target=path.join(out,id),archive=Object.assign(new EventEmitter(),{id,dir:folder,record(){throw Error('Cannot modify original recording');}});
 const detail=new DetailRecorder(path.join(target,'state'),archive,deps,{}, {detailsFolder:path.join(target,'details')});detail.setVersion('305');
 try{for(const row of rows)if(/^Network.webSocketFrame(Sent|Received)$/.test(row.method)){
  const ref=row.params.response.payload,bytes=fs.readFileSync(path.join(folder,ref.file));
  detail.consume({bytes,seq:row.seq,at:row.receivedAt,target:row.target,requestId:row.params.requestId,opcode:row.params.response.opcode,method:row.method});
 }}finally{detail.finish();}
 if(detail.state.stats.parseErrors)throw Error('Pet replay decoding errors in '+id);
 for(const table of tables)for(const row of detail.state[table]||[]){
  const incoming={...row.data,sources:row.sources},k=key(table,incoming),old=maps[table].get(k);
  if(!old){maps[table].set(k,incoming);report.added[table]=(report.added[table]||0)+1;}
  else{if(content(old)!==content(incoming)&&!(old.variants||[]).some(v=>content(v.data)===content(incoming))){old.variants??=[];old.variants.push({data:row.data,sources:row.sources});}old.sources=mergeSources(old.sources,row.sources);}
 }
 for(const row of detail.state.petSnapshots||[]){
  for(const version of [...(row.variants||[]),row]){
   const incoming={...version.data,sources:version.sources};
   // Accept a captured species name only if it matches a known species or its
   // named evolution; custom owner nicknames never enter the public catalog.
   const src=incoming.sources.find(s=>s.protocol===15512||s.protocol===15502);
   if(src){const r=new deps.Reader(fs.readFileSync(path.join(folder,src.blob)).subarray(4));if(r.getByte()===0&&r.getByte()>=0){const n=r.getString(),normal=normalizeName(n);if(names.has(normal)||normal.endsWith('进化')&&names.has(normal.slice(0,-2)))incoming.speciesName=n;}}
   const k=content(incoming),old=samples.get(k);
   if(old){old.sources=mergeSources(old.sources,incoming.sources);if(incoming.speciesName)old.speciesName=incoming.speciesName;}
   else{data.petSnapshots.push(incoming);samples.set(k,incoming);report.added.petSnapshots=(report.added.petSnapshots||0)+1;}
  }
 }
 for(const row of detail.state.petEquipment||[]){
  const item=row.data,b=Buffer.from(item.definitionBase64||item.wireBase64||'','base64'),r=new deps.Reader(b),type=r.getByte();
  if(r.getBoolean()){r.getBoolean();for(let n=r.getByte();n>0;n--)r.take(9);const illusion=r.getInt();r.getLong();if(illusion)deps.d.Item.fromBytesAtts2(new deps.d.Item(),r);}
  const raw=Buffer.concat([Buffer.from([type,0]),r.b.subarray(r.pos)]),check=new deps.Reader(raw),canonical=new deps.d.Item();deps.d.Item.fromBytesAtts2(canonical,check);check.finish();
  if(canonical.id!==item.id)throw Error('Pet equipment identity mismatch');
  if(!items.has(item.id)){const value={...canonical,definitionBase64:raw.toString('base64'),sources:row.sources};official.items.push(value);items.set(item.id,value);report.added.itemDefinitions=(report.added.itemDefinitions||0)+1;}
 }
 const receipt={id,events:audit.events,integrityPassed:true,cleanEnd:true,version:305,counts:{pets:detail.state.pets.length,samples:detail.state.petSnapshots.length,skills:detail.state.petSkills.length},parseErrors:0};
 report.captures.push(receipt);write(path.join(target,'audit.json'),audit);console.log(JSON.stringify(receipt));
}
if(!report.captures.length){console.log(JSON.stringify({applied:false,message:'No new pet recordings; existing data and audit retained.'}));process.exit(0);}
for(const t of tables)data[t]=[...maps[t].values()];
for(const pet of data.petSnapshots)for(const e of pet.equipment||[])if(!items.has(e.itemId))throw Error('Missing pet equipment '+e.itemId);
data.petImports=[...(data.petImports||[]),...report.captures];data.revision=report.revision;data.generatedAt=report.generatedAt;
report.totals=Object.fromEntries([...tables,'petSnapshots'].map(t=>[t,data[t].length]));
report.assets=[...assetCandidates.values()].map(({path,sha256})=>({path,sha256}));
write(path.join(out,'recorded-content.json'),data);write(path.join(out,'official-v305.json'),official);
if(process.argv.includes('--apply')){
 if(digest(fs.readFileSync(dataFile))!==digest(oldData)||digest(fs.readFileSync(officialFile))!==digest(oldOfficial))throw Error('Source data changed during import');
 fs.mkdirSync(path.join(out,'before'),{recursive:true});fs.writeFileSync(path.join(out,'before/recorded-content.json'),oldData);fs.writeFileSync(path.join(out,'before/official-v305.json'),oldOfficial);
 for(const asset of assetCandidates.values()){const target=path.join(root,'client',asset.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(asset.from,target);}
 fs.copyFileSync(path.join(out,'recorded-content.json'),dataFile);
 if(report.added.itemDefinitions)fs.copyFileSync(path.join(out,'official-v305.json'),officialFile);
 write(path.join(root,'data/pet-import-20260923.json'),report);
}
write(path.join(out,'report.json'),report);
console.log(JSON.stringify({applied:process.argv.includes('--apply'),added:report.added,totals:report.totals,assets:report.assets.length,out}));

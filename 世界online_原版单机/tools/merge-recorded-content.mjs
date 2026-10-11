import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Reader,decoders} from './capture-decoders.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),analysis=JSON.parse(fs.readFileSync(path.join(root,'analysis/recordings-latest.json'),'utf8')).output;
const reports=JSON.parse(fs.readFileSync(path.join(analysis,'captures.json'),'utf8')),d=decoders(root);
const dataFile=path.join(root,'data/official-v305.json'),official=JSON.parse(fs.readFileSync(dataFile,'utf8'));
const read=(dir,file)=>JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
const write=(file,data)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2)+'\n');fs.renameSync(file+'.tmp',file);};
const stable=v=>JSON.stringify(v,(key,value)=>['sources','variants','wireBase64','definitionBase64','signature'].includes(key)?undefined:value);
const sources=(a=[],b=[])=>[...new Map([...a,...b].map(s=>[`${s.capture}:${s.seq}:${s.sha256}:${s.origin||''}:${s.mapId||''}:${s.npcId??''}`,s])).values()];
const conflicts=[],missingMaps=[],mapIndex=new Map(official.maps.map(m=>[m.id,m]));
const keys={items:x=>x.id,skills:x=>`${x.id}:${x.level}`,missions:x=>x.id,monsters:x=>x.id,groups:x=>x.groupId,ai:x=>x.id,catalog:x=>x.itemId,areas:x=>x.id,mapList:x=>x.id};
const tables=Object.fromEntries(Object.entries(keys).map(([table,key])=>[table,new Map((official[table]||[]).map(v=>[key(v),v]))]));
function merge(table,row){const key=keys[table](row),old=tables[table].get(key);if(!old){tables[table].set(key,row);return;}if(stable(old)!==stable(row))conflicts.push({table,key,decision:'retain-existing-definition-with-new-source'});old.sources=sources(old.sources,row.sources);}
function canonical(item){
 const b=Buffer.from(item.definitionBase64||item.wireBase64||'','base64');if(!b.length)return null;
 const r=new Reader(b),type=r.getByte();if(type===32)return null;
 if(r.getBoolean()){r.getBoolean();for(let n=r.getByte();n>0;n--)r.take(9);const illusion=r.getInt();r.getLong();if(illusion)d.Item.fromBytesAtts2(new d.Item(),r);}
 const raw=Buffer.concat([Buffer.from([type,0]),r.b.subarray(r.pos)]),v=new d.Item(),check=new Reader(raw);d.Item.fromBytesAtts2(v,check);check.finish();
 if(v.id!==item.id)throw Error('Canonical item identity mismatch');return {...v,definitionBase64:raw.toString('base64'),sources:item.sources||[]};
}
const records={schema:1,clientVersion:305,revision:'recordings-v064',generatedAt:new Date().toISOString(),captures:[],sets:[],vip:[],titles:[],gems:[],pets:[],petCatalog:[],petSnapshots:[],petSkills:[],petEggs:[],petEquipment:[],petHatches:[],guides:[],questEvents:[],battleEvents:[],eggResults:[]};
const recordedMaps=Object.fromEntries(Object.keys(records).filter(k=>Array.isArray(records[k])).map(k=>[k,new Map()]));
function recorded(table,row,capture){const id=['petSnapshots','petHatches','questEvents'].includes(table)?`${capture}:${row.key}`:String(row.key),data={...row.data,sources:row.sources};if(table==='sets')data.bonuses=data.bonuses.map(({active,...v})=>v);const old=recordedMaps[table].get(id);if(old&&stable(old)!==stable(data)){data.variants=[...(old.variants||[]),{data:old,sources:old.sources}];}data.sources=sources(old?.sources,data.sources);recordedMaps[table].set(id,data);}
for(const report of reports.filter(r=>r.details&&r.public)){
 if(!report.integrityPassed||!report.cleanEnd||report.public.decoding.partialOrFailed.length||report.details.stats.parseErrors)throw Error('Unresolved decoding in '+report.id);
 const dir=path.join(analysis,report.id),pub=path.join(dir,'public'),details=read(dir,'details/index.json');
 records.captures.push({id:report.id,startedAt:report.startedAt,endedAt:report.endedAt,gaps:report.gaps.length,networkFailures:report.networkFailures.length});
 for(const table of Object.keys(keys))for(const row of read(pub,table+'.json')){if(table==='items'){const item=canonical(row);if(item)merge(table,item);}else merge(table,row);}
 for(const v of read(dir,'item-variants.json')){const item=canonical({...v.data,sources:v.sources});if(item)merge('items',item);}
 for(const row of details.vip||[])for(const item of row.data.items||[]){const value=canonical({...item,sources:row.sources});if(value)merge('items',value);}
 for(const table of Object.keys(recordedMaps))if(details[table])for(const row of details[table])recorded(table,row,report.id);
 for(const e of read(pub,'quest-events.json'))recordedMaps.questEvents.set(`${report.id}:${e.seq}`,e);
 for(const e of read(pub,'battle-events.json'))recordedMaps.battleEvents.set(`${report.id}:${e.seq}`,e);
 const npcs=read(pub,'npcs.json');
 for(const scene of read(pub,'scene-packets.json').filter(s=>s.complete&&(s.name||s.cityOwnerOmitted))){
  const geometry=path.join(root,'data/maps',scene.mapId+'.json'),source=path.resolve(root,'../H5客户端_v305_解析结果_20260920/配置数据/地图',scene.mapId+'.json');
  if(!fs.existsSync(geometry)){if(!fs.existsSync(source)){missingMaps.push({id:scene.mapId,capture:report.id});continue;}fs.copyFileSync(source,geometry);}
  let map=mapIndex.get(scene.mapId);if(!map){map={id:scene.mapId,name:scene.name||'个人城市',spawn:[scene.x,scene.y],npcs:[],sourceCapture:report.id,sourceSeq:scene.seq,...(scene.cityOwnerOmitted?{cityTemplate:true}:{})};mapIndex.set(map.id,map);}
  const byId=new Map(map.npcs.map(n=>[n.id,n]));for(const n of npcs.filter(n=>n.mapId===map.id)){const old=byId.get(n.id);if(old)old.sources=sources(old.sources,n.sources);else byId.set(n.id,n);}map.npcs=[...byId.values()];
 }
}
for(const table of Object.keys(recordedMaps))if(!['captures'].includes(table))records[table]=[...recordedMaps[table].values()];
for(const [table,map] of Object.entries(tables))official[table]=[...map.values()];
official.maps=[...mapIndex.values()];official.sourceCaptures??=[];for(const c of records.captures)if(!official.sourceCaptures.some(s=>s.id===c.id))official.sourceCaptures.push(c);
// Source receipts link a newly purchased egg's exact destination slot to its use.
// The intervening replies must all be audited non-inventory-changing reads/notifications.
const nonmutating=new Set([10504,10505,11501,11530,12004,12049,14001,14555,15502,15514,16001,16005,16021,16051,25013,32102]);
for(const report of reports.filter(r=>r.details)){
 const dir=path.join(analysis,report.id),detail=read(dir,'details/index.json'),folder=path.resolve(root,'../正式服录制数据',report.id),receipts=new Map(),pending=new Map();
 const hatches=new Map((detail.petHatches||[]).map(x=>[x.sources[0].seq,x]));
 for(const file of fs.readdirSync(path.join(folder,'events')).filter(n=>/^\d+\.ndjson$/.test(n)).sort())for(const line of fs.readFileSync(path.join(folder,'events',file),'utf8').split('\n'))if(line){
  const event=JSON.parse(line);if(!/^Network.webSocketFrame(Sent|Received)$/.test(event.method)||event.params.response.opcode!==2)continue;
  const b=fs.readFileSync(path.join(folder,event.params.response.payload.file));if(b.length<5)continue;const type=b.readUInt16BE(2),sent=event.method.endsWith('Sent'),connection=event.target+':'+event.params.requestId;
  if(type===12005&&!sent&&b.length===28&&b.readInt8(4)===0){const itemId=b.readInt32BE(5),slot=b.readInt16BE(9),item=tables.items.get(itemId);receipts.delete(connection);if(item?.power1===109)receipts.set(connection,{itemId,slot,seq:event.seq,sha256:event.params.response.payload.sha256});continue;}
  if(type===12001&&sent){const slot=b.readInt16BE(6),receipt=receipts.get(connection);if(b[4]===1&&b[5]===3&&receipt?.slot===slot)pending.set(connection,receipt);receipts.delete(connection);continue;}
  if(type===12001&&!sent){const hatch=hatches.get(event.seq),receipt=pending.get(connection);pending.delete(connection);if(hatch&&receipt){
    const value=records.petHatches.find(x=>x.sources?.some(s=>s.capture===report.id&&s.seq===event.seq));if(value)Object.assign(value,{inputItemId:receipt.itemId,association:'verified-purchase-slot',purchaseEvidence:receipt});
    const output=hatch.data.outputs.find(x=>x.pet);const actual=detail.petSnapshots.find(x=>x.sources.some(s=>s.seq>event.seq)&&x.key.includes(':bag:'+receipt.slot+':')&&x.data.level===1&&String(x.data.icon)===String(output?.pet.icon)&&x.data.grade===output?.pet.grade);
    if(actual){const egg=tables.items.get(receipt.itemId),baseline={...actual.data,baseStats:Object.values(actual.data.attributes)};delete baseline.attributes;delete baseline.scope;records.eggResults.push({eggId:receipt.itemId,name:egg.name.replace(/宠物蛋$/, ''),item:output.pet,baseline,sourceCapture:report.id,sources:[...hatch.sources,...actual.sources],purchaseEvidence:receipt,openingRule:'fixed-observed-result; probability unknown'});}
   }receipts.delete(connection);continue;}
  if(!sent&&!nonmutating.has(type))receipts.delete(connection);
 }
}
official.petContent??={pets:[],chests:[]};for(const result of records.eggResults)if(!official.petContent.pets.some(p=>p.eggId===result.eggId)){const b=result.baseline;official.petContent.pets.push({...result,expTable:{[b.level]:b.expMax},milestones:{[b.level]:b},maxRecordedLevel:b.level});}
// Copy only resources explicitly delivered by the matching v305 static client.
const assets={added:0,identical:0,conflicts:[]};
for(const report of reports.filter(r=>r.public))for(const asset of read(path.join(analysis,report.id,'public'),'resources.json')){
 const relative=asset.path.replace(/^\/resgood\//,'');if(asset.path===relative||(!asset.originalPaths.length&&!/^(js|v)\//.test(relative)))continue;
 const target=path.resolve(root,'client',relative),base=path.resolve(root,'client')+path.sep;if(!target.startsWith(base))throw Error('Asset path escaped client');
 if(fs.existsSync(target)){const digest=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');if(digest===asset.sha256)assets.identical++;else assets.conflicts.push({path:relative,capture:report.id});continue;}
 const blob=path.resolve(root,'../正式服录制数据',report.id,asset.blob);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(blob,target);assets.added++;
}
const guidesFile=path.join(root,'data/official-guides.json');if(fs.existsSync(guidesFile)){const guides=read(path.join(root,'data'),'official-guides.json'),pages=new Map(guides.pages.map(p=>[p.id,p]));for(const p of records.guides)pages.set(p.id,p);guides.pages=[...pages.values()];write(guidesFile,guides);}
write(dataFile,official);write(path.join(root,'data/recorded-content.json'),records);
const result={revision:records.revision,analysis,captures:records.captures.length,counts:{...Object.fromEntries(Object.keys(keys).map(k=>[k,official[k].length])),maps:official.maps.length,npcs:official.maps.reduce((n,m)=>n+m.npcs.length,0),...Object.fromEntries(['sets','vip','titles','pets','petSkills','petEggs','eggResults'].map(k=>[k,records[k].length]))},conflicts,missingMaps,assets};
write(path.join(root,'analysis/recordings-merge.json'),result);console.log(JSON.stringify({...result,conflicts:conflicts.length,assets:{...assets,conflicts:assets.conflicts.length}},null,2));

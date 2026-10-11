import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Reader,decoders} from './capture-decoders.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const capture=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw Error('Usage: merge-official-capture.mjs <saved capture>');
const name=path.basename(capture),read=n=>JSON.parse(fs.readFileSync(path.join(capture,'analysis',n+'.json'),'utf8'));
const summary=read('summary');if(!summary.integrity.passed||!summary.integrity.cleanEnd||summary.decoding.partialOrFailed.length)throw Error('Incomplete capture analysis');
const file=path.join(root,'data/official-v305.json'),data=JSON.parse(fs.readFileSync(file,'utf8')),d=decoders(root);
const checked=read('resources').filter(x=>x.path.includes('/js/')||x.originalPaths.some(p=>/cfg\d+\.json$/.test(p))).map(x=>{
 const local=path.join(root,'client',x.path.replace(/^\/resgood\//,''));
 if(!fs.existsSync(local)||crypto.createHash('sha256').update(fs.readFileSync(local)).digest('hex')!==x.sha256)throw Error('Client version mismatch: '+x.path);
 return {path:x.path,sha256:x.sha256};
});if(!checked.length)throw Error('No client-version evidence');
const clean=x=>{const {variants,...v}=x;return {...v,sources:x.sources.map(s=>({...s,capture:s.capture||name}))};};
function canonicalItem(x){
 const item=clean(x),r=new Reader(Buffer.from(item.wireBase64,'base64'));r.getByte();const handbook=r.getBoolean();
 if(handbook){r.getBoolean();for(let n=r.getByte();n>0;n--)r.take(9);const illusion=r.getInt();r.getLong();if(illusion)d.Item.fromBytesAtts2(new d.Item(),r);}
 const definition=Buffer.concat([Buffer.from([item.type&255,0]),r.b.subarray(r.pos)]),v=new d.Item(),check=new Reader(definition);
 d.Item.fromBytesAtts2(v,check);check.finish();if(v.id!==item.id||v.name!==item.name)throw Error('Definition mismatch');
 for(const field of ['wireBase64','illusion','illusionEndTime','illusionItemId','isHandBookActivated','itemInfo'])delete item[field];
 item.definitionBase64=definition.toString('base64');item.handBookItem=false;return item;
}
const conflicts=[];
const recordKey={items:x=>x.id,skills:x=>`${x.id}:${x.level}`,missions:x=>x.id,monsters:x=>x.id,groups:x=>x.groupId,ai:x=>x.id,catalog:x=>x.itemId,areas:x=>x.id,mapList:x=>x.id};
function merge(table,incoming){
 const key=recordKey[table],existing=new Map((data[table]||[]).map(x=>[key(x),x]));
 for(const row of incoming){const id=key(row),old=existing.get(id);if(!old){existing.set(id,row);continue;}
  const sourceKey=s=>`${s.capture||data.sourceCapture}:${s.seq}:${s.origin||''}:${s.mapId??''}:${s.npcId??''}`;
  const sources=new Map([...old.sources||[],...row.sources||[]].map(s=>[sourceKey(s),s]));
  const stable=x=>JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k])=>!['sources','variants','wireBase64'].includes(k))));
  if(stable(old)!==stable(row))conflicts.push({table,id,decision:'existing definition retained; incoming source archived separately'});
  old.sources=[...sources.values()];
 }data[table]=[...existing.values()];
}
for(const table of Object.keys(recordKey))merge(table,read(table).map(table==='items'?canonicalItem:clean));
const allNpcs=read('npcs'),maps=new Map(data.maps.map(m=>[m.id,m]));
for(const s of read('scene-packets').filter(s=>s.complete&&(s.name||s.cityOwnerOmitted))){
 if(maps.has(s.mapId))continue;
 const source=path.resolve(root,'../H5客户端_v305_解析结果_20260920/配置数据/地图',s.mapId+'.json');
 if(!fs.existsSync(source))throw Error('Map geometry missing: '+s.mapId);
 fs.copyFileSync(source,path.join(root,'data/maps',s.mapId+'.json'));
 maps.set(s.mapId,{id:s.mapId,name:s.name||'个人城市',spawn:[s.x,s.y],npcs:allNpcs.filter(n=>n.mapId===s.mapId).map(clean),sourceCapture:name,sourceSeq:s.seq,...(s.cityOwnerOmitted?{cityTemplate:true}:{})});
}
data.maps=[...maps.values()];
data.sourceCaptures??=[{id:data.sourceCapture,startedAt:data.sourceTime}];
if(!data.sourceCaptures.some(x=>x.id===name))data.sourceCaptures.push({id:name,startedAt:summary.sessionStarted,clientFilesVerified:checked.length});
data.newbieCapture=name;
data.newbie={startMap:303,firstMission:1111,routeMaps:[303,4,16,17,11,905],recordedCompleted:read('quest-events').filter(x=>x.completed).map(x=>x.missionId),questEvents:read('quest-events'),battleEvents:read('battle-events')};
const born=read('scene-packets').find(s=>s.complete&&s.mapId===303&&s.archetype?.level===1);
if(!born)throw Error('New character baseline missing');
data.newbie.archetype=born.archetype;data.newbie.starterInventory=born.inventoryDefinitions.filter(i=>i.itemId!==41000);
data.newbie.expTable={[born.archetype.level]:born.archetype.expMax};data.newbie.levelRewards={};
let level=born.archetype.level;
for(const event of [...data.newbie.questEvents,...data.newbie.battleEvents].sort((a,b)=>a.seq-b.seq))if(event.levels>0){
 if(event.levels!==1)throw Error('Cannot infer intermediate level thresholds');
 data.newbie.levelRewards[level]={skillPoints:event.skillPoints,attributePoints:event.attributePoints};
 level+=event.levels;data.newbie.expTable[level]=event.expMax;
}
data.newbie.maxRecordedLevel=level;
const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n');fs.renameSync(tmp,file);
const result={capture:name,clientFilesVerified:checked.length,maps:data.maps.length,counts:Object.fromEntries(Object.keys(recordKey).map(k=>[k,data[k].length])),conflicts};
fs.writeFileSync(path.join(root,'analysis/v05-merge.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));

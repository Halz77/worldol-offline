import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Reader} from './capture-decoders.mjs';

export const GUIDE_PROTOCOL=16005;
const validId=id=>Number.isInteger(id)&&id>=0&&id<=2147483647;
export function guideRequest(id){
 if(!validId(id))throw Error('Invalid guide page ID');
 const b=Buffer.alloc(8);b.writeUInt16BE(8);b.writeUInt16BE(GUIDE_PROTOCOL,2);b.writeInt32BE(id,4);
 return {type:GUIDE_PROTOCOL,reply:GUIDE_PROTOCOL,hex:b.toString('hex')};
}
export function decodeGuide(id,bytes,source={}){
 guideRequest(id);const b=Buffer.from(bytes);
 if(b.length<4||b.readUInt16BE(0)!==b.length||b.readUInt16BE(2)!==GUIDE_PROTOCOL)throw Error('Guide response envelope mismatch');
 const r=new Reader(b.subarray(4)),parentId=r.getInt(),title=r.getString(),count=r.getByte(),entries=[];
 if(parentId < -1||count<0)throw Error('Invalid guide page header');
 for(let n=0;n<count;n++){
  const entry={id:r.getInt(),type:r.getByte(),name:r.getString()};
  if(!validId(entry.id)||![0,1].includes(entry.type))throw Error('Unknown guide entry type');
  if(entry.type===1)entry.content=r.getString();entries.push(entry);
 }
 r.finish();const sha256=crypto.createHash('sha256').update(b).digest('hex');
 return {id,parentId,title,entries,wireBase64:r.b.toString('base64'),sources:[{...source,protocol:GUIDE_PROTOCOL,sha256,blob:`blobs/${sha256.slice(0,2)}/${sha256}.bin`}]};
}
export function mergeGuide(pages,page){
 const old=pages.find(p=>p.id===page.id);
 if(!old){pages.push(page);return;}
 const sources=old.wireBase64===page.wireBase64?[...new Map([...old.sources,...page.sources].map(s=>[JSON.stringify(s),s])).values()]:page.sources;
 const variants=[...(old.variants||[])];
 if(old.wireBase64!==page.wireBase64&&!variants.some(v=>v.wireBase64===old.wireBase64))variants.push({parentId:old.parentId,title:old.title,entries:old.entries,wireBase64:old.wireBase64,sources:old.sources});
 Object.assign(old,page,{sources,...(variants.length?{variants}:{})});
}

// IDs for subsequent queries come exclusively from menus returned by the server.
// The root is read once, then only its career-skill subtree is followed.
export function guideTasks(pages){
 const byId=new Map(pages.map(p=>[p.id,p])),root=byId.get(0);
 if(!root)return [{kind:'guide',id:0,name:'游戏攻略目录'}];
 const career=root.entries.find(e=>e.type===0&&e.name==='职业技能');if(!career)return [];
 const pending=[],seen=new Set(),walk=(id,name)=>{
  if(seen.has(id))return;seen.add(id);if(seen.size>512)throw Error('Guide tree exceeds expected size');
  const page=byId.get(id);if(!page){pending.push({kind:'guide',id,name});return;}
  for(const e of page.entries)if(e.type===0&&e.id!==page.parentId)walk(e.id,name+' / '+e.name);
 };walk(career.id,career.name);return pending;
}
export function guideFields(content){
 const markers=[...content.matchAll(/(效果(?:\d+|二)|需求武器|消耗法力值|消耗生命值|技能类型|攻击次数|持续回合|技能范围|范围|状态)\s*[:：]/g)];
 return markers.map((m,index)=>({label:m[1],value:content.slice(m.index+m[0].length,markers[index+1]?.index??content.length).trim().replace(/[;；]\s*$/,'').trim()}));
}
export function guideSkills(pages,skills=[]){
 const byId=new Map(pages.map(p=>[p.id,p])),records=[];
 for(const page of pages){
  const match=/^(\d+)级(被动|自动|主动)技能效果$/.exec(page.title);if(!match)continue;
  const parent=byId.get(page.parentId);if(!parent||!parent.title.endsWith('技能'))continue;
  const type={被动:1,自动:2,主动:3}[match[2]],level=Number(match[1]);
  for(const entry of page.entries.filter(e=>e.type===1)){
   const fields=guideFields(entry.content),effects=fields.filter(f=>/^效果/.test(f.label)).map(f=>({index:f.label==='效果二'?2:Number(f.label.slice(2)),description:f.value})),parameters=fields.filter(f=>!/^效果/.test(f.label));
   const candidates=[...new Set(skills.filter(s=>s.name===entry.name&&s.type===type).map(s=>s.id))];
   records.push({key:`guide:${page.id}:${entry.id}`,guideEntryId:entry.id,pageId:page.id,profession:parent.title.slice(0,-2),name:entry.name,level,type,category:match[2],content:entry.content,effects,parameters,weaponRequirement:fields.find(f=>f.label==='需求武器')?.value||null,matchingSkillIds:candidates,matchMethod:'exact-name-and-type-only',completeCombatDefinition:false,sources:page.sources});
  }
 }
 return records;
}

// A running journal is a point-in-time snapshot. Only complete lines and
// hash-verified public guide request/response pairs are exported.
export function readGuideCapture(folder){
 const status=JSON.parse(fs.readFileSync(path.join(folder,'status.json'),'utf8')),pending=new Map(),pages=[];
 let responses=0,lastSeq=0,ignoredPartialLine=false;
 const files=fs.readdirSync(path.join(folder,'events')).filter(f=>/^\d+\.ndjson$/.test(f)).sort();
 for(const [fileIndex,file] of files.entries()){
  const text=fs.readFileSync(path.join(folder,'events',file),'utf8'),lines=text.split('\n');
  for(let index=0;index<lines.length;index++){
   if(!lines[index].trim())continue;let row;
   try{row=JSON.parse(lines[index]);}catch(error){if(status.status==='recording'&&fileIndex===files.length-1&&index===lines.length-1){ignoredPartialLine=true;break;}throw error;}
   lastSeq=row.seq;if(!/^Network.webSocketFrame(Sent|Received)$/.test(row.method))continue;
   const ref=row.params.response.payload,b=fs.readFileSync(path.join(folder,ref.file));
   if(b.length<4||b.readUInt16BE(2)!==GUIDE_PROTOCOL)continue;
   if(b.readUInt16BE(0)!==b.length||crypto.createHash('sha256').update(b).digest('hex')!==ref.sha256)throw Error(`Guide frame integrity failure at ${row.seq}`);
   const key=`${row.target}:${row.params.requestId}`;
   if(row.method.endsWith('Sent')){if(b.length!==8)throw Error('Invalid guide request length');const id=b.readInt32BE(4);guideRequest(id);(pending.get(key)||pending.set(key,[]).get(key)).push({id,seq:row.seq});continue;}
   const request=pending.get(key)?.shift();if(!request)throw Error(`Unpaired guide reply at ${row.seq}`);
   const page=decodeGuide(request.id,b,{capture:path.basename(folder),seq:row.seq,requestSeq:request.seq,origin:'official-guide'});mergeGuide(pages,page);responses++;
  }
 }
 return {pages,snapshot:{capture:path.basename(folder),status:status.status,lastSeq,responses,ignoredPartialLine,pendingRequests:[...pending.values()].reduce((n,v)=>n+v.length,0)}};
}

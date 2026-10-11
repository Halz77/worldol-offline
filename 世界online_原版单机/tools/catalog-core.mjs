import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Reader,decoders,protobufSchemas,protobuf} from './capture-decoders.mjs';
import {guideRequest,decodeGuide,mergeGuide,guideTasks,guideSkills} from './guide-core.mjs';

export const root=fileURLToPath(new URL('..',import.meta.url));
const guideFile=path.join(root,'data/official-guides.json');
const recordedGuides=fs.existsSync(guideFile)?JSON.parse(fs.readFileSync(guideFile,'utf8')).pages:[];
const guides=state=>[...new Map([...recordedGuides,...(state.guidePages||[])].map(p=>[p.id,p])).values()];
const d=decoders(root),schemas=protobufSchemas(fs.readFileSync(path.join(root,'analysis/protobuf.decoded.js'),'utf8'));
const publicFields=['itemId','name','icon','bagIcon','info','type','grade','fashIcons','effectId','price'];
const rangeFields=/^(?:power[1-7]|bindPower[12])$/;
export const key=q=>q.kind==='catalog'?`catalog:${q.group}:${q.type}`:`${q.kind}:${q.id}`;
export const isEquipment=i=>i.sources?.some(s=>s.group===1||s.group===2||s.group===11||s.group===3&&s.type===41);
export const needsRanges=i=>i.isUpgradeItem||Object.entries(i).some(([k,v])=>rangeFields.test(k)&&[d.constants.POWER_IDENTIFY,d.constants.POWER_COMPOSITE].includes(v));
const vi=n=>{const a=[];do{let b=n&127;n>>>=7;if(n)b|=128;a.push(b);}while(n);return a;};
export function request(q){
  if(q.kind==='guide')return guideRequest(q.id);
  let type,reply,payload;
  if(q.kind==='catalog'&&Number.isInteger(q.group)&&Number.isInteger(q.type)&&q.group>=0&&q.group<=127&&q.type>=0&&q.type<=127){type=32101;reply=32102;payload=Buffer.from([8,...vi(q.group),16,...vi(q.type)]);}
  else if(['item','identify'].includes(q.kind)&&Number.isInteger(q.id)&&q.id>0&&q.id<=2147483647){type=q.kind==='item'?16051:12060;reply=type;payload=Buffer.alloc(4);payload.writeInt32BE(q.id);}
  else if(q.kind==='skills'&&Number.isInteger(q.id)&&q.id>0&&q.id<=10000){type=14001;reply=type;payload=Buffer.alloc(2);payload.writeInt16BE(q.id);}
  else throw Error('Only validated catalogue, item, attribute-preview, skill-list and guide requests are supported');
  const b=Buffer.alloc(4+payload.length);b.writeUInt16BE(b.length);b.writeUInt16BE(type,2);payload.copy(b,4);return {hex:b.toString('hex'),type,reply};
}
export function decode(q,bytes,source={}){
  const b=Buffer.from(bytes),req=request(q);if(b.length<4||b.readUInt16BE(0)!==b.length||b.readUInt16BE(2)!==req.reply)throw Error('Response envelope mismatch');
  const sha256=crypto.createHash('sha256').update(b).digest('hex');source={...source,protocol:req.reply,sha256,blob:`blobs/${sha256.slice(0,2)}/${sha256}.bin`};
  const r=new Reader(b.subarray(4));
  if(q.kind==='guide')return {kind:q.kind,page:decodeGuide(q.id,b,{...source,origin:'official-guide'}),source};
  if(q.kind==='catalog'){
    const page=protobuf(r.b,'s2c_HandBookInfo',schemas);if(page.group!==q.group||page.type!==q.type)throw Error('Catalogue category mismatch');
    return {kind:q.kind,group:q.group,type:q.type,items:(page.itemInfos||[]).map(x=>({...Object.fromEntries(publicFields.filter(k=>x.info?.[k]!==undefined).map(k=>[k,x.info[k]])),sources:[{...source,group:q.group,type:q.type,sort:x.sort}]})),source};
  }
  if(q.kind==='item'){
    const item=new d.Item();d.Item.fromBytesAtts2(item,r);const definitionEnd=r.pos;
    // v305's handbook handler returns after fromBytesAtts2. Pet equipment
    // previews carry six further bytes which it does not consume. Preserve
    // them as opaque preview metadata, not as part of a bag item definition.
    let previewTrailerBase64;
    if(item.type===d.constants.ITEM_TYPE_PET_EQUIP&&r.b.length-r.pos===6)previewTrailerBase64=r.raw(6).toString('base64');
    r.finish();if(item.id!==q.id)throw Error('Item ID mismatch');
    const clean=new Reader(r.b);clean.getByte();if(clean.getBoolean()){clean.getBoolean();for(let n=clean.getByte();n>0;n--)clean.take(9);const illusion=clean.getInt();clean.getLong();if(illusion)d.Item.fromBytesAtts2(new d.Item(),clean);}
    const wire=Buffer.concat([Buffer.from([item.type&255,0]),r.b.subarray(clean.pos,definitionEnd)]),canonical=new d.Item(),check=new Reader(wire);d.Item.fromBytesAtts2(canonical,check);check.finish();
    return {kind:q.kind,item:{...canonical,...(previewTrailerBase64?{previewTrailerBase64}:{}),definitionBase64:wire.toString('base64'),sources:[source]},source};
  }
  if(q.kind==='identify'){
    let petScale,petLevel;if(q.pet){petScale=r.getString();petLevel=r.getInt();}
    const count=r.getShort(),slots=[];if(count<0||count>9)throw Error('Invalid identification group count');
    for(let i=0;i<count;i++){const field=r.getString(),n=r.getShort(),options=[];if(!rangeFields.test(field)||n<0||n>1000)throw Error('Invalid identification slot');for(let j=0;j<n;j++){const power=r.getShort(),min=r.getShort(),max=r.getShort();if(min>max)throw Error('Inverted attribute range');options.push({power,min,max});}slots.push({field,options});}r.finish();
    return {kind:q.kind,itemId:q.id,slots,...(q.pet?{petScale,petLevel}:{}),wireBase64:r.b.toString('base64'),sources:[source]};
  }
  const shopId=r.getShort(),count=r.getByte();if(shopId!==q.id)throw Error('Skill shop ID mismatch');if(count<0){const message=r.getString();r.finish();throw Error('Server: '+message);}
  const skillMax=count?r.getByte():0,skills=[];for(let i=0;i<count;i++){const skill=d.Skill.fromShopBytes(r);skill.maxLevel=r.getByte();skills.push({...skill,sources:[{...source,origin:'shop',shopId}]});}r.finish();return {kind:q.kind,shopId,skillMax,skills,source};
}
export function initialState(official){return {schema:1,clientVersion:305,scope:'Official catalogue-visible equipment and server-visible skill levels',done:{},failed:{},catalog:official.catalog,items:[],identification:[],skillShops:[],skillDefinitions:[],createdAt:new Date().toISOString()};}
export function applyResult(state,q,result){
  const merge=(name,rows,id)=>{const m=new Map((state[name]||[]).map(x=>[id(x),x]));for(const row of rows){const old=m.get(id(row));m.set(id(row),old?.sources&&row.sources?{...row,sources:[...new Map([...old.sources,...row.sources].map(s=>[JSON.stringify(s),s])).values()]}:row);}state[name]=[...m.values()];};
  if(q.kind==='catalog')merge('catalog',result.items,x=>x.itemId);
  if(q.kind==='item')merge('items',[result.item],x=>x.id);
  if(q.kind==='identify')merge('identification',[result],x=>x.itemId);
  if(q.kind==='skills'){merge('skillShops',[result],x=>x.shopId);merge('skillDefinitions',result.skills,x=>`${x.id}:${x.level}`);}
  if(q.kind==='guide'){state.guidePages??=[];mergeGuide(state.guidePages,result.page);}
  state.done[key(q)]={at:new Date().toISOString(),source:result.source||result.sources?.[0]};delete state.failed[key(q)];
}
export function tasks(state,official){
  const known=new Map([...official.items,...state.items].map(i=>[i.id,i]));
  const ranges=new Set([...(official.identification||[]),...state.identification].map(x=>x.itemId));
  const shops=new Set(official.maps.flatMap(m=>m.npcs.flatMap(n=>n.teacherId||[])));for(const s of official.skills)for(const src of s.sources||[])if(src.shopId)shops.add(src.shopId);
  const pages=official.handbookGroups.infos.flatMap(g=>g.info.map(t=>({kind:'catalog',group:g.group,type:t.type})));
  const skillQueries=[...shops].sort((a,b)=>a-b).map(id=>({kind:'skills',id}));
  const details=state.catalog.filter(isEquipment).filter(i=>!known.has(i.itemId)).map(i=>({kind:'item',id:i.itemId,name:i.name}));
  const previews=[...known.values()].filter(needsRanges).filter(i=>!ranges.has(i.id)).map(i=>({kind:'identify',id:i.id,name:i.name,pet:i.type===d.constants.ITEM_TYPE_PET_EQUIP}));
  return [...guideTasks(guides(state)),...pages,...skillQueries,...previews,...details].filter(q=>!state.done[key(q)]&&!state.failed[key(q)]);
}
export function coverage(state,official){
  const items=new Map([...official.items,...state.items].map(i=>[i.id,i])),catalog=state.catalog.filter(isEquipment),ranges=new Set([...(official.identification||[]),...state.identification].map(x=>x.itemId));
  const required=[...items.values()].filter(needsRanges),skillRows=new Map([...official.skills,...(state.skillDefinitions||[]),...state.skillShops.flatMap(s=>s.skills)].map(s=>[`${s.id}:${s.level}`,s]));
  const guidePages=guides(state);return {catalogEquipment:catalog.length,equipmentDetails:catalog.filter(i=>items.has(i.itemId)).length,totalItemDetails:items.size,identificationNeeded:required.length,identificationKnown:required.filter(i=>ranges.has(i.id)).length,skillDefinitions:skillRows.size,skillIds:new Set([...skillRows.values()].map(x=>x.id)).size,guidePages:guidePages.length,guideSkillDescriptions:guideSkills(guidePages).length,guideRemaining:guideTasks(guidePages).length,remaining:tasks(state,official).length,failed:Object.keys(state.failed).length,allServerEquipmentKnown:false,allSkillLevelsKnown:false};
}

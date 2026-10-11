import {starRules,gemRules} from '../lib/equipment-policy.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Reader,decoders} from './capture-decoders.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const official=JSON.parse(fs.readFileSync(path.join(root,'data/official-v305.json'),'utf8'));
const all=process.argv.includes('--all'),ids=all?official.items.filter(i=>i.ascensionStar!==undefined&&i.type!==41).map(i=>i.id):process.argv.slice(2).map(Number);
if(!ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error('Supply recorded item IDs or --all');
const file=path.join(root,'data/item-affix-layouts.json');
const layouts=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{schema:1,clientVersion:305,items:{}};
const d=decoders(root);
let skillSegments=[];
const nativeItemSkill=d.Skill.fromBaseBytesForItem;
d.Skill.fromBaseBytesForItem=(reader,skill)=>{const start=reader.pos;nativeItemSkill(reader,skill);skillSegments.push({id:skill.id,level:skill.level,start,end:reader.pos,wireBase64:reader.b.subarray(start,reader.pos).toString('base64')});};
for(const id of ids){
  const source=official.items.find(row=>row.id===id);if(!source)throw Error('Unknown item '+id);
  const bytes=Buffer.from(source.definitionBase64,'base64'),reader=new Reader(bytes),offsets={};let skillDescEnd;
  skillSegments=[];
  const item=new Proxy(new d.Item(),{set(target,key,value){
    if(/^(power[123]|powerValue[123]|bindPower[12]|bindPowerValue[12]|def_str|def_agi|def_mag|atkMin|atkMax|enchantPower[12]|enchantPowerValue[12]|enchantLevel)$/.test(key)){
      const offset=reader.pos-2;assert.equal(bytes.readInt16BE(offset),value);offsets[key]=offset;
    }
    if(key==='star'){assert.equal(bytes.readInt8(reader.pos-1),value);offsets.star=reader.pos-1;}
    if(key==='attachCount'){assert.equal(bytes.readInt8(reader.pos-1),value);offsets.attachCount=reader.pos-1;}
    if(key==='skillDesc')skillDescEnd=reader.pos;
    return Reflect.set(target,key,value);
  }});
  d.Item.fromBytesAtts2(item,reader);reader.finish();assert.equal(item.id,id);
  for(const key of Object.keys(offsets))assert.equal(item[key],source[key]);
  const skillFlagOffset=offsets.powerValue3+2;
  const originalSkill=skillSegments.find(s=>s.start===skillFlagOffset+1);
  const combinationSkill=source.combinUpSkillList?.length?{flagOffset:skillFlagOffset,skillEnd:source.skill?originalSkill?.end:skillFlagOffset+1,descOffset:skillDescEnd-3-Buffer.byteLength(source.skillDesc,'utf16le'),descEnd:skillDescEnd,options:[...new Map(skillSegments.filter(s=>source.combinUpSkillList.some(t=>t.id===s.id&&t.level===s.level)).map(({id,level,wireBase64})=>[id+':'+level,{id,level,wireBase64}])).values()]}:null;
  if(combinationSkill){assert.equal(bytes[skillFlagOffset],source.skill?1:0);assert.ok(Number.isInteger(combinationSkill.skillEnd));}
  layouts.items[id]={name:source.name,definitionSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),offsets,combinationSkill,...(source.skill?{nativeSkillWireBase64:originalSkill?.wireBase64}: {})};
}
fs.writeFileSync(file,JSON.stringify(layouts,null,2)+'\n');
if(all){
 const isAscension=d.native(32,'isAscension',{a:{default:d.constants}});
 const excluded=[...new Set(Object.entries(d.constants).filter(([name,value])=>name.startsWith('POWER_')&&Number.isInteger(value)&&!isAscension(value)).map(([,value])=>value))].sort((a,b)=>a-b);
 fs.writeFileSync(path.join(root,'data/equipment-upgrade-rules.json'),JSON.stringify({version:'equipment-upgrades-v2',mode:'local',identify:{scrolls:[40001,40000],distribution:'uniform-recorded-range',fields:['power1','power2','bindPower1','bindPower2']},star:starRules,gem:gemRules,starExcludedPowers:excluded},null,2)+'\n');
}
console.log(JSON.stringify({file,items:Object.keys(layouts.items).length}));

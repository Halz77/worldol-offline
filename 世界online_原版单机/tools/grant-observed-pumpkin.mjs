import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {decoders,Reader} from './capture-decoders.mjs';
import * as blocks from './capture-public-blocks.mjs';
import {petFromRecord} from '../lib/recorded-content.mjs';
import {firstFree} from '../lib/restoration.mjs';
import {petAttributes} from '../lib/pet-state.mjs';
import {Writer} from '../lib/codec.mjs';
import {petDetail,petItemPacket} from '../lib/pet-packets.mjs';
import {normalizeRole} from '../lib/content.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url);
const {readPetDetail}=require(path.resolve(root,'../正式服录制工具/lib/pets.cjs'));
const file=path.join(root,'qa-v05-saves/world.json'),apply=process.argv.includes('--apply');
const expectedHash=process.argv[process.argv.indexOf('--expected-sha')+1];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(apply){let online=false;try{online=(await fetch('http://127.0.0.1:8779/api/status',{signal:AbortSignal.timeout(1500)})).ok;}catch{}if(online)throw Error('Stop main service before modifying its save');}
const bytes=fs.readFileSync(file),beforeHash=hash(bytes),data=JSON.parse(bytes),before=structuredClone(data);
if(apply&&expectedHash?.toLowerCase()!==beforeHash)throw Error('Save hash differs from guarded backup');
const role=data.characters.find(p=>p.id===1001),account=data.accounts.find(a=>a.id===role?.accountId);
if(account?.name!=='xia-v05-qa'||role?.level!==97)throw Error('Expected main role missing');
const source={capture:'2026-09-21T03-25-20-121Z_8d8469',seq:11335,protocol:15512,sha256:'df092bd323286e7f4bb46a4add449db159870ce0466b22b55c8e39fc9d8f9aef'};
const payload=fs.readFileSync(path.resolve(root,'../正式服录制数据',source.capture,'blobs',source.sha256.slice(0,2),source.sha256+'.bin'));
if(hash(payload)!==source.sha256||payload.readUInt16BE(0)!==payload.length||payload.readUInt16BE(2)!==source.protocol)throw Error('Captured pet packet failed integrity check');
const d=decoders(root),r=new Reader(payload.subarray(4));assert.equal(r.getByte(),0);
const captured=readPetDetail(r,d,blocks,{publicName:true});r.finish();
assert.equal(captured.model,746);assert.equal(captured.level,97);assert.equal(captured.growLevel,29);assert.equal(captured.skills.length,28);
const grantKey='captured-pet:'+source.sha256;
let item=role.inventory.find(i=>i.pet?.grantKey===grantKey),created=false;
if(!item){
 const slot=firstFree(role);if(slot===undefined)throw Error('No free bag slot');
 const nextIndex=(role.nextPetIndex||0)+1,pet=petFromRecord({...captured,id:captured.model});
 Object.assign(pet,{uid:String(role.id*10000+nextIndex),grantKey,grantCreatedAt:Date.now(),recordedSource:source});
 item={itemId:24,slot,quantity:1,pet};role.inventory.push(item);role.nextPetIndex=nextIndex;created=true;
}
const pet=item.pet;
pet.recordedSnapshotVitals={hpMax:93014,mpMax:40610,source:'user-provided pet detail screenshot; current HP/MP confirmed at full',packetSHA256:source.sha256};
// Native wire round-trip: effective levels already include addLevel, never add twice.
const roundTrip=new Reader(petDetail(new Writer(),pet).done()),decoded=readPetDetail(roundTrip,d,blocks,{publicName:true});roundTrip.finish();
for(const key of Object.keys(captured)){
 if(key==='lifeMs')continue;
 if(key==='skillBonuses'){assert.deepEqual([...decoded[key]].sort((a,b)=>a.id-b.id),[...captured[key]].sort((a,b)=>a.id-b.id));continue;}
 assert.deepEqual(decoded[key],captured[key],`Captured pet field ${key} changed`);
}
assert.ok(Math.abs(Number(decoded.lifeMs)+Date.now()-pet.grantCreatedAt-Number(captured.lifeMs))<5000);
const nativeRead=d.native(42,'fromBytesDetail',{n:{default:{timer:{serverTime:0}}},a:{default:{processDataPlayerSkillMsg(r){return Array.from({length:r.getShort()},()=>d.Skill.fromBytes(r));}}},E:{default:{PET_BAG_SIZE:8}}});
const nativeBytes=new Reader(petDetail(new Writer(),pet).done()),nativePet={bag:{store:[]}};assert.equal(nativeRead(nativeBytes,nativePet),0);nativeBytes.finish();
assert.equal(nativePet.skillList.length,28);assert.equal(nativePet.skillList.find(s=>s.id===969).addLevel,13);assert.equal(nativePet.skillList.find(s=>s.id===953).addLevel,16);
const inv=new Reader(petItemPacket(new Writer(),item).done());inv.take(18);const nativeItem=new d.Item();d.Item.fromBytesAtts2(nativeItem,inv);inv.finish();assert.equal(nativeItem.name,pet.name);assert.equal(nativeItem.reqLv,97);
const reloaded=JSON.parse(JSON.stringify(role));normalizeRole(reloaded);assert.deepEqual(reloaded,role);
const allowed=structuredClone(before);allowed.characters.find(p=>p.id===1001).inventory=role.inventory;allowed.characters.find(p=>p.id===1001).nextPetIndex=role.nextPetIndex;assert.deepEqual(data,allowed);
if(created)assert.deepEqual(role.inventory.filter(i=>i!==item),before.characters.find(p=>p.id===1001).inventory);
const receipt={at:new Date().toISOString(),mode:apply?'applied':'preview',created,account:account.name,role:role.id,slot:item.slot,uid:pet.uid,name:pet.name,source,beforeHash,captured:{level:pet.level,grow:pet.grow,comprehension:pet.comprehension,growLevel:pet.growLevel,hp:pet.hp,mp:pet.mp,sp:pet.sp,cp:pet.cp,skills:pet.skills.map(s=>({id:s.id,name:s.name,level:s.level,addLevel:s.addLevel||0})),autoSkills:pet.autoSkills,initiativeSkill:pet.initiativeSkill},localDerived:petAttributes(role,pet)};
if(apply&&!isSameData()){if(hash(fs.readFileSync(file))!==beforeHash)throw Error('Save changed during grant validation');const output=Buffer.from(JSON.stringify(data,null,2)+'\n');fs.writeFileSync(file+'.pet-grant-tmp',output);fs.renameSync(file+'.pet-grant-tmp',file);receipt.afterHash=hash(output);assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),data);}
fs.writeFileSync(path.join(root,apply?'analysis/pumpkin-pet-grant.json':'analysis/pumpkin-pet-grant-preview.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({mode:receipt.mode,created,role:role.id,slot:item.slot,name:pet.name,level:pet.level,growLevel:pet.growLevel,skills:pet.skills.length,hp:pet.hp,mp:pet.mp,localDerived:receipt.localDerived}));
function isSameData(){return JSON.stringify(data)===JSON.stringify(before);}

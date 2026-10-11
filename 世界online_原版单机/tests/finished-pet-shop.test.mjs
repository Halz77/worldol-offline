import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {recorded,recordedFinishedPets,petBuildSignature} from '../lib/recorded-content.mjs';
import {recordedDirectory,handleRecorded} from '../lib/recorded-service.mjs';
import {handlePetItems} from '../lib/pet-service.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {activePet} from '../lib/pet-state.mjs';
import {petDetail} from '../lib/pet-packets.mjs';
import {Writer,Reader} from '../lib/codec.mjs';
import {SaveStore} from '../lib/store.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
const parsePet=d.native(42,'fromBytesDetail',{n:{default:{timer:{serverTime:0}}},a:{default:{processDataPlayerSkillMsg(r){return Array.from({length:r.getShort()},()=>d.Skill.fromBytes(r));}}},f:{default:{fromBytes(r){r.take(18);const item=new d.Item();d.Item.fromBytesAtts2(item,r);return item;}}},E:{default:{PET_BAG_SIZE:8}}});
function role(){const p=normalizeRole({id:1001,name:'成品宠物验收',level:97,job:1,race:0,sex:1,mapId:1});p.inventory=[];p.bagLimit=90;return p;}
function call(p,type,w,save=()=>{}){let response;const context={role:p},env={store:{save},send(t,w){if(t===type)response=w.done();},log(){}};assert.ok(handleRecorded(type,new Reader(w.done()),context,env)||handlePetItems(type,new Reader(w.done()),context,env));return new Reader(response);}
test('recent pet captures are verified, additive, and all observed max-level builds are purchasable',()=>{
 assert.ok(recorded.petImports.length>=7);assert.ok(recorded.petImports.every(c=>c.integrityPassed&&c.cleanEnd&&c.parseErrors===0));
 assert.ok(recorded.pets.length>=143);assert.ok(recorded.petSnapshots.length>=50);assert.ok(recorded.petSkills.length>=456);
 const shop=recordedDirectory().finishedPets;assert.equal(shop.length,recordedFinishedPets.size);assert.ok(shop.length>=13);
 assert.equal(new Set(shop.map(p=>p.id)).size,shop.length);assert.ok(shop.some(p=>p.speciesName==='小浣熊（进化）'));assert.ok(shop.some(p=>p.speciesName==='暴走南瓜（进化）'));
 for(const p of recorded.petSnapshots.filter(p=>p.level===97&&p.model>0))assert.ok([...recordedFinishedPets.values()].some(s=>petBuildSignature(s)===petBuildSignature(p)));
 assert.ok(shop.every(p=>p.skills.every(s=>!s.wireBase64)&&!p.sources));
});
test('every finished build purchases, parses with native client, equips, and preserves exact recorded skills and equipment',()=>{
 const p=role(),currency=[p.gold,p.silver,p.coins];let saves=0;
 for(const template of recordedFinishedPets.values()){
  const r=call(p,90004,new Writer().int(template.id),()=>saves++);assert.equal(r.byte(),0);
  const wire=new NativeReader(r.b.subarray(r.pos));wire.take(18);const nativeItem=new d.Item();d.Item.fromBytesAtts2(nativeItem,wire);wire.finish();
  const item=p.inventory.find(i=>i.pet?.uid===nativeItem.petId.toJSON());assert.ok(item);assert.equal(item.pet.model,template.model);assert.deepEqual(item.pet.skills,template.skills);assert.deepEqual(item.pet.baseStats,Object.values(template.attributes));
  assert.deepEqual(item.pet.equipment.map(e=>({slot:e.slot,itemId:e.itemId})),template.equipment);assert.ok(item.pet.expiresAt>Date.now()+99*86400000);
  const equip=call(p,12001,new Writer().byte(2).byte(1).short(item.slot).int(1).byte(-1).bool(false).byte(32));assert.equal(equip.byte(),2);assert.equal(activePet(p),item.pet);
  const n=new NativeReader(petDetail(new Writer(),item.pet).done()),decoded={bag:{store:[]}};assert.equal(parsePet(n,decoded),0);n.finish();assert.equal(decoded.level,97);assert.equal(decoded.skillList.length,template.skills.length);assert.deepEqual(Array.from(decoded.autoSkillID),template.autoSkills);
 }
 assert.equal(saves,recordedFinishedPets.size);assert.deepEqual([p.gold,p.silver,p.coins],currency);
 assert.equal(new Set(p.inventory.map(i=>i.pet.uid)).size,p.inventory.length);
});
test('failed saves, capacity, level and unknown offers do not change inventory or pet index',()=>{
 const p=role(),id=recordedFinishedPets.keys().next().value,initial=structuredClone(p);
 assert.equal(call(p,90004,new Writer().int(id),()=>{throw Error('disk full');}).byte(),-1);assert.deepEqual(p,initial);
 p.level=96;const low=structuredClone(p);assert.equal(call(p,90004,new Writer().int(id)).byte(),-1);assert.deepEqual(p,low);
 p.level=97;p.bagLimit=1;p.inventory=[{itemId:40003,quantity:99,slot:30}];const full=structuredClone(p);assert.equal(call(p,90004,new Writer().int(id)).byte(),-1);assert.deepEqual(p,full);
 assert.equal(call(p,90004,new Writer().int(-999999)).byte(),-1);assert.deepEqual(p,full);
});
test('purchases allocate independent pet IDs, renew expired samples, and persist through a real store reload',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-finished-pets-'));
 try{
  const db=new SaveStore(dir),p=role();db.data.characters=[p];
  const template=[...recordedFinishedPets.values()].find(p=>Number(p.lifeMs)<0);assert.ok(template);
  call(p,90004,new Writer().int(template.id),()=>db.save());p.nextPetIndex=0;call(p,90004,new Writer().int(template.id),()=>db.save());
  assert.notEqual(p.inventory[0].pet.uid,p.inventory[1].pet.uid);assert.notEqual(p.inventory[0].pet.skills,p.inventory[1].pet.skills);
  const item=p.inventory[1];assert.equal(call(p,12001,new Writer().byte(2).byte(1).short(item.slot).int(1).byte(-1).bool(false).byte(32),()=>db.save()).byte(),2);
  const restored=new SaveStore(dir).data.characters[0];assert.deepEqual(restored.inventory,p.inventory);assert.equal(activePet(restored).templateId,template.id);
 }finally{const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-finished-pets-'));fs.rmSync(exact,{recursive:true});}
});

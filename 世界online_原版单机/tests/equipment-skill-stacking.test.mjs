import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {activeSkills,powers,unequip,skills} from '../lib/restoration.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {skillList} from '../lib/restoration-packets.mjs';
import {SaveStore} from '../lib/store.mjs';
import {Writer,Reader as ProtocolReader} from '../lib/codec.mjs';
import {decoders,Reader} from '../tools/capture-decoders.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
const ring=(slot,bound=true)=>({itemId:11648,slot,quantity:1,bound,combinedSkill:{id:111,level:11}});
const role=()=>({id:1001,level:97,baseStats:[48,9,9,5,4],hp:100,mp:100,coins:1000,skills:{},autoSkillIds:[0,0,0,0],initiativeSkillId:-1,inventory:[ring(2),ring(16)]});
const skill=p=>activeSkills(p).find(s=>s.id===111);
const decodeList=r=>{const list=[];for(let count=r.getShort();count>0;count--){const s=d.Skill.fromBytes(r);s.addLevel=r.getByte();list.push(s);}return list;};

test('two MJ rings stack to the actual level-22 effect and one equipped ring remains level 11',()=>{
 const p=role(),before=structuredClone(p),s=skill(p);assert.equal(s.level,22);assert.equal(s.addLevel,22);
 assert.deepEqual(s.powers,[[57,105],[11,900],[27,20]]);assert.equal(powers(p,'skill')(11),900);
 const r=new Reader(skillList(new Writer(),p).done()),native=decodeList(r);r.finish();
 assert.equal(native.length,1);assert.equal(native[0].level,22);assert.equal(native[0].addLevel,22);assert.equal(native[0].powerValue2,900);
 assert.equal(d.native(56,'getSkillLevelByID').call({getSkillByID:()=>native[0]},111),0,'equipment levels do not become learned levels');
 assert.deepEqual(p,before);
 unequip(p,16);assert.equal(skill(p).level,11);assert.equal(skill(p).addLevel,11);assert.equal(powers(p,'skill')(11),220);
 unequip(p,2);assert.equal(skill(p),undefined);assert.equal(powers(p,'skill')(11),0);assert.equal(p.skills[111],undefined);
});

test('bound and unbound equipped copies contribute equally; backpack copies do not and learned levels add once',()=>{
 const p=role();p.skills[111]=5;p.inventory=[ring(2,false)];
 assert.equal(skill(p).level,16);assert.equal(skill(p).addLevel,11);assert.equal(powers(p,'skill')(11),380);
 p.inventory.push(ring(30));assert.equal(skill(p).level,16,'backpack copy does not contribute');
 p.inventory.push(ring(16,false));assert.equal(skill(p).level,22);assert.equal(skill(p).addLevel,17,'supported level-22 data caps the effective bonus');
 const unbound=skill(p);p.inventory.filter(i=>i.slot<30).forEach(i=>i.bound=true);assert.deepEqual(skill(p),unbound,'binding does not change equipped skill levels');
 const expected=skill(p);p.inventory.reverse();assert.deepEqual(skill(p),expected);
 p.skills[111]=22;assert.equal(skill(p).level,22);assert.equal(skill(p).addLevel,0);assert.equal(powers(p,'skill')(11),900);
 assert.equal(skills.get(111).levels.find(s=>s.level===11).powerValue2,220,'catalogue source remains unchanged');
});

test('binding preserves already active skills; unequip refreshes stacked levels and source items survive disk reload',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-skill-stacking-'));
 try{
  const store=new SaveStore(dir),account=store.account('ring-test'),p=store.create(account,{name:'双戒指验收',sex:1,race:0,job:1});
  Object.assign(p,role());p.inventory[1].bound=false;
  assert.equal(skill(p).level,22);
  const sent=[],call=(type,w)=>{sent.length=0;assert.equal(handleRestoration(type,new ProtocolReader(w.done()),{role:p},{store,send:(type,w)=>sent.push({type,bytes:w.done()}),log(){}}),true);return new Reader(sent[0].bytes);};
  assert.equal(call(12001,new Writer().byte(7).byte(7).short(16).int(1).bool(false).byte(0)).getByte(),7);
  const update=sent.find(s=>s.type===14011);assert.ok(update);const nr=new Reader(update.bytes),list=decodeList(nr);assert.equal(list[0].level,22);assert.equal(list[0].addLevel,22);
  for(let count=nr.getByte();count>0;count--)nr.getShort();nr.getShort();nr.finish();
  const loaded=new SaveStore(dir).data.characters[0];assert.equal(skill(loaded).level,22);assert.deepEqual(loaded.inventory,p.inventory);assert.equal(loaded.skills[111],undefined);
  const client={list:new Map([[111,list[0]]]),learnSkill(s){this.list.set(s.id,s);},getSkillByID(id){return this.list.get(id);},removeSkill(s){this.list.delete(s.id);}};
  const removed=call(12001,new Writer().byte(17).byte(2).short(16).int(1).bool(false).byte(0));assert.equal(removed.getByte(),17);
  d.native(56,'fromSkillData',{l:{default:d.Skill}}).call(client,removed);removed.finish();assert.equal(client.list.get(111).level,11);assert.equal(client.list.get(111).addLevel,11);
  assert.equal(skill(new SaveStore(dir).data.characters[0]).level,11);
 }finally{
  const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-skill-stacking-'));fs.rmSync(exact,{recursive:true});
 }
});

test('learning and forgetting a base skill keep the effective equipment contribution in native replies',()=>{
 const p=role();p.inventory=[ring(2)];p.skills[111]=4;const sent=[];
 const call=(type,w)=>{sent.length=0;handleRestoration(type,new ProtocolReader(w.done()),{role:p},{store:{save(){}},send:(type,w)=>sent.push({type,bytes:w.done()}),log(){}});return new Reader(sent[0].bytes);};
 const r=call(14002,new Writer().short(1306).int(111).byte(5).bool(false));assert.equal(r.getByte(),0);assert.equal(r.getInt(),111);r.take(16);
 assert.equal(r.getByte(),1);d.Skill.fromBytes(r);r.take(12);assert.equal(r.getBoolean(),true);
 const learned=d.Skill.fromBytes(r);assert.equal(learned.level,16);assert.equal(r.getByte(),11);r.finish();assert.equal(p.skills[111],5);
 assert.equal(call(14003,new Writer().int(111).byte(0)).getByte(),0);
 const refresh=sent.find(s=>s.type===14011);assert.ok(refresh);const after=decodeList(new Reader(refresh.bytes));assert.equal(after[0].level,11);assert.equal(after[0].addLevel,11);assert.equal(p.skills[111],undefined);
});

test('unbound automatic and active equipment skills can be selected, survive reload and are removed on unequip',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-skill-stacking-'));
 try{
  const store=new SaveStore(dir),account=store.account('unbound-skills'),p=store.create(account,{name:'未绑定技能',sex:1,race:0,job:1});
  Object.assign(p,role(),{inventory:[
   {itemId:31157,slot:15,quantity:1,combinedSkill:{id:6518,level:22}},
   {itemId:28011,slot:8,quantity:1,bound:false,combinedSkill:{id:4007,level:22}}
  ]});
  const inventory=structuredClone(p.inventory),sent=[],call=(type,w)=>{
   sent.length=0;const reader=new ProtocolReader(w.done());
   assert.equal(handleRestoration(type,reader,{role:p},{store,send:(type,w)=>sent.push({type,bytes:w.done()}),log(){}}),true);
   assert.equal(reader.pos,reader.b.length);return new Reader(sent.find(s=>s.type===type).bytes);
  };
  const r=new Reader(skillList(new Writer(),p).done()),list=decodeList(r);r.finish();
  assert.deepEqual(list.map(s=>[s.id,s.type,s.level,s.addLevel]),[[6518,2,22,22],[4007,3,22,22]]);
  assert.equal(list[0].name,'星流冰寒');assert.equal(p.skills[6518],undefined);
  assert.equal(call(14004,new Writer().byte(0).int(6518)).getByte(),0);
  assert.equal(call(14009,new Writer().byte(0).int(4007)).getByte(),0);
  const reloaded=new SaveStore(dir).data.characters[0];
  assert.deepEqual(reloaded.inventory,inventory);assert.equal(reloaded.autoSkillIds[0],6518);assert.equal(reloaded.initiativeSkillId,4007);
  assert.deepEqual(activeSkills(reloaded).map(s=>s.id),[6518,4007]);
  const client={list:new Map(list.map(s=>[s.id,s])),autoSkillID:[6518,0,0,0],autoSkillID_Initiative:4007,learnSkill(s){this.list.set(s.id,s);},getSkillByID(id){return this.list.get(id);},removeSkill(s){this.list.delete(s.id);}};
  const nativeChanges=d.native(56,'fromSkillData',{l:{default:d.Skill}});
  for(const slot of [15,8]){
   const response=call(12001,new Writer().byte(17).byte(2).short(slot).int(1).bool(false).byte(0));assert.equal(response.getByte(),17);nativeChanges.call(client,response);response.finish();
  }
  assert.equal(client.list.size,0);assert.deepEqual(Array.from(client.autoSkillID),[0,0,0,0]);assert.equal(client.autoSkillID_Initiative,-1);
  assert.deepEqual(p.autoSkillIds,[0,0,0,0]);assert.equal(p.initiativeSkillId,-1);assert.deepEqual(activeSkills(p),[]);
  assert.equal(call(14004,new Writer().byte(0).int(6518)).getByte(),-1);
  assert.equal(new SaveStore(dir).data.characters[0].inventory.every(i=>i.slot>=30&&!i.bound),true);
 }finally{
  const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-skill-stacking-'));fs.rmSync(exact,{recursive:true});
 }
});

test('native equipment skills without composition also work while unbound and do not become learned skills',()=>{
 const p=role();p.inventory=[{itemId:20357,slot:8,quantity:1},{itemId:20049,slot:10,quantity:1}];
 const before=structuredClone(p),list=activeSkills(p);assert.deepEqual(list.map(s=>[s.id,s.type,s.addLevel]),[[337,2,1],[342,3,1]]);assert.deepEqual(p,before);
 unequip(p,8);assert.deepEqual(activeSkills(p).map(s=>s.id),[342]);unequip(p,10);assert.deepEqual(activeSkills(p),[]);assert.deepEqual(p.skills,{});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Reader,decoders} from '../tools/capture-decoders.mjs';
import {Writer,Reader as ProtocolReader} from '../lib/codec.mjs';
import {itemPacket,skillList} from '../lib/restoration-packets.mjs';
import {itemWithAffixes} from '../lib/item-affixes.mjs';
import {equipment,powers,attributes,equip,unequip,activeSkills} from '../lib/restoration.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {SaveStore} from '../lib/store.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),d=decoders(root);
for(const name of ['isTimeItem','isBinded','isAutoBinding'])d.Item.prototype[name]=d.native(32,name,{e:d.Item});
const affixes={power1:{power:69,value:2684},power2:{power:54,value:403},bindPower1:{power:2,value:61},bindPower2:{power:259,value:61},power3:{power:134,value:61}};
const instance=()=>({itemId:28011,slot:30,quantity:1,bound:true,affixes:structuredClone(affixes)});
const combinedInstance=()=>({...instance(),combinedSkill:{id:4007,level:22}});

test('native bag parser reads perfect weapon affixes and the following ordinary copy independently',()=>{
  const template=equipment.get(28011),original=JSON.stringify(template),item=instance();
  const bytes=itemPacket(itemPacket(new Writer(),item),{itemId:28011,slot:31,quantity:1}).done();
  const reader=new Reader(bytes),read=()=>{const value=new d.Item();d.native(32,'fromBytesAtts1',{e:d.Item})(value,reader);d.Item.fromBytesAtts2(value,reader);return value;};
  const custom=read(),normal=read();reader.finish();
  for(const [field,a] of Object.entries(affixes)){assert.equal(custom[field],a.power);assert.equal(custom[field.replace('Power','PowerValue').replace(/^power/,'powerValue')],a.value);}
  assert.equal(custom.name,'匣里金刀血未干【惊世】');assert.equal(custom.reqLv,91);assert.equal(custom.atkMin,1312);assert.equal(custom.atkMax,2063);assert.equal(custom.durability,210);
  assert.equal(custom.isBinded(),true);assert.equal(normal.isBinded(),false);
  assert.equal(normal.power1,121);assert.equal(normal.power2,121);assert.equal(normal.power3,131);
  assert.equal(JSON.stringify(template),original);
});

test('individual affixes survive save reload, equipment swap and native/server stat calculation',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-affixes-'));
  try{
    const store=new SaveStore(dir),account=store.account('affix-test');
    const role=store.create(account,{name:'独立鉴定测试',sex:0,race:1,job:0});
    role.level=97;role.baseStats=[100,10,10,10,10];role.skills={};role.inventory=[instance()];
    equip(role,30,8);assert.equal(powers(role,'equipment')(54),403);assert.equal(powers(role,'equipment')(69),2684);assert.equal(powers(role,'equipment')(134),61);assert.equal(powers(role,'equipment')(259),61);assert.equal(attributes(role).base[0],161);
    store.save();const loaded=new SaveStore(dir).data.characters.find(p=>p.id===role.id);assert.deepEqual(loaded.inventory[0].affixes,affixes);assert.equal(loaded.level,97);
    unequip(loaded,8);assert.equal(powers(loaded,'equipment')(69),0);assert.equal(attributes(loaded).base[0],100);assert.deepEqual(loaded.inventory[0].affixes,affixes);
    equip(loaded,loaded.inventory[0].slot,8);assert.equal(powers(loaded,'equipment')(69),2684);
  }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'worldol-affixes-'));fs.rmSync(dir,{recursive:true,force:true});}
});

test('affix definitions reject unknown slots, wrong effects, excessive values and changed wire layouts',()=>{
  const template=equipment.get(28011);
  assert.throws(()=>itemWithAffixes(template,{...instance(),affixes:{power1:{power:69,value:2685}}}),/超出/);
  assert.throws(()=>itemWithAffixes(template,{...instance(),affixes:{power2:{power:2,value:61}}}),/超出/);
  assert.throws(()=>itemWithAffixes(template,{...instance(),affixes:{power4:{power:69,value:2684}}}),/不能鉴定/);
  const bytes=Buffer.from(template.definitionBase64,'base64');bytes[bytes.length-1]^=1;
  assert.throws(()=>itemWithAffixes({...template,definitionBase64:bytes.toString('base64')},instance()),/定义已变化/);
});

test('native item parser reads actual level-22 skill alongside all perfect affixes without changing ordinary items',()=>{
  const template=equipment.get(28011),original=JSON.stringify(template);
  const reader=new Reader(itemPacket(itemPacket(new Writer(),combinedInstance()),{itemId:28011,slot:31,quantity:1}).done());
  const read=()=>{const item=new d.Item();d.native(32,'fromBytesAtts1',{e:d.Item})(item,reader);d.Item.fromBytesAtts2(item,reader);return item;};
  const item=read(),ordinary=read();reader.finish();
  assert.equal(item.skill.id,4007);assert.equal(item.skill.level,22);assert.equal(item.skill.name,'金刀撼世');assert.equal(item.skill.useMP,1100);assert.equal(item.skillDesc,'金刀撼世+22级');
  assert.equal(item.combinUpSkillList[0].level,22);assert.equal(ordinary.skill,undefined);assert.equal(ordinary.skillDesc,'');
  for(const [field,a] of Object.entries(affixes)){assert.equal(item[field],a.power);assert.equal(item[field.replace('Power','PowerValue').replace(/^power/,'powerValue')],a.value);}
  assert.equal(item.reqLv,91);assert.equal(item.atkMax,2063);assert.equal(item.durability,210);assert.equal(JSON.stringify(template),original);
  assert.throws(()=>itemWithAffixes(template,{...combinedInstance(),combinedSkill:{id:4007,level:23}}),/没有已录原版定义/);
  assert.throws(()=>itemWithAffixes(template,{...combinedInstance(),combinedSkill:{id:4008,level:22}}),/没有已录原版定义/);
});

test('equipment skill survives reload and native protocol adds, selects and removes it without learning it permanently',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-affixes-'));
  try{
    const store=new SaveStore(dir),account=store.account('combined-skill-test'),role=store.create(account,{name:'合成技能测试',sex:1,race:0,job:1});
    role.level=97;role.inventory=[combinedInstance()];role.skills={452:1};role.initiativeSkillId=452;role.autoSkillIds=[0,0,0,0];
    const sent=[],call=(type,writer)=>{const reader=new ProtocolReader(writer.done());assert.equal(handleRestoration(type,reader,{role},{store,send:(type,w)=>sent.push({type,bytes:w.done()}),log(){}}),true);assert.equal(reader.pos,reader.b.length);return new Reader(sent.findLast(s=>s.type===type).bytes);};
    const client={list:new Map(),learnSkill(s){this.list.set(s.id,s);},getSkillByID(id){return this.list.get(id);},removeSkill(s){this.list.delete(s.id);}};
    const nativeChanges=d.native(56,'fromSkillData',{l:{default:d.Skill}});
    let r=call(12001,new Writer().byte(9).byte(1).short(30).int(1).byte(8).bool(false).byte(0));assert.equal(r.getByte(),9);assert.equal(r.getByte(),0);nativeChanges.call(client,r);r.finish();
    const skill=client.list.get(4007);assert.equal(skill.level,22);assert.equal(skill.addLevel,22);assert.equal(skill.type,3);assert.equal(skill.useMP,1100);assert.equal(skill.power1,81);assert.equal(skill.powerValue1,3000);assert.equal(role.skills[4007],undefined);
    r=call(14009,new Writer().byte(0).int(4007));assert.equal(r.getByte(),0);r.finish();assert.equal(role.initiativeSkillId,4007);
    const reloaded=new SaveStore(dir).data.characters.find(p=>p.id===role.id);assert.deepEqual(reloaded.inventory[0].combinedSkill,{id:4007,level:22});assert.equal(reloaded.initiativeSkillId,4007);assert.equal(reloaded.skills[4007],undefined);
    r=new Reader(skillList(new Writer(),reloaded).done());const loaded=[];for(let count=r.getShort();count>0;count--){const s=d.Skill.fromBytes(r);s.addLevel=r.getByte();loaded.push(s);}r.finish();assert.equal(loaded.find(s=>s.id===4007).level,22);assert.equal(loaded.find(s=>s.id===452).addLevel,0);
    r=call(12001,new Writer().byte(17).byte(2).short(8).int(1).bool(false).byte(0));assert.equal(r.getByte(),17);nativeChanges.call(client,r);r.finish();assert.equal(client.list.has(4007),false);assert.equal(client.autoSkillID_Initiative,-1);assert.equal(role.initiativeSkillId,-1);assert.ok(activeSkills(role).some(s=>s.id===452));assert.equal(role.skills[452],1);
    r=call(14009,new Writer().byte(0).int(4007));assert.equal(r.getByte(),-1);assert.match(r.getString(),/没有这个/);r.finish();
  }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'worldol-affixes-'));fs.rmSync(dir,{recursive:true,force:true});}
});

test('binding an equipped combined weapon keeps its already active native skill list',()=>{
  const role={id:1,level:97,baseStats:[5,9,52,5,4],hp:1,mp:1,skills:{452:1},inventory:[{...combinedInstance(),slot:8,bound:false}],autoSkillIds:[0,0,0,0],initiativeSkillId:452};
  assert.equal(activeSkills(role).some(s=>s.id===4007),true);
  const sent=[];handleRestoration(12001,new ProtocolReader(new Writer().byte(7).byte(7).short(8).int(1).bool(false).byte(0).done()),{role},{store:{save(){}},send:(type,w)=>sent.push({type,bytes:w.done()}),log(){}});
  assert.equal(sent[0].bytes[0],7);const update=sent.find(s=>s.type===14011);assert.ok(update);
  const r=new Reader(update.bytes),list=[];for(let count=r.getShort();count>0;count--){const s=d.Skill.fromBytes(r);s.addLevel=r.getByte();list.push(s);}for(let count=r.getByte();count>0;count--)assert.equal(r.getShort(),0);assert.equal(r.getShort(),452);r.finish();
  assert.equal(list.find(s=>s.id===4007).level,22);assert.equal(list.find(s=>s.id===4007).addLevel,22);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {equipment,activeSkills,powers,unequip} from '../lib/restoration.mjs';
import {compositionRanges,compositionSkills,itemWithAffixes} from '../lib/item-affixes.mjs';
import {planComposition,planVip,workshopState,COMPOSITION_APPLY,VIP_APPLY,COMPOSITION_LIST} from '../lib/equipment-composition.mjs';
import {fingerprint} from '../lib/equipment-upgrades.mjs';
import {handleEquipmentComposition} from '../lib/equipment-composition-service.mjs';
import {equipmentSets,setPowers,setPacket,setAttributeData} from '../lib/equipment-sets.mjs';
import {itemPacket,skillList} from '../lib/restoration-packets.mjs';
import {Writer,Reader as ProtocolReader} from '../lib/codec.mjs';
import {decoders,Reader} from '../tools/capture-decoders.mjs';
import {SaveStore} from '../lib/store.mjs';
import {playerDetail} from '../lib/world.mjs';
const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
for(const name of ['isTimeItem','isBinded','isAutoBinding'])d.Item.prototype[name]=d.native(32,name,{e:d.Item});
const readItem=r=>{const item=new d.Item();d.native(32,'fromBytesAtts1',{e:d.Item})(item,r);d.Item.fromBytesAtts2(item,r);return item;};
const role=()=>({id:1001,level:97,baseStats:[30,30,30,30,30],hp:100,mp:100,skills:{},skillPoints:100,vipLevel2:0,autoSkillIds:[0,0,0,0],initiativeSkillId:-1,coins:1234,gold:23,silver:45,inventory:[{itemId:28011,slot:8,quantity:1,bound:true,star:3,gems:[{itemId:414,quantity:2}],affixes:{power1:{power:69,value:2684}},combinedSkill:{id:4007,level:22}},{itemId:40021,slot:30,quantity:7}]});
const request=(p,extra)=>({slot:p.inventory[0].slot,itemId:p.inventory[0].itemId,fingerprint:fingerprint(p.inventory[0]),...extra});

test('free composition preserves every other affix, skill, star, gem and currency and rejects invalid or stale requests',()=>{
 const p=role(),before=structuredClone(p),q=request(p,{mode:'attribute',field:'power3',power:134,value:61});
 const {next,item}=planComposition(p,q);assert.deepEqual(p,before);assert.deepEqual(item.affixes.power3,{power:134,value:61});
 const expected=structuredClone(before);expected.inventory[0].affixes.power3={power:134,value:61};assert.deepEqual(next,expected);
 for(const bad of [{value:62},{value:10.5},{power:2},{field:'power1'},{itemId:31168},{fingerprint:'wrong'}])assert.throws(()=>planComposition(p,{...q,...bad}));
 assert.throws(()=>planComposition(next,q),/已变化/);assert.deepEqual(p,before);
 const reroll=planComposition(next,request(next,{mode:'attribute',field:'power3',power:170,value:300}));assert.equal(reroll.item.affixes.power3.power,170);assert.deepEqual(reroll.item.combinedSkill,{id:4007,level:22});
});

test('all captured equipment skill options including existing base skills survive the real native item parser',()=>{
 let count=0,templates=0,existing=0;
 for(const template of equipment.values()){
  const options=compositionSkills(template);if(!options.length)continue;templates++;if(template.skill)existing++;
  const original=JSON.stringify(template);
  for(const s of options){
   const instance={itemId:template.id,slot:30,quantity:1,bound:true,combinedSkill:{id:s.id,level:s.level}};
   const r=new Reader(itemPacket(itemPacket(new Writer(),instance),{itemId:template.id,slot:31,quantity:1}).done()),result=readItem(r),ordinary=readItem(r);r.finish();
   assert.equal(result.skill.id,s.id);assert.equal(result.skill.level,s.level);assert.equal(ordinary.skill?.id,template.skill?.id);assert.equal(ordinary.skill?.level,template.skill?.level);assert.equal(result.combinUpSkillList.length,template.combinUpSkillList.length);count++;
  }assert.equal(JSON.stringify(template),original);
 }
 assert.ok(templates>=520);assert.ok(existing>=26);assert.equal(count,[...equipment.values()].reduce((n,e)=>n+(e.combinUpSkillList?.length||0),0));
});

test('combining a selected skill immediately replaces equipped skill effects and survives save/reload/unequip',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-composition-'));
 try{
  const store=new SaveStore(dir),a=store.account('composition'),p=store.create(a,{name:'合成测试',sex:1,race:0,job:1});Object.assign(p,role());p.inventory[0]={itemId:14288,slot:0,quantity:1,bound:true};
  const first=planComposition(p,request(p,{mode:'skill',skillId:6547,level:22}));Object.assign(p,first.next);assert.ok(activeSkills(p).some(s=>s.id===6547));assert.equal(powers(p,'skill')(123),3);
  const second=planComposition(p,request(p,{mode:'skill',skillId:6548,level:22}));Object.assign(p,second.next);assert.equal(activeSkills(p).some(s=>s.id===6547),false);assert.ok(activeSkills(p).some(s=>s.id===6548));assert.equal(powers(p,'skill')(122),3);
  const bytes=new Reader(skillList(new Writer(),p).done());assert.equal(bytes.getShort(),1);assert.equal(d.Skill.fromBytes(bytes).id,6548);bytes.getByte();bytes.finish();
  store.save();const loaded=new SaveStore(dir).data.characters[0];assert.deepEqual(loaded.inventory[0].combinedSkill,{id:6548,level:22});unequip(loaded,0);assert.equal(activeSkills(loaded).some(s=>s.id===6548),false);assert.equal(loaded.skills[6548],undefined);
 }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'worldol-composition-'));fs.rmSync(dir,{recursive:true});}
});

test('recorded set thresholds and VIP8 gate agree with the original native set power calculator',()=>{
 const p=role();p.inventory=[{itemId:31173,slot:15,quantity:1}];
 const native=d.native(56,'getBagEquipPowerValue',{t:{getItemSetID:d.native(56,'getItemSetID'),getItemSetNum:d.native(56,'getItemSetNum')}});
 for(const vip of [0,7,8,9]){
  const {next}=planVip(p,vip),client={itemSetData:setAttributeData(next),bag:{getEquipPowerValue:()=>0,getEquipItemSetNum:id=>id===197?1:0}};
  const value=native.call(client,178);assert.equal(value,vip>=8?3:0);assert.equal(setPowers(next).reduce((n,[id,v])=>n+(id===178?v:0),0),value);
  const saved=new Reader(setPacket(new Writer(),next,[197]).done()),tables={};d.native(18,'processGetSuitInfoMsg',{f:{Tool:{byte2short:n=>n&255}},r:{default:{addSuit:(id,rows)=>tables[id]=rows}}})(saved);saved.finish();assert.equal(tables[197][4],vip>=8?1:0);
 }
 assert.throws(()=>planVip(p,10),/范围/);assert.throws(()=>planVip(p,-1),/范围/);assert.equal(p.vipLevel2,0);
 p.inventory=[{itemId:2056,slot:8,quantity:1}];assert.deepEqual(setPowers(p),[]);p.inventory.push({itemId:2056,slot:10,quantity:1});assert.deepEqual(setPowers(p),[[5,25]]);
 assert.equal(equipmentSets.size,192);assert.equal(workshopState(role()).sets.find(s=>s.id===216).known,true);
});

test('native client applies newly equipped recorded sets and changed VIP gates without relogging',()=>{
 class Player{getVipLevel2(){return this.vip;}}
 Player.prototype.getBagEquipPowerValue=d.native(56,'getBagEquipPowerValue',{t:{getItemSetID:d.native(56,'getItemSetID'),getItemSetNum:d.native(56,'getItemSetNum')}});
 const p=new Player(),world={myPlayer:p},counts=new Map(),window={};p.vip=0;p.itemSetData=[];p.bag={getEquipPowerValue:()=>0,getEquipItemSetNum:id=>counts.get(id)||0};
 vm.runInNewContext(fs.readFileSync(new URL('../web/equipment-composition.js',import.meta.url),'utf8'),{window});
 window.installEquipmentSetPowers(id=>id===5?{default:world}:{default:Player},equipmentSets);
 const set=equipment.get(2056).itemSet&255;
 counts.set(set,1);assert.equal(p.getBagEquipPowerValue(5),0);
 counts.set(set,2);assert.equal(p.getBagEquipPowerValue(5),25);
 counts.clear();assert.equal(p.getBagEquipPowerValue(5),0);
 counts.set(197,1);assert.equal(p.getBagEquipPowerValue(178),0);
 p.vip=8;assert.equal(p.getBagEquipPowerValue(178),3);
 p.itemSetData=[];assert.equal(p.getBagEquipPowerValue(178),3,'a fresh native player packet must not discard the local complete table');
 p.vip=7;assert.equal(p.getBagEquipPowerValue(178),0);
 counts.clear();counts.set(set,2);p.getPowerValueByBuffer=()=>7;assert.equal(p.getBagEquipPowerValue(5,true),32);
 const remote=new Player();remote.vip=9;remote.itemSetData=[];remote.bag=p.bag;assert.equal(remote.getBagEquipPowerValue(5),0,'another player retains its own server-supplied set data');
});

test('composition protocols reject combat/stale/malformed requests and roll back saves without spending materials',()=>{
 const p=role(),context={role:p},sent=[];let fail=false,saves=0;
 const call=(type,w=new Writer())=>{sent.length=0;assert.equal(handleEquipmentComposition(type,new ProtocolReader(w.done()),context,{store:{save(){if(fail)throw Error('disk failure');saves++;}},send:(type,w)=>sent.push({type,bytes:w.done()}),log(){}}),true);return new Reader(sent[0].bytes);};
 let r=call(COMPOSITION_LIST);assert.equal(r.getByte(),0);assert.equal(JSON.parse(r.getString()).mode,'free');r.finish();
 const q=request(p,{mode:'attribute',field:'power3',power:134,value:61}),before=structuredClone(p),w=()=>new Writer().string(JSON.stringify(q));
 context.battle={};assert.equal(call(COMPOSITION_APPLY,w()).getByte(),-1);delete context.battle;assert.deepEqual(p,before);
 fail=true;assert.equal(call(COMPOSITION_APPLY,w()).getByte(),-1);assert.deepEqual(p,before);fail=false;
 r=call(COMPOSITION_APPLY,w());assert.equal(r.getByte(),0);assert.equal(JSON.parse(r.getString()).items[0].affixes.power3.value,61);assert.equal(r.getBoolean(),true);assert.equal(readItem(r).powerValue3,61);r.finish();assert.equal(saves,1);assert.deepEqual(sent.map(s=>s.type),[COMPOSITION_APPLY,14011,17601]);
 assert.equal(call(COMPOSITION_APPLY,w()).getByte(),-1);assert.equal(saves,1);assert.equal(p.coins,before.coins);assert.deepEqual(p.inventory[1],before.inventory[1]);
 r=call(VIP_APPLY,new Writer().byte(9));assert.equal(r.getByte(),0);assert.equal(JSON.parse(r.getString()).vipLevel,9);assert.equal(r.getBoolean(),false);r.finish();assert.equal(saves,2);
 assert.equal(call(VIP_APPLY,new Writer().byte(8).byte(0)).getByte(),-1);assert.equal(p.vipLevel2,9);
});

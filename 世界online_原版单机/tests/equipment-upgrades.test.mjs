import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Writer,Reader as ProtocolReader} from '../lib/codec.mjs';
import {equipment,attributes,powers} from '../lib/restoration.mjs';
import {official,itemSlots} from '../lib/official-data.mjs';
import {identifySlots,itemWithAffixes,gemAttachment,canIdentify,equipmentPowers} from '../lib/item-affixes.mjs';
import {planIdentification,planAcceptIdentification,planStar,planGem,starPreview,identificationList} from '../lib/equipment-upgrades.mjs';
import {handleEquipmentUpgrades,starPreviewPacket} from '../lib/equipment-upgrade-service.mjs';
import {itemPacket} from '../lib/restoration-packets.mjs';
import {SaveStore} from '../lib/store.mjs';
import {starLimit,starRules,gemRules} from '../lib/equipment-policy.mjs';
import {decoders,Reader} from '../tools/capture-decoders.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root),scope={e:d.Item,a:{default:d.constants},d:{Tool:{MAX_VALUE_short:32767}},E:{GUtil:{intNum:Math.trunc}}};
for(const name of ['isTimeItem','isBinded','isAutoBinding','isAscension','getPower1AndPower2','isVipItem','getPowerValue','isAttackBroken'])d.Item.prototype[name]=d.native(32,name,scope);
d.Item.getpowerValueAdd=d.native(32,'getpowerValueAdd',scope);d.Item.isUpgradeItemOpen=true;
const readItem=r=>{const item=new d.Item();d.native(32,'fromBytesAtts1',scope)(item,r);d.Item.fromBytesAtts2(item,r);return item;};
const role=()=>({id:1001,level:97,baseStats:[30,30,30,30,30],hp:1,mp:1,skills:{},autoSkillIds:[0,0,0,0],inventory:[{itemId:2056,slot:30,quantity:1,bound:true},{itemId:40001,slot:31,quantity:5},{itemId:40021,slot:32,quantity:12},{itemId:414,slot:33,quantity:24}],coins:100,skillPoints:100});
const counts=p=>p.inventory.filter(i=>i.slot>=30).map(i=>[i.itemId,i.quantity]);
const maximum=n=>n-1;

test('ordinary identification uses captured ranges, preserves original until confirmation and consumes exactly one scroll',()=>{
  const p=role(),before=structuredClone(p);assert.deepEqual(identificationList(p,40001),[30]);
  const roll=planIdentification(p,30,40001,maximum);assert.deepEqual(p,before);assert.deepEqual(roll.next.inventory[0],p.inventory[0]);assert.equal(roll.next.inventory[1].quantity,4);
  for(const range of identifySlots(equipment.get(2056))){const option=range.options.at(-1);assert.deepEqual(roll.candidate.affixes[range.field],{power:option.power,value:option.max});}
  assert.equal(roll.candidate.affixes.power3,undefined);
  const accepted=planAcceptIdentification(roll.next,1,30,2056,true,false).next;assert.deepEqual(accepted.inventory[0],roll.candidate);assert.equal(accepted.pendingIdentification,undefined);
  assert.throws(()=>planAcceptIdentification(accepted,1,30,2056,true,false),/失效/);
  const cancelled=planAcceptIdentification(roll.next,1,30,2056,false,false).next;assert.deepEqual(cancelled.inventory[0],before.inventory[0]);assert.equal(cancelled.inventory[1].quantity,4);
});

test('reroll replaces only ordinary affixes, leaves composition and skill intact, and stale confirmation cannot overwrite a changed item',()=>{
  const p=role();p.inventory[0]={itemId:28011,slot:30,quantity:1,bound:true,star:3,gems:[{itemId:414,quantity:2}],combinedSkill:{id:4007,level:22},affixes:{power3:{power:134,value:61}}};
  const a=planIdentification(p,30,40001,maximum),b=planIdentification(a.next,30,40001,()=>0);
  assert.equal(b.next.inventory[1].quantity,3);assert.deepEqual(b.candidate.affixes.power3,{power:134,value:61});assert.deepEqual(b.candidate.combinedSkill,{id:4007,level:22});assert.equal(b.candidate.star,3);assert.equal(gemAttachment(equipment.get(28011),b.candidate).count,2);
  b.next.inventory[0].star=4;const copy=structuredClone(b.next);assert.throws(()=>planAcceptIdentification(b.next,1,30,28011,true,false),/失效/);assert.deepEqual(b.next,copy);
});

test('stars follow the native arithmetic, fifty-two upgrades consume fifty-two scrolls, and native wire never accumulates scaling twice',()=>{
  let p=role();const template=equipment.get(2056),original=JSON.stringify(template);p.inventory[0]=planIdentification(p,30,40001,maximum).candidate;p.inventory[2].quantity=60;
  for(let star=1;star<=52;star++){p=planStar(p,30,2056,()=>0).next;const r=new Reader(itemPacket(new Writer(),p.inventory[0]).done()),i=readItem(r);r.finish();assert.equal(i.star,star);assert.equal(i.atkMin,d.Item.getpowerValueAdd(template.atkMin,template.ascensionStar,star,true,true));
    for(const [power,value]of equipmentPowers(template,p.inventory[0]))assert.equal(i.getPowerValue(power),value);
    assert.equal(itemWithAffixes(template,p.inventory[0]).atkMax,i.atkMax);
  }
  assert.equal(p.inventory.find(i=>i.itemId===40021).quantity,8);assert.throws(()=>planStar(p,30,2056),/52星/);assert.equal(JSON.stringify(template),original);
});

test('gem sockets consume one actual stack item, stop at the equipment cap, and affect equipped native/server stats',()=>{
  let p=role();p.inventory[0].slot=8;const before=attributes(p);p=planGem(p,8,33,()=>0).next;
  assert.equal(p.inventory.find(i=>i.itemId===414).quantity,23);assert.equal(powers(p,'equipment')(3),1);assert.equal(attributes(p).base[1],before.base[1]+1);assert.ok(attributes(p).hp>before.hp);
  const r=new Reader(itemPacket(new Writer(),p.inventory[0]).done()),native=readItem(r);r.finish();assert.equal(native.attachDone,1);assert.equal(native.attachPower,3);assert.equal(native.attachValue,1);assert.equal(native.getPowerValue(3),1);
  for(let n=1;n<20;n++)p=planGem(p,8,33,()=>0).next;
  const copy=structuredClone(p);assert.throws(()=>planGem(p,8,33),/孔已满/);assert.deepEqual(p,copy);assert.equal(p.inventory.find(i=>i.itemId===414).quantity,4);
});

test('invalid materials, equipped identification, unsupported scrolls, unbound or ineligible gear never spend inventory',()=>{
  const p=role(),copy=structuredClone(p);
  assert.throws(()=>planGem(p,30,31),/宝石/);assert.throws(()=>identificationList(p,40023),/普通/);assert.throws(()=>planIdentification(p,30,40023),/无效/);assert.deepEqual(p,copy);
  const noMaterial=role();noMaterial.inventory=noMaterial.inventory.slice(0,1);const saved=structuredClone(noMaterial);assert.throws(()=>planStar(noMaterial,30,2056),/材料/);assert.throws(()=>planIdentification(noMaterial,30),/材料/);assert.deepEqual(noMaterial,saved);
  p.inventory[0].bound=false;assert.throws(()=>planStar(p,30,2056),/绑定/);p.inventory[0].slot=8;assert.throws(()=>planIdentification(p,8),/卸下/);
  p.inventory[0]={itemId:14591,slot:30,quantity:1,bound:true};assert.throws(()=>planStar(p,30,14591),/不能强化/);assert.throws(()=>planGem(p,30,33),/不能镶嵌/);
});

test('all collected ordinary identification targets and all star-capable equipment decode with the original parser',()=>{
  let identified=0,starred=0;for(const template of equipment.values()){
    if(!template.native||!itemSlots(template.type).length)continue;
    let item={itemId:template.id,slot:30,quantity:1,bound:true};
    if(canIdentify(template)){const p=role();p.inventory[0]=item;item=planIdentification(p,30,40001,maximum).candidate;identified++;}
    if(template.ascensionStar){item.star=starLimit(template);starred++;}
    const r=new Reader(itemPacket(new Writer(),item).done()),parsed=readItem(r);r.finish();assert.equal(parsed.id,template.id);if(item.star)assert.equal(parsed.star,starLimit(template));
  }
  assert.ok(identified>900);assert.ok(starred>1600);
});

test('native star preview consumes the full packet including the attack discriminator and upgrade trailer',()=>{
  const p=role(),preview=starPreview(p,30,2056),r=new Reader(starPreviewPacket(preview).done());assert.equal(r.getByte(),0);assert.equal(r.getBoolean(),true);const required=r.getInt(),available=r.getInt();
  const item=readItem(new Reader(itemPacket(new Writer(),p.inventory[0]).done())),emitted=[];
  class Text {value='';append(s){this.value+=s;}toString(){return this.value;}}
  const fn=d.native(5,'doGetNextStarAttrData',{e:{myPlayer:{bag:{}},ITEM_STAR_TYPE1:1,ITEM_STAR_TYPE3:3,getItemStarFontColor:()=>0},A:{default:Text},z:{default:class{}},g:{GameText:{}},T:{Tool:{manageString:()=>''}},D:{default:{makeColorString:s=>s}},f:{default:{getPowerDesc:(p,v)=>`${p}:${v}`}},y:{default:d.Item},o:{default:{sendNt:(event,data)=>emitted.push(data)}},k:{BagEvent:{}}});
  fn(item,r,available,1,false,required);r.finish();assert.equal(emitted[0][0].newStar,1);assert.equal(available,12);assert.equal(required,1);
});

test('upgrade protocols acknowledge native formats, reject duplicate/stale actions and roll back on save failure',()=>{
  const p=role(),context={role:p},sent=[];let saves=0,fail=false;
  const call=(type,w)=>{sent.length=0;const r=new ProtocolReader(w.done());assert.equal(handleEquipmentUpgrades(type,r,context,{store:{save(){if(fail)throw Error('save unavailable');saves++;}},send:(t,w)=>sent.push({type:t,bytes:w.done()}),log(){},draw:()=>0}),true);return new Reader(sent[0].bytes);};
  let r=call(12041,new Writer().int(40001).bool(false));assert.equal(r.getByte(),0);assert.equal(r.getShort(),1);assert.equal(r.getShort(),30);r.finish();
  r=call(12001,new Writer().byte(5).byte(5).short(30).int(1).bool(false).byte(13));assert.equal(r.getByte(),5);assert.equal(r.getByte(),1);assert.equal(r.getByte(),1);assert.equal(r.getShort(),31);assert.equal(r.getInt(),40001);assert.equal(readItem(r).power1!==121,true);assert.equal(r.getBoolean(),false);r.finish();
  r=call(12015,new Writer().byte(1).short(30).int(2056).bool(true).bool(false));assert.equal(r.getByte(),0);r.finish();const prior=structuredClone(p);
  assert.equal(call(12015,new Writer().byte(1).short(30).int(2056).bool(true).bool(false)).getByte(),-1);assert.deepEqual(p,prior);
  r=call(11506,new Writer().short(30).int(2056).byte(1));assert.equal(r.getByte(),0);
  r=call(11506,new Writer().short(30).int(2056).byte(2));assert.equal(r.getByte(),0);assert.equal(r.getByte(),1);assert.equal(r.getShort(),32);assert.equal(r.getByte(),1);assert.equal(r.getBoolean(),true);assert.equal(readItem(r).star,1);r.finish();
  assert.equal(call(11506,new Writer().short(30).int(2056).byte(2)).getByte(),-1);
  r=call(12001,new Writer().byte(6).byte(6).short(30).int(1).short(33).bool(false).byte(13));assert.equal(r.getByte(),6);assert.equal(r.getBoolean(),true);assert.equal(r.getByte(),1);assert.equal(r.getShort(),3);assert.equal(r.getShort(),1);assert.equal(r.getByte(),1);assert.equal(r.getShort(),33);assert.equal(r.getInt(),414);r.finish();
  const saved=structuredClone(p);fail=true;r=call(12001,new Writer().byte(6).byte(6).short(30).int(1).short(33).bool(false).byte(13));assert.equal(r.getByte(),-1);assert.deepEqual(p,saved);assert.equal(saves,4);
  fail=false;context.battle={};assert.equal(call(11506,new Writer().short(30).int(2056).byte(1)).getByte(),-1);assert.deepEqual(p,saved);
});

test('confirmed affixes, stars, sockets, materials and pending identification survive actual SaveStore reload',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-upgrades-'));
  try{let store=new SaveStore(dir),account=store.account('equipment-qa'),p=store.create(account,{name:'强化测试',sex:0,race:1,job:0});Object.assign(p,role());
    Object.assign(p,planIdentification(p,30,40001,maximum).next);store.save();store=new SaveStore(dir);p=store.data.characters[0];assert.ok(p.pendingIdentification);Object.assign(p,planAcceptIdentification(p,1,30,2056,true,false).next);delete p.pendingIdentification;
    Object.assign(p,planStar(p,30,2056,()=>0).next);Object.assign(p,planGem(p,30,33).next);store.save();const loaded=new SaveStore(dir).data.characters[0];assert.deepEqual(loaded.inventory,p.inventory);assert.deepEqual(counts(loaded),counts(p));assert.equal(loaded.inventory[0].star,1);assert.equal(loaded.inventory[0].gems[0].quantity,1);assert.ok(loaded.inventory[0].affixes.power1);assert.equal(loaded.pendingIdentification,undefined);
  }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'worldol-upgrades-'));fs.rmSync(dir,{recursive:true,force:true});}
});

test('level boundaries use equipment level, and each supported category reaches its own cap',()=>{
 for(const [level,weapon,armor] of [[1,52,32],[49,52,32],[50,24,24],[69,24,24],[70,18,18],[97,18,18]]){
   assert.equal(starLimit({type:13,reqLv:level,ascensionStar:10}),weapon);
   for(const type of [0,7,8,9,10])assert.equal(starLimit({type,reqLv:level,ascensionStar:10}),armor);
 }
 for(const [id,max] of [[20357,52],[11526,32],[20353,24],[28003,18]]){
   const p=role();p.inventory[0]={itemId:id,slot:30,quantity:1,bound:true,star:max-1};
   const preview=starPreview(p,30,id);assert.equal(preview.limit,max);assert.equal(preview.successRate,50);assert.equal(preview.item.star,max);
   const next=planStar(p,30,id,()=>0).next,item=readItem(new Reader(itemPacket(new Writer(),next.inventory[0]).done()));assert.equal(item.star,max);
   const before=structuredClone(next);assert.throws(()=>planStar(next,30,id,()=>0),new RegExp(max+'星'));assert.throws(()=>starPreview(next,30,id),new RegExp(max+'星'));assert.deepEqual(next,before);
 }
});

test('star trials split all 100 random outcomes exactly 50/50, and gem sockets stay guaranteed to the cap without extra spending',()=>{
 let stars=0,gems=0;
 for(let outcome=0;outcome<100;outcome++){
   const p=role(),trial=planStar(p,30,2056,()=>outcome);stars+=Number(trial.success);
   assert.equal(trial.item.star,trial.success?1:0);assert.equal(trial.next.inventory[2].quantity,11);assert.equal(p.inventory[2].quantity,12);
   // 保底 30 ≥ 全库装备的宝石孔上限（20 或 30），所以镶嵌恒成功、恒不破碎，与 draw 无关。
   p.inventory[0].gems=[{itemId:414,quantity:19}];const gem=planGem(p,30,33,()=>outcome);gems+=Number(gem.success);
   assert.equal(gem.attachment.count,20);assert.equal(gem.item.gemBroken,false);assert.equal(gem.next.inventory[3].quantity,23);
 }
 assert.equal(stars,50);assert.equal(gems,100);
});

test('gem sockets are guaranteed to the equipment cap, and a broken save preserves native stats until a new first gem',()=>{
 let p=role();p.inventory[0].slot=8;
 for(let n=0;n<20;n++){const result=planGem(p,8,33,()=>{throw Error('Guaranteed sockets must not roll');});assert.equal(result.success,true);p=result.next;}
 const before=attributes(p),full=structuredClone(p);assert.throws(()=>planGem(p,8,33,()=>99),/孔已满/);assert.deepEqual(p,full);
 const broken=structuredClone(p.inventory[0]);broken.gemBroken=true;
 const r=new Reader(itemPacket(new Writer(),broken).done()),native=readItem(r);r.finish();assert.equal(native.isAttackBroken(),true);assert.equal(native.getPowerValue(3),20);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-broken-'));
 try{
   let store=new SaveStore(dir),account=store.account('broken-qa'),saved=store.create(account,{name:'破碎验收',sex:0,race:1,job:0});Object.assign(saved,{...p,inventory:p.inventory.map(i=>i.slot===8?broken:i)});store.save();
   const loaded=new SaveStore(dir).data.characters[0];assert.equal(loaded.inventory.find(i=>i.slot===8).gemBroken,true);assert.deepEqual(attributes(loaded),before);
   const noGem=structuredClone(loaded);noGem.inventory=noGem.inventory.filter(i=>i.itemId!==414);const unchanged=structuredClone(noGem);assert.throws(()=>planGem(noGem,8,33),/宝石/);assert.deepEqual(noGem,unchanged);
   const restart=planGem(loaded,8,33,()=>{throw Error('Restart is the first gem');});assert.equal(restart.restarted,true);assert.equal(restart.success,true);assert.equal(restart.item.gemBroken,false);assert.equal(restart.attachment.count,1);assert.equal(restart.attachment.value,1);assert.equal(restart.next.inventory.find(i=>i.itemId===414).quantity,3);
   const fresh=readItem(new Reader(itemPacket(new Writer(),restart.item).done()));assert.equal(fresh.isAttackBroken(),false);assert.equal(fresh.getPowerValue(3),1);assert.equal(attributes(restart.next).base[1],before.base[1]-19);
 }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'worldol-broken-'));fs.rmSync(dir,{recursive:true});}
});

test('star and gem protocol replies are fully consumed and duplicate star retries cannot spend twice',()=>{
 const p=role(),context={role:p};let saves=0;
 const call=(type,w)=>{let bytes;handleEquipmentUpgrades(type,new ProtocolReader(w.done()),context,{store:{save(){saves++;}},send(t,w){bytes=w.done();},log(){},draw:()=>99});return new Reader(bytes);};
 call(11506,new Writer().short(30).int(2056).byte(1));const star=call(11506,new Writer().short(30).int(2056).byte(2));
 assert.equal(star.getByte(),0);assert.equal(star.getByte(),1);assert.equal(star.getShort(),32);assert.equal(star.getByte(),1);assert.equal(star.getBoolean(),false);star.finish();assert.equal(p.inventory[0].star,0);assert.equal(p.inventory[2].quantity,11);
 assert.equal(call(11506,new Writer().short(30).int(2056).byte(2)).getByte(),-1);assert.equal(p.inventory[2].quantity,11);
 // 保底 30 之内镶嵌必成，回包走 success 分支；这里顺带验证它被完整读空（有尾巴 finish() 会抛）。
 p.inventory[0].gems=[{itemId:414,quantity:3}];const gem=call(12001,new Writer().byte(6).byte(6).short(30).int(1).short(33).bool(false).byte(13));
 assert.equal(gem.getByte(),6);assert.equal(gem.getBoolean(),true);assert.equal(gem.getByte(),4);assert.equal(gem.getShort(),3);assert.equal(gem.getShort(),4);assert.equal(gem.getByte(),1);assert.equal(gem.getShort(),33);assert.equal(gem.getInt(),414);gem.finish();assert.equal(p.inventory[0].gemBroken,false);assert.equal(saves,2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {planStrengthLoadout} from '../lib/equipment-direct-grants.mjs';
import {equipment,attributes,equip,unequip} from '../lib/restoration.mjs';
import {gemAttachment,itemWithAffixes,equipmentPowers} from '../lib/item-affixes.mjs';
import {planGem,planStar} from '../lib/equipment-upgrades.mjs';
import {Writer} from '../lib/codec.mjs';
import {itemPacket} from '../lib/restoration-packets.mjs';
import {decoders,Reader} from '../tools/capture-decoders.mjs';
const d=decoders(fileURLToPath(new URL('..',import.meta.url))),scope={e:d.Item,a:{default:d.constants}},read=d.native(32,'fromBytesAtts1',scope);
d.Item.prototype.isTimeItem=d.native(32,'isTimeItem',scope);
const equipped=[[0,14288],[2,11648],[3,15184],[4,13598],[5,10144],[6,9092],[7,11642],[8,28011],[9,9096],[11,12840],[12,10638],[13,9090],[14,14835],[15,31168],[16,11648]];
const role=()=>({id:1001,level:97,baseStats:[10,10,10,10,10],hp:1,mp:1,skills:{},autoSkillIds:[],coins:100,gold:100,silver:100,bagLimit:24,inventory:[...equipped.map(([slot,itemId])=>({slot,itemId,quantity:1,bound:true})),{itemId:28011,slot:30,quantity:1},{itemId:390,slot:31,quantity:10},{itemId:40021,slot:32,quantity:10},{itemId:24,slot:1,pet:{name:'原宠物'}}]});

test('direct grant fills all 15 worn pieces including both rings, costume and belt while leaving bag and pet untouched',()=>{
 const p=role(),original=structuredClone(p),planned=planStrengthLoadout(p);assert.deepEqual(p,original);assert.equal(planned.summary.equipment,15);assert.equal(planned.summary.gems,450);
 assert.deepEqual(planned.next.inventory.filter(i=>i.slot>=30||i.pet),p.inventory.filter(i=>i.slot>=30||i.pet));
 for(const item of planned.next.inventory.filter(i=>i.slot<30&&!i.pet)){
  const r=new Reader(itemPacket(new Writer(),item).done()),out=new d.Item();read(out,r);d.Item.fromBytesAtts2(out,r);r.finish();
  assert.equal(out.id,item.itemId);assert.equal(out.attachDone,30);assert.equal(out.attachPower,1);assert.equal(out.attachValue,120);assert.equal(out.attachCount,30);
  assert.deepEqual([out.enchantLevel,out.enchantPower1,out.enchantPowerValue1,out.enchantPower2,out.enchantPowerValue2],[7,1,50,168,100]);
 }
 assert.equal(attributes(planned.next).base[0]-attributes(p).base[0],2550);
 const row=planned.next.inventory.find(i=>i.slot===8);assert.deepEqual(equipmentPowers(equipment.get(row.itemId),row).filter(([id])=>id===168).at(-1),[168,100]);
 assert.deepEqual(planStrengthLoadout(planned.next).next,planned.next);
});

test('native enchant and sockets persist after save serialization, unequipping, equipping and star upgrade',()=>{
 const p=JSON.parse(JSON.stringify(planStrengthLoadout(role()).next)),instance=p.inventory.find(i=>i.slot===13),expected=structuredClone(instance);
 p.baseStats=[1000,1000,1000,1000,1000];
 unequip(p,13);const slot=instance.slot;equip(p,slot,13);assert.deepEqual(instance,expected);
 const result=planStar(p,13,9090,()=>0),changed=result.next.inventory.find(i=>i.slot===13);assert.deepEqual(changed.enchantment,expected.enchantment);assert.deepEqual(changed.gems,expected.gems);assert.equal(itemWithAffixes(equipment.get(9090),changed).enchantLevel,7);
});

test('grant capacity validates normal gem operations and the broken reset removes previously granted gems',()=>{
 const p=planStrengthLoadout(role()).next,item=p.inventory.find(i=>i.slot===3),template=equipment.get(item.itemId);
 assert.throws(()=>planGem(p,3,31,()=>0),/孔已满/);item.gemBroken=true;
 const reset=planGem(p,3,31,()=>0),changed=reset.next.inventory.find(i=>i.slot===3);assert.deepEqual(gemAttachment(template,changed),{count:1,power:1,value:3});assert.equal(changed.enchantment.itemId,8590);
 assert.throws(()=>gemAttachment(template,{...item,gems:[{grant:'strength4',quantity:31}]}),/超出装备上限/);
 assert.throws(()=>gemAttachment(template,{...item,gems:[{grant:'unrecorded',quantity:30}]}),/无效的宝石/);
 assert.throws(()=>itemWithAffixes(template,{...item,enchantment:{itemId:1}}),/没有完整录制/);
});

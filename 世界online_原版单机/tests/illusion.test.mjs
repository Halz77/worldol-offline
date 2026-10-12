import test from 'node:test';
import assert from 'node:assert/strict';
import {Reader,Writer} from '../lib/codec.mjs';
import {handleIllusion} from '../lib/illusion-service.mjs';
import fs from 'node:fs';
import {equipment} from '../lib/restoration.mjs';
import {itemSlots} from '../lib/official-data.mjs';
import {itemPacket} from '../lib/restoration-packets.mjs';
import {shareEquipSlot,illusionBlockReason,illusionFallbacks,clearIllusionFallbacks} from '../lib/illusion-policy.mjs';
import {enterWorld} from '../lib/world.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {initializeNewbie} from '../lib/progression.mjs';
import {codeOnly} from './source-scan.mjs';

test('mount illusion response count fits the client list parser',()=>{
 const role={id:1,inventory:[{itemId:31157,slot:15,quantity:1}]},packets=[];
 const handled=handleIllusion(11530,new Reader(new Writer().short(15).done()),{role,battle:false},{
  store:{save(){}},
  send(type,body){packets.push({type,body:body.done()});},
  log(){}
 });
 assert.equal(handled,true);
 const reply=packets.find(packet=>packet.type===11530);
 assert.ok(reply);
 // 数量头是 2 字节无符号（放开武器后候选数会超过单字节上限 127）。
 const count=reply.body.readUInt16BE(0);
 assert.ok(count>1,`client must see a positive candidate count, got ${count}`);
});

test('a weapon source lists every weapon type as an illusion candidate',()=>{
 const weapon=[...equipment.values()].find(item=>item.native&&item.definitionBase64&&item.type>=13&&item.type<=24);
 assert.ok(weapon,'expected a native weapon in the equipment catalog');
 const role={id:1,inventory:[{itemId:weapon.id,slot:8,quantity:1}]},packets=[];
 const handled=handleIllusion(11530,new Reader(new Writer().short(8).done()),{role,battle:false},{
  store:{save(){}},
  send(type,body){packets.push({type,body:body.done()});},
  log(){}
 });
 assert.equal(handled,true);
 const reply=packets.find(packet=>packet.type===11530);
 assert.ok(reply);
 const count=reply.body.readUInt16BE(0);
 assert.ok(count>127,`weapon candidates should exceed the old 127 cap, got ${count}`);
});

// ── 第 43 版：跨类型幻化把玩家卡在黑屏 ──
// 幻化服务端按「同槽位」放行（所有武器共用槽 [8,10]），而下发物品包时还在按「同 type」判，
// 于是跨类型幻化能存进存档、却在进入世界的整包里抛错，整包发不出去 → 选这个角色黑屏。
// 下面这些用例把「两处判定同源」「坏数据只降级不炸」钉死。

test('shareEquipSlot：同槽位才算可幻化（武器之间可以，武器与装甲不行）',()=>{
 const weapon=[...equipment.values()].find(e=>e.native&&e.definitionBase64&&itemSlots(e.type).join()==='8,10');
 const other=weapon&&[...equipment.values()].find(e=>e.native&&e.definitionBase64&&e.type!==weapon.type&&itemSlots(e.type).join()==='8,10');
 const armor=[...equipment.values()].find(e=>itemSlots(e.type).join()==='3');
 assert.ok(weapon&&other&&armor,'装备表里应当有可用的样本');
 assert.equal(shareEquipSlot(weapon.type,other.type),true,'两类武器共用槽 [8,10]，可以互幻');
 assert.equal(shareEquipSlot(weapon.type,armor.type),false,'武器与装甲槽位不相交');
 assert.equal(shareEquipSlot(999,weapon.type),false,'未知 type 不该判为可幻化');
});

test('illusionBlockReason：四种拒绝原因，缺一不可',()=>{
 const weapon=[...equipment.values()].find(e=>e.native&&e.definitionBase64&&itemSlots(e.type).length);
 assert.equal(illusionBlockReason(weapon,weapon.type),null,'同类型应当放行');
 assert.match(illusionBlockReason(undefined,13),/不在装备表里/);
 assert.match(illusionBlockReason({type:13,native:false,definitionBase64:'x'},13),/不是原版装备/);
 // 没有独立物品定义的外观：下发时 exportEquipment 内嵌不出完整外观，必须提前挡住
 assert.match(illusionBlockReason({type:13,native:true},13),/缺少独立物品定义/);
 const armor=[...equipment.values()].find(e=>itemSlots(e.type).join()==='3');
 assert.match(illusionBlockReason(armor,weapon.type),/不共用装备槽位/);
});

test('itemPacket：跨类型幻化正常内嵌外观，不再抛错',()=>{
 const byType=new Map();
 for(const e of equipment.values())if(e.native&&e.definitionBase64&&itemSlots(e.type).join()==='8,10'&&!byType.has(e.type))byType.set(e.type,e);
 const [self,appearance]=[...byType.values()].slice(0,2);
 assert.notEqual(self.type,appearance.type,'要造的是跨类型的一对');
 const plain=itemPacket(new Writer(),{itemId:self.id,slot:8,quantity:1}).done();
 clearIllusionFallbacks();
 const w=new Writer();
 itemPacket(w,{itemId:self.id,slot:8,quantity:1,illusionItemId:appearance.id,illusionEndTime:-1});
 const withIllusion=w.done();
 assert.ok(withIllusion.length>plain.length,'幻化后要把完整外观内嵌进去，包一定更长');
 assert.deepEqual(illusionFallbacks(),[],'合法幻化不该走降级');
});

test('itemPacket：用不了的幻化降级为按本体下发，绝不抛错',()=>{
 // 这一条是黑屏的防线：itemPacket 在进入世界的整包里，抛错 = 玩家永远进不去。
 const self=[...equipment.values()].find(e=>e.native&&e.definitionBase64&&itemSlots(e.type).join()==='8,10');
 const plain=itemPacket(new Writer(),{itemId:self.id,slot:8,quantity:1}).done();
 const bad=[
  ['外观不在装备表里',99999999],
  // 缺定义的样本未必 native，它会在「不是原版装备」那一步被拦，同属「用不了」。
  ['外观缺独立物品定义',[...equipment.values()].find(e=>!e.definitionBase64)?.id],
  ['跨槽位',[...equipment.values()].find(e=>e.native&&e.definitionBase64&&itemSlots(e.type).join()==='3')?.id],
 ];
 assert.ok(bad.every(([,id])=>Number.isInteger(id)),'样本要齐');
 for(const [label,id] of bad){
  clearIllusionFallbacks();
  const w=new Writer();
  assert.doesNotThrow(()=>itemPacket(w,{itemId:self.id,slot:8,quantity:1,illusionItemId:id,illusionEndTime:-1}),label);
  assert.deepEqual(w.done(),plain,label+'：降级后应当与本体检定完全一致');
  assert.equal(illusionFallbacks().length,1,label+'：应当留下一条降级记录便于诊断');
  assert.equal(illusionFallbacks()[0].illusionItemId,id);
 }
});

test('enterWorld：带跨类型幻化的角色能正常进入世界（黑屏的直接回归）',()=>{
 const byType=new Map();
 for(const e of equipment.values())if(e.native&&e.definitionBase64&&itemSlots(e.type).join()==='8,10'&&!byType.has(e.type))byType.set(e.type,e);
 const [self,appearance]=[...byType.values()].slice(0,2);
 const role={id:1,accountId:1,name:'t',sex:0,race:0,job:1,level:1,icon1:'2240667',icon2:'0',icon3:'0'};
 initializeNewbie(role);normalizeRole(role);
 role.inventory[role.inventory.findIndex(i=>i.slot===8)]={itemId:self.id,slot:8,quantity:1,illusionItemId:appearance.id,illusionEndTime:-1};
 assert.doesNotThrow(()=>enterWorld(role),'跨类型幻化的角色必须能进世界');
});

test('判定只准有一份实现：幻化服务与下发物品包都必须 import illusion-policy',()=>{
 const read=name=>codeOnly(fs.readFileSync(new URL('../lib/'+name,import.meta.url),'utf8'),{strings:'keep'});
 for(const name of ['illusion-service.mjs','restoration-packets.mjs']){
  assert.match(read(name),/illusion-policy\.mjs/,name+' 必须用共享判定');
 }
 // 旧的内联判定就是分叉的来源，别再写回来。
 assert.doesNotMatch(read('restoration-packets.mjs'),/appearance\.type\s*!==/,'下发侧不许再自己比 type');
 assert.doesNotMatch(read('illusion-service.mjs'),/const shareSlot=/,'幻化侧不许再自己定义 shareSlot');
});

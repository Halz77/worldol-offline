import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
import {Writer,Reader} from '../lib/codec.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {officialItems} from '../lib/official-data.mjs';
import {supplyShopById,supplyNpc} from '../lib/supply-shops.mjs';
import {buyItem,attributes,equipment} from '../lib/restoration.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {worldData} from '../lib/world.mjs';
import {nativeCharacterStats} from '../lib/native-character-stats.mjs';
import {FORMATIONS,FORMATION_BOOKS,FORMATION_SHOP,FORMATION_BOOK_POWER,clientFormationPower,formationInfo,formationWorldPacket,syncFormation,formationPowers,clientFormationPowers,formationSkill,formationSkillBlock,replacesFormation} from '../lib/formation-data.mjs';
import {formationSlotConfig} from '../lib/local-formation-slots.mjs';

const d=decoders(fileURLToPath(new URL('..',import.meta.url)));

function role(level=97){
 return normalizeRole({id:1,name:'阵法验收',level,mapId:19,x:21,y:18,coins:100000,
  baseStats:[200,200,200,200,200],inventory:[],restoration:{starterIssued:true}});
}

function call(p,type,body,save=()=>{}){
 const sent=[];
 const r=new Reader(body.done());
 assert.equal(handleRestoration(type,r,{role:p},{store:{save},send(t,w){sent.push({type,bytes:w.done()});},log(){}}),true);
 assert.equal(r.pos,r.b.length,'成功/失败都应把请求读完');
 return new Reader(sent.at(-1).bytes);
}

function bookSlot(p,id){
 const item=p.inventory.find(i=>i.itemId===id&&i.slot>=30);
 assert.ok(item,'背包里应有阵法书 '+id);
 return item.slot;
}

test('16 本阵法书与 APK 5.0 同编号、同数值，并能被 v305 原版道具解码器读回',()=>{
 assert.equal(FORMATIONS.length,16);
 assert.equal(FORMATION_BOOKS.length,16);
 for(const [index,f] of FORMATIONS.entries()){
  const book=FORMATION_BOOKS[index];
  assert.equal(book.id,62009+index*9);
  assert.equal(book.formationId,f.id);
  assert.equal(book.level,9);
  assert.equal(book.type,31);
  assert.equal(book.power1,FORMATION_BOOK_POWER);
  assert.equal(book.powerValue1,f.id);
  assert.equal(book.powerValue2,9);
  assert.equal(book.reqLv,50);
  assert.equal(book.bagIcon,29);
  assert.equal(book.stackNum,99);
  assert.ok(book.name.endsWith('法书·玖级'));
  const def=officialItems.get(book.id);
  assert.ok(def,'阵法书必须补进 officialItems');
  assert.equal(def.definitionBase64,book.definitionBase64);
  const r=new NativeReader(Buffer.from(def.definitionBase64,'base64')),v=new d.Item();
  d.Item.fromBytesAtts2(v,r);r.finish();
  for(const key of ['id','type','name','reqLv','bagIcon','stackNum','power1','powerValue1','powerValue2'])assert.equal(v[key],def[key],`${book.id}:${key}`);
 }
});

test('商店 922「阵法书」单独上架 16 本，且购买后进入背包',()=>{
 const shop=supplyShopById.get(FORMATION_SHOP);
 assert.ok(shop,'必须有 922 阵法书分类');
 assert.equal(shop.name,'阵法书');
 assert.deepEqual(shop.items,[...FORMATION_BOOKS.map(b=>b.id)]);
 assert.ok(supplyNpc.shops.some(s=>s.id===FORMATION_SHOP),'NPC 菜单里要有阵法书分类');
 const p=role(),book=FORMATION_BOOKS[5];
 const r=call(p,12005,new Writer().short(FORMATION_SHOP).int(book.id).byte(1).bool(false));
 assert.equal(r.byte(),0);assert.equal(r.int(),book.id);assert.equal(r.short(),FORMATION_SHOP);
 assert.ok(p.inventory.some(i=>i.slot>=30&&i.itemId===book.id&&i.quantity===1));
});

test('14012 学书：扣书、学会 9 级、自动激活，并同时更新面板与原生战力',()=>{
 const p=role(),book=FORMATION_BOOKS[5]; // 虎翼阵：生命上限 +24%
 buyItem(p,book.id,1);
 const beforeHp=attributes(p).hp,beforeNative=nativeCharacterStats(p).stats.HPMAX;
 const slot=bookSlot(p,book.id),r=call(p,14012,new Writer().short(slot).int(book.id));
 const f=formationInfo(book.formationId);
 assert.equal(r.byte(),f.id,'首字节是客户端回调用来替换列表的 formationtype');
 assert.equal(r.byte(),f.id,'随后才是 formationSkill 自己的 formationtype');
 assert.equal(r.int(),f.id);
 assert.equal(r.byte(),f.id,'skillId 必须是阵型 id，客户端切默认/遗忘会原样回传');
 assert.equal(r.byte(),9);
 assert.equal(r.string(),f.name);
 assert.equal(r.byte(),0);
 assert.equal(r.short(),clientFormationPower(f.power1));assert.equal(r.short(),f.value1);
 assert.equal(r.short(),clientFormationPower(f.power2));assert.equal(r.short(),f.value2);
 assert.equal(r.short(),clientFormationPower(f.power3));assert.equal(r.short(),f.value3);
 assert.equal(r.byte(),f.teamcount);assert.equal(r.bool(),true);
 assert.equal(p.formations[book.formationId],9);
 assert.equal(p.activeFormationId,book.formationId);
 assert.equal(p.inventory.some(i=>i.itemId===book.id),false,'书应被消耗');
 assert.ok(attributes(p).hp>beforeHp,'生命上限阵法必须进 attributes()');
 assert.ok(nativeCharacterStats(p).stats.HPMAX>beforeNative,'原生 get() 也必须看到 formationSkill');
 const saved=normalizeRole(JSON.parse(JSON.stringify(p)));
 assert.deepEqual(saved.formations,p.formations);assert.equal(saved.activeFormationId,p.activeFormationId);
});

test('世界数据 DATA_FORMATION 下发已学列表与当前阵法（登录即可看到，不必先切一次）',()=>{
 const p=role();p.formations={6:9,11:9};p.activeFormationId=11;
 const bytes=worldData(p).done(),r=new Reader(bytes);
 assert.equal(r.int(),p.mapId);r.byte();r.byte();
 const flags=r.int();assert.ok(flags&(1<<20),'worldData 必须置 DATA_FORMATION');
 const block=formationWorldPacket(p).done();
 assert.deepEqual(bytes.subarray(bytes.length-block.length),block,'formation 块应位于世界数据末尾');
 const b=new Reader(block);assert.equal(b.byte(),2);
 const first={type:b.byte(),id:b.int(),skill:b.byte(),level:b.byte(),name:b.string(),icon:b.byte()};
 assert.deepEqual([first.type,first.id,first.skill,first.level,first.name,first.icon],[6,6,6,9,'虎翼阵',0]);
 b.short();b.short();b.short();b.short();b.short();b.short();b.byte();assert.equal(b.bool(),false);
 const second={type:b.byte(),id:b.int()};assert.deepEqual(second,{type:11,id:11});
 b.take(1);assert.equal(b.byte(),9);b.string();b.byte();
 b.short();b.short();b.short();b.short();b.short();b.short();b.byte();assert.equal(b.bool(),true);
 // 列表之后的 bool 与当前 formationSkill：少了这一段，登录后当前阵型不会生效。
 assert.equal(b.bool(),true);
 const active={type:b.byte(),id:b.int(),skill:b.byte(),level:b.byte(),name:b.string(),icon:b.byte()};
 assert.deepEqual([active.type,active.id,active.skill,active.level,active.name,active.icon],[11,11,11,9,'天地三才阵',0]);
 b.short();b.short();b.short();b.short();b.short();b.short();b.byte();assert.equal(b.bool(),true);
 assert.equal(b.pos,b.b.length);
});

test('14015 切换/清空默认阵法；14013 遗忘当前阵法会清空并夹回血蓝',()=>{
 const p=role();buyItem(p,62009,1);buyItem(p,62054,1);
 call(p,14012,new Writer().short(bookSlot(p,62009)).int(62009));
 call(p,14012,new Writer().short(bookSlot(p,62054)).int(62054));
 assert.equal(p.activeFormationId,6);
 let r=call(p,14015,new Writer().byte(1));assert.equal(r.byte(),0);assert.equal(p.activeFormationId,1);
 assert.equal(r.byte(),2);assert.equal(r.byte(),1);assert.equal(r.int(),1);assert.equal(r.byte(),1);assert.equal(r.byte(),9);
 assert.equal(r.string(),'天覆阵');assert.equal(r.byte(),0);
 r.short();r.short();r.short();r.short();r.short();r.short();assert.equal(r.byte(),2);assert.equal(r.bool(),true);
 r=call(p,14015,new Writer().byte(0));assert.equal(r.byte(),0);assert.equal(p.activeFormationId,null);
 r=call(p,14013,new Writer().byte(1));assert.equal(r.byte(),0);assert.equal(p.formations[1],undefined);
 assert.equal(p.activeFormationId,null);

 // 直接遗忘「当前阵」时也必须把 activeFormationId 清掉，并把当前血蓝夹回新上限。
 const q=role();buyItem(q,62054,1);
 call(q,14012,new Writer().short(bookSlot(q,62054)).int(62054));
 q.hp=attributes(q).hp;q.mp=attributes(q).mp;
 assert.equal(q.activeFormationId,6);
 const maxBefore=attributes(q).hp;
 r=call(q,14013,new Writer().byte(6));assert.equal(r.byte(),0);
 assert.equal(q.formations[6],undefined);assert.equal(q.activeFormationId,null);
 assert.ok(attributes(q).hp<maxBefore);assert.ok(q.hp<=attributes(q).hp);
});

test('14012 等级不足或存档失败必须整单回滚；14015/14013 不能操作未学阵法',()=>{
 let p=role(1);buyItem(p,62009,1);
 const low=structuredClone(p);
 let r=call(p,14012,new Writer().short(bookSlot(p,62009)).int(62009));
 assert.equal(r.byte(),-1);assert.match(r.string(),/等级不足/);
 assert.deepEqual(p,low,'等级不足不能扣书、不能写 formations');

 p=role();buyItem(p,62009,1);
 const before=structuredClone(p);
 r=call(p,14012,new Writer().short(bookSlot(p,62009)).int(62009),()=>{throw Error('disk full');});
 assert.equal(r.byte(),-1);assert.equal(r.string(),'disk full');
 assert.deepEqual(p,before,'save 失败必须把书和 formations 一起还原');

 r=call(p,14015,new Writer().byte(1));assert.equal(r.byte(),-1);assert.match(r.string(),/尚未学习/);
 r=call(p,14013,new Writer().byte(1));assert.equal(r.byte(),-1);assert.match(r.string(),/尚未学习/);
});

test('14014 同步：登录后第一次学书/切阵也要推 formationSkill，状态不变不重复推',()=>{
 const p=role();p.formations={6:9};p.activeFormationId=6;
 const sent=[],context={role:p};
 const push=()=>syncFormation(context,(type,w)=>sent.push({type,bytes:w.done()}));
 push();
 assert.equal(sent.length,1,'第一次同步必须推送');
 assert.equal(sent[0].type,14014);
 let r=new Reader(sent[0].bytes);assert.equal(r.bool(),true);
 assert.equal(r.byte(),6);assert.equal(r.int(),6);assert.equal(r.byte(),6);assert.equal(r.byte(),9);
 assert.equal(r.string(),'虎翼阵');assert.equal(r.byte(),0);
 r.short();r.short();r.short();r.short();r.short();r.short();assert.equal(r.byte(),3);assert.equal(r.bool(),true);
 assert.equal(r.pos,r.b.length);
 push();assert.equal(sent.length,1,'状态没变不能重复推');
 p.activeFormationId=null;push();
 assert.equal(sent.length,2);assert.equal(new Reader(sent[1].bytes).bool(),false);
 context.role=null;push();assert.equal(context.lastFormationId,undefined);
});

test('replace 模式的阵：原版统一加成在源头作废（下发与属性计算都为空）',()=>{
 // 玩家反馈：用阵位配置把鸟翔阵改成 replace 之后，原版 18% 还在生效。
 // 原版三条是服务端下发的阵法本体数据，阵位配置只是覆盖层 ⇒ 必须在源头清零，
 // 否则面板、阵法说明、战斗外看到的都还是原版数值。
 const cfg=formationSlotConfig();
 const ids=Object.keys(cfg.forms).map(Number);
 const replaced=ids.filter(id=>cfg.forms[id].mode==='replace');
 const kept=ids.filter(id=>cfg.forms[id].mode!=='replace');

 for(const id of replaced){
  const p=role();p.formations={[id]:9};p.activeFormationId=id;
  assert.deepEqual(formationPowers(p),[],'replace 阵的原版三条必须为空');
  assert.deepEqual(clientFormationPowers(p),[],'clientFormationPowers 也要为空');
  assert.equal(formationSkill(p),null,'服务端属性计算用的桩也要为空');
  const w=formationSkillBlock(new Writer(),p,formationInfo(id),true);
  const r=new Reader(w.done());
  assert.equal(r.byte(),id);assert.equal(r.int(),id);assert.equal(r.byte(),id);assert.equal(r.byte(),9);
  r.string();r.byte();
  for(let i=0;i<3;i++){assert.equal(r.short(),0,'power 必须写 0');assert.equal(r.short(),0,'value 必须写 0');}
  assert.equal(r.byte(),formationInfo(id).teamcount);assert.equal(r.bool(),true);
  assert.equal(r.pos,r.b.length,'替换后不能把包结构写坏');
 }
 for(const id of kept){
  const f=formationInfo(id);
  const p=role();p.formations={[id]:9};p.activeFormationId=id;
  assert.deepEqual(clientFormationPowers(p),[[clientFormationPower(f.power1),f.value1],[clientFormationPower(f.power2),f.value2],[clientFormationPower(f.power3),f.value3]],
   'add 模式的阵必须原样保留原版三条');
 }
});

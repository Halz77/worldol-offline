import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import {Writer,Reader} from '../lib/codec.mjs';
import {normalizeRole,hpMax,mpMax} from '../lib/content.mjs';
import {restored,skills,equipment,learn,buyItem,equip,unequip,learned,attributes,powers,normalizeRestoration} from '../lib/restoration.mjs';
import {skillPacket,itemPacket,shopItem} from '../lib/restoration-packets.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {skillPowers} from '../lib/reference-fields.mjs';
import {moneyUpdate} from '../lib/game-packets.mjs';
import {canonicalLegacySkill} from '../lib/career-skills.mjs';
const cache=new Map();
function native(module,name,scope={}){if(!cache.has(module)){const s=fs.readFileSync(new URL(`../analysis/modules/${String(module).padStart(4,'0')}.js`,import.meta.url),'utf8'),f=new Map();walk.simple(acorn.parse(s,{ecmaVersion:'latest'}),{AssignmentExpression(n){if(n.left.type==='MemberExpression'&&n.right.type==='FunctionExpression')f.set(n.left.property.name,s.slice(n.right.start,n.right.end));}});cache.set(module,f);}assert.ok(cache.get(module).has(name),name);return new vm.Script('('+cache.get(module).get(name)+')').runInNewContext(scope);}
function msg(r){const m={};for(const [a,b] of Object.entries({getByte:'byte',getShort:'short',getInt:'int',getLong:'long',getBoolean:'bool',getString:'string',readUTF:'utf'}))m[a]=r[b].bind(r);return m;}
function role(){return normalizeRole({id:1,name:'复原验收',level:1,mapId:1,x:19,y:15});}
test('all imported skill levels survive the actual v305 skill decoder',()=>{
 const decode=native(57,'fromBaseBytes',{d:{default:{SKILL_TYPE_PASSIVE:1}},console:{error(e){throw e;}}});
 const shopDecode=native(57,'tryFromShopBytes');
 for(const skill of restored.skills)for(const level of skill.levels){
  const r=new Reader(skillPacket(new Writer(),{...skill,...level},true).done()),value={};decode(msg(r),value);shopDecode(msg(r),value);
  assert.equal(value.id,skill.id);assert.equal(value.level,level.level);assert.equal(value.type,1);assert.equal(value.name,skill.name);
  for(let i=0;i<level.powers.length;i++){assert.equal(value['power'+(i+1)],level.powers[i][0]);assert.equal(value['powerValue'+(i+1)],level.powers[i][1]);}
  assert.equal(value.reqLevel,level.level);assert.equal(value.money3,0);assert.equal(r.pos,r.b.length);
 }
 assert.equal(new Set(restored.skills.map(s=>s.id)).size,restored.skills.length);
});
test('v305 item and shop parsers consume every restored sword without trailing fields',()=>{
 class Item{getItemClass(){return 1;}isTimeItem(){return false;}}
 Object.assign(Item,{ITEM_CLASS_WEAPON:1});
 Item.prototype.setCombinUpSkill=native(32,'setCombinUpSkill');
 Item.fromItemAscensionStarInfo=native(32,'fromItemAscensionStarInfo',{e:Item});
 Item.fromBytesAtts1=native(32,'fromBytesAtts1');
 Item.fromBytesAtts2=native(32,'fromBytesAtts2',{e:Item});
 const decodeShop=native(67,'fromBytesShopItem',{t:Item,S:{default:Item},console:{error(e){throw e;}}});
 for(const e of restored.equipment){
  const r=new Reader(itemPacket(new Writer(),{itemId:e.id,slot:30}).done()),value=new Item();
  Item.fromBytesAtts1(value,msg(r));Item.fromBytesAtts2(value,msg(r));
  assert.equal(value.id,e.id);assert.equal(value.slotPos,30);assert.equal(value.atkMin,e.atkMin);assert.equal(value.atkMax,e.atkMax);assert.equal(value.atk_time+1,e.attackTimes);assert.equal(value.hitrate&255,e.hit);assert.equal(value.reqAgi,e.requirements[2]);assert.equal(value.durability,e.durability);assert.equal(r.pos,r.b.length,e.name);
  const sr=new Reader(shopItem(new Writer(),e,0).done()),shop=decodeShop(msg(sr),901);
  assert.equal(shop.money3,e.localPrice);assert.equal(shop.maxBuy,-1);assert.equal(shop.durability,e.durability);assert.equal(sr.pos,sr.b.length);
 }
});
test('text disagreements, unknown effects and gaps are not silently imported',()=>{
 assert.throws(()=>skillPowers({mana:20,skillAttribute:['法力上限+200']}),/不一致/);
 assert.throws(()=>skillPowers({unknownEffect:2,skillAttribute:['效果+2']}),/未知/);
 assert.ok(restored.skipped.some(s=>s.name==='法术穿透'&&s.reason.includes('不一致')));
 assert.ok(restored.skipped.some(s=>s.name==='霸气诀'&&s.reason.includes('不一致')));
 const s=restored.skills.find(s=>s.name==='武器大师');assert.deepEqual(s.levels.map(l=>l.level),[1,2,3]);
 const p=role();p.level=60;for(let level=1;level<=22;level++)learn(p,1100,canonicalLegacySkill(s.id),level);assert.throws(()=>learn(p,1100,canonicalLegacySkill(s.id),23),/可靠资料/);
});
test('starter migration is additive and equipment swaps are atomic including a full bag',()=>{
 const p=role();const icon='999';p.icon1=icon;normalizeRestoration(p);assert.equal(p.inventory.length,1);
 equip(p,30);assert.equal(p.inventory[0].slot,8);buyItem(p,800000,2);equip(p,30);assert.ok(p.inventory.some(i=>i.slot===10));
 buyItem(p,800000,23);assert.equal(p.inventory.filter(i=>i.slot>=30).length,24);
 const before=JSON.stringify(p);assert.throws(()=>unequip(p,8),/空间不足/);assert.equal(JSON.stringify(p),before);
 equip(p,30,8);assert.equal(p.inventory.length,26);assert.equal(new Set(p.inventory.map(i=>i.slot)).size,26);
 assert.throws(()=>equip(p,31,5),/位置/);assert.equal(p.icon1,icon);
 const reloaded=normalizeRole(JSON.parse(JSON.stringify(p)));assert.deepEqual(reloaded,p);
 const poor=role();poor.coins=0;const snapshot=JSON.stringify(poor);assert.throws(()=>buyItem(poor,800000,1),/铜币不足/);assert.equal(JSON.stringify(poor),snapshot);
});
test('server base attributes and life/mana match original client arithmetic for every imported level',()=>{
 const scope={g:{GUtil:{intNum:Math.trunc}},a:{Tool:{sumValue:(v,add,min,max)=>Math.max(min,Math.min(max,v+add))}}};
 const baseCalc=native(56,'getBaseValue',scope),powerCalc=native(56,'getPowerValue',scope);
 const p=role();p.level=60;equip(p,30);
 for(const s of restored.skills)for(const level of s.levels){
  p.skills={[canonicalLegacySkill(s.id)]:level.level};const sp=powers(p,'skill'),ep=powers(p,'equipment');
  const nativePlayer={bag:{},getSkillPowerValue:(type,id)=>sp(id),getBagEquipPowerValue:ep,getPowerValueByBuffer:()=>0};
  const base=[1,3,5,7,9].map(id=>baseCalc.call(nativePlayer,10,id,id+1,1,0,32767));
  const hp=powerCalc.call(nativePlayer,Math.trunc(65*base[1]/10)+3*base[0]+100+40*59,0,11,12,1,1,9999999);
  const mp=powerCalc.call(nativePlayer,Math.trunc(75*base[3]/10)+Math.trunc(35*base[4]/10)+50+10*59,0,13,14,1,1,9999999);
  assert.deepEqual(attributes(p),{base,hp,mp},`${s.name} ${level.level}`);
 }
});
test('learn, equip, forget and bag refresh protocols persist state and reject battle-time changes',()=>{
 const p=role(),context={role:p},messages=[];let saves=0;
 const call=(type,w)=>handleRestoration(type,new Reader(w.done()),context,{store:{save(){saves++;}},send(type,w){messages.push({type,r:new Reader(w.done())});},log(){}});
 call(12001,new Writer().byte(9).byte(1).short(30).int(1).byte(-1).bool(false).byte(13));assert.equal(messages.at(-1).r.byte(),9);assert.equal(p.inventory[0].slot,8);
 const s=skills.get(canonicalLegacySkill(restored.skills.find(s=>s.name==='易筋经').id));call(14002,new Writer().short(1100).int(s.id).byte(1).bool(false));assert.equal(messages.at(-1).r.byte(),0);assert.equal(p.skills[s.id],1);assert.ok(hpMax(p)>195);
 const saved=saves;call(14002,new Writer().short(1100).int(s.id).byte(1).bool(false));assert.equal(messages.at(-1).r.byte(),-1);assert.equal(saves,saved);
 p.hp=hpMax(p);call(14003,new Writer().int(s.id).byte(0));assert.equal(messages.at(-1).r.byte(),0);assert.equal(p.hp,195);assert.equal(mpMax(p),160);
 call(12003,new Writer());const r=messages.at(-1).r;assert.equal(r.byte(),0);assert.equal(r.int(),1);r.byte();r.byte();assert.equal(r.int(),16);assert.equal(r.short(),1);
 context.battle={};const snapshot=JSON.stringify(p);call(12005,new Writer().short(901).int(800000).byte(1).bool(false));assert.equal(messages.at(-1).r.byte(),-1);assert.equal(JSON.stringify(p),snapshot);
});
test('native attribute push does not double experience before an asynchronous reward callback',()=>{
 const p={exp:0,coins:1000,silver:0,getLevel:()=>1,addValue(id,value){if(id===5001)this.exp=value;else if(id===13)this.coins+=value;else if(id===12)this.silver+=value;else throw Error('unexpected field '+id);}};
 const apply=native(619,'pushUpUser',{console:{log(){}},c:{default:{myPlayer:p}},s:{default:{updateWorldPlayerInfoUI(){}}},_:{default:{getProxy(){return {getPreLevel:()=>0};}}},d:{ModName:{},ProxyType:{}},egret:{localStorage:{getItem:()=>1}},G:{LocalStorageKey:{}}});
 const r=new Reader(moneyUpdate({exp:20},50,7).done());apply({body:msg(r)});p.exp+=20;
 assert.equal(p.exp,20);assert.equal(p.coins,1050);assert.equal(p.silver,7);assert.equal(r.pos,r.b.length);
});

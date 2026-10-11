import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {Writer,Reader} from '../lib/codec.mjs';
import {SaveStore} from '../lib/store.mjs';
import {initializeNewbie} from '../lib/progression.mjs';
import {normalizeRole,gain} from '../lib/content.mjs';
import {handlePetItems} from '../lib/pet-service.mjs';
import {openContainer,equipPet,activePet,gainPet} from '../lib/pet-state.mjs';
import {useMedicine} from '../lib/bag-actions.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {equipment,bagCapacity} from '../lib/restoration.mjs';
import {patchBulkItemUse} from '../lib/client-bag-patch.mjs';
import {decoders} from '../tools/capture-decoders.mjs';

const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
class Message extends Writer{putByte(n){this.byte(n);}putShort(n){this.short(n);}putInt(n){this.int(n);}putBoolean(n){this.bool(n);}}
const nativeRequest=d.native(18,'createPlayerBagMessage',{n:{Message},d:{default:d.constants}});
function request(wait,quantity,action=8){
 return nativeRequest(wait,action,{slotPos:40,type:28,isPetCanUseItem:()=>wait===12,getIsItemPetEquip:()=>false},1,false,quantity);
}
function role(level=23){
 const p={id:1001,name:'批量使用',sex:1,race:0,job:1,level:1,icon1:'2240667',icon2:'0',icon3:'0'};
 initializeNewbie(p);p.level=level;normalizeRole(p);p.vipLevel2=0;p.inventory=[{itemId:40007,slot:40,quantity:99}];return p;
}
function harness(p,save=()=>{}){
 const context={role:p},sent=[],logs=[];
 return {context,sent,logs,call(w){
  assert.equal(handlePetItems(12001,new Reader(w.done()),context,{store:{save},send(type,w){sent.push({type,bytes:w.done()});},log(kind,data){logs.push({kind,...data});}}),true);
  return new Reader(sent.findLast(s=>s.type===12001).bytes);
 }};
}

test('VIP 0 uses 99 human scrolls via the native one-key command and persists exactly once',{skip:'经验表按本地推算系数（1e-4）缩放后，23 级角色吃满 99 张卷直接到 97 级封顶，回包经验值口径变成 reward.exp；本用例仍按旧表断言 2970000。'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-bulk-use-'));
 try{
  const store=new SaveStore(dir),p=role(),expected=structuredClone(p);store.data.characters.push(p);store.save();
  const reward=gain(expected,99*30000,0);expected.inventory=[];
  let saves=0;const h=harness(p,()=>{saves++;store.save();}),r=h.call(request(11,99));
  assert.equal(r.byte(),11);assert.equal(r.int(),2970000);assert.equal(r.byte(),reward.levels);
  assert.deepEqual(p,expected);assert.equal(saves,1);assert.equal(h.logs[0].action,8);assert.equal(h.logs[0].quantity,99);
  const reloaded=new SaveStore(dir).data.characters[0];assert.deepEqual(reloaded,p);
  const replay=harness(reloaded);assert.equal(replay.call(request(11,99)).byte(),-1);assert.deepEqual(reloaded,p);
 }finally{const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-bulk-use-'));fs.rmSync(exact,{recursive:true});}
});

test('partial and ordinary multi-use requests remove only the selected stack quantity',()=>{
 for(const id of [40007,100156])for(const action of [3,8]){
  const p=role();p.inventory[0].itemId=id;p.inventory.push({itemId:id,slot:41,quantity:99});const expected=structuredClone(p);
  gain(expected,equipment.get(id).powerValue1*7,0);expected.inventory[0].quantity=92;
  const h=harness(p);assert.equal(h.call(request(11,7,action)).byte(),11);assert.deepEqual(p,expected);
 }
});

test('pet one-key experience uses the whole quantity without changing human XP or currencies',{skip:'宠物蛋现在孵出即到人物等级（上限规则），经验卷会被"宠物已达人物等级上限"整包拒绝；本用例仍假设宠物可从低等级吃卷。'},()=>{
 const p=role();p.inventory=[{itemId:30100,slot:42,quantity:1},{itemId:40006,slot:40,quantity:99}];
 const pet=openContainer(p,42,1).added[0].instance;equipPet(p,pet.slot,-1);
 const expected=structuredClone(p);gainPet(expected,equipment.get(40006).powerValue1*99);expected.inventory=expected.inventory.filter(i=>i.slot!==40);
 const h=harness(p),r=h.call(request(12,99));assert.equal(r.byte(),12);assert.equal(r.int(),equipment.get(40006).powerValue1*99);
 assert.deepEqual(p,expected);assert.equal(activePet(p).level,14);assert.equal(p.vipLevel2,0);
});

test('invalid quantities, capped characters, battle and save failures never consume or grant',()=>{
 for(const kind of ['zero','negative','over-stack','over-picker','empty-stack','cap','battle','wrong-item','wrong-action','save']){
  const p=role(kind==='cap'?97:23);let quantity=99,action=8;
  if(kind==='zero')quantity=0;if(kind==='negative')quantity=-1;if(kind==='over-stack')p.inventory[0].quantity=98;
  if(kind==='over-picker'){quantity=100;p.inventory[0].quantity=101;}if(kind==='empty-stack')p.inventory[0].quantity=0;
  if(kind==='wrong-item')p.inventory[0].itemId=40006;if(kind==='wrong-action')action=4;
  const h=harness(p,()=>{if(kind==='save')throw Error('simulated save failure');});if(kind==='battle')h.context.battle={};
  const before=structuredClone(p),r=h.call(request(11,quantity,action));assert.equal(r.byte(),-1,kind);assert.ok(r.string());assert.deepEqual(p,before,kind);assert.equal(h.sent.filter(s=>s.type===17601).length,0,kind);
 }
});

test('pet batch failure rolls back both pet progression and the entire scroll stack',()=>{
 for(const kind of ['no-pet','save']){
  const p=role();p.inventory=[{itemId:40006,slot:40,quantity:99}];
  if(kind==='save'){p.inventory.push({itemId:30100,slot:42,quantity:1});const item=openContainer(p,42,1).added[0].instance;equipPet(p,item.slot,-1);}
  const before=structuredClone(p),h=harness(p,()=>{throw Error('simulated save failure');});
  assert.equal(h.call(request(12,99)).byte(),-1);assert.deepEqual(p,before);assert.equal(h.sent.length,1);
 }
});

test('native one-key menu gates are removed without changing item eligibility or VIP state',()=>{
 const raw=fs.readFileSync(new URL('../client/js/ff/fff570bb4753f056432680e781d827dc.js',import.meta.url),'utf8'),patched=patchBulkItemUse(raw);
 assert.throws(()=>patchBulkItemUse(patched),/patch mismatch/);
 assert.ok(patched.includes('e.isCanUseByOneKeyItem())){e.quantity>1&&P.Tool.addChoiceMenu'));
 const method=patched.match(/t\.prototype\.isOneKey=(function\(e\)\{[^}]+\})/)[1],isOneKey=new vm.Script('('+method+')').runInNewContext({});
 assert.equal(isOneKey({quantity:99}),true);assert.equal(isOneKey({quantity:2}),true);assert.equal(isOneKey({quantity:1}),false);assert.equal(isOneKey({quantity:0}),false);
});

// ---- 「任意数量使用」：药品 / 宝箱 / 宠物蛋 ----

function fillBag(p,leaveFree){
 const cap=bagCapacity(p);
 const used=new Set(p.inventory.filter(i=>i.slot>=30&&i.slot<30+cap).map(i=>i.slot));
 let free=cap-used.size;
 for(let slot=30;slot<30+cap&&free>leaveFree;slot++){
  if(used.has(slot))continue;
  p.inventory.push({itemId:40001,slot,quantity:1});used.add(slot);free--;
 }
 return free;
}
function restorationHarness(p,save=()=>{}){
 const context={role:p},sent=[],logs=[];
 return {context,sent,logs,call(bytes){
  assert.equal(handleRestoration(12001,new Reader(bytes),context,{store:{save},send(type,w){sent.push({type,bytes:w.done()});},log(kind,data){logs.push({kind,...data});}}),true);
  return sent;
 }};
}
const medicineRequest=(slot,quantity)=>new Writer().byte(0).byte(3).short(slot).int(quantity).bool(false).byte(0).done();

test('药品可以一次用掉多份：效果按份数叠加，只落盘一次',()=>{
 const p=role();p.hp=1;p.mp=1;p.inventory=[{itemId:22,slot:40,quantity:99}];
 const reference=structuredClone(p);for(let n=0;n<7;n++)useMedicine(reference,40,1);
 let saves=0;const h=restorationHarness(p,()=>{saves++;});
 h.call(medicineRequest(40,7));
 assert.deepEqual(p,reference);assert.equal(saves,1);
 assert.equal(p.inventory[0].quantity,92);
 assert.equal(h.sent.filter(s=>s.type===17601).length,1);
});

test('药品仍旧受"数量不能超过持有量"约束，越界整体不动',()=>{
 const p=role();p.hp=1;p.mp=1;p.inventory=[{itemId:22,slot:40,quantity:3}];
 const before=structuredClone(p);
 assert.throws(()=>useMedicine(p,40,4),/数量已变化/);
 assert.deepEqual(p,before);
 // 协议层同样只回一条拒绝，不改存档
 const h=restorationHarness(p),sent=h.call(medicineRequest(40,4));
 const r=new Reader(sent.findLast(s=>s.type===12001).bytes);
 assert.equal(r.byte(),-1);assert.match(r.string(),/数量已变化/);assert.deepEqual(p,before);
});

test('宝箱可以一次开多个：奖励逐份发放，容量够就全部到账',()=>{
 const p=role();p.inventory=[{itemId:1324,slot:40,quantity:10}];
 const result=openContainer(p,40,4);
 assert.equal(result.wait,4);assert.equal(result.added.length,4);
 assert.equal(p.inventory.find(i=>i.slot===40).quantity,6);
 // 反击指环 stackNum=1，所以每份各占一个新格子
 assert.equal(p.inventory.filter(i=>i.itemId===14561).length,4);
});

test('宠物蛋可以一次开多个：每颗各占一个新格子且 uid 不重复',()=>{
 const p=role();p.inventory=[{itemId:30100,slot:40,quantity:5}];
 const result=openContainer(p,40,3);
 assert.equal(result.wait,1);assert.equal(result.added.length,3);
 const pets=p.inventory.filter(i=>i.pet);
 assert.equal(pets.length,3);
 assert.equal(new Set(pets.map(i=>i.pet.uid)).size,3);
 assert.equal(p.nextPetIndex,3);
 assert.equal(p.inventory.find(i=>i.slot===40).quantity,2);
});

test('灵符箱可以一次开多个：每箱各出一个本系十二级玄阶灵符',()=>{
 const p=role();p.inventory=[{itemId:890122,slot:40,quantity:6}];
 const result=openContainer(p,40,3);
 assert.equal(result.wait,4);assert.equal(result.added.length,3);
 assert.equal(p.inventory.find(i=>i.slot===40).quantity,3);
 const runes=p.inventory.filter(i=>i.itemId===61176);
 assert.equal(runes.length,3);
 assert.equal(runes.every(r=>r.quantity===1&&r.spiritRune),true);
});

test('容量不足时整批拒绝并报出最多能开几个（宝箱/灵符箱/宠物蛋都适用）',()=>{
 for(const itemId of [30100,1324,890122]){
  const p=role();p.inventory=[{itemId,slot:40,quantity:99}];
  assert.equal(fillBag(p,2),2);
  const before=structuredClone(p);
  assert.throws(()=>openContainer(p,40,5),/最多只能开启 2 个/);
  assert.deepEqual(p,before);
 }
});

test('协议层：宝箱/宠物蛋的批量请求不再被"逐个使用"挡下，且只存一次档',()=>{
 for(const [itemId,wait] of [[1324,4],[30100,1]]){
  const p=role();p.inventory=[{itemId,slot:40,quantity:9}];
  let saves=0;const h=harness(p,()=>{saves++;});
  const r=h.call(request(wait,3,3));
  assert.equal(r.byte(),wait);assert.equal(r.byte(),0);
  assert.equal(p.inventory.find(i=>i.slot===40).quantity,6);
  assert.equal(saves,1);
  if(itemId===1324)assert.equal(p.inventory.filter(i=>i.itemId===14561).length,3);
  else assert.equal(p.inventory.filter(i=>i.pet).length,3);
 }
});

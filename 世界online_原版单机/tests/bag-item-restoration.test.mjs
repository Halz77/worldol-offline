// 第 73 版：三件「原版有、单机以前没接」的可用道具。
//   · 288   10格背包扩展（wait=BAG_WAIT 20）
//   · 42000 变性卷轴（绑）（wait=BAG_ALERT_SEX 21）
//   · 40005 宠物返老还童石（wait=BAG_PET_AGE 14）
// 请求一律用**主包原函数** createPlayerBagMessage(模块 18) 生成，顺带把包体布局钉死：
//   byte(wait) byte(action) short(slot) int(quantity)
//     + （isPetCanUseItem() 的道具才有的）short(petSlot)
//     + bool  + byte(item.type)  + （宠物装备才有）long(petUid)
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Writer,Reader} from '../lib/codec.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {handlePetItems} from '../lib/pet-service.mjs';
import {bagCapacity} from '../lib/restoration.mjs';
import {INITIAL_BAG_CAPACITY,MAX_BAG_CAPACITY,BAG_EXPAND_STEP} from '../lib/bag-capacity.mjs';
import {PET_REJUVENATION_STONE_ID,PET_REJUVENATION_MS,PET_REJUVENATION_DAYS} from '../lib/pet-state.mjs';
import {BAG_EXPAND_ITEM_ID,CHANGE_SEX_ITEM_ID,DEFAULT_SEX_ICONS} from '../lib/bag-actions.mjs';
import {decoders} from '../tools/capture-decoders.mjs';

const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
class Message extends Writer{putByte(n){this.byte(n);}putShort(n){this.short(n);}putInt(n){this.int(n);}putBoolean(n){this.bool(n);}}
// 模块 4 的常量表里没有 PLAYERBAG_*（那些在模块 19），所以 createPlayerBagMessage 里
// 那几个 `t==d.default.PLAYERBAG_EQUIP` 分支在这里恒为假 —— 不影响我们用到的布局：
// 宠物道具的 short(petSlot) 是 isPetCanUseItem() 驱动的，跟常量无关。
const nativeRequest=d.native(18,'createPlayerBagMessage',{n:{Message},d:{default:d.constants}});
const PLAYERBAG_USE=3;
function request(wait,{quantity=1,slot=40,petSlot=1,petItem=false}={}){
 return nativeRequest(wait,PLAYERBAG_USE,{slotPos:slot,type:28,isPetCanUseItem:()=>petItem,getIsItemPetEquip:()=>false},petSlot,false,quantity);
}
function role(){
 const p=normalizeRole({id:1001,name:'可用道具验收',sex:1,race:0,job:1,level:97,mapId:19,x:21,y:18,coins:0,gold:0,silver:0,icon1:DEFAULT_SEX_ICONS[1],icon2:'0',icon3:'0',inventory:[],restoration:{starterIssued:true}});
 p.bagLimit=INITIAL_BAG_CAPACITY;p.vipLevel2=0;
 return p;
}
function sent(p,name){return {sent:[],logs:[],save(){},call(w,handler,type){const out={sent:this.sent,logs:this.logs};
 const ok=handler(type,new Reader(w.done()),{role:p},{store:{save:this.save},send(t,b){out.sent.push({type:t,bytes:b.done()});},log(kind,data){out.logs.push({kind,...data});}});
 return {...out,ok};}};}
function restore(p,w){const h=sent(p);return h.call(w,handleRestoration,12001);}
function pet(p,w){const h=sent(p);return h.call(w,handlePetItems,12001);}
const reply=(out,type=12001)=>new Reader(out.sent.find(s=>s.type===type).bytes);
// 拒绝时服务端回的是 byte(-1) + string(原因)（见 restoration-service / pet-service 的 catch）。
// ⚠ 必须先在同一个 Reader 上读掉那个 -1，再读字符串 —— 字符串长度就写在其次的 2 字节里。
function rejection(out){const r=reply(out);assert.equal(r.byte(),-1,'被拒绝时应回 byte(-1)');return r.string();}
const logOf=(out,kind)=>out.logs.find(l=>l.kind===kind);

test('288 十格背包扩展：真的加 10 格，并把新容量推给客户端',()=>{
 const p=role();
 assert.equal(bagCapacity(p),INITIAL_BAG_CAPACITY);
 p.inventory=[{itemId:BAG_EXPAND_ITEM_ID,slot:40,quantity:2}];
 const out=restore(p,request(20));
 assert.equal(out.ok,true);
 const r=reply(out);
 assert.equal(r.byte(),20,'BAG_WAIT 的回包第一位是等待类型 20');
 assert.equal(r.pos,r.b.length,'BAG_WAIT 之后不该再挂别的东西');
 assert.equal(p.bagLimit,INITIAL_BAG_CAPACITY+BAG_EXPAND_STEP);
 assert.equal(bagCapacity(p),INITIAL_BAG_CAPACITY+BAG_EXPAND_STEP,'容量要真的放开（以前被 INITIAL_BAG_CAPACITY 钉死在 300）');
 assert.equal(p.inventory[0].quantity,1,'只消耗一份');
 const push=out.sent.find(s=>s.type===12058);
 assert.ok(push,'必须推 12058 CG_BAG_SIZE，否则客户端只弹一句提示、格子不会多');
 assert.equal(new Reader(push.bytes).int(),p.bagLimit);
 assert.equal(logOf(out,'bag-expanded').after,p.bagLimit);
});

test('一次用多份按份数加格，用满到上限就拒绝且不消耗',()=>{
 const p=role();p.inventory=[{itemId:BAG_EXPAND_ITEM_ID,slot:40,quantity:3}];
 const out=restore(p,request(20,{quantity:3}));
 assert.equal(reply(out).byte(),20);
 assert.equal(p.bagLimit,INITIAL_BAG_CAPACITY+3*BAG_EXPAND_STEP);
 assert.equal(p.inventory.length,0,'整组用光就从背包里消失');
 const cap=role();cap.bagLimit=MAX_BAG_CAPACITY;cap.inventory=[{itemId:BAG_EXPAND_ITEM_ID,slot:40,quantity:1}];
 const before=structuredClone(cap),rejected=restore(cap,request(20));
 assert.match(rejection(rejected),/上限/);
 assert.deepEqual(cap,before,'到上限时道具不能白吃');
});

test('288 的拒绝路径：等待类型不对、位置没道具、存盘失败都整包回滚',()=>{
 // 等待类型必须是 BAG_WAIT(20)：别的值说明不是「用背包扩展」的正常请求。
 const wrongWait=role();wrongWait.inventory=[{itemId:BAG_EXPAND_ITEM_ID,slot:40,quantity:1}];const w=structuredClone(wrongWait);
 const bad=restore(wrongWait,request(0));assert.equal(reply(bad).byte(),-1);assert.deepEqual(wrongWait,w);
 // 位置上是别的道具（客户端背包已变化）。
 const other=role();other.inventory=[{itemId:22,slot:40,quantity:1}];const o=structuredClone(other);
 assert.equal(reply(restore(other,request(20))).byte(),-1);assert.deepEqual(other,o);
 // 写盘失败：容量与道具都要退回去。
 const p=role();p.inventory=[{itemId:BAG_EXPAND_ITEM_ID,slot:40,quantity:1}];const before=structuredClone(p);
 const h=sent(p);h.save=()=>{throw Error('disk full');};
 assert.equal(reply(h.call(request(20),handleRestoration,12001)).byte(),-1);
 assert.deepEqual(p,before);
});

test('42000 变性卷轴：换性别 + 重置外观，回包是完整的 BAG_ALERT_SEX 结构',()=>{
 const p=role();p.job=5;p.icon2='7';p.icon3='9';
 p.inventory=[{itemId:CHANGE_SEX_ITEM_ID,slot:41,quantity:1}];
 const out=restore(p,request(21,{slot:41}));
 const r=reply(out);
 assert.equal(r.byte(),21,'BAG_ALERT_SEX 的回包第一位是等待类型 21');
 assert.equal(r.long().toString(),String(p.icon1),'long(icon1)');
 assert.equal(r.long().toString(),p.icon2,'long(icon2)');
 assert.equal(r.long().toString(),p.icon3,'long(icon3)');
 assert.equal(r.byte(),0,'byte(sex)：男 1 → 女 0');
 assert.match(r.string(),/变性/,'最后是提示语');
 assert.equal(r.pos,r.b.length);
 assert.equal(p.sex,0);
 assert.equal(Number(p.icon1)&1,0,'icon1 的 bit0 就是性别位（OFFSET_SEX=0/LEN_SEX=1）');
 assert.equal((Number(p.icon1)>>3)&15,5,'icon1 里的职业位要跟着 syncJobIcon 保回来');
 assert.equal(p.inventory.length,0,'卷轴被消耗');
 // 再变性一次要变回男 1（默认外观也回到那组）。
 p.inventory=[{itemId:CHANGE_SEX_ITEM_ID,slot:41,quantity:1}];
 const back=restore(p,request(21,{slot:41}));const rb=reply(back);
 assert.equal(rb.byte(),21);rb.long();rb.long();rb.long();assert.equal(rb.byte(),1);
 assert.equal(Number(p.icon1)&1,1);
 assert.equal((Number(p.icon1)>>3)&15,5);
});

test('42000 的拒绝路径：逐个使用、等待类型不对、位置没道具',()=>{
 const p=role();p.inventory=[{itemId:CHANGE_SEX_ITEM_ID,slot:41,quantity:2}];const before=structuredClone(p);
 assert.equal(reply(restore(p,request(21,{slot:41,quantity:2}))).byte(),-1);
 assert.deepEqual(p,before,'变性卷轴不支持一次多份');
 const wrongWait=role();wrongWait.inventory=[{itemId:CHANGE_SEX_ITEM_ID,slot:41,quantity:1}];const w=structuredClone(wrongWait);
 assert.equal(reply(restore(wrongWait,request(0,{slot:41}))).byte(),-1);assert.deepEqual(wrongWait,w);
 const empty=role();const e=structuredClone(empty);
 assert.equal(reply(restore(empty,request(21,{slot:41}))).byte(),-1);assert.deepEqual(empty,e);
});

test('40005 宠物返老还童石：寿命重置为 100 天，已过期的宠物也能用',()=>{
 assert.equal(PET_REJUVENATION_MS,PET_REJUVENATION_DAYS*86400000);
 const p=role();
 p.inventory=[{itemId:24,slot:1,quantity:1,pet:{name:'过期宠物',expiresAt:1}},{itemId:PET_REJUVENATION_STONE_ID,slot:40,quantity:2}];
 const out=pet(p,request(14,{petItem:true,petSlot:1}));
 assert.equal(out.ok,true);
 const r=reply(out);
 assert.equal(r.byte(),14,'BAG_PET_AGE 的回包第一位是等待类型 14');
 const left=Number(r.long());
 assert.ok(left>PET_REJUVENATION_MS-60000&&left<=PET_REJUVENATION_MS,`回包是剩余毫秒（收到 ${left}）`);
 assert.equal(r.pos,r.b.length);
 const stone=p.inventory.find(i=>i.slot===40);
 assert.equal(stone.quantity,1,'只消耗一颗石头');
 const revived=p.inventory.find(i=>i.slot===1).pet;
 assert.ok(revived.expiresAt>Date.now()+PET_REJUVENATION_MS-60000,'寿命重置为 100 天');
 assert.equal(revived.name,'过期宠物','等级/品质/成长/技能/装备一律保留');
 assert.equal(logOf(out,'pet-rejuvenated').petSlot,1);
});

test('40005 也能对背包里的宠物用，坏请求拒绝且不消耗',()=>{
 const p=role();
 p.inventory=[{itemId:24,slot:35,quantity:1,pet:{name:'背包里的宠物',expiresAt:1}},{itemId:PET_REJUVENATION_STONE_ID,slot:40,quantity:1}];
 const out=pet(p,request(14,{petItem:true,petSlot:35}));
 assert.equal(reply(out).byte(),14);
 assert.equal(p.inventory.find(i=>i.slot===35).pet.name,'背包里的宠物');
 assert.equal(p.inventory.some(i=>i.slot===40),false,'最后一份也要扣掉');
 // 位置没石头 / 宠物位空 / 宠物位越界 / 数量不为 1：都是 byte(-1) 并且什么都不动。
 for(const [name,w,slot,petSlot,quantity] of [
  ['道具位空',request(14,{slot:38,petItem:true,petSlot:35}),38,35,1],
  ['宠物位空',request(14,{slot:40,petItem:true,petSlot:36}),40,36,1],
  ['宠物位越界',request(14,{slot:40,petItem:true,petSlot:30+bagCapacity(p)}),40,30+bagCapacity(p),1],
  ['数量不为1',request(14,{slot:40,petItem:true,petSlot:35,quantity:2}),40,35,2],
 ]){
  const target=role();target.inventory=[{itemId:24,slot:35,quantity:1,pet:{name:'宠物',expiresAt:1}},{itemId:PET_REJUVENATION_STONE_ID,slot:40,quantity:1}];
  const before=structuredClone(target);
  const rejected=pet(target,w);
  assert.equal(reply(rejected).byte(),-1,`${name} 应该被拒绝`);
  assert.deepEqual(target,before,`${name} 不该改存档`);
 }
 // 存盘失败也要回滚（寿命与石头一起退回去）。
 const failing=role();
 failing.inventory=[{itemId:24,slot:1,quantity:1,pet:{name:'宠物',expiresAt:1}},{itemId:PET_REJUVENATION_STONE_ID,slot:40,quantity:1}];
 const snapshot=structuredClone(failing),h=sent(failing);h.save=()=>{throw Error('disk full');};
 assert.equal(rejection(h.call(request(14,{petItem:true,petSlot:1}),handlePetItems,12001)),'disk full');
 assert.deepEqual(failing,snapshot);
});

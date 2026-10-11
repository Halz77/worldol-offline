import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
import {Writer,Reader} from '../lib/codec.mjs';
import {maps,walkable,reachable,normalizeRole} from '../lib/content.mjs';
import {official,officialItems} from '../lib/official-data.mjs';
import {supplyNpc,supplyShops,supplyDirectory,PURPLE_GRADE,PET_SHOP} from '../lib/supply-shops.mjs';
import {MAGIC_EXHAUSTION_BOOK_ID} from '../lib/pet-skill-book-data.mjs';
import {npcPacket} from '../lib/game-packets.mjs';
import {buyItem,equipment} from '../lib/restoration.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {canIdentify} from '../lib/item-affixes.mjs';
import {shopItem} from '../lib/restoration-packets.mjs';
import {APPEARANCE_ITEM_IDS} from '../lib/local-fashion.mjs';

const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
const role=()=>normalizeRole({id:1,name:'补给验收',level:97,mapId:19,x:21,y:18,coins:39602,gold:12,silver:34,inventory:[],restoration:{starterIssued:true}});
function call(p,type,body,save=()=>{}){
 const replies=[];
 assert.equal(handleRestoration(type,new Reader(body.done()),{role:p},{store:{save},send(type,w){replies.push({type,bytes:w.done()});},log(){}}),true);
 return new Reader(replies.at(-1).bytes);
}

test('added merchant and all menu destinations survive the actual v305 NPC decoder',()=>{
 const p=role(),r=new NativeReader(npcPacket(new Writer(),p).done());r.raw(3);const count=r.getByte(),npcs=[];
 for(let n=0;n<count;n++)npcs.push(d.Npc.fromBytes(r));r.finish();
 const npc=npcs.find(n=>n.id===supplyNpc.id);assert.equal(npc.name,supplyNpc.name);assert.equal(npc.x,20);assert.equal(npc.y,18);
 assert.deepEqual([...npc.shopID],[...supplyShops.map(s=>s.id),PET_SHOP,913,914,915]);assert.deepEqual([...npc.menuShop],supplyNpc.shops.map(s=>s.name));assert.equal(supplyDirectory.shops.find(s=>s.id===PET_SHOP).count,143);
 assert.equal(new Set(npcs.map(n=>n.id)).size,npcs.length);assert.ok(walkable(19,npc.x,npc.y));assert.ok(reachable(19,21,18,npc.x,npc.y));
 for(const original of official.maps.find(m=>m.id===19).npcs)assert.equal(maps[19].npcs.find(n=>n.id===original.id).wireBase64,original.wireBase64);
});

test('categories include all purple gear and catalog mounts/costumes without lower-grade gear',()=>{
 const ids=supplyShops.flatMap(s=>s.items);assert.equal(ids.length,new Set(ids).size);
 const unrestrictedTypes=[11,12,25,26,27,28,29,30,31,33,42,43,44,45,46,47];
 // 本地补充的道具属于各自的独立商店，不在「补给商店覆盖全部目录时装/坐骑」这个等式里：
 //   - 美容院的发型/脸型造型道具（APPEARANCE_ITEM_IDS）只在商店 51/52/55 里卖；
 //   - +4 宝石等其它本地补充道具用 ≥900000 的号段。
 assert.deepEqual([...ids].sort((a,b)=>a-b),[...officialItems.values()].filter(e=>(unrestrictedTypes.includes(e.type)||e.grade===PURPLE_GRADE)&&e.id<900000&&!APPEARANCE_ITEM_IDS.has(e.id)).map(e=>e.id).sort((a,b)=>a-b));
 const purple=supplyShops.filter(s=>s.id>=909&&s.id<=912).flatMap(s=>s.items);assert.ok(purple.length>=238);assert.ok(purple.every(id=>officialItems.get(id).grade===PURPLE_GRADE));
 assert.equal(d.native(4,'getGradeColor',{e:d.module(4).constants})(PURPLE_GRADE),0xc675ff);
 for(const item of official.catalog.filter(e=>[11,12].includes(e.type)))assert.ok(ids.includes(item.itemId),item.name);
 assert.deepEqual(supplyDirectory.coverage.mounts,{catalog:150,available:150,total:153});
 assert.deepEqual(supplyDirectory.coverage.costumes,{catalog:97,available:97,total:98});
 const category=id=>supplyShops.find(s=>s.items.includes(id))?.name;
 for(const [name,items] of [
  ['宠物蛋',[30100,30019,30076,30065,30067,30047]],
  ['消耗品',[22,350,40007,40006,40003,40051,40053,40002,787,781,1200,MAGIC_EXHAUSTION_BOOK_ID]],
  ['技能书',[3192,43700,43001,61001,9106079]],
  ['礼包',[40067,1324,770,40040,40041,1485]],
  ['材料',[497,1041,6120,8581,8761,61105]],
  ['强化卷轴',[40021,40026,40027]],['鉴定卷轴',[40001,40023,40025]],['镶嵌宝石',[411,432]]
 ])for(const id of items)assert.equal(category(id),name,officialItems.get(id)?.name);
 const parseShop=d.native(67,'fromBytesShopItem',{t:d.Item,S:{default:d.Item}});
 for(const shop of supplyShops){
   const data=call(role(),12004,new Writer().short(shop.id));assert.equal(data.byte(),0);assert.equal(data.short(),shop.items.length);
   const r=new NativeReader(data.b.subarray(data.pos));
   for(const id of shop.items){const item=parseShop(r,shop.id);assert.equal(item.id,id);assert.equal(item.money3,0);assert.ok(item.stackNum>=1);assert.equal(d.native(32,'isIdentifyItem',{e:d.Item}).call(item),canIdentify(officialItems.get(id)),`identification status for ${id}`);}
   r.finish();
 }
});

test('freshly purchased mounts and costumes keep their identify menu flag before any bag reload',()=>{
 const parseShop=d.native(67,'fromBytesShopItem',{t:d.Item,S:{default:d.Item}});
 const onBuy=d.native(67,'onItemShopBuy',{
   u:{default:d.constants},h:{default:class {toString(){return '';}}},
   m:{ModelVo:{setPlayerMoney(){}}},_:{GameText:{getText:()=>'',STR_SHOPITEM_BUY_SUCCESS:''}},
   T:{default:{alertMessage(){}}},o:{default:{sendNt(){},getProxy:()=>({sendNt(){}})}},
   s:{RoleEvent:{},ShopEvent:{}},l:{ModName:{},ProxyType:{}}
 });
 for(const [id,shop] of [[31168,907],[28019,908]]){
   const item=parseShop(new NativeReader(shopItem(new Writer(),equipment.get(id),0).done()),shop);
   // Model the native clone's fresh instance; onItemShopBuy itself must set status.
   item.clone=()=>({setExpireTime(){}});item.getNameInfo=()=>item.name;
   let purchased;
   const p=role(),reply=call(p,12005,new Writer().short(shop).int(id).byte(1).bool(false));
   const r=new NativeReader(reply.b);
   onBuy({bag:{addItem_2(i,quantity){purchased=i;assert.equal(quantity,1);}}},item,1,{body:r});r.finish();
   assert.equal(d.native(32,'isIdentifyItem',{e:d.Item}).call(purchased),true,`${item.name} must show 鉴定 immediately`);
 }
});

test('bulk purchases follow the native bag single-stack placement including insufficient room',()=>{
 const p=role();p.bagLimit=2;p.inventory=[{itemId:40021,slot:30,quantity:80}];
 const nativeItem=(id,quantity)=>({id,quantity,stackNum:99,isStackable:()=>true,isShopLocked:()=>false});
 const bag={store:[],isValidPos:n=>n>=30&&n<32,getStartEndPos:()=>[30,31],nextFreePosForType(){return [30,31].find(n=>!this.store[n])??-1;},getNewEquip(){}};
 bag.store[30]=nativeItem(40021,80);
 bag.nextFreePos=d.native(33,'nextFreePos');
 const add=d.native(33,'addItem_3',{l:{default:{sendNt(){}}},u:{MainEvent:{}}});
 for(const quantity of [24,8,75,3]){
   buyItem(p,40021,quantity);assert.ok(add.call(bag,0,nativeItem(40021,1),quantity)>=30);
   assert.deepEqual(p.inventory.map(i=>[i.slot,i.quantity]),[30,31].filter(n=>bag.store[n]).map(n=>[n,bag.store[n].quantity]));
 }
 const before=structuredClone(p);assert.throws(()=>buyItem(p,40021,20),/空间不足/);assert.deepEqual(p,before);
});

test('native purchases preserve currencies, enforce shop membership, persist stacks, and roll back save failure',()=>{
 const p=role();let saves=0;
 for(let n=0;n<2;n++){
   const r=call(p,12005,new Writer().short(904).int(40001).byte(24).bool(false),()=>{saves++;});
   assert.equal(r.byte(),0);assert.equal(r.int(),40001);assert.equal(r.short(),904);assert.equal(r.byte(),24);
   assert.equal(r.int(),12);assert.equal(r.int(),34);assert.equal(r.int(),39602);r.short();r.short();assert.equal(r.pos,r.b.length);
 }
 assert.equal(saves,2);assert.deepEqual(p.inventory,[{itemId:40001,slot:30,quantity:48}]);
 const saved=JSON.stringify(p);
 for(const w of [new Writer().short(904).int(40021).byte(1).bool(false),new Writer().short(904).int(40001).byte(100).bool(false),new Writer().short(907).int(31177).byte(2).bool(false)])assert.equal(call(p,12005,w).byte(),-1);
 assert.equal(JSON.stringify(p),saved);
 assert.equal(call(p,12005,new Writer().short(903).int(40021).byte(5).bool(false),()=>{throw Error('disk failure');}).byte(),-1);assert.equal(JSON.stringify(p),saved);
 assert.deepEqual(normalizeRole(JSON.parse(saved)).inventory,p.inventory);
});

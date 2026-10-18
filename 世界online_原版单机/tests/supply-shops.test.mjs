import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
import {Writer,Reader} from '../lib/codec.mjs';
import {maps,walkable,reachable,normalizeRole} from '../lib/content.mjs';
import {official,officialItems} from '../lib/official-data.mjs';
import {supplyNpc,supplyShops,supplyShopById,supplyDirectory,MERGED_SUPPLY_SHOP,PURPLE_GRADE,PET_SHOP} from '../lib/supply-shops.mjs';
import {MAGIC_EXHAUSTION_BOOK_ID,petSkillBookRegistry,petSkillShopBooks,petSkillShopBookIds,KNIGHTS_DEVOTION_BOOK_ID} from '../lib/pet-skill-book-data.mjs';
import {petSkillLevels,petSkillMaxima} from '../lib/pet-catalog.mjs';
import {mentorTaughtSkillIds,petMentorSkills} from '../lib/pet-mentors.mjs';
import {npcPacket} from '../lib/game-packets.mjs';
import {buyItem,equipment} from '../lib/restoration.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {canIdentify} from '../lib/item-affixes.mjs';
import {shopItem} from '../lib/restoration-packets.mjs';
import {APPEARANCE_ITEM_IDS} from '../lib/local-fashion.mjs';
import {soldPetItem,selectablePetEggs} from '../lib/pet-catalog.mjs';
const selectableEggIds=new Set(selectablePetEggs().map(e=>e.id));
// 「技能书」分类的两条等式（见下面两条用例）：
//   · petBookIds —— 唯一来源 lib/pet-skill-book-data.mjs 给出的在架编号；
//   · isNativeSkillBook —— 原版目录里的技能书类条目（type 31 / power1 176·177·182·186 / 61001），
//     它们现在一件都不该在架。
const petBookIds=petSkillShopBookIds();
const isNativeSkillBook=e=>e.type===31||[176,177,182,186].includes(e.power1)||e.id===61001;

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
 // 菜单与 NPC 记录必须完全一致（编号、名称、顺序）：第 73 版把 903/904/905 合并成 921，
// 所以不再拿 supplyShops 直接比，而是比 supplyNpc.shops ——「合并项真的进了客户端记录」由这条等式兜住。
 assert.deepEqual([...npc.shopID],[...supplyNpc.shops.map(s=>s.id)]);assert.deepEqual([...npc.menuShop],supplyNpc.shops.map(s=>s.name));
 assert.equal(npc.shopID.includes(MERGED_SUPPLY_SHOP),true,'菜单里必须有合并商店 921');
 for(const id of [903,904,905])assert.equal(npc.shopID.includes(id),false,`合并后菜单里不该再出现 ${id}`);
 assert.equal(npc.menuShop.some(name=>/^(强化卷轴|鉴定卷轴|镶嵌宝石)（/.test(name)),false,'菜单里只留「强化、鉴定、宝石」一条');
 assert.equal(npc.menuShop.find(name=>name.startsWith('强化、鉴定、宝石')),supplyNpc.shops.find(s=>s.id===MERGED_SUPPLY_SHOP).name);
 assert.ok(supplyDirectory.shops.find(s=>s.id===918).count>0,'宠物蛋分类 918 必须有货');
 assert.equal(new Set(npcs.map(n=>n.id)).size,npcs.length);assert.ok(walkable(19,npc.x,npc.y));assert.ok(reachable(19,21,18,npc.x,npc.y));
 for(const original of official.maps.find(m=>m.id===19).npcs)assert.equal(maps[19].npcs.find(n=>n.id===original.id).wireBase64,original.wireBase64);
});

test('categories include all purple gear and catalog mounts/costumes without lower-grade gear',()=>{
 const ids=supplyShops.flatMap(s=>s.items);assert.equal(ids.length,new Set(ids).size);
 const unrestrictedTypes=[11,12,25,26,27,28,29,30,31,33,42,43,44,45,46,47];
 // 本地补充的道具属于各自的独立商店，不在「补给商店覆盖全部目录时装/坐骑」这个等式里：
 //   - 美容院的发型/脸型造型道具（APPEARANCE_ITEM_IDS）只在商店 51/52/55 里卖；
 //   - +4 宝石等其它本地补充道具用 ≥900000 的号段。
 // 补给商店只上「定义完整、能真正生成背包道具」的条目，所以有三类刻意不上架：
 //   · 赋灵符 / 灵符箱（type 43）走灵符箱自己的流程；
 //   · type 28 里只作图鉴条目、并非宠物蛋的定义（power1 不是 109、名字也不含「宠物蛋」）；
 //   · 原版目录里的**人物技能书**（type 31 / power1 176·177·182·186 / 61001…）——
 //     「技能书」分类改成只卖宠物满级技能书之后，这一批整体下架（见下面单独一条用例）。
 // 因此不写死两边数量相等，而是：缺的只能来自这三类，且不能多卖预期之外的东西。
const expected=[...officialItems.values()].filter(e=>(unrestrictedTypes.includes(e.type)||e.grade===PURPLE_GRADE)&&e.id<900000&&!APPEARANCE_ITEM_IDS.has(e.id)).map(e=>e.id).sort((a,b)=>a-b);
 const missing=expected.filter(id=>!ids.includes(id));
 assert.ok(missing.every(id=>{const e=officialItems.get(id);return e.type===28||e.type===43||(isNativeSkillBook(e)&&!petBookIds.has(e.id));}),'缺的只能是刻意下架的三类（宠物蛋、灵符/灵符箱、原版人物技能书）：'+missing.slice(0,5).map(id=>officialItems.get(id).name).join('、'));
 // 多出来的只能是本地补充道具（高号段的宝石 / 封印书 / 宝箱等），不能混进原版目录条目。
 const extras=ids.filter(id=>!expected.includes(id));
 assert.ok(extras.every(id=>id>=800000),'卖出预期之外的条目：'+extras.filter(id=>id<800000).slice(0,5).join('、'));
 const purple=supplyShops.filter(s=>s.id>=909&&s.id<=912).flatMap(s=>s.items);assert.ok(purple.length>=238);assert.ok(purple.every(id=>officialItems.get(id).grade===PURPLE_GRADE));
 assert.equal(d.native(4,'getGradeColor',{e:d.module(4).constants})(PURPLE_GRADE),0xc675ff);
 for(const item of official.catalog.filter(e=>[11,12].includes(e.type)))assert.ok(ids.includes(item.itemId),item.name);
 // total 是「道具表里 type 11 的总数」，目录（catalog/available）是抓包目录数。
 assert.deepEqual(supplyDirectory.coverage.mounts,{catalog:150,available:150,total:153});
 assert.deepEqual(supplyDirectory.coverage.costumes,{catalog:97,available:97,total:98});
 const category=id=>supplyShops.find(s=>s.items.includes(id))?.name;
 for(const [name,items] of [
  ['宠物蛋',[30100,30019,30076,30065,30067,30047]],
  ['消耗品',[22,350,40007,40006,40003,40051,40053,40002,787,781,1200,MAGIC_EXHAUSTION_BOOK_ID,KNIGHTS_DEVOTION_BOOK_ID]],
  ['技能书',[petSkillShopBooks()[0].id,petSkillShopBooks().at(-1).id]],
  ['礼包',[40067,1324,770,40040,40041,1485]],
  ['材料',[497,1041,6120,8581,8761,61105]],
  ['强化卷轴',[40021,40026,40027]],['鉴定卷轴',[40001,40023,40025]],['镶嵌宝石',[411,432]]
 // 只校验真正在架上的条目：表里有些宠物蛋条目已经不上架了（见上面的缺失说明）。
 ])for(const id of items)if(ids.includes(id))assert.equal(category(id),name,officialItems.get(id)?.name);
 const parseShop=d.native(67,'fromBytesShopItem',{t:d.Item,S:{default:d.Item}});
 for(const shop of supplyShops){
   const data=call(role(),12004,new Writer().short(shop.id));assert.equal(data.byte(),0);assert.equal(data.short(),shop.items.length);
   const r=new NativeReader(data.b.subarray(data.pos));
   for(const id of shop.items){const item=parseShop(r,shop.id);assert.equal(item.id,id);assert.equal(item.money3,0);assert.ok(item.stackNum>=1);assert.equal(d.native(32,'isIdentifyItem',{e:d.Item}).call(item),canIdentify(officialItems.get(id)),`identification status for ${id}`);}
   r.finish();
 }
});

test('「强化、鉴定、宝石」合并成菜单里的一条 921，三个原商店仍可直连开店',()=>{
 const merged=supplyShopById.get(MERGED_SUPPLY_SHOP);
 assert.ok(merged,'合并商店 921 必须在查表里：12004（开店）与 12005（购买）都按它校验');
 // 三个原分类都在 supplyShops 里没动 —— 背包/装备工坊直连开店、+4 宝石入口都按 903/904/905 发请求。
 for(const id of [903,904,905])assert.ok(supplyShops.some(s=>s.id===id),`原商店 ${id} 不该被删`);
 assert.deepEqual(merged.items,[...new Set([903,904,905].flatMap(id=>supplyShopById.get(id).items))],'合并项必须是三个分类的并集（顺序按 强化→鉴定→宝石，各自内部顺序不变）');
 assert.ok(merged.items.length>=3,'合并后的分类不能是空壳');
 // 物品真的能按 921 这个编号通过 12004 解析（客户端就是拿菜单里的编号来开店的）。
 const data=call(role(),12004,new Writer().short(MERGED_SUPPLY_SHOP));assert.equal(data.byte(),0);assert.equal(data.short(),merged.items.length);
 const parseShop=d.native(67,'fromBytesShopItem',{t:d.Item,S:{default:d.Item}});const r=new NativeReader(data.b.subarray(data.pos));
 for(const id of merged.items){const item=parseShop(r,MERGED_SUPPLY_SHOP);assert.equal(item.id,id);assert.equal(item.money3,0);}
 r.finish();
 // 购买也认这个号：从合并商店免费领一颗宝石（type 30）。
 const p=role();const gem=merged.items.find(id=>officialItems.get(id)?.type===30);
 assert.ok(gem!==undefined,'合并分类里应当有镶嵌宝石');
 const bought=call(p,12005,new Writer().short(MERGED_SUPPLY_SHOP).int(gem).byte(1).bool(false));
 assert.equal(bought.byte(),0);assert.equal(bought.int(),gem);assert.ok(p.inventory.some(i=>i.itemId===gem&&i.slot>=30),'从合并商店买的东西要进背包');
});

test('技能书分类只卖训练师教不到的那批：上限与导师商店同口径、原版技能书全部下架',()=>{
 const books=petSkillShopBooks(),registry=petSkillBookRegistry(),maxima=petSkillMaxima(),shop=supplyShops.find(s=>s.id===919),ids=new Set(supplyShops.flatMap(s=>s.items));
 const taught=mentorTaughtSkillIds(),offered=new Set([2001,2002,2003].flatMap(shopId=>petMentorSkills({skills:[]},shopId).map(s=>s.id)));
 // 0) 「训练师能教到的技能」只有一份定义：mentorTaughtSkillIds() 必须**正好**是三个
 //    宠物训练师实际报出来的技能全集（别处再判一遍 kind/shops 就会从这条等式漏出去）。
 assert.ok(taught.size>0,'宠物训练师至少要有技能，否则下面「剔除」的等式没意义');
 assert.deepEqual([...offered].sort((a,b)=>a-b),[...taught].sort((a,b)=>a-b));
 // 1) 在架的正好是这一批（唯一来源），顺序按编号升序（reqLv 全 0，商店按 (reqLv,id) 排）。
 assert.deepEqual(shop.items,books.map(b=>b.id));
 assert.equal(new Set(books.map(b=>b.id)).size,books.length);
 // 2) 剔除关系：登记表 = 全部满级书；在架 = 登记表剔掉训练师那批，一个不多一个不少。
 assert.deepEqual(registry.map(b=>b.powerValue1).sort((a,b)=>a-b),maxima.map(s=>s.id).sort((a,b)=>a-b));
 assert.deepEqual(books,registry.filter(b=>!taught.has(b.powerValue1)));
 assert.equal(books.length,registry.length-taught.size);
 for(const id of taught)assert.ok(!books.some(b=>b.powerValue1===id),'训练师能教到的技能不该再摆一本书：'+id);
 // 3) 「满级」与宠物导师商店（14001/14002 的 levels.at(-1)）是同一个口径：每个技能恰好一本、取最高档。
 for(const [index,book] of books.entries()){
  const skill=maxima.filter(s=>!taught.has(s.id))[index];
  assert.equal(book.power1,186,'封印书标记');
  assert.equal(book.type,31);
  assert.equal(book.powerValue1,skill.id);
  assert.equal(book.powerValue2,skill.level);
  assert.equal(book.learnSkill.id,skill.id);
  assert.equal(book.learnSkill.level,skill.level);
  assert.equal(book.learnSkill.isLearnByBook,true);
  // 技能定义与目录逐字节一致，唯一的差别是最后一字节的「从书学会」标记：
  // 学习流程（lib/pet-skill-books.mjs selection）下发前本来就会把它置 1。
  const wire=Buffer.from(book.learnSkill.wireBase64,'base64'),catalog=Buffer.from(petSkillLevels.get(`${skill.id}:${skill.level}`).wireBase64,'base64');
  assert.equal(wire.length,catalog.length);
  assert.equal(wire.subarray(0,-1).compare(catalog.subarray(0,-1)),0,'除 learn-by-book 标记外应逐字节一致');
  assert.equal(wire.at(-1),1);
  assert.equal(skill.level,Math.max(...[...petSkillLevels.keys()].filter(k=>k.startsWith(skill.id+':')).map(k=>Number(k.split(':')[1]))));
  assert.equal(equipment.get(book.id).localPrice,0,'单机版商店免费');
  assert.match(book.name,new RegExp(`满级技能书·${skill.level}级`));
 }
 // 4) 原版目录里那一批人物技能书一件都不在架（整个补给商人处都不该再有）。
 for(const id of [3192,3216,3234,3278,61001,43700,43705,43001,43002,43007,43011,43012,43016,43017,43021,43022,43023,43111,43691,9106079])
  assert.ok(!ids.has(id),'原版技能书应该已下架：'+id+' '+officialItems.get(id)?.name);
 for(const e of officialItems.values())if(isNativeSkillBook(e)&&e.id<900000)assert.ok(!ids.has(e.id),'原版技能书漏下架：'+e.id+' '+e.name);
 // 5) 每一本都必须能被宠物技能书流程识别（14016/14017 的 selection 校验的就是这三个字段）。
 const parseBook=d.native(32,'isPetSealSkillBook',{a:{default:d.module(4).constants}});
 const parseShopItem=d.native(67,'fromBytesShopItem',{t:d.Item,S:{default:d.Item}});
 for(const book of books){
  const item=parseShopItem(new NativeReader(shopItem(new Writer(),equipment.get(book.id),0).done()),919);
  assert.equal(item.id,book.id);assert.equal(item.name,book.name);assert.equal(item.power1,186);
  assert.equal(item.powerValue1,book.powerValue1);assert.equal(item.powerValue2,book.powerValue2);
  assert.equal(parseBook.call(item),true,book.name);
 }
 assert.equal(books.find(b=>b.powerValue1===6079).powerValue2,9,'血雾的结界满级 9 级');
 // 6) **下架 ≠ 撤定义**：登记表是超集，训练师那批仍然能在 equipment 表里查到完整定义。
 //    第 44 版把这些书摆在商店里卖过，玩家可能已经买了；itemPacket 遇到未知道具会抛错，
 //    而它在「进入世界」的整包里 —— 定义一撤，那个角色就黑屏（第 43 版同类问题）。
 for(const id of taught){
  const gone=registry.find(b=>b.powerValue1===id);
  assert.ok(gone,'登记表不能漏掉任何一本满级书：'+id);
  assert.ok(!ids.has(gone.id),'但训练师那批不该出现在商店里:'+gone.id);
  const item=parseShopItem(new NativeReader(shopItem(new Writer(),equipment.get(gone.id),0).done()),919);
  assert.equal(item.id,gone.id);assert.equal(parseBook.call(item),true,'老存档里买过的书必须仍然解析得出来：'+gone.name);
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

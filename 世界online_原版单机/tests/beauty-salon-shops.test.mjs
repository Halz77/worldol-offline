// 新月繁华之都（map 19）与另一张图（map 14）的「美容院」有两项菜单：更换发型 / 更换脸型
//（map 14 是「全新发型」）。原版里这三个菜单就是普通道具商店，商店号 51 / 52 / 55，
// 卖的是会改写 icon1 发型(7..10 位)/脸型(13..16 位)位域的时装道具。
//
// 这批商品资料没有采集到（shopID 51/52/55 只出现在 NPC 定义里，12004 采集记录只有 VIP 商店
// 那一份，图鉴里也没有「只改发型/只改脸型」的时装），所以按「世界OL_源码」下的发型/脸型
// 贴图目录本地还原一套 type 12 时装（见 lib/local-fashion.mjs 与 tools/build-fashion-icons.mjs）。
// 这里验证：
//   1. 客户端不再因为 go.openPay 让点击毫无反应，而是真的把 12004 发出去；
//   2. 服务端对 51/52/55 返回真实商品清单（发型 29 / 脸型 14 / 全新发型 29），
//      且每件商品的定义字节能被原版解码器回读出正确的 fashIcon1 位域。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Writer,Reader as ProtocolReader} from '../lib/codec.mjs';
import {decoders,Reader} from '../tools/capture-decoders.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {handleRestoration,shopItems,APPEARANCE_SHOPS} from '../lib/restoration-service.mjs';
import {appearanceShops} from '../lib/local-fashion.mjs';
import {readPayload} from '../tools/build-fashion-icons.mjs';
import {equipment} from '../lib/restoration.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
const catalog=readPayload();
const readDefinition=r=>{const item=new d.Item();d.Item.fromBytesAtts2(item,r);return item;};

const role=(coins=100)=>normalizeRole({id:1,name:'美容院验收',level:97,mapId:19,x:3,y:25,coins,gold:0,silver:0,restoration:{starterIssued:true}});
function askShop(id){
 const sent=[],context={role:role()};
 const handled=handleRestoration(12004,new ProtocolReader(new Writer().short(id).done()),context,{store:{save(){}},send(type,w){sent.push({type,bytes:w.done()});},log(){}});
 assert.equal(handled,true,'12004 必须由装备/技能服务认领');
 assert.equal(sent.length,1,'一次请求只回一包');
 return new ProtocolReader(sent[0].bytes);
}

test('美容院三个造型商店返回真实商品清单（发型 29 / 脸型 14 / 全新发型 29）',()=>{
 const expect={51:catalog.hair.length,52:catalog.faces.length,55:catalog.hair.length};
 for(const [id,name] of APPEARANCE_SHOPS){
  const r=askShop(id);
  assert.equal(r.byte(),0,`商店 ${id}「${name}」应该正常打开`);
  const count=r.short();
  assert.equal(count,expect[id],`商店 ${id} 商品数应是 ${expect[id]}（本地还原的贴图全集）`);
 }
});

test('造型商品的定义字节能被原版解码器回读，fashIcon1 位域只写发型或只写脸型',()=>{
 for(const shop of appearanceShops){
  const isHair=shop.id!==52;
  for(const id of shop.items){
   const e=equipment.get(id);
   assert.ok(e,`道具 ${id} 应该在 equipment 里`);
   const decoded=readDefinition(new Reader(Buffer.from(e.definitionBase64,'base64')));
   assert.equal(decoded.id,id);
   assert.equal(decoded.type,12,'造型道具必须是 type 12 时装');
   const fash=Number(decoded.fashIcon1?.toNumber?.() ?? decoded.fashIcon1 ?? 0);
   assert.ok(fash>0,'造型道具必须带外观位');
   if(isHair){
    assert.ok((fash>>>7)&0xf,'发型道具要写发型样式位');
    assert.equal((fash>>>13)&0xf,0,'发型道具不能动脸型位');
   }else{
    assert.ok((fash>>>13)&0xf,'脸型道具要写脸型位');
    assert.equal((fash>>>7)&0x1f,0,'脸型道具不能动发型位');
   }
  }
 }
});

test('shopItems 为造型商店返回 equipment 里的时装对象（不再是 undefined）',()=>{
 for(const shop of appearanceShops){
  const list=shopItems(shop.id);
  assert.ok(Array.isArray(list)&&list.length===shop.items.length,`商店 ${shop.id} 应返回 ${shop.items.length} 件商品`);
  for(const e of list)assert.equal(typeof e.definitionBase64,'string','每件商品都要带定义字节');
 }
});

test('识别范围与原版 NPC 定义一致：美容院菜单里的小号商店都被认出来',()=>{
 const data=JSON.parse(fs.readFileSync(new URL('../data/official-v305.json',import.meta.url),'utf8'));
 const npcs=[];
 const walk=o=>{
  if(Array.isArray(o)){for(const v of o)walk(v);return;}
  if(o&&typeof o==='object'){
   if(o.name==='美容院'&&Array.isArray(o.shopID))npcs.push(o);
   for(const v of Object.values(o))walk(v);
  }
 };
 walk(data);
 assert.ok(npcs.length>0,'官方数据里应该能找到美容院');
 const recognised=new Set(APPEARANCE_SHOPS.keys());
 for(const npc of npcs)for(const id of npc.shopID){
  if(id<100)assert.ok(recognised.has(id),`美容院的小号商店 ${id} 必须被识别（菜单：${npc.menuShop.join('/')}）`);
 }
});

test('客户端离线补丁把造型商店放进本地白名单，绕开原版 go.openPay 闸门，并把图标接上图集',()=>{
 const src=fs.readFileSync(new URL('../web/offline.js',import.meta.url),'utf8');
 const list=src.match(/const localShops=\[([^\]]*)\]/);
 assert.ok(list,'web/offline.js 里应该有 localShops 白名单');
 const ids=list[1].split(',').map(value=>Number(value.trim()));
 for(const id of [51,52,55,901,920])assert.ok(ids.includes(id),`白名单缺少 ${id}`);
 assert.match(src,/return localShops\.includes\(id\)\?req\(67\)\.ShopItem\.openItemShop\(id\):browseShop\.call\(this,id,\.\.\.args\);/);
 assert.match(src,/playerIsFemale/,'造型道具的图标要按角色性别取男/女那份头像');
 assert.match(src,/common_icon_wenhao2/,'图集没就绪时要退回问号图');
});

// —— 造型道具是「买下即用」的道具，不是装备 ——
// 主包 t.onItemShopBuy 里：回包状态位 == 2 时，客户端直接
//   isHairItem(t.id) ? (updateHair(t), refreshWorldSprite())
//                    : isFaceItem(t.id) && (updateFace(t), refreshWorldSprite())
// 然后用 t.icon 去算样式/颜色，道具不进背包。服务端必须回同样的状态位、扣钱、
// 并把角色 icon1 改掉存盘，否则重登后造型会退回去。
// 直接在给定角色上发一次 12005，返回回包 Reader（成功包首字节 0/2，失败包首字节 -1 + 文案）。
function applyBuy(player,shop,id,quantity=1){
 const sent=[];
 handleRestoration(12005,new ProtocolReader(new Writer().short(shop).int(id).byte(quantity).bool(false).done()),{role:player},{store:{save(){}},send(type,w){sent.push(w.done());},log(){}});
 return new ProtocolReader(sent[0]);
}
function buyAppearance(shop,id,quantity=1,coins=1e9){
 const player=role(coins);
 return {reader:applyBuy(player,shop,id,quantity),role:player,coins};
}
const lowOf=icon1=>Number(icon1)%4294967296;

test('购买造型道具回状态位 2、扣铜币、直接把角色外观改掉，道具不进背包',()=>{
 for(const entry of [...catalog.hair.slice(0,3),...catalog.faces.slice(0,3)]){
  const isHair=catalog.hair.some(x=>x.id===entry.id);
  const price=equipment.get(entry.id).localPrice;
  const result=buyAppearance(isHair?55:52,entry.id);
  const r=result.reader;
  assert.equal(r.byte(),2,'造型道具必须回状态位 2，客户端才会 updateHair/updateFace');
  r.int();r.int();const coins=r.int();
  assert.equal(coins,result.coins-price,`购买后余额应是 ${result.coins-price}`);
  assert.equal(result.role.coins,result.coins-price,'服务端角色也要扣钱');
  const low=lowOf(result.role.icon1);
  if(isHair){
   assert.equal((low>>>7)&0xf,entry.style,'icon1 发型样式位要变成这一款');
   assert.equal((low>>>11)&0x3,entry.color,'icon1 发色位要变成这一款');
  }else{
   assert.equal((low>>>13)&0xf,entry.style,'icon1 脸型位要变成这一款');
  }
  assert.equal(result.role.inventory.some(i=>i.itemId===entry.id),false,'造型道具不能进背包');
 }
});

test('购买造型道具沿用角色原有位域：性别/阵营/职业位不受影响，只改自己那一段',()=>{
 const player=role(1e9);
 const originalLow=lowOf(player.icon1),originalJob=player.job,originalSex=player.sex;
 // 先只换脸型：发型位（7..12）必须原样保留
 const face=catalog.faces[0];
 assert.equal(applyBuy(player,52,face.id).byte(),2);
 assert.equal((lowOf(player.icon1)>>>13)&0xf,face.style,'脸型位要变成这一款');
 assert.equal(lowOf(player.icon1)&0x1fff,originalLow&0x1fff,'只换脸型时不能碰 0..12 位');
 const afterFace=lowOf(player.icon1);
 // 再只换发型：脸型位（13..16）必须原样保留
 const hair=catalog.hair.find(e=>e.style===2)??catalog.hair[0];
 assert.equal(applyBuy(player,55,hair.id).byte(),2);
 assert.equal((lowOf(player.icon1)>>>7)&0xf,hair.style,'发型样式位要变成这一款');
 assert.equal((lowOf(player.icon1)>>>11)&0x3,hair.color,'发色位要变成这一款');
 assert.equal((lowOf(player.icon1)>>>13)&0xf,(afterFace>>>13)&0xf,'只换发型时不能碰脸型位');
 assert.equal(lowOf(player.icon1)&0x7f,originalLow&0x7f,'低 7 位（性别/阵营/职业）不能被碰');
 assert.equal(player.job,originalJob);
 assert.equal(player.sex,originalSex);
});

test('造型道具只能逐个换，拦截时不扣钱不改外观；免费换装（localPrice=0）不扣铜币',()=>{
 const many=role(1e9),before=lowOf(many.icon1);
 const rejected=applyBuy(many,55,catalog.hair[0].id,2);
 assert.equal(rejected.byte(),-1,'数量不为 1 要回错误包');
 assert.match(rejected.string(),/逐个更换/);
 assert.equal(lowOf(many.icon1),before,'拦截时不能改外观');

 // 单机版所有本地道具都是免费（localPrice=0，与原版目录一致），换装不扣钱。
 const free=role(0);
 assert.equal(applyBuy(free,55,catalog.hair[0].id).byte(),2,'免费换装要成功');
 assert.equal(free.coins,0,'免费换装不能扣钱');
});

test('旧版造型道具（900101+）在旧存档里会被清掉，新道具照常保留',()=>{
 // 第 26 版的造型道具编号是 900101+/900201+，改到原版号段后就查不到了；
 // 带着它们登录会让 itemPacket 抛「未知道具」。normalizeRole 必须先把空壳清掉。
 const saved=role(1e9);
 saved.inventory=[
  {itemId:900101,slot:30,quantity:1},   // 旧版发型（现在是空壳）
  {itemId:900201,slot:31,quantity:1},   // 旧版脸型（现在是空壳）
  {itemId:catalog.hair[0].id,slot:32,quantity:1}, // 新版造型道具
 ];
 normalizeRole(saved);
 assert.equal(saved.inventory.some(i=>i.itemId===900101),false,'旧版发型空壳要被清掉');
 assert.equal(saved.inventory.some(i=>i.itemId===900201),false,'旧版脸型空壳要被清掉');
 assert.equal(saved.inventory.some(i=>i.itemId===catalog.hair[0].id),true,'当前版本的道具不能被误删');
});

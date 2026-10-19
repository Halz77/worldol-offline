// 英雄图鉴（收集系统）—— 第 77 版服务端实装的验收用例（第 80 版去掉加成）。
//
// 覆盖四件事：
//   1) 目录索引：32 页拼起来正好是抓包目录全集（和 official.test.mjs 的「一条不落」同源）；
//   2) 收集率 → 等级换算，以及**第 80 版起图鉴不再提供任何属性加成**
//      （服务端 powers 恒空、32109 恒空包、客户端文案也不再出现任何数字）；
//   3) 协议：32101 只读、32103 整页点亮（32104 + 32109）；
//   4) 道具「点亮所有图鉴」：定义能被原版解码器读出、12001 使用后全部点亮、属性一分不加。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Reader as WireReader,Writer} from '../lib/codec.mjs';
import {Reader,decoders,protobuf,protobufSchemas} from '../tools/capture-decoders.mjs';
import {official,officialItems} from '../lib/official-data.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {buyItem,equipment} from '../lib/restoration.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {nativeCharacterStats} from '../lib/native-character-stats.mjs';
import {handleOfficial,handbookPage,handbookUnlock,handbookPowerPacket} from '../lib/official-service.mjs';
import {handbookLevel,handbookPages,handbookPowers,handbookRows,handbookState,handbookView,lightAllHandbook,unlockOwnedItems,refreshHandbook} from '../lib/handbook.mjs';
import {HANDBOOK_LIGHT_ALL_ITEM_ID,PINNED_SUPPLY_ITEM_IDS} from '../lib/local-items.mjs';
import {HANDBOOK_LIGHT_ALL_NAME} from '../lib/handbook-item.mjs';
import {supplyShopById} from '../lib/supply-shops.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
const schemas=protobufSchemas(fs.readFileSync(new URL('../analysis/protobuf.decoded.js',import.meta.url),'utf8'));
const role=()=>normalizeRole({id:1,name:'图鉴验收',level:20,mapId:254,x:21,y:6,inventory:[],restoration:{starterIssued:true}});
// C2S_HAND_BOOK_INFO / C2S_HAND_BOOK_UNLOCK 都是 {group:1 int32, type:2 int32}
const bookReq=(group,type)=>new Writer().byte(8).byte(group).byte(16).byte(type).done();
// 真实 send（server.mjs 第 87 行）两种形态都收：Writer（`.done()`）与已经打好的 Buffer。
const payload=w=>Buffer.isBuffer(w)?w:Buffer.from(w.done());
function officialCall(p,type,body){
 const replies=[];const context={role:p};
 const handled=handleOfficial(type,new WireReader(body),context,{store:{save(){}},send(t,w){replies.push({type:t,b:payload(w)});},log(){}});
 assert.equal(handled,true,'handleOfficial 应当接走 '+type);
 return replies;
}
function useItem(p,slot,waitType){
 const replies=[];
 assert.equal(handleRestoration(12001,new WireReader(new Writer().byte(waitType).byte(3).short(slot).int(1).bool(false).byte(0).done()),{role:p},{store:{save(){}},send(type,w){replies.push({type,b:payload(w)});},log(){}}),true);
 // 被拒的时候 handleRestoration 会回一个 status=-1 + 文案的包，把它抖出来，
 // 否则断言只会看到「期望 32109，实际 12001」这种没信息量的失败。
 const rejected=replies.find(r=>r.type===12001);
 if(rejected){const rd=new WireReader(rejected.b);throw Error('12001 被拒：status='+rd.byte()+' '+rd.string());}
 return replies;
}

test('图鉴页索引拼起来就是抓包目录全集（每组每类只出现一次）',()=>{
 const pages=handbookPages();
 assert.equal(pages.length,32,'组:类 一共 32 页（1:13..39 / 2:0..12 / 3:7·8·9·41 / 11:11）');
 const seen=[];for(const page of pages)for(const row of handbookRows(page.group,page.type))seen.push(row.itemId);
 assert.equal(seen.length,new Set(seen).size,'同一个条目不能在页内重复');
 assert.deepEqual([...new Set(seen)].sort((a,b)=>a-b),official.catalog.map(i=>i.itemId).sort((a,b)=>a-b));
 // 目录里有 3189 条「只采到目录、没有属性定义」的条目（officialItems 只有 226+ 条），
 // 所以这里只断言每页非空、编号唯一，不断言「页内条目都有定义」。
 for(const page of pages)assert.ok(page.rows.length>0,`${page.group}:${page.type} 不能是空页`);
});

test('收集率 → 等级换算与参考实现一致（100% 拉满 70 级；只用于显示）',()=>{
 assert.equal(handbookLevel(0),0);assert.equal(handbookLevel(1),1);assert.equal(handbookLevel(50),35);
 assert.equal(handbookLevel(99),69);assert.equal(handbookLevel(100),70);
});

test('第 80 版：图鉴不再提供任何属性加成（服务端与客户端一起回到零加成）',()=>{
 // 亮一整页 / 一键点亮全部 —— 两种情况都不该让属性动一分。
 const p=role(),before=nativeCharacterStats(p).stats;
 officialCall(p,32103,bookReq(1,13));
 assert.deepEqual(p.handbook.powers,{},'点亮一页也不再写加成缓存');
 assert.deepEqual(nativeCharacterStats(p).stats,before,'服务端属性完全不受图鉴影响');
 const q=role(),base=nativeCharacterStats(q).stats;
 lightAllHandbook(q);
 assert.deepEqual(q.handbook.powers,{});
 assert.deepEqual(nativeCharacterStats(q).stats,base,'一键点亮全部也不加属性');
 // 第 77 版写进老存档的那份旧加成：既不再进属性计算，也会被进世界的 refreshHandbook 清掉。
 const old=role();
 old.handbook={unlocked:{'1:13':handbookRows(1,13).map(row=>row.itemId)},lit:false,powers:{2:100,57:50,58:600,130:7,171:1000}};
 assert.deepEqual(nativeCharacterStats(old).stats,base,'残留的旧 powers 不再参与计算');
 assert.deepEqual(handbookPowers(old),{},'handbookPowers 恒为空（不去读存档里的旧值）');
 refreshHandbook(old);
 assert.deepEqual(old.handbook.powers,{},'refreshHandbook 把老存档的加成清空');
 // 客户端文案里不许再出现任何加成数字 —— 面板写多少、实际加多少的那条纪律，
 // 现在靠「都不写」守住（改回加成时这里会先红）。
 const text=fs.readFileSync(new URL('../web/offline.js',import.meta.url),'utf8');
 const override=/getGroupTypeDes=function[\s\S]*?;/.exec(text);
 assert.ok(override,'图鉴文案覆盖必须还在');
 const strings=[...override[0].matchAll(/'([^']*)'/g)].map(match=>match[1]);
 assert.ok(strings.length>0,'覆盖里至少要有一条返回文案');
 assert.equal(strings.some(s=>/\d/.test(s)),false,'图鉴文案里不许再出现数字');
 assert.ok(strings.some(s=>s.includes('仅作收集')),'要明确写「仅作收集」');
});

test('32101 只查不改：未点亮的一页如实下发，且不写存档',()=>{
 const p=role(),before=JSON.stringify(p);
 const replies=officialCall(p,32101,bookReq(1,13));
 assert.equal(replies.length,1);assert.equal(replies[0].type,32102);
 const page=protobuf(replies[0].b,'s2c_HandBookInfo',schemas);
 assert.equal(page.group,1);assert.equal(page.type,13);
 assert.equal(page.info.level,0);assert.equal(page.info.rate,0);assert.equal(page.canUnlock,true);
 assert.ok(page.itemInfos.length>=20);
 assert.ok(page.itemInfos.every(i=>i.unlock===false),'默认一条都不亮');
 assert.deepEqual(JSON.parse(JSON.stringify(p)),JSON.parse(before),'查询图鉴不能改角色（只读纪律）');
});

test('32103 整页点亮：回 32104 + 32109，条目、等级、存档一起变（属性不变）',()=>{
 const p=role(),before=nativeCharacterStats(p).stats;
 const replies=officialCall(p,32103,bookReq(1,13));
 assert.deepEqual(replies.map(r=>r.type),[32104,32109,10509]);
 const unlock=protobuf(replies[0].b,'s2c_HandBookUnlock',schemas);
 const rows=handbookRows(1,13);
 assert.equal(unlock.group,1);assert.equal(unlock.type,13);
 assert.deepEqual([...unlock.itemIds].sort((a,b)=>a-b),rows.map(r=>r.itemId).sort((a,b)=>a-b),'回包要带上整页条目编号');
 assert.equal(unlock.rate,100);assert.equal(unlock.level,70);
 // 点完了就能读到「整页 100%、不能重复点亮」
 const view=handbookView(p,1,13);
 assert.equal(view.count,view.total);assert.equal(view.rate,100);assert.equal(view.canUnlock,false);
 assert.equal(p.handbook.unlocked['1:13'].length,rows.length);
 assert.equal(replies[1].b.length,0,'32109 空包');
 assert.deepEqual(p.handbook.powers,{});
 assert.deepEqual(nativeCharacterStats(p).stats,before,'属性一分不加（第 80 版）');
 // 再点一次不会出错、也不会重复加（等级已经是满的）
 const again=officialCall(p,32103,bookReq(1,13));
 assert.equal(protobuf(again[0].b,'s2c_HandBookUnlock',schemas).rate,100);
});

test('32109 恒为空包 —— 客户端 onHandBookPowerInfo 会清空 bookGroupPower（回到无加成）',()=>{
 const p=role();
 assert.equal(handbookPowerPacket(p).length,0,'没有图鉴数据时是空包');
 officialCall(p,32103,bookReq(1,13));
 assert.equal(handbookPowerPacket(p).length,0,'点亮一页后仍是空包');
 lightAllHandbook(p);
 assert.equal(handbookPowerPacket(p).length,0,'一键点亮全部后仍是空包');
 // 空包解码出来就是「一个 info 都没有」——原版把它当成空表，bookGroupPower 被清空。
 const decoded=protobuf(handbookPowerPacket(p),'s2c_HandBookPowerInfo',schemas);
 assert.deepEqual(decoded.infos||[],[]);
});

test('「点亮所有图鉴」道具：定义、在架、使用与立刻生效',()=>{
 const item=officialItems.get(HANDBOOK_LIGHT_ALL_ITEM_ID);
 assert.ok(item,`道具 ${HANDBOOK_LIGHT_ALL_ITEM_ID} 必须在 officialItems 里（official-data 注册）`);
 assert.equal(item.name,HANDBOOK_LIGHT_ALL_NAME);
 assert.equal(equipment.has(HANDBOOK_LIGHT_ALL_ITEM_ID),true,'补给商店/背包链路走 equipment');
 assert.ok(PINNED_SUPPLY_ITEM_IDS.includes(HANDBOOK_LIGHT_ALL_ITEM_ID),'固定摆在消耗品分类最前面');
 assert.ok(supplyShopById.get(906).items.includes(HANDBOOK_LIGHT_ALL_ITEM_ID),'消耗品商店 906 里能免费领到');
 // 定义字节必须被原版解码器完整读掉（type 28 = ITEM_CLASS_USE_ITEM：power3/powerValue3
 // 只在 power1===181 时才在字节里出现，多写四个字节 r.finish() 就会报「Unconsumed bytes」）。
 const reader=new Reader(Buffer.from(item.definitionBase64,'base64')),native=new d.Item();
 d.Item.fromBytesAtts2(native,reader);reader.finish();
 assert.equal(native.id,HANDBOOK_LIGHT_ALL_ITEM_ID);
 assert.equal(native.name,HANDBOOK_LIGHT_ALL_NAME);
 assert.equal(native.type,28);assert.equal(native.grade,4);assert.equal(native.stackNum,99);
 assert.equal(native.bagIcon,item.bagIcon);assert.equal(native.reqLv,0);
 assert.equal(native.power1,0);assert.equal(native.powerValue1,0);
 assert.equal(native.handBookItem,false);
 // 使用：type 28 无 power → 客户端按 BAG_NO_WAIT(0) 发请求（不带回包，本地自己扣一件）
 const p=role();
 buyItem(p,HANDBOOK_LIGHT_ALL_ITEM_ID,1);
 const instance=p.inventory.find(i=>i.itemId===HANDBOOK_LIGHT_ALL_ITEM_ID);
 assert.ok(instance&&instance.slot>=30);
 const before=nativeCharacterStats(p).stats;
 assert.deepEqual(useItem(p,instance.slot,0).map(r=>r.type),[32109,10509]);
 assert.equal(p.handbook.lit,true);
 assert.equal(p.inventory.some(i=>i.itemId===HANDBOOK_LIGHT_ALL_ITEM_ID),false,'道具要被消耗掉');
 assert.deepEqual(p.handbook.powers,{},'第 80 版：点亮全部也不再有任何加成');
 assert.deepEqual(nativeCharacterStats(p).stats,before,'属性一分不加');
 // 等待类型对不上就不是这条道具的正常请求。
 const q=role();buyItem(q,HANDBOOK_LIGHT_ALL_ITEM_ID,1);
 const qs=q.inventory.find(i=>i.itemId===HANDBOOK_LIGHT_ALL_ITEM_ID).slot;
 assert.throws(()=>useItem(q,qs,20),/无效的道具使用请求/);
 assert.equal(q.handbook?.lit??false,false,'被拒的请求不能改状态');
});

test('重新登录会把「背包里已有的条目」自动点亮（server.mjs 的进世界路径）',()=>{
 const p=role(),base=nativeCharacterStats(p).stats;
 // 自动点亮只认**抓包目录里**的条目（本地新增道具不在目录里，点亮它没有意义）。
 const owned=handbookRows(1,13)[0];
 p.inventory.push({itemId:owned.itemId,slot:30,quantity:1});
 assert.deepEqual(handbookState(p).unlocked,{},'还没进过世界：什么都不知道');
 // server.mjs 的 CG_LOGIN_ACTORENTER 在 store.save() 之前调这两个函数。
 assert.equal(unlockOwnedItems(p),true);
 refreshHandbook(p);
 assert.deepEqual(p.handbook.unlocked['1:13'],[owned.itemId],'只点亮自己真有的条目');
 const view=handbookView(p,1,13);
 assert.equal(view.count,1);assert.equal(view.rate,Math.round((1/view.total)*100));assert.equal(view.level,1);
 assert.deepEqual(p.handbook.powers,{},'第 80 版：自动点亮也不再加成');
 assert.deepEqual(nativeCharacterStats(p).stats,base,'属性一分不加');
 assert.equal(unlockOwnedItems(p),false,'第二次没有变化（不重复写存档）');
});

test('不带角色的纯目录视图保持原样：全未点亮、不能点亮',()=>{
 const page=protobuf(handbookPage(1,13),'s2c_HandBookInfo',schemas);
 assert.equal(page.canUnlock,false);
 assert.ok(page.itemInfos.every(i=>i.unlock===false));
 const unlock=protobuf(handbookUnlock({group:1,type:13,level:0,rate:0,items:handbookRows(1,13).map(r=>({itemId:r.itemId}))}),'s2c_HandBookUnlock',schemas);
 assert.deepEqual(unlock.itemIds,handbookRows(1,13).map(r=>r.itemId));
});

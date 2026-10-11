import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Writer,Reader as ProtocolReader} from '../lib/codec.mjs';
import {decoders,Reader} from '../tools/capture-decoders.mjs';
import {officialItems} from '../lib/official-data.mjs';
import {supplyShops} from '../lib/supply-shops.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {equipment} from '../lib/restoration.mjs';
import {itemPacket} from '../lib/restoration-packets.mjs';
import {gemAttachment} from '../lib/item-affixes.mjs';
import {planGem,gemReplaceQuote,planGemReplace,upgradeTarget} from '../lib/equipment-upgrades.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {handleEquipmentUpgrades} from '../lib/equipment-upgrade-service.mjs';
import {PLUS4_GEM_POWERS,plus4GemItemId} from '../lib/local-gems.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
const ATTRIBUTE={1:'力量',3:'体质',5:'敏捷',7:'智力',9:'感知'};
d.Item.prototype.isTimeItem=d.native(32,'isTimeItem',{e:d.Item});
const readItem=r=>{const item=new d.Item();d.native(32,'fromBytesAtts1',{e:d.Item})(item,r);d.Item.fromBytesAtts2(item,r);return item;};
// 商店里的道具只有定义（没有前面的数量/耐久那一段），对应客户端的 fromBytesShopItem。
const readDefinition=r=>{const item=new d.Item();d.Item.fromBytesAtts2(item,r);return item;};
const equipmentId=2056;                                   // 百炼银龙剑，20 个宝石孔
const plus3Strength=390,plus3Wisdom=391,plus3Constitution=393;
const plus1Strength=411,lifeGem=431;                      // +1 档 / 生命宝石，都不能用于替换
const strength4=plus4GemItemId(1),constitution4=plus4GemItemId(3),
  agility4=plus4GemItemId(5),intelligence4=plus4GemItemId(7),wisdom4=plus4GemItemId(9);

function role(){return {id:1001,level:97,baseStats:[30,30,30,30,30],hp:1,mp:1,skills:{},autoSkillIds:[0,0,0,0],coins:100,skillPoints:100,
  inventory:[{itemId:equipmentId,slot:30,quantity:1,bound:true},
             {itemId:wisdom4,slot:31,quantity:60},{itemId:strength4,slot:32,quantity:60},
             {itemId:plus1Strength,slot:33,quantity:30},{itemId:lifeGem,slot:34,quantity:30},
             {itemId:agility4,slot:35,quantity:60}]};}
const gemState=p=>{const item=p.inventory.find(i=>i.slot===30);return item.gems??(item.gems=[]);};

test('单机补充的五维 +4 宝石在目录里，并且能被原版客户端解析器逐字读出来',()=>{
  assert.deepEqual(PLUS4_GEM_POWERS,[1,3,5,7,9]);
  for(const power of PLUS4_GEM_POWERS){
    const gem=officialItems.get(plus4GemItemId(power));
    assert.ok(gem,`缺少属性位 ${power} 的 +4 宝石`);
    assert.equal(gem.type,30);
    assert.equal(gem.power1,power);
    assert.equal(gem.powerValue1,4);
    assert.equal(gem.name,`加4${ATTRIBUTE[power]}宝石(绑）`);
    // 定义字节用原版解析器回读：字段对不上说明格式写坏了，客户端会当坏道具处理。
    const decoded=readDefinition(new Reader(Buffer.from(gem.definitionBase64,'base64')));
    assert.equal(decoded.id,gem.id);assert.equal(decoded.type,30);assert.equal(decoded.name,gem.name);
    assert.equal(decoded.power1,power);assert.equal(decoded.powerValue1,4);
    assert.equal(decoded.bagIcon,gem.bagIcon);assert.equal(decoded.info,gem.info);
    // 背包里的样子：itemPacket 走的是同一份定义。
    const bagged=readItem(new Reader(itemPacket(new Writer(),{itemId:gem.id,slot:31,quantity:1}).done()));
    assert.equal(bagged.id,gem.id);assert.equal(bagged.name,gem.name);assert.equal(bagged.powerValue1,4);
  }
  // 原版 +3 宝石一个都没动过，+4 是新增而不是覆盖。
  for(const [id,value] of [[plus3Strength,3],[plus3Wisdom,3],[plus3Constitution,3]])assert.equal(officialItems.get(id).powerValue1,value);
});

test('+4 宝石已经进「镶嵌宝石」商店，可以像原版宝石一样领取',()=>{
  const shop=supplyShops.find(s=>s.name==='镶嵌宝石');
  for(const power of PLUS4_GEM_POWERS)assert.ok(shop.items.includes(plus4GemItemId(power)),`镶嵌宝石商店里没有属性位 ${power} 的 +4 宝石`);
});

test('+4 宝石按原版同属性规则镶嵌：可以和同属性的 +3 混镶，换成别的属性会被拒',()=>{
  const p=role();gemState(p).push({itemId:plus3Strength,quantity:2});
  const mixed=planGem(p,30,32,()=>0),attachment=gemAttachment(equipment.get(equipmentId),mixed.item);
  assert.equal(mixed.success,true);
  assert.deepEqual(mixed.item.gems,[{itemId:plus3Strength,quantity:2},{itemId:strength4,quantity:1}]);
  assert.deepEqual(attachment,{count:3,power:1,value:3*2+4});
  // 已经镶了力量，再想镶智力（即使都是 +4）还是被原版规则挡住。
  const copy=structuredClone(p);
  assert.throws(()=>planGem(p,30,31),/相同属性/);
  assert.deepEqual(p,copy);
});

test('宝石替换：基础属性要过门槛、只收五维宝石、不能用 +1 档，并按 2×已镶颗数 扣宝石',()=>{
  const p=role();gemState(p).push({itemId:plus3Wisdom,quantity:20});       // 智力 +3 ×20 = 60
  const before=structuredClone(p);
  const {instance,template}=upgradeTarget(p,30);
  assert.deepEqual(gemAttachment(template,instance),{count:20,power:7,value:60});

  const quote=gemReplaceQuote(p,30,equipmentId,32);
  assert.equal(quote.need,40);                                            // 2×20 颗新宝石
  assert.deepEqual(quote.rows,[{slot:32,quantity:40}]);                   // 32 槽有 60 颗 +4 力量
  assert.equal(quote.missing,0);
  const planned=planGemReplace(p,30,equipmentId,32,quote.rows);
  assert.deepEqual(planned.item.gems,[{itemId:strength4,quantity:20}]);
  assert.equal(planned.item.gemBroken,false);
  assert.deepEqual(planned.attachment,{count:20,power:1,value:80});
  assert.equal(planned.consumed,40);
  assert.equal(planned.next.inventory.find(i=>i.slot===32).quantity,20);
  assert.deepEqual(p,before,'替换计划不能改动原角色');
});

test('宝石替换的每一条门槛都拒绝，且不花掉任何宝石',()=>{
  // ① 装备宝石基础属性不超过 20（这里 7 颗 +3 = 21 刚好放行，6 颗 = 18 被拒）
  const low=role();gemState(low).push({itemId:plus3Wisdom,quantity:6});
  const saved=structuredClone(low);
  assert.throws(()=>gemReplaceQuote(low,30,equipmentId,32),/超过 20/);
  assert.deepEqual(low,saved);
  gemState(low)[0].quantity=7;assert.equal(gemReplaceQuote(low,30,equipmentId,32).need,14);
  // ② 生命宝石（power 11）不在五维之内
  const life=role();gemState(life).push({itemId:lifeGem,quantity:20});
  assert.throws(()=>gemReplaceQuote(life,30,equipmentId,32),/只有提升力量、体质、敏捷、智力、感知/);
  // ③ 新宝石也不能是生命宝石 / +1 档
  const normal=role();gemState(normal).push({itemId:plus3Wisdom,quantity:20});
  assert.throws(()=>gemReplaceQuote(normal,30,equipmentId,34),/只有提升力量、体质、敏捷、智力、感知/);
  assert.throws(()=>gemReplaceQuote(normal,30,equipmentId,33),/\+1 宝石不能用于替换/);
  // ④ 背包里没有这件宝石（槽位在装备区）
  assert.throws(()=>gemReplaceQuote(normal,30,equipmentId,8),/请选择背包中的有效宝石/);
  // ⑤ 宝石不够：60 颗里只有 40 颗可用（另外 20 颗不存在）
  const short=role();gemState(short).push({itemId:plus3Wisdom,quantity:20});
  short.inventory=short.inventory.map(i=>i.slot===32?{...i,quantity:12}:i);
  const q=gemReplaceQuote(short,30,equipmentId,32),before=structuredClone(short);
  assert.equal(q.missing,28);assert.deepEqual(q.rows,[{slot:32,quantity:12}]);
  assert.throws(()=>planGemReplace(short,30,equipmentId,32,[{slot:32,quantity:12}]),/背包里只有 12 颗/);
  assert.deepEqual(short,before);
  // ⑥ 报价与确认之间材料变了
  assert.throws(()=>planGemReplace(normal,30,equipmentId,32,[{slot:32,quantity:39}]),/替换材料已变化/);
});

// 11507 的应答形状必须和客户端一致：客户端把它放在 sendProtoAsync 的 resultMsg 集合里，
// 那条路径会先用 Handler.processMessage 读走**第一个字节**当状态（负数就自己弹文案并作废这次请求），
// 剩下的字节才交给 doWorldAttachChangeGemSelect。少写这个状态字节的话，客户端会把
// 「条数」当状态、把「槽位高字节(通常是 0)」当条数，消耗清单变空，确认时发出去 0 条材料 ——
// 界面上表现就是「点了确定没有任何反应」。所以这里照客户端那样分两步读。
const readQuote=reader=>{
  const status=reader.getByte();
  if(status<0)return {status,message:reader.getString()};
  const rows=[];for(let n=reader.getByte();n>0;n--)rows.push({slot:reader.getShort(),quantity:reader.getByte()});
  reader.finish();return {status,rows};
};

test('11507/11508 协议往返：报价清单与确认消耗一致，回包能被原版解析器解出新宝石属性',()=>{
  const p=role();gemState(p).push({itemId:plus3Wisdom,quantity:20});
  const context={role:p};let saves=0,sent=null;
  const call=(type,w)=>{sent=null;handleEquipmentUpgrades(type,new ProtocolReader(w.done()),context,{store:{save(){saves++;}},send(t,out){sent=out.done();},log(){},draw:()=>99});return new Reader(sent);};

  const quote=readQuote(call(11507,new Writer().short(30).int(equipmentId).short(32)));
  assert.equal(quote.status,0,'报价的第一个字节必须是状态位，客户端会先读走它');
  assert.deepEqual(quote.rows,[{slot:32,quantity:40}]);
  assert.equal(saves,0,'报价阶段不能落盘');

  const confirm=new Writer().short(30).int(equipmentId).byte(quote.rows.length);
  for(const row of quote.rows)confirm.short(row.slot).byte(row.quantity);
  confirm.bool(true);
  const reply=call(11508,confirm);
  assert.equal(reply.getByte(),0);                            // 11508 不在 resultMsg 里，状态位由调用方自己读
  const updated=readItem(reply);reply.finish();               // 有尾巴 finish() 会抛，回包必须正好读完
  assert.equal(updated.id,equipmentId);
  assert.equal(updated.attachDone,20);assert.equal(updated.attachPower,1);assert.equal(updated.attachValue,80);
  assert.equal(saves,1);
  assert.equal(gemState(p)[0].itemId,strength4);
  assert.equal(p.inventory.find(i=>i.slot===32).quantity,20);
});

test('11507 的应答永远以状态位开头：不满足条件时由它带上原因，客户端框架自己弹给玩家',()=>{
  const invoke=role=>{let sent=null;return (type,w)=>{sent=null;handleEquipmentUpgrades(type,new ProtocolReader(w.done()),{role},{store:{save(){throw Error('不应该落盘');}},send(t,out){sent=out.done();},log(){},draw:()=>99});return new Reader(sent);};};
  // ① 装备上一颗宝石都没有
  const none=readQuote(invoke(role())(11507,new Writer().short(30).int(equipmentId).short(32)));
  assert.equal(none.status,-1);assert.match(none.message,/还没有镶嵌宝石/);
  // ② 宝石不够：理由也放在 11507 上，玩家在面板还没弹出来之前就能看到。
  const short=role();gemState(short).push({itemId:plus3Wisdom,quantity:20});
  short.inventory=short.inventory.map(i=>i.slot===32?{...i,quantity:12}:i);
  const lacking=readQuote(invoke(short)(11507,new Writer().short(30).int(equipmentId).short(32)));
  assert.equal(lacking.status,-1);assert.match(lacking.message,/背包里只有 12 颗/);
  // ③ 没走报价直接确认（例如界面被重建过）：11508 自己再回一条拒绝。
  const reject=invoke(role())(11508,new Writer().short(30).int(equipmentId).byte(0).bool(true));
  assert.equal(reject.getByte(),-1);assert.match(reject.getString(),/重新打开宝石替换/);
});

// 整条链路：从「镶嵌宝石」商店领 +4 宝石 → 镶到装备上 → 再用另一属性 +4 宝石整体替换。
// 走的是 server.mjs 里那套真实处理链（handleEquipmentUpgrades 排在 handleRestoration 之前）。
test('从商店领 +4 宝石、镶嵌、再整件替换，全链路走真实协议处理',()=>{
  const p=normalizeRole({id:1,name:'宝石验收',level:97,mapId:19,x:21,y:18,coins:0,gold:0,silver:0,restoration:{starterIssued:true},
    inventory:[{itemId:equipmentId,slot:30,quantity:1,bound:true}]});
  const context={role:p},replies=[];
  const dispatch=(type,w)=>{replies.length=0;const r=new ProtocolReader(w.done());
    const out={store:{save(){}},send(t,body){replies.push({type:t,bytes:body.done()});},log(){},draw:()=>0};
    if(handleEquipmentUpgrades(type,r,context,out))return new Reader(replies.at(-1).bytes);
    if(handleRestoration(type,r,context,out))return new Reader(replies.at(-1).bytes);
    throw Error('没有处理器认领协议 '+type);};

  dispatch(12005,new Writer().short(905).int(intelligence4).byte(80).bool(false));
  dispatch(12005,new Writer().short(905).int(strength4).byte(80).bool(false));
  assert.equal(p.inventory.find(i=>i.itemId===intelligence4).quantity,80,'+4 智力宝石可以在镶嵌宝石商店免费领取');
  assert.equal(p.coins,0,'免费商店不能扣铜币');

  const gemSlot=p.inventory.find(i=>i.itemId===intelligence4).slot;
  for(let n=0;n<20;n++)dispatch(12001,new Writer().byte(6).byte(6).short(30).int(1).short(gemSlot).bool(false).byte(13));
  const attachment=gemAttachment(equipment.get(equipmentId),p.inventory.find(i=>i.slot===30));
  assert.deepEqual(attachment,{count:20,power:7,value:80});                       // 20 颗 +4 智力
  assert.equal(p.inventory.find(i=>i.itemId===intelligence4).quantity,60);

  const strengthSlot=p.inventory.find(i=>i.itemId===strength4).slot;
  const quote=readQuote(dispatch(11507,new Writer().short(30).int(equipmentId).short(strengthSlot)));
  assert.equal(quote.status,0);
  assert.deepEqual(quote.rows,[{slot:strengthSlot,quantity:40}],'替换要 2×20 颗 +4 力量');
  const confirm=new Writer().short(30).int(equipmentId).byte(quote.rows.length);
  for(const row of quote.rows)confirm.short(row.slot).byte(row.quantity);
  confirm.bool(true);
  const reply=dispatch(11508,confirm);
  assert.equal(reply.getByte(),0);
  const updated=readItem(reply);reply.finish();
  assert.equal(updated.attachDone,20);assert.equal(updated.attachPower,1);assert.equal(updated.attachValue,80);
  assert.equal(p.inventory.find(i=>i.itemId===strength4).quantity,40);
});

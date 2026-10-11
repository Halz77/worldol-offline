import {Writer} from './codec.mjs';

// 单机补充：五维 +4 宝石。
//
// 为什么需要补：官方目录（data/official-v305.json 的 type 30）里只采集到 +1/+2/+3 的
// 五维宝石，另加「加50生命宝石」「加20魔法宝石」；唯一出现过 +4 的地方是
// data/manual-item-grants.json 的「加4力量宝石（单机直装）」，那只是直装玩法内部用的
// 属性快照，并不是一件能拿在手里镶嵌的道具。而原版角色的装备导出里确实存在
// attachPower=1、attachValue=颗数×4 的 +4 力量宝石（见 tests/fixtures/character-export.json），
// 可见原版有 +4 档，只是没有被采集到完整道具定义。
//
// 补进去之后会自动出现在「新月繁华之都（20,18）· 装备与补给商人 → 镶嵌宝石」商店里
// （商店按 type 30 分类），可以像原版宝石一样镶嵌（同一装备只能镶同属性的规则不变，
// +4 与 +3 同属一个属性位，可以混镶），也可以用于装备的「宝石替换」。
//
// 定义字节必须和原版宝石完全同格式，否则客户端解出来就是一件坏道具。
// 下面的写出顺序是从五颗已采集的 +3 宝石（390–394）反推出来的，加载时会拿它们做一次
// 二进制回环校验：格式一旦对不上就直接报错，而不是安静地造出一件坏宝石。
const GEM_INFO='镶嵌在装备上可以增加相应属性。单机补充的 +4 档，可在装备与补给商人的「镶嵌宝石」分类领取。';

// 属性位（POWER_STR=1 / CON=3 / AGI=5 / ILT=7 / WIS=9）→ 已采集的 +3 宝石编号。
const PLUS3_GEM={1:390,3:393,5:392,7:391,9:394};
// 属性位 → 新补的 +4 宝石编号。8004xx 是本项目的本地道具号段，官方目录里没有占用。
const PLUS4_GEM_ID={1:800401,3:800402,5:800403,7:800404,9:800405};

export const PLUS4_GEM_POWERS=Object.keys(PLUS4_GEM_ID).map(Number);
export const plus4GemItemId=power=>PLUS4_GEM_ID[power]??0;

// 原版宝石定义（type 30）的字节布局：固定头 + 名称 + 图标 + 说明 + 品质/绑定/堆叠等
// 标量 + 3 字节常量(500) + 一组 power/powerValue。
function encode(gem){
 return new Writer().byte(30).bool(false).int(gem.id).string(gem.name).int(gem.bagIcon).string(gem.info)
  .byte(gem.grade).byte(gem.autoBinding).byte(gem.stackNum).bool(false).byte(gem.reqLv)
  .byte(0).short(500)
  .short(gem.power1).short(gem.powerValue1).done().toString('base64');
}

export function localGems(items){
 const byId=new Map(items.map(item=>[item.id,item])),added=[];
 for(const [power,baseId] of Object.entries(PLUS3_GEM)){
  const base=byId.get(baseId);
  if(!base||base.type!==30||base.power1!==Number(power)||base.powerValue1!==3)throw Error(`+3 宝石 ${baseId} 的采集格式与预期不符，无法据此补 +4 档。`);
  if(!Buffer.from(base.definitionBase64,'base64').equals(Buffer.from(encode(base),'base64')))throw Error(`宝石 ${baseId} 的定义字节与本地写出顺序不一致，+4 宝石已停止生成。`);
  const id=PLUS4_GEM_ID[power];
  if(byId.has(id))throw Error(`+4 宝石编号 ${id} 已被占用。`);
  const name=base.name.replace('3','4');
  if(name===base.name||name.length!==base.name.length)throw Error(`宝石 ${baseId} 的名称「${base.name}」不含可替换的档位数字。`);
  // 品质提到 2（蓝），和原版 +3 档（品质 1）在背包里能一眼分开；除此之外字段全部沿用原版。
  const gem={...base,id,name,powerValue1:4,grade:2,info:GEM_INFO,sources:[{origin:'local-requested-gem',power:Number(power),value:4}]};
  gem.definitionBase64=encode(gem);
  added.push(gem);
 }
 if(added.length!==Object.keys(PLUS4_GEM_ID).length)throw Error('+4 宝石没有全部生成。');
 return added;
}

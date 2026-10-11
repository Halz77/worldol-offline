import fs from 'node:fs';
import {Writer} from './codec.mjs';

// 单机补充：美容院「更换发型 / 更换脸型 / 全新发型」（商店 51 / 52 / 55）。
//
// 原版这两个菜单是普通道具商店，卖的是**买下即生效**的造型道具：客户端读到购买
// 回包的状态位 2 就直接调 updateHair / updateFace 改写自己的外观位域，道具根本不
// 进背包，更不会走装备流程（见主包 Player.prototype.updateHair/updateFace 与
// t.onItemShopBuy 里的 `2==p` 分支）。
//
// 判定条件写死在主包 ModelConst 里：
//   ITEM_ID_HAIR_START=40100 / ITEM_ID_HAIR_END=40199
//   ITEM_ID_FACE_START=40200 / ITEM_ID_FACE_END=40249
//   isHairItem(t){return t>=40100&&t<=40199}
//   isFaceItem(t){return t>=40200&&t<=40249}
// 所以本地补的道具编号必须落在这两个区间，客户端才会把它当造型道具。
//
// 商品清单整个工程都没有采集到（shopID 51/52/55 只出现在 NPC 定义里，12004 的
// 采集记录只有 VIP 商店那一份），因此没有资料就按「世界OL_源码」下那四份发型/脸型
// 贴图目录（face_png_i / face_png_o / hair_png_i / hair_png_o，i = 男、o = 女）还原。
// 清单由 tools/build-fashion-icons.mjs 生成到 data/fashion-icons.json。
//
// 外观位域（analysis/modules/0012.js 的 ModelConst，与主包 updateHair/updateFace 一致）：
//   icon1.low  第 7..10 位 = 发型样式    第 11..12 位 = 发色
//   icon1.low  第 13..16 位 = 脸型样式
//   icon1.high 第  0..2 位 = 发型附加    第  3 位     = 脸型附加
// 客户端的改法是「先清掉自己那几位、再写上新的」，所以「只改脸型」的道具不会动发型，
// 反之亦然——这正是两个菜单能分开的原因。

const TEMPLATE_ID=15012; // 明神时装：确认目录里有 type 12 时装，并沿用 icon/durMax 等通用字段

const catalog=JSON.parse(fs.readFileSync(new URL('../data/fashion-icons.json',import.meta.url),'utf8'));

export const FASHION_ICON_SHEET=catalog.sheet;
export const FASHION_ICON_URL=catalog.url;
export const FASHION_ATLAS=catalog.atlas;
export const FASHION_ICON_IDS=new Set(catalog.itemIds);

const HAIR_IDS=catalog.hair.map(item=>item.id);
const FACE_IDS=catalog.faces.map(item=>item.id);

const INFO_PREFIX='单机补充的造型道具（按客户端自带的发型/脸型贴图还原）。';

// 编码一件造型道具。字段顺序严格对齐客户端 analysis/modules/0032.js 里
// fromBytesAtts2 的 ITEM_CLASS_ARMOR 分支（已用 capture-decoders 的真实解码器逐字节
// 回读核对过）：
//   type(1) handBookItem(1) id(4) name(len) bagIcon(4) info(len) grade(1)
//   autoBinding(1) stackNum(1) decomCHest(1)
//   icon(2) ownTime(2) durMax(4) price(4) attachCount(1) itemSet(1) reqLv(1)
//   reqStr..reqWis(5×2) def_str/def_agi/def_mag(3×2) power1..powerValue3(6×2)
//   ascFlag(1) 组合技能数(1) skillDesc(len) bindPower1..bindPowerValue2(4×2)
//   ascensionStar(1) star(1) fashIcon1/2/3(3×8) vipLevelReq(1)
//   enchantPower1..enchantLevel(5×2) css 4×bool + 2×short isUpgradeItem(1)
//   upgradeAscensionStar(1) upgradeStar(1)
// 为什么必须是 type 12：客户端只有 ITEM_CLASS_ARMOR 分支会读 icon(2)
//   case e.ITEM_CLASS_ARMOR: t.icon = i.getShort(); ...
// 而 ITEM_CLASS_USE_ITEM 之类的分支根本不读 icon（那边是从 reqLv 直接开始）。
// 客户端 updateHair/updateFace 要拿 t.icon 去算样式/颜色，所以这里只能走时装编码。
//
// 注意：fromItemAscensionStarInfo 里 `n && (A, B, C, ...)` 是逗号表达式，只有第一个
// A 受 n 短路控制，B/C（组合技能、skillDesc、bindPower、ascensionStar、star）无条件读，
// 所以 ascFlag=false 也要把这几个字段写进去。
// 除 id/name/bagIcon/info/icon/fashIcon1 外全部置 0：道具不带任何属性，
// 只为把外观编码（icon）交给客户端。
function encode(item){
 return new Writer()
  .byte(12).bool(false).int(item.id).string(item.name).int(item.bagIcon).string(item.info)
  .byte(item.grade).byte(0).byte(1).bool(false)
  .short(item.icon).short(0).int(item.durMax).int(0).byte(0).byte(0).byte(1)
  .short(0).short(0).short(0).short(0).short(0)                 // reqStr..reqWis
  .short(0).short(0).short(0)                                   // def_str / def_agi / def_mag
  .short(0).short(0).short(0).short(0).short(0).short(0)        // power1..3 与数值
  .bool(false)                                                  // ascFlag
  .byte(0)                                                      // 组合技能数量
  .string('')                                                   // skillDesc
  .short(0).short(0).short(0).short(0)                          // bindPower1..bindPowerValue2
  .byte(0).byte(0)                                              // ascensionStar / star
  .long(item.fashIcon1).long(0).long(0)                         // fashIcon1/2/3
  .byte(0)                                                      // vipLevelReq
  .short(0).short(0).short(0).short(0).short(0)                 // enchantPower1..enchantLevel
  .bool(false).bool(false).bool(false).bool(false)              // css 通道
  .short(0).short(0)                                            // css 百分比
  .bool(false)                                                  // isUpgradeItem
  .byte(0).byte(0)                                              // upgradeAscensionStar / upgradeStar
  .done();
}

const ICON_UNIT=4294967296; // icon1 是 64 位：low = value % 2^32、high = value / 2^32

function splitIcon(value){
 const number=Number(value)||0;
 return {low:Math.floor(number%ICON_UNIT)>>>0,high:Math.floor(number/ICON_UNIT)>>>0};
}
function joinIcon(low,high){return high*ICON_UNIT+(low>>>0);}

// 复刻主包 Player.prototype.updateHair：清掉样式(7..10)/颜色(11..12)/附加(high 0..2)
// 之后按 icon 编码写回。传进来的 icon1 是角色当前的 64 位外观值，性别/阵营/职业位原样保留。
export function applyHairAppearance(icon1,style,color){
 const {low:previousLow,high:previousHigh}=splitIcon(icon1);
 let low=previousLow;
 low=(low&~(15<<7))>>>0;   // LEN_HAIR_STYLE=15  OFFSET_HAIR_STYLE=7
 low=(low&~(3<<11))>>>0;   // LEN_HAIR_COLOR=3   OFFSET_HAIR_COLOR=11
 low=(low|((style&15)<<7))>>>0;
 low=(low|((color&3)<<11))>>>0;
 let high=previousHigh;
 high=(high&~7)>>>0;       // LEN_HAIR_ADD=7     OFFSET_HAIR_ADD=0
 high=(high|((style>>4)&7))>>>0;
 return joinIcon(low,high);
}

// 复刻 Player.prototype.updateFace：清掉脸型样式(13..16)与附加(high 3)。
export function applyFaceAppearance(icon1,style){
 const {low:previousLow,high:previousHigh}=splitIcon(icon1);
 let low=previousLow;
 low=(low&~(15<<13))>>>0;  // LEN_FACE_STYLE=15  OFFSET_FACE_STYLE=13
 low=(low|((style&15)<<13))>>>0;
 let high=previousHigh;
 high=(high&~(1<<3))>>>0;  // LEN_FACE_ADD=1     OFFSET_FACE_ADD=3
 high=(high|((style>>4)&1)<<3)>>>0;
 return joinIcon(low,high);
}

export function localFashion(items){
 const template=items.find(item=>item.id===TEMPLATE_ID);
 if(!template||template.type!==12)throw Error(`时装模板 ${TEMPLATE_ID} 不在目录里，无法据此补美容院造型道具。`);
 // 继承模板的完整字段，保证 tests/official.test.mjs 里「解码字段 === 目录字段」的
 // 全字段回环校验能过（它逐个比对 id/name/type/grade/req*/def_*/power/bagIcon 等）。
 // 下面覆盖的字段必须与 encode() 写出的字节一致，否则解码值与目录值对不上。
 const base={
  ...template,
  id:0,name:'',bagIcon:0,info:'',grade:2,
  // 模板自带「绑定力量」与整套外观，本地造型道具要清干净：只留 fashIcon1 的外观位。
  bindPower1:0,bindPowerValue1:0,bindPower2:0,bindPowerValue2:0,
  fashIcon2:0,fashIcon3:0,
  // 去掉来源引用，避免误当作已采集的官方道具。
  sources:undefined,
 };
 const added=[];
 // bagIcon 直接用道具编号：客户端 Tool.getIconByData 把 bagIcon 转成字符串当资源名用，
 // 而 data/fashion-icons.json 里的图集正是以这些编号做子键（见 web/offline.js 的图标钩子）。
 // 图集里每件道具两张帧——「<编号>」是男性、「<编号>f」是女性，都是「脸型碎片 + 发型碎片」
 // 叠出来的头像，和角色穿在身上的样子同源，客户端按角色性别的那一位去取。
 for(const entry of catalog.hair){
  const item={...base,id:entry.id,bagIcon:entry.id,icon:entry.icon,name:`发型 ${added.length+1}`,
   info:`${INFO_PREFIX}第 ${added.length+1} 款：发型样式 ${entry.style}·颜色 ${entry.color}（贴图 ${entry.icon}）。购买后立即更换，不需要装备。`,
   fashIcon1:(entry.style<<7)|(entry.color<<11)};
  item.definitionBase64=encode(item).toString('base64');
  added.push(item);
 }
 const hairCount=added.length;
 for(const entry of catalog.faces){
  const index=added.length-hairCount;
  const item={...base,id:entry.id,bagIcon:entry.id,icon:entry.icon,name:`脸型 ${index+1}`,
   info:`${INFO_PREFIX}第 ${index+1} 款：脸型样式 ${entry.style}（贴图 ${entry.icon}）。购买后立即更换，不需要装备。`,
   fashIcon1:entry.style<<13};
  item.definitionBase64=encode(item).toString('base64');
  added.push(item);
 }
 const ids=added.map(item=>item.id);
 if(added.length!==HAIR_IDS.length+FACE_IDS.length)throw Error('美容院造型道具没有全部生成。');
 if(new Set(ids).size!==ids.length)throw Error('美容院造型道具编号重复。');
 return added;
}

export const APPEARANCE_ITEM_IDS=new Set([...HAIR_IDS,...FACE_IDS]);

// 服务端购买这些道具时要自己改写角色外观：客户端那边是本地改 myPlayer.icon1，
// 服务端必须同步改并存盘，否则重新登录或刷新角色列表后造型会退回去。
export const appearanceByItemId=new Map([
 ...catalog.hair.map(entry=>[entry.id,{kind:'hair',style:entry.style,color:entry.color,icon:entry.icon}]),
 ...catalog.faces.map(entry=>[entry.id,{kind:'face',style:entry.style,color:0,icon:entry.icon}]),
]);

export function applyAppearance(icon1,appearance){
 return appearance.kind==='hair'
  ?applyHairAppearance(icon1,appearance.style,appearance.color)
  :applyFaceAppearance(icon1,appearance.style);
}

// 美容院的三个菜单项（NPC 里 shopID 是 [51,52,10052,55] / [51,52,10052,10057]，
// 其中 10052 与 10057 是合成界面，交给原生流程）。这里只提供三个造型商店。
export const appearanceShops=[
 {id:51,name:'更换发型',items:[...HAIR_IDS]},
 {id:52,name:'更换脸型',items:[...FACE_IDS]},
 {id:55,name:'全新发型',items:[...HAIR_IDS]},
];

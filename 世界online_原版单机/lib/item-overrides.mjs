import fs from 'node:fs';
import {equipmentBytes} from './character-import-codec.mjs';
import {Writer} from './codec.mjs';

/**
 * 本地装备属性覆盖（data/local-item-overrides.json）。
 *
 * 原版装备定义来自 data/official-v305.json（抓包产物，一字节不改）。要改某件装备的
 * 属性就在覆盖层里写一条，`lib/official-data.mjs` 的 ensure() 在**所有补丁合完之后、
 * 建 officialItems 索引之前**套用：
 *   合并字段 → 重算派生字段（powers / level / requirements / durability…）
 *   → 用 character-import-codec 的 equipmentBytes 重新写一份 definitionBase64。
 *
 * 为什么必须重写 definitionBase64：客户端收到的道具定义（16051 / 12016 / 背包包）
 * 发的就是这段字节；服务端算属性（lib/native-character-stats.mjs）也是先 itemPacket
 * 再按客户端解码器读它。只改 JSON 字段不改字节，游戏里一分属性都不会变。
 *
 * 字节写出**只有一份实现**（character-import-codec.mjs 的 writeEquipment），
 * 2134 件官方装备逐字节重编码全部一致（tests/item-overrides.test.mjs 有守卫）。
 *
 * 结构：
 *   items[道具id]    = { _note?: "备注", 字段: 值, ... }   装备属性（定义字节）
 *   identify[道具id] = { power1: [ {power,min,max}, … ], … }  鉴定范围（第 87 版）
 * 只写要改的字段，没写的保持原值。
 *
 * ⚠ 改的是「定义」——同一件装备的所有副本一起变；存档里已鉴定的词条数值
 * （inventory[].affixes）属于实例数据，由游戏内的鉴定/合成改写。
 */

const FILE=new URL('../data/local-item-overrides.json',import.meta.url);

/** 字段分组（编辑器按这个顺序排版）。 */
export const ITEM_FIELD_GROUPS=[
 {id:'basic',label:'基础信息'},
 {id:'require',label:'穿戴需求'},
 {id:'defense',label:'基础防御'},
 {id:'powers',label:'附加属性'},
 {id:'weapon',label:'武器数据（仅武器类）'},
 {id:'more',label:'耐久 / 价格 / 孔位'},
 {id:'upgrade',label:'强化与进阶鉴定'},
 {id:'enchant',label:'附魔槽'},
 {id:'text',label:'说明文字'}
];

/**
 * 可覆盖字段表 —— 客户端编辑器（装备编辑器.html）与服务端校验**共用这一份**，
 * 由 tools/build-item-editor-data.mjs 内嵌进 HTML。
 *
 * kind：string / int / short / byte / bool / power
 *   power = 属性编号（走 powers 下拉），数值语义同 short。
 * weapon:true 的字段只在武器类（13—24 / 34—39）的字节里有位置，其它类型写了会被忽略，
 *   所以编辑器会按类型隐藏；服务端也会拒绝给非武器写这些字段。
 */
export const ITEM_FIELDS=[
 {key:'name',label:'名称',kind:'string',group:'basic',max:40},
 {key:'bagIcon',label:'图标编号（bagIcon）',kind:'int',group:'basic',min:0},
 {key:'icon',label:'图标子键（icon）',kind:'short',group:'basic',min:0},
 {key:'grade',label:'品级',kind:'byte',group:'basic'},
 {key:'autoBinding',label:'自动绑定',kind:'bool',group:'basic'},
 {key:'stackNum',label:'堆叠上限',kind:'byte',group:'basic',min:1},
 {key:'decomCHest',label:'可分解',kind:'bool',group:'basic'},
 {key:'ownTime',label:'时效（秒，0=永久）',kind:'short',group:'basic',min:0},
 {key:'vipLevelReq',label:'VIP 等级需求',kind:'byte',group:'require'},
 {key:'reqLv',label:'需求等级',kind:'byte',group:'require'},
 {key:'reqStr',label:'需求·力量',kind:'short',group:'require',min:0},
 {key:'reqCon',label:'需求·体质',kind:'short',group:'require',min:0},
 {key:'reqAgi',label:'需求·敏捷',kind:'short',group:'require',min:0},
 {key:'reqIlt',label:'需求·智力',kind:'short',group:'require',min:0},
 {key:'reqWis',label:'需求·感知',kind:'short',group:'require',min:0},
 {key:'def_str',label:'劈砍防御',kind:'short',group:'defense'},
 {key:'def_agi',label:'穿刺防御',kind:'short',group:'defense'},
 {key:'def_mag',label:'魔法防御',kind:'short',group:'defense'},
 {key:'power1',label:'附加属性 1',kind:'power',group:'powers'},
 {key:'powerValue1',label:'附加属性 1 数值',kind:'short',group:'powers'},
 {key:'power2',label:'附加属性 2',kind:'power',group:'powers'},
 {key:'powerValue2',label:'附加属性 2 数值',kind:'short',group:'powers'},
 {key:'power3',label:'附加属性 3',kind:'power',group:'powers'},
 {key:'powerValue3',label:'附加属性 3 数值',kind:'short',group:'powers'},
 {key:'bindPower1',label:'鉴定槽 1 属性',kind:'power',group:'powers'},
 {key:'bindPowerValue1',label:'鉴定槽 1 数值',kind:'short',group:'powers'},
 {key:'bindPower2',label:'鉴定槽 2 属性',kind:'power',group:'powers'},
 {key:'bindPowerValue2',label:'鉴定槽 2 数值',kind:'short',group:'powers'},
 {key:'atkType',label:'攻击类型',kind:'atkType',group:'weapon',weapon:true},
 {key:'atk_time',label:'攻击次数修正（实际 = 此值 + 1）',kind:'byte',group:'weapon',weapon:true},
 {key:'atkMin',label:'攻击下限',kind:'short',group:'weapon',weapon:true,min:0},
 {key:'atkMax',label:'攻击上限',kind:'short',group:'weapon',weapon:true,min:0},
 {key:'hitrate',label:'命中',kind:'byte',group:'weapon',weapon:true},
 {key:'durMax',label:'耐久上限',kind:'int',group:'more',min:0},
 {key:'price',label:'价格（铜）',kind:'int',group:'more',min:0},
 {key:'attachCount',label:'宝石孔数（客户端建议 ≤30）',kind:'byte',group:'more'},
 {key:'itemSet',label:'套装编号',kind:'byte',group:'more'},
 {key:'ascensionStar',label:'飞升星级',kind:'byte',group:'upgrade'},
 {key:'star',label:'强化星级',kind:'byte',group:'upgrade'},
 {key:'isUpgradeItem',label:'可进阶鉴定',kind:'bool',group:'upgrade'},
 {key:'power4',label:'进阶鉴定 1',kind:'power',group:'upgrade'},
 {key:'powerValue4',label:'进阶鉴定 1 数值',kind:'short',group:'upgrade'},
 {key:'power5',label:'进阶鉴定 2',kind:'power',group:'upgrade'},
 {key:'powerValue5',label:'进阶鉴定 2 数值',kind:'short',group:'upgrade'},
 {key:'power6',label:'进阶鉴定 3',kind:'power',group:'upgrade'},
 {key:'powerValue6',label:'进阶鉴定 3 数值',kind:'short',group:'upgrade'},
 {key:'power7',label:'进阶鉴定 4',kind:'power',group:'upgrade'},
 {key:'powerValue7',label:'进阶鉴定 4 数值',kind:'short',group:'upgrade'},
 {key:'upgradeAscensionStar',label:'进阶·飞升星级',kind:'byte',group:'upgrade'},
 {key:'upgradeStar',label:'进阶·强化星级',kind:'byte',group:'upgrade'},
 {key:'enchantPower1',label:'附魔 1 属性',kind:'power',group:'enchant'},
 {key:'enchantPowerValue1',label:'附魔 1 数值',kind:'short',group:'enchant'},
 {key:'enchantPower2',label:'附魔 2 属性',kind:'power',group:'enchant'},
 {key:'enchantPowerValue2',label:'附魔 2 数值',kind:'short',group:'enchant'},
 {key:'enchantLevel',label:'附魔等级',kind:'short',group:'enchant',min:0},
 {key:'skillDesc',label:'技能说明',kind:'string',group:'text',max:120},
 {key:'info',label:'道具说明',kind:'string',group:'text',max:300}
];

/** 允许写进 JSON 的键（含备注）；其余一律拒绝，防止拼错字段名后静默失效。 */
export const OVERRIDABLE_FIELDS=[...ITEM_FIELDS.map(f=>f.key),'_note'];

const BY_KEY=new Map(ITEM_FIELDS.map(f=>[f.key,f]));

/** 客户端与 wire 都认的装备类型：0—12 防具/首饰/坐骑/时装，13—24 与 34—39 武器。 */
export const isEquipmentType=type=>(type>=0&&type<=12)||(type>=13&&type<=24)||(type>=34&&type<=39);
/** 武器类：字节布局里多出 atkType/atk_time/atkMin/atkMax/hitrate 一段。 */
export const isWeaponType=type=>(type>=13&&type<=24)||(type>=34&&type<=39);

// 注意 byte：writer 是 `writeUInt8(n & 255)`、reader 是 `readInt8`，所以 wire 上等于
// 「有符号字节」—— 官方数据里 itemSet 有 -43、hitrate 有 -1（tests 里逐条扫过），
// 校验必须放 -128..255，否则复制现有值都会被自己拒掉。
const RANGES={byte:[-128,255],short:[-32768,32767],int:[-2147483648,2147483647],power:[-32768,32767],atkType:[0,6]};

/** 校验并归一一个字段值；非法值点名抛错（覆盖文件写错要立刻看得见，不能静默失效）。 */
function normalizeField(key,value,label){
 const field=BY_KEY.get(key);
 if(!field)throw Error(`${label}：不可覆盖字段 "${key}"。`);
 const name=`${label} 的 "${key}"（${field.label}）`;
 if(field.kind==='string'){
  if(typeof value!=='string')throw Error(`${name} 必须是字符串。`);
  if(value.length>(field.max||120))throw Error(`${name} 太长（最多 ${field.max||120} 个字符）。`);
  return value;
 }
 if(field.kind==='bool'){
  if(typeof value!=='boolean')throw Error(`${name} 必须是 true / false。`);
  return value;
 }
 const n=typeof value==='number'?value:Number(value);
 if(!Number.isInteger(n))throw Error(`${name} 必须是整数。`);
 let [min,max]=RANGES[field.kind]||RANGES.int;
 if(field.min!==undefined)min=field.min;
 if(field.max!==undefined)max=field.max;
 if(n<min||n>max)throw Error(`${name} 超出范围 ${min}..${max}（收到 ${n}）。`);
 return n;
}

function loadData(){
 // 与 lib/local-skill-overrides.mjs 同样的理由：**不能**用 fs.existsSync 做门控 ——
 // APK 里 node:fs 是 VFS shim，existsSync 只查已预载的内存表，data/ 下的文件是
 // 运行时按需 XHR 取的，existsSync 恒 false。直接 readFileSync，ENOENT 才当「没有覆盖」。
 let raw;
 try{
  raw=JSON.parse(fs.readFileSync(FILE,'utf8'));
 }catch(error){
  if(error&&error.code==='ENOENT')return {revision:null,items:{}};
  throw error;
 }
 if(!raw||typeof raw!=='object'||!raw.items||typeof raw.items!=='object'||Array.isArray(raw.items))
  throw Error('local-item-overrides.json 结构不对：缺少 items 对象。');
 if(raw.identify!==undefined&&(!raw.identify||typeof raw.identify!=='object'||Array.isArray(raw.identify)))
  throw Error('local-item-overrides.json 结构不对：identify 必须是「道具 id → 槽位」的对象。');
 return raw;
}

let cached=null;
function data(){
 if(cached===null)cached=loadData();
 return cached;
}

export const itemOverrideRevision=()=>data().revision||null;

/**
 * 校验并归一一份覆盖表（编辑器写出的内容同样走这里）。
 * @returns {Map<number,{note:string|null,fields:object}>}
 */
export function compileItemOverrides(rawItems){
 const out=new Map();
 for(const [idRaw,entry] of Object.entries(rawItems||{})){
  const id=Number(idRaw);
  if(!Number.isInteger(id)||id<=0)throw Error(`local-item-overrides.json：非法道具 id "${idRaw}"。`);
  const label=`local-item-overrides.json：道具 ${id}`;
  if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error(`${label} 的覆盖必须是对象。`);
  const fields={};
  let note=null;
  for(const [key,value] of Object.entries(entry)){
   if(key==='_note'){note=typeof value==='string'?value:String(value);continue;}
   // id / type / handBookItem 会改变字节布局，一律不许覆盖（否则客户端解析错位）。
   if(key==='id'||key==='type'||key==='handBookItem')
    throw Error(`${label}：字段 "${key}" 不允许覆盖（会改变定义的字节布局）。`);
   fields[key]=normalizeField(key,value,label);
  }
  if(!Object.keys(fields).length&&!note)throw Error(`${label} 的覆盖是空的。`);
  out.set(id,{note,fields});
 }
 return out;
}

/** 读文件后编译一次（服务端启动路径用）。 */
export function itemOverrides(){return compileItemOverrides(data().items);}

/** 该道具是否配了覆盖规则。 */
let overrideIds=null;
export const hasItemOverride=id=>{
 if(!overrideIds)overrideIds=new Set(itemOverrides().keys());
 return overrideIds.has(Number(id));
};

/**
 * 把覆盖合并到一条装备定义上，重算派生字段与 definitionBase64。
 * 没命中时原样返回**同一个对象**（调用方据此判断是否真的改过）。
 */
export function applyOverrideToItem(item,entry,label=`道具 ${item?.id}`){
 if(!item||!entry)return item;
 const fields=entry.fields;
 if(!Object.keys(fields).length)return item;
 if(!isEquipmentType(item.type))throw Error(`${label}：type ${item.type} 不是装备，暂不支持覆盖。`);
 if(!item.definitionBase64)throw Error(`${label}：缺少 definitionBase64，无法重写定义。`);
 for(const key of Object.keys(fields))
  if(BY_KEY.get(key)?.weapon&&!isWeaponType(item.type))throw Error(`${label}：type ${item.type} 不是武器，不能覆盖 "${key}"。`);
 const next={...item,...fields};
 // 派生字段：这些是 lib/restoration.mjs 建运行时表时按原值算出来的，
 // 覆盖后必须一起重算，否则「面板显示新值、战斗结算还是旧值」。
 next.level=next.reqLv||0;
 next.requirements=['Str','Con','Agi','Ilt','Wis'].map(k=>next['req'+k]||0);
 next.durability=next.durMax||0;
 next.localPrice=0;
 next.localIcon=next.bagIcon;
 next.attackTimes=(next.atk_time||0)+1;
 next.hit=next.hitrate||0;
 next.powers=[1,2,3].filter(n=>next['power'+n]).map(n=>[next['power'+n],next['powerValue'+n]]);
 try{
  next.definitionBase64=equipmentBytes(next).toString('base64');
 }catch(error){
  throw Error(`${label}：重写定义字节失败（${error.message}）。`);
 }
 return next;
}

/**
 * 把覆盖套到道具数组上（official-data.ensure() 的最后一环）。
 * 原地替换命中的条目 —— 数组顺序不变，officialItems 索引随后才建，所以各处拿到的都是新定义。
 * @returns {string[]} 实际套用了覆盖的道具 id
 */
export function applyItemOverrides(items,compiled=itemOverrides()){
 const applied=[];
 for(const [id,entry] of compiled){
  const index=items.findIndex(x=>x.id===id);
  if(index<0)throw Error(`local-item-overrides.json：找不到道具 ${id}（id 写错了，或它不在官方目录里）。`);
  const next=applyOverrideToItem(items[index],entry);
  if(next!==items[index]){items[index]=next;applied.push(String(id));}
 }
 return applied;
}

/* ==========================================================================
   鉴定范围覆盖（第 87 版）
   --------------------------------------------------------------------------
   「鉴定时随机出哪些词条、数值多大」也来自抓包：official-v305.json 的 identification
   数组（1008 行，一行一件装备）。客户端点「查看鉴定范围」发 12060
   （CG_EQUIP_IDENTIFY_ATTR），服务端回的就是这一行的 wireBase64
   （见 lib/catalog-packets.mjs）；服务端自己随机时读的是同一行的 slots
   （lib/item-affixes.mjs 的 ranges 索引）。
   → **两处必须一起改**：只改 slots 会「界面显示旧范围、服务端按新范围校验」，
     只改 wireBase64 则相反。所以覆盖层同时重写两者。

   wire 布局（与客户端 0513 BagItemProcessInfoMdr 逐字对齐）：
     宠物装备（type 41）先写 string(petScale) + int(petLevel)
     short(槽位数) + 每槽：string(槽位名) + short(候选数)
                          + 候选数 × (short 属性编号, short 最小值, short 最大值)
   1008 行逐字节重编码全部一致（tests/item-overrides.test.mjs 有守卫）。

   结构：
     identify[道具id] = { power1: [ {power,min,max}, … ], bindPower1: […], … }
     槽位只有 power1—power7 / bindPower1—2；写成空数组 = 去掉这个槽位。
   ========================================================================== */

/** 鉴定范围里出现过的全部槽位（顺序即编辑器排版顺序）。 */
export const IDENTIFY_FIELDS=['power1','power2','power3','bindPower1','bindPower2','power4','power5','power6','power7'];

/**
 * 槽位中文名 —— 与客户端「查看鉴定范围」对话框（模块 0513 的 getTypeStr）同一套说法：
 * power1/2/bind1/2 = 鉴定属性，power3 = 合成属性，power4—7 = 进阶属性。
 */
export const IDENTIFY_FIELD_LABELS={
 power1:'鉴定槽 1',power2:'鉴定槽 2',power3:'合成槽',
 bindPower1:'绑定鉴定槽 1',bindPower2:'绑定鉴定槽 2',
 power4:'进阶鉴定槽 1',power5:'进阶鉴定槽 2',power6:'进阶鉴定槽 3',power7:'进阶鉴定槽 4'
};

const SHORT_MIN=-32768,SHORT_MAX=32767;

function identifyInt(value,label){
 const n=typeof value==='number'?value:Number(value);
 if(!Number.isInteger(n))throw Error(`${label} 必须是整数。`);
 if(n<SHORT_MIN||n>SHORT_MAX)throw Error(`${label} 超出范围 ${SHORT_MIN}..${SHORT_MAX}（收到 ${n}）。`);
 return n;
}

function normalizeIdentifyOption(raw,label){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error(`${label} 必须写成 { power, min, max }。`);
 for(const key of Object.keys(raw))
  if(!['power','min','max'].includes(key))throw Error(`${label} 里有不认识的键 "${key}"（只能是 power / min / max）。`);
 const power=identifyInt(raw.power,`${label} 的 power（属性编号）`);
 const min=identifyInt(raw.min,`${label} 的 min（最小值）`);
 const max=identifyInt(raw.max,`${label} 的 max（最大值）`);
 if(power<=0)throw Error(`${label} 的 power 要填属性编号（正整数），收到 ${power}。`);
 if(min>max)throw Error(`${label}：最小值 ${min} 大于最大值 ${max}。`);
 return {power,min,max};
}

/**
 * 校验并归一「鉴定范围」覆盖表。
 * @returns {Map<number,Map<string,Array<{power:number,min:number,max:number}>>>}
 *   外层道具 id，内层槽位名；空数组 = 去掉这个槽位。
 */
export function compileIdentifyOverrides(raw){
 const out=new Map();
 for(const [idRaw,entry] of Object.entries(raw||{})){
  const id=Number(idRaw);
  if(!Number.isInteger(id)||id<=0)throw Error(`local-item-overrides.json 的 identify：非法道具 id "${idRaw}"。`);
  const label=`local-item-overrides.json 的 identify：道具 ${id}`;
  if(!entry||typeof entry!=='object'||Array.isArray(entry))
   throw Error(`${label} 必须写成 { 槽位名: [ {power,min,max}, … ] }。`);
  const slots=new Map();
  for(const [field,list] of Object.entries(entry)){
   if(!IDENTIFY_FIELDS.includes(field))
    throw Error(`${label}：不认识的槽位 "${field}"（只能是 ${IDENTIFY_FIELDS.join(' / ')}）。`);
   if(!Array.isArray(list))throw Error(`${label} 的 ${field} 必须是数组。`);
   if(list.length>64)throw Error(`${label} 的 ${field} 候选太多（最多 64 条，收到 ${list.length} 条）。`);
   slots.set(field,list.map((row,index)=>normalizeIdentifyOption(row,`${label} 的 ${field} 第 ${index+1} 条`)));
  }
  if(!slots.size)throw Error(`${label} 没有任何槽位改动。`);
  out.set(id,slots);
 }
 return out;
}

/** 读文件后编译一次（服务端启动路径用）。 */
export function identifyOverrides(){return compileIdentifyOverrides(data().identify);}

/** 一行鉴定范围 → wire 字节（客户端 12060 回包就是这段）。 */
export function identifyWire(row){
 const w=new Writer();
 // 宠物装备（type 41）的回包在这两个字段之后才是槽位（客户端 0513 逐字对过）。
 if(row.petScale!==undefined)w.string(String(row.petScale)).int(row.petLevel||0);
 const slots=row.slots||[];
 w.short(slots.length);
 for(const slot of slots){
  w.string(slot.field);
  w.short(slot.options.length);
  for(const option of slot.options)w.short(option.power).short(option.min).short(option.max);
 }
 return w.done();
}

/**
 * 把「鉴定范围」覆盖套到 official.identification 上（official-data.ensure() 最后一环）。
 * 原地替换命中的行 —— 行里的 slots 与 wireBase64 一起重写。
 * 原版没采到范围的装备（如 13590 经验加成披风）允许**新建**一行，但只限
 * 定义里真的标成鉴定格（121）/ 合成格（131）的槽位，宠物装备一律不许。
 * @param {object[]} rows official.identification
 * @param {Map} compiled compileIdentifyOverrides() 的结果
 * @param {object[]|null} items official.items（新建行时要拿定义校验标记位）
 * @returns {string[]} 实际套用了覆盖的道具 id
 */
export function applyIdentifyOverrides(rows,compiled=identifyOverrides(),items=null){
 const applied=[];
 for(const [id,changes] of compiled){
  const index=rows.findIndex(row=>row.itemId===id);
  if(index<0){
   // 新建一行：原版抓包里没有这件装备的范围。
   const item=items?.find(x=>x.id===id);
   if(!item)throw Error(`local-item-overrides.json 的 identify：找不到道具 ${id}（id 写错了，或它不在官方目录里）。`);
   if(item.type===41)throw Error(`local-item-overrides.json 的 identify：道具 ${id} 是宠物装备，不能新建鉴定范围。`);
   const slots=[];
   for(const [field,list] of changes){
    if(!list.length)continue;
    if(item[field]!==121&&item[field]!==131)
     throw Error(`local-item-overrides.json 的 identify：道具 ${id} 的 ${field} 不是鉴定格/合成格（当前 ${item[field]??0}），不能新建范围。`);
    slots.push({field,options:list.map(option=>({...option}))});
   }
   if(!slots.length)throw Error(`local-item-overrides.json 的 identify：道具 ${id} 原版没有鉴定范围，新建的也是空的。`);
   rows.push({kind:'identify',itemId:id,slots,wireBase64:'',
    sources:[{origin:'local-identify-override'}]});
   rows[rows.length-1].wireBase64=identifyWire(rows[rows.length-1]).toString('base64');
   applied.push(String(id));
   continue;
  }
  const row=rows[index];
  const slots=(row.slots||[]).map(slot=>({...slot,options:[...(slot.options||[])]}));
  const known=new Set(slots.map(slot=>slot.field));
  for(const field of changes.keys())
   if(!known.has(field))
    throw Error(`local-item-overrides.json 的 identify：道具 ${id} 原版没有 "${field}" 这个槽位`
     +`（有：${[...known].join(' / ')||'无'}）。`);
  for(const [field,list] of changes){
   const at=slots.findIndex(slot=>slot.field===field);
   if(!list.length){slots.splice(at,1);continue;}
   slots[at]={...slots[at],options:list.map(option=>({...option}))};
  }
  const next={...row,slots,sources:[...(row.sources||[]),{origin:'local-identify-override'}]};
  next.wireBase64=identifyWire(next).toString('base64');
  rows[index]=next;
  applied.push(String(id));
 }
 return applied;
}

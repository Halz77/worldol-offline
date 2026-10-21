// 生成「装备编辑器.html」里内嵌的装备目录与标签表。
//
// 为什么要生成而不是手抄：
//   1. 装备属性字段表在 lib/item-overrides.mjs 的 ITEM_FIELDS 里 —— 服务端校验与
//      编辑器表单**必须是同一份**，抄一份就会「编辑器能改、服务端拒绝」或反过来。
//   2. 属性编号 → 中文名取自 技能编辑器.html 里的 game-labels（已经由
//      tools/build-skill-editor-data.mjs 从主包 getPowerDesc 里采过一遍）。
//   3. 装备目录（2134 件，每件十来个字段）用「列式数组」内嵌，HTML 才能双击即用、
//      不需要读 data/（file:// 下 XHR 被浏览器拦）。
//
// 用法：
//   node tools/build-item-editor-data.mjs           # 重新生成并写回 HTML
//   node tools/build-item-editor-data.mjs --check   # 只校验 HTML 与当前数据是否一致
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ITEM_FIELD_GROUPS,ITEM_FIELDS,isEquipmentType,IDENTIFY_FIELDS,IDENTIFY_FIELD_LABELS} from '../lib/item-overrides.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
export const EDITOR_HTML=path.join(root,'装备编辑器.html');
const OFFICIAL=path.join(root,'data','official-v305.json');
const SKILL_EDITOR=path.join(root,'技能编辑器.html');
const MARKER='item-editor-data';

/** 道具类型名（客户端 typeBS 那一排，索引 = type；只用到 0—43）。 */
const TYPE_NAMES=['头','衣','裤','肩','腰带','背','鞋','护手','链','戒','护符','坐骑','时装',
 '单手剑','双手剑','单手刀','双手刀','轻型武器','重型武器','杖','长柄武器','轻弩','重弩','弓箭','副手',
 '任务物品','战斗道具','世界道具','普通道具','建筑材料','宝石','技能书','宠物','特殊','法器',
 '轻枪','重枪','轻型锤','重型锤','扇子','血瓶','宠物装备','宠物装备经验','赋灵符'];

/** 武器攻击类型（skillAtkTypes）。 */
const ATK_TYPES=['近身劈砍','远程劈砍','近身穿刺','远程穿刺','魔法攻击','诅咒攻击','祝福'];

/** 属性编号里「占位标记」，不是真属性，不能给玩家随便选。 */
export const POWER_MARKERS=[121,131,181];

/** 标记位的中文说法（客户端 getPowerDesc 里这几条没有文案，只能我们自己起名）。 */
const MARKER_LABELS={
 121:'鉴定格（随机词条）',
 131:'合成格（免费合成）',
 181:'附魔卡标记'
};

/**
 * 装备语境下用更直白的短名（技能编辑器用游戏官方长文案）：
 * 98 气血/法力回复、111 传送标记、120 按时间获得经验、167 按时间获得任务经验。
 * 这几个编号在装备上真的会出现（111 ×148、98 ×74、120 ×69、167 ×13，逐件扫过）。
 */
const MANUAL_POWER_LABELS={
 98:'气血/法力回复',
 111:'传送标记',
 120:'按时间获得经验',
 167:'按时间获得任务经验'
};

/** 鉴定范围槽位的说明（编辑器里每块槽位标题下面那句）。 */
const IDENTIFY_FIELD_HINTS={
 power1:'普通鉴定：鉴定时从这里随机出一条',
 power2:'普通鉴定：鉴定时从这里随机出一条',
 bindPower1:'绑定鉴定：装备绑定后才能鉴定',
 bindPower2:'绑定鉴定：装备绑定后才能鉴定',
 power3:'「免费装备合成」随机出的属性',
 power4:'进阶鉴定（四格要一次给全）',
 power5:'进阶鉴定（四格要一次给全）',
 power6:'进阶鉴定（四格要一次给全）',
 power7:'进阶鉴定（四格要一次给全）'
};

/** 槽位标题右侧那句短提示（窄面板下会省略，完整说明挂 title）。 */
const IDENTIFY_FIELD_SHORT={
 power1:'鉴定时随机出一条',
 power2:'鉴定时随机出一条',
 bindPower1:'绑定后才能鉴定',
 bindPower2:'绑定后才能鉴定',
 power3:'合成时随机出一条',
 power4:'进阶鉴定（四格一起）',
 power5:'进阶鉴定（四格一起）',
 power6:'进阶鉴定（四格一起）',
 power7:'进阶鉴定（四格一起）'
};

const isReadablePowerName=n=>{
 if(!n||n==='(无)')return false;
 if(/^[A-Z0-9_]+$/.test(n))return false;                 // REFLECTION / NONE / COMPOSITE…
 if(/^(REFLECTION|SKILL_|REMOVE_STATUS|RECOVER)/.test(n))return false;
 return true;
};

/** 从 技能编辑器.html 的 game-labels 里取属性编号 → 中文名。 */
export function readPowerLabels(){
 if(!fs.existsSync(SKILL_EDITOR))throw Error('缺少 技能编辑器.html（属性编号表就在它里面）');
 const html=fs.readFileSync(SKILL_EDITOR,'utf8');
 const m=html.match(/<script[^>]*id="game-labels"[^>]*>([\s\S]*?)<\/script>/);
 if(!m)throw Error('技能编辑器.html 里没找到 game-labels');
 const labels=JSON.parse(m[1]);
 const powers={};
 for(const [id,row] of Object.entries(labels.powers||{})){
  if(!isReadablePowerName(row.n))continue;
  powers[id]={n:row.n,p:!!row.p};
 }
 // 标记位：客户端只给英文常量名，换成中文并标 marker（编辑器据此给提示、不给瞎选数值）
 for(const id of POWER_MARKERS){
  powers[id]={n:MARKER_LABELS[id]||labels.powers?.[String(id)]?.n||String(id),p:false,marker:true};
 }
 // 装备语境下的短名：始终覆盖（技能编辑器那边是官方长文案，面板/技能说明才用那套）
 for(const [id,name] of Object.entries(MANUAL_POWER_LABELS))powers[id]={n:name,p:false};
 return powers;
}

/** 列顺序 = id/name/type + 全部可覆盖字段（去重）+ 只读展示用两列。 */
export function columns(){
 const keys=['id','name','type'];
 const seen=new Set(keys);
 for(const f of ITEM_FIELDS)if(!seen.has(f.key)){keys.push(f.key);seen.add(f.key);}
 for(const k of ['skillName','skillLevel'])if(!seen.has(k)){keys.push(k);seen.add(k);}
 return keys;
}

/** 生成内嵌数据对象（确定性输出：按 id 升序、字段顺序固定）。 */
export function buildPayload(){
 const official=JSON.parse(fs.readFileSync(OFFICIAL,'utf8'));
 const cols=columns();
 const rows=[];
 const ids=new Set();
 for(const item of official.items){
  if(!item.definitionBase64)continue;
  if(!isEquipmentType(item.type))continue;
  const row=cols.map(key=>{
   if(key==='skillName')return item.skill?.name||null;
   if(key==='skillLevel')return item.skill?.level??null;
   const value=item[key];
   return value===undefined||value===null?null:value;
  });
  rows.push(row);
  ids.add(item.id);
 }
 rows.sort((a,b)=>a[0]-b[0]);
 // 鉴定范围（official.identification，1008 行）→ { 道具id: { 槽位: [[属性,最小,最大], …] } }。
 // 只带编辑器里有的装备（972 件左右，约 150 KB）；用三元组数组省体积。
 const identify={};
 for(const row of official.identification||[]){
  if(!ids.has(row.itemId)||!row.slots?.length)continue;
  const slots={};
  for(const slot of row.slots){
   if(!IDENTIFY_FIELDS.includes(slot.field))continue;
   slots[slot.field]=slot.options.map(option=>[option.power,option.min,option.max]);
  }
  if(Object.keys(slots).length)identify[row.itemId]=slots;
 }
 return {
  version:2,
  note:'由 tools/build-item-editor-data.mjs 生成，不要手改；改了跑一次该脚本。',
  groups:ITEM_FIELD_GROUPS,
  fields:ITEM_FIELDS,
  columns:cols,
  types:TYPE_NAMES,
  atkTypes:ATK_TYPES,
  powerMarkers:POWER_MARKERS,
  powers:readPowerLabels(),
  identifyFields:IDENTIFY_FIELDS.map(key=>({
   key,
   label:IDENTIFY_FIELD_LABELS[key],
   hint:IDENTIFY_FIELD_SHORT[key]||'',
   note:IDENTIFY_FIELD_HINTS[key]||''
  })),
  identify,
  items:rows
 };
}

export const serialize=payload=>JSON.stringify(payload);

/** 把 JSON 写进 HTML 的 <script id="item-editor-data"> 块（返回新 HTML）。 */
export function writeIntoHtml(html,json){
 const open=new RegExp(`(<script[^>]*id="${MARKER}"[^>]*>)([\\s\\S]*?)(</script>)`);
 if(!open.test(html))throw Error(`装备编辑器.html 里没有 <script id="${MARKER}"> 占位块`);
 return html.replace(open,(all,head,_body,tail)=>head+json+tail);
}

/** 取出 HTML 里已内嵌的 JSON 原文。 */
export function readFromHtml(html){
 const m=html.match(new RegExp(`<script[^>]*id="${MARKER}"[^>]*>([\\s\\S]*?)</script>`));
 if(!m)throw Error(`装备编辑器.html 里没有 <script id="${MARKER}"> 块`);
 return m[1];
}

function main(){
 const check=process.argv.includes('--check');
 const payload=buildPayload();
 const json=serialize(payload);
 const html=fs.readFileSync(EDITOR_HTML,'utf8');
 if(check){
  const current=readFromHtml(html);
  if(current===json){console.log(`装备编辑器数据一致：${payload.items.length} 件装备。`);return;}
  console.error('装备编辑器数据与当前资料不一致 —— 跑 node tools/build-item-editor-data.mjs 重新生成。');
  if(process.argv.includes('--summary')){
   console.error(`  内嵌 ${current.length} 字节 / 应有 ${json.length} 字节`);
  }
  process.exitCode=1;
  return;
 }
 fs.writeFileSync(EDITOR_HTML,writeIntoHtml(html,json),'utf8');
 console.log(`已写入 ${path.basename(EDITOR_HTML)}：${payload.items.length} 件装备，${json.length} 字节，`
  +`${Object.keys(payload.powers).length} 个属性编号。`);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();

import fs from 'node:fs';
import {skillBytes} from './character-import-codec.mjs';

/**
 * 本地技能效果覆盖（data/local-skill-overrides.json）。
 *
 * 上游 data/career-skills.json 是验收契约不能改；要调整某个已有效果（比如
 * 「飘雪穿云掌去掉中毒/流血」）就写在这里，lib/restoration.mjs 建运行时技能表时
 * 套用。只允许覆盖 wire 字段（power、powerValue、statusBit、round、area…），覆盖后
 * 自动重算该级的 powers 数组与 wireBase64 —— 服务端战斗结算、客户端收到的技能定义、
 * 技能说明三处保持一致。
 *
 * 结构：
 *   skills[技能id] = {
 *     levels: 'all' | [等级...]        // 作用范围，缺省 = 'all'
 *     set: {字段:值}                    // 范围内所有等级统一改成这套值
 *     perLevel: {"1":{字段:值}, "5":{...}}   // 逐级给不同值（与 set 可叠加，perLevel 优先）
 *   }
 * set 与 perLevel 至少有一个；两者都写时先套 set 再套 perLevel。
 *
 * 作用范围覆盖**所有来源**：人物学习的技能（career-skills / local-career-skills）、
 * 装备自带的技能（物品定义里的 skill）、两件同名装备叠加后的等级池
 * （equipment-skill-levels）。它们共用同一套技能 id，因此只要写一条规则即可。
 *
 * 只对「抓包/上游已有的等级定义」生效；local-career-skills 新增的技能请直接改那份数据。
 */

const FILE=new URL('../data/local-skill-overrides.json',import.meta.url);

/** 允许被覆盖的字段（= skillBytes 能写进 wire 的字段）。越界的键会被拒绝。 */
export const OVERRIDABLE_FIELDS=[
 'name','type','skillWeapon','info',
 'power1','powerValue1','power2','powerValue2','power3','powerValue3',
 'statusBit1','statusBit2','statusBit3',
 'skillAtkType','area','round','atk_time','useMP','useHP',
 'anime1','anime2','anime3','position'
];

function loadData(){
 // 这里**不能**用 fs.existsSync 做门控（第 57 版踩坑，代价是「覆盖一直静默失效」）：
 // APK 里 node:fs 是 VFS shim（安卓打包/standalone/shims/fs.mjs），existsSync 只查
 // **已预载**的内存表；而 data/ 下的资料是运行时按需同步 XHR 取的（standalone-files.json
 // 只预载 6 个文件，不含 data/），所以 existsSync 恒为 false → 直接返回空覆盖 →
 // 玩家改了技能，游戏里一点反应都没有（源项目里跑 Node 用的是真 fs，测不出来）。
 // 直接 readFileSync：未命中会触发按需加载，真不存在时抛 ENOENT，按「没有覆盖」处理。
 let raw;
 try{
  raw=JSON.parse(fs.readFileSync(FILE,'utf8'));
 }catch(error){
  if(error&&error.code==='ENOENT')return {revision:null,skills:{}};
  throw error;
 }
 if(raw&&typeof raw==='object'&&raw.skills&&typeof raw.skills==='object')return raw;
 throw Error('local-skill-overrides.json 结构不对：缺少 skills 对象。');
}

const OVERRIDES=lazyOnce(loadData);
function lazyOnce(load){
 let value;
 return ()=>{if(value===undefined)value=load();return value;};
}

export const skillOverridesRevision=()=>OVERRIDES().revision;

/** 归一化一条规则：校验字段名并把 levels 收敛成 'all' 或 number[]。 */
function normalizeRule(idRaw,rule){
 if(!rule||typeof rule!=='object')throw Error(`local-skill-overrides.json：技能 "${idRaw}" 的规则不是对象。`);
 const rawLevels=rule.levels===undefined?'all':rule.levels;
 let levels;
 if(rawLevels==='all')levels='all';
 else if(Array.isArray(rawLevels))levels=rawLevels.map(x=>{
  const n=Number(x);
  if(!Number.isInteger(n)||n<=0)throw Error(`local-skill-overrides.json：技能 "${idRaw}" 的 levels 含非法等级 "${x}"。`);
  return n;
 });
 else throw Error(`local-skill-overrides.json：技能 "${idRaw}" 的 levels 必须是 "all" 或等级数组。`);
 const check=(obj,label)=>{
  if(obj===undefined)return null;
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error(`local-skill-overrides.json：技能 "${idRaw}" 的 ${label} 必须是对象。`);
  for(const key of Object.keys(obj))if(!OVERRIDABLE_FIELDS.includes(key))throw Error(`local-skill-overrides.json：技能 "${idRaw}" 的 ${label} 含不可覆盖字段 "${key}"。`);
  return obj;
 };
 const set=check(rule.set,'set');
 let perLevel=null;
 if(rule.perLevel!==undefined){
  if(!rule.perLevel||typeof rule.perLevel!=='object'||Array.isArray(rule.perLevel))
   throw Error(`local-skill-overrides.json：技能 "${idRaw}" 的 perLevel 必须是「等级 → 字段」的对象。`);
  perLevel={};
  for(const [key,fields] of Object.entries(rule.perLevel)){
   if(!/^\d+$/.test(key)||Number(key)<=0)throw Error(`local-skill-overrides.json：技能 "${idRaw}" 的 perLevel 键必须是等级数字。`);
   const checked=check(fields,`perLevel["${key}"]`);
   if(checked&&Object.keys(checked).length)perLevel[key]=checked;
  }
  if(!Object.keys(perLevel).length)perLevel=null;
 }
 if(!set&&!perLevel)throw Error(`local-skill-overrides.json：技能 "${idRaw}" 既没有 set 也没有 perLevel。`);
 return {levels,set,perLevel};
}

const NORMALIZED=lazyOnce(()=>{
 const out=new Map();
 for(const [idRaw,rule] of Object.entries(OVERRIDES().skills)){
  const id=Number(idRaw);
  if(!Number.isInteger(id)||id<=0)throw Error(`local-skill-overrides.json：非法技能 id "${idRaw}"。`);
  out.set(id,normalizeRule(idRaw,rule));
 }
 return out;
});

/** 该技能 id 是否配了覆盖规则。 */
export const hasSkillOverride=id=>NORMALIZED().has(Number(id));

/** 配了覆盖规则的技能 id 列表（数字，升序）。 */
export const skillOverrideIds=()=>[...NORMALIZED().keys()].sort((a,b)=>a-b);

/** 某个等级要套用的字段集合；没命中返回 null。 */
function fieldsForLevel(rule,level){
 const n=level.level;
 const inRange=rule.levels==='all'||rule.levels.includes(n);
 if(!inRange)return null;
 let fields=rule.set?{...rule.set}:null;
 if(rule.perLevel&&rule.perLevel[String(n)])fields={...fields,...rule.perLevel[String(n)]};
 return fields&&Object.keys(fields).length?fields:null;
}

/** 会改变技能实际效果的字段（改动它们会让说明文字里的「效果行」过期）。 */
export const EFFECT_FIELDS=[
 'power1','powerValue1','power2','powerValue2','power3','powerValue3',
 'statusBit1','statusBit2','statusBit3'
];

// 构建工具（tools/build-career-skills.mjs）给重建等级写的说明结构是
//   「单机重建（含社区资料与推算）」+ 每个效果一行 [+ 「部分特殊效果…」提示行]。
// 客户端 SkillVo.getDesc()/getDescList() 会**按当前 power 渲染效果行**，然后把 info
// 原样追加在后面 —— 所以改了 power 却留着旧 info，游戏里会同时出现「新效果行 + 旧效果
// 说明」，玩家看起来就像“改了没生效”。这里只丢掉那几行过期效果，保留来源标题与可靠性提示。
// 结构对不上的 info（手写说明、装备技能表里的说明）一律不动：那些不是效果快照。
const INFO_HEAD='单机重建（含社区资料与推算）';
const INFO_TAIL='部分特殊效果沿用已录定义';

/** 去掉构建工具写在 info 里的过期效果行（只认标题/提示齐全的生成结构）。 */
export function dropStaleEffectLines(info){
 if(!info)return info;
 const lines=String(info).split('\n');
 const head=lines[0]===INFO_HEAD?lines[0]:null;
 const last=lines.length>1?lines[lines.length-1]:null;
 const tail=last&&last.startsWith(INFO_TAIL)?last:null;
 if(!head&&!tail)return info;
 return [...(head?[head]:[]),...(tail?[tail]:[])].join('\n');
}

/**
 * 把一组字段套到一个等级定义上，重算 powers 与 wireBase64。
 * 没命中（或字段为空）时返回原对象本身 —— 调用方据此判断是否真的改动了。
 */
function rebuildLevel(level,fields){
 if(!fields)return level;
 const next={...level,...fields};
 // powers 与 wireBase64 一并重算：服务端算属性用 powers，客户端展示/导入用 wire。
 next.powers=[1,2,3].filter(n=>next['power'+n]).map(n=>[next['power'+n],next['powerValue'+n]]);
 // 效果字段变了 → info 里的效果行已经过期，清掉（用户显式覆盖 info 时以其为准）。
 if(EFFECT_FIELDS.some(key=>key in fields)&&!('info' in fields))next.info=dropStaleEffectLines(next.info);
 if(next.wireBase64!==undefined)next.wireBase64=skillBytes(next).toString('base64');
 // 怪物技能在战斗包里发的是 monsterWireBase64（见 lib/official-packets.mjs），
 // 它本来是 wireBase64 的副本 —— 不一起重算的话，怪物放的还是旧效果。
 if(next.monsterWireBase64!==undefined)next.monsterWireBase64=skillBytes(next).toString('base64');
 return next;
}

/**
 * 把覆盖套到运行时技能表上。原地修改传入的 Map（只动被覆盖技能的等级对象，
 * 且等级对象是浅拷贝 —— 不碰上游 careerSkills 的原始对象）。
 * @returns {string[]} 实际套用了覆盖的技能 id 列表
 */
export function applySkillOverrides(skills){
 const applied=[];
 for(const [id,rule] of NORMALIZED()){
  const skill=skills.get(id);
  if(!skill||!Array.isArray(skill.levels))continue;   // 运行时没有这个技能就跳过
  skill.levels=applyRuleToLevels(skill.levels,rule);
  skills.set(id,skill);
  applied.push(String(id));
 }
 return applied;
}

/** 校验并归一化一条规则（技能编辑器写出的规则同样走这里把关）。 */
export function compileOverrideRule(rule,label='rule'){return normalizeRule(label,rule);}

/** 把归一化后的规则套到一组等级定义上，返回新数组（未命中的元素保持原引用）。 */
export function applyRuleToLevels(levels,compiled){return levels.map(level=>rebuildLevel(level,fieldsForLevel(compiled,level)));}

/** 把归一化后的规则套到「等级 → 定义」的集合上，原地替换命中的条目。 */
export function applyRuleToDefinitions(definitions,compiled){
 let hit=false;
 for(const [level,definition] of [...definitions]){
  if(!definition)continue;
  const next=rebuildLevel(definition,fieldsForLevel(compiled,definition));
  if(next!==definition){definitions.set(level,next);hit=true;}
 }
 return hit;
}

/** 套用单个等级定义（没规则或没命中时原样返回）。 */
export function applyOverrideToDefinition(id,definition){
 const rule=NORMALIZED().get(Number(id));
 if(!rule||!definition)return definition;
 return rebuildLevel(definition,fieldsForLevel(rule,definition));
}

/**
 * 把覆盖套到一份「等级 → 定义」的集合上（lib/restoration.mjs 的 activeSkills 用）。
 * 装备自带技能、两件同名装备叠加出来的等级池都在这里，所以这一处能覆盖装备技能。
 * 命中时替换成浅拷贝（不污染共享定义），未命中保持原对象引用。
 * @returns {boolean} 是否命中并改动过
 */
export function applyOverrideToDefinitions(id,definitions){
 const rule=NORMALIZED().get(Number(id));
 if(!rule||!definitions)return false;
 return applyRuleToDefinitions(definitions,rule);
}

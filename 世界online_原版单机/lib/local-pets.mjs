import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

/**
 * 本地自制宠物（data/local-pets.json）。
 *
 * 上游的 data/pet-catalog.json 是抓包产物、带 revision，改了以后既没法重建也没法对账，
 * 所以自制宠物一律走这份单独的文件 —— 跟 local-career-skills / local-fashion 是同一套规矩。
 *
 * 每只宠物写「继承哪个上游模板 + 要覆盖什么」：数值、技能、成长策略全都从上游模板拷，
 * 只有 key / 名字 / 外观 / 想改的数值需要写。合并规则是**浅合并**：
 * baseline 的每个顶层键整体替换（想改 attributes 就把整个 attributes 写出来）。
 */
const FILE=fileURLToPath(new URL('../data/local-pets.json',import.meta.url));

/** 文件不存在或没填宠物时返回 null —— 此时整个宠物目录与上游完全一致，行为零变化。 */
export function localPetData(){
 if(!fs.existsSync(FILE))return null;
 const raw=JSON.parse(fs.readFileSync(FILE,'utf8'));
 if(!Array.isArray(raw?.profiles)||!raw.profiles.length)return null;
 return raw;
}

const isIndex=n=>Number.isInteger(n)&&n>=0;

/**
 * 把本地宠物合并成完整 profile。纯函数（不读盘），便于测试直接注入。
 * @param {object|null} data localPetData() 的结果
 * @param {Map<string,object>} upstream 上游 profiles（key → profile）
 * @returns {{profiles:object[],legendaryKeys:string[]}}
 */
export function mergeLocalPets(data,upstream){
 if(!data)return {profiles:[],legendaryKeys:[]};
 const specs=Array.isArray(data.profiles)?data.profiles:[];
 const seen=new Set(),profiles=[];
 for(let i=0;i<specs.length;i++){
  const spec=specs[i],where=`local-pets.json 里的第 ${i+1} 只宠物`;
  if(!spec||typeof spec!=='object')throw Error(`${where} 不是一个对象。`);
  const key=spec.key;
  if(typeof key!=='string'||!key.trim())throw Error(`${where} 缺少 key（格式固定为「名字:阶数」）。`);
  if(seen.has(key))throw Error(`本地宠物 key 重复：${key}`);
  // 不重名是硬要求：宠物蛋道具号、孵化时的 catalogKey、幻化候选都按 key 认人，
  // 重名会让「同名谁生效」变成随机结果（第 39 版「两个投放口一份实现」的同款事故）。
  if(upstream.has(key))throw Error(`本地宠物 key 与上游目录重复：${key} —— 请换一个名字。`);
  seen.add(key);
  const parent=upstream.get(spec.extends);
  if(!parent)throw Error(`本地宠物 ${key} 的 extends「${spec.extends}」在上游目录里找不到。`);
  const profile={
   ...structuredClone(parent),
   key,
   name:typeof spec.name==='string'&&spec.name?spec.name:parent.name,
   grade:isIndex(spec.grade)?spec.grade:parent.grade,
   evolved:spec.evolved===true,
   family:typeof spec.family==='string'?spec.family:key.split(':')[0],
   quality:typeof spec.quality==='string'?spec.quality:(parent.quality||''),
   provenance:{origin:'local',extends:spec.extends},
  };
  const baseline={...structuredClone(parent.baseline),...(spec.baseline||{})};
  baseline.name=profile.name;
  baseline.grade=profile.grade;
  // growthProfile(pet) 的第一条回退就是 petProfiles.get(pet.catalogKey)，而孵化时会把
  // profile.key 写进宠物的 catalogKey（pet-state.mjs）—— 这里钉死，成长就一定命中自己。
  baseline.catalogKey=key;
  // 上游的规律是 templateId === model，跟着走，免得第三条回退按旧模板匹配到别的东西。
  if(isIndex(baseline.model))baseline.templateId=baseline.model;
  // growLocalPet() 直接读 baseStats[i] 做成长，缺了或长度不对会在升级时炸。
  if(!Array.isArray(baseline.baseStats)||baseline.baseStats.length!==5||baseline.baseStats.some(v=>!Number.isFinite(v)))
   throw Error(`本地宠物 ${key} 的 baseline.baseStats 必须是 5 个数字（成长算法直接按下标读它）。`);
  for(const field of ['strength','constitution','agility','intelligence','wisdom'])
   if(!Number.isFinite(baseline.attributes?.[field]))
    throw Error(`本地宠物 ${key} 的 baseline.attributes.${field} 缺失或不是数字。`);
  profile.baseline=baseline;
  profiles.push(profile);
 }
 const legendaryKeys=[];
 for(const key of Array.isArray(data.legendaryKeys)?data.legendaryKeys:[]){
  if(typeof key!=='string'||!key.trim())throw Error(`local-pets.json 的 legendaryKeys 里有非字符串项。`);
  if(!seen.has(key)&&!upstream.has(key))throw Error(`legendaryKeys 里的「${key}」既不是本地宠物也不在上游目录里。`);
  if(legendaryKeys.includes(key))throw Error(`legendaryKeys 重复：${key}`);
  legendaryKeys.push(key);
 }
 return {profiles,legendaryKeys};
}

/** 读盘 + 合并。上游 profiles 传进来是为了做 extends 与重名校验。 */
export function buildLocalPets(upstream){
 return mergeLocalPets(localPetData(),upstream);
}

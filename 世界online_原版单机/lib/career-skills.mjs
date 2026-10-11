import fs from 'node:fs';
import {lazyBox} from './lazy-data.mjs';

/**
 * 职业技能表（7.8 MB）+ 目录原文（9.8 MB）。
 *
 * 以前两份都在模块顶层读：`careers` 解析进堆，`careerDirectory` 更亏 —— 它只是
 * 一份**没人解析**的原始 JSON 文本，仅仅为了 `/api/career-skills` 原样发出去，
 * 却让每次启动都多读 9.8 MB（架构评审 P1-1）。
 *
 * 现在两份都等到真正被用到时再读：`careers` 走惰性代理，`careerDirectory()`
 * 是函数 —— HTTP 面板请求到它才读盘。使用方代码不变（对象/Map 导出），
 * 只有取目录原文那一处加了括号。
 */
let built=null;
function ensure(){
 if(built)return built;
 const careers=JSON.parse(fs.readFileSync(new URL('../data/career-skills.json',import.meta.url),'utf8'));
 built={
  careers,
  careerSkills:new Map(careers.skills.map(s=>[s.id,s])),
 };
 return built;
}

// 目录原文与技能表分开惰性：技能表会随「有存档启动」被拉到，而目录原文只有
// /api/career-skills 一个消费者。混在同一个 ensure() 里会让每次启动白读 9.8 MB。
let directoryCache=null;

export const careers=lazyBox(()=>ensure().careers,'careers');
export const careerSkills=lazyBox(()=>ensure().careerSkills,'careerSkills');
/** 目录原文（不解析，直接发给面板）。只有 `/api/career-skills` 用。 */
export const careerDirectory=()=>directoryCache??=fs.readFileSync(new URL('../data/career-skill-directory.json',import.meta.url),'utf8');
export const canonicalLegacySkill=id=>ensure().careers.aliases[id]??id;

// Old community imports used IDs now occupied by native hammer/fan skills.
// Migrate once, from a snapshot, so swaps/collisions cannot destroy learned levels.
export function migrateCareerSkills(p){
 const {careers}=ensure();
 p.restoration??={};
 if(p.restoration.careerSkills===careers.version)return;
 const before={...(p.skills||{})},after={};
 for(const [id,level] of Object.entries(before)){
  const target=canonicalLegacySkill(Number(id));after[target]=Math.max(after[target]||0,level);
 }
 const remap=id=>Object.hasOwn(before,id)?canonicalLegacySkill(id):id;
 p.skills=after;p.autoSkillIds=(p.autoSkillIds||[]).map(remap);p.initiativeSkillId=remap(p.initiativeSkillId??-1);
 p.restoration.careerSkills=careers.version;
}

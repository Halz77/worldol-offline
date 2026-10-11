import fs from 'node:fs';
import {lazyBox} from './lazy-data.mjs';

export const MAX_EQUIPMENT_SKILL_LEVEL=22;

/**
 * 装备技能等级表（1.1 MB + 补录）。
 *
 * 它只在「已穿戴装备带来的技能加成」这条路径上被读，却在模块顶层解析。
 * 挪进惰性构造（架构评审 P1-1）。
 */
let built=null;
function ensure(){
 if(built)return built;
 const data=JSON.parse(fs.readFileSync(new URL('../data/equipment-skill-levels.json',import.meta.url),'utf8'));
 const map=new Map(data.skills.map(s=>[s.id,s.levels]));
 // MOD(equip-skill-stack)：上面这份是抓包录制的，只含装备实际出现过的等级。
 // 有的技能因此缺高等级（例：「天魔无视」只有 11 级），而两枚同名戒指叠起来就是 22 级，
 // 取不到定义时叠加后的等级会卡在单枚的上限。这里并入补录的等级。
 const extra=JSON.parse(fs.readFileSync(new URL('../data/equipment-skill-levels-extra.json',import.meta.url),'utf8'));
 for(const row of extra.skills){
   const list=map.get(row.id);
   if(!list)continue;                       // 只补已知技能，不新增
   for(const level of row.levels)if(!list.some(x=>x.level===level.level))list.push(level);
   list.sort((a,b)=>a.level-b.level);
 }
 built=map;
 return built;
}

// This lookup supplies effective levels only. It must not add equipment-only
// skills to the mentor shop or write equipment bonuses into learned skills.
export const equipmentSkillLevels=lazyBox(ensure,'equipmentSkillLevels');

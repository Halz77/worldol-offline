import fs from 'node:fs';
export const playerExperience=JSON.parse(fs.readFileSync(new URL('../data/player-experience.json',import.meta.url),'utf8'));
export const PLAYER_LEVEL_CAP=playerExperience.maxLevel;
export function requiredPlayerExperience(level){
 const row=playerExperience.levels[level-1];
 if(!Number.isInteger(level)||!row||row.level!==level)throw Error('人物等级超出1—97级范围。');
 return row.requiredExp === 0
  ? 0
  : Math.max(1, Math.floor(row.requiredExp * 0.0001));
}
export function normalizeExperience(p){
 p.expMax=requiredPlayerExperience(p.level);
 if(!Number.isSafeInteger(p.exp)||p.exp<0)p.exp=0;
 if(p.level===PLAYER_LEVEL_CAP)p.exp=0;
 return p;
}

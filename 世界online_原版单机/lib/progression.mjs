import {official} from './official-data.mjs';
import {INITIAL_BAG_CAPACITY} from './bag-capacity.mjs';
import {PLAYER_LEVEL_CAP,normalizeExperience,requiredPlayerExperience} from './player-experience.mjs';
export function reconcileAttributePoints(p){
 // The recorded eastern beginner starts with 30 base points plus 3 free points,
 // then gains 3 per level. The requested level-97 total is therefore 321,
 // including the initial stats, not 321 additional spendable points.
 if(p.progression!=='xia-v05'||!Number.isInteger(p.level)||p.level<1||p.level>97)return 0;
 if(!Array.isArray(p.baseStats)||p.baseStats.length!==5||p.baseStats.some(n=>!Number.isInteger(n)||n<0)||!Number.isInteger(p.attributePoints)||p.attributePoints<0)return 0;
 const a=official.newbie.archetype;
 const budget=a.attributes.reduce((sum,n)=>sum+n,0)+a.attributePoints+(p.level-1)*3;
 const total=p.baseStats.reduce((sum,n)=>sum+n,0)+p.attributePoints;
 const missing=Math.max(0,budget-total);
 // Sum both allocated and free points so reloads never reissue spent points.
 // Preserve any deliberately granted points above the normal level budget.
 p.attributePoints+=missing;return missing;
}
export function initializeNewbie(p){
 const n=official.newbie,start=official.maps.find(m=>m.id===n.startMap);
 p.mapId=start.id;p.mapName=start.name;[p.x,p.y]=start.spawn;
 p.bagLimit=INITIAL_BAG_CAPACITY;
 if(p.race!==n.archetype.race||p.job!==n.archetype.job)return;
 const a=n.archetype;p.progression='xia-v05';
 p.baseStats=[...a.attributes];p.initialStats=[...a.attributes];p.attributePoints=a.attributePoints;p.skillPoints=a.skillPoints;
 p.exp=0;p.expMax=a.expMax;p.hp=a.hp;p.mp=a.mp;p.bagPages=a.bagSlots;p.storageSlots=a.storageSlots;
 p.inventory=structuredClone(n.starterInventory);p.skills={452:1};p.autoSkillIds=[...(a.autoSkillIds||[])];p.initiativeSkillId=a.initiativeSkillId??-1;p.restoration={starterIssued:true};
}
export function awardExperience(p,exp,coins){
 if(!Number.isInteger(exp)||exp<0||exp>2147483647||!Number.isInteger(coins)||coins<0||coins>2147483647)throw Error('无效的人物经验或铜币奖励。');
 normalizeExperience(p);
 const old=p.level;p.coins=(p.coins||0)+coins;let skillPoints=0,attributePoints=0;
 if(p.level===PLAYER_LEVEL_CAP)return {exp:0,coins,levels:0,skillPoints,attributePoints};
 p.exp+=exp;
 while(p.level<PLAYER_LEVEL_CAP&&p.exp>=p.expMax){
  skillPoints+=p.level*10;attributePoints+=3;p.exp-=p.expMax;p.level++;
  p.expMax=requiredPlayerExperience(p.level);
 }
 const unused=p.level===PLAYER_LEVEL_CAP?Math.min(exp,p.exp):0;
 if(p.level===PLAYER_LEVEL_CAP)p.exp=0;
 p.skillPoints=(p.skillPoints||0)+skillPoints;p.attributePoints=(p.attributePoints||0)+attributePoints;
 return {exp:exp-unused,coins,levels:p.level-old,skillPoints,attributePoints};
}

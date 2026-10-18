import {officialMaps,origins} from './official-data.mjs';
export const isPersonalCity=id=>!!officialMaps.get(id)?.cityTemplate;
export const isCityMission=q=>q.mapId===2800;
export function cityState(p){return {...{level:1,prosperity:0,army:0,name:`${p.name}的城市`,sign:'城主很懒，什么都没有留下……',gold:0,silver:0,coins:0},...p.city};}
// 单机版便利：原版只有跑完新手链最后一环（任务 42「获得新的城市」）
// 才会由 official-service 置上 p.cityUnlocked。GM 改过等级、导入过来的存档、
// 或者当年跳过了新手链的角色身上就没这一位，于是「回城」(10510) 与
// 「城市」(10511) 永远回一句「请先完成获得新的城市任务。」。
// 单机版按需补发：状态与完成 42 号任务之后一致（等级 1、繁荣 0、军力 0）。
export function unlockCity(p){
 if(p.cityUnlocked)return false;
 p.cityUnlocked=true;p.city=cityState(p);
 return true;
}
export function cityTarget(q,p){
 if(!isCityMission(q))return {mapId:q.mapId,npcId:q.npcId};
 const recorded=origins(q).filter(x=>isPersonalCity(x.mapId));
 const current=recorded.find(x=>x.mapId===p.mapId);if(current)return current;
 if(isPersonalCity(p.mapId))for(const source of recorded){const name=officialMaps.get(source.mapId).npcs.find(n=>n.id===source.npcId)?.name;const npc=officialMaps.get(p.mapId).npcs.find(n=>n.name===name);if(npc)return {mapId:p.mapId,npcId:npc.id};}
 return recorded[0]||{mapId:q.mapId,npcId:q.npcId};
}
export function cityConditionMet(p,c){
 const s=cityState(p),b=Buffer.from(c.rawHex||'','hex');let ok=false;
 if(c.type===27)ok=b.length===1&&s.level>=b[0]+1;
 else if(c.type===29)ok=b.length===4&&s.prosperity>=b.readInt32BE();
 else if(c.type===30)ok=b.length===4&&s.army>=b.readInt32BE();
 else if(c.type===31)ok=!!p.cityUnlocked&&isPersonalCity(p.mapId);
 else if(c.type===5)ok=b.length===4&&p.coins>=b.readInt32BE();
 return c.not?!ok:ok;
}
export function applyCityMission(p,q){
 const upgrade=[3002,3003,3004,3005].indexOf(q.id),prosperity=q.cityProsperity||0,army=q.cityArmy||0;
 if(!isCityMission(q)&&!prosperity&&!army)return {costCoins:0};
 if(!p.cityUnlocked){if(isCityMission(q))throw Error('请先获得自己的城市。');return {costCoins:0};}
 const s=cityState(p);let costCoins=0;
 if(isCityMission(q))for(const c of q.submitCondition||[])if(c.type===5&&!c.not){const b=Buffer.from(c.rawHex,'hex');if(b.length!==4)throw Error('城市任务铜币消耗待定。');costCoins+=b.readInt32BE();}
 if(costCoins<0||p.coins<costCoins)throw Error('铜币不足。');
 if(upgrade>=0){if(s.level!==upgrade+1)throw Error('城市等级已变化，请重新查看任务。');s.level=upgrade+2;}
 for(const [key,value] of [['prosperity',prosperity],['army',army]]){const n=s[key]+value;if(!Number.isSafeInteger(n)||n<0||n>2147483647)throw Error('城市数值超出范围。');s[key]=n;}
 p.coins-=costCoins;p.city=s;return {costCoins,cityChanged:upgrade>=0,cityProsperity:prosperity,cityArmy:army};
}

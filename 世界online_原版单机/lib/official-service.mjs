import {gainPet,observedPetExperience} from './pet-state.mjs';
import {Writer} from './codec.mjs';
import {vipMissionExperience} from './home-feature-data.mjs';
import {official,officialMaps,officialItems,officialMissions,officialGroups,atNpc} from './official-data.mjs';
import {officialCanAccept,officialComplete,missionBlockers,originFor,availableChoices,npcEnabled,missionClosed,missionRewards,missionConditions,battleSupported,prerequisiteMessage,missionBattleId} from './official-rules.mjs';
import {maps,npcById,near,walkable,gain,hpMax,mpMax} from './content.mjs';
import {worldData} from './world.mjs';
import {signUpdates,questReward,moneyUpdate,healthUpdate} from './game-packets.mjs';
import {planItemRewards,planItemRemoval} from './restoration.mjs';
import {pushNewbieMission} from './newbie-service.mjs';
import {cityTarget,isCityMission,applyCityMission} from './city-state.mjs';
import {worldTravelMaps} from './world-travel.mjs';
import {recordMissionCompletion} from './daily-activity.mjs';
import {notifyDaily} from './daily-service.mjs';
import {deferYunruoRewards} from './yunruo-temple.mjs';
import {replayChainAfterSettlement} from './replayable-chains.mjs';
import {isSolarMission} from './solar-challenge-data.mjs';
import {startSolarBoard,clearSolarBoard,solarDepositText} from './solar-challenge-service.mjs';

function vi(value){let n=BigInt.asUintN(64,BigInt(value||0)),a=[];do{let b=Number(n&127n);n>>=7n;if(n)b|=128;a.push(b);}while(n);return Buffer.from(a);}
const integer=(n,v)=>Buffer.concat([vi(n*8),vi(v)]);
const bytes=(n,v)=>Buffer.concat([vi(n*8+2),vi(v.length),v]);
const text=(n,v)=>bytes(n,Buffer.from(String(v??''),'utf8'));
const msg=(...parts)=>Buffer.concat(parts);
export function handbookGroups(){return msg(...official.handbookGroups.infos.map(g=>bytes(1,msg(integer(1,g.group),...g.info.map(t=>bytes(2,msg(integer(1,t.type),text(2,t.name),text(3,t.icon))))))));}
export function handbookPage(group,type){
 const rows=official.catalog.filter(i=>i.sources.some(s=>s.group===group&&s.type===type));
 return msg(integer(1,group),integer(2,type),bytes(3,msg(integer(1,0),integer(2,0),integer(3,0),integer(4,0),integer(5,0))),...rows.map(i=>{
  const info=msg(integer(1,i.itemId),integer(2,0),text(3,i.icon),text(4,i.name),text(5,i.bagIcon),text(6,i.info),integer(7,i.type),integer(8,i.grade));
  return bytes(4,msg(bytes(1,info),integer(2,0),integer(3,i.sources.find(s=>s.group===group&&s.type===type)?.sort||0)));
 }),integer(5,0));
}
function bookRequest(r){let group=0,type=0;const read=()=>{let n=0,shift=0;for(let i=0;i<5;i++){const b=r.byte()&255;n|=(b&127)<<shift;if(!(b&128))return n>>>0;shift+=7;}throw Error('Invalid protobuf integer');};while(r.pos<r.b.length){const tag=read();if(tag===8)group=read();else if(tag===16)type=read();else throw Error('Invalid handbook request');}return {group,type};}
export const supportedMissionCount=official.missions.filter(q=>!missionBlockers(q).length).length;
function missionDestination(p,q){
 const active=p.quests.active[q.id];
 if(!active)return originFor(p,q);
 const kill=(q.submitCondition||[]).find(c=>c.type===2&&!c.not&&(active.counts?.[c.monsterId]||0)<c.required);
 if(kill){
  if(officialGroups.get(missionBattleId(q))?.monsters.includes(kill.monsterId))return active.origin||originFor(p,q);
  const scenes=[maps[p.mapId],...Object.values(maps).filter(m=>m.id!==p.mapId)];
  for(const map of scenes){const n=map.npcs.filter(n=>npcEnabled(p,n)&&n.battleID?.some(id=>officialGroups.get(id)?.monsters.includes(kill.monsterId))).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];if(n)return {mapId:map.id,npcId:n.id};}
 }
 return cityTarget(q,p);
}
export function handleOfficial(type,r,context,{store,send,log}){
 const p=context.role;if(!p)return false;
 const teleport=id=>{const map=maps[id];if(context.battle)throw Error('请先结束战斗。');if(!map||!officialMaps.has(id)&&id!==1)throw Error('该地图的场景数据尚未采集。');const before={mapId:p.mapId,mapName:p.mapName,x:p.x,y:p.y};p.mapId=id;p.mapName=map.name;[p.x,p.y]=map.spawn;try{store.save();}catch(error){Object.assign(p,before);throw error;}};
 const notify=s=>send(10509,new Writer().byte(2).string(s));
 if(type===32101){const q=bookRequest(r);send(32102,handbookPage(q.group,q.type));return true;}
 if(type===16051){const id=r.int(),item=officialItems.get(id);if(item)send(type,Buffer.from(item.definitionBase64,'base64'));else notify('该道具只采集到了目录，详细属性尚未录到。');return true;}
 if(type===12016){const start=r.pos,id=r.int(),item=officialItems.get(id);if(!item){r.pos=start;return false;}send(type,new Writer().raw(Buffer.from(item.definitionBase64,'base64')).byte(0));return true;}
 if([32103,32110].includes(type)){notify('单机图鉴可查阅；点亮和幻化养成尚未接入。');return true;}
 if(type===10521){const w=new Writer().byte(official.areas.length);for(const a of official.areas)w.byte(a.id).string(a.name).short(a.x).short(a.y).byte(a.state);send(type,w);return true;}
 if(type===10522){const list=worldTravelMaps(r.int());if(!list.length){send(type,new Writer().byte(-1).string('这个区域的场景尚未采集，暂时无法进入。'));return true;}const w=new Writer().byte(0).byte(list.length);for(const m of list)w.short(m.id).string(m.name).string(m.id===1?'返回本地新手村':'自由传送').byte(0).byte(0);send(type,w);return true;}
 if(type===10510){try{r.int();if(!p.cityUnlocked)throw Error('请先完成获得新的城市任务。');teleport(1000);send(type,new Writer().byte(0).raw(worldData(p,false).done()));}catch(e){send(type,new Writer().byte(-1).string(e.message));}return true;}
 if(type===10523){try{const id=r.int();teleport(id);send(type,new Writer().byte(0).byte(0).raw(worldData(p,false).done()));log('official-map-entered',{role:p.id,map:id});}catch(e){send(type,new Writer().byte(-1).string(e.message));}return true;}
 if(type===10518&&maps[p.mapId]?.official){try{const mode=r.byte();let mapId,id;if(mode===1){mapId=r.short();id=r.byte();}else{const q=officialMissions.get(r.short());if(!q)throw Error('任务尚未恢复');const o=missionDestination(p,q);mapId=o.mapId;id=o.npcId;}const n=maps[mapId]?.npcs.find(n=>n.id===id);if(!n)throw Error('目标场景尚未采集');if(mapId!==p.mapId){const portal=maps[p.mapId].npcs.find(n=>npcEnabled(p,n)&&n.target?.[0]===mapId);if(!portal)throw Error('请先从世界地图前往：'+maps[mapId].name);send(type,new Writer().byte(0).byte(1).byte(portal.x).byte(portal.y).short(mapId).byte(portal.target[1]).byte(portal.target[2]).byte(n.x).byte(n.y));}else send(type,new Writer().byte(0).byte(0).byte(n.x).byte(n.y));}catch(e){send(type,new Writer().byte(-1).string(e.message));}return true;}
 if(![14502,14503,14504].includes(type))return false;
 const start=r.pos,npcId=type===14504?null:r.short(),id=r.short(),q=officialMissions.get(id);
 if(!q){r.pos=start;return false;}
 const before=structuredClone(p);
 let reopenedChain=null;
 try{
  if(context.battle)throw Error('请先结束战斗。');
  if(type===14504){
   if(!p.quests.active[id])throw Error('尚未接取此任务');
   delete p.quests.active[id];
   // 放弃英雄挑战赛要把棋盘上下文也清掉，否则 context.solar 还挂着旧赛程。
   if(isSolarMission(id))clearSolarBoard(context);
   store.save();send(type,signUpdates(new Writer().byte(0),p));return true;
  }
  if(!near(p,npcById(p,npcId))||!npcEnabled(p,npcById(p,npcId)))throw Error('请走到任务 NPC 身边。');
  if(type===14502){
   const target=cityTarget(q,p);
   if(!(atNpc(q,p.mapId,npcId)||isCityMission(q)&&target.mapId===p.mapId&&target.npcId===npcId))throw Error('请到任务接取 NPC 处接取。');
   // 英雄挑战赛：任务已经在身上时允许再点一次报名 —— 那是「重新打开棋盘」，
   // 不是重复接任务（离开棋盘后再回来得靠这个入口，否则 officialCanAccept 会以
   // 「已接取」挡掉，玩家再也进不去棋盘）。
   if(!(isSolarMission(id)&&p.quests.active[id])){
    if(!officialCanAccept(p,q))throw Error(prerequisiteMessage(p,q)||'任务条件未满足、已接取或今天已完成；缺少的城市条件待定。');
    if(Object.keys(p.quests.active).length>=127)throw Error('任务栏达到原版协议容量，请先交付或放弃部分任务。');
    p.quests.active[id]={official:true,counts:{},origin:originFor(p,q,npcId),acceptedAt:new Date().toISOString()};
   }
   const active=p.quests.active[id];
   if(isSolarMission(id)){
    if(active.solarDone)throw Error('赛程已完成，请交付任务领取奖励。');
    // 报名押金（escortCost = [黄金,白银,铜币]）：只收一次，重开棋盘不重复扣。
    if(!active.solarDepositPaid){
     const [needGold=0,needSilver=0,needCoins=0]=q.escortCost||[];
     const useSilver=Math.min(Number(p.silver||0),Number(needSilver)||0);
     const useGold=(Number(needGold)||0)+(Number(needSilver)||0)-useSilver;
     if((p.gold||0)<useGold||(p.coins||0)<(Number(needCoins)||0))throw Error('报名费不足，需要 '+solarDepositText(q)+'。');
     p.gold=(p.gold||0)-useGold;p.silver=(p.silver||0)-useSilver;p.coins=(p.coins||0)-(Number(needCoins)||0);
     active.solarDepositPaid=true;
    }
   }
   store.save();send(type,signUpdates(new Writer().byte(0),p).bool(false));
   // 接完立刻把棋盘推给客户端 —— 少了这一步玩家根本看不到挑战界面。
   if(isSolarMission(id))startSolarBoard(context,send,p,id);
  }
  else{
   // 棋盘还开着（没走 14509 离开 / 14511 结束）不许交付，否则等于绕过硬挑战。
   if(isSolarMission(id)&&context.solar)throw Error('请先结束棋盘挑战，再回到报名点交付奖励。');
   const selected=r.int(),target=cityTarget(q,p);if(target.mapId!==p.mapId||target.npcId!==npcId||!officialComplete(p,q)||missionClosed(p,q))throw Error(prerequisiteMessage(p,q)||'请先完成条件，再到指定 NPC 交付。');
   const choice=availableChoices(q),selectedReward=choice.length?choice.find(i=>i.id===selected):null;
   if(choice.length&&!selectedReward)throw Error('请选择已恢复属性的任务奖励。');
   const consumed=planItemRemoval(p,missionConditions(q,'submitCondition').filter(c=>c.type===7&&!c.not).map(c=>({id:c.itemId,quantity:c.required})));
   const rewardData=missionRewards(q),planned=planItemRewards({...p,inventory:consumed.inventory},[...(rewardData.rewardItems||[]),...(selectedReward?[selectedReward]:[])]);
   const cityReward=applyCityMission(p,q);p.inventory=planned.inventory;recordMissionCompletion(p,q);deferYunruoRewards(p,q);
   delete p.quests.active[id];if(!p.quests.completed.includes(id))p.quests.completed.push(id);
   // 可重复任务链：如果交付这一环让整条链通关了，就把整条链从完成记录里抹掉，
   // 玩家可以立刻从第一环重接（不用等到明天）。必须在 store.save() 之前做。
   reopenedChain=replayChainAfterSettlement(p,id);
   const reward=Object.assign(gain(p,vipMissionExperience(p,rewardData.exp),rewardData.money3),cityReward);reward.pet=gainPet(p,rewardData.challengeOnly?0:observedPetExperience('missionId',q.id,q.exp));reward.silver=rewardData.money2;reward.added=planned.added;reward.removed=consumed.removed;if(q.id===42){p.cityUnlocked=true;reward.cityChanged=true;}p.silver=(p.silver||0)+rewardData.money2;store.save();send(type,questReward(signUpdates(new Writer().byte(0),p),p,reward));send(11004,moneyUpdate(p,reward.coins,reward.silver));send(17601,healthUpdate(p));
  }
  const jump=type===14502?q.acceptJumpMapID:q.submitJumpMapID;
  if(jump>0&&officialMaps.has(jump))context.questTeleport={mapId:jump,x:type===14502?q.acceptJumpMapGx:q.submitJumpMapGx,y:type===14502?q.acceptJumpMapGy:q.submitJumpMapGy};
  const group=missionBattleId(q,type===14502?'accept':'submit');if(group>0&&battleSupported(group))context.storyBattle={group,mapId:p.mapId,npcId,quest:id};
  pushNewbieMission(p,send);if(type===14503)notifyDaily(p,send);
  // 任务链通关复位后给一句提示，否则玩家不知道「可以重打」了。
  if(reopenedChain)send(10509,new Writer().byte(2).string(`任务链「${reopenedChain.name}」已通关（共 ${reopenedChain.nodes} 环），可以从第一环重新接取。`));
  log('official-quest',{role:p.id,type,quest:id,...(reopenedChain?{chainReopened:reopenedChain.id}:{})});
 }catch(e){if(process.env.WOL_QUEST_STACK)console.error(e.stack);for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);send(type,new Writer().byte(-1).string(e.message));log('official-quest-rejected',{role:p.id,type,quest:id,error:e.message});}
 return true;
}

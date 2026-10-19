import {gainPet,observedPetExperience} from './pet-state.mjs';
import {Writer} from './codec.mjs';
import {vipMissionExperience} from './home-feature-data.mjs';
import {official,officialMaps,officialItems,officialMissions,officialGroups,atNpc} from './official-data.mjs';
import {officialCanAccept,officialComplete,missionBlockers,originFor,availableChoices,npcEnabled,missionClosed,missionRewards,missionConditions,battleSupported,prerequisiteMessage,missionBattleId,isBoardMission} from './official-rules.mjs';
import {maps,npcById,near,walkable,gain,hpMax,mpMax} from './content.mjs';
import {worldData} from './world.mjs';
import {signUpdates,questReward,moneyUpdate,healthUpdate} from './game-packets.mjs';
import {planItemRewards,planItemRemoval} from './restoration.mjs';
import {pushNewbieMission} from './newbie-service.mjs';
import {cityTarget,isCityMission,applyCityMission,unlockCity} from './city-state.mjs';
import {worldTravelMaps} from './world-travel.mjs';
import {recordMissionCompletion} from './daily-activity.mjs';
import {notifyDaily} from './daily-service.mjs';
import {deferYunruoRewards} from './yunruo-temple.mjs';
import {replayChainAfterSettlement} from './replayable-chains.mjs';
import {startSolarBoard,clearSolarBoard,solarDepositText} from './solar-challenge-service.mjs';
import {handbookView,handbookRows,unlockHandbookPage,refreshHandbook,handbookPowers} from './handbook.mjs';
function vi(value){let n=BigInt.asUintN(64,BigInt(value||0)),a=[];do{let b=Number(n&127n);n>>=7n;if(n)b|=128;a.push(b);}while(n);return Buffer.from(a);}
const integer=(n,v)=>Buffer.concat([vi(n*8),vi(v)]);
const bytes=(n,v)=>Buffer.concat([vi(n*8+2),vi(v.length),v]);
const text=(n,v)=>bytes(n,Buffer.from(String(v??''),'utf8'));
const msg=(...parts)=>Buffer.concat(parts);
export function handbookGroups(){return msg(...official.handbookGroups.infos.map(g=>bytes(1,msg(integer(1,g.group),...g.info.map(t=>bytes(2,msg(integer(1,t.type),text(2,t.name),text(3,t.icon))))))));}
// 第 77 版：图鉴页/点亮/加成三个包（见 lib/handbook.mjs 的规则层）。
// role 省略时保持「全未点亮、不能点亮」的纯目录视图 —— tests/official.test.mjs 用它
// 断言「目录一条不落」，服务端分派则一律带上角色。
export function handbookPage(group,type,role){
 const view=role?handbookView(role,group,type):null;
 const rows=view?view.items:handbookRows(group,type).map(row=>({...row,unlock:false}));
 const level=view?msg(integer(1,view.level),integer(2,view.rate),integer(3,1),integer(4,view.level),integer(5,1)):msg(integer(1,0),integer(2,0),integer(3,0),integer(4,0),integer(5,0));
 return msg(integer(1,group),integer(2,type),bytes(3,level),...rows.map(i=>{
  const info=msg(integer(1,i.itemId),integer(2,0),text(3,i.icon),text(4,i.name),text(5,i.bagIcon),text(6,i.info),integer(7,i.type),integer(8,i.grade));
  return bytes(4,msg(bytes(1,info),integer(2,i.unlock?1:0),integer(3,i.sort||0)));
 }),integer(5,view&&view.canUnlock?1:0));
}
export function handbookUnlock(view){return msg(integer(1,view.group),integer(2,view.type),...view.items.map(i=>integer(3,i.itemId)),integer(4,view.level),integer(5,view.rate));}
// 32109 的形状：s2c_HandBookPowerInfo{infos:[{group,info:[{type,power,powerValue,effect}]}]}。
// 客户端 onHandBookPowerInfo 会**清空**静态的 BookGroupModel.bookGroupPower，再把**所有**
// effect 为真的 powerValue 累加到 bookGroupPower[power] —— power 是能力编号，
// `group`/`type` 两位客户端都不读。
// 【第 80 版】图鉴不再提供属性加成（用户决定，见 lib/handbook.mjs 文件头），所以这个包
// **恒为空包**（handbookPowers 恒返回 {}）：空包一样会清空 bookGroupPower，
// 正好把老存档里已经喂给客户端的旧加成一起抹掉。形状与累加语义保留在这里，
// 将来若要恢复加成不必再摸协议。
export function handbookPowerPacket(p){
 const entries=Object.entries(handbookPowers(p)).map(([key,value])=>[Number(key),value]);
 if(!entries.length)return msg();
 return msg(bytes(1,msg(integer(1,0),...entries.map(([power,value])=>bytes(2,msg(integer(1,0),integer(2,power),integer(3,value),integer(4,1)))))));
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
 if(type===32101){const q=bookRequest(r);send(32102,handbookPage(q.group,q.type,p));return true;}
 if(type===16051){const id=r.int(),item=officialItems.get(id);if(item)send(type,Buffer.from(item.definitionBase64,'base64'));else notify('该道具只采集到了目录，详细属性尚未录到。');return true;}
 // 12016 CG_ITEMTYPE_GETINFO —— 「查看一件我不认识的道具」的通用接口
 // （图鉴点条目 → Tool.alertItemInfo、首充预览、奖励格 doViewItem 都走它）。
 // 客户端把它列在模块 0035 的 Tool.resultMsg 里 → sendProtoAsync 收到回包先
 // processMessage() **读掉开头那 1 个状态字节**（<0 时 getString() 弹提示），
 // 之后才是 Item.fromBytesAtts2(定义) → processGetSuitInfoMsg(1 字节套装组数)。
 // 所以正确的回包是 byte(0) + 定义字节 + byte(0)。
 // 第 77 版少写了开头那个状态字节（把唯一的 0 放在末尾当套装组数），客户端于是从
 // 第二个字节开始解析定义 → Throw Truncated → getItemUseId 里 catch 掉 → 详情面板
 // 打不开（表现就是「图鉴点进去什么都没有」）。
 if(type===12016){
  const start=r.pos,id=r.int(),item=officialItems.get(id);
  // 目录里没有定义时不再「不认账」（客户端会白等 10 秒超时、unhandled rejection）：
  // 状态字节给负数，客户端会把它后面的字符串弹成提示。
  if(!item){send(type,new Writer().byte(-1).string('这件道具的详细属性尚未录到，图鉴里只能看到它的目录信息。'));return true;}
  send(type,new Writer().byte(0).raw(Buffer.from(item.definitionBase64,'base64')).byte(0));
  return true;
 }
 if(type===32103){
  // 「点亮」：客户端 sendHandBookUnlock(group,type) 只发组+类，点哪些由服务端决定 ——
  // 整页点亮（免费）。回 32104（客户端据此把本页条目全部置 unlock、更新等级/收集率），
  // 再推 32109 把新的能力加成喂给客户端；存档一起落盘。
  const q=bookRequest(r),view=unlockHandbookPage(p,q.group,q.type);
  refreshHandbook(p);store.save();
  send(32104,handbookUnlock(view));
  send(32109,handbookPowerPacket(p));
  notify(`「${official.handbookGroups.infos.find(g=>g.group===q.group)?.info.find(t=>t.type===q.type)?.name||'图鉴'}」已全部点亮，收集率 ${view.rate}%（图鉴等级 ${view.level} 级）。`);
  log?.('handbook-unlocked',{role:p.id,group:q.group,type:q.type,count:view.count,total:view.total,level:view.level});
  return true;
 }
 // 死分支：illusion-service（链条更前）已经接走 32110，这里永远轮不到。
 // 第 77 版把原来的 `[32103,32110].includes(type)` 拆开 —— 32103 上面已经真正接管，
 // 只剩这一条为了「行为逐字节保持」留着的占位（见 tests/server-dispatch.test.mjs）。
 if(type===32110)return true;
 if(type===10521){const w=new Writer().byte(official.areas.length);for(const a of official.areas)w.byte(a.id).string(a.name).short(a.x).short(a.y).byte(a.state);send(type,w);return true;}
 if(type===10522){const list=worldTravelMaps(r.int());if(!list.length){send(type,new Writer().byte(-1).string('这个区域的场景尚未采集，暂时无法进入。'));return true;}const w=new Writer().byte(0).byte(list.length);for(const m of list)w.short(m.id).string(m.name).string(m.id===1?'返回本地新手村':'自由传送').byte(0).byte(0);send(type,w);return true;}
 if(type===10510){try{r.int();if(unlockCity(p))log('city-unlocked',{role:p.id,type});teleport(1000);send(type,new Writer().byte(0).raw(worldData(p,false).done()));}catch(e){send(type,new Writer().byte(-1).string(e.message));}return true;}
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
   // 放弃棋盘任务（英雄挑战赛 / BOSS 挑战赛）要把棋盘上下文也清掉，
   // 否则 context.solar 还挂着旧赛程。
   if(isBoardMission(id))clearSolarBoard(context);
   store.save();send(type,signUpdates(new Writer().byte(0),p));return true;
  }
  if(!near(p,npcById(p,npcId))||!npcEnabled(p,npcById(p,npcId)))throw Error('请走到任务 NPC 身边。');
  if(type===14502){
   const target=cityTarget(q,p);
   if(!(atNpc(q,p.mapId,npcId)||isCityMission(q)&&target.mapId===p.mapId&&target.npcId===npcId))throw Error('请到任务接取 NPC 处接取。');
   // 棋盘任务（英雄挑战赛 / BOSS 挑战赛）：任务已经在身上时允许再点一次报名 ——
   // 那是「重新打开棋盘」，不是重复接任务（离开棋盘后再回来得靠这个入口，否则
   // officialCanAccept 会以「已接取」挡掉，玩家再也进不去棋盘）。
   if(!(isBoardMission(id)&&p.quests.active[id])){
    if(!officialCanAccept(p,q))throw Error(prerequisiteMessage(p,q)||'任务条件未满足、已接取或今天已完成；缺少的城市条件待定。');
    if(Object.keys(p.quests.active).length>=127)throw Error('任务栏达到原版协议容量，请先交付或放弃部分任务。');
    p.quests.active[id]={official:true,counts:{},origin:originFor(p,q,npcId),acceptedAt:new Date().toISOString()};
   }
   const active=p.quests.active[id];
   if(isBoardMission(id)){
    if(active.solarDone)throw Error('挑战已完成，请交付任务领取奖励。');
    // 报名押金（escortCost = [黄金,白银,铜币]）：只收一次，重开棋盘不重复扣。
    // 太阳神殿的赛程与 1305 BOSS 挑战赛的 escortCost 都这么收（1305 是 10 银 + 50000 铜）。
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
   if(isBoardMission(id))startSolarBoard(context,send,p,id);
  }
  else{
   // 这一局的棋盘还开着（没走 14509 离开 / 14511 结束）不许交付，否则等于绕过硬挑战。
   if(isBoardMission(id)&&context.solar&&Number(context.solar.mission)===Number(id))throw Error('请先结束棋盘挑战，再回到报名点交付奖励。');
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

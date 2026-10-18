/**
 * 棋盘类副本 —— 协议部分：英雄挑战赛 / 团队副本（太阳神殿棋盘，任务 2592—2606）
 * 与 BOSS 挑战赛（任务 1305）。两者用的是**同一套客户端界面**，只差棋盘形状与对手表。
 *
 * 协议 14508（棋盘）/ 14509（离开）/ 14510（移动到相邻格）/ 14514（选当前格的对手）
 * / 14511（刷新 / 结束赛程）—— 客户端本来就有这套界面，服务端补上就能玩。
 *
 * ## 玩法
 * 报名任务接取后，站在对应场景里走棋盘（太阳神殿 = map 262，BOSS 挑战赛 = map 14）：
 * 走到有事件的格子 → 14514 选对手 → 拿到编队号 → 客户端发 12501 开打；
 * 打赢记「这一格已通过」，直到终点格打完 → 走到 100 号交付格 → 交付任务。
 * 进度存在 `p.quests.active[任务].solarBoard`（字段名沿用了太阳神殿那一版，存的是同一套
 * 「棋盘进度」；改名会毁老存档），重进游戏接着走。
 *
 * ## 两份棋盘（host）
 * 形状、连线、对手表都收在下面的两份 `*_BOARD_HOST` 里：太阳神殿 13 格 + 有 powers
 * （团队赛制进度），BOSS 挑战赛 5 格（0-1-2-3-100）+ 无 powers。两份棋盘**地图不同**，
 * 所以进包时按 `p.mapId` 认领；BOSS 挑战赛开在普通城镇图（新月古镇广场）上，
 * 还多一条「身上没有 1305 任务就不认领」的守卫 —— 否则玩家一站到那张图就会弹棋盘。
 *
 * ## 两个坑
 * ① 战斗入口：这些编队不在任何地图的刷怪点上，12501 会按「站到 NPC 旁边」校验并报
 *    「请靠近当前任务的战斗目标」。所以 game-service 里对棋盘编队跳过距离校验
 *    （与永泽塔塔层编队同一套做法，见 boardMissionOfGroup）。
 * ② 改角色前先 structuredClone，抛错整体回滚（store.save() 失败也要还原），
 *    不然一次失败就把棋盘状态写坏。
 */
import {Writer} from './codec.mjs';
import {officialGroups,officialMonsters} from './official-data.mjs';
import {battleSupported} from './official-rules.mjs';
import {SOLAR_MAP_ID,TEAM_DUNGEON_MISSION,SOLAR_ROUTE_EVENT,solarChallengeEventGroup,solarGroupMission,solarRoute,solarReady,isSolarMission} from './solar-challenge-data.mjs';
import {BOSS_TOURNAMENT_MISSION,BOSS_TOURNAMENT_MAP_ID,BOSS_BOARD_POINTS,BOSS_BOARD_XY,bossBoardConnections,bossTournamentEventOfCell,bossTournamentEventGroup,bossTournamentMissionOfGroup,bossTournamentBossName,isBossTournamentMission} from './boss-tournament-data.mjs';

// 棋盘 13 个格子的像素坐标（客户端按这个摆位，照抄社区版）。
const POINT_XY={0:[283,404],1:[244,322],2:[167,300],3:[175,389],4:[183,220],5:[270,180],6:[276,77],7:[172,77],8:[82,71],9:[58,172],10:[67,272],11:[119,182],100:[51,395]};
const EVENT_TEXT={
 600:['你碰见的是“混沌之剑-加索”所带领的小队。','战个痛快！'],
 601:['你碰见了苦行僧石像。','战个痛快！'],
 602:['你碰见了锁链巨力小队。','战个痛快！'],
 603:['你碰见了寒冰之心钢牙小队。','战个痛快！'],
 604:['你碰见了浪漫刺客单刀小队。','战个痛快！'],
 605:['你碰见了自由之剑小队。','战个痛快！'],
 607:['你碰见了狂蛇枪客小队。','战个痛快！'],
 608:['你碰见了魔翼狂刀小队。','战个痛快！'],
 609:['你碰见了阳炎小队。','战个痛快！'],
 610:['你碰见了魔弓邪眼小队。','战个痛快！'],
 611:['你碰见了西域刺客小队。','战个痛快！'],
 612:['你碰见了御林军银枪小队。','战个痛快！'],
 614:['你碰见了鹰首智华小队。','战个痛快！'],
 615:['你遇到了红袍法师。','挑战红袍法师！'],
 619:['烈日炎炎，天色突然昏暗下来。不对，是天上出现了巨物！是龙！！巨龙！！','准备攻击！引诱巨龙降落！'],
};
const BOARD_POINTS=[0,1,2,3,4,5,6,7,8,9,10,11,100];

/** 太阳神殿棋盘（13 格 + 团队赛制 powers）。 */
const SOLAR_BOARD_HOST={
 key:'solar',
 mapId:SOLAR_MAP_ID,
 isMission:isSolarMission,
 // 262 号图上只有这一种棋盘：身上没有赛程任务时也照老样子默认团队赛 2606。
 implicitMission:true,
 defaultMission:TEAM_DUNGEON_MISSION,
 ready:solarReady,
 points:BOARD_POINTS,
 pointXY:id=>POINT_XY[id],
 cellFlag:(id,passed)=>id===0?0:passed?4:0,
 connections:id=>solarRoute()?.points?.find(v=>v.id===id)?.conn||[],
 eventOf:cell=>SOLAR_ROUTE_EVENT.get(cell)||0,
 eventGroup:(mission,event)=>solarChallengeEventGroup(mission,event),
 eventText:(mission,event,target,names)=>mission===TEAM_DUNGEON_MISSION?(EVENT_TEXT[event]||['你遇到了敌人。','战斗！'])
  :['你遇到了'+names.join('、')+'。',target===10?'挑战终点守卫！':'开始挑战！'],
 powers:true,
 finalCell:10,
 deliveryCell:100,
 endText:'赛程完成！请向报名点交付任务，选择并领取奖励。',
};
/** BOSS 挑战赛棋盘（5 格，格子号就是对手号）。 */
const BOSS_BOARD_HOST={
 key:'boss-tournament',
 mapId:BOSS_TOURNAMENT_MAP_ID,
 isMission:isBossTournamentMission,
 implicitMission:false,
 defaultMission:BOSS_TOURNAMENT_MISSION,
 ready:()=>true,
 points:BOSS_BOARD_POINTS,
 pointXY:id=>BOSS_BOARD_XY[id],
 cellFlag:(id,passed)=>passed?4:0,
 connections:bossBoardConnections,
 eventOf:bossTournamentEventOfCell,
 eventGroup:(mission,event)=>bossTournamentEventGroup(event),
 eventText:(mission,event,target,names)=>['你遇到了'+names.join('、')+'。','开始挑战！'],
 powers:false,
 finalCell:3,
 deliveryCell:100,
 endText:'BOSS赛程完成，请返回原BOSS挑战赛交付任务。',
};
const BOARD_HOSTS=[SOLAR_BOARD_HOST,BOSS_BOARD_HOST];

const hostForMission=mission=>BOARD_HOSTS.find(host=>host.isMission(mission))||SOLAR_BOARD_HOST;
const hostForMap=mapId=>BOARD_HOSTS.find(host=>host.mapId===Number(mapId))||null;

function boardOf(p,mission){
 const saved=p?.quests?.active?.[mission]?.solarBoard;
 if(!saved)return null;
 return {mission,pos:saved.pos??0,passed:new Set(saved.passed||[0]),powers:saved.powers||[],completed:!!saved.completed};
}
/**
 * 落存档。完成状态同时回写到内存里的棋盘：`state.completed` 是**这次会话**的标记，
 * 存档里那份才是重进游戏后能接着交的依据 —— 两边必须一起走，别各记一份
 * （踩过：只写内存那一个 → 重进游戏后「赛程完成」丢了，走到交付点会被拦）。
 */
function persist(p,board,completed=!!board.completed){
 board.completed=!!completed;
 const active=p.quests?.active?.[board.mission];
 if(!active)return;
 active.solarBoard={mission:board.mission,pos:board.pos,passed:[...board.passed],powers:board.powers,completed:!!completed};
}
function boardPacket(p,board,host){
 const w=new Writer().int(Number(p?.gold||0)).int(Number(p?.silver||0)).int(Number(p?.coins||0)).byte(1).byte(host.points.length).int(0).int(36e5)
  .short(board.passed.size-1).byte(board.pos);
 for(const id of host.points){
  const [x,y]=host.pointXY(id),passed=board.passed.has(id);
  w.int(id).byte(host.cellFlag(id,passed)).short(x).short(y).bool(passed);
  const conn=host.connections(id);
  w.byte(conn.length);for(const n of conn)w.byte(n);
 }
 // powers（团队赛制进度）：只有太阳神殿那盘有；BOSS 挑战赛固定写 byte(1).byte(0)。
 const powers=host.powers?board.powers:[];
 w.byte(1).byte(powers.length);
 for(const [id,value] of powers)w.short(id).short(value);
 return w.done();
}
function movePacket(target,mission,host){
 const event=host.eventOf(target);
 if(!event)return new Writer().byte(0).byte(1).byte(target).done();
 const group=officialGroups.get(host.eventGroup(mission,event));
 const names=[...new Set((group?.monsters||[]).filter(Boolean).map(id=>officialMonsters.get(id)?.name).filter(Boolean))];
 const [desc,label]=host.eventText(mission,event,target,names);
 return new Writer().byte(1).string(desc).short(event).string(label).int(1e3).int(1e4).byte(1).byte(target).done();
}
function refreshPacket(board){
 return new Writer().byte(0).byte(0).byte(1).byte(board.pos).int(0).int(36e5).short(board.passed.size-1).bool(false).byte(0).done();
}
function endPacket(p,host){
 // 结束时**不**自动选奖励：客户端重载场景后走正常交付流程（14503）自己挑。
 return new Writer().byte(1).byte(0).bool(false).byte(0).string(host.endText).byte(0).int(p.mapId).byte(p.x).byte(p.y).int(0).done();
}

/** 玩家身上已接的、属于这份棋盘的报名任务（优先带进度的那一条）。 */
function activeBoardMission(p,host){
 const ids=Object.keys(p?.quests?.active||{}).map(Number).filter(id=>host.isMission(id));
 return ids.find(id=>p.quests.active[id].solarBoard)||ids[0]||0;
}

/**
 * 开棋盘：**认领任务时由服务端主动推 14508**（社区版就是这么做的 —— 它从不接
 * 客户端发来的 14508，玩家点完报名棋盘就必须自己弹出来）。
 * 读存档里的进度接着走；没有就从头开始。
 * @returns 棋盘对象
 */
export function startSolarBoard(context,send,p,mission){
 const host=hostForMission(mission);
 const id=host.isMission(mission)?Number(mission):host.defaultMission;
 const board=boardOf(p,id)||{mission:id,pos:0,passed:new Set([0]),powers:[],completed:false};
 context.solar={mission:id,host:host.key,board,pendingGroup:0,completed:board.completed};
 persist(p,board);
 send(14508,boardPacket(p,board,host));
 return board;
}

/** 报名押金文案：escortCost = [黄金, 白银, 铜币]（白银不够的部分由黄金补）。 */
export function solarDepositText(q){
 const [gold=0,silver=0,coins=0]=q?.escortCost||[];
 const parts=[];
 if(Number(gold)>0)parts.push(Number(gold)+' 黄金');
 if(Number(silver)>0)parts.push(Number(silver)+' 白银');
 if(Number(coins)>0)parts.push(Number(coins)+' 铜币');
 return parts.length?parts.join(' + '):'免费';
}

export function handleSolarChallenge(type,r,context,{send,store,log}){
 const p=context.role;
 const trace=(event,data={})=>{try{log&&log('board-challenge',{event,type,host:context.solar?.host,...data});}catch{}};
 if(!p)return false;
 if(![14508,14509,14510,14511,14514].includes(type)){trace('skip-type');return false;}
 const host=hostForMap(p.mapId);
 if(!host){trace('skip-wrong-map',{mapId:p.mapId});return false;}
 if(!host.ready()){trace('skip-not-ready');return false;}
 // 报名任务：优先用当前棋盘记的，其次找玩家身上已接的赛程任务。
 const openMission=activeBoardMission(p,host)
  ||(context.solar?.host===host.key&&host.isMission(context.solar.mission)?Number(context.solar.mission):0);
 // BOSS 挑战赛开在普通城镇图上：身上没有 1305 就绝不认领（否则一站到新月古镇广场就弹棋盘）。
 if(!host.implicitMission&&!openMission){trace('skip-no-mission',{mapId:p.mapId});return false;}
 const mission=openMission||host.defaultMission;
 if(type===14508){
  // 客户端自己也会发 14508（离开后再回来）：同样按存档进度重开。
  startSolarBoard(context,send,p,mission);
  return true;
 }
 // 会话恢复：`context.solar` 只活在内存里，**每次重进游戏都是 null**。
 // 而棋盘进度是存档级的（p.quests.active[任务].solarBoard）。不恢复的话，
 // 重进后 14510/14514/14511 全部在这里 return false —— 客户端等不到回包，
 // 表现就是「点开始挑战没反应、走格动不了」，而且没有任何报错（第 67 版玩家实测）。
 // 只要身上有已接的赛程任务，就从存档把棋盘接回来，和 14508 同一套。
 if(!context.solar&&p.quests?.active?.[mission])startSolarBoard(context,send,p,mission);
 const state=context.solar;
 if(!state||!host.isMission(state.mission))return false;
 trace('resumed',{pos:state.board.pos,passed:[...state.board.passed],completed:state.completed});
 const board=state.board;
 const before=structuredClone(p),stateBefore=structuredClone(state);
 try{
  if(type===14509){ // 离开棋盘
   trace('leave');
   if(context.battle)throw Error('请先结束当前战斗。');
   persist(p,board,state.completed);
   store.save();
   context.solar=null;
   send(type,new Writer().byte(0).int(p.mapId).byte(p.x).byte(p.y).int(0));
   return true;
  }
  if(type===14510){ // 移动到相邻格
   const target=r.byte()&255;r.byte();
   trace('move',{from:board.pos,target});
   const current=board.pos,connections=host.connections(current);
   const retry=target===current&&!!host.eventOf(current)&&!board.passed.has(current);
   if(context.battle)throw Error('请先结束当前战斗。');
   if(!retry&&!connections.includes(target))throw Error('只能移动到相邻的格子。');
   if(!retry&&host.eventOf(current)&&!board.passed.has(current))throw Error('请先完成当前格子的挑战，再前往相邻格子。');
   if(target===host.deliveryCell&&!state.completed)throw Error('请先完成终点格的挑战，再前往交付点。');
   board.pos=target;
   if(!host.eventOf(target))board.passed.add(target);
   if(target===host.deliveryCell&&state.completed)p.quests.active[mission].solarDone=true;
   persist(p,board,state.completed);
   store.save();
   send(type,board.passed.has(target)?new Writer().byte(0).byte(1).byte(target).done():movePacket(target,mission,host));
   return true;
  }
  if(type===14514){ // 选当前格的对手 → 回编队号，客户端接着发 12501
   const event=r.short();
   trace('event-choice',{cell:board.pos,event});
   if(context.battle)throw Error('请先结束当前战斗。');
   if(event!==host.eventOf(board.pos))throw Error('请先选择当前格子的挑战。');
   if(board.passed.has(board.pos))throw Error('这一格的挑战已经通过了。');
   const group=host.eventGroup(mission,event);
   if(!group)throw Error('未知的副本事件。');
   if(!battleSupported(group))throw Error('这组挑战对手的数据不完整。');
   state.pendingGroup=group;
   persist(p,board,state.completed);
   store.save();
   trace('event-group',{group,supported:battleSupported(group),boss:bossTournamentBossName(event)});
   send(type,new Writer().byte(0).short(group).done());
   return true;
  }
  if(type===14511){ // 刷新 / 结束
   r.short();
   trace('end-or-refresh',{completed:state.completed,pos:board.pos,battle:!!context.battle});
   if(context.battle)throw Error('请先结束当前战斗。');
   if(state.completed&&board.pos===host.deliveryCell){
    persist(p,board,state.completed);
    store.save();
    const body=endPacket(p,host);
    context.solar=null;
    send(type,body);
    return true;
   }
   send(type,refreshPacket(board));
   return true;
  }
  return false;
 }catch(error){
  for(const key of Object.keys(p))if(!(key in before))delete p[key];
  Object.assign(p,before);
  context.solar=stateBefore;
  throw error;
 }
}

/** 12501 用：玩家已选好、等着开打的编队（不在地图上，跳过距离校验）。 */
export function pendingSolarGroup(context){
 return context?.solar?.pendingGroup||0;
}
export function clearSolarPending(context){
 if(context?.solar)context.solar.pendingGroup=0;
}
/** 放弃任务（14504）时清掉棋盘上下文，别让下一场战斗还认这段赛程。 */
export function clearSolarBoard(context){if(context)context.solar=null;}
/**
 * 战斗胜利后记「这一格已通过」（12502 结算成功时调用）。
 * **不在这里发 14508** —— 由调用方在 12502 回包之后推。社区版也是这个顺序
 * （game-service.mjs 里 boardReplies 在 send(type,battleReward(...)) 之后才 flush）：
 * 早发的话客户端还在战斗收尾状态里开棋盘，会被随后的 closeAllUI 冲掉，
 * 表现就是「打完棋盘没了、人卡在地图上动不了」（第 67 版玩家实测）。
 *
 * 只有打赢**当前格子的对手**才算这一格通过：同一张图上的其它战斗（例如直接在
 * NPC 处打 1305 那三个委托目标）不该偷偷改棋盘进度。
 * @returns {null | {type:number,body:Buffer}} 要补发的棋盘包
 */
export function settleSolarBattle(context,p,group){
 const state=context?.solar;
 if(!state||!state.board)return null;
 const mission=state.mission||TEAM_DUNGEON_MISSION;
 const host=hostForMission(mission);
 const event=host.eventOf(state.board.pos);
 state.pendingGroup=0;
 if(event&&group===host.eventGroup(mission,event)){
  state.board.passed.add(state.board.pos);
  if(state.board.pos===host.finalCell)state.completed=true;
 }
 persist(p,state.board,state.completed);
 return {type:14508,body:boardPacket(p,state.board,host)};
}
/** 这个编队是不是棋盘赛程里的（12501 距离校验用）：太阳神殿 + BOSS 挑战赛。 */
export const boardMissionOfGroup=groupId=>solarGroupMission(groupId)||bossTournamentMissionOfGroup(groupId);

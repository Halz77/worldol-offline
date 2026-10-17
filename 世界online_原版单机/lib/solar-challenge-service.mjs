/**
 * 英雄挑战赛 / 团队副本（太阳神殿棋盘）—— 协议部分。
 *
 * 协议 14508（棋盘）/ 14509（离开）/ 14510（移动到相邻格）/ 14514（选当前格的对手）
 * / 14511（刷新 / 结束赛程）—— 客户端本来就有这套界面，服务端补上就能玩。
 *
 * ## 玩法
 * 报名任务（2592…2606）接取后，站在太阳神殿（地图 262）里走棋盘：
 * 走到有事件的格子 → 14514 选对手 → 拿到编队号 → 客户端发 12501 开打；
 * 打赢记「这一格已通过」，直到终点格（10 号，龙）打完 → 走到 100 号交任务。
 * 进度存在 `p.quests.active[任务].solarBoard`，重进游戏接着走。
 *
 * ## 两个坑
 * ① 战斗入口：这些编队不在任何地图的刷怪点上，12501 会按「站到 NPC 旁边」校验并报
 *    「请靠近当前任务的战斗目标」。所以 game-service 里对太阳神殿的组跳过距离校验
 *    （与永泽塔塔层编队同一套做法，见 solarGroupMission）。
 * ② 改角色前先 structuredClone，抛错整体回滚（store.save() 失败也要还原），
 *    不然一次失败就把棋盘状态写坏。
 */
import {Writer} from './codec.mjs';
import {officialGroups,officialMonsters} from './official-data.mjs';
import {battleSupported} from './official-rules.mjs';
import {SOLAR_MAP_ID,TEAM_DUNGEON_MISSION,SOLAR_ROUTE_EVENT,solarChallengeEventGroup,solarGroupMission,solarRoute,solarReady,isSolarMission} from './solar-challenge-data.mjs';

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

function boardOf(p,mission){
 const saved=p?.quests?.active?.[mission]?.solarBoard;
 if(!saved)return null;
 return {mission,pos:saved.pos??0,passed:new Set(saved.passed||[0]),powers:saved.powers||[],completed:!!saved.completed};
}
function persist(p,board,completed=false){
 const active=p.quests?.active?.[board.mission||TEAM_DUNGEON_MISSION];
 if(!active)return;
 active.solarBoard={mission:board.mission||TEAM_DUNGEON_MISSION,pos:board.pos,passed:[...board.passed],powers:board.powers,completed:!!completed};
}
function boardPacket(p,board){
 const route=solarRoute();
 const w=new Writer().int(Number(p?.gold||0)).int(Number(p?.silver||0)).int(Number(p?.coins||0)).byte(1).byte(13).int(0).int(36e5)
  .short(board.passed.size-1).byte(board.pos);
 for(const id of BOARD_POINTS){
  const [x,y]=POINT_XY[id],passed=board.passed.has(id);
  w.int(id).byte(id===0?0:passed?4:0).short(x).short(y).bool(passed);
  const conn=route?.points?.find(v=>v.id===id)?.conn||[];
  w.byte(conn.length);for(const n of conn)w.byte(n);
 }
 w.byte(1).byte(board.powers.length);
 for(const [id,value] of board.powers)w.short(id).short(value);
 return w.done();
}
function movePacket(target,mission){
 const event=SOLAR_ROUTE_EVENT.get(target);
 if(!event)return new Writer().byte(0).byte(1).byte(target).done();
 const group=officialGroups.get(solarChallengeEventGroup(mission,event));
 const names=[...new Set((group?.monsters||[]).filter(Boolean).map(id=>officialMonsters.get(id)?.name).filter(Boolean))];
 const [desc,label]=mission===TEAM_DUNGEON_MISSION?(EVENT_TEXT[event]||['你遇到了敌人。','战斗！'])
  :['你遇到了'+names.join('、')+'。',target===10?'挑战终点守卫！':'开始挑战！'];
 return new Writer().byte(1).string(desc).short(event).string(label).int(1e3).int(1e4).byte(1).byte(target).done();
}
function refreshPacket(board){
 return new Writer().byte(0).byte(0).byte(1).byte(board.pos).int(0).int(36e5).short(board.passed.size-1).bool(false).byte(0).done();
}
function endPacket(p){
 // 结束时**不**自动选奖励：客户端重载场景后走正常交付流程（14503）自己挑。
 return new Writer().byte(1).byte(0).bool(false).byte(0).string('赛程完成！请向报名点交付任务，选择并领取奖励。').byte(0).int(p.mapId).byte(p.x).byte(p.y).int(0).done();
}

/**
 * 开棋盘：**接任务时由服务端主动推 14508**（社区版就是这么做的 —— 它从不接
 * 客户端发来的 14508，玩家点完报名棋盘就必须自己弹出来）。
 * 读存档里的进度接着走；没有就从头开始。
 * @returns 棋盘对象
 */
export function startSolarBoard(context,send,p,mission){
 const board=boardOf(p,mission)||{mission,pos:0,passed:new Set([0]),powers:[],completed:false};
 context.solar={mission,board,pendingGroup:0,completed:board.completed};
 persist(p,board,board.completed);
 send(14508,boardPacket(p,board));
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
 const trace=(event,data={})=>{try{log&&log('solar-board',{event,type,mission:context.solar?.mission,...data});}catch{}};
 if(!p||!solarReady()){trace('skip-not-ready',{ready:solarReady(),hasRole:!!p});return false;}
 if(p.mapId!==SOLAR_MAP_ID){trace('skip-wrong-map',{mapId:p.mapId});return false;}
 if(![14508,14509,14510,14511,14514].includes(type)){trace('skip-type');return false;}
 trace('claim');
 // 报名任务：优先用当前棋盘记的，其次找玩家身上已接的赛程任务。
 const mission=context.solar?.mission
  ||Object.keys(p.quests?.active||{}).map(Number).find(id=>isSolarMission(id)&&p.quests.active[id].solarBoard)
  ||Object.keys(p.quests?.active||{}).map(Number).find(id=>isSolarMission(id))
  ||TEAM_DUNGEON_MISSION;
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
 if(!context.solar&&p.quests?.active?.[mission]?.solarBoard){
  startSolarBoard(context,send,p,mission);
 }
 const state=context.solar;
 if(!state)return false;
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
   const current=board.pos,route=solarRoute();
   const connections=route?.points?.find(v=>v.id===current)?.conn||[];
   const retry=target===current&&SOLAR_ROUTE_EVENT.has(current)&&!board.passed.has(current);
   if(context.battle)throw Error('请先结束当前战斗。');
   if(!retry&&!connections.includes(target))throw Error('只能移动到相邻的格子。');
   if(!retry&&SOLAR_ROUTE_EVENT.has(current)&&!board.passed.has(current))throw Error('请先完成当前格子的挑战，再前往相邻格子。');
   if(target===100&&!state.completed)throw Error('请先完成终点格的挑战，再前往交付点。');
   board.pos=target;
   if(!SOLAR_ROUTE_EVENT.has(target))board.passed.add(target);
   if(target===100&&state.completed)p.quests.active[mission].solarDone=true;
   persist(p,board,state.completed);
   store.save();
   send(type,board.passed.has(target)?new Writer().byte(0).byte(1).byte(target).done():movePacket(target,mission));
   return true;
  }
  if(type===14514){ // 选当前格的对手 → 回编队号，客户端接着发 12501
   const event=r.short();
   trace('event-choice',{cell:board.pos,event});
   if(context.battle)throw Error('请先结束当前战斗。');
   if(event!==SOLAR_ROUTE_EVENT.get(board.pos))throw Error('请先选择当前格子的挑战。');
   if(board.passed.has(board.pos))throw Error('这一格的挑战已经通过了。');
   const group=solarChallengeEventGroup(mission,event);
   if(!group)throw Error('未知的副本事件。');
   if(!battleSupported(group))throw Error('这组挑战对手的数据不完整。');
   state.pendingGroup=group;
   persist(p,board,state.completed);
   store.save();
   trace('event-group',{group,supported:battleSupported(group)});
   send(type,new Writer().byte(0).short(group).done());
   return true;
  }
  if(type===14511){ // 刷新 / 结束
   r.short();
   trace('end-or-refresh',{completed:state.completed,pos:board.pos,battle:!!context.battle});
   if(context.battle)throw Error('请先结束当前战斗。');
   if(state.completed&&board.pos===100){
    persist(p,board,true);
    store.save();
    const body=endPacket(p);
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
 * @returns {null | {type:number,body:Buffer}} 要补发的棋盘包
 */
export function settleSolarBattle(context,p,group){
 const state=context?.solar;
 if(!state||!state.board)return null;
 const mission=state.mission||TEAM_DUNGEON_MISSION;
 state.board.passed.add(state.board.pos);
 state.pendingGroup=0;
 if(state.board.pos===10&&group===solarChallengeEventGroup(mission,619))state.completed=true;
 persist(p,state.board,state.completed);
 return {type:14508,body:boardPacket(p,state.board)};
}
/** 这个编队是不是太阳神殿赛程里的（12501 距离校验用）。 */
export const solarMissionOfGroup=groupId=>solarGroupMission(groupId);

/**
 * 英雄挑战赛 / 团队副本（太阳神殿棋盘）—— 数据部分。
 *
 * ## 背景
 * 官方任务表里这 7 个报名任务是齐的（2592 / 2593 / 2594 / 2596 / 2605 / 2597 / 2606），
 * 缺的是两样东西：**对手编队**（抓包里的 16 组 + 按赛制克隆的 60 组）和
 * **棋盘协议**（14508 棋盘 / 14510 移动 / 14514 选对手 / 14511 刷新 / 14509 离开）。
 * 这条线原来整体是空的，任务上挂着「剧情战斗数据尚未采集」。
 *
 * ## 数据
 * data/solar-challenge-monsters.json（81 只怪 + 76 个编队，社区版从
 * data/team-dungeon-capture-20261001.json 复现服务端构造逻辑得来）
 * data/team-dungeon-capture-20261001.json（12 个棋盘格子的连线关系）
 *
 * 数值一律沿用抓包：怪物属性是原样抄的，血量的任务级缩放（SOLAR_HP_DIV / SOLAR_HP_FIX）
 * 已经在生成那份 JSON 时算完，这里只负责把 wire 补出来、注册进官方表。
 * 塔怪同理：**没有 AI**，靠属性压制，是既定的简化。
 *
 * ## 两个坑
 * ① 读 data 文件不能用 fs.existsSync 门控（APK 里 node:fs 是 VFS shim，恒 false）。
 * ② 编队一定要走 lib/dungeon-challenge-data.mjs 的 addGroup：flag 与槽位数必须一致
 *    （16 只怪 → flag 3 = 20 槽 + 4 个 NPC short），不一致客户端整包解析失败。
 */
import fs from 'node:fs';
import {monsterWireBytes} from './monster-balance.mjs';
import {addGroup} from './dungeon-challenge-data.mjs';

export const SOLAR_MAP_ID=262;
export const TEAM_DUNGEON_MISSION=2606;
/** 棋盘上 10 种事件的顺序（与编队一一对应）。 */
export const SOLAR_EVENTS=[600,601,602,603,604,605,607,608,615,619];
/** 抓包里 2606「团队小组挑战赛(高难度)」用原始编队，直接按事件号取。 */
const TEAM_EVENT_GROUPS=new Map([[600,2460],[601,2461],[602,2462],[603,2463],[604,2464],[605,2465],[607,2467],[608,2468],[609,2469],[610,2470],[611,2471],[612,2472],[614,2474],[615,2475],[619,2320]]);
/** 棋盘格子 → 事件（没有事件的格子走过就算通过）。 */
export const SOLAR_ROUTE_EVENT=new Map([[1,600],[2,601],[4,602],[5,603],[6,604],[7,605],[8,607],[9,608],[10,619],[11,615]]);
/** 报名任务 → 赛制说明（每场最多几名敌人）。 */
export const SOLAR_PROFILES=[
 {mission:2592,fighters:2},{mission:2593,fighters:4},{mission:2594,fighters:8},
 {mission:2596,fighters:1},{mission:2605,fighters:4},{mission:2597,fighters:16},
 {mission:TEAM_DUNGEON_MISSION,fighters:20},
];

let cache=null;
function load(){
 if(cache)return cache;
 const read=file=>{
  try{return JSON.parse(fs.readFileSync(new URL('../data/'+file,import.meta.url),'utf8'));}
  catch(error){
   // VFS shim：data/ 是运行时按需加载的，existsSync 恒 false，只能直接读。
   if(error&&error.code==='ENOENT')return null;
   throw error;
  }
 };
 const monsters=read('solar-challenge-monsters.json'),capture=read('team-dungeon-capture-20261001.json');
 if(!monsters||!capture){cache={ready:false,monsters:[],groups:[],route:null};return cache;}
 cache={ready:true,monsters:monsters.monsters||[],groups:monsters.groups||[],route:capture.route||null};
 return cache;
}

/** 注册后建立的「任务:事件 → 编队号」映射。 */
const eventGroupIndex=new Map();

/**
 * 把英雄挑战赛的怪物与编队补进官方数据（在 official-data.ensure() 建索引之前调用一次）。
 * @returns {{ready:boolean,monsters:number,groups:number,events:number}}
 */
export function applySolarChallenges(data){
 const loaded=load();
 if(!loaded.ready)return {ready:false,monsters:0,groups:0,events:0};
 const source=extra=>[{origin:'local-solar-challenge',mapId:SOLAR_MAP_ID,...extra}];
 let addedMonsters=0,addedGroups=0;
 for(const m of loaded.monsters){
  if(data.monsters.some(row=>row.id===m.id))continue;
  data.monsters.push({...m,wireBase64:m.wireBase64||monsterWireBytes(m),
   sources:m.sources||source({missionId:m.missionId}),localReconstruction:true});
  addedMonsters++;
 }
 // 每个任务的编队按 groupId 排序后与 SOLAR_EVENTS 一一对应（生成时就是这个顺序）。
 const byMission=new Map();
 for(const g of loaded.groups){
  const mission=Number(g.missionId)||TEAM_DUNGEON_MISSION;
  if(!byMission.has(mission))byMission.set(mission,[]);
  byMission.get(mission).push(g);
 }
 for(const [mission,list] of byMission){
  list.sort((a,b)=>a.groupId-b.groupId);
  list.forEach((g,index)=>{
   const event=SOLAR_EVENTS[index];
   if(event!==undefined)eventGroupIndex.set(mission+':'+event,g.groupId);
  });
 }
  // 棋盘编队一律 20 槽 + flag 3（照社区版 team-dungeon-data.mjs 的 groupWire：
  // 写死 byte(3) 并补到 20 个 short）。**不能按怪物数算 flag** —— 7 只怪的组若走
  // 10 槽，客户端按另一种阵型排布，表现就是「站位不对」（第 67 版玩家实测）。
  for(const g of loaded.groups){
   const mission=Number(g.missionId)||TEAM_DUNGEON_MISSION;
   const monsters=(g.monsters||[]).filter(id=>id>0);
   const before=data.groups.length;
   addGroup(data,source({missionId:mission,referenceGroupId:g.groupId}),
    {groupId:g.groupId,monsters,npcs:[0,0,0,0],slotCount:20,extra:{missionId:mission,tierText:g.tierText||'英雄挑战赛'}});
   if(data.groups.length>before)addedGroups++;
  }
 // 2606 走抓包原编队，事件号直接映射。
 for(const [event,groupId] of TEAM_EVENT_GROUPS)eventGroupIndex.set(TEAM_DUNGEON_MISSION+':'+event,groupId);
 return {ready:true,monsters:addedMonsters,groups:addedGroups,events:eventGroupIndex.size};
}

/** 某个任务的某个事件对应的编队号（0 = 未知）。 */
export function solarChallengeEventGroup(mission,event){
 const id=Number(mission)||TEAM_DUNGEON_MISSION;
 return eventGroupIndex.get(id+':'+event)||(id===TEAM_DUNGEON_MISSION?TEAM_EVENT_GROUPS.get(event)||0:0);
}
/** 这个编队属于哪一场挑战（12501 用它决定是否跳过「站在 NPC 旁边」的校验）。 */
export function solarGroupMission(groupId){
 for(const [key,value] of eventGroupIndex)if(value===groupId)return Number(key.split(':')[0]);
 for(const [event,value] of TEAM_EVENT_GROUPS)if(value===groupId)return TEAM_DUNGEON_MISSION;
 return 0;
}
export const solarReady=()=>load().ready;
export const solarRoute=()=>load().route;
export const solarGroupIds=()=>load().groups.map(g=>g.groupId);
export const isSolarMission=id=>SOLAR_PROFILES.some(p=>p.mission===Number(id));

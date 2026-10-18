import {Reader,Writer} from './codec.mjs';

/**
 * 个人城市（`cityTemplate` 地图：1000 / 3090）的三处小修 —— 移植自「幻想世界OL 2.0 新版」的
 * `lib/city-template-fixes.mjs`，改法按本工程的习惯重写（先读回校验、重建必须逐字节相同）。
 *
 * ## 1. 任务公告板看不见（真 BUG）
 * 主包 `ModelConst` 里状态字节的语义是（客户端 readPowerNPCData 头部常量，逐字核对过）：
 *   `STATUS_VISIBLE=1`、`STATUS_ENABLE=2`、`STATUS_PASSABLE=4`、`STATUS_MISSION_DATA_USE=8`、
 *   `STATUS_MISSION_LOAD_EVERY_TIME=16`、`STATUS_JUMP_ICON=32`、`STATUS_HIDE_PLAYER=64`……
 * 城市里的「日常任务列表 / 日常高级任务列表」录到时 `status=2` —— **只有「可交互」没有「可见」**，
 * 所以玩家在自己城市里根本看不到任务板（本工程 `npcEnabled()` 的 `(status&3)===3` 也是同一个口径，
 * 见 tests/memorial-npcs.test.mjs「type 0 的展示状态位是原版既定的 23」），
 * 连活跃度面板里「日常任务列表」（14551 的寻路目标就是 1000:6，见 lib/daily-service.mjs）也点不过去。
 * 这里只补上可见位 → 2|1 = 3，与录制里 183 个正常 type 0 NPC 一致。
 *
 * ## 2. 市长对白还是「新生城市」
 * 7 号 NPC「代理市长-雷恩」（missionData=[3005,1,…]）是**城市五级扩建完成后才会出现**的那位，
 * 但录制里的对白仍是「这是一座新生的城市……城市的发展离不开领主的努力」。
 * 换成扩建后的版本（文案取自对方同一处修改）。
 *
 * ## 3. 飞行驿站只有 5 条原版航线
 * 驿站自己的招呼语就写着「可以让你快捷的前往各个主要的城市，原有的冒险地图跳转可通过圣域、
 * 紫禁城等各大城市前往」，录到的菜单却只有太阳城/新月古镇/圣域/紫禁城/英雄挑战赛五项。
 * 这里按【主城】【地区】【副本】【节日】四组把已采集地图的**出生点**补进菜单
 * （`jumpMapReqMissionID=0`，无门槛；与 applyOpenPortals 同一套「菜单项无条件可走」的做法）。
 * 目标地图只做静态校验：必须已采集、不是个人城市模板、出生点存在且能塞进 byte/short 字段；
 * 缺项**跳过并告警**而不是抛错 —— 这份补丁在 official-data.ensure() 里跑，抛错等于起不来服务。
 * 具体能不能走由 tests/city-template-fixes.test.mjs 与 tests/open-portals.test.mjs 端到端验证
 * （10506 真的跳过去、落点可通行）。
 *
 * 补完一共 65 项，超过原版对话窗一屏能摆下的数量（原版最长也就十来项），客户端那份
 * 菜单会把后面的选项挤出窗口、点不到也滚不动 —— 所以这一版同时在 `web/offline.js` 里
 * 给 power-NPC 菜单做了分页（`UI.createMissionUI` 切页 + `MissionDialogMdr.executeChoice`
 * 钩子翻页，另把 `list_choice` 套进 Scroller 兜底）。两半要一起改：
 * 服务端只负责把航线摆出来，页是客户端切的。
 *
 * ## 注入点顺序
 * `official-data.ensure()` 里所有「补地图」的补丁跑完之后、建索引之前调用这两个函数：
 * 航线目的地要在地图表里存在，而客户端下发的 NPC wire 直接从 official.maps 取。
 * 又因为它排在 applyOpenPortals（更早）之后，驿站原有的 5 条航线此时状态位/门槛已经被放行过，
 * 这里读回来照样能通过校验（不会重复放行、也不会把已放行的字节改回去）。
 */
export const cityTemplateRevision='city-template-boards-flights-20261018-v1';

/** 客户端 ModelConst.STATUS_VISIBLE。 */
const STATUS_VISIBLE=1;
/** 客户端 ModelConst.STATUS_MISSION_DATA_USE：状态位带它时，记录里多 6 字节 missionData。 */
const STATUS_MISSION_DATA_USE=8;
/** 传送菜单是 byte 计数的，原版上限 127 项。 */
const MENU_LIMIT=127;

/** 城市模板里两个任务公告板（npcType 0）。 */
const CITY_BOARDS=new Set(['日常任务列表','日常高级任务列表']);
/** 扩建完成后的市长：id 7 + 该 NPC 的任务菜单第 0 项是 3005（升级到五级城市）。 */
const MAYOR={id:7,name:'代理市长-雷恩',missionId:3005};
const EXPANDED_MAYOR_TALK='领主大人，我们的城市已经完成扩建。我会继续管理城市的日常事务；您可以查看城市金库，安排建设和守卫训练，并通过任务公告板处理各地的委托。繁荣度与军力仍需通过实际建设、贡献和任务积累。';

/** 飞行驿站（npcType 5）。 */
const FLIGHT_NPC='飞行驿站';
const FLIGHT_TALK='免费直达各大主城、地区、副本与节日地图。航线较多，请用「上一页 / 下一页」翻页。';

/**
 * 航线目的地登记表（移植自对方的 `cityFlightRegions`）。
 * 只登记「分组 + 地图号」：名称与落点一律取当地图自己的 `spawn`，
 * 免得官方改了地图名还要回来改这份表。
 */
export const cityFlightRegions=[
 ['主城',[14,19,303,37,960,35,835,955,900]],
 ['地区',[4,16,254,251,22,20,825,820,279,920,926,265,829,833]],
 ['副本',[11,813,907,914,273,411,257,271,255,945,300,418,458,961,965,966,838,977,963,964,974,861,260,988]],
 ['节日',[259,967,969,954,985,987,959,911,912,952,457,98,836]],
];

/**
 * 读 NPC 记录头三段字符串与状态字节，顺带校对记录与 npc 字段一致
 * （wire 与字段不同步时宁可抛错，也不写出一份歪的记录）。
 */
function readNpcHead(npc){
 const body=Buffer.from(npc.wireBase64,'base64'),r=new Reader(body);
 r.take(14);
 r.utf();
 r.utf();
 const talkStart=r.pos,talk=r.utf(),statusOffset=r.pos,status=r.byte()&255;
 if(talk!==npc.talkDetail||status!==npc.status)throw Error(`城市模板 NPC 记录与字段不符：${npc.mapId}:${npc.id}`);
 return {body,r,talkStart,talk,statusOffset,status};
}

/** 任务公告板：只补可见位。 */
function fixCityBoard(npc){
 const {body,statusOffset,status}=readNpcHead(npc);
 body[statusOffset]=status|STATUS_VISIBLE;
 return {...npc,status:status|STATUS_VISIBLE,wireBase64:body.toString('base64'),localCityTemplateFix:'show-recorded-task-board'};
}

/** 市长：换掉第三段对白（原值留在 recordedTalkDetail 便于核对）。 */
function fixCityMayor(npc){
 const {body,talkStart,talk,statusOffset}=readNpcHead(npc);
 const wire=Buffer.concat([body.subarray(0,talkStart),new Writer().utf(EXPANDED_MAYOR_TALK).done(),body.subarray(statusOffset)]);
 return {...npc,talkDetail:EXPANDED_MAYOR_TALK,recordedTalkDetail:talk,wireBase64:wire.toString('base64'),localCityTemplateFix:'expanded-city-mayor-dialogue'};
}

function fixCityTemplateNpc(npc){
 if(npc.localCityTemplateFix)return npc; // 幂等：同一份记录不重复改（改两次会把留档的原对白覆盖掉）。
 if(!npc.wireBase64)return npc; // 本地自编 NPC（没有录制记录）自带状态位，不动它。
 if(npc.npcType===0&&CITY_BOARDS.has(npc.name))return fixCityBoard(npc);
 if(npc.id===MAYOR.id&&npc.name===MAYOR.name&&npc.missionData?.[0]===MAYOR.missionId)return fixCityMayor(npc);
 return npc;
}

export function applyCityTemplateFixes(official){
 for(const map of official.maps)if(map.cityTemplate)map.npcs=map.npcs.map(fixCityTemplateNpc);
 return official;
}

/**
 * 把飞行驿站的菜单补齐。
 *
 * 记录布局（客户端 readPowerNPCData，已逐字段核对）：
 *   [14 字节固定头] 名字 招呼 对话 状态 朝向 x y 范围x 范围y
 *   [missionData 6 字节：仅当 状态&8]
 *   传送菜单数(byte) { 菜单名(utf) 目标地图(short) 目标x(byte) 目标y(byte) 需求任务(short) 需求状态(byte) }×N
 *   战斗菜单 / 商店菜单 / 导师菜单（三段原样保留）
 * 先用解析出来的内容**原样重建一次**：与原件逐字节相同才敢改 —— 字段顺序的假设要能被证明。
 */
function expandCityFlightStation(npc,destinations){
 if(npc.npcType!==5||npc.name!==FLIGHT_NPC||!npc.jumpMapID?.length)return npc;
 if(npc.localCityFlightExpansion===cityTemplateRevision)return npc; // 幂等
 if(!npc.wireBase64)return npc;
 const body=Buffer.from(npc.wireBase64,'base64'),header=Buffer.from(body.subarray(0,14)),r=new Reader(body);
 r.take(14);
 const name=r.utf(),welcome=r.utf(),talkStart=r.pos,talk=r.utf(),statusOffset=r.pos;
 const status=r.byte()&255,direction=r.byte()&255,x=r.byte()&255,y=r.byte()&255,rangeX=r.byte()&255,rangeY=r.byte()&255;
 if(talk!==npc.talkDetail||status!==npc.status||direction!==npc.direction||x!==npc.x||y!==npc.y)throw Error(`飞行驿站记录与字段不符：${npc.mapId}:${npc.id}`);
 let missionBlock=Buffer.alloc(0);
 if(status&STATUS_MISSION_DATA_USE){const offset=r.take(6);missionBlock=Buffer.from(body.subarray(offset,offset+6));}
 const count=r.byte()&255,entries=[];
 for(let i=0;i<count;i++){
  const label=r.utf(),target=r.short(),gx=r.byte()&255,gy=r.byte()&255,mission=r.short(),state=r.byte()&255;
  if(label!==npc.menuJumpMap[i]||target!==npc.jumpMapID[i]||gx!==npc.jumpMapGx[i]||gy!==npc.jumpMapGy[i])throw Error(`飞行驿站菜单与字段不符：${npc.mapId}:${npc.id} 第 ${i} 项`);
  if(mission!==(npc.jumpMapReqMissionID?.[i]??0)||state!==(npc.jumpMapReqMissionState?.[i]??0))throw Error(`飞行驿站门槛字段与记录不符：${npc.mapId}:${npc.id} 第 ${i} 项`);
  entries.push({label,target,gx,gy,mission,state});
 }
 const tail=Buffer.from(body.subarray(r.pos)); // 战斗/商店/导师三段：原样搬运
 const build=(talkText,rows)=>{
  const w=new Writer().raw(header).utf(name).utf(welcome).utf(talkText)
   .byte(status).byte(direction).byte(x).byte(y).byte(rangeX).byte(rangeY).raw(missionBlock)
   .byte(rows.length);
  for(const row of rows)w.utf(row.label).short(row.target).byte(row.gx).byte(row.gy).short(row.mission||0).byte(row.state||0);
  return w.raw(tail).done();
 };
 if(!build(talk,entries).equals(body))throw Error(`飞行驿站重建不一致：${npc.mapId}:${npc.id}`);
 const seen=new Set(entries.map(entry=>entry.target));
 for(const destination of destinations){
  if(seen.has(destination.target))continue;
  seen.add(destination.target);
  entries.push(destination);
 }
 if(entries.length===count)return npc;
 if(entries.length>MENU_LIMIT)throw Error(`飞行驿站航线超过原版上限 ${MENU_LIMIT} 项：${npc.mapId}:${npc.id}`);
 return {...npc,talkDetail:FLIGHT_TALK,
  menuJumpMap:entries.map(entry=>entry.label),jumpMapID:entries.map(entry=>entry.target),
  jumpMapGx:entries.map(entry=>entry.gx),jumpMapGy:entries.map(entry=>entry.gy),
  jumpMapReqMissionID:entries.map(entry=>entry.mission||0),jumpMapReqMissionState:entries.map(entry=>entry.state||0),
  wireBase64:build(FLIGHT_TALK,entries).toString('base64'),localCityFlightExpansion:cityTemplateRevision};
}

/** 目的地：已采集、不是个人城市模板、出生点能塞进 byte/short 字段；缺项告警跳过。 */
export function cityFlightDestinations(official){
 const byId=new Map(official.maps.map(map=>[map.id,map])),list=[],skipped=[];
 for(const [region,ids] of cityFlightRegions)for(const id of ids){
  const map=byId.get(id),spawn=map?.spawn;
  const usable=map&&!map.cityTemplate&&Array.isArray(spawn)&&spawn.length===2&&spawn.every(value=>Number.isInteger(value)&&value>=0&&value<=127)&&id>0&&id<=32767;
  if(!usable){skipped.push(id);continue;}
  list.push({label:`【${region}】前往${map.name}`,target:id,gx:spawn[0],gy:spawn[1],mission:0,state:0});
 }
 if(skipped.length)console.warn(`[city] 飞行驿站跳过 ${skipped.length} 条未采集或坐标不可用的航线：${skipped.join('、')}`);
 return list;
}

export function applyCityFlightStations(official){
 const destinations=cityFlightDestinations(official);
 for(const map of official.maps)if(map.cityTemplate)map.npcs=map.npcs.map(npc=>expandCityFlightStation(npc,destinations));
 return official;
}

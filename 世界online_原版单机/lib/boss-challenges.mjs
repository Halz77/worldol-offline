import fs from 'node:fs';
import {Reader,Writer} from './codec.mjs';
import {cloneMonster,addGroup} from './dungeon-challenge-data.mjs';
import {GUARD_CHALLENGE_REVISION} from './guard-challenges-data.mjs';
export const bossChallenges=JSON.parse(fs.readFileSync(new URL('../data/boss-challenges-v1.json',import.meta.url),'utf8'));
export const bossChallengeRevision=bossChallenges.revision;

// Keep the recorded definitions in the bundle. Only the local challenge's
// entrance, dialogue and repeatability differ from the official quest chain.
export function applyBossChallenges(official){
 const same=(a,b)=>a.wireBase64===b.wireBase64;
 for(const table of ['monsters','groups','ai'])for(const record of bossChallenges[table]){
  const key=table==='groups'?'groupId':'id',existing=official[table].find(r=>r[key]===record[key]);
  if(existing){if(!same(existing,record))throw Error('Conflicting boss '+table+' '+record[key]);}
  else official[table].push(structuredClone(record));
 }
 for(const skill of bossChallenges.skills){
  const existing=official.skills.find(s=>s.id===skill.id&&s.level===skill.level);
  if(!existing)official.skills.push(structuredClone(skill));
  else{
   // Player/shop definitions can have additional fields or different powers.
   // The native monster block has its own exact wire definition.
   if(existing.monsterWireBase64&&existing.monsterWireBase64!==skill.wireBase64)throw Error('Conflicting monster skill '+skill.id+':'+skill.level);
   existing.monsterWireBase64=skill.wireBase64;
  }
 }
 const placement=bossChallenges.placement,map=structuredClone(bossChallenges.map),source=bossChallenges.dongNpc;
 if(official.maps.some(m=>m.id===map.id))throw Error('Boss map already supplied: '+map.id);
 const npc={...source,mapId:map.id,id:placement.npcId,x:placement.x,y:placement.y,sourceGx:placement.x,sourceGy:placement.y,
  status:3,direction:1,missionGroupID:0,localChallenge:true};
 delete npc.missionData;
 npc.wireBase64=new Writer().byte(3).byte(npc.id).byte(0).byte(0).long(npc.icon1).short(0)
  .utf(npc.name).utf('').utf('接取挑战任务，与东哥及其护卫战斗。').byte(3).byte(1).byte(npc.x).byte(npc.y).byte(0).byte(0).done().toString('base64');
 npc.talkDetail='接取挑战任务，与东哥及其护卫战斗。';map.npcs.push(npc);official.maps.push(map);
 for(const sourceQuest of bossChallenges.missions){
  if(official.missions.some(q=>q.id===sourceQuest.id))throw Error('Boss quest already supplied: '+sourceQuest.id);
  const dong=sourceQuest.id===placement.missionId;
  // MOD(plaza-boss)：非东哥任务改为尊重任务自带的 npcId（缺省仍是 1）。
  // 征战广场现在有多个挑战 NPC（霸天虎 1 / 东哥 4 / 库库尔坎 5），写死 npcId=1
  // 会让后续新增的挑战全挂到霸天虎身上，既接不到也打不了。
  const npcId=dong?placement.npcId:(sourceQuest.npcId>0?sourceQuest.npcId:1);
  const q={...structuredClone(sourceQuest),mapId:map.id,npcId,acceptMapId:map.id,acceptNpcId:npcId,
   setting:1034,type:0,series:'征战广场挑战',acceptCondition:[],localChallenge:true,
   name:dong?'挑战超级BOSS-东哥':sourceQuest.name,
   // 保留各任务自己录制到的说明文案（库库尔坎等新挑战各有自己的背景），
   // 只有东哥的剧情台词要换成单机流程说明；录不到说明时才退回旧文案。
   desc:dong?'在征战广场挑战撼地者——宇宙男神东哥及其护卫。接取任务后进入战斗，获胜后回来领取奖励，可重复挑战。':
    (sourceQuest.desc||'在征战广场挑战霸天虎及其钢铁护卫。霸天虎会释放强大的技能，合理安排封魔和队伍配合。接取任务后进入战斗，获胜后回来领取奖励，可重复挑战。'),
   dialogNotStartNotReady:'准备好后即可接取挑战。',dialogStartNotFinish:'击败目标后，再回来领取奖励。',dialogStartFinish:'挑战完成，这是你的奖励。',
   sources:[{origin:'local-boss-challenge',mapId:map.id,npcId}],recordedSources:sourceQuest.sources};
  official.missions.push(q);
 }
 return official;
}

/** 守卫挑战的来源版本号（`/api/status` 里一并报出来）。 */
export const guardChallengeRevision=GUARD_CHALLENGE_REVISION;

// ════════════════════════════════════════════════════════════════════════════
// 挑战型副本本地补完（对齐社区版 boss-challenges.mjs / dungeon-challenge-repairs.mjs）
//
// 抓包里有一批「入口、怪物、击杀目标都在，但战斗编队没采集 / 入口没有开战入口」的
// 挑战副本，表现就是任务能接、点了没反应或者直接卡住：
//   · 葬送佣兵团三个队长（2800—2803）：只有名字与击杀目标，怪与编队都没有；
//   · 堕狼魔精英挑战（2773）：提交战斗 11614 在，但入口 NPC 没录战斗菜单；
//   · 十殿阎罗（3972）：十个王的编队都在（11706 / 30001—30009），入口 NPC 36 只有
//     对话没有菜单 —— 抓包原文也写着「只要你能一个个的打败我们」；
//   · 剧情「接受即开战」的任务：接受的那刻就进战斗，打输/中断后任务还在，但入口
//     NPC 的可见条件是「还没接」→ 再也打不了；
//   · 跨服副本（9100）：抓包只录到单场（20369），社区版按五个参考编队扩成五关连战。
//
// 统一规矩：**不凭空造数值**。怪与编队一律从已采集的定义克隆，只换 id/名字/造型，
// 并打上 localReconstruction + sources（写明参考的是谁）。
//
// 关键客户端事实（模块 0074 / 0064，逐行核对过）：
//   · NPC_POWER（npcType 5）的对话里**同时**有任务列表与四段原生菜单（doMissionNpc
//     会调 addPowerNPCChoice），所以把剧情 NPC 转成 npcType 5 不会吃掉任务对话；
//   · 菜单项的 state 是位表：1=已完成 2=进行中 4=可交付 8=未接取；
//     6（2|4）=「任务进行中（含可交付）」，1 =「今天已经通过」。
// ════════════════════════════════════════════════════════════════════════════

/** 客户端菜单项 state 位表（模块 0064 MissionConst）。 */
export const MENU_STATE_ACTIVE=6;
export const MENU_STATE_CLEARED=1;

/**
 * 给一个原生 NPC 补一条「战斗菜单」项 —— npcType 0 转 5，已经是 5 就往战斗段追加。
 *
 * NPC 记录布局（客户端 0074 readNPCData / readPowerNPCData）：
 *   14 字节固定头（sign/id/missionGroupID/npcType/icon1(8 字节 long)/businessIcon）
 *   + name/welcome/talkDetail(utf) + status + 朝向/x/y/范围x/范围y
 *   + [missionData 6 字节，仅 status&8]
 *   + npcType 5 的四段菜单：传送 / 战斗 / 商店 / 导师，
 *     每段 = byte(条数) + 条目；战斗条目 = utf(菜单名) + short(组) + short(任务) + byte(state)。
 *
 * 顺带把 status 的「可见 + 可交互」两位（3）补上：入口不显示就没法点。
 */
export function appendNpcBattleMenu(npc,label,group,missionId,state=MENU_STATE_ACTIVE){
 const wire=Buffer.from(npc.wireBase64,'base64'),r=new Reader(wire);
 r.take(14);r.utf();r.utf();const talk=r.utf();
 if(talk!==(npc.talkDetail||''))throw Error('NPC '+npc.id+' 协议与记录不一致（talkDetail）');
 const statusAt=r.pos,status=wire[statusAt];
 r.take(6);
 if(status&8)r.take(6);
 const menuHeadEnd=r.pos;
 let jump=Buffer.from([0]),battle=Buffer.alloc(0),tail=Buffer.from([0,0]),battleCount=0;
 if(npc.npcType===0){
  if(menuHeadEnd!==wire.length)throw Error('NPC '+npc.id+' 协议末尾有多余字节，拒绝改');
 }else if(npc.npcType===5){
  const jumpCountAt=r.pos,jumpCount=r.byte(),jumpAt=r.pos;
  for(let i=0;i<jumpCount;i++){r.utf();r.take(7);}
  const battleCountAt=r.pos;battleCount=r.byte();const battleAt=r.pos;
  for(let i=0;i<battleCount;i++){r.utf();r.take(5);}
  const shopCountAt=r.pos,shopCount=r.byte(),shopAt=r.pos;
  for(let i=0;i<shopCount;i++){r.utf();r.take(5);}
  const teacherCountAt=r.pos,teacherCount=r.byte(),teacherAt=r.pos;
  for(let i=0;i<teacherCount;i++){r.utf();r.take(5);}
  if(r.pos!==wire.length)throw Error('NPC '+npc.id+' 菜单段解析不完整，拒绝改');
  jump=Buffer.concat([Buffer.from([jumpCount]),wire.subarray(jumpAt,battleCountAt)]);
  battle=Buffer.from(wire.subarray(battleAt,shopCountAt));
  tail=Buffer.concat([Buffer.from([shopCount]),wire.subarray(shopAt,teacherCountAt),
   Buffer.from([teacherCount]),wire.subarray(teacherAt,wire.length)]);
 }else throw Error('NPC '+npc.id+' 类型不支持追加战斗菜单：'+npc.npcType);
 const head=Buffer.from(wire);head[3]=5;head[statusAt]=status|3;
 npc.wireBase64=Buffer.concat([
  head.subarray(0,menuHeadEnd),jump,
  Buffer.from([battleCount+1]),battle,
  new Writer().utf(label).short(group).short(missionId).byte(state).done(),
  tail]).toString('base64');
 npc.npcType=5;npc.status=npc.status|3;
 npc.menuBattle=[...(npc.menuBattle||[]),label];
 npc.battleID=[...(npc.battleID||[]),group];
 npc.battleReqMissionID=[...(npc.battleReqMissionID||[]),missionId];
 npc.battleReqMissionState=[...(npc.battleReqMissionState||[]),state];
 return npc;
}

/** 新建一个「只有原生菜单」的空壳 NPC（npcType 5，四段菜单全空）。 */
function newPowerNpcWire(npc){
 return new Writer().byte(3).byte(npc.id).byte(0).byte(5).long(npc.icon1).short(0)
  .utf(npc.name).utf(npc.welcome||'').utf(npc.talkDetail||'')
  .byte(3).byte(1).byte(npc.x).byte(npc.y).byte(0).byte(0)
  .byte(0).byte(0).byte(0).byte(0).done().toString('base64');
}

/** 击杀条件（type 2）的 rawHex，与 lib/dungeon-story-repairs.mjs 同一写法。 */
export function killCondition(official,monsterId,required=1){
 const monster=official.monsters.find(m=>m.id===monsterId);
 if(!monster)throw Error('本地副本缺少击杀目标怪物：'+monsterId);
 return {type:2,typeName:'CONDITION_KILL_MONSTER',not:0,monsterId,name:monster.name,required,current:0,
  rawHex:new Writer().short(monsterId).utf(monster.name).byte(required).byte(0).done().toString('hex')};
}

// ─── ① 葬送佣兵团三个队长（2800—2803） ──────────────────────────────────────
/** 抓包里只有名字与击杀目标；战斗定义按「魔物-刑天」（200）克隆。 */
export const BURIAL_REFERENCE_MONSTER=200;
export const burialCommanders=[
 {id:2312,missionId:2800,npcId:22,name:'第五葬送队长-不死亡灵',icon:20253},
 {id:2313,missionId:2801,npcId:21,name:'第四葬送队长-哀嚎妖姬',icon:20165},
 {id:2314,missionId:2802,npcId:20,name:'第三葬送队长-暴食王',icon:20374},
];

export function applyBurialMercenaryBosses(official){
 const map=official.maps.find(m=>m.id===300),objective=official.missions.find(q=>q.id===2803);
 const reference=official.monsters.find(m=>m.id===BURIAL_REFERENCE_MONSTER);
 if(!map||!objective||!reference)throw Error('葬送佣兵团缺少地图 300 / 目标 2803 / 参考怪 200');
 for(const entry of burialCommanders){
  const npc=map.npcs.find(n=>n.id===entry.npcId),quest=official.missions.find(q=>q.id===entry.missionId);
  const condition=(objective.submitCondition||[]).find(c=>c.type===2&&c.monsterId===entry.id);
  if(!npc||!quest||!condition)throw Error('葬送佣兵团队长缺少入口或击杀目标：'+entry.id);
  const sources=[{origin:'local-burial-commanders-xingtian',mapId:map.id,npcId:npc.id,referenceMonsterId:BURIAL_REFERENCE_MONSTER}];
  cloneMonster(official,BURIAL_REFERENCE_MONSTER,entry.id,entry.name,sources,{icon1:entry.icon});
  addGroup(official,sources,{groupId:entry.id,monsters:[0,0,entry.id,0,0,0,0,0,0,0]});
  appendNpcBattleMenu(npc,'挑战'+npc.name,entry.id,objective.id,MENU_STATE_ACTIVE);
  quest.recordedDescription=quest.desc;
  quest.desc='挑战葬送佣兵团的'+npc.name+'。队长的战斗强度以魔物-刑天为基准；获胜后返回交付，击杀也会计入「'+objective.name+'」。';
  quest.setting|=1024;
  quest.acceptBattleID=entry.id;
  quest.submitCondition=[structuredClone(condition)];
  quest.series='葬送佣兵团';
  quest.localReconstruction=true;
 }
 return {commanders:burialCommanders.map(e=>e.id)};
}

// ─── ② 堕狼魔精英挑战（2773）的「再次挑战」入口 ──────────────────────────────
/**
 * 入口 NPC「堕狼魔」（293:0）在抓包里只有对话。它的可见条件是「2772 进行中」，
 * 菜单项 state=1（今天已通过）→ 通关后可以原地再战，与抓包文案
 * 「你每天只有一次机会挑战堕狼魔」一致。
 */
export function applyMoonDemonChallenge(official){
 const npc=official.maps.find(m=>m.id===293)?.npcs.find(n=>n.id===0);
 const challenge=official.missions.find(q=>q.id===2773);
 if(!npc||!challenge||challenge.submitBattleID!==11614)throw Error('堕狼魔缺少已录任务 2773 或提交战斗 11614');
 appendNpcBattleMenu(npc,'再次挑战堕狼魔',challenge.submitBattleID,challenge.id,MENU_STATE_CLEARED);
 if(!challenge.localReconstruction){
  challenge.recordedDescription=challenge.desc;
  challenge.simpleDesc='完成挑战入口任务后立刻开战；战斗中断或失败时可再次与堕狼魔交谈，直到完成驱逐任务。';
  challenge.desc=challenge.desc.replace(/（你每天只有一次机会挑战堕狼魔[^）]*）/g,'')
   +'\n【单机】完成挑战入口任务后，战斗中断或失败可再次与堕狼魔交谈重试；通关后菜单里还会留一条「再次挑战」。';
  challenge.localReconstruction=true;
 }
 return {npc:npc.mapId+':'+npc.id,group:challenge.submitBattleID};
}

// ─── ③ 十殿阎罗（3972）：给入口补十殿菜单 ──────────────────────────────────
export const TEN_KINGS=['秦广王','楚江王','宋帝王','五官王','阎罗王','卞城王','泰山王','都市王','平等王','转轮王'];
export const TEN_KINGS_GROUPS=[11706,30001,30002,30003,30004,30005,30006,30007,30008,30009];
const TEN_KING_LABELS=['一','二','三','四','五','六','七','八','九','十'];

export function applyTenKingsChallengeStages(official){
 const npc=official.maps.find(m=>m.id===959)?.npcs.find(n=>n.id===36);
 const quest=official.missions.find(q=>q.id===3972);
 if(!npc||!quest)throw Error('十殿阎罗缺少入口 NPC 或任务 3972');
 for(const [index,group] of TEN_KINGS_GROUPS.entries()){
  if(!official.groups.some(g=>g.groupId===group))throw Error('十殿阎罗缺少 '+TEN_KINGS[index]+' 的编队 '+group);
  appendNpcBattleMenu(npc,'第'+TEN_KING_LABELS[index]+'殿·'+TEN_KINGS[index],group,quest.id,MENU_STATE_ACTIVE);
 }
 if(!quest.localReconstruction){
  quest.recordedDescription=quest.desc;
  quest.desc=quest.desc.replace(/\n【单机】[^]*$/,'')
   +'\n【单机】入口处按「第几殿」逐殿挑战：十位阎王的编队都是抓包原样（一殿一场，难度不改）。';
  quest.localReconstruction=true;
 }
 return {npc:npc.mapId+':'+npc.id,groups:TEN_KINGS_GROUPS.slice()};
}

// ─── ④ 剧情「接受即开战」的重试入口 ────────────────────────────────────────
/**
 * 判定条件与社区版一致，逐条核对过本工程的数据：任务的 acceptBattleID 编队里必须有
 * 它自己的击杀目标，入口 NPC 是 npcType 0 且 missionData 正好盯着这个任务
 * （missionData[2]===任务号、missionData[3]&6）。命中后把 NPC 的可见位收敛成
 * 「只在任务已通过时才隐藏」（&1），并补一条 state=2（任务进行中）的重试菜单项。
 */
export function applyDungeonStoryBattleRetries(official){
 const applied=[];
 const retry=(npc,mission,group)=>{
  appendNpcBattleMenu(npc,'再次挑战'+(npc.name||mission.name),group,mission.id,2);
  const wire=Buffer.from(npc.wireBase64,'base64'),r=new Reader(wire);
  r.take(14);r.utf();r.utf();r.utf();const statusAt=r.pos,status=wire[statusAt];r.take(6);
  if(!(status&8))throw Error('剧情重试 NPC '+npc.id+' 缺少任务显示条件');
  const missionDataAt=statusAt+6;
  if(wire[missionDataAt+5]!==npc.missionData[3])throw Error('剧情重试 NPC '+npc.id+' 可见位与记录不一致');
  npc.missionData[3]&=1;
  wire[missionDataAt+5]=npc.missionData[3];
  npc.wireBase64=Buffer.from(wire).toString('base64');
 };
 for(const q of official.missions){
  if(!(q.acceptBattleID>0)||!q.submitCondition?.some(c=>c.type===2&&!c.not))continue;
  const group=official.groups.find(g=>g.groupId===q.acceptBattleID);
  if(!group||!q.submitCondition.filter(c=>c.type===2&&!c.not).every(c=>group.monsters.includes(c.monsterId)))continue;
  for(const source of q.sources||[]){
   const npc=official.maps.find(m=>m.id===source.mapId)?.npcs.find(n=>n.id===source.npcId);
   if(npc?.npcType!==0||npc.missionData?.[2]!==q.id||!(npc.missionData[3]&6))continue;
   // 同一个 NPC 在 q.sources 里出现多次（同一处多次录制）时只补一条。
   if(applied.some(row=>row.missionId===q.id&&row.mapId===source.mapId&&row.npcId===source.npcId))continue;
   retry(npc,q,q.acceptBattleID);
   applied.push({missionId:q.id,name:q.name,mapId:source.mapId,npcId:source.npcId});
  }
 }
 // 已录的 boss NPC（861:4）原本就带一段战斗菜单：保留原段，另加一条 3194 的重试。
 const npc=official.maps.find(m=>m.id===861)?.npcs.find(n=>n.id===4);
 const quest=official.missions.find(q=>q.id===3194);
 const group=official.groups.find(g=>g.groupId===quest?.acceptBattleID);
 const kills=(quest?.submitCondition||[]).filter(c=>c.type===2&&!c.not);
 if(npc&&quest&&group&&npc.npcType===5&&npc.missionData?.[2]===quest.id
  &&kills.length&&kills.every(c=>group.monsters.includes(c.monsterId))){
  retry(npc,quest,quest.acceptBattleID);
  applied.push({missionId:quest.id,name:quest.name,mapId:861,npcId:4});
 }
 return applied;
}

// ─── ⑤ 跨服副本·单机合作（五关连战） ───────────────────────────────────────
/** 抓包的 9100 已被「征战广场·挑战克罗斯」占用，本地扩的这版用 9176。 */
export const COOP_DUNGEON_MISSION=9176;
export const COOP_DUNGEON_MAP=824;
export const COOP_DUNGEON_NPC=112;
export const COOP_DUNGEON_STAGES=[
 {label:'第一关·巨石神兵',referenceGroup:30150,boss:3315},
 {label:'第二关·魔物-刑天',referenceGroup:213,boss:200},
 {label:'第三关·千年魔牛',referenceGroup:11681,boss:3239},
 {label:'第四关·被附魔的晴菜',referenceGroup:11764,boss:4116},
 {label:'第五关·古龙-多拉斯',referenceGroup:30152,boss:3314},
];
const COOP_TALK='单机合作副本：连续挑战五关（巨石神兵、刑天、千年魔牛、晴菜、古龙），全部击败后回来交付。';

/**
 * 克隆参考编队：整队每只怪各克隆一次（同 id 复用），保留原编队槽位与阵型。
 * @returns {{groupId:number,boss:number,monsters:number[]}}
 */
function cloneCoopGroup(official,stage,groupId,allocate){
 const reference=official.groups.find(g=>g.groupId===stage.referenceGroup);
 if(!reference)throw Error('跨服副本缺少参考编队 '+stage.referenceGroup);
 const sources=[{origin:'local-coop-dungeon-five-stages',referenceGroupId:stage.referenceGroup}];
 const map=new Map();
 for(const ref of reference.monsters.filter(id=>id>0)){
  if(map.has(ref))continue;
  const monster=official.monsters.find(m=>m.id===ref);
  if(!monster)throw Error('跨服副本参考编队 '+stage.referenceGroup+' 引用了未知怪 '+ref);
  const id=allocate();
  cloneMonster(official,ref,id,monster.name,sources,{referenceGroupId:stage.referenceGroup});
  map.set(ref,id);
 }
 const slots=reference.monsters.map(id=>id>0?map.get(id):0);
 addGroup(official,sources,{groupId,monsters:slots,npcs:reference.npcs||[],
  coefficient:reference.coefficient||0,slotCount:reference.monsters.length});
 const boss=map.get(stage.boss);
 if(!boss)throw Error('跨服副本参考编队 '+stage.referenceGroup+' 里没有目标怪 '+stage.boss);
 return {groupId,boss,monsters:[...new Set(slots.filter(Boolean))]};
}

export function applyCooperativeDungeon(official){
 const map=official.maps.find(m=>m.id===COOP_DUNGEON_MAP);
 if(!map)throw Error('跨服副本缺少地图 '+COOP_DUNGEON_MAP);
 if(map.npcs.some(n=>n.id===COOP_DUNGEON_NPC))throw Error('跨服副本入口编号冲突：'+COOP_DUNGEON_NPC);
 if(official.missions.some(q=>q.id===COOP_DUNGEON_MISSION))throw Error('跨服副本任务编号冲突：'+COOP_DUNGEON_MISSION);
 let nextMonster=30200;
 const allocate=()=>{
  while(official.monsters.some(m=>m.id===nextMonster)||official.groups.some(g=>g.groupId===nextMonster)
   ||official.ai.some(a=>a.id===nextMonster))nextMonster++;
  return nextMonster++;
 };
 const sources=[{origin:'local-coop-dungeon-five-stages',mapId:map.id,npcId:COOP_DUNGEON_NPC}];
 const npc={mapId:map.id,sign:3,id:COOP_DUNGEON_NPC,missionGroupID:0,npcType:5,icon1:'628',businessIcon:0,
  name:'跨服副本·单机合作',welcome:'',talkDetail:COOP_TALK,status:3,direction:1,x:16,y:13,
  sourceGx:16,sourceGy:13,rangeX:0,rangeY:0,sources};
 npc.wireBase64=newPowerNpcWire(npc);
 map.npcs.push(npc);
 const stages=COOP_DUNGEON_STAGES.map((stage,index)=>{
  const row={...cloneCoopGroup(official,stage,30160+index,allocate),...stage};
  appendNpcBattleMenu(npc,stage.label,row.groupId,COOP_DUNGEON_MISSION,MENU_STATE_ACTIVE);
  return row;
 });
 const quest={id:COOP_DUNGEON_MISSION,name:'跨服副本·单机合作',level:90,simpleDesc:COOP_TALK,desc:COOP_TALK,
  setting:1034,mapId:map.id,npcId:npc.id,radarMapID:0,
  dialogNotStartNotReady:'接取后从第一关开始，五关全部击败后回来交付。',
  dialogStartNotFinish:'还有关卡没有通过，回到入口继续挑战。',dialogStartFinish:'五关全通，这是给你的奖励。',
  exp:0,money2:0,money3:0,honor:0,countryLand:0,countryProsperity:0,countryPeople:0,countryWood:0,
  countryStone:0,countryIron:0,cityArmy:0,cityProsperity:0,promoteProsperity:0,
  rewardItems:[],selectItems:[],
  acceptCondition:[],submitCondition:stages.map(s=>killCondition(official,s.boss,1)),
  type:0,series:'单机合作副本',acceptMapId:map.id,acceptNpcId:npc.id,canAccept:1,_isHelp:false,
  acceptJumpMapID:0,submitJumpMapID:0,acceptBattleID:stages[0].groupId,submitBattleID:0,
  submitNextMissionID:0,localReconstruction:true,sources};
 official.missions.push(quest);
 return {mission:quest.id,npc:map.id+':'+npc.id,
  stages:stages.map(s=>({label:s.label,group:s.groupId,boss:s.boss,monsters:s.monsters}))};
}

/**
 * 挂到 `official-data.ensure()`（必须在建索引之前、且在 applyDungeonChallengeRepairs /
 * applyBossTournament 之后 —— 跨服副本要克隆 30150/30152，十殿阎罗要十王的编队）。
 */
export function applyBossChallengeRepairs(official){
 return {
  burial:applyBurialMercenaryBosses(official),
  moon:applyMoonDemonChallenge(official),
  tenKings:applyTenKingsChallengeStages(official),
  retries:applyDungeonStoryBattleRetries(official),
  coop:applyCooperativeDungeon(official),
 };
}

/** 本模块补完部分的版本号（挂在 /api/status 上，便于上机核对是否加载了新代码）。 */
export const bossChallengeRepairsRevision='local-challenge-dungeons-v1+'+burialCommanders.length+'burial+'+TEN_KINGS.length+'kings+'+COOP_DUNGEON_STAGES.length+'coop';

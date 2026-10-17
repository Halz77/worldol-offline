import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Reader,Writer} from '../lib/codec.mjs';
import {official,officialGroups} from '../lib/official-data.mjs';
import {battleSupported} from '../lib/official-rules.mjs';
import {SOLAR_MAP_ID,TEAM_DUNGEON_MISSION,SOLAR_EVENTS,SOLAR_ROUTE_EVENT,solarChallengeEventGroup,solarGroupMission,solarGroupIds,solarReady,SOLAR_PROFILES} from '../lib/solar-challenge-data.mjs';
import {handleSolarChallenge,settleSolarBattle,pendingSolarGroup,solarMissionOfGroup} from '../lib/solar-challenge-service.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hasData=fs.existsSync(path.join(root,'data','solar-challenge-monsters.json'));
const skip={skip:hasData?false:'没有 data/solar-challenge-monsters.json，跳过'};
/** 棋盘协议段认领的类型（14502/14503/14504 归任务段）。 */
const SOLAR_TYPES=[14508,14509,14510,14511,14514];

function role(mission=TEAM_DUNGEON_MISSION){
 return {id:1,mapId:SOLAR_MAP_ID,x:18,y:16,gold:0,silver:0,coins:0,hp:1000,mp:500,level:90,
  battles:{wins:0,losses:0,kills:{},cooldowns:{}},inventory:[],
  quests:{active:{[mission]:{origin:{mapId:SOLAR_MAP_ID,npcId:1},counts:{}}},completed:[]}};
}
function env(){
 const sent=[];return {sent,send:(type,body)=>sent.push({type,bytes:body?.done?body.done():body}),store:{save(){}}};
}
const lastSent=s=>s.at(-1);

test('英雄挑战赛：抓包怪物与编队全部注册，7 个赛程的事件组都齐',skip,()=>{
 assert.equal(solarReady(),true);
 const groups=solarGroupIds();
 assert.equal(groups.length,76,'60 个按赛制克隆的编队 + 16 个抓包原编队');
 for(const g of groups)assert.ok(officialGroups.has(g),`编队 ${g} 没进 officialGroups`);
 for(const g of groups)assert.equal(battleSupported(g),true,`编队 ${g} 的怪物数据不完整`);
 for(const profile of SOLAR_PROFILES){
  for(const event of SOLAR_EVENTS){
   const group=solarChallengeEventGroup(profile.mission,event);
   assert.ok(group>0,`任务 ${profile.mission} 的事件 ${event} 没有编队`);
   assert.equal(solarGroupMission(group),profile.mission,`编队 ${group} 应归属任务 ${profile.mission}`);
  }
 }
});

test('英雄挑战赛：编队一律 20 槽 + flag 3（照社区版，少了就是「站位不对」）',skip,()=>{
 // 社区版 team-dungeon-data.mjs 的 groupWire 写死 byte(3) 并补到 20 个 short，
 // 不随怪物多少变化。我们以前按怪物数算 flag：7 只怪走 10 槽 → 客户端按另一种
 // 阵型排布，玩家看到的就是「站位不对」（第 67 版实测）。
 const dist={};
 for(const id of solarGroupIds()){
  const g=officialGroups.get(id);
  const key='flag'+g.flag+'/槽'+(g.monsters||[]).length;
  dist[key]=(dist[key]||0)+1;
 }
 assert.deepEqual(dist,{'flag3/槽20':solarGroupIds().length},'所有赛程编队都必须是 flag 3 + 20 槽');
 // wire 与 flag 自洽：客户端按 flag&1 决定读 20 还是 10 个 short，对不上就整包解析错。
 // 头部 10 字节 = short(组) + byte(类型) + short(下一组) + byte(flag) + int32(系数)。
 for(const id of solarGroupIds()){
  const g=officialGroups.get(id),bytes=Buffer.from(g.wireBase64,'base64');
  const slots=bytes.readUInt8(5)&1?20:10;
  assert.equal((g.monsters||[]).length,slots,`编队 ${id} 的槽位数与 flag 不一致`);
  assert.equal(bytes.length,10+slots*2+((bytes.readUInt8(5)&2)?8:0),`编队 ${id} 的 wire 长度不对`);
 }
});

test('14508 开棋盘：回包带三币种与 13 个格子，进度能从存档恢复',skip,()=>{
 const {sent,send,store}=env(),p=role(),context={role:p};
 assert.equal(handleSolarChallenge(14508,new Reader(Buffer.alloc(0)),context,{send,store}),true);
 const bytes=lastSent(sent).bytes;
 assert.ok(bytes.length>100,'棋盘包要有内容');
 assert.equal(bytes.readInt32BE(0),0,'金');assert.equal(bytes.readInt32BE(4),0,'银');assert.equal(bytes.readInt32BE(8),0,'铜');
 assert.equal(context.solar.board.pos,0,'从起点开始');
 assert.deepEqual([...context.solar.board.passed],[0]);
 // 进度写进了存档，重开（新的 context）能接着走
 const saved=p.quests.active[TEAM_DUNGEON_MISSION].solarBoard;
 assert.ok(saved,'棋盘进度要落在任务存档上');
 const next={role:p};
 assert.equal(handleSolarChallenge(14508,new Reader(Buffer.alloc(0)),next,{send,store}),true);
 assert.equal(next.solar.board.pos,0);
});

test('14510 移动：只能走相邻格，当前格没打过不许走',skip,()=>{
 const {sent,send,store}=env(),p=role(),context={role:p};
 handleSolarChallenge(14508,new Reader(Buffer.alloc(0)),context,{send,store});
 // 起点 0 只连着 1
 assert.equal(handleSolarChallenge(14510,new Reader(new Writer().byte(1).byte(0).done()),context,{send,store}),true);
 assert.equal(context.solar.board.pos,1);
 // 1 号格有事件（600），没通过 → 不许继续走
 p.quests.active[TEAM_DUNGEON_MISSION].solarBoard.pos=1;
 context.solar.board.pos=1;
 assert.throws(()=>handleSolarChallenge(14510,new Reader(new Writer().byte(2).byte(0).done()),context,{send,store}),/请先完成当前格子的挑战/);
 assert.equal(context.solar.board.pos,1,'失败要回滚，不能偷偷挪位');
});

test('14514 选对手：回编队号，打过之后不再给；没到那格或打完都不放行',skip,()=>{
 const {sent,send,store}=env(),p=role(),context={role:p};
 handleSolarChallenge(14508,new Reader(Buffer.alloc(0)),context,{send,store});
 context.solar.board.pos=1;
 const event=SOLAR_ROUTE_EVENT.get(1);
 assert.equal(handleSolarChallenge(14514,new Reader(new Writer().short(event).done()),context,{send,store}),true);
 const group=lastSent(sent).bytes.readUInt16BE(1);
 assert.equal(group,solarChallengeEventGroup(TEAM_DUNGEON_MISSION,event),'回包里要带上编队号');
 assert.equal(pendingSolarGroup(context),group,'记进 pending，12501 据此跳过距离校验');
 assert.equal(solarMissionOfGroup(group),TEAM_DUNGEON_MISSION);
 // 通过之后这一格不再给战斗
 context.solar.board.passed.add(1);
 assert.throws(()=>handleSolarChallenge(14514,new Reader(new Writer().short(event).done()),context,{send,store}),/这一格的挑战已经通过了/);
});

test('战斗胜利记「这一格已通过」，打完终点格的龙才算赛程完成',skip,()=>{
 const {sent,send,store}=env(),p=role(),context={role:p};
 handleSolarChallenge(14508,new Reader(Buffer.alloc(0)),context,{send,store});
 context.solar.board.pos=1;
 const group=solarChallengeEventGroup(TEAM_DUNGEON_MISSION,SOLAR_ROUTE_EVENT.get(1));
 const boardReply=settleSolarBattle(context,p,group);
 assert.equal(boardReply.type,14508,"打赢要回一个待补发的棋盘包");
 assert.ok(context.solar.board.passed.has(1),'打赢要记通过');
 assert.equal(context.solar.completed,false,'中间格不算完成');
 // 终点 10 号（事件 619 = 龙）
 context.solar.board.pos=10;
 settleSolarBattle(context,p,solarChallengeEventGroup(TEAM_DUNGEON_MISSION,619));
 assert.equal(context.solar.completed,true,'打完龙才算赛程完成');
 assert.ok(p.quests.active[TEAM_DUNGEON_MISSION].solarBoard.completed,'完成状态要落存档');
});

test('14511：没完成走刷新，完成 + 站在交付点才结束赛程',skip,()=>{
 const {sent,send,store}=env(),p=role(),context={role:p};
 handleSolarChallenge(14508,new Reader(Buffer.alloc(0)),context,{send,store});
 assert.equal(handleSolarChallenge(14511,new Reader(new Writer().short(0).done()),context,{send,store}),true);
 assert.ok(context.solar,'没完成时只是刷新，棋盘还在');
 context.solar.completed=true;context.solar.board.pos=100;
 assert.equal(handleSolarChallenge(14511,new Reader(new Writer().short(0).done()),context,{send,store}),true);
 assert.equal(context.solar,null,'结束赛程后清掉棋盘状态');
 assert.ok(lastSent(sent).bytes.length>20);
});

test('14509 离开：清棋盘但保留进度；战斗中不许离开',skip,()=>{
 const {sent,send,store}=env(),p=role(),context={role:p};
 handleSolarChallenge(14508,new Reader(Buffer.alloc(0)),context,{send,store});
 context.solar.board.pos=2;context.solar.board.passed.add(2);
 context.battle={group:1};
 assert.throws(()=>handleSolarChallenge(14509,new Reader(Buffer.alloc(0)),context,{send,store}),/请先结束当前战斗/);
 context.battle=null;
 assert.equal(handleSolarChallenge(14509,new Reader(Buffer.alloc(0)),context,{send,store}),true);
 assert.equal(context.solar,null);
 assert.equal(p.quests.active[TEAM_DUNGEON_MISSION].solarBoard.pos,2,'进度要留在存档里');
});

test('重进游戏后（context.solar 为空）能从存档恢复棋盘，14514/14510 不再静默失败',skip,()=>{
 // 根因（第 67 版玩家实测）：context.solar 只活在会话内存，重进游戏就没了。
 // 而棋盘进度在存档里（p.quests.active[任务].solarBoard）。以前 context.solar 为空时
 // 14514/14510 直接 return false → 客户端等不到回包 → 点开始挑战没反应、走格动不了。
 const {sent,send,store}=env();
 const p=role(TEAM_DUNGEON_MISSION);
 // 造一个「存档里有棋盘、但会话里没有」的状态 —— 模拟重进游戏。
 p.quests.active[TEAM_DUNGEON_MISSION].solarBoard={mission:TEAM_DUNGEON_MISSION,pos:1,passed:[0],powers:[],completed:false};
 const context={role:p}; // 注意：没有 context.solar
 const event=SOLAR_ROUTE_EVENT.get(1);
 assert.equal(handleSolarChallenge(14514,new Reader(new Writer().short(event).done()),context,{send,store}),true);
 assert.ok(context.solar,'要能从存档把棋盘接回来');
 assert.equal(pendingSolarGroup(context),solarChallengeEventGroup(TEAM_DUNGEON_MISSION,event),'回包要带编队号');
 assert.equal(context.solar.board.pos,1,'进度接回来（不是从 0 重新开始）');
 assert.deepEqual([...context.solar.board.passed],[0]);
 // 走格也能恢复
 const {sent:s2,send:snd2,store:st2}=env();
 const p2=role(TEAM_DUNGEON_MISSION);
 p2.quests.active[TEAM_DUNGEON_MISSION].solarBoard={mission:TEAM_DUNGEON_MISSION,pos:1,passed:[0,1],powers:[],completed:false};
 const ctx2={role:p2};
 assert.equal(handleSolarChallenge(14510,new Reader(new Writer().byte(2).byte(0).done()),ctx2,{send:snd2,store:st2}),true);
 assert.equal(ctx2.solar.board.pos,2,'格子 1 已通过，能直接走到 2');
});

test('不在太阳神殿 / 没有赛程时这一段不认领包',()=>{
 const {sent,send,store}=env(),p=role();
 p.mapId=19; // 新月繁华之都
 const context={role:p};
 assert.equal(handleSolarChallenge(14508,new Reader(Buffer.alloc(0)),context,{send,store}),false);
 assert.equal(sent.length,0);
});

test('英雄挑战赛：没走完棋盘就不算完成，不能一接任务就交付',skip,async()=>{
 const {officialComplete}=await import('../lib/official-rules.mjs');
 const {officialMissions}=await import('../lib/official-data.mjs');
 const q=officialMissions.get(TEAM_DUNGEON_MISSION);
 // 抓包里这些任务的 submitCondition 是空的（CONDITION_NONE），不设门就等于「一接就能交付」。
 assert.deepEqual(q.submitCondition.map(c=>c.type),[0,0,0],'前提：提交条件确实是空的');
 const active={quests:{active:{[TEAM_DUNGEON_MISSION]:{}},completed:[]}};
 assert.equal(officialComplete(active,q),false,'没走完棋盘必须判未完成');
 const done={quests:{active:{[TEAM_DUNGEON_MISSION]:{solarDone:true}},completed:[]}};
 assert.equal(officialComplete(done,q),true,'走到交付格（solarDone）才放行交付');
});

test('端到端：三个组别都能报名进棋盘，走完路线打完事件才许交付',skip,async()=>{
 const {handleOfficial}=await import('../lib/official-service.mjs');
 const {maps}=await import('../lib/content.mjs');
 const {officialMissions}=await import('../lib/official-data.mjs');
 const {availableChoices}=await import('../lib/official-rules.mjs');
 // 这三个任务都要「选一个奖励」，随便传 0 会被拒。
 const choiceOf=mission=>{const list=availableChoices(officialMissions.get(mission));return list.length?list[0].id:0;};
 const npcAt=id=>maps[SOLAR_MAP_ID].npcs.find(n=>n.id===id);
 const fresh=(mission,npcId)=>{const n=npcAt(npcId);return {id:7,mapId:SOLAR_MAP_ID,x:n.x,y:n.y,
  gold:1000,silver:50,coins:300000,hp:9999,mp:9999,level:90,
  battles:{wins:0,losses:0,kills:{},cooldowns:{}},inventory:[],quests:{active:{},completed:[]}};};
 function box(p){
  const sent=[],context={role:p};
  const env={store:{save(){}},send:(type,body)=>sent.push({type,bytes:body?.done?body.done():body}),log(){}};
  // 14508-14511/14514 走棋盘段，14502/14503/14504 走任务段（和 protocol-dispatch 的顺序一致）。
  const call=(type,bytes)=>SOLAR_TYPES.includes(type)
   ?handleSolarChallenge(type,new Reader(bytes),context,env)
   :handleOfficial(type,new Reader(bytes),context,env);
  return {sent,context,send:env.send,call};
 }
 // 回包首字节：0 = 成功，-1 = 被拒（带文案）
 const replyError=(h,type)=>{const row=h.sent.filter(x=>x.type===type).at(-1);if(!row)return null;
  const r=new Reader(row.bytes);return r.byte()===-1?r.string():null;};
 const accept=(h,npcId,mission)=>h.call(14502,new Writer().short(npcId).short(mission).done());
 const deliver=(h,npcId,mission)=>h.call(14503,new Writer().short(npcId).short(mission).int(choiceOf(mission)).done());

 // ① 三个组别（初级 / 高级 / 团队混战）都要能报名，并且接完服务端必须把棋盘推下来。
 for(const [mission,npcId] of [[2592,2],[2593,0],[2594,3]]){
  const p=fresh(mission,npcId),h=box(p);
  accept(h,npcId,mission);
  assert.equal(replyError(h,14502),null,`${mission} 报名不该被拒`);
  assert.ok(p.quests.active[mission],`${mission} 要接得上`);
  assert.ok(h.sent.some(x=>x.type===14508),`${mission} 接完必须由服务端推 14508 棋盘 —— 少了这一步玩家根本进不去`);
  assert.ok(h.context.solar,`${mission} 的棋盘上下文要建起来`);
  assert.equal(h.context.solar.board.pos,0,'从起点格开始');
 }

 // ② 报名费：团队混战收 5 白银 + 30000 铜币，钱不够要拒，且不能把任务留下。
 const poor=fresh(2594,3);poor.silver=0;poor.coins=0;
 const poorBox=box(poor);
 accept(poorBox,3,2594);
 assert.match(replyError(poorBox,14502)||'',/报名费不足/);
 assert.equal(poor.quests.active[2594],undefined,'被拒就不能留下任务');

 // ③ 完整走一遭（初级组，免费）：走主线 → 每格打事件 → 终点龙 → 交付点。
 const p=fresh(2592,2),h=box(p);
 accept(h,2,2592);
 // 棋盘开着不许交付
 deliver(h,2,2592);
 assert.match(replyError(h,14503)||'',/请先结束棋盘挑战/);
 // 离开棋盘后，没走完照样不许交付 —— submitCondition 是空的，全靠 solarDone 拦着
 h.call(14509,Buffer.alloc(0));
 assert.equal(h.context.solar,null,'14509 要清掉棋盘');
 deliver(h,2,2592);
 assert.match(replyError(h,14503)||'',/请先完成条件/,'没走完棋盘不能交付（一接就完成的 bug）');
 // 再找报名点一次：任务已在身上，应该只是重开棋盘，不重复收钱
 const goldBefore=p.gold;
 accept(h,2,2592);
 assert.equal(replyError(h,14502),null,'任务在身上时再点报名要放行（重开棋盘）');
 assert.ok(h.context.solar,'要能把棋盘重开');
 assert.equal(p.gold,goldBefore,'重开棋盘不重复扣钱');
 const MAIN_PATH=[1,2,4,5,6,7,8,9,10,100];
 for(const target of MAIN_PATH){
  const board=h.context.solar.board;
  const event=SOLAR_ROUTE_EVENT.get(board.pos);
  if(event&&!board.passed.has(board.pos)){
   h.call(14514,new Writer().short(event).done());
   const group=pendingSolarGroup(h.context);
   assert.ok(group>0,`${board.pos} 号格要给出编队号`);
   assert.equal(solarMissionOfGroup(group),2592,'编队要归属这一场');
   const boardReply=settleSolarBattle(h.context,p,group); // 打赢
   assert.equal(boardReply.type,14508,"打赢要回一个待补发的棋盘包");
  }
  h.call(14510,new Writer().byte(target).byte(0).done());
  assert.equal(replyError(h,14510),null,`走向 ${target} 号格不该被拒`);
 }
 assert.equal(h.context.solar.board.pos,100,'要能走到交付点');
 assert.ok(p.quests.active[2592].solarDone,'走到交付格才置 solarDone');
 assert.equal(p.quests.active[2592].solarBoard.completed,true,'终点龙打完赛程才算完成');
 // 棋盘还开着（没走 14511 结束）不许交付
 deliver(h,2,2592);
 assert.match(replyError(h,14503)||'',/请先结束棋盘挑战/);
 // 结束棋盘 → 交付
 h.call(14511,new Writer().short(0).done());
 assert.equal(h.context.solar,null,'结束赛程后清掉棋盘');
 deliver(h,2,2592);
 assert.equal(replyError(h,14503),null,'走完棋盘应该能交付');
 assert.ok(p.quests.completed.includes(2592),'交付后进完成表');

 // ④ 放弃任务要连棋盘上下文一起清掉
 const q=fresh(2593,0),h2=box(q);
 accept(h2,0,2593);
 assert.ok(h2.context.solar);
 // 14504 的包体只有任务号（没有 npcId，见 official-service 的 npcId=type===14504?null:r.short()）
 h2.call(14504,new Writer().short(2593).done());
 assert.equal(q.quests.active[2593],undefined);
 assert.equal(h2.context.solar,null,'放弃赛程要清掉棋盘，别让下一场战斗还认它');
});

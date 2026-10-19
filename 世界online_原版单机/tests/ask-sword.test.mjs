import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SaveStore} from '../lib/store.mjs';
import {Writer,Reader} from '../lib/codec.mjs';
import {official,officialMissions,officialMonsters,officialGroups,officialItems} from '../lib/official-data.mjs';
import {battleSupported,missionBlockers,missionRewards,officialCanAccept,officialComplete,isBoardMission} from '../lib/official-rules.mjs';
import {maps,hpMax,mpMax} from '../lib/content.mjs';
import {handleOfficial} from '../lib/official-service.mjs';
import {handleGame,BATTLE_TRAILER} from '../lib/game-service.mjs';
import {
 ASK_SWORD_MAP_ID,ASK_SWORD_NPC_ID,ASK_SWORD_POINTS,ASK_SWORD_XY,ASK_SWORD_PEAKS,ASK_SWORD_TIERS,
 ASK_SWORD_FINAL_CELL,ASK_SWORD_DELIVERY_CELL,askSwordConnections,askSwordEventOfCell,askSwordEventGroup,
 askSwordMissionOfGroup,isAskSwordMission,applyAskSword,
} from '../lib/ask-sword-data.mjs';
import {handleSolarChallenge,settleSolarBattle,pendingSolarGroup,boardMissionOfGroup} from '../lib/solar-challenge-service.mjs';
import {missionsAt,officialSign} from '../lib/official-rules.mjs';

/**
 * 问剑十一峰（风雪之城 map 37 / NPC 11「封印守卫者」，任务 2604 / 2650 / 2651）。
 *
 * 客户端里没有任何「问剑」文本 → 这是本地重建的玩法（对比报告里对方那两个模块的
 * 解包产物早已删除），做法是复用客户端自带的棋盘界面（14508 那套，见
 * lib/solar-challenge-service.mjs 的第三份 host）。所以这里钉六件事：
 *   ① 三档任务都在 NPC 11 上、奖励道具都有定义、都是棋盘任务（必须走完才能交）；
 *   ② 33 个单挑编队齐全（十一峰 × 三档），系数就是 100 / 170 / 260；
 *   ③ 十三格棋盘：0 → 1..11 → 100 的线性山道，坐标对得上、没有 powers；
 *   ④ 不在风雪之城 / 没接任务时，棋盘段绝不认领（否则一站进城镇就弹棋盘）；
 *   ⑤ 十一峰逐峰走：跳过未通过的格子会被拒；走完最后一峰 + 走到 100 才置 solarDone；
 *   ⑥ 端到端：接任务 → 14514 拿编队 → 12501 开打（跳过距离校验）→ 12502 记这一峰。
 */
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 真实存盘 + 真实角色：棋盘/战斗都要跑 store.save()，用假 store 容易漏掉存档字段。 */
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-ask-sword-'));
 t.after(()=>{const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-ask-sword-'));fs.rmSync(exact,{recursive:true,force:true});});
 const store=new SaveStore(dir),account=store.account('问剑十一峰验收'),p=store.create(account,{name:'问剑验收',sex:1,race:0,job:1,icon1:'2240667',icon2:'0',icon3:'0'});
 Object.assign(p,{level:95,mapId:ASK_SWORD_MAP_ID,x:12,y:10,gold:0,silver:200,coins:1000000,quests:{active:{},completed:[]}});
 p.hp=hpMax(p);p.mp=mpMax(p);store.save();
 const sent=[],context={role:p,account};
 const env={store,send(type,w){sent.push({type,bytes:w instanceof Writer?w.done():Buffer.from(w)});},log(){}};
 const call=(type,bytes)=>{const r=new Reader(bytes);
  assert.ok(handleSolarChallenge(type,r,context,env)||handleOfficial(type,r,context,env)||handleGame(type,r,context,env),`协议 ${type} 必须有人认领`);
  return new Reader(sent.filter(x=>x.type===type).at(-1).bytes);};
 return {store,p,context,call,sent};
}
/** 回包首字节：0 = 成功，-1 = 被拒（带文案）。 */
function replyError(h,type){
 const row=h.sent.filter(x=>x.type===type).at(-1);
 if(!row)return null;
 const r=new Reader(row.bytes);
 return r.byte()===-1?r.string():null;
}
/**
 * 棋盘段（14508—14514）是**抛错**报拒的，真正的 -1 回包在 server.mjs 的 protocol-error
 * 分支里拼（`ERROR_NOTIFY_TYPES`）。测试里照那条路走：抛错 → 记一条 byte(-1)+文案。
 */
function callCaught(h,type,bytes){
 try{h.call(type,bytes);return null;}
 catch(error){h.sent.push({type,bytes:new Writer().byte(-1).string(error.message).done()});return error.message;}
}
const accept=(h,npcId,mission)=>h.call(14502,new Writer().short(npcId).short(mission).done());
const deliver=(h,npcId,mission,choice=0)=>h.call(14503,new Writer().short(npcId).short(mission).int(choice).done());

/** 棋盘包：三币种 + byte(1) + 格数 + int + int + short(已完成) + byte(当前位置) + 每格 … + powers。 */
function parseBoard(bytes){
 const r=new Reader(bytes);
 const triple=[r.int(),r.int(),r.int()],version=r.byte(),count=r.byte();
 r.int();r.int();
 const done=r.short(),pos=r.byte(),cells=[];
 for(let i=0;i<count;i++){
  const id=r.int(),flag=r.byte(),x=r.short(),y=r.short(),passed=r.bool(),n=r.byte(),conn=[];
  for(let j=0;j<n;j++)conn.push(r.byte());
  cells.push({id,flag,x,y,passed,conn});
 }
 const powers=[r.byte(),r.byte()];
 assert.equal(r.pos,bytes.length,'棋盘包不能有多余字节');
 return {triple,version,count,done,pos,cells,powers};
}

test('三档任务都挂在封印守卫者身上，奖励道具都有定义，且都是棋盘任务',()=>{
 assert.equal(ASK_SWORD_TIERS.length,3);
 assert.deepEqual(ASK_SWORD_TIERS.map(t=>t.mission),[2604,2650,2651]);
 assert.deepEqual(ASK_SWORD_TIERS.map(t=>t.coefficient),[100,170,260],'怪缩放 1 / 1.7 / 2.6');
 for(const tier of ASK_SWORD_TIERS){
  const q=officialMissions.get(tier.mission);
  assert.ok(q,`任务 ${tier.mission} 必须存在`);
  assert.equal(q.mapId,ASK_SWORD_MAP_ID,'入口地图是风雪之城');
  assert.equal(q.npcId,ASK_SWORD_NPC_ID,'入口 NPC 是封印守卫者');
  assert.equal(isAskSwordMission(tier.mission),true);
  assert.equal(isBoardMission(tier.mission),true,'必须走完棋盘才算完成');
  assert.equal(q.setting&8,8,'可重复挑战（交付后还能再接）');
  assert.deepEqual(q.submitCondition,[],'提交条件为空 —— 全靠 solarDone 拦');
  assert.equal(q.escortCost[0],0,'押金只有白银 + 铜币');
  assert.ok(q.escortCost[1]>0&&q.escortCost[2]>0,`档位越高押金越高：${JSON.stringify(q.escortCost)}`);
  assert.equal(q.rewardItems.length,tier.rewards.length);
  // 任务包（officialMissionPacket）里 money3 / money2 是 short —— 超过 32767 会回绕成负数、
  // 客户端显示成负铜币（第 83 版第一稿写了 50000，official.test.mjs 当场抓到）。
  assert.ok(q.money3>=0&&q.money3<=30000,`money3 是 short，卡在官方最大值 30000 以内：${q.money3}`);
  assert.ok(q.money2>=0&&q.money2<=500,`money2 是 short，卡在官方最大值 500 以内：${q.money2}`);
  for(const item of q.rewardItems)assert.ok(officialItems.has(item.id),`奖励道具 ${item.id} 要有定义（无定义会整包抛错）`);
  assert.deepEqual(missionBlockers(q),[],'不该挂「数据尚未采集」之类的块');
  const rewards=missionRewards(q);
  assert.equal(rewards.rewardItems.length,q.rewardItems.length,'奖励一个都不该被过滤掉');
 }
 // 押金与奖励逐档递增（对比报告：押金与奖励按档不同）
 const silvers=ASK_SWORD_TIERS.map(t=>t.escortCost[1]);
 assert.deepEqual(silvers,[...silvers].sort((a,b)=>a-b),'押金按档递增');
 const exps=ASK_SWORD_TIERS.map(t=>t.exp);
 assert.deepEqual(exps,[...exps].sort((a,b)=>a-b),'经验按档递增');
});

test('33 个单挑编队齐全：十一峰 × 三档，系数 100/170/260，怪都在怪物表里',()=>{
 assert.equal(ASK_SWORD_PEAKS.length,11);
 assert.deepEqual(ASK_SWORD_PEAKS.map(p=>p.cell),[1,2,3,4,5,6,7,8,9,10,11]);
 let count=0;
 for(const tier of ASK_SWORD_TIERS){
  for(const peak of ASK_SWORD_PEAKS){
   const group=tier.groupBase+peak.cell-1;
   const row=officialGroups.get(group);
   assert.ok(row,`编队 ${group} 必须存在（第 ${peak.cell} 峰 / ${tier.key}）`);
   count++;
   assert.equal(row.coefficient,tier.coefficient,`编队 ${group} 的系数就是这一档的缩放`);
   assert.equal(row.monsters.filter(id=>id>0).length,1,`编队 ${group} 是单挑（10 槽中间一只）`);
   assert.ok(row.monsters.includes(peak.monster));
   assert.equal(battleSupported(group),true,`编队 ${group} 必须可打`);
   assert.equal(askSwordEventGroup(tier.mission,peak.cell),group,'格子 → 编队');
   assert.equal(askSwordEventOfCell(peak.cell),peak.cell,'格子号就是对手号');
   assert.equal(askSwordEventOfCell(ASK_SWORD_DELIVERY_CELL),0,'交付格没有对手');
   assert.equal(askSwordMissionOfGroup(group),tier.mission);
   assert.equal(boardMissionOfGroup(group),tier.mission,'12501 据此跳过距离校验');
   assert.ok(officialMonsters.has(peak.monster),`第 ${peak.cell} 峰的怪 ${peak.monster} 要在表里`);
  }
 }
 assert.equal(count,33);
 // 血量为 0 的怪上不了场；十一峰的血量应当一峰比一峰高（爬山的体感）
 const hps=ASK_SWORD_PEAKS.map(p=>officialMonsters.get(p.monster).hpMax);
 assert.ok(hps.every(h=>h>0));
 assert.deepEqual(hps,[...hps].sort((a,b)=>a-b),'十一峰按血量递增');
});

test('任务在 NPC 11 处可见：三档都能接（等级条件照官方棋盘任务一样不拦人）',t=>{
 const h=fixture(t),p=h.p;
 const npc=maps[ASK_SWORD_MAP_ID].npcs.find(n=>n.id===ASK_SWORD_NPC_ID);
 assert.ok(npc,`风雪之城里要有 NPC ${ASK_SWORD_NPC_ID}`);
 const list=missionsAt(p,npc.id).map(q=>q.id);
 for(const tier of ASK_SWORD_TIERS){
  assert.ok(list.includes(tier.mission),`任务 ${tier.mission} 要出现在 NPC ${ASK_SWORD_NPC_ID} 的任务列表里`);
  assert.equal(officialCanAccept(p,officialMissions.get(tier.mission)),true,'可以直接接');
 }
 assert.ok([1,3].includes(officialSign(p,npc)),'NPC 头上要有可接任务的标记');
 // 等级条件照 2606 太阳神殿那样挂着，但任务系统不收它（全工程一致：不限制等级）
 const q=officialMissions.get(2651);
 assert.ok((q.acceptCondition||[]).some(c=>c.type===1&&c.minimum===90),'接取条件里确实写着 90 级');
 assert.equal(officialCanAccept({level:1,quests:{active:{},completed:[]},inventory:[]},q),true,'等级不拦人（与太阳神殿同一套过滤）');
});

test('14508：十三格线性山道（0 → 11 → 100）、无 powers、押金只收一次',t=>{
 const h=fixture(t),p=h.p;
 accept(h,ASK_SWORD_NPC_ID,2604);
 assert.equal(replyError(h,14502),null,'接初级档不该被拒');
 assert.ok(p.quests.active[2604],'任务要接上');
 assert.ok(h.context.solar,'接完必须由服务端推棋盘（少了这一步玩家进不去）');
 assert.equal(h.context.solar.host,'ask-sword');
 // 押金 escortCost=[0,5,50000]：5 白银 + 50000 铜币，只收一次
 assert.equal(p.silver,195,'要扣 5 白银');
 assert.equal(p.coins,950000,'要扣 50000 铜币');
 const board=parseBoard(h.sent.find(x=>x.type===14508).bytes);
 assert.deepEqual(board.triple,[p.gold,p.silver,p.coins],'棋盘包头部要带三币种');
 assert.equal(board.version,1);
 assert.equal(board.count,13);
 assert.deepEqual(board.cells.map(c=>c.id),ASK_SWORD_POINTS,'起点 0 + 十一峰 + 交付点 100');
 assert.deepEqual(board.cells.map(c=>c.conn).slice(0,-1),[[1],[2],[3],[4],[5],[6],[7],[8],[9],[10],[11],[100]],'0→1→…→11→100');
 assert.deepEqual(board.cells.at(-1).conn,[],'交付点是终点，没有下一格');
 assert.deepEqual(board.powers,[1,0],'问剑棋盘没有 powers（尾两字节 1 / 0）');
 assert.deepEqual(board.cells.map(c=>[c.x,c.y]),ASK_SWORD_POINTS.map(id=>ASK_SWORD_XY[id]),'坐标按 host 里那张表');
 assert.equal(board.cells[0].passed,true,'起点格算已通过');
 assert.equal(board.cells[0].flag,0,'起点格的旗标是 0');
 assert.equal(board.pos,0,'从起点开始');
 assert.equal(board.done,0,'一峰都还没通过（passed.size-1）');
 const silver=p.silver,coins=p.coins;
 accept(h,ASK_SWORD_NPC_ID,2604);
 assert.equal(replyError(h,14502),null,'任务在身上时再点一次是「重开棋盘」');
 assert.equal(p.silver,silver,'重开棋盘不重复扣报名费');
 assert.equal(p.coins,coins);
 assert.ok(h.context.solar,'重开要把棋盘接回来');
 // 三档各接一次：押金按档收
 const h2=fixture(t);
 accept(h2,ASK_SWORD_NPC_ID,2651);
 assert.equal(replyError(h2,14502),null,'接高级档不该被拒');
 assert.equal(h2.p.silver,180,'高级档 20 白银');
 assert.equal(h2.p.coins,800000,'高级档 200000 铜币');
});

test('不在风雪之城 / 身上没有这三档任务时，棋盘段绝不认领包',t=>{
 const h=fixture(t);
 const empty=new Reader(Buffer.alloc(0));
 assert.equal(handleSolarChallenge(14508,empty,h.context,{send:()=>{},store:h.store,log(){}}),false,'没接任务就别弹棋盘');
 // 接上之后人在别的图 → 也不认领
 accept(h,ASK_SWORD_NPC_ID,2604);
 assert.ok(h.context.solar);
 h.p.mapId=19;
 assert.equal(handleSolarChallenge(14508,new Reader(Buffer.alloc(0)),h.context,{send:()=>{},store:h.store,log(){}}),false,'棋盘只在各自的地图图上认领');
});

test('十一峰必须逐峰走完：跳过未通过的格子会被拒，走完最后一峰 + 到 100 才置 solarDone',t=>{
 const h=fixture(t),p=h.p,q=officialMissions.get(2604);
 accept(h,ASK_SWORD_NPC_ID,2604);
 assert.equal(replyError(h,14502),null);
 assert.equal(officialComplete(p,q),false,'没走完棋盘不算完成');
 deliver(h,ASK_SWORD_NPC_ID,2604);
 assert.match(replyError(h,14503)||'',/请先结束棋盘挑战/,'棋盘还开着不许交付');
 // 不能跳到没连着的格子
 assert.match(callCaught(h,14510,new Writer().byte(5).byte(0).done())||'',/只能移动到相邻的格子/,'线性山道只能一步一步走');
 for(const peak of ASK_SWORD_PEAKS){
  h.call(14510,new Writer().byte(peak.cell).byte(0).done());
  assert.equal(replyError(h,14510),null,`走向第 ${peak.cell} 峰不该被拒`);
  const move=new Reader(h.sent.filter(x=>x.type===14510).at(-1).bytes);
  assert.equal(move.byte(),1,'有对手的格子要回「挑战」文案');
  const desc=move.string();
  assert.equal(move.short(),peak.cell,'回包里的对手号就是格子号');
  assert.ok(desc.includes(officialMonsters.get(peak.monster).name),`挑战文案里要有对手名字：${desc}`);
  move.string();move.int();move.int();
  assert.equal(move.byte(),1);assert.equal(move.byte(),peak.cell,'回包要带格子号');
  assert.equal(move.pos,move.b.length,'移动回包不该有多余字节');
  if(peak.cell===1){
   // 站在有对手的格子、还没打赢时，不许往前走
   assert.match(callCaught(h,14510,new Writer().byte(2).byte(0).done())||'',/请先完成当前格子的挑战/,'没打完这一峰不能走');
  }
  h.call(14514,new Writer().short(peak.cell).done());
  const group=askSwordEventGroup(2604,peak.cell);
  assert.equal(pendingSolarGroup(h.context),group,`14514 要给出第 ${peak.cell} 峰的编队`);
  const choice=new Reader(h.sent.filter(x=>x.type===14514).at(-1).bytes);
  assert.equal(choice.byte(),0);assert.equal(choice.short(),group);assert.equal(choice.pos,choice.b.length);
  const reply=settleSolarBattle(h.context,p,group);
  assert.equal(reply.type,14508,'打赢要回一个待补发的棋盘包');
  assert.ok(p.quests.active[2604].solarBoard.passed.includes(peak.cell),'通过状态要落存档');
  if(peak.cell<ASK_SWORD_FINAL_CELL)assert.equal(h.context.solar.completed,false,'中间峰不算完成');
 }
 assert.equal(h.context.solar.completed,true,'打完第十一峰才算赛程完成');
 assert.equal(p.quests.active[2604].solarBoard.completed,true);
 assert.equal(officialComplete(p,q),false,'还没走到交付格');
 h.call(14510,new Writer().byte(ASK_SWORD_DELIVERY_CELL).byte(0).done());
 assert.equal(replyError(h,14510),null,'完成之后才能走到 100 号交付格');
 assert.equal(p.quests.active[2604].solarDone,true,'走到交付格才置 solarDone');
 assert.equal(officialComplete(p,q),true);
 h.call(14511,new Writer().short(0).done());
 assert.equal(h.context.solar,null,'结束赛程后清掉棋盘');
 deliver(h,ASK_SWORD_NPC_ID,2604);
 assert.equal(replyError(h,14503),null,'走完棋盘应该能交付');
 assert.ok(p.quests.completed.includes(2604),'交付后进完成表');
 // 可重复挑战：交付后还能再接，而且棋盘从起点重来
 accept(h,ASK_SWORD_NPC_ID,2604);
 assert.equal(replyError(h,14502),null,'可重复挑战的任务交付后还能再接');
 const again=parseBoard(h.sent.filter(x=>x.type===14508).at(-1).bytes);
 assert.equal(again.pos,0,'重接之后从起点开始');
 assert.equal(again.done,0,'老进度不该残留');
});

test('棋盘外打同图战斗不该改棋盘进度（settle 守卫）',t=>{
 const h=fixture(t),p=h.p;
 accept(h,ASK_SWORD_NPC_ID,2604);
 h.context.solar.board.pos=1;
 h.context.solar.pendingGroup=askSwordEventGroup(2604,3);
 settleSolarBattle(h.context,p,askSwordEventGroup(2604,3));
 assert.deepEqual([...h.context.solar.board.passed],[0],'不该把 1 号格记成通过');
 assert.equal(h.context.solar.pendingGroup,0,'pending 无论如何都要清掉');
 settleSolarBattle(h.context,p,askSwordEventGroup(2604,1));
 assert.deepEqual([...h.context.solar.board.passed],[0,1]);
 assert.equal(h.context.solar.completed,false,'中间峰不算完成');
});

test('端到端：接任务 → 14514 → 12501 打第 1 峰 → 12502 记这一峰并补发棋盘',t=>{
 const h=fixture(t),p=h.p;
 accept(h,ASK_SWORD_NPC_ID,2650);
 assert.equal(replyError(h,14502),null);
 h.call(14510,new Writer().byte(1).byte(0).done());
 h.call(14514,new Writer().short(1).done());
 const group=pendingSolarGroup(h.context);
 assert.equal(group,30321,'中级档第 1 峰');
 p.battles.cooldowns[group]=0;
 // 棋盘编队不在地图刷怪点上：必须跳过「站在 NPC 旁边」的校验才能开打
 h.call(12501,new Writer().short(group).done());
 assert.equal(h.context.battle?.group,group,'棋盘编队要能直接开打');
 assert.deepEqual(h.context.battle.monsters,[1730],'第 1 峰只打冰原狼');
 assert.equal(h.context.battle.solarMission,2650,'要标成棋盘战斗');
 assert.equal(pendingSolarGroup(h.context),0,'开战后清掉 pending，别让下一场战斗认它');
 const battle=h.context.battle;
 h.call(12502,new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(battle.group).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(battle.token).byte(2).done());
 assert.ok(p.quests.active[2650].solarBoard.passed.includes(1),'棋盘记下第 1 峰');
 assert.equal(h.sent.filter(x=>x.type===14508).length,2,'12502 回包之后还要再推一次棋盘（接任务时一次 + 打赢补发一次）');
});

test('幂等：重复注入不重复 push 任务/编队，也不改写已有 wire',()=>{
 const groupIds=ASK_SWORD_TIERS.flatMap(t=>ASK_SWORD_PEAKS.map(p=>t.groupBase+p.cell-1));
 const groupWires=new Map(groupIds.map(id=>[id,officialGroups.get(id).wireBase64]));
 const missions=official.missions.length,groups=official.groups.length;
 const result=applyAskSword(official);
 assert.deepEqual(result.missions,[],'任务不该重复造');
 assert.deepEqual(result.groups,[],'编队不该重复造');
 assert.deepEqual(result.missing,[],'引用的怪都必须存在（排在建怪补丁之后）');
 assert.equal(official.missions.length,missions);
 assert.equal(official.groups.length,groups);
 for(const [id,wire] of groupWires)assert.equal(officialGroups.get(id).wireBase64,wire,`编队 ${id} 的 wire 不该变`);
});

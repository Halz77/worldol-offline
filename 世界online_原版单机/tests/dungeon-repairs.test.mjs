import test from 'node:test';
import assert from 'node:assert/strict';
import {Reader} from '../lib/codec.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {official,officialMissions,officialItems,officialMaps,officialGroups,officialMonsters} from '../lib/official-data.mjs';
import {officialCanAccept,missionBlockers} from '../lib/official-rules.mjs';
import {cityState,cityTarget,applyCityMission} from '../lib/city-state.mjs';
import {dailyData,taskSnapshot,dailyRevision} from '../lib/daily-activity.mjs';
import {encodeDaily,decodeDaily} from '../lib/daily-service.mjs';
import {chainById,replayableChainsRevision,replayChainAfterSettlement,chainCleared} from '../lib/replayable-chains.mjs';
import {
 DUNGEON_DAILY_SPECS,BURIAL_DAILY,DESERT_DAILY_BRANCH,COOP_DAILY_ROW,LEGACY_DUEL,dailyNavigation,
} from '../lib/dungeon-repairs.mjs';
import {
 CITY_DAILY_QUESTS,CITY_MATERIALS,CITY_LEVEL_ADAPTATIONS,CITY_CONDITION_DROPS,CITY_LEVEL_CAP,CITY_SCENES,
} from '../lib/custom-adventures.mjs';

/**
 * 日常副本整合（移植自社区版 dungeon-repairs / custom-adventures）。
 * 断言的是「看板进度 / 导航 / 重玩 / 城市日常」四件事的契约。
 */

function cityPlayer(overrides={}){
 const p=normalizeRole({id:1001,name:'日常副本测试',level:97,job:1,race:0,sex:1,mapId:1000});
 p.inventory=[];p.quests={active:{},completed:[]};p.coins=500000;
 p.cityUnlocked=true;p.city=cityState(p);
 return Object.assign(p,overrides);
}
const rowOf=id=>dailyData.tasks.find(row=>row.id===id);
const rowsOf=canonicalId=>dailyData.tasks.filter(row=>row.canonicalId===canonicalId);

test('日常副本：8 个副本行的位表 = 重玩链的节点集合（减去可选高难度支线）',()=>{
 assert.equal(DUNGEON_DAILY_SPECS.length,8);
 for(const spec of DUNGEON_DAILY_SPECS){
  const chain=chainById(spec.chain);
  assert.ok(chain,`链 ${spec.chain} 存在`);
  const optional=new Set(chain.optional||[]);
  const bits=chain.nodes.filter(id=>!optional.has(id));
  const rows=rowsOf(spec.id);
  assert.ok(rows.length>0,`日常行 ${spec.id} 存在`);
  for(const row of rows){
   assert.equal(row.pending,undefined,`日常行 ${row.id} 不再「待定」`);
   assert.equal(row.frequency,1,`日常行 ${row.id} 每天一次`);
   assert.equal(row.progressSum,bits.length,`日常行 ${row.id} 进度上限 = 位表节点数`);
   assert.deepEqual(row.linkage.missionIds,bits,`日常行 ${row.id} 位表 = 链节点（去掉可选）`);
   assert.equal(row.linkage.terminal,spec.terminal,`日常行 ${row.id} 收尾环 = 录制的那个任务`);
   assert.ok(chain.nodes.includes(row.linkage.terminal),`日常行 ${row.id} 收尾任务在链里`);
  }
 }
});

test('日常副本：节点集合与录制口径对齐（可选高难度支线算复位、不算进度）',()=>{
 assert.equal(chainById('daily-30').nodes.length,20);
 assert.equal(chainById('maya-sun-god').nodes.length,71);
 assert.equal(chainById('daily-33').nodes.length,23);
 assert.equal(chainById('daily-34').nodes.length,29);
 assert.equal(chainById('daily-35').nodes.length,35);
 assert.equal(chainById('daily-37').nodes.length,24);
 assert.equal(chainById('daily-38').nodes.length,61);
 // 晴菜 1822 / 晴菜后续 1395 是可选的**高难度**支线：留在链的复位范围里（打完才复位），
 // 但看板进度条不等它们 —— 录制的 progressSum 就是 22 / 23。
 assert.deepEqual(chainById('daily-33').optional,[1822]);
 assert.deepEqual(chainById('daily-33').finale,[1822]);
 assert.ok(chainById('daily-33').nodes.includes(1822));
 assert.ok(!rowOf(33).linkage.missionIds.includes(1822),'看板位表不含 1822');
 assert.equal(rowOf(33).progressSum,22,'录制的进度上限是 22');
 assert.deepEqual(chainById('daily-37').finale,[1395]);
 assert.ok(!rowOf(37).linkage.missionIds.includes(1395),'看板位表不含 1395');
 assert.equal(rowOf(37).progressSum,23);
 // 机械城副本 = 录制的 39 步 + 本工程续写的 9139/9140。
 const machine=chainById('daily-36');
 assert.equal(machine.nodes.length,41);
 assert.ok(machine.nodes.includes(9139)&&machine.nodes.includes(9140));
 assert.deepEqual(machine.finale,[9140]);
});

test('日常副本：主线交付不复位、高难打完才复位（晴菜 1822）',()=>{
 const p=cityPlayer();
 const chain=chainById('daily-33');
 for(const id of rowOf(33).linkage.missionIds)p.quests.completed.push(id);
 // 主线 22 环全做完：高难 1822 还没打，链不算通关 —— 不复位，1822 的入口（依赖 1820）还在。
 assert.equal(chainCleared(p,chain),false);
 assert.equal(replayChainAfterSettlement(p,1820),null);
 assert.ok(p.quests.completed.includes(1820),'主线交付后 1820 仍在完成记录里');
 // 补上高难：整条链（含 1822）复位。
 p.quests.completed.push(1822);
 assert.equal(chainCleared(p,chain),true);
 const result=replayChainAfterSettlement(p,1822);
 assert.equal(result?.id,'daily-33');
 assert.ok(!p.quests.completed.includes(1820));
 assert.ok(!p.quests.completed.includes(1822));
});

test('日常副本：玛雅行用的是已登记的玛雅链（不重复登记）',()=>{
 assert.equal(DUNGEON_DAILY_SPECS.find(s=>s.id===31).chain,'maya-sun-god');
 assert.equal(rowOf(31).linkage.terminal,1846);
 assert.ok(rowOf(31).linkage.missionIds.includes(1863));
});

test('日常副本：跨服副本行接到单机合作副本 9176',()=>{
 const row=rowOf(COOP_DAILY_ROW);
 assert.equal(row.linkage.terminal,9176);
 assert.deepEqual(row.linkage.missionIds,[9176]);
 assert.equal(row.mapId,824);
 assert.equal(row.npcID,112);
 assert.equal(officialMissions.get(9176)?.name,row.name);
 assert.equal(row.pending,undefined);
 assert.equal(row.type,3,'并入「挑战副本」页签');
 assert.equal(row.typeName,'挑战副本');
 assert.equal(row.missionId,-1,'missionId=-1 客户端才会显示这一行');
 assert.equal(row.frequency,-1,'不限次数（当天可重玩）');
 // 客户端 `r_shopId>0` 时行按钮是「进商店」，否则才走导航 —— 券店这一版不做，必须清掉。
 assert.equal(row.shopid,0,'录制的券店 11315 已摘掉');
});

test('日常副本：失魂沙漠补上本地续篇节点',()=>{
 for(const row of rowsOf(45)){
  for(const id of DESERT_DAILY_BRANCH)assert.ok(row.linkage.missionIds.includes(id),`行 ${row.id} 含续篇 ${id}`);
  assert.equal(row.progressSum,row.linkage.missionIds.length);
 }
});

test('日常副本：葬送佣兵团行指向三个队长战与汇总任务',()=>{
 const row=rowOf(27);
 assert.equal(row.linkage.terminal,BURIAL_DAILY.terminal);
 assert.deepEqual(row.linkage.monsterIds,[2312,2313,2314]);
 assert.equal(row.progressSum,3);
 assert.equal(row.pending,undefined);
 for(const entry of DUNGEON_DAILY_SPECS)assert.equal(entry.id===27,false,'27 不在 8 个副本清单里');
 assert.deepEqual(BURIAL_DAILY.missionIds,[2800,2801,2802,2803]);
});

test('日常副本：同一天打完就能重玩（整条链复位）',()=>{
 const p=cityPlayer();
 const chain=chainById('daily-33');
 for(const id of chain.nodes)p.quests.completed.push(id);
 assert.ok(chainCleared(p,chain),'全部节点完成 = 通关');
 const result=replayChainAfterSettlement(p,chain.finale[0]);
 assert.ok(result,`交付 ${chain.finale[0]} 后复位`);
 assert.equal(result.id,chain.id);
 for(const id of chain.nodes)assert.ok(!p.quests.completed.includes(id),`节点 ${id} 已从完成记录里抹掉`);
 // 复位之后第一环又能接（前置条件不再成立）。
 assert.ok(!p.quests.completed.includes(chain.nodes[0]));
});

test('日常副本：看板导航指向当前那一环（进行中才填 find*）',()=>{
 const p=cityPlayer();
 let snap=taskSnapshot(p);
 for(const spec of DUNGEON_DAILY_SPECS){
  const row=snap.info.find(r=>r.id===spec.id);
  assert.equal(row.status,0,`${spec.id} 未开始`);
  assert.ok(!row.findMisId,`${spec.id} 未开始时不填 findMisId`);
 }
 const chain=chainById('daily-33');
 p.quests.active={[chain.nodes[0]]:{}};
 snap=taskSnapshot(p);
 const row=snap.info.find(r=>r.id===33);
 assert.equal(row.status,1,'有进行中的一环 → 进行中');
 assert.equal(row.findMisId,chain.nodes[0]);
 assert.ok(row.findMapId>0&&officialMaps.has(row.findMapId),'导航地图存在');
 assert.equal(row.findMisSta,1);
 // 挪到第二环：导航跟着走
 p.quests.active={[chain.nodes[1]]:{}};
 p.quests.completed.push(chain.nodes[0]);
 assert.equal(taskSnapshot(p).info.find(r=>r.id===33).findMisId,chain.nodes[1]);
});

test('日常副本：dailyNavigation 对没有位表的行返回 null',()=>{
 const p=cityPlayer();
 assert.equal(dailyNavigation(p,{id:1,linkage:null}),null);
 assert.equal(dailyNavigation(p,{id:2}),null);
});

test('日常副本：导航字段能过真协议（s2c_TaskInfo 往返）',()=>{
 const p=cityPlayer();
 const chain=chainById('daily-33');
 p.quests.active={[chain.nodes[0]]:{}};
 const info=decodeDaily('s2c_TaskInfo',encodeDaily('s2c_TaskInfo',taskSnapshot(p)));
 const row=info.info.find(r=>r.id===33);
 assert.equal(row.status,1,'进行中');
 assert.equal(row.findMisId,chain.nodes[0],'findMisId = 当前一环');
 assert.equal(row.findMisSta,1);
 assert.ok(row.findMapId>0&&row.findPx>0&&row.findPy>0,'find 落点有值');
 // 未开始的行不填 find*（客户端会退回行自带的 mapId/npcID；proto3 里缺字段就是未下发）。
 const idle=info.info.find(r=>r.id===34);
 assert.equal(idle.status,0);
 assert.ok(!idle.findMisId);
 assert.ok(!idle.findMapId);
});

test('挑战副本：紫禁城·平民菜单指向的编队 1838 已补出',()=>{
 const group=officialGroups.get(LEGACY_DUEL.groupId);
 assert.ok(group,'编队存在');
 assert.ok(group.monsters.includes(LEGACY_DUEL.groupId),'编队里是克隆出来的那只怪');
 const monster=officialMonsters.get(LEGACY_DUEL.groupId);
 assert.ok(monster,'怪物存在');
 assert.equal(monster.name,LEGACY_DUEL.name);
 assert.equal(monster.questCreditMonsterId,undefined,'克隆怪不抢原怪的击杀记账');
 const npc=officialMaps.get(LEGACY_DUEL.mapId).npcs.find(n=>n.id===LEGACY_DUEL.npcId);
 assert.ok(npc.battleID.includes(LEGACY_DUEL.groupId),'NPC 菜单指向这个编队');
 assert.ok((npc.status&3)===3,'NPC 可见可交互');
});

test('城市材料：缺定义的加工材料按同类道具补出（定义字节逐字段可解）',()=>{
 assert.equal(CITY_MATERIALS.length,4);
 for(const spec of CITY_MATERIALS){
  const item=officialItems.get(spec.id);
  const base=officialItems.get(spec.reference);
  assert.ok(item&&base,`${spec.id} 与参考 ${spec.reference} 都存在`);
  assert.equal(item.name,spec.name);
  assert.equal(item.grade,base.grade,'品级沿用同类材料');
  assert.equal(item.price,base.price,'价格沿用同类材料');
  const reader=new Reader(Buffer.from(item.definitionBase64,'base64'));
  assert.equal(reader.byte(),29,'材料类道具');
  assert.equal(reader.bool(),false);
  assert.equal(reader.int(),spec.id);
  assert.equal(reader.string(),spec.name);
  assert.equal(reader.int(),spec.bagIcon);
  assert.ok(reader.string().length>0,'说明非空');
 }
});

test('城市日常：8801—8808 在个人城市可见可接',()=>{
 const p=cityPlayer();
 assert.equal(CITY_DAILY_QUESTS.length,8);
 for(const def of CITY_DAILY_QUESTS){
  const quest=officialMissions.get(def.id);
  assert.ok(quest,`任务 ${def.id} 存在`);
  assert.equal(quest.mapId,2800,'城市任务');
  assert.equal(quest.name,def.name);
  assert.ok(missionBlockers(quest).length===0,`任务 ${def.id} 没有待定条件`);
  assert.ok(officialCanAccept(p,quest),`任务 ${def.id} 在城市里可接`);
  const origins=(quest.sources||[]).filter(s=>s.mapId===1000).length+(quest.sources||[]).filter(s=>s.mapId===3090).length;
  assert.equal(origins,2,`任务 ${def.id} 同时登记两个城市场景`);
  assert.equal(cityTarget(quest,{...p,mapId:1000}).mapId,1000,'在当前城市场景里落点正确');
 }
 const city=cityPlayer({mapId:1});
 for(const def of CITY_DAILY_QUESTS)assert.ok(!officialCanAccept(city,officialMissions.get(def.id)),`任务 ${def.id} 不在城市里接不了`);
 assert.equal(missionBlockers(officialMissions.get(8801)).length,0);
});

test('城市日常：铜币消耗与繁荣度/军力结算',()=>{
 const p=cityPlayer();
 const plan=applyCityMission(p,officialMissions.get(8801));
 assert.equal(plan.costCoins,1000);
 assert.equal(plan.cityProsperity,200);
 assert.equal(p.coins,500000-1000);
 assert.equal(cityState(p).prosperity,200);
 const army=applyCityMission(p,officialMissions.get(8802));
 assert.equal(army.costCoins,500);
 assert.equal(cityState(p).army,300);
});

test('城市日常：原料采购直接给出原加工任务要的材料',()=>{
 for(const [id,processing] of [[8803,3027],[8804,3028],[8805,3029]]){
  const supply=officialMissions.get(id),original=officialMissions.get(processing);
  const expected=(original.submitCondition||[]).filter(c=>c.type===7&&!c.not).map(c=>`${c.itemId}x${c.required}`);
  assert.deepEqual(supply.rewardItems.map(i=>`${i.id}x${i.quantity}`),expected,`任务 ${id} 的奖励 = 原加工任务的材料`);
  assert.equal(supply.exp,0,'采购任务不给经验（只出材料）');
  assert.ok((supply.submitCondition||[]).some(c=>c.type===5&&Buffer.from(c.rawHex,'hex').readInt32BE()===4000),'花费 4000 铜币');
 }
});

test('城市日常：建设贡献交付原加工任务的产物（5 木材 / 6 石材 / 5 铁矿）',()=>{
 for(const [id,processing,itemId,amount] of [[8806,3027,1000,5],[8807,3028,1001,6],[8808,3029,1002,5]]){
  const quest=officialMissions.get(id);
  const condition=(quest.submitCondition||[]).find(c=>c.type===7);
  assert.ok(condition,`任务 ${id} 要交材料`);
  assert.equal(condition.itemId,itemId);
  assert.equal(condition.required,amount);
  assert.equal(condition.name,officialItems.get(itemId).name);
  assert.ok(officialItems.has(itemId),`交付目标 ${itemId} 有定义`);
  assert.equal(quest.cityProsperity,200,'交付给 200 繁荣度');
 }
});

test('城市任务：127 级门槛收到人物上限、超限条件按社区版处理',()=>{
 for(const id of CITY_LEVEL_ADAPTATIONS){
  const quest=officialMissions.get(id);
  for(const c of [...(quest.acceptCondition||[]),...(quest.submitCondition||[])])if(c.type===1)assert.ok(c.minimum<=CITY_LEVEL_CAP,`任务 ${id} 的等级条件 ≤${CITY_LEVEL_CAP}`);
  assert.equal(missionBlockers(quest).length,0,`任务 ${id} 没有待定条件`);
 }
 const adapted=officialMissions.get(3068).acceptCondition.find(c=>c.type===1);
 assert.equal(adapted.minimum,CITY_LEVEL_CAP);
 assert.equal(adapted.rawHex,'61','rawHex 与 minimum 同步（0x61 = 97）');
 assert.ok(officialMissions.get(3068).desc.includes('单机适配'));
 for(const id of CITY_CONDITION_DROPS){
  const quest=officialMissions.get(id);
  assert.equal(missionBlockers(quest).length,0,`任务 ${id} 没有待定条件`);
  for(const c of [...(quest.acceptCondition||[]),...(quest.submitCondition||[])])assert.ok(!(c.type===1&&c.minimum>CITY_LEVEL_CAP),`任务 ${id} 没有超上限等级条件`);
 }
 assert.deepEqual(CITY_SCENES,[1000,3090]);
});

test('城市任务：本批处理过的城市任务不再挂待定条件',()=>{
 for(const id of [...CITY_LEVEL_ADAPTATIONS,...CITY_CONDITION_DROPS]){
  assert.deepEqual(missionBlockers(officialMissions.get(id)),[],`任务 ${id} 没有待定条件`);
 }
 // 3030「国家专用发展证领取」是**国家系统**任务（type 6 条件 = 消耗 500 国家贡献度）。
 // 本工程没有国家系统，与社区版一样保持「待定」，留在看板上当缺口标记。
 const blocked=official.missions.filter(q=>q.mapId===2800&&missionBlockers(q).length>0).map(q=>q.id);
 assert.deepEqual(blocked,[3030],'城市里只剩国家系统那一条待定');
});

test('版本号：日常表与状态页带上本批改动',()=>{
 assert.ok(officialMissions.has(9176));
 assert.ok(dailyRevision().includes('complete-local-dungeons'),dailyRevision());
 assert.ok(replayableChainsRevision().includes('replayable-chains'),replayableChainsRevision());
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SaveStore} from '../lib/store.mjs';
import {Writer,Reader} from '../lib/codec.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
import {official,officialMissions,officialMonsters,officialGroups,officialItems} from '../lib/official-data.mjs';
import {battleSupported,missionBattleId,missionBlockers,missionConditions,missionRewards,officialCanAccept,officialComplete,npcEnabled,isBoardMission} from '../lib/official-rules.mjs';
import {maps,hpMax,mpMax} from '../lib/content.mjs';
import {handleOfficial} from '../lib/official-service.mjs';
import {handleGame,BATTLE_TRAILER} from '../lib/game-service.mjs';
import {
 BOSS_TOURNAMENT_MISSION,BOSS_TOURNAMENT_MAP_ID,BOSS_TOURNAMENT_NPC_ID,BOSS_TOURNAMENT_STAGES,BOSS_BOARD_POINTS,
 bossTournamentEventGroup,bossTournamentEventOfCell,bossTournamentMissionOfGroup,applyBossTournament,
} from '../lib/boss-tournament-data.mjs';
import {handleSolarChallenge,settleSolarBattle,pendingSolarGroup,boardMissionOfGroup} from '../lib/solar-challenge-service.mjs';

/**
 * BOSS 挑战赛（任务 1305，新月古镇广场 map 14 / NPC 103）。
 *
 * 抓包里任务与入口都在，缺的是：3314 / 3315 两只怪、三个委托的战斗编队、棋盘协议，
 * 以及入口 NPC 的可见位（status 66 = 可交互但看不见）。这一版把「能打」补齐，
 * 但**不做**入场券（119）与奖励盒（1480/1481/1482）—— 用户明确说不需要券、不需要奖励。
 *
 * 所以测试钉五件事：
 *   ① 三场单挑的编队真的可打，且用的就是三个委托要杀的怪（打棋盘 = 攒委托进度）；
 *   ② 入口 NPC 能被客户端整条解回来，状态位是「可见 + 可交互」，且不留死按钮（券店已摘）；
 *   ③ 棋盘协议五格流程能走完，走完之前不许交付；
 *   ④ 没有券也能接（HAVE_ITEM 119 因为道具没定义被过滤），奖励盒没定义也不报错；
 *   ⑤ 棋盘外打同图战斗不该偷偷改棋盘进度。
 */
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),d=decoders(root);

/** 真实存盘 + 真实角色：棋盘/战斗都要跑 store.save()，用假 store 容易漏掉存档字段。 */
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-boss-tournament-'));
 t.after(()=>{const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-boss-tournament-'));fs.rmSync(exact,{recursive:true,force:true});});
 const store=new SaveStore(dir),account=store.account('BOSS挑战赛验收'),p=store.create(account,{name:'挑战验收',sex:1,race:0,job:1,icon1:'2240667',icon2:'0',icon3:'0'});
 Object.assign(p,{level:90,mapId:BOSS_TOURNAMENT_MAP_ID,x:27,y:32,gold:0,silver:50,coins:300000,quests:{active:{},completed:[]}});
 p.hp=hpMax(p);p.mp=mpMax(p);store.save();
 const sent=[],context={role:p,account};
 const env={store,send(type,w){sent.push({type,bytes:w instanceof Writer?w.done():Buffer.from(w)});},log(){}};
 // 14508-14511/14514 走棋盘段，14502/14503/14504 走任务段，12501/12502 走战斗段
 // （与 protocol-dispatch 的认领顺序一致）。
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

test('1305 是棋盘任务：三场单挑编队齐、可打，用的就是三个委托要杀的怪',()=>{
 assert.equal(isBoardMission(BOSS_TOURNAMENT_MISSION),true);
 assert.equal(BOSS_TOURNAMENT_STAGES.length,3);
 assert.deepEqual(BOSS_TOURNAMENT_STAGES.map(s=>s.cell),[1,2,3]);
 for(const stage of BOSS_TOURNAMENT_STAGES){
  const q=officialMissions.get(stage.mission),group=officialGroups.get(stage.group);
  assert.ok(group,`格子 ${stage.cell} 的编队 ${stage.group} 必须存在`);
  assert.equal(battleSupported(stage.group),true,`编队 ${stage.group} 必须可打`);
  assert.equal(bossTournamentEventGroup(stage.cell),stage.group,'格子号 → 编队号');
  assert.equal(bossTournamentEventOfCell(stage.cell),stage.cell,'格子号就是对手号');
  assert.equal(bossTournamentMissionOfGroup(stage.group),BOSS_TOURNAMENT_MISSION);
  assert.equal(boardMissionOfGroup(stage.group),BOSS_TOURNAMENT_MISSION,'12501 据此跳过距离校验');
  assert.equal(group.monsters.filter(id=>id>0).length,1,`编队 ${stage.group} 是单挑（10 槽中间一只）`);
  assert.ok(group.monsters.includes(stage.monster),`编队 ${stage.group} 里要有 ${stage.monster}`);
  // 这一格打赢 = 那一场委托的击杀数 → 三个委托不用另做战斗数据
  assert.ok((q.submitCondition||[]).some(c=>c.type===2&&c.monsterId===stage.monster),
   `委托 ${stage.mission} 的击杀目标要是 ${stage.monster}`);
  assert.deepEqual(missionBlockers(q),[],`委托 ${stage.mission} 不该再挂「任务目标怪物资料尚未采集」`);
 }
 // 千年魔牛复用日常副本已补的 30022，不另造重复编队
 assert.equal(missionBattleId(officialMissions.get(2453),'accept'),30022);
 assert.equal(officialGroups.get(30022).monsters.filter(id=>id>0).length,1);
 for(const [mission,group] of [[2452,30150],[2451,30152]])
  assert.equal(missionBattleId(officialMissions.get(mission),'accept'),group,`委托 ${mission} 的入口要指向棋盘同一场`);
});

test('克隆怪 3315 / 3314：id 与名字写进 wire，属性区与参考怪逐字节相同',()=>{
 for(const [id,reference] of [[3315,3209],[3314,3317]]){
  const monster=officialMonsters.get(id),source=officialMonsters.get(reference);
  assert.ok(monster&&source,`克隆怪 ${id} 与参考怪 ${reference} 都要在表里`);
  assert.equal(monster.localReconstruction,true);
  assert.equal(monster.referenceMonsterId,reference);
  assert.equal(monster.name,BOSS_TOURNAMENT_STAGES.find(s=>s.monster===id).name);
  for(const key of ['hpMax','mpMax','level','atkMin','atkMax','def_str','tough','speed'])
   assert.equal(monster[key],source[key],`${id}.${key} 应与参考怪相同`);
  // wire 头：int32 id + 3 字节长度 + UTF-16**BE** 名字（见 cloneMonster 的注释），
  // 余下属性区必须与参考怪逐字节相同。
  const bytes=Buffer.from(monster.wireBase64,'base64');
  assert.equal(bytes.readInt32BE(0),id);
  const chars=bytes.readUIntBE(4,3);
  assert.equal(bytes.subarray(7,7+chars*2).swap16().toString('utf16le'),monster.name,'wire 里的名字要换成本地名字');
  const tail=bytes.subarray(7+chars*2);
  const sourceBytes=Buffer.from(source.wireBase64,'base64');
  const sourceChars=sourceBytes.readUIntBE(4,3);
  assert.deepEqual(tail,sourceBytes.subarray(7+sourceChars*2),'属性区必须与参考怪逐字节相同');
 }
});

test('入口 NPC 103：补可见位（66 → 67）、摘掉券店菜单，客户端能把整条记录解回来',()=>{
 const npc=maps[BOSS_TOURNAMENT_MAP_ID].npcs.find(n=>n.id===BOSS_TOURNAMENT_NPC_ID);
 assert.ok(npc,'新月古镇广场上要有 BOSS挑战赛 这个 NPC');
 assert.equal(npc.status,67,'原记录 66 = 只有「可交互」没有「可见」');
 assert.equal(npc.status&1,1,'补上了可见位');
 assert.equal(npc.status&2,2,'原来的可交互位不该丢');
 assert.equal(npc.status&64,64,'原来的「挡住玩家」位不该丢');
 assert.equal(npc.status&8,0,'没有 missionData 段（与下面按布局解析一致）');
 assert.equal(npc.localBossTournamentNpc,'drop-voucher-menu+show-visible-from-66');
 assert.equal(npcEnabled({},npc),true,'不可用的 NPC 接不了任务');
 // 客户端解码：整条记录自洽，且只动了「状态位 + 券店那一段」
 const body=Buffer.from(npc.wireBase64,'base64'),reader=new NativeReader(body),parsed=d.Npc.fromBytes(reader);
 reader.finish();
 assert.equal(parsed.id,BOSS_TOURNAMENT_NPC_ID);
 assert.equal(parsed.name,'BOSS挑战赛');
 assert.equal(parsed.npcType,5);
 assert.equal(parsed.status,67);
 assert.equal(parsed.talkDetail,npc.talkDetail,'对白原样保留');
 assert.equal(parsed.x,27);assert.equal(parsed.y,32);
 // 券店 2061 这一版不做（用户明确不要入场券）→ 菜单项摘掉，不留点进去只报错的死按钮
 // （整段摘掉后客户端不再建 menuShop/shopID 这两个字段，所以两个都要按「空」判）
 assert.deepEqual(parsed.menuShop||[],[]);
 assert.deepEqual(parsed.shopID||[],[]);
 // 按布局重建一遍必须与 wire 逐字节相同：证明摘掉的正好是那一段、别的字节没动
 const r=new Reader(body);
 r.take(14);r.utf();r.utf();
 const talk=r.utf(),statusOffset=r.pos,status=r.byte()&255;
 const direction=r.byte(),x=r.byte(),y=r.byte(),rangeX=r.byte(),rangeY=r.byte();
 const sections=[];
 for(let i=0;i<4;i++){
  const count=r.byte()&255,items=[];
  for(let k=0;k<count;k++)items.push({menu:r.utf(),shop:r.short(),first:r.short(),second:r.byte()});
  sections.push({count,items});
 }
 assert.equal(r.pos,body.length,'记录尾部不该有多余字节');
 assert.deepEqual(sections.map(s=>s.count),[0,0,0,0],'四段菜单都空了（原本只有商店段有 1 项）');
 const w=new Writer();
 w.raw(body.subarray(0,14));w.utf(parsed.name);w.utf(parsed.welcome);
 w.utf(talk).byte(status).byte(direction).byte(x).byte(y).byte(rangeX).byte(rangeY);
 for(const s of sections){w.byte(s.count);for(const it of s.items)w.utf(it.menu).short(it.shop).short(it.first).byte(it.second);}
 assert.ok(w.done().equals(body),'按字段重建必须与 wire 完全相同');
 assert.equal(statusOffset,61,'状态字节的位置（记录布局一旦变了，这条测试要一起改）');
});

test('没有入场券也能接：HAVE_ITEM 119 被过滤；奖励盒没定义也不挡交付',()=>{
 const q=officialMissions.get(BOSS_TOURNAMENT_MISSION);
 assert.equal(officialItems.has(119),false,'这一版不做入场券');
 // 抓包里确实带着那条券条件，只是 missionConditions 把「道具没定义」的条件过滤掉了
 assert.ok((q.acceptCondition||[]).some(c=>c.type===7&&c.itemId===119),'前提：抓包里带着这条券条件');
 assert.equal(missionConditions(q,'acceptCondition').some(c=>c.type===7),false,'未定义的道具条件会被过滤');
 assert.equal(officialCanAccept({level:60,quests:{active:{},completed:[]},inventory:[]},q),true,'60 级空背包就能接');
 // 三个委托的奖励盒同理：没定义 → missionRewards 自动跳过，不报错、不留待补表格
 for(const [mission,box] of [[2451,1480],[2452,1481],[2453,1482]]){
  assert.equal(officialItems.has(box),false,`奖励盒 ${box} 这一版不做`);
  const rewards=missionRewards(officialMissions.get(mission));
  assert.deepEqual(rewards.rewardItems,[],`委托 ${mission} 的奖励盒没定义就不发，也不该报错`);
 }
});

test('14508：五格棋盘（0-1-2-3-100）、无 powers、报名押金只收一次',t=>{
 const h=fixture(t),p=h.p;
 accept(h,BOSS_TOURNAMENT_NPC_ID,BOSS_TOURNAMENT_MISSION);
 assert.equal(replyError(h,14502),null,'接 1305 不该被拒');
 assert.ok(p.quests.active[BOSS_TOURNAMENT_MISSION],'任务要接上');
 assert.ok(h.context.solar,'接完必须由服务端推棋盘（少了这一步玩家进不去）');
 assert.equal(h.context.solar.host,'boss-tournament');
 // 报名押金 escortCost=[0,10,50000]：10 白银 + 50000 铜币，只收一次
 assert.equal(p.silver,40,'要扣 10 白银');
 assert.equal(p.coins,250000,'要扣 50000 铜币');
 assert.ok(p.quests.active[BOSS_TOURNAMENT_MISSION].solarDepositPaid);
 const board=parseBoard(h.sent.find(x=>x.type===14508).bytes);
 assert.deepEqual(board.triple,[p.gold,p.silver,p.coins],'棋盘包头部要带三币种');
 assert.equal(board.version,1);
 assert.equal(board.count,5);
 assert.deepEqual(board.cells.map(c=>c.id),BOSS_BOARD_POINTS);
 assert.deepEqual(board.cells.map(c=>c.conn),[[1],[0,2],[1,3],[2,100],[3]],'一条直线 0-1-2-3-100');
 assert.deepEqual(board.powers,[1,0],'BOSS 棋盘没有 powers（尾两字节 1 / 0）');
 assert.deepEqual(board.cells.map(c=>[c.x,c.y]),[[280,400],[230,310],[165,210],[100,110],[65,390]],'坐标照社区版同一处');
 assert.equal(board.cells[0].passed,true,'起点格算已通过');
 assert.equal(board.pos,0,'从起点开始');
 assert.equal(board.done,0,'一格都还没通过（passed.size-1）');
 const silver=p.silver,coins=p.coins;
 accept(h,BOSS_TOURNAMENT_NPC_ID,BOSS_TOURNAMENT_MISSION);
 assert.equal(replyError(h,14502),null,'任务在身上时再点一次是「重开棋盘」');
 assert.equal(p.silver,silver,'重开棋盘不重复扣报名费');
 assert.equal(p.coins,coins);
 assert.ok(h.context.solar,'重开要把棋盘接回来');
});

test('不在新月古镇广场 / 身上没有 1305 时，棋盘段绝不认领包',t=>{
 const h=fixture(t);
 // 14 号图上没有 1305 → 不认领（否则玩家一站到广场就弹棋盘）
 const empty=new Reader(Buffer.alloc(0));
 assert.equal(handleSolarChallenge(14508,empty,h.context,{send:()=>{},store:h.store,log(){}}),false);
 assert.equal(handleSolarChallenge(14510,new Reader(new Writer().byte(1).byte(0).done()),h.context,{send:()=>{},store:h.store,log(){}}),false);
 // 有 1305 但人在别的图上 → 也不认领
 accept(h,BOSS_TOURNAMENT_NPC_ID,BOSS_TOURNAMENT_MISSION);
 assert.ok(h.context.solar);
 h.p.mapId=19;
 const other=new Reader(Buffer.alloc(0));
 assert.equal(handleSolarChallenge(14508,other,h.context,{send:()=>{},store:h.store,log(){}}),false,'棋盘只在各自的地图图上认领');
});

test('五格走完才许交付：每格 14514 → 打赢 → 走到 100 才置 solarDone',t=>{
 const h=fixture(t),p=h.p,q=officialMissions.get(BOSS_TOURNAMENT_MISSION);
 accept(h,BOSS_TOURNAMENT_NPC_ID,BOSS_TOURNAMENT_MISSION);
 assert.equal(replyError(h,14502),null);
 // 一接完就是「未完成」—— 全靠 solarDone 拦着（1305 的 submitCondition 是空的）
 assert.equal(officialComplete(p,q),false,'没走完棋盘不算完成');
 deliver(h,BOSS_TOURNAMENT_NPC_ID,BOSS_TOURNAMENT_MISSION);
 assert.match(replyError(h,14503)||'',/请先结束棋盘挑战/,'棋盘还开着不许交付');
 for(const stage of BOSS_TOURNAMENT_STAGES){
  h.call(14510,new Writer().byte(stage.cell).byte(0).done());
  assert.equal(replyError(h,14510),null,`走向 ${stage.cell} 号格不该被拒`);
  const move=new Reader(h.sent.filter(x=>x.type===14510).at(-1).bytes);
  assert.equal(move.byte(),1,'有事件的格子要回「挑战」文案');
  move.string();
  assert.equal(move.short(),stage.cell,'回包里的对手号就是格子号');
  move.string();move.int();move.int();
  assert.equal(move.byte(),1);assert.equal(move.byte(),stage.cell,'回包要带格子号');
  assert.equal(move.pos,move.b.length,'移动回包不该有多余字节');
  h.call(14514,new Writer().short(stage.cell).done());
  assert.equal(pendingSolarGroup(h.context),stage.group,'14514 要给出这一格的编队');
  const choice=new Reader(h.sent.filter(x=>x.type===14514).at(-1).bytes);
  assert.equal(choice.byte(),0);assert.equal(choice.short(),stage.group);assert.equal(choice.pos,choice.b.length);
  const reply=settleSolarBattle(h.context,p,stage.group);
  assert.equal(reply.type,14508,'打赢要回一个待补发的棋盘包');
  assert.ok(p.quests.active[BOSS_TOURNAMENT_MISSION].solarBoard.passed.includes(stage.cell),'通过状态要落存档');
 }
 assert.equal(h.context.solar.completed,true,'打完 3 号（古龙-多拉斯）才算赛程完成');
 assert.equal(p.quests.active[BOSS_TOURNAMENT_MISSION].solarBoard.completed,true);
 assert.equal(officialComplete(p,q),false,'还没走到交付格');
 h.call(14510,new Writer().byte(100).byte(0).done());
 assert.equal(replyError(h,14510),null,'完成之后才能走到 100 号交付格');
 assert.equal(p.quests.active[BOSS_TOURNAMENT_MISSION].solarDone,true,'走到交付格才置 solarDone');
 assert.equal(officialComplete(p,q),true);
 h.call(14511,new Writer().short(0).done());
 assert.equal(h.context.solar,null,'结束赛程后清掉棋盘');
 deliver(h,BOSS_TOURNAMENT_NPC_ID,BOSS_TOURNAMENT_MISSION);
 assert.equal(replyError(h,14503),null,'走完棋盘应该能交付（没有奖励盒也不该拒）');
 assert.ok(p.quests.completed.includes(BOSS_TOURNAMENT_MISSION),'交付后进完成表');
});

test('棋盘外打同图战斗不该改棋盘进度（settle 守卫）',t=>{
 const h=fixture(t),p=h.p;
 accept(h,BOSS_TOURNAMENT_NPC_ID,BOSS_TOURNAMENT_MISSION);
 h.context.solar.board.pos=1;
 // 站在 1 号格、却打赢了 3 号格那一场（比如直接在 NPC 处打委托目标）→ 不记通过
 h.context.solar.pendingGroup=30152;
 settleSolarBattle(h.context,p,30152);
 assert.deepEqual([...h.context.solar.board.passed],[0],'不该把 1 号格记成通过');
 assert.equal(h.context.solar.pendingGroup,0,'pending 无论如何都要清掉');
 // 打赢当前格那一场才记
 settleSolarBattle(h.context,p,30150);
 assert.deepEqual([...h.context.solar.board.passed],[0,1]);
 assert.equal(h.context.solar.completed,false,'中间格不算完成');
});

test('端到端：接三个委托 → 12501 打棋盘编队 → 12502 记击杀并补发棋盘',t=>{
 const h=fixture(t),p=h.p;
 // 三个奖励委托和棋盘在同一个 NPC 上；先接上，打棋盘时击杀才会算进去
 for(const id of [2452,2451,2453]){
  accept(h,BOSS_TOURNAMENT_NPC_ID,id);
  assert.equal(replyError(h,14502),null,`委托 ${id} 要能接（前置只有等级 60）`);
 }
 accept(h,BOSS_TOURNAMENT_NPC_ID,BOSS_TOURNAMENT_MISSION);
 assert.equal(replyError(h,14502),null);
 // 走到 1 号格（巨石神兵）并选对手
 h.call(14510,new Writer().byte(1).byte(0).done());
 h.call(14514,new Writer().short(1).done());
 const group=pendingSolarGroup(h.context);
 assert.equal(group,30150);
 p.battles.cooldowns[group]=0;
 // 棋盘编队不在地图刷怪点上：必须跳过「站在 NPC 旁边」的校验才能开打
 h.call(12501,new Writer().short(group).done());
 assert.equal(h.context.battle?.group,group,'棋盘编队要能直接开打');
 assert.deepEqual(h.context.battle.monsters,[3315],'这一格只打巨石神兵');
 assert.equal(h.context.battle.solarMission,BOSS_TOURNAMENT_MISSION,'要标成棋盘战斗');
 assert.equal(pendingSolarGroup(h.context),0,'开战后清掉 pending，别让下一场战斗认它');
 // 打赢：击杀计入 2452（巨石神兵那一场），棋盘也要记这一格
 const battle=h.context.battle;
 h.call(12502,new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(battle.group).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(battle.token).byte(2).done());
 assert.equal(p.quests.active[2452].counts?.[3315],1,'打棋盘同时攒委托击杀数');
 assert.equal(officialComplete(p,officialMissions.get(2452)),true,'委托 2452 只剩交付');
 assert.ok(p.quests.active[BOSS_TOURNAMENT_MISSION].solarBoard.passed.includes(1),'棋盘记下这一格');
 assert.equal(h.sent.filter(x=>x.type===14508).length,2,'12502 回包之后还要再推一次棋盘（接任务时一次 + 打赢补发一次）');
});

test('幂等：重复注入不重复 push 怪物 / 编队，也不改写已有 wire',()=>{
 const groupWires=new Map(official.groups.filter(g=>BOSS_TOURNAMENT_STAGES.some(s=>s.group===g.groupId)).map(g=>[g.groupId,g.wireBase64]));
 const monsterWires=new Map([3315,3314].map(id=>[id,officialMonsters.get(id).wireBase64]));
 const monsters=official.monsters.length,groups=official.groups.length;
 const result=applyBossTournament(official);
 assert.deepEqual(result.monsters,[],'怪物不该重复造');
 assert.deepEqual(result.groups,[],'编队不该重复造');
 assert.deepEqual(result.missions,[],'任务入口不该重复改');
 assert.equal(result.entry,null,'入口 NPC 已经改过就不再动');
 assert.equal(official.monsters.length,monsters);
 assert.equal(official.groups.length,groups);
 for(const [id,wire] of groupWires)assert.equal(official.groups.find(g=>g.groupId===id).wireBase64,wire,`编队 ${id} 的 wire 不该变`);
 for(const [id,wire] of monsterWires)assert.equal(officialMonsters.get(id).wireBase64,wire,`怪物 ${id} 的 wire 不该变`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Writer,Reader} from '../lib/codec.mjs';
import {normalizeRole,hpMax,mpMax} from '../lib/content.mjs';
import {handleHomeFeatures} from '../lib/home-feature-service.mjs';
import {handleGame,BATTLE_TRAILER} from '../lib/game-service.mjs';
import {encodeWithSchema} from '../lib/feature-protobuf.mjs';
import {homeFeatureData,towerPreviews} from '../lib/home-feature-data.mjs';
import {official,officialGroups,officialMonsters} from '../lib/official-data.mjs';
import {mapBattleData} from '../lib/official-packets.mjs';
import {protobuf} from '../tools/capture-decoders.mjs';
import {dailyKey} from '../lib/daily-activity.mjs';
import {
 registerClimbTower,towerGroupOf,towerFloorOfGroup,towerFloor,towerLevels,towerInfo,towerCounts,
 towerFloorState,towerProgress,grantTowerFloorReward,TOWER_GROUP_BASE,TOWER_DAILY_CHALLENGE,
 towerFloorMonsterIds,LOCAL_TOWER_VARIANT_BASE,planTowerRewardRows,
} from '../lib/climb-tower.mjs';

/**
 * 永泽塔挑战（30001 / 30003 / 30005 / 13101）。
 *
 * 这些用例把「塔能不能真的打」钉在服务端行为上：
 *   注册 → 塔怪进官方表、编队居中 → 挑战扣次数并下发塔组 → 12501 开战 →
 *   12502 胜利记通关发首通 → 下一层开放 → 扫荡发奖励、记 2、不能再扫。
 */

function role(overrides={}){
 const p=normalizeRole({id:1001,name:'塔测试',level:97,job:1,race:0,sex:1,mapId:945});
 p.inventory=[{itemId:5300,slot:30,quantity:3}];
 p.quests={active:{},completed:[]};
 p.gold=1000;p.silver=0;p.coins=0;
 Object.assign(p,overrides);
 p.hp=hpMax(p);p.mp=mpMax(p);
 return p;
}
function harness(p=role()){
 const context={role:p},sent=[];
 const env={store:{save(){}},send(type,w){sent.push({type,bytes:w instanceof Writer?w.done():Buffer.from(w)});},log(){}};
 const call=(type,w)=>{
  const r=new Reader(w instanceof Writer?w.done():w);
  assert.ok(handleHomeFeatures(type,r,context,env)||handleGame(type,r,context,env),`协议 ${type} 必须被接管`);
  return sent;
 };
 return {p,context,sent,env,call,
  last:(type)=>sent.findLast(x=>x.type===type),
  notice(){const hit=sent.findLast(x=>x.type===25003);return hit?protobuf(hit.bytes,'s2c_errorNotice',homeFeatureData.schemas):null;},
 };
}
const challenge=(floorId,type=2)=>new Writer().raw(encodeWithSchema('c2s_ClimbTowerChallenge',{id:floorId,type},homeFeatureData.schemas));
const towerInfoRequest=(mode)=>new Writer().raw(encodeWithSchema('c2s_ClimbTowerInfo',{modeType:mode},homeFeatureData.schemas));
const fight=(h,result=2)=>{
 const b=h.context.battle;
 h.call(12502,new Writer().int(h.p.hp).int(h.p.mp).int(h.p.hp).int(h.p.mp).short(0).short(b.group)
  .bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(b.token).byte(result));
};

test('注册：132 层全部有编队，塔怪进官方怪物表，怪物居中排布',()=>{
 const stats=registerClimbTower();
 assert.equal(stats.groups,132,'普通塔 120 + 困难塔 12');
 assert.equal(towerLevels(1).length,120);
 assert.equal(towerLevels(2).length,12);
 // 塔怪 id 2700–3000 原本不在官方表里，注册后必须能查到（否则 12501 报「数据尚未恢复」）
 const sample=towerPreviews.get(1).monsters[0];
 assert.ok(officialMonsters.has(sample.id),'塔怪要进 officialMonsters');
 assert.equal(officialMonsters.get(sample.id).id,sample.id);
 // 编队号 = BASE + 层号，且双向可查
 assert.equal(towerGroupOf(1),TOWER_GROUP_BASE+1);
 assert.equal(towerFloorOfGroup(TOWER_GROUP_BASE+1),1);
 const group=officialGroups.get(TOWER_GROUP_BASE+1);
 assert.ok(group,'编队要进 officialGroups（12501 从这里取）');
 const filled=group.monsters.filter(id=>id>0);
 assert.deepEqual(filled,towerPreviews.get(1).monsters.map(m=>m.id));
 // 居中：3 只怪应该占 3/4/5 槽，而不是 0/1/2
 assert.deepEqual(group.monsters.slice(0,7),[0,0,0,filled[0],filled[1],filled[2],0]);
});

test('困难塔复用普通塔 id 的怪：属性 ×7 那一份要换本地号（否则打的是普通塔的弱属性）',()=>{
 registerClimbTower();
 const weakIds=towerFloorMonsterIds(10),hardIds=towerFloorMonsterIds(121);
 assert.deepEqual(weakIds,towerPreviews.get(10).monsters.map(m=>m.id),'普通塔保持原 id（老引用/预览不变）');
 assert.equal(hardIds.length,towerPreviews.get(121).monsters.length);
 // 困难塔那份（121—132 层）属性 ×7，一个 id 装不下两份 → 全部是 21000+ 的本地号
 for(const [i,id] of hardIds.entries()){
  const preview=towerPreviews.get(121).monsters[i],record=officialMonsters.get(id);
  assert.ok(id>=LOCAL_TOWER_VARIANT_BASE,`第 ${i} 只怪要换成本地号，实际 ${id}`);
  assert.equal(record.localTowerVariantOf,preview.id,'要记住自己是谁的变体');
  assert.equal(record.name,preview.name);
  assert.equal(record.hpMax,preview.hpMax);
  assert.equal(record.atkMin,preview.atkMin);
  assert.equal(record.id,id);
  // wire 头 4 字节是 int id：客户端按 wire 里的 id 认怪，必须换成新号
  assert.equal(Buffer.from(record.wireBase64,'base64').readInt32BE(0),id);
 }
 const weak=officialMonsters.get(weakIds[0]),strong=officialMonsters.get(hardIds[0]);
 assert.equal(weak.name,strong.name,'同一只怪（同名同模型）的两种属性');
 assert.equal(strong.hpMax,weak.hpMax*7,'困难塔那份是 ×7');
 // 编队槽位用的是换号后的 id（12501/模型包都按这个 id 查属性）
 assert.deepEqual(officialGroups.get(TOWER_GROUP_BASE+121).monsters.filter(Boolean),hardIds);
 // 10503 的模型包（客户端认怪的地方）也要带上换号后的那一份
 const battle=mapBattleData(945,[TOWER_GROUP_BASE+121]);
 const model=battle.monsters.find(m=>m.id===hardIds[0]);
 assert.ok(model,'模型包要带变体怪');
 assert.equal(model.hpMax,towerPreviews.get(121).monsters[0].hpMax);
 // 同一张图进普通塔第 10 层时，模型包给的还是普通塔那份（两份互不影响）
 const weakModel=mapBattleData(945,[TOWER_GROUP_BASE+10]).monsters.find(m=>m.id===weakIds[0]);
 assert.ok(weakModel,'普通塔那份也要能查到');
 assert.equal(weakModel.hpMax,weak.hpMax,'普通塔那份不能被困难塔覆盖');
 // 幂等：重复注册不产生新号
 const before=official.monsters.length;
 registerClimbTower();
 assert.equal(official.monsters.length,before);
 // 12501 开战：服务端也按新号查怪（战力/掉落都走 officialMonsters.get(id)）
 const h=harness();
 h.call(12501,new Writer().short(TOWER_GROUP_BASE+121));
 assert.equal(h.context.battle.towerFloorId,121);
 assert.deepEqual(h.context.battle.monsters,hardIds);
 assert.equal(officialMonsters.get(h.context.battle.monsters[0]).hpMax,strong.hpMax);
});

test('塔信息：真实剩余次数、层列表降序、全层开放、奖励栏是统一那条',()=>{
 const h=harness(),p=h.p;
 h.call(30001,towerInfoRequest(1));
 const info=protobuf(h.last(30002).bytes,'s2c_ClimbTowerInfo',homeFeatureData.schemas);
 assert.equal(info.infos.length,120);
 assert.equal(info.leftCount,TOWER_DAILY_CHALLENGE,'初始就是每日次数');
 assert.equal(info.totalCount,TOWER_DAILY_CHALLENGE);
 assert.equal(info.score,0);
 assert.equal(info.modeType,1);
 // 降序下发（客户端 onClimbTowerInfo 会再 reverse 一次 → 界面上第 1 层在最上面）
 assert.equal(info.infos[0].id,120);
 assert.equal(info.infos.at(-1).id,1);
 // 【单机修改】全层开放：120 层全部 state=1、openFloor=0（不再「上一层通关才开下一层」）
 assert.equal(info.infos.filter(f=>f.state!==1).length,0,'全层可挑战');
 for(const f of info.infos)assert.equal(f.openFloor,0,`第 ${f.id} 层 openFloor 必须是 0（不能兜成 1）`);
 // 奖励栏下发的就是统一那条（与实际发放一致）：50 黄金 + 傲雪凌霜礼盒 + 30 勇气勋章
 const row=f=>f.map(i=>[i.itemId,i.itemCount]).sort((a,b)=>a[0]-b[0]);
 assert.deepEqual(row(info.infos[0].first),[[-6,30],[-1,50],[100781,1]]);
 assert.deepEqual(row(info.infos[0].normal),row(info.infos[0].first));
 assert.equal(info.infos[0].first.find(i=>i.itemId===100781).name,'傲雪凌霜礼盒','名字要补齐，否则奖励栏是空名');
 // 困难塔独立计数（也是全层开放）
 h.call(30001,towerInfoRequest(2));
 const hard=protobuf(h.last(30002).bytes,'s2c_ClimbTowerInfo',homeFeatureData.schemas);
 assert.equal(hard.infos.length,12);
 assert.equal(hard.infos.at(-1).id,121);
 assert.equal(hard.infos.filter(f=>f.state!==1).length,0);
});

test('挑战：扣 1 次、回 30004、把塔组随 10503 下发，开战后清掉待下发标记',()=>{
 const h=harness(),p=h.p;
 h.call(30003,challenge(1,2));
 const cleared=protobuf(h.last(30004).bytes,'s2c_ClimbTowerChallenge',homeFeatureData.schemas);
 assert.equal(cleared.id,1);assert.equal(cleared.type,2);
 assert.equal(towerCounts(p).left,TOWER_DAILY_CHALLENGE-1);
 assert.equal(p.towerPendingGroup,TOWER_GROUP_BASE+1);
 // 10503 里要带这一组，否则客户端 World.toBattle 找不到组
 assert.ok(h.last(10503),'回包之后要推世界数据');

 h.call(12501,new Writer().short(TOWER_GROUP_BASE+1));
 assert.equal(h.context.battle.towerFloorId,1);
 assert.deepEqual(h.context.battle.monsters,towerPreviews.get(1).monsters.map(m=>m.id));
 assert.equal(p.towerPendingGroup,0,'开战后不该继续带这组');
});

test('模拟战不扣次数',()=>{
 const h=harness(),p=h.p;
 h.call(30003,challenge(1,1));
 assert.equal(towerCounts(p).left,TOWER_DAILY_CHALLENGE,'type=1 是模拟战');
 assert.equal(protobuf(h.last(30004).bytes,'s2c_ClimbTowerChallenge',homeFeatureData.schemas).type,1);
});

test('胜利：记通关、发首通奖励（统一那条：50 黄金 + 礼盒 + 30 勋章）、推一次新塔信息',()=>{
 const h=harness(),p=h.p,gold=p.gold;
 h.call(30003,challenge(1,2));
 h.call(12501,new Writer().short(TOWER_GROUP_BASE+1));
 h.sent.length=0;
 fight(h,2);
 assert.equal(towerProgress(p)['1'],1,'1 = 首通已领、扫荡待领');
 assert.equal(p.towerPoint,30,'首通给 30 枚勇气勋章');
 assert.equal(p.gold,gold+50,'首通给 50 黄金');
 assert.equal(p.inventory.find(i=>i.itemId===100781)?.quantity,1,'首通给 1 个傲雪凌霜礼盒');
 assert.ok(h.last(12100),'物品/货币要回 12100');
 assert.ok(h.last(30002),'要推一次新的塔信息');
 const info=protobuf(h.last(30002).bytes,'s2c_ClimbTowerInfo',homeFeatureData.schemas);
 assert.equal(info.infos.find(f=>f.id===1).receivedFirst,true);
 assert.equal(info.infos.find(f=>f.id===1).receivedNormal,false,'扫荡奖励还没领');
 assert.ok(h.last(30007),'积分变化要单独发 30007');
 // 同一层首通奖励只发一次：再打一次不会再给
 const before=structuredClone(p);
 p.battles.cooldowns[TOWER_GROUP_BASE+1]=0;   // 绕开「怪物正在重新出现」的 1.5 秒冷却
 h.call(30003,challenge(1,2));
 h.call(12501,new Writer().short(TOWER_GROUP_BASE+1));
 fight(h,2);
 assert.equal(p.towerPoint,before.towerPoint,'重复通关不该重复发首通奖励');
 assert.equal(p.gold,before.gold);
 assert.equal(p.inventory.find(i=>i.itemId===100781).quantity,1,'礼盒也不该再发一个');
});

test('失败不算通关（但层本来就是开的）',()=>{
 const h=harness(),p=h.p;
 h.call(30003,challenge(1,2));
 h.call(12501,new Writer().short(TOWER_GROUP_BASE+1));
 fight(h,3);
 assert.equal(towerProgress(p)['1'],undefined);
 assert.equal(towerFloorState(p,2),1,'全层开放 ⇒ 第 2 层本来就能打（不是「通关才开」）');
});

test('扫荡：扣扫荡卷 + 扣 1 次 + 发统一奖励 + 记 2；之后不能再扫',()=>{
 const h=harness(),p=h.p,gold=p.gold;
 towerProgress(p)['1']=1;   // 模拟已通关（首通已领）
 h.sent.length=0;
 h.call(30005,new Writer().int(1));
 assert.equal(h.notice(),null,'扫荡不该被拒');
 assert.equal(towerProgress(p)['1'],2);
 assert.equal(p.inventory.find(i=>i.itemId===5300).quantity,2,'扣 1 张扫荡卷');
 assert.equal(towerCounts(p).left,TOWER_DAILY_CHALLENGE-1);
 assert.equal(p.towerPoint,30,'扫荡给 30 枚勇气勋章');
 assert.equal(p.gold,gold+50,'扫荡给 50 黄金');
 assert.equal(p.inventory.find(i=>i.itemId===100781)?.quantity,1);
 assert.ok(h.last(30006),'要回 s2c_ClimbTowerSweep');
 assert.ok(h.last(12100),'物品/货币走 12100');

 h.sent.length=0;
 h.call(30005,new Writer().int(1));
 assert.match(h.notice().errMsg,/已经领过/);
});

test('扫荡的三道门：未通关 / 没扫荡卷 / 次数用完',()=>{
 const h=harness(),p=h.p;
 h.call(30005,new Writer().int(1));
 assert.match(h.notice().errMsg,/尚未通关/);

 towerProgress(p)['1']=1;
 p.inventory=[];
 h.sent.length=0;
 h.call(30005,new Writer().int(1));
 assert.match(h.notice().errMsg,/缺少「扫荡卷」/);

 p.inventory=[{itemId:5300,slot:30,quantity:1}];
 p.tower={day:dailyKey(),used:TOWER_DAILY_CHALLENGE,bought:0};
 h.sent.length=0;
 h.call(30005,new Writer().int(1));
 assert.match(h.notice().errMsg,/次数已用完/);
});

test('全层开放：任意层都能直接挑战（不用先通关前面的楼层）',()=>{
 const h=harness(),p=h.p;
 h.call(30003,challenge(5,2));
 assert.equal(h.notice(),null,'第 5 层不该再被「尚未开放」拦住');
 assert.equal(towerCounts(p).left,TOWER_DAILY_CHALLENGE-1);
 // 困难塔也一样（两个塔的进度互不影响，也不需要先打普通塔）
 h.sent.length=0;
 h.call(30003,challenge(122,2));
 assert.equal(h.notice(),null,'困难塔第 2 关直接可打');
 // 不存在的层仍然要拒，并且不能动上一次留下的待下发标记
 const pending=p.towerPendingGroup;
 h.sent.length=0;
 h.call(30003,challenge(9999,2));
 assert.match(h.notice().errMsg,/没有这一层/);
 assert.equal(p.towerPendingGroup,pending,'被拒时不能留下待下发标记');
});

test('次数用完时拒绝实战挑战，模拟战仍然可以',()=>{
 const h=harness(),p=h.p;
 p.tower={day:dailyKey(),used:TOWER_DAILY_CHALLENGE,bought:0};
 h.call(30003,challenge(1,2));
 assert.match(h.notice().errMsg,/次数已用完/);
 h.sent.length=0;
 h.call(30003,challenge(1,1));
 assert.equal(h.notice(),null,'模拟战不消耗次数，应该放行');
});

test('跨天重置次数，通关记录保留',()=>{
 const h=harness(),p=h.p;
 p.tower={day:'2000-01-01',used:TOWER_DAILY_CHALLENGE,bought:0};
 towerProgress(p)['1']=2;
 assert.equal(towerCounts(p).left,TOWER_DAILY_CHALLENGE,'换一天次数回满');
 assert.equal(towerProgress(p)['1'],2,'通关记录不清');
});

test('奖励发放：每层统一那条（50 黄金 + 礼盒 ×1 + 30 勋章），抓包原表不再使用',()=>{
 const p=role(),gold=p.gold;
 const plan=grantTowerFloorReward(p,1,true);
 assert.deepEqual(plan.skipped,[]);
 assert.equal(plan.currencies.gold,50);
 assert.equal(plan.towerScore,30);
 assert.equal(p.gold,gold+50);
 assert.equal(p.towerPoint,30);
 assert.deepEqual(plan.added.map(i=>i.instance.itemId),[100781]);
 // 首通与扫荡同一条
 const q=role();
 assert.deepEqual(grantTowerFloorReward(q,60,false).currencies,grantTowerFloorReward(q,1,true).currencies);
 // 抓包那份每层奖励（1759/1760/1770 宝箱）**仍然原样躺在数据文件里**，只是服务端不再发它
 assert.ok(homeFeatureData.tower[0].levels[0].first.some(r=>r.itemId===1759),'记录表不改（一字节不改）');
 assert.ok(towerFloor(1).first.some(r=>r.itemId===1759),'towerFloor 仍然带记录行');
});

test('奖励发放：缺定义的道具跳过并记账，货币按 -1/-2/-3/-6 分流',()=>{
 const p=role();
 const plan=planTowerRewardRows(p,[{itemId:1759,itemCount:1},{itemId:-2,itemCount:30},{itemId:-6,itemCount:10},{itemId:-3,itemCount:50000},{itemId:-1,itemCount:5}]);
 assert.deepEqual(plan.skipped,[1759],'1759 没有道具定义，跳过');
 assert.deepEqual(plan.currencies,{gold:5,silver:30,coins:50000});
 assert.equal(plan.towerScore,10);
 assert.equal(p.gold,1005);assert.equal(p.silver,30);assert.equal(p.coins,50000);assert.equal(p.towerPoint,10);
 assert.equal(plan.added.length,0);
});

test('扫描：每层都有 preview，13101 原样回放 bodyBase64',()=>{
 const h=harness();
 for(const id of [1,60,120,121,132]){
  assert.ok(towerPreviews.has(id),`第 ${id} 层要有 preview`);
  h.call(13101,new Writer().int(id));
  assert.deepEqual(h.last(13101).bytes,Buffer.from(towerPreviews.get(id).bodyBase64,'base64'));
 }
 h.sent.length=0;
 h.call(13101,new Writer().int(9999));
 assert.match(h.notice().errMsg,/尚未采集/);
});

test('客户端桥接：点「挑战」要真进战斗，塔组基数与服务端一致',async()=>{
 const source=await readFile(new URL('../web/home-features.js',import.meta.url),'utf8');
 // 客户端原生收到 30004 后没有任何模块去进战斗（TowerEvent.TowerChallenge 无人监听），
 // 桥接必须自己调 World.toBattle，否则表现就是「点了挑战没反应」。
 assert.match(source,/World\.toBattle\(/,'点挑战要能进战斗，必须调 World.toBattle');
 // 触发条件用「收到塔组」而不是「发过请求」：服务端只在受理时才把塔组随 10503 下发，
 // 被拒（次数用尽/未开放）只回 25003，所以「收到塔组」才是可靠的开始信号。
 assert.match(source,/World\.addMonsterGroup=/,'要靠 World.addMonsterGroup 在收到塔组时开战');
 assert.match(source,/sendClimbTowerChallenge/,'要接管原生挑战发送');
 // 旧的占位补丁把 30003/30005 直接吞掉，删干净才算真修好。
 assert.doesNotMatch(source,/挑战和扫荡待补/,'旧的「待补」占位必须删掉，否则 30003 根本不发');
 // 塔组号 = BASE + 层号，客户端不能自己乱写一个基数。
 const hit=source.match(/TOWER_GROUP_BASE=(\d+)/);
 assert.ok(hit,'客户端要声明 TOWER_GROUP_BASE');
 assert.equal(Number(hit[1]),TOWER_GROUP_BASE,'客户端组号基数必须与 lib/climb-tower.mjs 一致');
});
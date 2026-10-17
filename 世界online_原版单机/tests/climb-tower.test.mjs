import test from 'node:test';
import assert from 'node:assert/strict';
import {Writer,Reader} from '../lib/codec.mjs';
import {normalizeRole,hpMax,mpMax} from '../lib/content.mjs';
import {handleHomeFeatures} from '../lib/home-feature-service.mjs';
import {handleGame,BATTLE_TRAILER} from '../lib/game-service.mjs';
import {encodeWithSchema} from '../lib/feature-protobuf.mjs';
import {homeFeatureData,towerPreviews} from '../lib/home-feature-data.mjs';
import {officialGroups,officialMonsters} from '../lib/official-data.mjs';
import {protobuf} from '../tools/capture-decoders.mjs';
import {dailyKey} from '../lib/daily-activity.mjs';
import {
 registerClimbTower,towerGroupOf,towerFloorOfGroup,towerFloor,towerLevels,towerInfo,towerCounts,
 towerFloorState,towerProgress,grantTowerFloorReward,TOWER_GROUP_BASE,TOWER_DAILY_CHALLENGE,
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

test('塔信息：真实剩余次数、层列表降序、state 反映逐层解锁',()=>{
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
 // 只有第 1 层可挑战
 assert.equal(info.infos.find(f=>f.id===1).state,1);
 assert.equal(info.infos.find(f=>f.id===2).state,0);
 assert.equal(info.infos.find(f=>f.id===1).openFloor,0,'第 1 层必须直接开放（0 不能被兜成 1）');
 // 困难塔独立计数
 h.call(30001,towerInfoRequest(2));
 const hard=protobuf(h.last(30002).bytes,'s2c_ClimbTowerInfo',homeFeatureData.schemas);
 assert.equal(hard.infos.length,12);
 assert.equal(hard.infos.at(-1).id,121);
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

test('胜利：记通关、发首通奖励（勇气勋章/银币）、立刻推送新塔信息点亮下一层',()=>{
 const h=harness(),p=h.p;
 h.call(30003,challenge(1,2));
 h.call(12501,new Writer().short(TOWER_GROUP_BASE+1));
 h.sent.length=0;
 fight(h,2);
 assert.equal(towerProgress(p)['1'],1,'1 = 首通已领、扫荡待领');
 assert.equal(p.towerPoint,10,'第 1 层首通给 10 枚勇气勋章');
 assert.equal(p.silver,30,'首通还给 30 银');
 assert.equal(officialMonsters.size>0,true);
 // 首通奖励里的 1759（初级宝箱）在抓包里没有道具定义，必须跳过而不是让结算失败
 assert.ok(h.last(30002),'要推一次新的塔信息');
 const info=protobuf(h.last(30002).bytes,'s2c_ClimbTowerInfo',homeFeatureData.schemas);
 assert.equal(info.infos.find(f=>f.id===1).receivedFirst,true);
 assert.equal(info.infos.find(f=>f.id===1).receivedNormal,false,'扫荡奖励还没领');
 assert.equal(info.infos.find(f=>f.id===2).state,1,'第 2 层要开放');
 assert.ok(h.last(30007),'积分变化要单独发 30007');
 // 同一层首通奖励只发一次：再打一次不会再给
 const before=structuredClone(p);
 p.battles.cooldowns[TOWER_GROUP_BASE+1]=0;   // 绕开「怪物正在重新出现」的 1.5 秒冷却
 h.call(30003,challenge(1,2));
 h.call(12501,new Writer().short(TOWER_GROUP_BASE+1));
 fight(h,2);
 assert.equal(p.towerPoint,before.towerPoint,'重复通关不该重复发首通奖励');
 assert.equal(p.silver,before.silver);
});

test('失败不算通关',()=>{
 const h=harness(),p=h.p;
 h.call(30003,challenge(1,2));
 h.call(12501,new Writer().short(TOWER_GROUP_BASE+1));
 fight(h,3);
 assert.equal(towerProgress(p)['1'],undefined);
 assert.equal(towerFloorState(p,2),0,'没通关就不该开放下一层');
});

test('扫荡：扣扫荡卷 + 扣 1 次 + 发 normal 奖励 + 记 2；之后不能再扫',()=>{
 const h=harness(),p=h.p;
 towerProgress(p)['1']=1;   // 模拟已通关（首通已领）
 h.sent.length=0;
 h.call(30005,new Writer().int(1));
 assert.equal(h.notice(),null,'扫荡不该被拒');
 assert.equal(towerProgress(p)['1'],2);
 assert.equal(p.inventory.find(i=>i.itemId===5300).quantity,2,'扣 1 张扫荡卷');
 assert.equal(towerCounts(p).left,TOWER_DAILY_CHALLENGE-1);
 assert.equal(p.towerPoint,10,'扫荡 normal 给 10 枚');
 assert.equal(p.coins,50000,'normal 还给 5 万铜币');
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

test('越级挑战被服务端拦住（客户端不能绕过解锁）',()=>{
 const h=harness();
 h.call(30003,challenge(5,2));
 assert.match(h.notice().errMsg,/尚未开放/);
 // 困难塔也要先打普通塔？不需要 —— 两座塔独立，但困难塔第 2 层要先进度
 h.sent.length=0;
 h.call(30003,challenge(122,2));
 assert.match(h.notice().errMsg,/尚未开放/);
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

test('奖励发放：缺定义的道具跳过并记账，货币按 -1/-2/-3/-6 分流',()=>{
 const p=role();
 const plan=grantTowerFloorReward(p,1,true);   // 第 1 层首通 [-2,30],[1759,1],[-6,10]
 assert.deepEqual(plan.skipped,[1759],'1759 没有道具定义，跳过');
 assert.equal(plan.currencies.silver,30);
 assert.equal(plan.towerScore,10);
 assert.equal(p.silver,30);assert.equal(p.towerPoint,10);
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

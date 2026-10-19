import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {official,officialMonsters,officialGroups} from '../lib/official-data.mjs';
import {battleSupported} from '../lib/official-rules.mjs';
import {TRIAL_GROUP_ID,TRIAL_BOSSES,TRIAL_BOSS_HP,TRIAL_BUY_GOLD,TRIAL_DAILY_CHALLENGE,trialBossAt} from '../lib/trial-challenge-data.mjs';
import {trialSnapshot,trialCounts,planTrialAction,settleTrialBattleAndNotify,trialExtraGroups,TRIAL_ACTIONS,TRIAL_REWARD_TIERS,isTrialGroup} from '../lib/trial-challenge.mjs';
import {planHomeAction} from '../lib/home-features.mjs';
import {handleHomeFeatures} from '../lib/home-feature-service.mjs';
import {SaveStore} from '../lib/store.mjs';
import {Reader,Writer} from '../lib/codec.mjs';

const role=()=>({id:1,name:'测试',gold:1000,silver:0,coins:0,inventory:[],level:90,quests:{active:{},completed:{}},skills:{}});
const sent=[];const send=(type,body)=>sent.push({type,bytes:body?.done?body.done():body});

test('无限试炼：三只 BOSS 注册进怪物表，编队 24000 里 BOSS 居中',()=>{
 for(const boss of TRIAL_BOSSES){
  const m=officialMonsters.get(boss.id);
  assert.ok(m,`BOSS ${boss.id} 要在怪物表里`);
  assert.equal(m.hpMax,TRIAL_BOSS_HP,'生命按本地配置统一');
  assert.ok(m.sources.some(s=>s.origin==='local-trial-boss'),'要标明是本地配的');
  assert.ok(m.wireBase64,'要有 wire');
  // 只留一种主打伤害：另外两种必须被压低
  for(const key of ['atk_str','atk_agi','atk_magic'])if(key!==boss.main)assert.ok(m[key]<(officialMonsters.get(1735)[key]||0),`${boss.name} 的 ${key} 该被压低`);
 }
 assert.ok(officialGroups.has(TRIAL_GROUP_ID),'试炼编队要注册');
 const group=officialGroups.get(TRIAL_GROUP_ID);
 assert.equal(group.monsters[5],trialBossAt().id,'BOSS 居中（10 槽的第 6 格）');
 assert.equal(battleSupported(TRIAL_GROUP_ID),true,'这一组要能开打');
 assert.equal(isTrialGroup(TRIAL_GROUP_ID),true);
});

test('BOSS 按时间段轮换：0-12 劈砍 / 12-18 穿刺 / 18-24 魔法',()=>{
 const at=hour=>trialBossAt(Date.parse('2026-10-17T'+String(hour).padStart(2,'0')+':00:00+08:00'));
 assert.equal(at(3).id,20001);assert.equal(at(15).id,20003);assert.equal(at(21).id,20002);
});

test('快照：BOSS、次数、奖励档位都下发，奖励道具必须真有定义',()=>{
 const p=role(),snapshot=trialSnapshot(p);
 assert.equal(snapshot.available,true);
 assert.equal(snapshot.boss.id,trialBossAt().id);
 assert.equal(snapshot.bosses.length,3);
 assert.equal(snapshot.challenge.left,TRIAL_DAILY_CHALLENGE,'每天 3 次');
 assert.equal(snapshot.challenge.buyPrice,TRIAL_BUY_GOLD);
 assert.equal(snapshot.rewards.length,3);
 // 缺定义的道具会让 planItemRewards 整包抛错 —— 这里每一件都必须能查到。
 for(const tier of TRIAL_REWARD_TIERS)for(const item of tier.items)
  assert.ok(official.items.some(i=>i.id===item.id),`奖励道具 ${item.id} 没有定义`);
 for(const tier of snapshot.rewards)for(const item of tier.items)assert.ok(item.name&&!item.name.startsWith('物品'),item.name);
});
test('查快照是纯读：不能给角色凭空长出 trial 字段（否则存档被查面板改脏）',()=>{
 const p=role(),before=structuredClone(p);
 trialSnapshot(p);trialCounts(p);trialExtraGroups(p);
 assert.deepEqual(p,before);
 // 写入路径（买次数）才落盘，且买的次数要真的持久化。
 const bought=planTrialAction(p,{action:'trial-buy'},null);
 assert.ok(p.trial,'买完才应该有 p.trial');
 assert.equal(p.trial.bought,1);
 assert.equal(p.gold,before.gold-TRIAL_BUY_GOLD);
 assert.equal(trialCounts(p).left,TRIAL_DAILY_CHALLENGE+1,'只读的 counts 也要看到写进去的次数');
});

test('trial-buy：扣黄金买次数，达到上限或黄金不足都拒绝',()=>{
 const p=role(),now=Date.now();
 const result=planTrialAction(p,{action:'trial-buy'},null,now);
 assert.equal(p.gold,1000-TRIAL_BUY_GOLD);
 assert.equal(result.currencies.gold,-TRIAL_BUY_GOLD);
 assert.equal(trialCounts(p,now).left,TRIAL_DAILY_CHALLENGE+1,'买来的次数要算进总数');
 const poor=role();poor.gold=0;
 assert.throws(()=>planTrialAction(poor,{action:'trial-buy'},null,now),/黄金不足/);
 assert.equal(poor.gold,0,'失败的购买不能扣钱');
 const rich=role();rich.gold=100000;
 for(let i=0;i<10;i++)planTrialAction(rich,{action:'trial-buy'},null,now);
 assert.throws(()=>planTrialAction(rich,{action:'trial-buy'},null,now),/达到上限/);
 assert.equal(rich.gold,100000-10*TRIAL_BUY_GOLD);
});

test('trial-challenge：扣次数 + 记待下发组，次数用完拒绝且不留标记',()=>{
 const p=role(),now=Date.now(),context={};
 const result=planTrialAction(p,{action:'trial-challenge'},context,now);
 assert.equal(result.trialEnterBattle,TRIAL_GROUP_ID);
 assert.equal(p.trialPendingGroup,TRIAL_GROUP_ID);
 assert.equal(context.trialPendingGroup,TRIAL_GROUP_ID,'12501 靠它跳过距离校验');
 assert.equal(result.trialChallenge.left,TRIAL_DAILY_CHALLENGE-1);
 assert.deepEqual(trialExtraGroups(p),[TRIAL_GROUP_ID],'世界数据要带上这一组');
 for(let i=1;i<TRIAL_DAILY_CHALLENGE;i++)planTrialAction(p,{action:'trial-challenge'},context,now);
 assert.throws(()=>planTrialAction(p,{action:'trial-challenge'},context,now),/次数已用完/);
 assert.equal(p.trialPendingGroup,TRIAL_GROUP_ID,'用掉的那次留下的标记仍在（那一战还没打）');
});

test('打完结算：打赢吃满档、打输等客户端上报真实伤害，两边都不会重复发奖',()=>{
 const p=role(),now=Date.now(),context={};
 planTrialAction(p,{action:'trial-challenge'},context,now);
 sent.length=0;
 // ① 打赢：12502 的兜底结算直接吃最高档（服务端看不到伤害数字，但赢了 = BOSS 掉光血）
 const win=settleTrialBattleAndNotify(p,2,send,now);
 assert.ok(win,'胜利要结算');
 assert.match(win.tier,/第三阶段/,'打赢 = 打满 = 最高档');
 assert.ok(win.added.length,'要有奖励进包');
 assert.equal(p.trialPendingGroup,undefined,'结算完清掉待下发标记');
 assert.equal(p.trial.bestDamage,TRIAL_BOSS_HP);
 assert.equal(p.trial.history.length,1,'要记一条挑战记录');
 // 客户端随后（ON_BATTLE_END）上报这一场的伤害：闸门已关 → 只认记录，不再发奖
 const later=planTrialAction(p,{action:'trial-settle',damage:TRIAL_BOSS_HP},context,now);
 assert.equal(later.trialGrantedCount,0,'12502 已经发过，上报这一路不能再发');
 assert.equal(later.items.length,0);
 assert.equal(later.trialTier,TRIAL_REWARD_TIERS[0].label);
 sent.length=0;
 assert.equal(settleTrialBattleAndNotify(p,2,send,now),null,'同一场不允许二次结算');
 assert.equal(sent.length,0);
 // ② 打输：服务端拿不到伤害数字 → 不发奖，等客户端上报的真实比例定档
 const p2=role();planTrialAction(p2,{action:'trial-challenge'},context,now);
 assert.equal(settleTrialBattleAndNotify(p2,1,send,now),null,'输了不在 12502 里发奖');
 assert.equal(p2.trial.bestDamage,0);
 assert.equal(p2.trial.awarded,false,'闸门还开着，等客户端上报');
 const hurt=Math.floor(TRIAL_BOSS_HP*0.3);
 const report=planTrialAction(p2,{action:'trial-settle',damage:hurt},context,now);
 assert.match(report.trialTier,/第二阶段/,'按上报的真实伤害定档');
 assert.equal(report.trialGrantedCount,2,'第二阶段两件（宠物经验卷 + 人物经验卷）');
 assert.equal(report.bestDamage,hurt,'最高伤害要按上报值刷新');
 assert.equal(p2.trial.history.length,1);
 assert.equal(p2.trial.history[0].hurt,hurt);
 // 同一场再上报（哪怕伤害更高）：闸门已关，一件都不发
 const again=planTrialAction(p2,{action:'trial-settle',damage:TRIAL_BOSS_HP},context,now);
 assert.equal(again.trialGrantedCount,0,'同一场不重复发奖');
 assert.equal(again.items.length,0);
 assert.equal(p2.trial.bestDamage,TRIAL_BOSS_HP,'记录还是可以刷新的');
});
test('挑战记录只留最近 20 条，且跨天不清（快照里带 history）',()=>{
 const p=role(),base=Date.now(),context={};
 let count=0;
 // 每天 3 次挑战，跨几天攒够 25 场（顺带验证记录不会因为跨天被清掉）。
 for(let day=0;day<10&&count<25;day++){
  const now=base+day*86400000;
  for(let i=0;i<3&&count<25;i++,count++){
   planTrialAction(p,{action:'trial-challenge'},context,now);
   planTrialAction(p,{action:'trial-settle',damage:100+count},context,now);
  }
 }
 assert.equal(p.trial.history.length,20,'只留最近 20 条');
 assert.equal(p.trial.history[0].hurt,124,'最新的排在最前');
 assert.equal(p.trial.bestDamage,124,'最高伤害按上报值刷新');
 const snapshot=trialSnapshot(p,base+9*86400000);
 assert.equal(snapshot.history.length,20);
 assert.deepEqual(Object.keys(snapshot.history[0]).sort(),['fightPower','hurt','time']);
});

test('trial-config 存三只出战宠物；未知动作报错',()=>{
 const p=role();
 const result=planTrialAction(p,{action:'trial-config',pets:[7,8,9,10]},null);
 assert.deepEqual(result.trialPets,['7','8','9'],'最多三个槽位');
 assert.throws(()=>planTrialAction(p,{action:'trial-unknown'},null),/未知的试炼操作/);
});

test('90020 能接住四个试炼动作（快照里 trial 不再是待补）',()=>{
 const p=role();
 assert.deepEqual(TRIAL_ACTIONS,['trial-buy','trial-config','trial-challenge','trial-settle']);
 for(const action of TRIAL_ACTIONS){
  const fresh=role();fresh.gold=1000;
  const plan=planHomeAction(fresh,{action,role:fresh.id,...(action==='trial-config'?{pets:[1]}:{})},null);
  assert.equal(plan.action,action);
 }
 const entry=planHomeAction(role(),{action:'charge',currency:'gold',amount:1},null);
 assert.equal(entry.action,'charge');
 // trial 已从 pending 列表里摘掉
 const snapshot=trialSnapshot(role());
 assert.equal(snapshot.available,true);
});

test('90020 整条链路：挑战 → 打赢结算 → 客户端上报，试炼界面要的数据都回得去',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-trial-'));
 try{
  const now=Date.now(),db=new SaveStore(dir),p=role();
  // 走服务端就绕不过 homeSnapshot → dailySnapshot：completed 必须是数组（真存档就是数组）。
  p.quests={active:{},completed:[]};p.bagLimit=300;p.inventory=[];db.data.characters=[p];db.save();
  const context={role:p,homeOnlineStart:now},sent=[];
  const call=value=>{
   sent.length=0;
   handleHomeFeatures(90020,new Reader(new Writer().string(JSON.stringify({...value,role:p.id})).done()),context,
    {now,store:db,send(type,body){sent.push({type,bytes:body instanceof Writer?body.done():body});},log(){}});
   const reply=sent.find(x=>x.type===90020);
   assert.ok(reply,'每个动作都要有回包');
   const reader=new Reader(reply.bytes),status=reader.byte();
   assert.equal(status,0,'动作要被受理');
   return JSON.parse(reader.string());
  };
  // ① 发起挑战：世界数据里要带试炼组（客户端 World.addMonsterGroup 收到它才开战）
  const challenge=call({action:'trial-challenge'});
  assert.equal(challenge.trial.challenge.left,TRIAL_DAILY_CHALLENGE-1);
  assert.ok(sent.some(x=>x.type===10503),'要顺手重推一次含试炼组的世界数据');
  // ② 打赢：12502 的兜底结算先发奖（这里直接调 lib 函数，模拟 game-service 的调用点）
  const win=settleTrialBattleAndNotify(p,2,(type,body)=>sent.push({type,bytes:body?.done?body.done():body}),now);
  assert.match(win.tier,/第三阶段/);
  // ③ 客户端战斗结束时上报这一场的伤害（试炼界面就靠这条刷新记录 + 弹提示）
  const report=call({action:'trial-settle',damage:Math.floor(TRIAL_BOSS_HP*0.3)});
  assert.match(report.trialReport.tier,/第二阶段/,'档位按上报的伤害算');
  assert.equal(report.trialReport.granted,0,'奖励已经由 12502 发过了，这条不能再发');
  assert.equal(report.trialReport.bestDamage,TRIAL_BOSS_HP,'最高伤害以满血记录为准');
  assert.equal(report.trial.history.length,1,'快照里要带挑战记录（原版记录页要用）');
  // 奖励真的进存档了（第三阶段 100897 × 2）
  const restored=new SaveStore(dir).data.characters[0];
  assert.equal(restored.inventory.find(i=>i.itemId===100897)?.quantity,2);
  assert.equal(restored.inventory.find(i=>i.itemId===40006),undefined,'第二阶段的奖励一件都不能多给');
 }finally{
  const exact=fs.realpathSync(dir);
  assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-trial-'));
  fs.rmSync(exact,{recursive:true});
 }
});

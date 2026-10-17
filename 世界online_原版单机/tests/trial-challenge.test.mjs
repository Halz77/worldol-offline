import test from 'node:test';
import assert from 'node:assert/strict';
import {official,officialMonsters,officialGroups} from '../lib/official-data.mjs';
import {battleSupported} from '../lib/official-rules.mjs';
import {TRIAL_GROUP_ID,TRIAL_BOSSES,TRIAL_BOSS_HP,TRIAL_BUY_GOLD,TRIAL_DAILY_CHALLENGE,trialBossAt} from '../lib/trial-challenge-data.mjs';
import {trialSnapshot,trialCounts,planTrialAction,settleTrialBattleAndNotify,trialExtraGroups,TRIAL_ACTIONS,TRIAL_REWARD_TIERS,isTrialGroup} from '../lib/trial-challenge.mjs';
import {planHomeAction} from '../lib/home-features.mjs';

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

test('打完自动结算：赢吃满档、输吃参与档，且不会重复发奖',()=>{
 const p=role(),now=Date.now(),context={};
 planTrialAction(p,{action:'trial-challenge'},context,now);
 sent.length=0;
 const win=settleTrialBattleAndNotify(p,2,send,now);
 assert.ok(win,'胜利要结算');
 assert.match(win.tier,/第三阶段/,'打赢 = 打满 = 最高档');
 assert.ok(win.added.length,'要有奖励进包');
 assert.equal(p.trialPendingGroup,undefined,'结算完清掉待下发标记');
 assert.equal(p.trial.bestDamage,TRIAL_BOSS_HP);
 // 再结算一次：没有 pending → 不发奖
 sent.length=0;
 assert.equal(settleTrialBattleAndNotify(p,2,send,now),null,'不能重复发奖');
 assert.equal(sent.length,0);
 // 失败：参与档
 const p2=role();planTrialAction(p2,{action:'trial-challenge'},context,now);
 const lose=settleTrialBattleAndNotify(p2,1,send,now);
 assert.match(lose.tier,/第一阶段/);
 assert.equal(p2.trial.bestDamage,0);
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

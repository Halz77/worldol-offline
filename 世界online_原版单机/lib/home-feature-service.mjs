import {Writer} from './codec.mjs';
import {encodeWithSchema} from './feature-protobuf.mjs';
import {protobuf} from '../tools/capture-decoders.mjs';
import {homeFeatureData,vipBenefits,towerPreviews} from './home-feature-data.mjs';
import {homeSnapshot,planHomeAction,checkpointOnline} from './home-features.mjs';
import {gainItemsPacket,notifyDaily} from './daily-service.mjs';
import {worldData} from './world.mjs';
import {
 towerInfo,towerFloor,towerGroupOf,towerFloorState,towerCounts,towerState,towerProgress,
 grantTowerFloorReward,towerScorePacket,TOWER_DAILY_CHALLENGE,
} from './climb-tower.mjs';

const encode=(type,p)=>encodeWithSchema(type,p,homeFeatureData.schemas);
const restore=(p,before)=>{for(const k of Object.keys(p))if(!(k in before))delete p[k];Object.assign(p,before);};
export function flushHomeSession(context,store,now=Date.now()){
 if(!context.role||!Number.isFinite(context.homeOnlineStart))return;
 const before=structuredClone(context.role),start=context.homeOnlineStart;
 try{checkpointOnline(context.role,context,now);store.save();delete context.homeOnlineStart;}catch(e){restore(context.role,before);context.homeOnlineStart=start;throw e;}
}
export function handleHomeFeatures(type,r,context,{store,send,log,now=Date.now()}){
 const p=context.role;if(!p||![90019,90020,30001,30003,30005,13101].includes(type))return false;
 try{
  if(type===90019){if(r.pos!==r.b.length)throw Error('功能查询格式不正确。');send(type,new Writer().byte(0).string(JSON.stringify(homeSnapshot(p,context,now))));return true;}
  if(type===30001){
   const q=protobuf(r.b.subarray(r.pos),'c2s_ClimbTowerInfo',homeFeatureData.schemas);
   // 塔信息带真实进度：leftCount 从每日次数算，每层 state 按「上一层通关即开放」推。
   send(30002,encode('s2c_ClimbTowerInfo',towerInfo(q.modeType||1,p)));return true;
  }
  if(type===13101){const id=r.int(),preview=towerPreviews.get(id);if(r.pos!==r.b.length||!preview)throw Error('这层怪物属性尚未采集。');send(type,Buffer.from(preview.bodyBase64,'base64'));return true;}
  if(type===30003){
   // 永泽塔挑战：校验层/开放/次数 → 回 30004 → 紧接着推一次带塔组的世界数据。
   // type=2 实战（扣次数）、type=1 模拟战（不扣，客户端提示也这么写）。
   const req=protobuf(r.b.subarray(r.pos),'c2s_ClimbTowerChallenge',homeFeatureData.schemas);
   const floorId=Number(req.id)||0,fightType=Number(req.type)||1;
   const floor=towerFloor(floorId);
   if(!floor)throw Error('没有这一层。');
   if(!towerFloorState(p,floorId))throw Error('这一层尚未开放，请先通关前面的楼层。');
   const group=towerGroupOf(floorId);
   if(!group)throw Error('这一层的战斗数据尚未恢复。');
   const before=structuredClone(p);
   try{
    if(fightType===2){
     const counts=towerCounts(p,now);
     if(counts.left<=0)throw Error(`今日挑战次数已用完（每天 ${TOWER_DAILY_CHALLENGE} 次，明天恢复）。`);
     const state=towerState(p,now);
     state.used=(state.used||0)+1;
    }
    // 记下「刚挑战的是哪一组」——客户端要进本地战斗，必须先在这次 10503 里收到它，
    // 否则 World.toBattle(group) 找不到组，会改发 12503 远程战斗。
    // ⚠️ 放在所有校验之后：被拒时不能留下待下发标记。
    p.towerPendingGroup=group;
    store.save();
   }catch(error){restore(p,before);throw error;}
   send(30004,encode('s2c_ClimbTowerChallenge',{id:floorId,type:fightType}));
   send(10503,new Writer().byte(0).raw(worldData(p,true).done()));
   log('climb-tower-challenge',{role:p.id,floor:floorId,fightType,group});
   return true;
  }
  if(type===30005){
   // 扫荡：该层必须已通关（1=首通已领待扫荡 / 2=已扫过）→ 扣扫荡卷 + 扣 1 次 → 发 normal 奖励 → 记 2。
   // ⚠️ c2s_ClimbTowerSweep 的抓包 schema 是空的（当时 id=0 被省略），这里直接读 int。
   const floorId=r.int();
   if(r.pos!==r.b.length)throw Error('扫荡请求格式不正确。');
   const floor=towerFloor(floorId);
   if(!floor)throw Error('没有这一层。');
   const progress=towerProgress(p);
   const cleared=Number(progress[String(floorId)])||0;
   if(!cleared)throw Error('尚未通关该层，不能扫荡。');
   if(cleared>=2)throw Error('该层的扫荡奖励已经领过了。');
   const sweepItemId=Number(homeFeatureData.tower.find(t=>t.mode===floor.mode)?.sweepItem?.itemId)||5300;
   const before=structuredClone(p);
   let plan;
   try{
    const counts=towerCounts(p,now);
    if(counts.left<=0)throw Error('今日挑战次数已用完。');
    const bag=(p.inventory||[]).find(item=>item.slot>=30&&item.itemId===sweepItemId&&(item.quantity||1)>0);
    if(!bag)throw Error(`缺少「扫荡卷」（道具 ${sweepItemId}）。`);
    bag.quantity=(bag.quantity||1)-1;
    if(bag.quantity<=0)p.inventory=p.inventory.filter(item=>item!==bag);
    const state=towerState(p,now);
    state.used=(state.used||0)+1;
    plan=grantTowerFloorReward(p,floorId,false);
    progress[String(floorId)]=2;
    store.save();
   }catch(error){restore(p,before);throw error;}
   const hasMoney=plan.currencies.gold||plan.currencies.silver||plan.currencies.coins;
   if(plan.added.length||hasMoney)send(12100,gainItemsPacket(p,plan.added,plan.currencies));
   if(plan.towerScore)send(30007,towerScorePacket(plan.towerScore));
   send(30006,encode('s2c_ClimbTowerSweep',{id:floorId,score:p.towerPoint||0}));
   log('climb-tower-sweep',{role:p.id,floor:floorId,towerScore:plan.towerScore,skipped:plan.skipped});
   return true;
  }
  if(context.battle)throw Error('请先结束战斗再领取或调整资源。');
  const json=r.string();if(json.length>1024||r.pos!==r.b.length)throw Error('功能操作格式不正确。');
  const request=JSON.parse(json);if(request.role!==p.id)throw Error('角色已切换，请重新打开功能页面。');
  const plan=planHomeAction(p,request,context,now),before=structuredClone(p),oldStart=context.homeOnlineStart;
  try{
   const seconds=homeSnapshot(p,context,now).online.seconds;
   plan.next.homeFeatures.onlineSeconds=seconds;Object.assign(p,plan.next);context.homeOnlineStart=now;store.save();
  }catch(e){restore(p,before);context.homeOnlineStart=oldStart;throw e;}
  if(plan.added.length)send(12100,gainItemsPacket(p,plan.added,plan.currencies));
  // 无限试炼：发起挑战后要把「含试炼组的世界数据」重推一次（与永泽塔 30004 同一套做法），
  // 否则客户端 World.toBattle(group) 找不到这一组、会改发 12503 远程战斗。
  if(plan.trialEnterBattle)send(10503,new Writer().byte(0).raw(worldData(p,true).done()));
  const changes=Object.entries(plan.currencies).filter(([,value])=>value);
  if(changes.length&&!plan.added.length){const w=new Writer().byte(changes.length);for(const [key,value] of changes)w.short({gold:11,silver:12,coins:13}[key]).int(value);send(11004,w.short(13).int(0));}
  notifyDaily(p,send);
  // Acknowledge after native inventory and money packets so the UI refreshes
  // the saved values, including its event-driven currency labels.
  const payload=homeSnapshot(p,context,now);
  // 无限试炼结算：把「本次伤害 / 档位 / 这一路真发了几件」一并回给客户端弹提示
  //（打赢那份是 12502 发的，客户端上报这一路 trialGrantedCount 就是 0）。
  if(plan.action==='trial-settle')payload.trialReport={damage:plan.trialDamage||0,tier:plan.trialTier||'',
   granted:plan.trialGrantedCount||0,bestDamage:plan.bestDamage||0};
  send(type,new Writer().byte(0).string(JSON.stringify(payload)));
  log('home-feature-action',{role:p.id,action:plan.action,items:plan.items,currencies:plan.currencies});
 }catch(error){
  if(type===90019||type===90020)send(type,new Writer().byte(-1).string(error.message));
  else send(25003,encode('s2c_errorNotice',{errCode:-2,errMsg:error.message}));
  log('home-feature-rejected',{role:p.id,type,error:error.message});
 }
 return true;
}

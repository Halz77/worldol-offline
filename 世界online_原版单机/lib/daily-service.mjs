import {Writer} from './codec.mjs';
import {protobuf} from '../tools/capture-decoders.mjs';
import {encodeWithSchema} from './feature-protobuf.mjs';
import {dailyData,ensureDaily,vitalitySnapshot,taskSnapshot} from './daily-activity.mjs';
import {planItemRewards} from './restoration.mjs';
import {addedItems} from './restoration-packets.mjs';

export const encodeDaily=(type,data)=>encodeWithSchema(type,data,dailyData.schemas);
export const decodeDaily=(type,data)=>protobuf(data,type,dailyData.schemas);
function restore(p,before){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);}
export function saveDailyState(p,store){
 const before=structuredClone(p);try{ensureDaily(p);store.save();}catch(error){restore(p,before);throw error;}
}
export function vitalityPacket(p){
 const v=vitalitySnapshot(p),w=new Writer().bool(true).short(v.value).short(v.vipAdd).short(v.rewards.length);
 for(const row of v.rewards)w.short(row.threshold).byte(row.status);
 w.short(v.conditions.length);
 for(const c of v.conditions){
  w.byte(c.id).string(c.content+(c.supported?'':'（待定）')).int(c.progress).int(c.count).short(c.value).bool(c.pathFinding);
  // The recorded vitality shortcut used mission 3071 in an old city template.
  // Its restored destination is the actual daily-task NPC in the local city.
  if(c.pathFinding){const daily=c.id===3;w.byte(daily?1:c.direction).short(daily?1000:c.mapId).short(daily?6:c.npcId).string(daily?'日常任务列表':c.npcName);}
 }
 return w;
}
export function notifyDaily(p,send){
 const v=vitalitySnapshot(p);send(14555,new Writer().string(''));send(14562,new Writer().byte(v.rewards.some(r=>r.status===1)?1:0));
}
function applyReward(p,items,money){
 const plan=planItemRewards(p,items);p.inventory=plan.inventory;
 for(const key of ['gold','silver','coins']){const value=(p[key]||0)+(money[key]||0);if(!Number.isSafeInteger(value)||value<0||value>2147483647)throw Error('货币已达当前存档上限。');p[key]=value;}
 return plan.added;
}
export function gainItemsPacket(p,added,money){
 return addedItems(new Writer().byte(0),added).int(money.gold||0).int(money.silver||0).int(money.coins||0).int(0)
  .int(p.gold||0).int(p.silver||0).int(p.coins||0).int(p.exp||0).int(p.expMax||0).int(p.level).bool(true);
}
export function handleDaily(type,r,context,{store,send,log}){
 const p=context.role;if(!p||![14551,14553,14554,14562,22105,22107].includes(type))return false;
 const before=structuredClone(p);
 try{
  const state=ensureDaily(p);
  if(type===14551||type===22105||type===14562){
   if(r.pos!==r.b.length)throw Error('日常查询格式不正确。');
   if(JSON.stringify(before.dailyActivity)!==JSON.stringify(p.dailyActivity))store.save();
   if(type===14551)send(type,vitalityPacket(p));
   else if(type===22105)send(22106,encodeDaily('s2c_TaskInfo',taskSnapshot(p)));
   else send(type,new Writer().byte(vitalitySnapshot(p).rewards.some(r=>r.status===1)?1:0));
   return true;
  }
  if(type===14553){
   const threshold=r.int(),reward=dailyData.legacy.rewards.find(x=>x.threshold===threshold);
   if(!reward||r.pos!==r.b.length)throw Error('没有这档活跃奖励。');
   // Preview never changes progress, claim markers or inventory.
   restore(p,before);
   const w=new Writer().byte(0).byte(1).byte(reward.items.length);
   for(const item of reward.items)w.raw(Buffer.from(item.definitionBase64,'base64')).byte(item.quantity);
   send(type,w.short(reward.gold).short(reward.silver).short(reward.coins));return true;
  }
  if(context.battle)throw Error('请先结束战斗再领取日常奖励。');
  if(type===14554){
   const threshold=r.int(),reward=dailyData.legacy.rewards.find(x=>x.threshold===threshold);
   if(!reward||r.pos!==r.b.length)throw Error('没有这档活跃奖励。');
   if(state.claimedVitality.includes(threshold))throw Error('今天已经领取过这档奖励。');
   if(vitalitySnapshot(p).value<threshold)throw Error('今日活跃度尚未达到领取条件。');
   const added=applyReward(p,reward.items,reward);state.claimedVitality.push(threshold);store.save();
   const w=new Writer().byte(0).byte(1).byte(added.length?1:0);if(added.length)addedItems(w,added);
   send(type,w.int(p.gold||0).int(p.silver||0).int(p.coins||0));notifyDaily(p,send);
   log('vitality-reward',{role:p.id,threshold,day:state.day});return true;
  }
  const {id}=decodeDaily('c2s_TaskActiveReward',r.b.subarray(r.pos));
  const reward=dailyData.activeRewards.find(x=>x.id===id);
  if(!reward)throw Error('没有这档日常奖励。');
  if(state.claimedActive.includes(id))throw Error('今天已经领取过这档奖励。');
  if(taskSnapshot(p).activeInfo.activeValue<reward.needValue)throw Error('今日活动积分尚未达到领取条件。');
  const items=[],money={gold:0,silver:0,coins:0};
  for(const item of reward.itemInfo){if(item.itemId>0)items.push({id:item.itemId,quantity:item.itemCount});else{const key={[-1]:'gold',[-2]:'silver',[-3]:'coins'}[item.itemId];if(!key)throw Error('奖励类型待定。');money[key]+=item.itemCount;}}
  const added=applyReward(p,items,money);state.claimedActive.push(id);store.save();
  send(22108,encodeDaily('s2c_TaskActiveReward',{rs:0}));send(12100,gainItemsPacket(p,added,money));
  log('daily-active-reward',{role:p.id,id,day:state.day});
 }catch(error){
  restore(p,before);
  if(type===22107)send(22108,encodeDaily('s2c_TaskActiveReward',{rs:-1,rsDesc:error.message}));
  else if(type===22105||type===14551)send(10509,new Writer().byte(2).string(error.message));
  else send(type,new Writer().byte(-1).string(error.message));
  log('daily-rejected',{role:p.id,type,error:error.message});
 }
 return true;
}

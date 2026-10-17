import fs from 'node:fs';
import {lazyBox} from './lazy-data.mjs';
import {officialMissions} from './official-data.mjs';
import {isNewbieMission} from './newbie-missions.mjs';
import {applyYunruoDaily,yunruoTempleRevision} from './yunruo-temple.mjs';
import {applyRecordedExpansionDaily,recordedExpansionRevision} from './recorded-expansion.mjs';
import {applyLostSoulDesertDaily} from './lost-soul-desert.mjs';
import {vipBenefits} from './home-feature-data.mjs';
import {cityUpgradeDone} from './city-progress.mjs';

/**
 * 每日活动表（100 KB）本身很小，但它的顶层三步 `applyYunruoDaily` /
 * `applyRecordedExpansionDaily` 会连带把 12.4 MB 的录制扩展解析进堆。
 * 整段挪进惰性构造：第一次用到每日活动时才建（架构评审 P1-1）。
 */
let built=null;
function ensure(){
 if(built)return built;
 const dailyData=JSON.parse(fs.readFileSync(new URL('../data/daily-activity-v1.json',import.meta.url),'utf8'));
 applyYunruoDaily(dailyData);
 applyRecordedExpansionDaily(dailyData);
 // 迷失之魂沙漠 10/11 两环（见 lib/lost-soul-desert.mjs）要出现在每日看板里，
 // 否则玩家在「疯狂元素」之后看不到任何线索。
 applyLostSoulDesertDaily(dailyData);
 dailyData.revision+='+'+yunruoTempleRevision+'+'+recordedExpansionRevision();
 built={
  data:dailyData,
  revision:dailyData.revision,
  conditions:new Map(dailyData.legacy.conditions.map(c=>[c.id,c])),
  canonicalTasks:dailyData.tasks.filter(t=>t.id===t.canonicalId&&t.linkage),
 };
 return built;
}
export const dailyData=lazyBox(()=>ensure().data,'dailyData');
export const dailyRevision=()=>ensure().revision;
export const dailyKey=(now=Date.now())=>new Date(Number(now)+8*60*60*1000).toISOString().slice(0,10);
export const isDailyMission=q=>!!(q?.setting&2);

function newDay(p,day,migrate=false){
 // Old saves have no completion dates. Keep their unlocked steps on the first
 // day, without retroactively issuing activity points or rewards.
 const completed=migrate?Object.fromEntries((p.quests?.completed||[]).filter(id=>isDailyMission(officialMissions.get(id))).map(id=>[id,1])):{};
 return {version:2,day,progress:{1:1},completed,credited:[],taskTimes:{},claimedVitality:[],claimedActive:[]};
}
export function dailyState(p,now=Date.now()){
 const day=dailyKey(now);return p.dailyActivity?.day>=day?p.dailyActivity:newDay(p,day,!p.dailyActivity);
}
export function ensureDaily(p,now=Date.now()){
 const state=dailyState(p,now);
 if(state!==p.dailyActivity){
  // Beginner completion history and accepted objectives survive every midnight.
  // Other missions still reset, including non-beginner main/one-time missions.
  // Undated legacy saves establish their first day without deleting history.
  if(p.dailyActivity?.day&&p.dailyActivity.day<state.day&&p.quests)p.quests={...p.quests,
   active:Object.fromEntries(Object.entries(p.quests.active||{}).filter(([id])=>isNewbieMission(id))),
   // 城市升级任务（3002—3005）不留在 completed 里也无所谓 —— missionDone() 会用城市等级补判，
   // 但记录留着更好：其它模块也读这份数组（home-features / 任务位图 / 重玩链节点统计）。
   completed:(p.quests.completed||[]).filter(id=>isNewbieMission(id)||cityUpgradeDone(p,id))};
  p.dailyActivity=state;
 }
 return state;
}
export function missionDone(p,id,now=Date.now()){
 // 城市升级任务（3002—3005）按城市等级判定，不看完成记录 —— 记录会被跨天重置清掉，
 // 而等级留着。详见 lib/city-progress.mjs。
 if(cityUpgradeDone(p,id))return true;
 const q=officialMissions.get(id);
 return isDailyMission(q)?!!dailyState(p,now).completed[id]:(p.quests?.completed||[]).includes(id);
}
export function recordActivity(p,id,amount=1,now=Date.now()){
 const c=ensure().conditions.get(id);if(!c?.supported||!Number.isInteger(amount)||amount<1)return false;
 const s=ensureDaily(p,now),before=s.progress[id]||0;
 s.progress[id]=Math.min(c.count,before+amount);return s.progress[id]!==before;
}
export function recordMissionCompletion(p,q,now=Date.now()){
 const s=ensureDaily(p,now);s.completed[q.id]=(s.completed[q.id]||0)+1;
 // Count each recorded daily quest once toward the 20-quest vitality goal.
 // Unlimited entrance/teleport quests cannot farm this goal.
 if(isDailyMission(q)&&!(q.setting&8)&&!s.credited.includes(q.id)){s.credited.push(q.id);recordActivity(p,3,1,now);}
 for(const t of ensure().canonicalTasks)if(t.linkage.terminal===q.id){
  s.taskTimes[t.id]=Math.min(Math.max(1,t.frequency), (s.taskTimes[t.id]||0)+1);
 }
 return s;
}
export function vitalitySnapshot(p,now=Date.now()){
 const s=dailyState(p,now),rows=dailyData.legacy.conditions.map(c=>({...c,progress:Math.min(c.count,s.progress[c.id]||0)}));
 const vipAdd=vipBenefits(p).vitality,value=rows.reduce((v,c)=>v+(c.progress>=c.count?c.value:0),vipAdd);
 return {value,vipAdd,conditions:rows,rewards:dailyData.legacy.rewards.map(r=>({threshold:r.threshold,status:s.claimedVitality.includes(r.threshold)?2:value>=r.threshold?1:0}))};
}
export function taskSnapshot(p,now=Date.now()){
 const s=dailyState(p,now);
 const activeValue=ensure().canonicalTasks.reduce((sum,t)=>sum+(s.taskTimes[t.id]||0)*t.value,0);
 const info=dailyData.tasks.map(t=>{
  const {canonicalId,linkage,pending,...row}=t,finishTImes=s.taskTimes[canonicalId]||0;
  const progress=linkage?Math.min(t.progressSum,linkage.missionIds.filter(id=>s.completed[id]).length):0;
  const active=linkage?.missionIds.some(id=>p.quests?.active[id]);
  return {...row,name:t.name+(pending?'（待定）':''),finishTImes,progress,status:finishTImes>=Math.max(1,t.frequency)?2:(active||progress?1:0),missionIdFinish:t.missionId<=0||(p.quests?.completed||[]).includes(t.missionId)};
 });
 return {info,activeInfo:{activeValue,info:dailyData.activeRewards.map(r=>({...r,hasReward:s.claimedActive.includes(r.id)}))}};
}
export function dailySnapshot(p,now=Date.now()){
 return {revision:dailyRevision(),day:dailyKey(now),resetPolicy:dailyData.resetPolicy,vitality:vitalitySnapshot(p,now),tasks:taskSnapshot(p,now),pending:{vipBonus:false,conditions:dailyData.legacy.conditions.filter(c=>!c.supported).map(c=>({id:c.id,name:c.content})),tasks:dailyData.tasks.filter(t=>t.pending).map(t=>({id:t.id,name:t.name,reason:t.pending}))}};
}

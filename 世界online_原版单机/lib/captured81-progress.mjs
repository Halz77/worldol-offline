/**
 * 八一副本 —— 旧进度迁移。
 *
 * ## 为什么需要
 * 早先版本没有录制包，81 后续任务（1422—1429）是按视频线索**推测**写出来的，
 * 里面的怪是估的。玩家如果已经按旧版把这条链走了一遍（打死了那些估出来的怪、
 * 或者任务卡在 1424/1425/1426），换上录制版数据后进度就对不上了：
 * 任务条件认不出新怪的击杀数，看起来像"任务做不下去"。
 *
 * ## 做法
 * 命中旧痕迹（旧的估算怪有击杀 / 任务目标还挂着旧怪 / 旧接取点）就把这一段
 * 归档进 p.captured81Migration.previous 再删掉，让玩家能重新接一遍。
 * 归档而不是直接删 —— 旧存档是玩家自己走出来的，不该无声消失。
 *
 * 已经通关 1430 的不动（那条链已经走完了，迁移没有意义）。
 */
const REVISION='captured81-progress-20260926-v1';
/** 需要重走的任务号：1422—1429（1430 是终点，完成即保留）。 */
const LEGACY_IDS=Array.from({length:8},(_,i)=>1422+i);
/** 旧版推测用的估算怪。 */
const LEGACY_MONSTERS=new Set([23100,23101,23102,23110,23111]);

export function migrateCaptured81Progress(p){
 if(p.captured81Migration?.revision===REVISION)return false;
 const active=p.quests?.active||{},completed=p.quests?.completed||[];
 const legacyKills=Object.entries(p.battles?.kills||{})
  .some(([id,count])=>LEGACY_MONSTERS.has(Number(id))&&count>0);
 const legacyObjectives=LEGACY_IDS.some(id=>Object.keys(active[id]?.counts||{}).some(key=>LEGACY_MONSTERS.has(Number(key))));
 const legacyOrigin=LEGACY_IDS.some(id=>active[id]?.origin?.mapId===990&&(
  (id>=1424&&id<=1425&&active[id].origin.npcId===7)||(id>=1426&&active[id].origin.npcId===8)));
 if((!legacyKills&&!legacyObjectives&&!legacyOrigin)||completed.includes(1430))return false;
 const affected=LEGACY_IDS.some(id=>active[id]||completed.includes(id)||p.dailyActivity?.completed?.[id]);
 p.captured81Migration={
  revision:REVISION,
  at:new Date().toISOString(),
  reason:affected?'replace-estimated-chain-with-capture':'legacy-history-already-reset',
  previous:{
   active:structuredClone(Object.fromEntries(LEGACY_IDS.filter(id=>active[id]).map(id=>[id,active[id]]))),
   completed:completed.filter(id=>LEGACY_IDS.includes(id)),
   dailyCompleted:structuredClone(Object.fromEntries(
    LEGACY_IDS.filter(id=>p.dailyActivity?.completed?.[id]).map(id=>[id,p.dailyActivity.completed[id]]))),
  },
 };
 for(const id of LEGACY_IDS){
  delete active[id];
  if(p.dailyActivity?.completed)delete p.dailyActivity.completed[id];
 }
 p.quests.completed=completed.filter(id=>!LEGACY_IDS.includes(id));
 return true;
}
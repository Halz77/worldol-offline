import {dailyKey,ensureDaily} from './daily-activity.mjs';

export const taskResetRevision='preserve-newbie-shanghai-midnight-v2';
export const nextTaskResetAt=(now=Date.now())=>Date.parse(dailyKey(now)+'T00:00:00+08:00')+86400000;

// Commit every character together, including offline characters. Reset dates
// move forwards only; a clock correction must not reopen the same day's quests.
export function resetTaskDays(store,now=Date.now()){
 const day=dailyKey(now),changed=[];
 try{
  for(const role of store.data.characters){
   if(role.dailyActivity?.day>=day)continue;
   const before=structuredClone(role),reset=!!role.dailyActivity?.day;
   changed.push({role,before,reset});ensureDaily(role,now);
  }
  if(changed.length)store.save();
 }catch(error){
  for(const {role,before}of changed){for(const key of Object.keys(role))if(!(key in before))delete role[key];Object.assign(role,before);}
  throw error;
 }
 return changed.map(({role,before,reset})=>({role:role.id,day,reset,
  completed:reset?(before.quests?.completed?.length||0)-(role.quests?.completed?.length||0):0,
  active:reset?Object.keys(before.quests?.active||{}).length-Object.keys(role.quests?.active||{}).length:0}));
}

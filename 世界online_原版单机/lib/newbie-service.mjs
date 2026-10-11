import {Writer} from './codec.mjs';
import {official,officialMissions} from './official-data.mjs';
import {officialMissionPacket} from './official-packets.mjs';
import {attributes,clampVitals} from './restoration.mjs';
import {combatRating} from './combat-rating.mjs';
export function pushNewbieMission(p,send){
 if(p.progression!=='xia-v05')return;
 const sequence=official.newbie.recordedCompleted.slice(0,official.newbie.recordedCompleted.indexOf(42)+1);
 const q=sequence.map(id=>officialMissions.get(id)).find(q=>q&&!p.quests.completed.includes(q.id));
 if(q)send(14591,new Writer().bytes(officialMissionPacket(q,p)));
}
export function handleAttributes(type,r,context,{store,send,log}){
 if(type!==11003||!context.role)return false;const p=context.role;
 try{
  if(context.battle)throw Error('请先结束战斗再加点。');
  const count=r.byte();if(count<1||count>5)throw Error('无效属性数量');
  const next=[...p.baseStats],seen=new Set();let spent=0;
  for(let i=0;i<count;i++){const key=r.short()-6,delta=r.int();if(key<0||key>4||seen.has(key)||!Number.isInteger(delta))throw Error('无效属性调整');seen.add(key);next[key]+=delta;spent+=delta;}
  // 单机放宽：不再要求「不超过剩余点数」或「不低于角色初始属性」，只要求每项落在 0～32767 即可自由加减。
  // 加点到超出剩余点数时 attributePoints 停在 0（不会变负数）；减点时按差值退回，所以洗点始终可用。
  if(r.pos!==r.b.length||next.some(n=>n<0||n>32767))throw Error('属性点只能调整到 0～32767 之间。');
  p.baseStats=next;p.attributePoints=Math.max(0,Math.min(32767,(p.attributePoints||0)-spent));clampVitals(p);store.save();
  const w=new Writer().byte(0).short(p.attributePoints).int(p.hp).int(p.mp);for(const n of p.baseStats)w.short(n);
  send(type,w.int(p.gold||0).int(p.silver||0).int(p.coins).int(combatRating(p).total));log('attributes-changed',{role:p.id,baseStats:p.baseStats,attributePoints:p.attributePoints,derived:attributes(p)});
 }catch(e){send(type,new Writer().byte(-1).string(e.message));}return true;
}

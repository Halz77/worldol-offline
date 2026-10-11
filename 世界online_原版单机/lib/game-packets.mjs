import {Writer} from './codec.mjs';
import {maps,monsters,quests,npcSign,availableQuests} from './content.mjs';
import {officialMissions} from './official-data.mjs';
import {missionsAt} from './official-rules.mjs';
import {officialNpc,officialMonsterGroups,officialMonsterModels,officialMissionPacket} from './official-packets.mjs';
import {activePet} from './pet-state.mjs';
import {petReward} from './pet-packets.mjs';
import {addedItems} from './restoration-packets.mjs';
import {missionDone} from './daily-activity.mjs';
export function npcPacket(w,p,npcs=maps[p.mapId].npcs){
  w.byte(0).byte(0).byte(0).byte(npcs.length);
  for(const n of npcs){
    if(n.wireBase64){officialNpc(w,n,npcSign(p,n));continue;}
    w.byte(npcSign(p,n)).byte(n.id).byte(n.id).byte(n.type).long(n.icon).short(0)
      .utf(n.name).utf(n.welcome||'').utf(n.talk||'').byte(n.type===0?23:7).byte(0)
      .byte(n.x).byte(n.y).byte(0).byte(0);
    if(n.type===1)w.short(n.group).byte(20);
    if(n.type===2||n.type===7)w.utf(n.topic).short(n.shop);
    if(n.type===3)w.utf(n.topic).short(n.target[0]).byte(n.target[1]).byte(n.target[2]);
    if(n.type===5){
      w.byte(0).byte(0).byte(n.shops?.length||0);
      for(const shop of n.shops||[])w.utf(shop.name).short(shop.id).short(0).byte(0);
      w.byte(0);
    }
  }return w;
}
export function missionPacket(q,p){
  if(officialMissions.has(q.id))return officialMissionPacket(q,p);
  const w=new Writer().short(q.id).utf(q.name).byte(1).utf(q.name).utf(q.desc).short(0).short(1).byte(1)
    .short(q.monster?10:1).byte(q.monster===702?19:q.monster?18:22).byte(q.monster===702?28:q.monster?20:14)
    .utf('请先完成前面的委托。').utf(q.waiting).utf(q.finish).int(q.exp).short(0).short(q.coins).byte(0).byte(0);
  w.byte(q.previous?1:0);
  if(q.previous){const c=new Writer().short(q.previous).utf(quests[q.previous].name).done();w.byte(9).byte(0).byte(c.length).raw(c);}
  w.byte(q.monster?1:0);
  if(q.monster){const c=new Writer().short(q.monster).utf(monsters[q.monster].name).byte(q.count).byte(p.quests.active[q.id]?.kills||0).done();w.byte(2).byte(0).byte(c.length).raw(c);}
  return w.int(0).utf('村落委托').int(1).int(1).byte(1).bool(false);
}
export function missionsPacket(w,p){const active=Object.keys(p.quests.active).map(id=>quests[id]||officialMissions.get(Number(id))).filter(Boolean);w.byte(active.length);for(const q of active)w.bytes(missionPacket(q,p));return w;}
export function missionBits(p){const b=Buffer.alloc(Math.floor(9003/8)+1);for(const id of p.quests.completed)if(id>=0&&id<9004&&missionDone(p,id))b[id>>3]|=1<<(id%8);return b;}
export function signUpdates(w,p){const list=maps[p.mapId].npcs.filter(n=>n.type===0||n.type===5);w.byte(list.length);for(const n of list)w.byte(n.id).byte(npcSign(p,n));return w;}
export function monsterGroups(w,p){if(maps[p?.mapId]?.official)return officialMonsterGroups(w,p);const list=maps[10].npcs.filter(n=>n.type===1);w.byte(list.length);for(const n of list){w.short(n.group).byte(0).short(0).byte(0).int(100);for(let i=0;i<10;i++)w.short(i===5?n.monster:0);}return w;}
export function monsterModels(w,p){if(maps[p?.mapId]?.official)return officialMonsterModels(w,p);w.byte(Object.keys(monsters).length);for(const m of Object.values(monsters)){
  w.int(m.id).string(m.name).long(m.icon).byte(m.level).byte(0).int(m.hp).int(m.mp).int(m.speed).byte(0)
    .int(m.atkMin).int(m.atkMax).byte(0).int(0);
  for(let i=0;i<14;i++)w.int(0);
  w.int(100).int(100).short(0);
  for(let i=0;i<19;i++)w.int(0);
  w.long(0).int(0);
}return w.byte(0).byte(0);}
export function missionData(p,npcId){const list=maps[p.mapId]?.official?missionsAt(p,npcId):npcId===1&&p.mapId===1?Object.values(quests).filter(q=>!p.quests.completed.includes(q.id)):[];const w=new Writer().short(npcId).byte(list.length);for(const q of list)w.bytes(officialMissions.has(q.id)?officialMissionPacket(q,p,npcId):missionPacket(q,p));monsterGroups(w,p);monsterModels(w,p);return w;}
export function levelReward(w,p,reward){
 w.int(reward.exp).byte(reward.levels);
 if(reward.levels){
  w.int(p.exp).int(p.expMax);
  const sp=reward.skillPoints||0,cp=reward.attributePoints||0;
  if(sp>32767)w.short(-1).int(sp);else w.short(sp);
  if(cp>127)w.byte(-1).int(cp);else w.byte(cp);
 }
 return w.int(0).byte(0);
}
export function questReward(w,p,reward){w.bool(true).short(0).int(0).int(reward.costCoins||0).int(reward.silver||0).int(reward.coins);levelReward(w,p,reward);w.bool(!!reward.pet);if(reward.pet)petReward(w,reward.pet);w.byte(reward.removed?.length||0);for(const row of reward.removed||[])w.int(row.itemId).int(row.slot).byte(row.quantity);addedItems(w,reward.added);w.bool(!!reward.cityChanged);const cityReward=!!(reward.cityProsperity||reward.cityArmy);w.bool(cityReward);if(cityReward){w.int(0).short(reward.cityProsperity||0).short(reward.cityArmy||0);for(let i=0;i<8;i++)w.short(0);}return w;}
export function battleReward(p,result,reward,monster,changeMap=false){const w=new Writer().byte(result);if(result===2){w.int(reward.coins);levelReward(w,p,reward);const killed=Array.isArray(monster)?monster:[[monster,1]];w.bool(false).bool(!!reward.pet);if(reward.pet)petReward(w,reward.pet);w.byte(killed.length);for(const [id,count] of killed)w.short(id).byte(count);addedItems(w.bool(false),reward.added);signUpdates(w,p);}return w.bool(false).byte(0).bool(changeMap).bool(false);}
// Native attribute updates use deltas, with one mandatory final attribute pair.
// Reward callbacks already apply experience. A SET_EXP push can arrive before
// that asynchronous callback and make its reward get counted twice on screen.
// The native MainProxy still requires one final pair: a zero copper delta.
export function moneyUpdate(p,delta=0,silver=0){return new Writer().byte(2).short(12).int(silver).short(13).int(delta).short(13).int(0);}
export function healthUpdate(p){const w=new Writer().int(p.hp).int(p.mp),pet=activePet(p);if(pet)w.int(pet.hp).int(pet.mp);return w;}

import {Writer} from './codec.mjs';
import {official,officialMaps,rawRecord} from './official-data.mjs';
import {balancedMonsterPacket} from './monster-balance.mjs';
import {cityTarget} from './city-state.mjs';
import {officialCanAccept,missionBlockers,originFor,availableChoices,missionRewards,missionClientSetting,missionConditions,missionNotes,missionFollowupId,battleSupported,missionBattleId} from './official-rules.mjs';
export function officialNpc(w,n,sign){const b=Buffer.from(n.wireBase64,'base64');b[0]=sign;return w.raw(b);}
const battleCache=new Map();
export function mapBattleData(mapId){
 if(battleCache.has(mapId))return battleCache.get(mapId);
 const map=official.maps.find(m=>m.id===mapId),ids=new Set();
 for(const n of map?.npcs||[])for(const id of n.battleID||[])if(id>0)ids.add(id);
 for(const q of official.missions)if(q.mapId===mapId||q.sources.some(s=>s.mapId===mapId))for(const id of [missionBattleId(q),missionBattleId(q,'submit')])if(id>0)ids.add(id);
 for(const g of official.groups)if(g.sources.some(s=>s.mapId===mapId))ids.add(g.groupId);
 const byId=new Map(official.groups.map(g=>[g.groupId,g]));
 for(const id of ids){const next=byId.get(id)?.nextBattleGroupID;if(next>0)ids.add(next);}
 const groups=[...ids].map(id=>byId.get(id)).filter(Boolean),monsterIds=new Set(groups.flatMap(g=>[...g.monsters,...g.npcs]).filter(id=>id>0));
 const monsters=official.monsters.filter(m=>monsterIds.has(m.id)),ai=official.ai.filter(a=>monsterIds.has(a.id));
 const neededSkills=new Set(ai.flatMap(a=>[...a.skill1,...a.skill2]).filter(s=>s.id>0).map(s=>`${s.id}:${s.level}`));
 const skills=official.skills.filter(s=>neededSkills.has(`${s.id}:${s.level}`));
 for(const [key,rows] of Object.entries({groups,monsters,skills,ai}))if(rows.length>127)throw Error(`Map ${mapId} ${key} exceeds native byte count: ${rows.length}`);
 const result={groups,monsters,skills,ai};battleCache.set(mapId,result);return result;
}
export function officialMonsterGroups(w,p){const {groups}=mapBattleData(p.mapId);w.byte(groups.length);for(const g of groups)w.raw(rawRecord(g));return w;}
export function officialMonsterModels(w,p){
 const {monsters,skills,ai}=mapBattleData(p.mapId);
 w.byte(monsters.length);for(const m of monsters)w.raw(balancedMonsterPacket(m));
 if(!monsters.length)return w; // Native processDataMonsterMsg skips the AI block when empty.
 w.byte(skills.length);for(const s of skills)w.raw(Buffer.from(s.monsterWireBase64||s.wireBase64,'base64'));
 w.byte(ai.length);for(const a of ai)w.raw(rawRecord(a));return w;
}
function rewardItem(w,i,choice){w.int(i.id).byte(i.quantity).utf(i.name).int(i.bagIcon).byte(i.grade);if(choice)w.byte(i.type);}
export function officialMissionPacket(q,p,npcId){
 const blocked=missionBlockers(q),active=p.quests.active[q.id],origin=active?.origin||originFor(p,q,npcId),reward=missionRewards(q),setting=missionClientSetting(q),notes=missionNotes(q);
 const w=new Writer().short(q.id).utf(q.name).byte(q.level).utf(q.simpleDesc).utf(q.desc+(notes.length?'\n【单机】'+notes.join('；')+'。':'')+(blocked.length?'\n【资料缺项】'+blocked.join('；')+'。相关场景或战斗仍需补录。':''))
  .short(setting).short(cityTarget(q,p).mapId).byte(cityTarget(q,p).npcId).short(q.radarMapID);
 if(q.radarMapID>0)w.byte(q.radarGx).byte(q.radarGy);
 w.utf(q.dialogNotStartNotReady).utf(q.dialogStartNotFinish).utf(q.dialogStartFinish).int(reward.exp).short(reward.money2).short(reward.money3);
 if(setting&1024){for(const key of ['accept','submit']){const jump=q[key+'JumpMapID'],available=jump>0&&officialMaps.has(jump);w.short(available?jump:0);if(available)w.byte(q[key+'JumpMapGx']).byte(q[key+'JumpMapGy']);}for(const phase of ['accept','submit']){const group=missionBattleId(q,phase);w.short(battleSupported(group)?group:0);}w.short(missionFollowupId(q));}
 for(const [list,choice] of [[reward.rewardItems,false],[availableChoices(q),true]]){w.byte(list?.length||0);for(const item of list||[])rewardItem(w,item,choice);}
 for(const kind of ['acceptCondition','submitCondition']){const list=missionConditions(q,kind);w.byte(list.length);for(const c of list){const bytes=Buffer.from(c.rawHex,'hex');if(c.type===2)bytes[bytes.length-1]=Math.min(c.required,active?.counts?.[c.monsterId]||0);w.byte(c.type).byte(c.not).byte(bytes.length).raw(bytes);}}
 return w.int(q.type).utf(q.series).int(origin.mapId).int(origin.npcId).byte(officialCanAccept(p,q)?1:0).bool(q._isHelp);
}

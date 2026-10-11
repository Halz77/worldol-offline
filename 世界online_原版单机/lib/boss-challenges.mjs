import fs from 'node:fs';
import {Writer} from './codec.mjs';

export const bossChallenges=JSON.parse(fs.readFileSync(new URL('../data/boss-challenges-v1.json',import.meta.url),'utf8'));
export const bossChallengeRevision=bossChallenges.revision;

// Keep the recorded definitions in the bundle. Only the local challenge's
// entrance, dialogue and repeatability differ from the official quest chain.
export function applyBossChallenges(official){
 const same=(a,b)=>a.wireBase64===b.wireBase64;
 for(const table of ['monsters','groups','ai'])for(const record of bossChallenges[table]){
  const key=table==='groups'?'groupId':'id',existing=official[table].find(r=>r[key]===record[key]);
  if(existing){if(!same(existing,record))throw Error('Conflicting boss '+table+' '+record[key]);}
  else official[table].push(structuredClone(record));
 }
 for(const skill of bossChallenges.skills){
  const existing=official.skills.find(s=>s.id===skill.id&&s.level===skill.level);
  if(!existing)official.skills.push(structuredClone(skill));
  else{
   // Player/shop definitions can have additional fields or different powers.
   // The native monster block has its own exact wire definition.
   if(existing.monsterWireBase64&&existing.monsterWireBase64!==skill.wireBase64)throw Error('Conflicting monster skill '+skill.id+':'+skill.level);
   existing.monsterWireBase64=skill.wireBase64;
  }
 }
 const placement=bossChallenges.placement,map=structuredClone(bossChallenges.map),source=bossChallenges.dongNpc;
 if(official.maps.some(m=>m.id===map.id))throw Error('Boss map already supplied: '+map.id);
 const npc={...source,mapId:map.id,id:placement.npcId,x:placement.x,y:placement.y,sourceGx:placement.x,sourceGy:placement.y,
  status:3,direction:1,missionGroupID:0,localChallenge:true};
 delete npc.missionData;
 npc.wireBase64=new Writer().byte(3).byte(npc.id).byte(0).byte(0).long(npc.icon1).short(0)
  .utf(npc.name).utf('').utf('接取挑战任务，与东哥及其护卫战斗。').byte(3).byte(1).byte(npc.x).byte(npc.y).byte(0).byte(0).done().toString('base64');
 npc.talkDetail='接取挑战任务，与东哥及其护卫战斗。';map.npcs.push(npc);official.maps.push(map);
 for(const sourceQuest of bossChallenges.missions){
  if(official.missions.some(q=>q.id===sourceQuest.id))throw Error('Boss quest already supplied: '+sourceQuest.id);
  const dong=sourceQuest.id===placement.missionId;
  // MOD(plaza-boss)：非东哥任务改为尊重任务自带的 npcId（缺省仍是 1）。
  // 征战广场现在有多个挑战 NPC（霸天虎 1 / 东哥 4 / 库库尔坎 5），写死 npcId=1
  // 会让后续新增的挑战全挂到霸天虎身上，既接不到也打不了。
  const npcId=dong?placement.npcId:(sourceQuest.npcId>0?sourceQuest.npcId:1);
  const q={...structuredClone(sourceQuest),mapId:map.id,npcId,acceptMapId:map.id,acceptNpcId:npcId,
   setting:1034,type:0,series:'征战广场挑战',acceptCondition:[],localChallenge:true,
   name:dong?'挑战超级BOSS-东哥':sourceQuest.name,
   // 保留各任务自己录制到的说明文案（库库尔坎等新挑战各有自己的背景），
   // 只有东哥的剧情台词要换成单机流程说明；录不到说明时才退回旧文案。
   desc:dong?'在征战广场挑战撼地者——宇宙男神东哥及其护卫。接取任务后进入战斗，获胜后回来领取奖励，可重复挑战。':
    (sourceQuest.desc||'在征战广场挑战霸天虎及其钢铁护卫。霸天虎会释放强大的技能，合理安排封魔和队伍配合。接取任务后进入战斗，获胜后回来领取奖励，可重复挑战。'),
   dialogNotStartNotReady:'准备好后即可接取挑战。',dialogStartNotFinish:'击败目标后，再回来领取奖励。',dialogStartFinish:'挑战完成，这是你的奖励。',
   sources:[{origin:'local-boss-challenge',mapId:map.id,npcId}],recordedSources:sourceQuest.sources};
  official.missions.push(q);
 }
 return official;
}

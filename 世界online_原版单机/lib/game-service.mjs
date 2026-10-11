import {recorded} from './recorded-content.mjs';
import {vipMissionExperience} from './home-feature-data.mjs';
import {applyBattleRecovery} from './vip-recovery.mjs';
import {activePet,gainPet,petAttributes,observedPetExperience} from './pet-state.mjs';
import {randomBytes} from 'node:crypto';
import {Writer} from './codec.mjs';
import {worldData} from './world.mjs';
import {maps,monsters,quests,walkable,reachable,npcById,battleNpc,near,hpMax,mpMax,questComplete,availableQuests,gain} from './content.mjs';
import {npcPacket,missionData,signUpdates,questReward,battleReward,moneyUpdate,healthUpdate} from './game-packets.mjs';
import {official,officialGroups,officialMonsters,officialMissions} from './official-data.mjs';
import {npcEnabled,missionStateMatches,missionBattleId} from './official-rules.mjs';
import {pushNewbieMission} from './newbie-service.mjs';
import {rollBattleLoot,applyLootDelivery} from './loot.mjs';
import {recordActivity} from './daily-activity.mjs';
import {notifyDaily} from './daily-service.mjs';
import {legionBattleMembers,readLegionResult,pushLegionMembers,legionVitals,encodeLegion} from './legion-service.mjs';
import {legionRoster} from './legion-state.mjs';
import {BATTLE_TRAILER_V2,readBattleResultTail} from './battle-result-wire.mjs';
export const BATTLE_TRAILER=BATTLE_TRAILER_V2;
// MOD(battle-entry-full-heal)：进入战斗前把人物与背包里全部宠物的血蓝原地回满
// （含军团里的每个角色与他们的宠物），只补血蓝，不动出战阵容。
// ★ 调用点必须在 legionBattleMembers(p) 之前：结算时 readLegionResult() 会拿
//   role.hp 与开战快照比对，回满若发生在快照之后，12502 会被判「血蓝状态与开战时
//   不一致」而整包拒绝。同时必须把新血蓝推给客户端（17601 + 31058），否则客户端
//   仍按旧值组建队伍，同样会撞上上面那条校验。
// 不在这里写存档：沿用下面已有的「进战斗不落盘」优化，避免开战瞬间卡顿；
// 血蓝改动会随本场战斗结算时的 commit() 一起持久化。
function battleEntryHealPets(owner){let changed=0;for(const item of owner.inventory||[]){const pet=item&&item.pet;if(!pet)continue;const max=petAttributes(owner,pet);if(pet.hp!==max.hp||pet.mp!==max.mp)changed++;pet.hp=max.hp;pet.mp=max.mp;}return changed;}
function battleEntryHealOwner(owner){const beforeHP=owner.hp,beforeMP=owner.mp,pets=battleEntryHealPets(owner);owner.hp=hpMax(owner);owner.mp=mpMax(owner);return owner.hp!==beforeHP||owner.mp!==beforeMP||pets>0?1:0;}
function battleEntryFullHeal(p){const healed=[];if(battleEntryHealOwner(p))healed.push(p.id);for(const role of legionRoster(p))if(role!==p&&battleEntryHealOwner(role))healed.push(role.id);return healed;}
export function handleGame(type,r,context,{store,send,log,random=Math.random}){
  const p=context.role;if(!p)return false;
  const commit=()=>store.save();
  const fail=message=>{throw Error(message);};
  const requireGuard=id=>{if(p.mapId!==1||id!==1||!near(p,npcById(p,id)))fail('请走到新手村的村口守卫身边再交谈。');};
  const pushHealth=()=>send(17601,healthUpdate(p));
  if(type===10504){
    const x=r.byte()&255,y=r.byte()&255;
    if(context.battle)return true;
    if(!reachable(p.mapId,p.x,p.y,x,y)){log('blocked-move',{role:p.id,map:p.mapId,x,y});send(10503,new Writer().byte(0).raw(worldData(p,false).done()));return true;}
    p.x=x;p.y=y;commit();return true;
  }
  if(type===10506){
    if(context.battle)fail('战斗期间不能切换地图。');
    const id=r.short();let x=r.byte()&255,y=r.byte()&255;
    const portal=maps[p.mapId].npcs.find(n=>near(p,n)&&npcEnabled(p,n)&&((n.target?.[0]===id&&n.target[1]===x&&n.target[2]===y)||n.jumpMapID?.some((target,i)=>target===id&&n.jumpMapGx[i]===x&&n.jumpMapGy[i]===y)));
    const questJump=context.questTeleport?.mapId===id&&context.questTeleport.x===x&&context.questTeleport.y===y;
    const gate=portal?.jumpMapID?.indexOf(id),allowedGate=gate===undefined||gate<0||!portal.jumpMapReqMissionID?.[gate]||missionStateMatches(p,portal.jumpMapReqMissionID[gate],portal.jumpMapReqMissionState[gate]);
    if(!maps[id])fail('该地图的场景数据尚未采集。');
    // Two archived exits land on blocked tiles in the restored scene. A real
    // nearby portal may safely use that scene's verified entry point instead.
    if(portal&&!walkable(id,x,y))[x,y]=maps[id].spawn;
    if((!maps[id].official&&!questJump&&(!portal||!allowedGate))||!walkable(id,x,y))fail('请通过地图出口或选择可通行的目标位置。');
    const previous={mapId:p.mapId,mapName:p.mapName,x:p.x,y:p.y};
    p.mapId=id;p.mapName=maps[id].name;p.x=x;p.y=y;try{commit();}catch(error){Object.assign(p,previous);throw error;}
    context.questTeleport=null;
    send(type,new Writer().byte(0).raw(worldData(p,false).done()));pushNewbieMission(p,send);return true;
  }
  if(type===10519){const count=r.byte()&255,ids=[];for(let i=0;i<count;i++)ids.push(r.byte());send(type,npcPacket(new Writer(),p,maps[p.mapId].npcs.filter(n=>ids.includes(n.id))));return true;}
  if(type===10518){
    const mode=r.byte();let mapId,npc;
    if(mode===1){mapId=r.short();npc=maps[mapId]?.npcs.find(n=>n.id===r.byte());}
    else if(mode===2){const q=quests[r.short()];if(!q)fail('这个任务尚未接入本地世界。');
      if(p.quests.active[q.id]&&!questComplete(p,q)){mapId=10;npc=maps[10].npcs.find(n=>n.monster===q.monster);}else{mapId=1;npc=maps[1].npcs[0];}}
    if(!npc)fail('没有找到目标 NPC。');
    const w=new Writer().byte(0);
    if(p.mapId===mapId)w.byte(0);else{const portal=maps[p.mapId].npcs.find(n=>n.target?.[0]===mapId);if(!portal)fail('这两张地图尚未连通。');w.byte(1).byte(portal.x).byte(portal.y).short(mapId).byte(portal.target[1]).byte(portal.target[2]);}
    send(type,w.byte(npc.x).byte(npc.y));return true;
  }
  if(type===14501){
    const id=r.short();if(!npcById(p,id)){send(type,new Writer().short(id).byte(-1).string('没有找到 NPC。'));return true;}
    send(type,missionData(p,id));
    if(p.mapId===1&&id===1&&near(p,npcById(p,id))&&!context.battle){p.hp=hpMax(p);p.mp=mpMax(p);commit();pushHealth();}
    return true;
  }
  if(type===14502){
    const id=r.short(),questId=r.short();requireGuard(id);
    const q=availableQuests(p).find(q=>q.id===questId);
    if(!q||p.quests.active[questId])fail('任务已经接取、已经完成或尚未解锁。');
    p.quests.active[questId]={kills:0,acceptedAt:new Date().toISOString()};commit();
    send(type,signUpdates(new Writer().byte(0),p).bool(false));log('quest-accepted',{role:p.id,quest:questId});return true;
  }
  if(type===14503){
    const id=r.short(),questId=r.short();r.int();requireGuard(id);const q=quests[questId];
    if(!q||!questComplete(p,q)||p.quests.completed.includes(questId))fail('任务条件尚未完成，或奖励已经领取。');
    delete p.quests.active[questId];p.quests.completed.push(questId);const reward=gain(p,vipMissionExperience(p,q.exp),q.coins);commit();
    send(type,questReward(signUpdates(new Writer().byte(0),p),p,reward));send(11004,moneyUpdate(p,reward.coins));pushHealth();
    log('quest-delivered',{role:p.id,quest:questId,reward});return true;
  }
  if(type===14504){const id=r.short();if(!p.quests.active[id])fail('任务不在进行中。');delete p.quests.active[id];commit();send(type,signUpdates(new Writer().byte(0),p));return true;}
  if(type===12501){
    if(context.battle)fail('上一场战斗尚未结束。');const group=r.short()&65535;
    const story=context.storyBattle?.group===group&&context.storyBattle.mapId===p.mapId?context.storyBattle:null;
    const active=Object.entries(p.quests.active).find(([id,a])=>missionBattleId(officialMissions.get(Number(id)))===group&&a.origin?.mapId===p.mapId);
    const origin=story||active?.[1].origin;
    // The native client only triggers a battle on a visible, enabled spawn, so
    // resolve the nearest usable spawn rather than the nearest spawn outright:
    // a hidden or mission-gated spawn of the same group can sit closer to the
    // player than the live monster they are actually standing next to.
    // A quest origin pins a single spawn, and for some quests that origin is the
    // talking NPC rather than a monster at all, so keep it only while the player
    // is actually standing at it — that is how scripted quest battles are
    // triggered. Once the player is elsewhere, a pinned spawn that sits on the
    // far side of the map must no longer block them: the same monster is usually
    // placed several times across one map, and the player has to be able to fight
    // whichever copy they walked up to.
    const pinned=origin?npcById(p,origin.npcId):null;
    const n=pinned&&near(p,pinned,3)?pinned:battleNpc(p,group,spawn=>npcEnabled(p,spawn));
    if(!n||!near(p,n,3))fail('请靠近当前任务的战斗目标。');
    if(p.hp<=0)fail('请先回村恢复生命。');
    if((p.battles.cooldowns[group]||0)>Date.now())fail('怪物正在重新出现，请稍候。');
    const token=randomBytes(4).readUInt32BE()&0x7fffffff;
    const official=!!maps[p.mapId].official,ids=official?officialGroups.get(group)?.monsters.filter(id=>id>0):[n.monster];
    if(!ids?.length||official&&ids.some(id=>!officialMonsters.has(id)))fail('这组怪物的数据尚未恢复。');
    const pet=activePet(p);
    // The native formation only inserts a living pet, even if a dead one is equipped.
    // MOD(battle-entry-full-heal)：出战宠物仍按「回满前」的状态判断，免得和客户端
    // 自己那次判断打架（客户端会看它本地的宠物血量决定要不要带宠出战）。
    const battleEntryPetUid=pet&&pet.hp>0?pet.uid:null;
    const battleEntryHealed=battleEntryFullHeal(p);
    if(battleEntryHealed.length){
      pushHealth();
      const battleEntryVitals=legionVitals(p);
      if(battleEntryVitals.infos.length)send(31058,encodeLegion('s2c_LegionActorHp',battleEntryVitals));
      log('battle-entry-full-heal',{role:p.id,healed:battleEntryHealed});
    }
    context.battle={token,group,monster:ids[0],monsters:ids,official,petUid:battleEntryPetUid,legion:legionBattleMembers(p),mapId:p.mapId,startedAt:Date.now()};
    // The cooldown only has to stop the player from re-entering the same group
    // within 1.5s, which is already enforced in memory. Skipping the save here
    // keeps entering a battle from serialising the whole save file — in the
    // standalone build that runs on the same thread as the game render loop and
    // showed up as a stall right when the battle screen opened.
    p.battles.cooldowns[group]=Date.now()+1500;
    send(type,new Writer().byte(0).int(token));log('battle-start',{role:p.id,group,token});return true;
  }
  if(type===12502){
    const battle=context.battle;if(!battle)fail('这场战斗已结算或未开始，请重新进入地图。');
    const startHP=r.int(),startMP=r.int(),hp=r.int(),mp=r.int();r.short();const group=r.short()&65535;
    const pet=r.bool(),buddies=r.byte()&255,nativeRounds=r.byte()&255;
    if(buddies||pet!==!!battle.petUid)fail('出战队伍与进入战斗时不一致。');
    const {result,rounds,commands,wireVersion}=readBattleResultTail(r,battle,{pet,nativeRounds,role:p.id,log});
    const companion=activePet(p),petHP=pet?r.int():null,petMP=pet?r.int():null;
    const legionResult=readLegionResult(r,p,battle);
    if(pet){const max=petAttributes(p,companion);if(companion.uid!==battle.petUid||petHP<0||petHP>max.hp||petMP<0||petMP>max.mp)fail('宠物战斗状态不完整。');}
    // Native victory belongs to the surviving side, not just the main actor.
    const survivingAlly=hp>0||(pet&&petHP>0)||legionResult.some(row=>row.hp>0||row.petHP>0);
    if(r.pos!==r.b.length||group!==battle.group||p.mapId!==battle.mapId||![1,2,3,4].includes(result)||hp<0||hp>hpMax(p)||mp<0||mp>mpMax(p)||startHP<1||startMP<0||(result===2&&(!survivingAlly||rounds===0)))fail('战斗结果数据不完整，未发放奖励。');
    // The preserved single-player client engine computes combat. This is not an online anti-cheat server.
    const before=structuredClone(p),storyBefore=context.storyBattle,legionBefore=legionResult.map(row=>[row.role,structuredClone(row.role)]);
    let reward={exp:0,coins:0,levels:0},changeMap=false;
    const killed=Object.entries((battle.monsters||[battle.monster]).reduce((o,id)=>(o[id]=(o[id]||0)+1,o),{})).map(([id,n])=>[Number(id),n]);
    try{
    p.hp=hp;p.mp=mp;if(pet){companion.hp=petHP;companion.mp=petMP;}
    for(const row of legionResult){row.role.hp=row.hp;row.role.mp=row.mp;if(row.pet){row.pet.hp=row.petHP;row.pet.mp=row.petMP;}}
    if(result===2){p.battles.wins++;recordActivity(p,24);for(const [id,count] of killed)p.battles.kills[id]=(p.battles.kills[id]||0)+count;
      for(const [id,active] of Object.entries(p.quests.active)){const q=quests[id];if(q?.monster===battle.monster)active.kills=Math.min(q.count,(active.kills||0)+1);}
      for(const [id,active] of Object.entries(p.quests.active)){const q=officialMissions.get(Number(id));if(!q)continue;active.counts??={};for(const c of q.submitCondition||[])if(c.type===2){const n=killed.find(x=>x[0]===c.monsterId)?.[1]||0;active.counts[c.monsterId]=Math.min(c.required,(active.counts[c.monsterId]||0)+n);}}
      const m=battle.official?officialMonsters.get(battle.monster):monsters[battle.monster];
      // Fixed rewards are used only when every captured sample for this group agrees.
      const samples=recorded.battleEvents.filter(x=>x.groupId===battle.group&&x.result===2);
      const observed=samples.length&&samples.every(x=>x.exp===samples[0].exp&&x.coins===samples[0].coins)?samples[0]:null;
      reward=gain(p,observed?observed.exp:battle.official?Math.max(10,m.level*10):m.exp,observed?observed.coins:battle.official?Math.max(5,m.level*5):m.coins);
      reward.pet=gainPet(p,observedPetExperience('groupId',group,reward.exp));
      const loot=rollBattleLoot(p,battle,random),delivery=applyLootDelivery(p,loot);
      reward.loot=loot;reward.added=delivery.added;reward.pending=delivery.pending;
      if(context.storyBattle?.group===group)context.storyBattle=null;
    // MOD(no-defeat-teleport)：战斗失败不再传送回城、不再改 mapId/坐标。
    // 紧随其后的 applyBattleRecovery(p)（本来就无条件执行）会把人物与出战宠物的
    // 血蓝原地回满，军团成员同样处理 → 等价于「所有战斗失败都原地复活」。
    }else{p.battles.losses++;}
    // Apply full recovery for every result inside the same save transaction.
    reward.recovery=applyBattleRecovery(p);
    for(const row of legionResult)applyBattleRecovery(row.role);
    p.battles.last={token:battle.token,group,result,rounds,time:new Date().toISOString(),reward};commit();
    }catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);for(const [role,snapshot] of legionBefore){for(const key of Object.keys(role))if(!(key in snapshot))delete role[key];Object.assign(role,snapshot);}context.storyBattle=storyBefore;throw error;}
    context.battle=null;if(result===2)notifyDaily(p,send);
    send(type,battleReward(p,result,reward,killed,changeMap));send(11004,moneyUpdate(p,reward.coins));
    if(legionResult.length)pushLegionMembers(p,send,{appearance:false});
    if(reward.pending?.length)send(10509,new Writer().byte(2).string('背包已满，未装下的掉落已保存。腾出空间后点击背包“整理”即可补发。'));
    pushHealth();pushNewbieMission(p,send);log('battle-settled',{role:p.id,...p.battles.last,commands,wireVersion});return true;
  }
  if(type===11004){send(type,moneyUpdate(p));pushHealth();return true;}
  return false;
}

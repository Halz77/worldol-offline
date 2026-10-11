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
    if(context.battle)fail('上一场战斗尚未结束。');
    // 结算被拒时 context.battle 已经清掉（见 12502 的 reject），所以这里自然放行；
    // 作废的那场只留在 context.rejectedBattle 里，供客户端重发同一包时再试一次。
    // 开新战斗就把那份丢弃。
    if(context.rejectedBattle)log('battle-rejected-cleared',{role:p.id,previous:context.rejectedBattle.group});
    context.rejectedBattle=null;
    const group=r.short()&65535;
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
    // context.battle 只在「还在等这场战斗的结算包」时才非空。结算一旦被拒，这场战斗就搬到
    // context.rejectedBattle：**所有「战斗期间不许动」的守卫（移动、传送、鉴定、附魔、军团、
    // 加点、改名…共 20 多处）会自动放行** —— 否则一次结算失败就把玩家锁死在
    // 「请先结束上一场战斗 / 上一场战斗尚未结束」上，只能重进角色（第 40 版前的实际表现）。
    // 搬到 rejectedBattle 而不是直接丢，是为了保留「客户端重发同一包能再试一次」这条契约。
    const battle=context.battle||context.rejectedBattle;
    if(!battle)fail('这场战斗已结算或未开始，请重新进入地图。');
    let settled=false;
    const reject=message=>{
      if(context.battle===battle){context.battle=null;context.rejectedBattle=battle;}
      battle.rejected=true;
      const text=String(message).replace(/，未发放奖励。$/,'');
      log('battle-result-rejected',{role:p.id,group:battle.group,mapId:battle.mapId,length:r.b.length,nativeRounds,reason:text});
      fail(text+'，未发放奖励。');
    };
    const startHP=r.int(),startMP=r.int(),hp=r.int(),mp=r.int();r.short();const group=r.short()&65535;
    const pet=r.bool(),buddies=r.byte()&255,nativeRounds=r.byte()&255;
    if(buddies||pet!==!!battle.petUid)reject(`出战队伍与进入战斗时不一致（包内伙伴 ${buddies}、宠物 ${pet?1:0}，开战时宠物 ${battle.petUid?1:0}）`);
    // 包尾解析（battle-result-wire.mjs）自己就带原因，透传给 reject() —— 不走 reject 的话
    // 这场战斗不会被标成作废，玩家仍会被卡在「上一场战斗尚未结束」上。
    let tail;try{tail=readBattleResultTail(r,battle,{pet,nativeRounds,role:p.id,log});}catch(error){reject(error.message);}
    const {result,rounds,commands,wireVersion}=tail;
    const companion=activePet(p),petHP=pet?r.int():null,petMP=pet?r.int():null;
    let legionResult;try{legionResult=readLegionResult(r,p,battle);}catch(error){reject(error.message);}
    // 客户端带的助战行数与开战快照不一致（多半是它那边的军团资料没就绪 → 这一场助战
    // 没上场）。照旧结算，但落一条日志：以后再有玩家报「结算失败」，这条能直接说明
    // 是不是这个原因。
    if(legionResult.length!==(battle.legion||[]).length)log('battle-legion-mismatch',{role:p.id,expected:(battle.legion||[]).length,received:legionResult.length});
    if(pet){const max=petAttributes(p,companion);if(companion.uid!==battle.petUid||petHP<0||petHP>max.hp||petMP<0||petMP>max.mp)reject(`宠物战斗状态不完整（血 ${petHP}/${max.hp}、蓝 ${petMP}/${max.mp}）`);}
    // Native victory belongs to the surviving side, not just the main actor.
    const survivingAlly=hp>0||(pet&&petHP>0)||legionResult.some(row=>row.hp>0||row.petHP>0);
    // 原来这十项挤在一个 if 里共用一句「战斗结果数据不完整，未发放奖励。」，线上出问题时
    // 完全看不出是哪一项（第 40 版排查打怪偶尔结算失败时就卡在这儿）。逐项写清原因，
    // 顺便让 reject() 把这场战斗标成作废，玩家可以重新开战。
    const anomaly=
      r.pos!==r.b.length?`包尾多出 ${r.b.length-r.pos} 字节`
      :group!==battle.group?`怪物组 ${group} 与开战时的 ${battle.group} 不一致`
      :p.mapId!==battle.mapId?`地图 ${p.mapId} 与开战时的 ${battle.mapId} 不一致`
      :![1,2,3,4].includes(result)?`胜败标记 ${result} 不在 1..4`
      :hp<0||hp>hpMax(p)?`生命 ${hp} 超出 0..${hpMax(p)}`
      :mp<0||mp>mpMax(p)?`法力 ${mp} 超出 0..${mpMax(p)}`
      :startHP<1?`开场生命 ${startHP} 小于 1`
      :startMP<0?`开场法力 ${startMP} 小于 0`
      :result===2&&!survivingAlly?`判定胜利但场上没有活着的一方`
      :result===2&&rounds===0?`判定胜利但回合数为 0`
      :null;
    if(anomaly)reject(`战斗结果数据不完整（${anomaly}）`);
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
    }catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);for(const [role,snapshot] of legionBefore){for(const key of Object.keys(role))if(!(key in snapshot))delete role[key];Object.assign(role,snapshot);}context.storyBattle=storyBefore;reject(error.message);}
    context.battle=null;context.rejectedBattle=null;settled=true;if(result===2)notifyDaily(p,send);
    send(type,battleReward(p,result,reward,killed,changeMap));send(11004,moneyUpdate(p,reward.coins));
    if(legionResult.length)pushLegionMembers(p,send,{appearance:false});
    if(reward.pending?.length)send(10509,new Writer().byte(2).string('背包已满，未装下的掉落已保存。腾出空间后点击背包“整理”即可补发。'));
    pushHealth();pushNewbieMission(p,send);log('battle-settled',{role:p.id,...p.battles.last,commands,wireVersion});return true;
  }
  if(type===11004){send(type,moneyUpdate(p));pushHealth();return true;}
  return false;
}

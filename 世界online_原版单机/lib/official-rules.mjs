import {officialMissions,officialItems,officialMaps,officialGroups,officialMonsters,origins,atNpc} from './official-data.mjs';
import {isCityMission,cityTarget,cityConditionMet} from './city-state.mjs';
import {missionDone} from './daily-activity.mjs';
import {isSolarMission} from './solar-challenge-data.mjs';
import {isBossTournamentMission} from './boss-tournament-data.mjs';
import {isAskSwordMission} from './ask-sword-data.mjs';
import {Reader,Writer} from './codec.mjs';
import {BOSS_HUB_MAP_ID} from './boss-hub.mjs';
/**
 * 棋盘玩法任务：太阳神殿的英雄挑战赛（2592—2606）、新月古镇广场的 BOSS 挑战赛（1305）、
 * 风雪之城的问剑十一峰（2604 / 2650 / 2651，本地重建，见 lib/ask-sword-data.mjs）。
 * 它们的提交条件在抓包里都是空的（CONDITION_NONE），不设门就等于「一接任务就能交付」——
 * 必须走完棋盘（走到 100 号交付格）置上 solarDone 才算完。
 */
export const isBoardMission=id=>isSolarMission(id)||isBossTournamentMission(id)||isAskSwordMission(id);
// Local play does not require unavailable reward definitions or unimplemented
// country/escort systems. Retain known objectives and all supported rewards.
export function missionRewards(q){return {...q,rewardItems:(q.rewardItems||[]).filter(i=>officialItems.has(i.id)),selectItems:(q.selectItems||[]).filter(i=>officialItems.has(i.id))};}
// MOD(boss-repeatable)（2026-10-25 移植自社区版「无神器自制龙宫」）：地图 277「boss直达」
// （入口见 lib/boss-hub.mjs）上带 localChallenge 标记的挑战任务全部可重复接取。
// 原版集合只有 3042（恶梦爆破），直达的 39 个挑战交完就关门。数据驱动：以后往 277
// 加新 BOSS 不用改这段。
// ⚠ 懒求值：officialMissions 是懒加载（lib/official-data.mjs 的 lazyBox），建模块时
//   访问会把整张数据图拉进堆——第一次用到时才算，之后缓存。
let repeatableSet=null;
export function repeatableChallengeMissions(){
 if(!repeatableSet)repeatableSet=new Set([3042,...[...officialMissions.values()].filter(q=>q.localChallenge&&q.mapId===BOSS_HUB_MAP_ID).map(q=>q.id)]);
 return repeatableSet;
}
export const missionClientSetting=q=>(q.setting&~(64|128|512|32768))|(repeatableChallengeMissions().has(q.id)?8:0);
// User-authorized single gap: 杀手组织 -> 俘虏. Keep the recorded definitions
// and completion history intact; only this successor bypasses missing 1678.
// The new 1358 packet mistakenly points to itself; recorded 1359 explicitly
// requires 1358, so continue to that captured successor without changing history.
export const missionFollowupId=q=>q.id===1677&&q.submitNextMissionID===1678?1679:q.id===1358&&q.submitNextMissionID===1358?1359:q.submitNextMissionID;
export function missionConditions(q,kind){
 if(isCityMission(q))return q[kind]||[];
 if(kind==='acceptCondition')return (q[kind]||[]).filter(c=>[9,10].includes(c.type)).map(c=>{
  if(q.id!==1679||c.type!==9||c.not||c.missionId!==1678)return c;
  const name=officialMissions.get(1677).name;
  return {...c,missionId:1677,name,rawHex:new Writer().short(1677).utf(name).done().toString('hex')};
 });
 return (q[kind]||[]).filter(c=>[0,1,2,7,8,9,10,11,12,32].includes(c.type)&&!(c.type===1&&c.minimum>97)&&!([7,8].includes(c.type)&&!officialItems.has(c.itemId)));
}
export function missionNotes(q){if(isCityMission(q))return ['按已录条件检查城市等级、城主、繁荣度、材料与铜币；缺少的后续城市功能待定'];const notes=[],reward=missionRewards(q);if(q.deferredRewardItems?.length)notes.push(q.deferredRewardItems.map(i=>`「${i.name}」详情待定，完成后保留待补发记录`).join('；'));else if(reward.rewardItems.length<(q.rewardItems||[]).length||reward.selectItems.length<(q.selectItems||[]).length)notes.push('缺少详情的道具奖励已跳过，其余奖励正常发放');if(q.setting&(64|128|512|32768))notes.push('按普通单机任务进行，国家奖励与护送押金不结算');if(q.id===1679)notes.push('本地剧情衔接：完成「杀手组织」后可接取本任务');else if((q.acceptCondition||[]).some(c=>[9,10].includes(c.type)))notes.push('按已录前置任务检查接取资格');if(q.id===1677)notes.push('本地剧情衔接：完成后直接继续「俘虏」');if((q.acceptCondition||[]).some(c=>[1,11,32].includes(c.type)))notes.push('接取不限制等级和职业');if(missionConditions(q,'submitCondition').length<(q.submitCondition||[]).length)notes.push('尚未实现的特殊交付条件已跳过');return notes;}
export function availableChoices(q){return (missionRewards(q).selectItems||[]).filter(i=>officialItems.has(i.id));}
export const unlimitedMission=q=>!!(missionClientSetting(q)&8);
export const missionClosed=(p,q)=>missionDone(p,q.id)&&!unlimitedMission(q);
export function battleSupported(id){const g=officialGroups.get(id);return !!g&&g.monsters.filter(id=>id>0).every(id=>officialMonsters.has(id));}
// Rescue Aisi references an uncaptured online formation (11808). Reuse the
// same chain's recorded deputy and patrol formation until that group exists.
// Project the battle ID without rewriting the capture or players' quest state.
export function missionBattleId(q,phase='accept'){
 const id=q?.[phase+'BattleID']||0;
 return q?.id===3492&&phase==='accept'&&id===11808&&!battleSupported(id)?2703:id;
}
export function missionBlockers(q){
 const reasons=[];
 if([missionBattleId(q),missionBattleId(q,'submit')].some(id=>id>0&&!battleSupported(id)))reasons.push('剧情战斗数据尚未采集');
 if((q.submitCondition||[]).some(c=>c.type===2&&!officialMonsters.has(c.monsterId)))reasons.push('任务目标怪物资料尚未采集');
 if([q.acceptJumpMapID,q.submitJumpMapID].some(id=>id>0&&!officialMaps.has(id)))reasons.push('目标地图尚未采集');
 if(!officialMaps.has(cityTarget(q,{mapId:1000}).mapId))reasons.push('交付地图尚未采集');
 if(isCityMission(q)&&[...(q.acceptCondition||[]),...(q.submitCondition||[])].some(c=>![0,1,2,5,7,8,9,10,11,12,27,29,30,31,32].includes(c.type)||(c.type===1&&c.minimum>97)))reasons.push('城市特殊条件待定');
 return [...new Set(reasons)];
}
export function conditionMet(p,c,id){
 let ok=false;switch(c.type){
  case 0:ok=true;break;case 1:ok=p.level>=c.minimum;break;
  case 2:ok=(p.quests.active[id]?.counts?.[c.monsterId]||0)>=c.required;break;
  case 7:ok=(p.inventory||[]).filter(i=>i.itemId===c.itemId&&i.slot>=30).reduce((s,i)=>s+(i.quantity||1),0)>=c.required;break;
  case 8:ok=(p.inventory||[]).some(i=>i.itemId===c.itemId&&i.slot<30);break;
  case 9:ok=missionDone(p,c.missionId);break;
  case 10:ok=!!p.quests.active[c.missionId];break;
  case 11:ok=p.race===c.value;break;case 12:ok=p.mapId===c.mapId;break;case 32:ok=p.job===c.value;break;
  case 5:case 27:case 29:case 30:case 31:return cityConditionMet(p,c);
 }return c.not?!ok:ok;
}
export function officialCanAccept(p,q){return !(isCityMission(q)&&missionBlockers(q).length)&&!p.quests.active[q.id]&&!missionClosed(p,q)&&missionConditions(q,'acceptCondition').every(c=>conditionMet(p,c,q.id));}
function prerequisiteName(c){
 const name=officialMissions.get(c.missionId)?.name||c.name;if(name)return name;
 // The recorded condition retains its display name even when the prerequisite
 // quest's own definition was never captured.
 try{const r=new Reader(Buffer.from(c.rawHex||'','hex'));if(r.short()===c.missionId){const recorded=r.string();if(recorded&&r.pos===r.b.length)return recorded;}}catch{}
 return String(c.missionId);
}
export function missingPrerequisites(p,q){return missionConditions(q,'acceptCondition').filter(c=>[9,10].includes(c.type)&&!conditionMet(p,c,q.id)).map(c=>({id:c.missionId,name:prerequisiteName(c),type:c.type,not:!!c.not,pending:!officialMissions.has(c.missionId)}));}
export function prerequisiteMessage(p,q){return missingPrerequisites(p,q).map(c=>`${c.not?'需尚未':c.type===10?'需先接取':'需先完成'}「${c.name}」${c.pending?'（未采集，待定）':''}`).join('；');}
export function officialComplete(p,q){
 // 棋盘玩法（太阳神殿英雄挑战赛 / 1305 BOSS 挑战赛）的提交条件在抓包里是空的
 // （CONDITION_NONE），拿它判定等于「一接任务就能交付」—— 必须走完棋盘
 // （14510 走到 100 号交付格）置上 solarDone 才算完。
 // 这也是 14502 接完能立刻弹棋盘的原因。
 if(isBoardMission(q.id)&&!p.quests.active[q.id]?.solarDone)return false;
 return (!!p.quests.active[q.id]||!!(q.setting&1)&&officialCanAccept(p,q))&&missionConditions(q,'submitCondition').every(c=>conditionMet(p,c,q.id));
}
export function missionStateMatches(p,id,mask){if(id<=0)return true;if(missionDone(p,id))return !!(mask&1);const q=officialMissions.get(id);if(p.quests.active[id])return !!(mask&(q&&officialComplete(p,q)?4:2));return !!(mask&8);}
export function npcEnabled(p,n){if(n.local||!n.wireBase64)return true;let enabled=(n.status&3)===3;const v=n.missionData;if(v?.[0]>0&&missionStateMatches(p,v[0],v[1]))enabled=true;if(v?.[2]>0&&missionStateMatches(p,v[2],v[3]))enabled=false;return enabled;}
export function missionsAt(p,npcId){return [...officialMissions.values()].filter(q=>{const target=cityTarget(q,p);return !missionClosed(p,q)&&(atNpc(q,p.mapId,npcId)||(isCityMission(q)||p.quests.active[q.id])&&target.mapId===p.mapId&&target.npcId===npcId);});}
export function officialSign(p,n){const list=missionsAt(p,n.id);if(list.some(q=>{const target=cityTarget(q,p);return target.mapId===p.mapId&&target.npcId===n.id&&officialComplete(p,q);}))return 1;if(list.some(q=>officialCanAccept(p,q)))return 3;return list.some(q=>p.quests.active[q.id])?2:0;}
export function originFor(p,q,npcId){if(isCityMission(q))return cityTarget(q,p);return origins(q).find(x=>x.mapId===p.mapId&&x.npcId===npcId)||origins(q).find(x=>officialMaps.has(x.mapId))||{mapId:q.acceptMapId,npcId:q.acceptNpcId};}

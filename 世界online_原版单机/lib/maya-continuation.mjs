/**
 * 玛雅副本 —— 剧情接线。
 *
 * ## 做什么
 * 8700—8709 建出来只是「有任务」，还得让两头指过来、下一环指出去：
 * -3219「巨石神兵」打完 → 交回 8700（不再指向缺失的 3220）
 * - 8709 走完 → 交回 1824「告白」，告白的接取前置从缺失的 1823 改成 8709
 * - 1831 愤怒的 submitNextMissionID 从缺失的 3232 改成 1832
 * - 838 地图里蒂卡尔（npc 2）的可见性前置从 1823 改成 3219
 *
 * ## 为什么改 wireBase64 而不是只改字段
 * 客户端判定 NPC 是否可见、任务是否可接，读的是 NPC 记录字节里的
 * missionData（前置任务号）与 status 位，不是服务端下发的 JS 对象 ——
 * 改字段客户端不认。这里是**原地改字节**：先Reader 读回校验前置确实是 1823、
 * 可见性位确实开着，再写新值。
 *
 * ## 守卫
 * 每一步改动前都校验前置数据没变（前置任务号、可��位、目标 NPC 存在），
 * 任何一条对不上直接抛错 —— 原版数据一旦被别的补丁动过，
 * 静默写错字节会让客户端整包解析失败，症状是进游戏黑屏，很难查。
 */
import {Reader,Writer} from './codec.mjs';
import {createMayaPalaceStory} from './maya-palace-story.mjs';

/**
 * 改 NPC 的任务前置可见性（missionData[0]）与其字节记录。
 * 布局：14 字节头 + 3 个 utf + status(byte) + 5 字节 + short(前置任务号)。
 */
function changeNpcPrerequisite(npc,previous,next){
 if(npc.missionData?.[0]!==previous)throw Error('Maya NPC prerequisite changed');
 const bytes=Buffer.from(npc.wireBase64,'base64'),r=new Reader(bytes);
 r.take(14);
 r.utf();r.utf();r.utf();
 const status=r.byte()&255;
 r.take(5);
 if(!(status&8)||bytes.readUInt16BE(r.pos)!==previous)throw Error('Maya NPC visibility packet changed');
 // 留档：改之前的原值，便于日后核对（和协议字段的 recorded* 同惯例）。
 npc.recordedMissionData=[...npc.missionData];
 npc.missionData=[next,...npc.missionData.slice(1)];
 bytes.writeUInt16BE(next,r.pos);
 npc.wireBase64=bytes.toString('base64');
 npc.localVisibilityReason='Continue the Maya story after the stone guardian';
}

export function applyMayaContinuation(o){
 const quest=id=>{
  const q=o.missions.find(x=>x.id===id);
  if(!q)throw Error('Missing Maya quest '+id);
  return q;
 };
 const guardian=quest(3219),confession=quest(1824),anger=quest(1831);
 const temple=o.maps.find(m=>m.id===838),tikal=temple?.npcs.find(n=>n.id===2);
 // 前置自检：官方数据被别的补丁动过就别硬写。
 if(o.maps.some(m=>m.id===962)||guardian.mapId!==962||guardian.npcId!==14||
    guardian.submitNextMissionID!==3220||anger.submitNextMissionID!==3232||!tikal)
  throw Error('Maya continuation source data changed');
 const prerequisite=confession.acceptCondition.find(c=>c.type===9&&!c.not&&c.missionId===1823);
 if(!prerequisite)throw Error('Maya confession prerequisite changed');

 const palace=createMayaPalaceStory(o);
 o.maps.push(palace.map);
 o.missions.push(...palace.missions);
 const first=palace.missions[0],last=palace.missions.at(-1);

 // 3219 打完 → 8700
 guardian.recordedContinuation={
  submitNextMissionID:guardian.submitNextMissionID,
  dialogStartFinish:guardian.dialogStartFinish,
 };
 guardian.submitNextMissionID=first.id;
 guardian.submitJumpMapID=0;
 guardian.desc+='\n击败巨石神兵后，进入地下宫殿找蒂卡尔交付，再一起调查宫殿深处。';
 guardian.dialogStartFinish='巨石神兵已被击败，但地下宫殿里的守卫还没有散去。先在这里站稳脚跟，再找通往祭祀宫殿的路。';

 // 1824 告白的接取前置：1823（缺失）→ 8709（地下宫殿终环）
 confession.recordedAcceptCondition=structuredClone(confession.acceptCondition);
 Object.assign(prerequisite,{
  missionId:last.id,name:last.name,
  rawHex:new Writer().short(last.id).utf(last.name).done().toString('hex'),
 });
 confession.desc+='\n完成地下宫殿的调查后，与蒂卡尔继续前进。';
 changeNpcPrerequisite(tikal,1823,guardian.id);

 // 1831 愤怒：下一环 3232（缺失）→ 1832
 anger.recordedSubmitNextMissionID=anger.submitNextMissionID;
 anger.submitNextMissionID=1832;
 return o;
}
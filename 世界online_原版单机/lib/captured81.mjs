/**
 * 八一副本（81 后续）—— 录制数据注入。
 *
 * ## 背景
 * 原版 v305 任务表里，902—922 与 1421 有头无尾：1430 之后整条链断掉，995 地图也没人做。
 * 社区版（世界OL_字体注入版 1.26.1017）拿到过一份 2026-09-26 的完整录制包
 * （capture 2026-09-26T14-37-53-190Z_cf1c1d），把它整理成
 * data/captured81-20260926.json 注入官方表，本模块就是这个注入动作。
 *
 * ## 数据内容（全部带原始 wireBase64，不重新拼字节）
 * - maps 2 张：955 沙漠（重录补全 NPC）、990 八一副本
 * - missions 31 个：902—922、1421—1430
 * - groups 15 组 / monsters 20 只 / ai 11 套 / skills 10 条 / items 5 件
 *
 * ## 三处单机适配（都写在 desc 里，玩家看得到）
 * ① 1421—1430 的接取条件录制值是 120 级，但任务原对白标明 81 级 → 按 81 级开放，
 *    怪物属性保持录制值。rawHex 里最低级字节从 120 改成 81（0x78→0x51）。
 * ② 990 地图没有回前一段的路 → 补一个 NPC id 0「返回朱雀村」传回 955。
 * ③ 缺完整定义的八一高级奖励（1516）不发，任务奖励里过滤掉。
 *
 * ## 冲突处理
 * 已存在的记录若 wireBase64 与录制包不一致 → 直接抛错，不静默覆盖。
 * （同一份官方数据被谁改过要立刻知道，否则玩家会遇到"怪物放技能但数值是旧的"。）
 */
import fs from 'node:fs';
import {Writer} from './codec.mjs';

const data=JSON.parse(fs.readFileSync(new URL('../data/captured81-20260926.json',import.meta.url),'utf8'));

/** 合并 sources，按「录制+序号+地图+NPC+来源」去重（同一段录制可能被多次引用）。 */
function mergeSources(a=[],b=[]){
 return [...new Map([...a,...b].map(s=>[[s.capture,s.seq,s.mapId,s.npcId,s.origin].join(':'),s])).values()];
}

export function applyCaptured81(o){
 // —— groups / monsters / ai：整表灌入 ——
 for(const [table,key] of [['groups','groupId'],['monsters','id'],['ai','id']]){
  for(const row of data[table]){
   const existing=o[table].find(x=>x[key]===row[key]);
   if(existing){
    if(existing.wireBase64!==row.wireBase64)throw Error('Conflicting captured81 '+table+' '+row[key]);
    existing.sources=mergeSources(existing.sources,row.sources);
   }else o[table].push(structuredClone(row));
  }
 }
 // —— skills：怪物技能表按 id+level 定位 ——
 for(const row of data.skills){
  const existing=o.skills.find(s=>s.id===row.id&&s.level===row.level);
  if(existing){
   if((existing.monsterWireBase64||existing.wireBase64)!==row.wireBase64)throw Error('Conflicting captured81 skill '+row.id+':'+row.level);
   existing.sources=mergeSources(existing.sources,row.sources);
  }else o.skills.push(structuredClone(row));
 }
 // —— items：只补录包里带完整定义的 ——
 for(const row of data.items||[]){
  if(row.definitionBase64&&!o.items.some(i=>i.id===row.id))o.items.push(structuredClone(row));
 }
 // —— missions：整条替换（录制包更全），并做上面三处适配 ——
 for(const source of data.missions){
  const q=structuredClone(source);
  // 没有完整道具定义的奖励不发 —— 引用未定义道具会让 planItemRewards 整包抛错。
  // 没有完整道具定义的奖励**必须从 rewardItems 里拿掉**，不能只记在 deferred 里：
  // 发放奖励走 planItemRewards，它碰到未定义道具会整包抛错
  // —— 一件坏道具会让 14501 奖励包发不出去，客户端进游戏直接黑屏。
  // 录制包里 1516「八一高级奖励」就是这种：只有任务奖励摘要，没有道具定义。
  q.deferredRewardItems=(q.rewardItems||[]).filter(i=>!o.items.some(item=>item.id===i.id));
  if(q.deferredRewardItems.length){
   q.rewardItems=(q.rewardItems||[]).filter(i=>o.items.some(item=>item.id===i.id));
   q.desc+='\n【单机适配】'+q.deferredRewardItems.map(i=>i.name+'('+i.id+')').join('、')+
    ' 缺完整道具定义，本次不发（定义补齐后可恢复）。';
  }
  if(q.id>=1421&&q.id<=1430){
   q.enforceLevel=true;
   q.acceptCondition=(q.acceptCondition||[]).map(c=>
     c.type===1&&!c.not&&c.minimum===120?{...c,minimum:81,rawHex:'51',capturedMinimum:120}:c);
   if(q.acceptCondition.some(c=>c.capturedMinimum))
    q.desc+='\n【单机适配】录制条件为120级，任务原对白标明81级；本单机按81级开放，怪物属性保持录制值。';
   const origin=q.sources.find(s=>s.origin==='npc-task-read'&&s.mapId&&s.npcId!==undefined);
   if(origin){q.acceptMapId=origin.mapId;q.acceptNpcId=origin.npcId;}
  }
  const index=o.missions.findIndex(row=>row.id===q.id);
  if(index<0)o.missions.push(q);else o.missions[index]=q;
 }
 // —— maps：955 / 990 整张替换；990 补一个回前一段的 NPC ——
 for(const source of data.maps){
  const map=structuredClone(source);
  const index=o.maps.findIndex(m=>m.id===map.id);
  map.spawn=Array.isArray(map.spawn)?map.spawn:[map.spawn.x,map.spawn.y];
  if(map.id===990){
   if(map.npcs.some(n=>n.id===0))throw Error('captured81 return portal ID collision');
   const name='返回朱雀村';
   const talk='【单机补配】返回八一副本前半段；81后续任务进度保留。';
   const back=o.maps.find(m=>m.id===955).spawn;
   // NPC 记录布局：状态3 + 传送目标（见 lib/codec.mjs 与 content.mjs 的 NPC 编码）。
   const wire=new Writer().byte(0).byte(0).byte(0).byte(3).long(2236552).short(0)
    .utf(name).utf('').utf(talk).byte(3).byte(1).byte(21).byte(33).byte(0).byte(0)
    .utf(name).short(955).byte(back[0]).byte(back[1]);
   map.npcs.push({
    id:0,mapId:990,sign:0,missionGroupID:0,npcType:3,icon1:'2236552',businessIcon:0,
    name,welcome:'',talkDetail:talk,status:3,direction:1,x:21,y:33,sourceGx:21,sourceGy:33,
    rangeX:0,rangeY:0,topic:name,jumpMapID:[955],jumpMapGx:[back[0]],jumpMapGy:[back[1]],
    wireBase64:wire.done().toString('base64'),
    localReturnPortal:true,
    sources:[{origin:'local-captured81-return',mapId:990,npcId:0}],
   });
  }
  if(index<0)o.maps.push(map);else o.maps[index]=map;
 }
 return o;
}
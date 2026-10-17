import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Reader} from '../lib/codec.mjs';
import {official,officialMaps,officialMissions} from '../lib/official-data.mjs';
import {maps,normalizeRole} from '../lib/content.mjs';
import {npcEnabled,missionClosed,missionsAt} from '../lib/official-rules.mjs';
import {cityTarget} from '../lib/city-state.mjs';
import {cityUpgradeIds,cityUpgradeDone,completedCityUpgrades} from '../lib/city-progress.mjs';
import {missionDone,ensureDaily} from '../lib/daily-activity.mjs';
import {missionBits} from '../lib/game-packets.mjs';
import {cityTemplateRevision,applyCityTemplateFixes,applyCityFlightStations,cityFlightRegions,cityFlightDestinations} from '../lib/city-template-fixes.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';

const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
const role=(extra={})=>normalizeRole({id:1001,name:'城市模板检查',sex:1,race:0,job:1,level:1,mapId:14,x:21,y:29,...extra});
const cityMaps=()=>official.maps.filter(m=>m.cityTemplate);
/** 用客户端自己的解码器（模块 74 的 fromBytes）读回 NPC 记录 —— 客户端看到的就是这个。 */
const parse=npc=>{const reader=new NativeReader(Buffer.from(npc.wireBase64,'base64'));const parsed=d.Npc.fromBytes(reader);reader.finish();return parsed;};

test('城市模板：任务公告板补上可见位（客户端 STATUS_VISIBLE=1），其它字段不动',()=>{
 const cities=cityMaps();
 assert.equal(cities.length,2,'个人城市模板地图数量变了：'+cities.map(m=>m.id));
 let boards=0;
 for(const map of cities)for(const npc of map.npcs){
  if(npc.npcType!==0||!['日常任务列表','日常高级任务列表'].includes(npc.name))continue;
  boards++;
  assert.equal(npc.status&1,1,'公告板仍然不可见：'+map.id+':'+npc.id);
  assert.equal(npc.localCityTemplateFix,'show-recorded-task-board');
  const parsed=parse(npc);
  assert.equal(parsed.status&1,1,'wire 里的可见位没补上：'+map.id+':'+npc.id);
  assert.equal(parsed.status&255,npc.status,'wire 与字段的状态位不一致：'+map.id+':'+npc.id);
  assert.equal(parsed.talkDetail,npc.talkDetail,'公告板对白被改动了');
  assert.equal(parsed.name,npc.name);
  const p=role({mapId:map.id,cityUnlocked:true});
  assert.ok(npcEnabled(p,npc),'公告板在服务端仍被判为不可交互：'+map.id+':'+npc.id);
 }
 // 1000:6 日常任务列表、3090:6 日常任务列表、3090:8 日常高级任务列表
 assert.equal(boards,3,'录到的公告板数量变了：'+boards);
});

test('城市模板：市长换成扩建后对白，扩建前那位与其它 NPC 不动',()=>{
 for(const map of cityMaps()){
  const mayor=map.npcs.find(n=>n.id===7&&n.name==='代理市长-雷恩');
  assert.ok(mayor,'城市模板缺「扩建后」市长：'+map.id);
  assert.equal(mayor.missionData[0],3005,'市长的任务菜单变了：'+map.id);
  assert.ok(mayor.talkDetail.includes('已经完成扩建'),'市长对白没换成扩建后版本：'+map.id);
  assert.ok(mayor.recordedTalkDetail.includes('新生的城市'),'没有留下原对白：'+map.id);
  assert.equal(parse(mayor).talkDetail,mayor.talkDetail,'wire 里的市长对白没换：'+map.id);
  assert.equal(mayor.welcome,parse(mayor).welcome,'招呼语不该动：'+map.id);
  // 另一位市长（missionData=[0,0,3005,1]）负责扩建前的引导，文案必须保持原样。
  const before=map.npcs.find(n=>n.missionData?.[2]===3005);
  assert.ok(before,'城市模板缺「扩建前」市长：'+map.id);
  assert.ok(before.talkDetail.includes('新生的城市'),'扩建前的市长对白被误改：'+map.id);
  assert.equal(before.localCityTemplateFix,undefined,'扩建前的市长不该被打标记：'+map.id);
  assert.equal(parse(before).talkDetail,before.talkDetail);
 }
});

test('城市模板：飞行驿站补上【主城】【地区】【副本】【节日】航线，wire 与数组逐项一致',()=>{
 const destinations=cityFlightDestinations(official);
 const listed=cityFlightRegions.reduce((sum,[,ids])=>sum+ids.length,0);
 assert.equal(destinations.length,listed,'有航线被跳过（缺地图/出生点不合法）：'+(listed-destinations.length));
 for(const destination of destinations){
  assert.ok(maps[destination.target],'航线目标不在运行时地图表里：'+destination.target);
  assert.ok(officialMaps.has(destination.target),'航线目标不在 official.maps 里：'+destination.target);
  assert.ok(!maps[destination.target].cityTemplate,'航线目标不该是个人城市模板：'+destination.target);
  assert.deepEqual([destination.gx,destination.gy],maps[destination.target].spawn,'落点不是目标地图出生点：'+destination.target);
  assert.equal(destination.mission,0,'新航线不该带门槛');
  assert.equal(destination.state,0);
 }
 for(const map of cityMaps()){
  const station=map.npcs.find(n=>n.npcType===5&&n.name==='飞行驿站');
  assert.ok(station,'城市模板缺飞行驿站：'+map.id);
  assert.equal(station.localCityFlightExpansion,cityTemplateRevision);
  assert.ok(station.jumpMapID.length<=127,'航线超过原版 byte 上限：'+station.jumpMapID.length);
  assert.deepEqual(station.jumpMapID.slice(0,5),[906,5,263,824,262],'原版 5 条航线必须原样留在最前面：'+map.id);
  const parsed=parse(station);
  assert.deepEqual(Array.from(parsed.jumpMapID),station.jumpMapID,'wire 与字段的航线不一致：'+map.id);
  assert.deepEqual(Array.from(parsed.jumpMapGx),station.jumpMapGx);
  assert.deepEqual(Array.from(parsed.jumpMapGy),station.jumpMapGy);
  assert.deepEqual(Array.from(parsed.jumpMapReqMissionID||[]),station.jumpMapReqMissionID,'wire 与字段的门槛不一致：'+map.id);
  assert.equal(parsed.talkDetail,station.talkDetail,'驿站对白没换：'+map.id);
  for(const [region] of cityFlightRegions)assert.ok(station.menuJumpMap.some(label=>label.startsWith('【'+region+'】')),'缺 '+region+' 组：'+map.id);
  // 新加的每一条都指向目标地图自己的出生点。
  for(let i=5;i<station.jumpMapID.length;i++){
   const target=station.jumpMapID[i];
   assert.deepEqual([station.jumpMapGx[i],station.jumpMapGy[i]],maps[target].spawn,'落点不对：'+map.id+' -> '+target);
  }
 }
});

test('城市模板：补丁幂等，且不碰城市模板之外的任何 NPC',()=>{
 const snapshot=()=>official.maps.map(m=>m.id+':'+m.npcs.map(n=>`${n.id}/${n.status}/${n.wireBase64}`).join(',')).join('|');
 const before=snapshot();
 assert.equal(applyCityTemplateFixes(official),official);
 assert.equal(applyCityFlightStations(official),official);
 assert.equal(snapshot(),before,'重复应用改了内容');
 for(const map of official.maps)if(!map.cityTemplate)for(const npc of map.npcs){
  assert.equal(npc.localCityTemplateFix,undefined,'碰了非城市模板 NPC：'+map.id+':'+npc.id);
  assert.equal(npc.localCityFlightExpansion,undefined,'碰了非城市模板 NPC：'+map.id+':'+npc.id);
 }
});

test('城市升级任务：城市等级就是完成证据（与完成记录无关）',()=>{
 const p=level=>({cityUnlocked:true,city:{level},quests:{active:{},completed:[]}});
 assert.deepEqual(completedCityUpgrades(p(1)),[]);
 assert.deepEqual(completedCityUpgrades(p(2)),[3002]);
 assert.deepEqual(completedCityUpgrades(p(3)),[3002,3003]);
 assert.deepEqual(completedCityUpgrades(p(5)),[3002,3003,3004,3005]);
 for(const level of [1,2,3,4,5])for(const id of cityUpgradeIds)assert.equal(cityUpgradeDone(p(level),id),level>=id-3000,'等级 '+level+' / 任务 '+id);
 assert.equal(cityUpgradeDone({cityUnlocked:false,city:{level:5},quests:{}},3002),false,'没拿到城市不该算完成');
 assert.equal(cityUpgradeDone(p(5),1421),false,'非升级任务不受影响');
});

test('城市升级任务：完成记录被跨天清掉后，位图 / 交付 / 任务菜单仍然按等级算',()=>{
 const p=role({mapId:1000,cityUnlocked:true,city:{level:5},quests:{active:{},completed:[]}});
 const history=structuredClone(p.quests);
 for(const id of cityUpgradeIds){
  const q=officialMissions.get(id);
  assert.ok(q,q+' 没注册');
  assert.equal(cityTarget(q,p).mapId,p.mapId,'城市任务的交付点没落到当前城市：'+id);
  assert.equal(missionDone(p,id),true,'等级到了却没算完成：'+id);
  assert.equal(missionClosed(p,q),true,'等级到了仍会被重新摆出来：'+id);
  assert.equal(missionsAt(p,cityTarget(q,p).npcId).some(m=>m.id===id),false,'升级任务又被摆出来了：'+id);
  assert.ok(missionBits(p)[id>>3]&(1<<(id%8)),'任务位图缺 '+id);
 }
 assert.deepEqual(p.quests,history,'只读判定不该改存档');
 // 等级不够时照旧：任务还能接。
 const fresh=role({mapId:1000,cityUnlocked:true,city:{level:1},quests:{active:{},completed:[]}});
 assert.equal(missionDone(fresh,3002),false);
 assert.equal(missionClosed(fresh,officialMissions.get(3002)),false);
});

test('跨天重置保留城市升级任务的完成记录，普通任务照旧被清掉（跨天重开的约定不变）',()=>{
 const p=role({mapId:1000,cityUnlocked:true,city:{level:3},
  quests:{active:{},completed:[3002,3003,1421]},
  dailyActivity:{version:2,day:'2000-01-01',progress:{1:1},completed:{},credited:[],taskTimes:{},claimedVitality:[],claimedActive:[]}});
 ensureDaily(p,new Date('2026-10-18T04:00:00Z'));
 assert.deepEqual(p.quests.completed.filter(id=>cityUpgradeIds.includes(id)),[3002,3003],'城市升级任务的记录被清掉了');
 assert.ok(!p.quests.completed.includes(1421),'普通任务的记录没被清掉（跨天重开的约定变了）');
});

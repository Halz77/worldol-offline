import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {openPortal} from '../lib/open-portals.mjs';
import {official} from '../lib/official-data.mjs';
import {maps,normalizeRole,walkable} from '../lib/content.mjs';
import {npcEnabled} from '../lib/official-rules.mjs';
import {Reader,Writer} from '../lib/codec.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
import {handleGame} from '../lib/game-service.mjs';
import {worldTravelMaps} from '../lib/world-travel.mjs';
const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
const role=()=>normalizeRole({id:1001,name:'传送检查',sex:1,race:0,job:1,level:1,mapId:14,x:21,y:29});

test('recorded Maya and Sun City directory entries resolve to their actual scene IDs',()=>{
 const maya=worldTravelMaps(15),sun=worldTravelMaps(4);
 for(const id of [960,35])assert.ok(maya.some(m=>m.id===id));
 for(const id of [906,260,257])assert.ok(sun.some(m=>m.id===id));
 assert.equal(new Set(maya.map(m=>m.id)).size,maya.length);
});

test('all native portal NPCs are visible and every travel choice ignores quest flags in the original decoder',()=>{
 const p=role(),history=structuredClone(p.quests),portals=official.maps.flatMap(m=>m.npcs.filter(n=>n.jumpMapID?.length));
 // 226 个原版传送门 + 剧情补配的 3 个：990「返回朱雀村」（见 lib/captured81.mjs）、
 // 962 地下宫殿的入口「卡斯蒂略金字塔」与出口「祭祀宫殿」（见 lib/maya-palace-story.mjs）。
 // 它们同样必须可见、无任务门槛 —— 剧情链就靠这几个传送门连着。
  const supplemented=portals.filter(n=>n.localReturnPortal||n.localMayaStory||n.localStoryReturn).length;
  assert.equal(portals.length,226+supplemented);
  // 原版 226 + 已知补配（captured81 的 990、玛雅的 962 入口/出口，最多 3 个）
  // + 续篇补完框架统一加的「返回/前往」出口（localStoryReturn，随恢复地图增减）。
  assert.ok(supplemented>=1&&supplemented<=40,'补配传送门数量异常：'+supplemented);
 for(const n of portals){
  // 955 的「81新副本入口」是唯一有任务门槛的传送门，而且是有意的：
  // 录制数据里它带missionData=[1421,…]，即「接了 1421 紧急情报才进副本」。
  // 这是官方原样，不是本工程的补丁，所以不能按「所有传送门都无门槛」来校验。
  const gated=n.missionData?.[0]===1421;
  // 81 入口接了 1421 之后才可见（status 位没全开，靠 missionData 放行），
  // 所以这里给一个「已接 1421」的存档来验，不能用空白存档。
  const gateRole=gated?{...p,quests:{active:{1421:{origin:{mapId:955,npcId:1},counts:{}}},completed:[]}}:p;
  assert.ok(npcEnabled(gateRole,n),n.name);const reader=new NativeReader(Buffer.from(n.wireBase64,'base64')),parsed=d.Npc.fromBytes(reader);reader.finish();
  if(gated)assert.equal(parsed.missionData[0],1421,n.name);
  else{
   // 无门槛的传送门必须是 status 位全开（3），这是 applyOpenPortals 统一的开门方式。
   assert.equal(parsed.status&3,3,n.name);
   assert.ok((parsed.missionData||[]).every(v=>v===0),n.name);assert.ok((parsed.jumpMapReqMissionID||[]).every(v=>v===0),n.name);
  }
  assert.deepEqual(Array.from(parsed.jumpMapID),n.jumpMapID);assert.deepEqual(Array.from(parsed.jumpMapGx),n.jumpMapGx);assert.deepEqual(Array.from(parsed.jumpMapGy),n.jumpMapGy);
  assert.deepEqual(Array.from(parsed.shopReqMissionID||[]),n.shopReqMissionID||[]);assert.deepEqual(Array.from(parsed.battleReqMissionID||[]),n.battleReqMissionID||[]);
 }
 assert.deepEqual(p.quests,history);
});

test('all restored portal destinations accept a level-one role and produce the target scene packet',()=>{
 const p=role(),context={role:p},sent=[],env={store:{save(){}},send(type,w){sent.push({type,bytes:w.done()});},log(){}};let entered=0;
 for(const m of official.maps)for(const n of m.npcs)for(let i=0;i<(n.jumpMapID?.length||0);i++){
  const id=n.jumpMapID[i];if(!maps[id])continue;
  Object.assign(p,{mapId:m.id,x:n.x,y:n.y});sent.length=0;const history=structuredClone(p.quests);
  assert.ok(handleGame(10506,new Reader(new Writer().short(id).byte(n.jumpMapGx[i]).byte(n.jumpMapGy[i]).done()),context,env));
  const r=new Reader(sent.find(x=>x.type===10506).bytes);assert.equal(r.byte(),0,n.name);assert.equal(r.int(),id,n.name);assert.equal(p.mapId,id,n.name);assert.ok(walkable(id,p.x,p.y),n.name);assert.deepEqual(p.quests,history);entered++;
 }
 assert.ok(entered>200);
});

test('opening portals leaves ordinary story NPCs intact and failed transfers preserve location and quest history',()=>{
 const girl=official.maps.find(m=>m.id===952).npcs.find(n=>n.id===60);assert.equal(openPortal(girl),girl);assert.equal(girl.missionData[0],2821);
 const p=role(),before=structuredClone(p),request=new Writer().short(3).byte(3).byte(39).done();assert.throws(()=>handleGame(10506,new Reader(request),{role:p},{store:{save(){assert.fail();}},send(){},log(){}}),/尚未采集/);assert.deepEqual(p,before);
 Object.assign(p,{mapId:14,x:19,y:30});const retained=structuredClone(p);
 assert.throws(()=>handleGame(10506,new Reader(new Writer().short(954).byte(25).byte(35).done()),{role:p},{store:{save(){throw Error('disk full');}},send(){},log(){}}),/disk full|可通行/);assert.deepEqual(p,retained);
});

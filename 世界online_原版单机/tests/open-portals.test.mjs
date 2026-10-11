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

test('all 226 native portal NPCs are visible and every travel choice ignores quest flags in the original decoder',()=>{
 const p=role(),history=structuredClone(p.quests),portals=official.maps.flatMap(m=>m.npcs.filter(n=>n.jumpMapID?.length));
 assert.equal(portals.length,226);
 for(const n of portals){
  assert.ok(npcEnabled(p,n),n.name);const reader=new NativeReader(Buffer.from(n.wireBase64,'base64')),parsed=d.Npc.fromBytes(reader);reader.finish();
  assert.equal(parsed.status&3,3,n.name);assert.ok((parsed.missionData||[]).every(v=>v===0),n.name);assert.ok((parsed.jumpMapReqMissionID||[]).every(v=>v===0),n.name);
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
 const p=role(),before=structuredClone(p),request=new Writer().short(2).byte(3).byte(39).done();assert.throws(()=>handleGame(10506,new Reader(request),{role:p},{store:{save(){assert.fail();}},send(){},log(){}}),/尚未采集/);assert.deepEqual(p,before);
 Object.assign(p,{mapId:14,x:19,y:30});const retained=structuredClone(p);
 assert.throws(()=>handleGame(10506,new Reader(new Writer().short(954).byte(25).byte(35).done()),{role:p},{store:{save(){throw Error('disk full');}},send(){},log(){}}),/disk full|可通行/);assert.deepEqual(p,retained);
});

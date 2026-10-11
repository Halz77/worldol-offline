import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Writer,Reader} from '../lib/codec.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
import {readAddedItems} from '../tools/capture-public-blocks.mjs';
import {normalizeRole,maps,hpMax,mpMax} from '../lib/content.mjs';
import {official,officialMissions,officialMaps,origins} from '../lib/official-data.mjs';
import {officialCanAccept,officialComplete,missionConditions,conditionMet,missingPrerequisites,missionClosed} from '../lib/official-rules.mjs';
import {dailyData,dailyKey,ensureDaily,dailySnapshot,recordActivity,recordMissionCompletion,missionDone} from '../lib/daily-activity.mjs';
import {handleDaily,encodeDaily,decodeDaily} from '../lib/daily-service.mjs';
import {handleOfficial} from '../lib/official-service.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {handleEquipmentUpgrades} from '../lib/equipment-upgrade-service.mjs';
import {handlePetItems} from '../lib/pet-service.mjs';
import {handleGame,BATTLE_TRAILER} from '../lib/game-service.mjs';
import {missionBits} from '../lib/game-packets.mjs';
import {worldTravelMaps} from '../lib/world-travel.mjs';
import {planItemRewards} from '../lib/restoration.mjs';
import {cityTarget} from '../lib/city-state.mjs';
import {SaveStore} from '../lib/store.mjs';

const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
function role(){const p=normalizeRole({id:1001,name:'日常测试',level:97,job:1,race:0,sex:1,mapId:1});p.inventory=[];p.quests={active:{},completed:[]};return p;}
function harness(p=role(),save=()=>{}){
 const context={role:p},sent=[],env={store:{save},send(type,w){sent.push({type,b:w instanceof Writer?w.done():w});},log(){},draw:()=>0};
 return {p,context,sent,env,call(type,body=new Writer(),reply=type){const r=new Reader(body instanceof Writer?body.done():body);assert.ok(handleDaily(type,r,context,env)||handleOfficial(type,r,context,env)||handleEquipmentUpgrades(type,r,context,env)||handlePetItems(type,r,context,env)||handleRestoration(type,r,context,env)||handleGame(type,r,context,env));return new Reader(sent.findLast(x=>x.type===reply)?.b||[]);}};
}
function position(p,mapId,npcId){const npc=maps[mapId]?.npcs.find(n=>n.id===npcId);assert.ok(npc,`${mapId}:${npcId}`);Object.assign(p,{mapId,mapName:maps[mapId].name,x:npc.x,y:npc.y});}

test('every captured world region uses scene IDs, opens at level one and rejects unrecorded scenes',()=>{
 const h=harness();h.p.level=1;
 assert.ok(worldTravelMaps(16).some(m=>m.id===37));assert.ok(worldTravelMaps(15).some(m=>m.id===960));
 assert.ok(!worldTravelMaps(7).some(m=>m.id===37)); // no directory-ID collision
 for(const area of official.areas){const r=h.call(10522,new Writer().int(area.id));assert.equal(r.byte(),0,area.name);const count=r.byte();assert.ok(count>0);for(let n=0;n<count;n++){const id=r.short();r.string();r.string();r.byte();r.byte();assert.ok(officialMaps.has(id));assert.equal(h.call(10523,new Writer().int(id)).byte(),0);assert.equal(h.p.mapId,id);}assert.equal(r.pos,r.b.length);}
 const before=structuredClone(h.p);assert.equal(h.call(10523,new Writer().int(9999)).byte(),-1);assert.deepEqual(h.p,before);
 const failed=harness(h.p,()=>{throw Error('disk unavailable');});assert.equal(failed.call(10523,new Writer().int(37)).byte(),-1);assert.deepEqual(h.p,before);
 const destination=maps[265].spawn;assert.equal(h.call(10506,new Writer().short(265).byte(destination[0]).byte(destination[1]).int(7232).bool(false)).byte(),0);assert.equal(h.p.mapId,265,'native daily shortcut enters a captured map without an adjacent portal');
});

test('captured positive, negative and active prerequisites are enforced without deleting active quests',()=>{
 const p=role(),q=officialMissions.get(1133);assert.equal(officialCanAccept(p,q),false);
 assert.deepEqual(missingPrerequisites(p,q).map(c=>c.id),[1136]);
 assert.ok(missionConditions(q,'acceptCondition').every(c=>[9,10].includes(c.type)));
 p.quests.completed.push(1136);assert.equal(officialCanAccept(p,q),true);
 assert.equal(conditionMet(p,{type:9,missionId:1136,not:1},q.id),false);
 assert.equal(conditionMet(p,{type:10,missionId:1127},q.id),false);p.quests.active[1127]={counts:{}};assert.equal(conditionMet(p,{type:10,missionId:1127},q.id),true);
 const active={counts:{},acceptedAt:'2026-09-20T00:00:00Z'};p.quests.active[q.id]=active;p.quests.completed=[];ensureDaily(p);assert.equal(p.quests.active[q.id],active);assert.deepEqual(normalizeRole(structuredClone(p)).quests.active[q.id],active);
 const otherQuest={...officialMissions.get(1679),id:9999}; // The explicit 1679 bridge must not waive other gaps.
 assert.equal(missingPrerequisites(p,otherQuest)[0].pending,true);
 assert.equal(missingPrerequisites(p,otherQuest)[0].name,'西域一点红');
});

test('full recorded beauty-festival chain credits completion once and grants the separate activity reward',()=>{
 const h=harness(),p=h.p,t=dailyData.tasks.find(t=>t.id===5);p.bagLimit=90;
 for(const id of t.linkage.missionIds){
  const q=officialMissions.get(id),origin=origins(q).find(o=>officialMaps.has(o.mapId));position(p,origin.mapId,origin.npcId);
  const accepted=h.call(14502,new Writer().short(origin.npcId).short(id));assert.equal(accepted.byte(),0,`${id}: ${accepted.b.toString('hex')}`);
  // Supply exactly the recorded objectives, then exercise the actual submit
  // handler, reward planning, prerequisites and NPC phases for all 12 steps.
  for(const c of missionConditions(q,'submitCondition'))if(c.type===2)p.quests.active[id].counts[c.monsterId]=c.required;
  const items=missionConditions(q,'submitCondition').filter(c=>c.type===7&&!c.not).map(c=>({id:c.itemId,quantity:c.required}));p.inventory=planItemRewards(p,items).inventory;
  const target=cityTarget(q,p);position(p,target.mapId,target.npcId);
  const r=h.call(14503,new Writer().short(target.npcId).short(id).int(0));assert.equal(r.byte(),0,`${id}: ${r.b.toString('hex')}`);
 }
 const info=decodeDaily('s2c_TaskInfo',h.call(22105,new Writer(),22106).b);assert.equal(info.info.length,58);assert.equal(info.activeInfo.activeValue,100);assert.equal(info.info.find(t=>t.id===5).status,2);
 const before=p.coins,claim=()=>decodeDaily('s2c_TaskActiveReward',h.call(22107,encodeDaily('c2s_TaskActiveReward',{id:1}),22108).b);
 assert.equal(claim().rs,0);assert.equal(p.coins,before+50000);assert.equal(claim().rs,-1);assert.equal(p.coins,before+50000);
 assert.equal(dailySnapshot(p).vitality.rewards[0].status,0,'new activity points do not leak into legacy vitality');
 const push=new NativeReader(h.sent.findLast(x=>x.type===12100).b);assert.equal(push.getByte(),0);assert.deepEqual(readAddedItems(push,d,()=>{}),[]);assert.deepEqual([push.getInt(),push.getInt(),push.getInt(),push.getInt()],[0,0,50000,0]);assert.deepEqual([push.getInt(),push.getInt(),push.getInt()],[p.gold,p.silver,p.coins]);assert.deepEqual([push.getInt(),push.getInt(),push.getInt()],[p.exp,p.expMax,p.level]);assert.equal(push.getBoolean(),true);push.finish();
});

test('battle wins, real equipment actions, boxes and selling update capped vitality only after successful saves',()=>{
 const h=harness(),p=h.p;p.mapId=10;const n=maps[10].npcs.find(n=>n.type===1);p.x=n.x;p.y=n.y;p.hp=hpMax(p);p.mp=mpMax(p);
 for(let i=0;i<3;i++){p.battles.cooldowns[n.group]=0;assert.equal(h.call(12501,new Writer().short(n.group)).byte(),0);const packet=new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(n.group).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(h.context.battle.token).byte(2);h.call(12502,packet);assert.throws(()=>h.call(12502,packet),/已结算/);}
 assert.equal(p.dailyActivity.progress[24],3);assert.equal(dailySnapshot(p).vitality.value,70);
 p.inventory=[{itemId:2056,slot:30,quantity:1,bound:true},{itemId:40001,slot:31,quantity:4},{itemId:40021,slot:32,quantity:3},{itemId:40067,slot:33,quantity:1}];
 h.call(12041,new Writer().int(40001).bool(false));assert.equal(h.call(12001,new Writer().byte(5).byte(5).short(30).int(1).bool(false).byte(13)).byte(),5);assert.equal(p.dailyActivity.progress[25],1);
 h.call(11506,new Writer().short(30).int(2056).byte(1));assert.equal(h.call(11506,new Writer().short(30).int(2056).byte(2)).byte(),0);assert.equal(p.dailyActivity.progress[5],1);
 assert.equal(h.call(12001,new Writer().byte(4).byte(3).short(33).int(1).bool(false).byte(28)).byte(),4);assert.equal(p.dailyActivity.progress[21],1);
 assert.equal(h.call(12006,new Writer().short(902).int(40001).short(31).byte(1)).byte(),0);assert.equal(p.dailyActivity.progress[22],1);
 assert.equal(dailySnapshot(p).vitality.value,150);assert.equal(h.call(14554,new Writer().int(100)).byte(),0);assert.equal(p.dailyActivity.claimedVitality.length,1);
 const before=structuredClone(p),failed=harness(p,()=>{throw Error('disk full');});assert.equal(failed.call(12006,new Writer().short(902).int(40001).short(31).byte(1)).byte(),-1);assert.deepEqual(p,before);
 assert.equal(h.call(14554,new Writer().int(100)).byte(),-1);assert.deepEqual(p,before);
});

test('every recorded chest preview and claim parses natively; bag failure, replay and disk failure never mark a claim',()=>{
 const h=harness(),p=h.p;ensureDaily(p);
 // Internal fixture covers all recorded thresholds, including pending online
 // objectives. No protocol exposes a way to assign these counters.
 for(const c of dailyData.legacy.conditions)p.dailyActivity.progress[c.id]=c.count;
 for(const reward of dailyData.legacy.rewards){
  const before=JSON.stringify(p),preview=new NativeReader(h.call(14553,new Writer().int(reward.threshold)).b);assert.equal(preview.getByte(),0);assert.equal(preview.getByte(),1);assert.equal(preview.getByte(),reward.items.length);
  for(const expected of reward.items){const item=new d.Item();d.Item.fromBytesAtts2(item,preview);assert.equal(item.id,expected.id);assert.equal(preview.getByte(),expected.quantity);}preview.getShort();preview.getShort();preview.getShort();preview.finish();assert.equal(JSON.stringify(p),before);
  const r=new NativeReader(h.call(14554,new Writer().int(reward.threshold)).b);assert.equal(r.getByte(),0);assert.equal(r.getByte(),1);assert.equal(r.getByte(),1);const added=readAddedItems(r,d,()=>{});assert.deepEqual(added.map(i=>i.itemId),reward.items.map(i=>i.id));assert.deepEqual([r.getInt(),r.getInt(),r.getInt()],[p.gold,p.silver,p.coins]);r.finish();
  const claimed=structuredClone(p);assert.equal(h.call(14554,new Writer().int(reward.threshold)).byte(),-1);assert.deepEqual(p,claimed);
 }
 for(const fail of [false,true]){const p=role();ensureDaily(p);recordActivity(p,24,3);recordActivity(p,5);recordActivity(p,25);if(!fail){p.bagLimit=1;p.inventory=[{itemId:2056,slot:30,quantity:1}];}const before=structuredClone(p),h=harness(p,()=>{if(fail)throw Error('disk full');});const r=h.call(14554,new Writer().int(100));assert.equal(r.byte(),-1);assert.match(r.string(),fail?/disk full/:/背包空间不足/);assert.deepEqual(p,before);}
});

test('daily resets use Shanghai midnight, clear all mission history and objectives, and persist independent claims',()=>{
 const p=role(),before=Date.parse('2026-09-21T15:59:59Z'),after=before+1000;
 assert.equal(dailyKey(before),'2026-09-21');assert.equal(dailyKey(after),'2026-09-22');
 ensureDaily(p,before);recordMissionCompletion(p,officialMissions.get(1132),before);p.quests.completed.push(1132,42);p.quests.active[1127]={counts:{5:2}};p.dailyActivity.claimedVitality=[100];p.dailyActivity.claimedActive=[1];
 assert.equal(missionDone(p,1132,before),true);ensureDaily(p,after);assert.equal(missionDone(p,1132,after),false);assert.equal(missionDone(p,42,after),false);assert.deepEqual(p.quests.completed,[]);assert.deepEqual(p.quests.active,{});assert.deepEqual(p.dailyActivity.claimedVitality,[]);assert.deepEqual(p.dailyActivity.claimedActive,[]);assert.equal(dailySnapshot(p,after).vitality.value,20);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-daily-'));try{const store=new SaveStore(dir),account=store.account('daily'),saved=store.create(account,{name:'日常存档',sex:1,race:0,job:1});Object.assign(saved,p);ensureDaily(saved);recordMissionCompletion(saved,officialMissions.get(1132));saved.quests.completed.push(1132);saved.dailyActivity.claimedActive=[1];store.save();const loaded=new SaveStore(dir).data.characters[0];assert.deepEqual(loaded.dailyActivity,saved.dailyActivity);assert.deepEqual(loaded.quests,saved.quests);assert.equal(missionClosed(loaded,officialMissions.get(1132)),true);const bits=missionBits(loaded);assert.ok(bits[1132>>3]&(1<<(1132%8)));}finally{const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-daily-'));fs.rmSync(exact,{recursive:true});}
});

test('recommended duplicates do not double-credit, and item activity rewards roll back together with their claim markers',()=>{
 const p=role();ensureDaily(p);recordMissionCompletion(p,officialMissions.get(1706));assert.equal(dailySnapshot(p).tasks.activeInfo.activeValue,200);recordMissionCompletion(p,officialMissions.get(1706));assert.equal(dailySnapshot(p).tasks.activeInfo.activeValue,200);
 const before=structuredClone(p),h=harness(p,()=>{throw Error('disk full');});const reply=decodeDaily('s2c_TaskActiveReward',h.call(22107,encodeDaily('c2s_TaskActiveReward',{id:2}),22108).b);assert.equal(reply.rs,-1);assert.match(reply.rsDesc,/disk full/);assert.deepEqual(p,before);
 const ok=harness(p);assert.equal(decodeDaily('s2c_TaskActiveReward',ok.call(22107,encodeDaily('c2s_TaskActiveReward',{id:2}),22108).b).rs,0);assert.equal(p.inventory.find(i=>i.itemId===40006).quantity,1);
 const r=new NativeReader(ok.sent.findLast(s=>s.type===12100).b);assert.equal(r.getByte(),0);assert.equal(readAddedItems(r,d,()=>{})[0].itemId,40006);for(let i=0;i<10;i++)r.getInt();r.getBoolean();r.finish();
});

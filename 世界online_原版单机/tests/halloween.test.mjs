import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Writer,Reader} from '../lib/codec.mjs';
import {Reader as NativeReader,decoders} from '../tools/capture-decoders.mjs';
import {normalizeRole,maps,hpMax,mpMax} from '../lib/content.mjs';
import {officialMissions} from '../lib/official-data.mjs';
import {officialCanAccept,officialComplete,missionsAt,missionBlockers,missionRewards} from '../lib/official-rules.mjs';
import {officialMissionPacket} from '../lib/official-packets.mjs';
import {handleOfficial} from '../lib/official-service.mjs';
import {handleGame,BATTLE_TRAILER} from '../lib/game-service.mjs';
const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
const make=()=>{const p=normalizeRole({id:1001,level:97,mapId:263,x:2,y:19,race:0,job:1,sex:1});p.inventory=[];p.silver=0;p.quests={active:{},completed:[3038,3039,3040,3041]};const context={role:p},replies=[],env={store:{save(){}},send(type,w){replies.push({type,body:w.done()});},log(){}};return {p,context,call(type,w){const r=new Reader(w.done());assert.equal(handleOfficial(type,r,context,env)||handleGame(type,r,context,env),true);return new Reader(replies.findLast(row=>row.type===type).body);}};};

test('completed unlimited pumpkin entrance remains visible and can teleport to the recorded coordinates repeatedly',()=>{
 const {p,context,call}=make(),q=officialMissions.get(3038);assert.ok(q.setting&8);
 for(let n=0;n<2;n++){
  assert.equal(officialCanAccept(p,q),true);assert.equal(officialComplete(p,q),true);assert.ok(missionsAt(p,10).some(m=>m.id===3038));
  const r=new NativeReader(officialMissionPacket(q,p,10).done()),native=d.Mission.fromBytes(r);r.finish();assert.equal(native.submitJumpMapID,259);assert.equal(native.submitJumpMapGx,9);assert.equal(native.submitJumpMapGy,6);assert.equal(native.canAccept,1);
  const before=[p.exp,p.coins,p.silver];assert.equal(call(14503,new Writer().short(10).short(3038).int(0)).byte(),0);assert.deepEqual([p.exp,p.coins,p.silver],before);assert.deepEqual(context.questTeleport,{mapId:259,x:9,y:6});assert.equal(p.quests.completed.filter(id=>id===3038).length,1);
  assert.equal(call(10506,new Writer().short(259).byte(9).byte(6)).byte(),0);assert.deepEqual([p.mapId,p.x,p.y],[259,9,6]);assert.equal(context.questTeleport,null);
  call(10523,new Writer().int(263));p.x=2;p.y=19;
 }
 p.x=20;p.y=20;assert.equal(call(14503,new Writer().short(10).short(3038).int(0)).byte(),-1);
});

test('Halloween final boss starts with its recorded group while missing quest rewards are omitted',()=>{
 const {p,context,call}=make(),q=officialMissions.get(3042);p.mapId=259;const npc=maps[259].npcs.find(n=>n.id===8);p.x=npc.x;p.y=npc.y;p.hp=hpMax(p);p.mp=mpMax(p);
 assert.deepEqual(missionBlockers(q),[]);assert.ok(officialCanAccept(p,q));
 const r=new NativeReader(officialMissionPacket(q,p,8).done()),native=d.Mission.fromBytes(r);r.finish();assert.equal(native.acceptBattleID,10007);assert.equal(native.exp,q.exp);assert.equal(native.rewardItems?.length||0,missionRewards(q).rewardItems.length);assert.match(native.desc,/缺少详情的道具奖励已跳过/);
 assert.equal(call(14502,new Writer().short(8).short(3042)).byte(),0);assert.equal(context.storyBattle.group,10007);
 assert.equal(call(12501,new Writer().short(10007)).byte(),0);assert.ok(context.battle.monsters.includes(1985));
 const result=new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(10007).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(context.battle.token).byte(2);
 call(12502,result);assert.ok(officialComplete(p,q));const before=[p.exp,p.coins,p.silver];assert.equal(call(14503,new Writer().short(8).short(3042).int(0)).byte(),0);assert.equal(p.exp,0);assert.equal(p.expMax,0);assert.equal(p.coins,before[1]);assert.equal(p.silver,before[2]);assert.equal(p.inventory.some(i=>i.itemId===1381),false);assert.equal(p.inventory.find(i=>i.itemId===716)?.quantity,5);assert.ok(p.quests.completed.includes(3042));assert.equal(call(14503,new Writer().short(8).short(3042).int(0)).byte(),-1);
});

test('Xingtian requires the recorded prerequisite before starting its boss formation',()=>{
 const {p,context,call}=make();p.mapId=828;p.quests={active:{},completed:[]};p.x=12;p.y=7;p.hp=hpMax(p);p.mp=mpMax(p);
 const intro=officialMissions.get(1705);assert.equal(officialCanAccept(p,intro),false);const rejected=call(14503,new Writer().short(12).short(1705).int(0));assert.equal(rejected.byte(),-1);assert.match(rejected.string(),/需先完成.*刑天/);assert.equal(p.quests.completed.length,0);
 p.quests.completed.push(1701);assert.equal(officialCanAccept(p,intro),true);assert.equal(call(14503,new Writer().short(12).short(1705).int(0)).byte(),0);
 assert.equal(call(14502,new Writer().short(37).short(1706)).byte(),0);assert.equal(context.storyBattle.group,213);assert.equal(call(12501,new Writer().short(213)).byte(),0);assert.ok(context.battle.monsters.includes(200));assert.equal(context.battle.monsters.length,8);
});

test('Halloween boss can be accepted, fought and delivered again after completion with fresh objective counts',()=>{
 const {p,context,call}=make(),q=officialMissions.get(3042);p.mapId=259;p.quests.completed.push(3042);const npc=maps[259].npcs.find(n=>n.id===8);p.x=npc.x;p.y=npc.y;p.hp=hpMax(p);p.mp=mpMax(p);
 for(let cycle=0;cycle<2;cycle++){
  assert.equal(officialCanAccept(p,q),true);assert.ok(missionsAt(p,8).some(m=>m.id===3042));
  const r=new NativeReader(officialMissionPacket(q,p,8).done()),native=d.Mission.fromBytes(r);r.finish();assert.ok(native.setting&8);assert.equal(native.canAccept,1);
  assert.equal(call(14502,new Writer().short(8).short(3042)).byte(),0);assert.deepEqual(p.quests.active[3042].counts,{});assert.equal(officialComplete(p,q),false);
  assert.equal(call(14503,new Writer().short(8).short(3042).int(0)).byte(),-1);
  p.battles.cooldowns[10007]=0;assert.equal(call(12501,new Writer().short(10007)).byte(),0);
  call(12502,new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(10007).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(context.battle.token).byte(2));
  assert.equal(p.quests.active[3042].counts[1985],1);assert.equal(officialComplete(p,q),true);assert.equal(call(14503,new Writer().short(8).short(3042).int(0)).byte(),0);assert.equal(p.quests.completed.filter(id=>id===3042).length,1);assert.equal(p.quests.active[3042],undefined);
 }
});

test('country reward flags do not block the wolf quest and recorded kill counts are still required',()=>{
 const {p,call}=make(),q=officialMissions.get(2770);p.mapId=293;const from=maps[293].npcs.find(n=>n.id===10),to=maps[293].npcs.find(n=>n.id===11);p.x=from.x;p.y=from.y;
 const r=new NativeReader(officialMissionPacket(q,p,10).done()),native=d.Mission.fromBytes(r);r.finish();assert.equal(native.setting&512,0);assert.equal(native.exp,15000);assert.equal(native.acceptCondition?.length||0,0);
 assert.equal(call(14502,new Writer().short(10).short(2770)).byte(),0);assert.equal(officialComplete(p,q),false);p.quests.active[2770].counts={1729:20,1730:19};assert.equal(officialComplete(p,q),false);p.quests.active[2770].counts[1730]=20;assert.equal(officialComplete(p,q),true);p.x=to.x;p.y=to.y;assert.equal(call(14503,new Writer().short(11).short(2770).int(0)).byte(),0);
});

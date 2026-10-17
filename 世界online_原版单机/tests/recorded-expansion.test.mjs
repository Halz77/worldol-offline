import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Writer,Reader} from '../lib/codec.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
import {recordedExpansion} from '../lib/recorded-expansion.mjs';
import {yunruoTemple} from '../lib/yunruo-temple.mjs';
import {official,officialMissions,officialGroups,officialMaps} from '../lib/official-data.mjs';
import {officialMonsterGroups,officialMonsterModels,officialMissionPacket,mapBattleData} from '../lib/official-packets.mjs';
import {maps,reachable,walkable,hpMax,mpMax} from '../lib/content.mjs';
import {worldTravelMaps} from '../lib/world-travel.mjs';
import {missionBlockers,missionConditions,officialComplete,officialCanAccept,npcEnabled,missionsAt,missionNotes,missionFollowupId} from '../lib/official-rules.mjs';
import {planItemRewards} from '../lib/restoration.mjs';
import {dailySnapshot,dailyKey,dailyData,ensureDaily,isDailyMission} from '../lib/daily-activity.mjs';
import {handleOfficial} from '../lib/official-service.mjs';
import {handleGame,BATTLE_TRAILER} from '../lib/game-service.mjs';
import {missionData,npcPacket} from '../lib/game-packets.mjs';
import {SaveStore} from '../lib/store.mjs';
import {balancedMonsterPacket} from '../lib/monster-balance.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-captured-expansion-'));
  t.after(()=>{const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-captured-expansion-'));fs.rmSync(exact,{recursive:true,force:true});});
  const store=new SaveStore(dir),account=store.account('录制整合验收'),p=store.create(account,{name:'任务验收',sex:1,race:0,job:1,icon1:'2240667',icon2:'0',icon3:'0'});
  Object.assign(p,{mapId:411,level:1,x:43,y:37});p.quests={active:{},completed:[]};p.hp=hpMax(p);p.mp=mpMax(p);store.save();
  const context={role:p,account},sent=[],env={store,send(type,w){sent.push({type,bytes:w instanceof Writer?w.done():Buffer.from(w)});},log(){},draw:()=>0.99};
  const call=(type,w=new Writer())=>{assert.ok(handleOfficial(type,new Reader(w.done()),context,env)||handleGame(type,new Reader(w.done()),context,env));return new Reader(sent.findLast(r=>r.type===type).bytes);};
  return {dir,store,p,context,call,env,reload:()=>new SaveStore(dir).data.characters.find(r=>r.id===p.id)};
}
function position(p,mapId,npcId){const map=maps[mapId],n=map.npcs.find(n=>n.id===npcId);assert.ok(n);p.mapId=mapId;
  // Native NPCs can stand on a blocked cell; walking to an adjacent valid cell is sufficient.
  for(let y=n.y-3;y<=n.y+3;y++)for(let x=n.x-3;x<=n.x+3;x++)if(Math.hypot(x-n.x,y-n.y)<=3&&walkable(mapId,x,y)&&reachable(mapId,...map.spawn,x,y)){p.x=x;p.y=y;return n;}
  assert.fail('No reachable approach '+mapId+':'+npcId);
}
function finish(h,result=2){const {p,context,call}=h;return call(12502,new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(context.battle.group).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(context.battle.token).byte(result));}

test('all recorded scene packets preserve native monster statistics, formations, skills and AI',()=>{
  let monsters=0,groups=0;
  for(const map of recordedExpansion.maps){
    const expected=mapBattleData(map.id),r=new NativeReader(officialMonsterModels(officialMonsterGroups(new Writer(),{mapId:map.id}),{mapId:map.id}).done());
    const actual=d.monsters(r);r.finish();
    for(const [table,key] of [['groups','groupId'],['monsters','id'],['skills','id'],['ai','id']]){
      assert.equal(actual[table].length,expected[table].length,map.name+' '+table);
      for(const row of expected[table]){
        const value=actual[table].find(x=>x[key]===row[key]&&(table!=='skills'||x.level===row.level));assert.ok(value);
        assert.equal(value.wireBase64,table==='skills'?(row.monsterWireBase64||row.wireBase64):table==='monsters'?balancedMonsterPacket(row).toString('base64'):row.wireBase64,map.name+' '+table+' '+row[key]);
      }
    }
    monsters+=actual.monsters.length;groups+=actual.groups.length;
  }
  assert.ok(monsters>=133);assert.ok(groups>=77);
  const temple=mapBattleData(411);assert.deepEqual([temple.monsters.length,temple.ai.length,temple.skills.length,temple.groups.length],[9,9,17,9]);
  assert.equal(temple.monsters.find(m=>m.id===2557).hpMax,25000000);assert.equal(temple.monsters.find(m=>m.id===2557).tough,80000);
  assert.ok(temple.monsters.every(m=>m.level===125));
});

test('all imported scenes are in free travel and every interactive NPC has a reachable cell',t=>{
  const h=fixture(t),travel=new Set(worldTravelMaps(0).map(m=>m.id));
  const backgroundActors=new Set(['954:14','954:21','985:7','985:9','985:8','985:50']);
  for(const m of recordedExpansion.maps){assert.ok(travel.has(m.id));for(const n of m.npcs){
    if(backgroundActors.has(m.id+':'+n.id)){
      // These recorded actors stand outside the paths. None offers a quest,
      // nonzero encounter or portal; moving them would alter the original art.
      assert.equal(n.name,'');assert.equal(n.missionGroupID,0);assert.ok(!n.battleID?.some(Boolean));assert.ok(!n.jumpMapID?.some(Boolean));
      assert.ok(!official.missions.some(q=>q.mapId===m.id&&q.npcId===n.id));
    }else if(n.npcType!==4)position(h.p,m.id,n.id);
  }}
  // Type 4 records are background decorations, including the balloons outside
  // the walkable festival paths. Preserve their positions without moving art.
  const balloon=maps[457].npcs.find(n=>n.id===32);assert.equal(balloon.npcType??balloon.type,4);assert.deepEqual([balloon.x,balloon.y],[19,29]);
  assert.equal(h.call(10523,new Writer().int(411)).byte(),0);assert.deepEqual([h.p.mapId,h.p.x,h.p.y],[411,43,37]);
  // MOD(maya-continuation)：原先断言 962 传不过去（地图没采集）。地下宫殿补齐后
  // 它已经是正式场景，传送应当放行 —— 这里改成验证能进去且落点合法。
  const before=structuredClone(h.p);assert.equal(h.call(10523,new Writer().int(962)).byte(),0);
  assert.equal(h.p.mapId,962);assert.ok(walkable(962,h.p.x,h.p.y));
  Object.assign(h.p,before);
});

test('every new recorded mission has a native packet and queries from its recorded NPC',t=>{
  const h=fixture(t);
  for(const source of recordedExpansion.missions){
    const q=officialMissions.get(source.id);assert.ok(q);
    const origin=q.sources.find(s=>maps[s.mapId]?.npcs.some(n=>n.id===s.npcId));if(!origin)continue;
    h.p.mapId=origin.mapId;
    const r=new NativeReader(officialMissionPacket(q,h.p,origin.npcId).done()),decoded=d.Mission.fromBytes(r);r.finish();
    assert.equal(decoded.id,q.id);assert.equal(decoded.name,q.name);
    assert.ok(missionsAt(h.p,origin.npcId).some(row=>row.id===q.id),q.id+' must appear at restored NPC');
  }
});

test('Yunruo all 22 quests, 9 battle groups, reload, daily progress and deferred final reward',t=>{
  const h=fixture(t),{p,call,context}=h,groups=new Set();let battles=0;
  assert.deepEqual(officialMaps.get(411).spawn,[43,37]);assert.equal(officialCanAccept(p,officialMissions.get(3900)),true);
  assert.equal(missionConditions(officialMissions.get(3900),'submitCondition').some(c=>c.type===7),false);
  assert.equal(npcEnabled(p,maps[411].npcs.find(n=>n.id===11)),false);
  const premature=officialMissions.get(3912);assert.equal(officialCanAccept(p,premature),false);
  for(const [index,id] of yunruoTemple.chain.entries()){
    const q=officialMissions.get(id);assert.deepEqual(missionBlockers(q),[]);
    const origin=q.sources.find(s=>s.mapId===411&&s.npcId===q.acceptNpcId);
    position(p,411,origin.npcId);assert.equal(npcEnabled(p,maps[411].npcs.find(n=>n.id===origin.npcId)),true,id+' origin visible');
    assert.equal(call(14502,new Writer().short(origin.npcId).short(id)).byte(),0,'accept '+id);
    const kill=missionConditions(q,'submitCondition').find(c=>c.type===2);
    if(kill){
      position(p,411,q.npcId);assert.equal(call(14503,new Writer().short(q.npcId).short(id).int(0)).byte(),-1);
      while(!officialComplete(p,q)){
        const n=maps[411].npcs.find(n=>n.type===1&&npcEnabled(p,n)&&officialGroups.get(n.group)?.monsters.includes(kill.monsterId));assert.ok(n,id+' battle target');
        position(p,411,n.id);p.battles.cooldowns[n.group]=0;assert.equal(call(12501,new Writer().short(n.group)).byte(),0);groups.add(n.group);
        if(!battles){finish(h,4);assert.equal(p.quests.active[id].counts[kill.monsterId]||0,0);p.battles.cooldowns[n.group]=0;call(12501,new Writer().short(n.group));}
        const expected=officialGroups.get(n.group).monsters.filter(m=>m===kill.monsterId).length,before=p.quests.active[id].counts[kill.monsterId]||0;
        finish(h);battles++;assert.equal(p.quests.active[id].counts[kill.monsterId],Math.min(kill.required,before+expected));
        const reloaded=h.reload();assert.deepEqual(reloaded.quests.active[id],p.quests.active[id]);
      }
    }
    position(p,411,q.npcId);assert.equal(officialComplete(p,q),true,'complete '+id);
    const before=p.coins;assert.equal(call(14503,new Writer().short(q.npcId).short(id).int(0)).byte(),0,'submit '+id);assert.equal(p.coins,before+q.money3);
    const state=dailySnapshot(p);for(const taskId of [32,49])assert.equal(state.tasks.info.find(t=>t.id===taskId).progress,index+1);
    const snapshot=structuredClone(p);assert.equal(call(14503,new Writer().short(q.npcId).short(id).int(0)).byte(),-1);assert.deepEqual(p,snapshot);
    assert.ok(!context.battle);
  }
  assert.equal(groups.size,9);assert.ok(battles>=9);
  assert.deepEqual(p.quests.completed,yunruoTemple.chain);
  const state=dailySnapshot(p);assert.equal(state.tasks.activeInfo.activeValue,200);
  for(const taskId of [32,49]){const row=state.tasks.info.find(t=>t.id===taskId);assert.equal(row.status,2);assert.equal(row.finishTImes,1);assert.equal(row.name,'云若寺');}
  assert.equal(p.pendingMissionRewards.length,1);assert.deepEqual(p.pendingMissionRewards[0],{missionId:3922,itemId:100669,name:'长老的谢礼',quantity:1,bagIcon:7,grade:2,reason:'missing-item-definition'});
  assert.deepEqual(h.reload().pendingMissionRewards,p.pendingMissionRewards);assert.deepEqual(h.reload().quests.completed,p.quests.completed);
  assert.ok(missionNotes(officialMissions.get(3922)).some(note=>note.includes('待补发')));
  const tomorrow=Date.now()+86400000;ensureDaily(p,tomorrow);assert.equal(p.dailyActivity.day,dailyKey(tomorrow));assert.equal(p.dailyActivity.completed[3922],undefined);assert.equal(p.pendingMissionRewards[0].quantity,1);
});

test('failed save cannot consume Yunruo final reward or mark its daily activity complete',t=>{
  const h=fixture(t),{p,call}=h;p.quests.completed=yunruoTemple.chain.slice(0,-1);p.dailyActivity=undefined;
  position(p,411,9);call(14502,new Writer().short(9).short(3922));const before=structuredClone(p),disk=fs.readFileSync(path.join(h.dir,'world.json'),'utf8');
  h.store.save=()=>{throw Error('disk full');};const r=call(14503,new Writer().short(9).short(3922).int(0));assert.equal(r.byte(),-1);assert.match(r.string(),/disk full/);
  assert.deepEqual(p,before);assert.equal(fs.readFileSync(path.join(h.dir,'world.json'),'utf8'),disk);
});

test('verified native resources cover every new map, model and skill animation without substitutions',()=>{
  const audit=JSON.parse(fs.readFileSync(path.join(root,'analysis/recorded-expansion-import.json')));
  assert.equal(audit.assets.added,0);assert.ok(audit.assets.verified>2600);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'client/v/gd/305.json'))).url;
  for(const gap of [...audit.pendingStaticImages,...audit.pendingStaticAnimations]){
    let entry=manifest;for(const key of gap.logical.split('/'))entry=entry?.[key];assert.equal(entry,undefined,gap.logical);
    assert.match(gap.reason,/absent-from-official/);
  }
  for(const file of audit.assets.files)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file.path))).digest('hex'),file.sha256,file.logical);
  for(const map of recordedExpansion.maps){const geo=JSON.parse(fs.readFileSync(path.join(root,'data/maps',map.id+'.json')));assert.equal(geo.blocks.length,(geo.mW/geo.tW)*(geo.mH/geo.tH));}
  assert.ok(dailyData.tasks.filter(t=>t.mapId===411).every(t=>!t.pending&&t.linkage.missionIds.length===22));
});

const routes=[
  {name:'菜花村全部主线与高难晴菜',ids:[1802,1803,1804,1805,1821,1806,1807,1808,1809,1810,1811,1812,1813,1814,1815,1816,1817,1818,1819,1820,1822]},
  {name:'玛雅到金字塔的已录连续任务',ids:[3200,3201,3202,3203,3204,3205,3206,3207,3208,3209,3210,3233,3234,3211,3212,3213,3214,3215,3216,3217,3218]},
  {name:'精灵之森后续当前场景',ids:[2608,2609,2610,2611,2612,2613,2614,2615,2616,2617,2618,2615,2619,2620],parent:2615},
  {name:'烈焰城到烈焰荒原',ids:[3465,3466,3467,3468,3469,3470,3471,3473,3474,3475,3476,3477,3478,3479,3480,3481]},
  {name:'小城市普通与高难双分支',ids:[1346,1347,1348,1349,1350,1351,1352,1353,1354,1355,1356,1357,1358,1359,1360,1361,1362,1363,1364,1365,1366]},
  {name:'MJ颤栗完整后续与高难彩蛋',ids:[2820,2821,2822,2823,2824,2825,2826,2827,2828,2829,2831]},
  {name:'奥哈拉与彩蛋森林完整事件',ids:[1450,1451,1452,1453,1454,1455,1456,1457,1458,1459,1460,1461,1462,1463,1464,1465,1478,1466,1467,1468,1469,1470,1471,1472,1473,1474,1475,1476,1477]},
  // MOD(maya-continuation)：1824「蒂卡尔的自白」的前置不再是缺失的 1823，
  // 而是地下宫殿十环（8700—8709，见 lib/maya-palace-story.mjs）。fixture 不进副本，
  // 所以按「前置已完成」处理，把 8709 也种进 completed。
  {name:'已完成前章后的祭祀宫殿与先祖遗迹',seed:[1823,3219,8709],ids:[...Array.from({length:36},(_,i)=>1824+i),1861,1862,1863]},
  {name:'机械城走廊之环与之心任务衔接',seed:[2051],ids:Array.from({length:38},(_,i)=>3420+i)}
];
for(const route of routes)test(route.name+' progresses through native accept, battle and submit handlers',t=>{
 const h=fixture(t),{p,call}=h;
 // The source for this later chapter's earlier map is still pending. This
 // fixture validates its recorded continuation without bypassing it in-game.
 if(route.seed)p.quests.completed.push(...route.seed);
 // MOD(maya-continuation)：地下宫殿十环（8700—8709）插在 1823 与 1824 之间。
 // 这一段（1824 往后的祭祀宫殿）全是日常任务：完成状态记在 dailyActivity.completed，
 // 不在 quests.completed（见 lib/daily-activity.mjs 的 missionDone），
 // 所以前置要种进日常表，否则蒂卡尔不出现、整条链都接不上。
 // 必须用 ensureDaily —— recordMissionCompletion 会读 dailyActivity.credited，
 // 手搓一个只有 completed 的对象会在提交时被 daily-activity 抛错。
 if(route.name.includes('祭祀宫殿')){
  const daily=ensureDaily(p);daily.completed??={};
  for(const id of [3219,...Array.from({length:10},(_,i)=>8700+i)])daily.completed[id]=1;
 }
  for(const id of route.ids){
    const q=officialMissions.get(id);assert.ok(q,'recorded '+id);assert.deepEqual(missionBlockers(q),[],id+' blockers');
    const origin=p.quests.active[id]?{mapId:q.mapId,npcId:q.npcId}:q.sources.find(s=>maps[s.mapId]?.npcs.some(n=>n.id===s.npcId&&npcEnabled(p,n)));assert.ok(origin,id+' visible quest origin');
    position(p,origin.mapId,origin.npcId);
    if(!p.quests.active[id]){
      const accept=call(14502,new Writer().short(origin.npcId).short(id));assert.equal(accept.byte(),0,id+' accept '+accept.b.toString('hex'));
      // The rescue parent stays active while its three child quests are done.
      if(id===route.parent){assert.equal(officialComplete(p,q),false);continue;}
    }
    const submit=missionConditions(q,'submitCondition');
    if(id===1471){const nav=call(10518,new Writer().byte(2).short(id));assert.equal(nav.byte(),0);assert.equal(nav.byte(),0);assert.deepEqual([nav.byte(),nav.byte()],[28,7],'navigate to the power NPC battle menu');}
    const items=submit.filter(c=>c.type===7&&!c.not).map(c=>({id:c.itemId,quantity:c.required}));p.inventory=planItemRewards(p,items).inventory;
    let attempts=0;
    while(!officialComplete(p,q)){
      assert.ok(++attempts<100,id+' bounded fight count');
      const outstanding=submit.find(c=>c.type===2&&(p.quests.active[id].counts[c.monsterId]||0)<c.required);assert.ok(outstanding,id+' supported goal');
      let group;
      if(q.acceptBattleID&&officialGroups.get(q.acceptBattleID)?.monsters.includes(outstanding.monsterId)){position(p,origin.mapId,origin.npcId);group=q.acceptBattleID;}
      else{
        const scene=Object.values(maps).find(m=>m.npcs.some(n=>npcEnabled(p,n)&&n.battleID?.some(g=>officialGroups.get(g)?.monsters.includes(outstanding.monsterId))));assert.ok(scene,id+' recorded battle scene');
        const n=scene.npcs.find(n=>npcEnabled(p,n)&&n.battleID?.some(g=>officialGroups.get(g)?.monsters.includes(outstanding.monsterId)));position(p,scene.id,n.id);group=n.battleID.find(g=>officialGroups.get(g)?.monsters.includes(outstanding.monsterId));
      }
      p.battles.cooldowns[group]=0;assert.equal(call(12501,new Writer().short(group)).byte(),0);finish(h);
    }
    position(p,q.mapId,q.npcId);assert.equal(npcEnabled(p,maps[q.mapId].npcs.find(n=>n.id===q.npcId)),true,id+' submit NPC visible');
    const choice=(q.selectItems||[]).find(i=>official.items.some(known=>known.id===i.id));const reward=call(14503,new Writer().short(q.npcId).short(id).int(choice?.id||0));assert.equal(reward.byte(),0,id+' submit '+reward.b.toString('hex'));
    if(id===1358)assert.equal(missionFollowupId(q),1359);
  }
  // 落盘只校验非日常、非可重复的普通任务。
  // 日常（setting&2）完成状态在 dailyActivity，可重复（setting&1）交付后会被清掉，
  // 两者都不落在 quests.completed 里 —— 这条用例只验「接取→战斗→交付」全程走得通。
  const disk=h.reload();
  for(const id of route.ids){
   const q=officialMissions.get(id);
   if(q.setting&3)continue;
   assert.ok(disk.quests.completed.includes(id),id+' saved');
  }
});

test('MJ girl visibility uses the same native quest conditions before and after reload',t=>{
  const h=fixture(t),n=maps[952].npcs.find(n=>n.id===60);
  const r=new NativeReader(npcPacket(new Writer(),h.p,[n]).done());for(let i=0;i<3;i++)assert.equal(r.getByte(),0);assert.equal(r.getByte(),1);
  const client=d.Npc.fromBytes(r);r.finish();assert.deepEqual(plain(client.missionData),[2821,7,2822,1]);
  assert.equal(npcEnabled(h.p,n),false);
  h.p.quests.active[2821]={counts:{}};assert.equal(npcEnabled(h.p,n),true);
  h.store.save();assert.equal(npcEnabled(h.reload(),n),true);
  delete h.p.quests.active[2821];h.p.quests.completed.push(2821);assert.equal(npcEnabled(h.p,n),true);
  h.p.quests.completed.push(2822);assert.equal(npcEnabled(h.p,n),false);
  assert.deepEqual(recordedExpansion.maps.find(m=>m.id===952).npcs.find(n=>n.id===60).missionData,[0,0,2822,1],'original capture retained');
});

test('unrecorded destination maps and missing kill definitions stay explicitly pending',()=>{
 // MOD(maya-continuation)：3219 原来的下一环 3220 不存在，整条玛雅链断在这里
 // （missionBlockers 会报「地图尚未采集」）。地下宫殿补齐后 3219 → 8700 已经通了，
 // 这条断言改成检查补齐之后的状态：不再有地图阻塞，但两条链各自仍然留在自己的环节上。
 assert.ok(!missionBlockers(officialMissions.get(3219)).some(s=>s.includes('地图尚未采集')),
  '3219 接的地下宫殿(962)应该已经通向8700');
 assert.deepEqual(officialMissions.get(3219).submitNextMissionID,8700);
 assert.deepEqual(missionBlockers(officialMissions.get(2621)),[],'new recording restores the forest continuation');
 assert.ok(!missionBlockers(officialMissions.get(3422)).some(s=>s.includes('地图尚未采集')),'new recording restores mechanical ring');
 assert.ok(missionBlockers(officialMissions.get(2803)).includes('任务目标怪物资料尚未采集'));
});

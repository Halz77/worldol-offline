import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SaveStore} from '../lib/store.mjs';
import {Writer,Reader} from '../lib/codec.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
import {officialMaps,officialMissions,officialItems} from '../lib/official-data.mjs';
import {missionsAt,officialCanAccept,officialComplete,missionBlockers,missionRewards,missionConditions,missionNotes} from '../lib/official-rules.mjs';
import {mapBattleData,officialMonsterGroups,officialMonsterModels} from '../lib/official-packets.mjs';
import {missionData} from '../lib/game-packets.mjs';
import {hpMax,mpMax} from '../lib/content.mjs';
import {handleOfficial} from '../lib/official-service.mjs';
import {handleGame,BATTLE_TRAILER} from '../lib/game-service.mjs';
import {
 GUARD_CHALLENGES,GUARD_GROUPS,GUARD_MONSTERS,GUARD_SKILLS,GUARD_AI,GUARD_MAP,GUARD_NPCS,
 GUARD_MIN_LEVEL,GUARD_EXP,GUARD_COINS,GUARD_REWARD,
} from '../lib/guard-challenges-data.mjs';

/**
 * 守卫挑战（33 条，8901—8933，第 84 版，移植自 4.0AI 版的 `boss-challenges-v1.json`）。
 *
 * 征战广场（945）的两个守卫 NPC（2 / 3）各挂一套「接取即开战」的单体 BOSS 挑战。
 * 这里断言四件事：任务形状与门槛、编队/怪物/技能确实随 945 一起下发、奖励箱没定义也不挡交付、
 * 以及端到端（接取 → 12501 → 12502 → 交付 → 可重复）。
 */

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
const GUARD_IDS=GUARD_CHALLENGES.map(c=>c.id);

function fixture(t,level=97){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-guard-challenges-'));
 t.after(()=>{const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-guard-challenges-'));fs.rmSync(exact,{recursive:true,force:true});});
 const store=new SaveStore(dir),account=store.account('守卫挑战验收'),p=store.create(account,{name:'守卫验收',sex:1,race:0,job:1,icon1:'2240667',icon2:'0',icon3:'0'});
 Object.assign(p,{level,mapId:GUARD_MAP,x:20,y:11});p.hp=hpMax(p);p.mp=mpMax(p);p.quests={active:{},completed:[]};store.save();
 const context={role:p,account},sent=[],env={store,send(type,w){sent.push({type,bytes:w instanceof Writer?w.done():Buffer.from(w)});},log(){}};
 const call=(type,w)=>{const r=new Reader(w.done());assert.ok(handleOfficial(type,r,context,env)||handleGame(type,r,context,env));return new Reader(sent.findLast(x=>x.type===type).bytes);};
 return {store,p,context,call,dir,reload:()=>new SaveStore(dir).data.characters.find(r=>r.id===p.id)};
}
function finish(h,result=2){
 const p=h.p,b=h.context.battle;
 return h.call(12502,new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(b.group).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(b.token).byte(result));
}

test('守卫挑战：33 条任务形状一致（同图同守卫、可重复、接取即开战）',()=>{
 assert.equal(GUARD_CHALLENGES.length,33);
 assert.deepEqual(GUARD_IDS,[...Array(33)].map((_,i)=>i+8901));
 assert.deepEqual(GUARD_NPCS,[2,3]);
 const byNpc={2:0,3:0};
 for(const entry of GUARD_CHALLENGES){
  const q=officialMissions.get(entry.id);
  assert.ok(q,`任务 ${entry.id} 已注册`);
  assert.equal(q.mapId,GUARD_MAP);
  assert.equal(q.npcId,entry.npcId);
  byNpc[entry.npcId]++;
  assert.equal(q.setting,1034);
  assert.equal(q.setting&8,8,'setting&8 = 可重复挑战');
  assert.equal(q.acceptBattleID,entry.group);
  assert.equal(q.submitBattleID,0,'打完就地交付，不续战');
  assert.equal(q.submitNextMissionID,0);
  assert.equal(q.exp,GUARD_EXP);
  assert.equal(q.money2,0);
  assert.equal(q.money3,GUARD_COINS);
  assert.equal(q.type,0);
  assert.equal(q.series,'');
  assert.equal(q.canAccept,1);
  assert.equal(q._isHelp,false,'_isHelp:true 会被客户端加一个「求助」按钮');
  assert.equal(q.level,0);
  assert.equal(q.acceptCondition.length,3);
  assert.equal(q.acceptCondition[0].type,1);
  assert.equal(q.acceptCondition[0].minimum,GUARD_MIN_LEVEL);
  assert.equal(q.acceptCondition[0].rawHex,Buffer.from([GUARD_MIN_LEVEL]).toString('hex'));
  assert.equal(q.submitCondition[0].type,2,'击杀条件');
  assert.equal(q.submitCondition[0].monsterId,entry.boss);
  assert.equal(q.submitCondition[0].required,1);
  assert.equal(missionBlockers(q).length,0,`任务 ${entry.id} 没有资料缺项`);
  assert.deepEqual(q.sources[0].mapId,GUARD_MAP);
  assert.equal(q.sources[0].npcId,entry.npcId);
  assert.ok(['local-guard-challenge','port-from-com.worldol.h5'].includes(q.sources[0].origin),q.sources[0].origin);
 }
 assert.deepEqual(byNpc,{2:17,3:16},'两个守卫各管一半');
 // 每条挑战的击杀目标都在怪物表里，编队也在。
 for(const entry of GUARD_CHALLENGES){
  assert.ok(officialMissions.get(entry.id).submitCondition[0].name.length>0,`任务 ${entry.id} 的击杀条件带名字`);
  assert.ok(mapBattleData(GUARD_MAP).groups.some(g=>g.groupId===entry.group),`编队 ${entry.group} 随地图下发`);
 }
});

test('守卫挑战：90 级门槛保留在定义里但不设卡（与全库「接取不限制等级和职业」一致）',()=>{
 const q=officialMissions.get(8901);
 const high={level:97,mapId:GUARD_MAP,quests:{active:{},completed:[]},items:[],inventory:[]};
 const low={...high,level:50};
 // 4.0 与本工程对非城市任务都只按前置任务（type 9/10）判接取资格：
 // missionConditions 只保留 [9,10]，等级 / 种族 / 职业条件只写进定义、不进任务包。
 assert.deepEqual(missionConditions(q,'acceptCondition'),[]);
 assert.equal(officialCanAccept(high,q),true);
 assert.equal(officialCanAccept(low,q),true,'等级不设卡（定义里的 90 级仅作说明）');
 assert.equal(q.acceptCondition[0].type,1);
 assert.equal(q.acceptCondition[0].minimum,GUARD_MIN_LEVEL);
 assert.ok(missionNotes(q).some(n=>n.includes('接取不限制等级和职业')),missionNotes(q).join('；'));
});

test('守卫挑战：6 个新编队 + 9 只本地怪 + 不死不灭技能都在表里',()=>{
 const groups=mapBattleData(GUARD_MAP).groups.map(g=>g.groupId);
 for(const id of [12100,12101,12102,12103,20501,20502])assert.ok(groups.includes(id),`编队 ${id}`);
 assert.equal(GUARD_GROUPS.length,6);
 // 20502（东哥·高难）用的是征战广场已有的 3271/3272 克隆怪，槽位必须排满。
 const high=GUARD_GROUPS.find(g=>g.groupId===20502);
 assert.equal(high.monsters.filter(id=>id>0).length,9);
 assert.ok(high.monsters.includes(3271)&&high.monsters.includes(3272));
 const ids=GUARD_MONSTERS.map(m=>m.id);
 assert.deepEqual(ids,[4200,4201,4202,4203,4204,4205,4206,4207,4208]);
 const data=mapBattleData(GUARD_MAP);
 for(const id of ids)assert.ok(data.monsters.some(m=>m.id===id),`本地怪 ${id} 随 945 下发`);
 // 9999「不死不灭」是怪物侧技能：随 AI 一起发（玩家技能列表里没有）。
 assert.deepEqual(GUARD_SKILLS.map(s=>`${s.id}:${s.level}`),['9999:1']);
 assert.ok(data.skills.some(s=>s.id===9999&&s.level===1),'技能 9999 随 AI 下发');
 assert.equal(data.ai.some(a=>a.id===4204),true);
 const skillOf=id=>data.ai.find(a=>a.id===id)?.skill1.find(s=>s.id>0);
 assert.equal(skillOf(4204)?.id,9999);
 assert.equal(skillOf(4204)?.definitionFound,true,'AI 里的技能定义要能查到');
 assert.equal(GUARD_AI.length,1);
 // 整包能按客户端解码器解回来（不会 Truncated / Unconsumed）。
 const bytes=officialMonsterModels(officialMonsterGroups(new Writer(),{mapId:GUARD_MAP}),{mapId:GUARD_MAP}).done();
 const r=new NativeReader(bytes),actual=d.monsters(r);r.finish();
 assert.ok(actual.monsters.some(m=>m.id===4208));
 assert.ok(actual.skills.some(s=>s.id===9999));
});

test('守卫挑战：任务包原样解码（客户端读得到编队与击杀目标）',()=>{
 const p={level:97,mapId:GUARD_MAP,x:20,y:11,quests:{active:{},completed:[]},items:[],inventory:[]};
 const r=new NativeReader(missionData(p,2).done());
 assert.equal(r.getShort(),2);
 assert.equal(r.getByte(),GUARD_CHALLENGES.filter(c=>c.npcId===2).length);
 const bytes=r.getByteArray(),native=d.Mission.fromBytes(bytes);bytes.finish();
 assert.equal(native.id,8901);
 assert.equal(native.mapId,GUARD_MAP);
 assert.equal(native.npcId,2);
 assert.equal(native.acceptBattleID,11615);
 assert.equal(native.setting&8,8);
 assert.equal(native.exp,GUARD_EXP);
 assert.equal(native.money3,GUARD_COINS);
 assert.equal(native.canAccept,1);
 assert.equal(native._isHelp,false);
 // 等级条件只留在定义里（不进包）—— 见上面那条「不设卡」的说明。
 assert.equal(native.acceptCondition,undefined);
 const kills=native.submitCondition.filter(c=>c.type===2).map(c=>[c.monsterId,c.required]);
 assert.equal(JSON.stringify(kills),JSON.stringify([[1735,1]]),'击杀目标进了包');
 assert.equal(native.rewardItems,undefined,'没定义的箱子不进包，客户端不会显示未知道具');
 // missionsAt：两个守卫各看得到自己那一半。
 const at2=missionsAt(p,2).map(x=>x.id),at3=missionsAt(p,3).map(x=>x.id);
 assert.deepEqual(at2,GUARD_CHALLENGES.filter(c=>c.npcId===2).map(c=>c.id));
 assert.deepEqual(at3,GUARD_CHALLENGES.filter(c=>c.npcId===3).map(c=>c.id));
 // 守卫 NPC 本身可见可交互。
 assert.equal(officialMaps.get(GUARD_MAP).npcs.find(n=>n.id===2).status,3);
 assert.equal(officialMaps.get(GUARD_MAP).npcs.find(n=>n.id===3).status,3);
});

test('守卫挑战：奖励箱 9300931 没有定义，被静默滤掉但交付照常',()=>{
 assert.equal(officialItems.has(GUARD_REWARD.id),false,'紫色武器箱本工程没有定义');
 for(const id of GUARD_IDS){
  const q=officialMissions.get(id);
  assert.deepEqual(q.rewardItems.map(i=>i.id),[GUARD_REWARD.id],`任务 ${id} 的原始奖励表留着箱子`);
  const reward=missionRewards(q);
  assert.equal(reward.rewardItems.some(i=>i.id===GUARD_REWARD.id),false,`任务 ${id} 结算时滤掉箱子`);
  assert.equal(reward.exp,GUARD_EXP);
  assert.equal(reward.money3,GUARD_COINS);
 }
});

test('守卫挑战：端到端（接取 → 12501 → 12502 → 交付 → 可重复，箱子不发也不报错）',t=>{
 const h=fixture(t),{p,call}=h,entry=GUARD_CHALLENGES[0],q=officialMissions.get(entry.id);
 const npc=officialMaps.get(GUARD_MAP).npcs.find(n=>n.id===entry.npcId);p.x=npc.x;p.y=npc.y;
 // 接取即开战。
 assert.equal(call(14502,new Writer().short(entry.npcId).short(entry.id)).byte(),0);
 assert.equal(h.context.storyBattle.group,entry.group);
 // 没打赢不发奖，任务也不算完成。
 p.battles.cooldowns[entry.group]=0;
 assert.equal(call(12501,new Writer().short(entry.group)).byte(),0);
 assert.equal(h.context.battle.monsters.length,mapBattleData(GUARD_MAP).groups.find(g=>g.groupId===entry.group).monsters.filter(id=>id>0).length);
 finish(h,4);
 assert.equal(officialComplete(p,q),false);
 assert.equal(p.quests.active[entry.id].counts[entry.boss]||0,0);
 // 打赢 → 计数 1 → 交付（箱子无定义，不该抛错，也不该出现在背包里）。
 p.battles.cooldowns[entry.group]=0;assert.equal(call(12501,new Writer().short(entry.group)).byte(),0);finish(h);
 assert.equal(p.quests.active[entry.id].counts[entry.boss],1);
 assert.equal(officialComplete(p,q),true);
 const coins=p.coins,bag=p.inventory.length;
 assert.equal(call(14503,new Writer().short(entry.npcId).short(entry.id).int(0)).byte(),0);
 assert.equal(p.coins,coins+q.money3);
 assert.equal(p.inventory.length,bag,'箱子没有定义 → 不进背包');
 assert.ok(p.quests.completed.includes(entry.id));
 assert.equal(officialCanAccept(p,q),true,'可重复挑战');
 // 再打一次：完成记录不重复累加。
 assert.equal(call(14502,new Writer().short(entry.npcId).short(entry.id)).byte(),0);
 p.battles.cooldowns[entry.group]=0;assert.equal(call(12501,new Writer().short(entry.group)).byte(),0);finish(h);
 assert.equal(call(14503,new Writer().short(entry.npcId).short(entry.id).int(0)).byte(),0);
 assert.equal(h.reload().quests.completed.filter(id=>id===entry.id).length,1);
});

test('守卫挑战：不在征战广场 / 站错守卫处接不了',t=>{
 const h=fixture(t),{p,call}=h;
 p.x=1;p.y=1;
 assert.equal(call(14502,new Writer().short(2).short(8901)).byte(),-1);
 const npc=officialMaps.get(GUARD_MAP).npcs.find(n=>n.id===3);p.x=npc.x;p.y=npc.y;
 assert.equal(call(14502,new Writer().short(3).short(8901)).byte(),-1,'8901 挂在 2 号守卫上');
});

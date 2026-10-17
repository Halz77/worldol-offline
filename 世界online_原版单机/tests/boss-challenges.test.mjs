import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SaveStore} from '../lib/store.mjs';
import {Writer,Reader} from '../lib/codec.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
import {bossChallenges} from '../lib/boss-challenges.mjs';
import {official,officialMissions,officialItems} from '../lib/official-data.mjs';
import {mapBattleData,officialMonsterGroups,officialMonsterModels} from '../lib/official-packets.mjs';
import {applyOverrideToDefinition} from '../lib/local-skill-overrides.mjs';
import {missionsAt,missionBlockers,officialCanAccept,officialComplete,missionRewards} from '../lib/official-rules.mjs';
import {missionData,npcPacket} from '../lib/game-packets.mjs';
import {maps,reachable,hpMax,mpMax} from '../lib/content.mjs';
import {worldTravelMaps} from '../lib/world-travel.mjs';
import {handleOfficial} from '../lib/official-service.mjs';
import {handleGame,BATTLE_TRAILER} from '../lib/game-service.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
const cases=[{quest:1317,npc:1,group:11778,boss:3350,hp:20000000,mp:2000000},{quest:3459,npc:4,group:11740,boss:3275,hp:10000000,mp:1000000}];
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-boss-challenges-'));
 t.after(()=>{const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-boss-challenges-'));fs.rmSync(exact,{recursive:true,force:true});});
 const store=new SaveStore(dir),account=store.account('广场Boss验收'),p=store.create(account,{name:'挑战验收',sex:1,race:0,job:1,icon1:'2240667',icon2:'0',icon3:'0'});
 Object.assign(p,{level:1,mapId:945,x:20,y:11});p.hp=hpMax(p);p.mp=mpMax(p);p.quests={active:{},completed:[1677]};store.save();
 const context={role:p,account},sent=[],env={store,send(type,w){sent.push({type,bytes:w instanceof Writer?w.done():Buffer.from(w)});},log(){}};
 const call=(type,w)=>{const r=new Reader(w.done());assert.ok(handleOfficial(type,r,context,env)||handleGame(type,r,context,env));return new Reader(sent.findLast(x=>x.type===type).bytes);};
 return {store,p,context,call,dir,reload:()=>new SaveStore(dir).data.characters.find(r=>r.id===p.id)};
}
function finish(h,result=2){
 const p=h.p,b=h.context.battle;
 return h.call(12502,new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(b.group).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(b.token).byte(result));
}

test('plaza packets retain every captured monster stat, AI, skill and all eleven formation slots',()=>{
 const bytes=officialMonsterModels(officialMonsterGroups(new Writer(),{mapId:945}),{mapId:945}).done(),r=new NativeReader(bytes),actual=d.monsters(r);r.finish();
 // MOD(plaza-kukulkan)：征战广场现在是 3 个挑战（霸天虎 / 东哥 / 库库尔坎，见 data/boss-challenges-v1.json），
 // 库库尔坎的护卫把编队和怪物定义都撑大了，原先写死的「6 个怪物 / 2 个编队」不再成立。
 // 改成从本地挑战数据推导数量；下面逐条定义的原样解码校验保持不变。
 const references=()=>{const ids=new Set(bossChallenges.groups.flatMap(g=>g.monsters).filter(id=>id>0));return [...ids].filter(id=>official.monsters.some(m=>m.id===id));};
 assert.equal(actual.groups.length,bossChallenges.groups.length);
 assert.equal(actual.monsters.length,references().length);
 // 库库尔坎的护卫还引入了自己的技能与 AI 记录（原版 13 条技能 / 5 条 AI → 17 / 9），
 // 所以只要求「录到的技能与 AI 一条不少」；逐条比对仍然照旧。
 assert.ok(actual.skills.length>=bossChallenges.skills.length,`skills ${actual.skills.length}`);
 assert.ok(actual.ai.length>=bossChallenges.ai.length,`ai ${actual.ai.length}`);
 for(const [key,id] of [['monsters','id'],['skills','id'],['ai','id'],['groups','groupId']])for(const recorded of bossChallenges[key]){
  const decoded=actual[key].find(x=>x[id]===recorded[id]&&(key!=='skills'||x.level===recorded.level));
  assert.ok(decoded);const {sources,variants,...expected}=recorded;
  // MOD(captured81)：81 录制包会把同一批怪/技能/AI 的 sources **追加合并**
  // （mergeSources 按「录制+序号+地图+NPC」去重，见 lib/captured81.mjs）。
  // 业务字段（属性/技能效果/编队槽位）一个都不该变，变的只有来源条数 ——
  // 而 sources 是**嵌套**的（怪物里带技能表，技能各自也有 sources），
  // 所以要递归剥掉，不只是最外层。
  const stripSources=v=>Array.isArray(v)?v.map(stripSources)
   :(v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='sources').map(([k,x])=>[k,stripSources(x)])):v);
  assert.deepEqual(stripSources(JSON.parse(JSON.stringify(decoded))),stripSources(expected),`${key}:${recorded[id]}`);
 }
 for(const c of cases){const m=actual.monsters.find(m=>m.id===c.boss);assert.equal(m.hpMax,c.hp);assert.equal(m.mpMax,c.mp);assert.equal(actual.groups.find(g=>g.groupId===c.group).monsters.filter(id=>id>0).length,11);}
 assert.equal(actual.monsters.find(m=>m.id===3350).tough,200000);assert.equal(actual.monsters.find(m=>m.id===3350).def_field,200000);
 assert.equal(actual.monsters.find(m=>m.id===3275).tough,80000);
 assert.ok(actual.ai.every(a=>[...a.skill1,...a.skill2].every(s=>s.id<=0||s.definitionFound)));
 // Player skill definitions remain exactly as they were before this addition.
 const original=JSON.parse(fs.readFileSync(path.join(root,'data/official-v305.json'),'utf8'));
 // MOD(local-skill-overrides)：期望值也要过一遍「技能效果覆盖层」—— 本地主动改过效果的技能
// （data/local-skill-overrides.json）本来就与抓包不同，lib/official-data.mjs 建索引前
// 会对 official.skills 套用同一层覆盖，所以这里用同一函数算出期望。
// 这条比的是「本地技能覆盖层有没有把人物技能改坏」，与来源条数无关；
 // 而 81 录制包会给同一条技能追加 sources（mergeSources，见 lib/captured81.mjs），
 // 两侧都剥掉再比。
const stripSources=v=>Array.isArray(v)?v.map(stripSources)
 :(v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='sources').map(([k,x])=>[k,stripSources(x)])):v);
for(const old of original.skills){const now=official.skills.find(s=>s.id===old.id&&s.level===old.level);const covered=applyOverrideToDefinition(old.id,old);const {monsterWireBase64,...a}=now,{monsterWireBase64:oldMonster,...b}=covered;void oldMonster;assert.deepEqual(stripSources(JSON.parse(JSON.stringify(a))),stripSources(JSON.parse(JSON.stringify(b))));}
});

test('plaza travel and both visible NPC entrances round-trip with reachable independent positions',()=>{
 assert.ok(worldTravelMaps(0).some(m=>m.id===945));const map=maps[945];
 for(const c of cases){const n=map.npcs.find(n=>n.id===c.npc);assert.ok(reachable(945,...map.spawn,n.x,n.y));}
 const p={mapId:945,quests:{active:{},completed:[]}},r=new NativeReader(npcPacket(new Writer(),p).done());r.take(3);
 const npcs=[];for(let count=r.getByte();count>0;count--)npcs.push(d.Npc.fromBytes(r));r.finish();
 const dong=npcs.find(n=>n.id===4);assert.equal(dong.icon1.toJSON(),'20731');assert.equal(dong.status,3);assert.equal(dong.missionData,undefined);
 assert.equal(npcs.find(n=>n.id===1).icon1.toJSON(),'15760');assert.equal(dong.x,25);assert.equal(dong.y,12);
});

for(const c of cases){
 test(`${c.quest}: level-one native quest entry starts the correct battle and survives failure, reload, victory and repeat`,t=>{
  const h=fixture(t),{p,context,call}=h,q=officialMissions.get(c.quest),n=maps[945].npcs.find(n=>n.id===c.npc);p.x=n.x;p.y=n.y;
  assert.deepEqual(missionBlockers(q),[]);assert.equal(officialCanAccept(p,q),true);
  assert.deepEqual(missionsAt(p,c.npc).map(q=>q.id),[c.quest]);
  const rr=new NativeReader(missionData(p,c.npc).done());assert.equal(rr.getShort(),c.npc);assert.equal(rr.getByte(),1);
  const qr=rr.getByteArray(),native=d.Mission.fromBytes(qr);qr.finish();d.monsters(rr);rr.finish();
  assert.equal(native.acceptBattleID,c.group);assert.equal(native.setting&8,8);assert.equal(native.mapId,945);assert.equal(native.npcId,c.npc);assert.equal(native.acceptCondition?.length||0,0);
  assert.throws(()=>call(12501,new Writer().short(c.group)),/靠近当前任务/);
  assert.equal(call(14502,new Writer().short(c.npc).short(c.quest)).byte(),0);assert.equal(context.storyBattle.group,c.group);
  const before=p.coins;assert.equal(call(14503,new Writer().short(c.npc).short(c.quest).int(0)).byte(),-1);assert.equal(p.coins,before);
  assert.equal(call(12501,new Writer().short(c.group)).byte(),0);assert.equal(context.battle.monsters.length,11);finish(h,4);
  assert.equal(officialComplete(p,q),false);assert.deepEqual(p.quests.active[c.quest].counts,{});
  const loaded=h.reload();assert.deepEqual(loaded.quests.active[c.quest].origin,{mapId:945,npcId:c.npc});
  // A fresh connection must be able to retry using the persisted quest origin.
  context.storyBattle=null;
  for(let cycle=0;cycle<2;cycle++){
   if(cycle){assert.equal(call(14502,new Writer().short(c.npc).short(c.quest)).byte(),0);assert.deepEqual(p.quests.active[c.quest].counts,{});}
   p.battles.cooldowns[c.group]=0;assert.equal(call(12501,new Writer().short(c.group)).byte(),0);finish(h);
   assert.equal(p.quests.active[c.quest].counts[c.boss],1);assert.equal(officialComplete(p,q),true);
   const money=p.coins;assert.equal(call(14503,new Writer().short(c.npc).short(c.quest).int(0)).byte(),0);assert.equal(p.coins,money+q.money3);
   assert.equal(officialCanAccept(p,q),true);const after=p.coins;assert.equal(call(14503,new Writer().short(c.npc).short(c.quest).int(0)).byte(),-1);assert.equal(p.coins,after);
  }
  assert.equal(h.reload().quests.completed.filter(id=>id===c.quest).length,1);assert.ok(p.quests.completed.includes(1677));
  assert.equal(p.quests.completed.includes(3457),false);
 });
}

test('Dongge kills do not complete Batianhu, and unavailable chest definitions remain pending',t=>{
 const h=fixture(t),{p,call}=h;
 for(const c of cases){const n=maps[945].npcs.find(n=>n.id===c.npc);p.x=n.x;p.y=n.y;assert.equal(call(14502,new Writer().short(c.npc).short(c.quest)).byte(),0);}
 call(12501,new Writer().short(11740));finish(h);
 assert.equal(officialComplete(p,officialMissions.get(3459)),true);assert.equal(officialComplete(p,officialMissions.get(1317)),false);
 assert.equal(p.quests.active[1317].counts[3350],0);
 const dong=missionRewards(officialMissions.get(3459));assert.ok(dong.rewardItems.some(i=>i.id===6128));
 for(const id of [1530,1566]){assert.equal(officialItems.has(id),false);assert.ok(cases.every(c=>!missionRewards(officialMissions.get(c.quest)).rewardItems.some(i=>i.id===id)));}
 assert.ok(mapBattleData(945).monsters.some(m=>m.id===3269));assert.equal(mapBattleData(945).ai.some(a=>a.id===3269),false);
});

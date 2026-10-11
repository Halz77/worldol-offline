import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dropCatalog,rollBattleLoot,gearPool,ruleForBattle,planLootDelivery,applyLootDelivery} from '../lib/loot.mjs';
import {official,officialItems,officialMissions,officialGroups} from '../lib/official-data.mjs';
import {normalizeRole,maps,hpMax,mpMax} from '../lib/content.mjs';
import {Writer,Reader} from '../lib/codec.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
import {readBattleReward} from '../tools/capture-public-blocks.mjs';
import {handleGame,BATTLE_TRAILER} from '../lib/game-service.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {officialComplete} from '../lib/official-rules.mjs';
import {SaveStore} from '../lib/store.mjs';
import {readVerifiedCapturePrefix} from '../tools/capture-prefix.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),decoder=decoders(root);
// These are detached copies of the existing main character, never another login.
const main=JSON.parse(fs.readFileSync(new URL('../qa-v05-saves/world.json',import.meta.url),'utf8')).characters.find(p=>p.id===1001);
const owner=()=>{const p=normalizeRole(structuredClone(main));p.inventory=[];p.bagLimit=90;p.quests.active={};delete p.pendingLoot;p.mapId=254;[p.x,p.y]=maps[254].spawn;p.hp=hpMax(p);p.mp=mpMax(p);return p;};
const battleFor=g=>({official:true,mapId:g.mapId,group:g.groupId,monster:officialGroups.get(g.groupId).monsters.find(Boolean),monsters:officialGroups.get(g.groupId).monsters.filter(Boolean)});

test('every captured item has a mapped runtime source and every group uses defined items',()=>{
 assert.equal(dropCatalog.summary.savedCaptures,26);assert.equal(dropCatalog.summary.validSavedCaptures,23);assert.equal(dropCatalog.summary.snapshots,2);assert.equal(dropCatalog.summary.battleEvents,790);assert.equal(dropCatalog.summary.uniqueObservedItems,82);
 for(const row of dropCatalog.observed){const g=dropCatalog.groups.find(g=>g.key===row.key);assert.ok(g,row.key);const pool=new Set([...g.equipment,...g.materials,...g.extras,...g.taskDrops.map(d=>d.id)]);for(const i of row.items)assert.ok(pool.has(i.id),`${row.key}:${i.id}`);}
 for(const g of dropCatalog.groups)for(const id of [...g.equipment,...g.materials,...g.extras,...g.taskDrops.map(d=>d.id)])assert.ok(officialItems.has(id));
 assert.ok(dropCatalog.groups.some(g=>g.groupId===10007));assert.ok(dropCatalog.groups.some(g=>g.groupId===213));
});

test('loot level pools never invent gear and exclude mounts, fashion, pets, and dismantling crystals',()=>{
 for(let level=1;level<=120;level++)for(const tier of ['normal','elite','boss'])for(const id of gearPool(level,tier)){const item=officialItems.get(id);assert.ok(item.reqLv<=Math.min(97,level));assert.ok(![11,12,25,28,29,30].includes(item.type));assert.ok(item.grade<=dropCatalog.policy.rates[tier].maxGrade);}
 assert.ok(gearPool(97,'boss').some(id=>officialItems.get(id).reqLv===91));
 const allowed=new Set(dropCatalog.materials.map(m=>m.id));for(const p of dropCatalog.policy.materialPools)for(const id of p.ids){assert.ok(allowed.has(id));assert.doesNotMatch(officialItems.get(id).name,/魔力结晶|星耀|筋斗云/);}
});

test('quest drops require the correct active quest and map, stop at shortage, and include queued items',()=>{
 const g=dropCatalog.groups.find(g=>g.taskDrops.some(d=>d.id===8)),d=g.taskDrops.find(d=>d.id===8),p=owner(),battle=battleFor(g),qid=d.missions[0].missionId;
 assert.deepEqual(rollBattleLoot(p,battle,()=>0.9999),[]);
 p.quests.active[qid]={};assert.equal(rollBattleLoot(p,battle,()=>0.9999).find(x=>x.id===8).quantity,d.quantity);
 p.inventory=[{slot:30,itemId:8,quantity:d.missions[0].required-2}];p.pendingLoot=[{id:8,quantity:1}];assert.deepEqual(rollBattleLoot(p,battle,()=>0.9999),[{id:8,quantity:1}]);
 p.pendingLoot[0].quantity=2;assert.deepEqual(rollBattleLoot(p,battle,()=>0.9999),[]);
 p.inventory=[];delete p.pendingLoot;assert.ok(!rollBattleLoot(p,{...battle,mapId:254},()=>0.9999).some(i=>i.id===8));
 delete p.quests.active[qid];assert.deepEqual(rollBattleLoot(p,battle,()=>0.9999),[]);
});

test('all restored hunt requirements can become completable without overflowing their requested quantities',()=>{
 for(const g of dropCatalog.groups)for(const d of g.taskDrops)for(const m of d.missions){const p=owner();p.quests.active[m.missionId]={counts:{}};for(let i=0;i<m.required;i++){const loot=rollBattleLoot(p,battleFor(g),()=>0.9999);applyLootDelivery(p,loot);}const owned=p.inventory.filter(i=>i.itemId===d.id).reduce((n,i)=>n+i.quantity,0);assert.equal(owned,m.required,`${g.key}:${m.missionId}`);}
 const g=dropCatalog.groups.find(g=>g.taskDrops.some(d=>d.id===8)),d=g.taskDrops.find(d=>d.id===8),q=officialMissions.get(d.missions[0].missionId),p=owner();p.quests.active[q.id]={};p.inventory=[{slot:30,itemId:8,quantity:d.missions[0].required}];assert.ok(officialComplete(p,q));
});

test('each independent category respects local chance thresholds and failed rolls award nothing',()=>{
 const p=owner(),g=dropCatalog.groups.find(g=>g.tier==='normal'&&g.equipment.length&&g.materials.length&&!g.extras.length&&!g.taskDrops.length);
 assert.deepEqual(rollBattleLoot(p,battleFor(g),()=>0.9999),[]);
 const yes=rollBattleLoot(p,battleFor(g),()=>0);assert.equal(yes.length,2);assert.ok(g.equipment.includes(yes[0].id));assert.ok(g.materials.includes(yes[1].id));
 let values=[0.15,0.30];assert.deepEqual(rollBattleLoot(p,battleFor(g),()=>values.shift()),[]);
 assert.equal(ruleForBattle({...battleFor(g),official:false}),null);
});

test('full bags persist overflow, fill partial stacks, then deliver once after a real save reload',()=>{
 const p=owner();p.bagLimit=2;p.inventory=[{slot:30,itemId:1010,quantity:98},{slot:31,itemId:10105,quantity:1}];const snapshot=JSON.stringify(p);
 const plan=planLootDelivery(p,[{id:1010,quantity:101},{id:10105,quantity:1}]);assert.equal(JSON.stringify(p),snapshot);assert.equal(plan.inventory[0].quantity,99);assert.deepEqual(plan.pending,[{id:1010,quantity:100},{id:10105,quantity:1}]);assert.equal(plan.added[0].mode,2);
 applyLootDelivery(p,[{id:1010,quantity:101},{id:10105,quantity:1}]);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-loot-'));
 try{const store=new SaveStore(dir);store.data.characters=[p];store.save();const reload=new SaveStore(dir),copy=reload.data.characters[0];assert.deepEqual(copy.pendingLoot,plan.pending);copy.bagLimit=5;const result=applyLootDelivery(copy);assert.equal(result.pending.length,0);assert.equal(copy.inventory.filter(i=>i.itemId===1010).reduce((n,i)=>n+i.quantity,0),199);assert.equal(copy.inventory.filter(i=>i.itemId===10105).length,2);assert.deepEqual(applyLootDelivery(copy).added,[]);assert.equal(copy.pendingLoot,undefined);}
 finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'worldol-loot-'));fs.rmSync(dir,{recursive:true});}
});

function combatHarness({fail=false,result=2}={}){
 const p=owner(),g=dropCatalog.groups.find(g=>g.key==='254:409'),battle={...battleFor(g),token:34567,petUid:null},context={role:p,battle},sent=[];
 const env={store:{save(){if(fail)throw Error('disk failure');}},random:()=>0,send:(type,w)=>sent.push({type,b:w.done()}),log(){}};
 const input=()=>new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(battle.group).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(battle.token).byte(result);
 return {p,battle,context,sent,env,input,run:()=>handleGame(12502,new Reader(input().done()),context,env)};
}
test('battle settlement persists loot and its native response consumes exactly, with no replay grants',()=>{
 const h=combatHarness();h.run();assert.equal(h.context.battle,null);assert.ok(h.p.inventory.length>=2);const r=new NativeReader(h.sent.find(s=>s.type===12502).b),out=readBattleReward(r,decoder,()=>{});r.finish();assert.equal(out.result,2);assert.equal(out.items.length,2);assert.deepEqual(out.items.map(i=>i.itemId),h.p.battles.last.reward.loot.map(i=>i.id));const before=JSON.stringify(h.p);assert.throws(()=>h.run(),/已结算/);assert.equal(JSON.stringify(h.p),before);
});
test('failed persistence rolls back the whole settlement and retains the battle for retry',()=>{
 const h=combatHarness({fail:true}),before=JSON.stringify(h.p);h.context.storyBattle={group:409};assert.throws(()=>h.run(),/disk failure/);assert.equal(JSON.stringify(h.p),before);assert.equal(h.context.battle.token,34567);assert.deepEqual(h.context.storyBattle,{group:409});assert.equal(h.sent.length,0);
 h.env.store.save=()=>{};h.run();assert.equal(h.context.battle,null);assert.equal(h.context.storyBattle,null);assert.ok(h.p.inventory.length);
});
test('escape, defeat, and invalid battle tokens never deliver equipment or pending rewards',()=>{
 for(const result of [1,3,4]){const h=combatHarness({result});h.p.pendingLoot=[{id:1010,quantity:1}];h.run();assert.deepEqual(h.p.inventory,[]);assert.deepEqual(h.p.pendingLoot,[{id:1010,quantity:1}]);}
 const h=combatHarness(),bad=h.input().done();bad.writeInt32BE(123,bad.length-5);const before=JSON.stringify(h.p);assert.throws(()=>handleGame(12502,new Reader(bad),h.context,h.env),/会话不匹配/);assert.equal(JSON.stringify(h.p),before);
});
test('native bag sort delivers queued loot once and rolls back on disk failure',()=>{
 const p=owner(),sent=[],context={role:p},env={store:{save(){throw Error('disk failure');}},send:(type,w)=>sent.push({type,b:w.done()}),log(){}};p.pendingLoot=[{id:1010,quantity:2}];const before=JSON.stringify(p);handleRestoration(12003,new Reader(Buffer.alloc(0)),context,env);assert.equal(JSON.stringify(p),before);assert.equal(new Reader(sent.at(-1).b).byte(),-1);
 env.store.save=()=>{};handleRestoration(12003,new Reader(Buffer.alloc(0)),context,env);assert.equal(p.pendingLoot,undefined);assert.equal(p.inventory[0].quantity,2);handleRestoration(12003,new Reader(Buffer.alloc(0)),context,env);assert.equal(p.inventory[0].quantity,2);
});
test('all task rewards match recorded definitions, with missing IDs explicitly withheld',()=>{
 for(const q of dropCatalog.tasks){const native=officialMissions.get(q.id);for(const key of ['rewardItems','selectItems'])assert.deepEqual(q[key].map(r=>({id:r.id,quantity:r.quantity})),(native[key]||[]).map(r=>({id:r.id,quantity:r.quantity})));for(const r of [...q.rewardItems,...q.selectItems])assert.equal(r.available,officialItems.has(r.id));assert.equal(q.exp,native.exp||0);}
});
test('a live journal prefix ignores an incomplete tail but rejects discontinuities',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-prefix-'));try{fs.mkdirSync(path.join(dir,'events'));const file=path.join(dir,'events','00001.ndjson');fs.writeFileSync(file,'{"seq":1,"method":"event","receivedAt":"2026-09-21"}\n{"seq":2');const out=readVerifiedCapturePrefix(dir);assert.equal(out.rows.length,1);assert.equal(out.audit.snapshot,true);assert.equal(out.audit.cleanEnd,false);assert.equal(out.audit.truncatedTail,true);fs.writeFileSync(file,'{"seq":2,"method":"event"}\n');assert.throws(()=>readVerifiedCapturePrefix(dir),/sequence gap/);}finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'worldol-prefix-'));fs.rmSync(dir,{recursive:true});}
});

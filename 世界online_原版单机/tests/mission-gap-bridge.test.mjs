import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SaveStore} from '../lib/store.mjs';
import {Writer,Reader} from '../lib/codec.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
import {maps,hpMax,mpMax} from '../lib/content.mjs';
import {officialMissions} from '../lib/official-data.mjs';
import {officialCanAccept,officialComplete,officialSign,missionConditions,missingPrerequisites} from '../lib/official-rules.mjs';
import {officialMissionPacket} from '../lib/official-packets.mjs';
import {missionData} from '../lib/game-packets.mjs';
import {handleOfficial} from '../lib/official-service.mjs';
import {handleGame,BATTLE_TRAILER} from '../lib/game-service.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
test('the single 1678 gap bridges existing saves into Captive battle and the original follow-up without false completion or duplicate rewards',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-mission-gap-'));
 t.after(()=>{const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-mission-gap-'));fs.rmSync(exact,{recursive:true,force:true});});
 const store=new SaveStore(dir),account=store.account('任务衔接验收'),p=store.create(account,{name:'任务衔接',sex:1,race:0,job:1,icon1:'2240667',icon2:'0',icon3:'0'});
 Object.assign(p,{level:97,mapId:826,x:15,y:6});p.quests={active:{},completed:[1676,1677]};p.hp=hpMax(p);p.mp=mpMax(p);store.save();
 const q=officialMissions.get(1679),recordedBefore=JSON.stringify(q),npc=maps[826].npcs.find(n=>n.id===33),snapshot=JSON.stringify(p);
 assert.equal(officialSign(p,npc),3);assert.equal(officialCanAccept(p,q),true);assert.deepEqual(missingPrerequisites(p,q),[]);
 assert.equal(officialCanAccept(p,officialMissions.get(1680)),false);assert.equal(officialMissions.has(1678),false);
 assert.equal(q.acceptCondition[0].missionId,1678);assert.equal(officialMissions.get(1677).submitNextMissionID,1678);
 const packet=new NativeReader(missionData(p,33).done());assert.equal(packet.getShort(),33);const count=packet.getByte(),list=[];
 for(let n=0;n<count;n++){const body=packet.getByteArray();list.push(d.Mission.fromBytes(body));body.finish();}d.monsters(packet);packet.finish();
 const next=list.find(q=>q.id===1679);assert.ok(next);assert.equal(next.acceptCondition[0].missionId,1677);assert.equal(next.acceptBattleID,248);assert.equal(next.submitNextMissionID,1680);
 assert.equal(JSON.stringify(p),snapshot);assert.equal(JSON.stringify(q),recordedBefore);
 const context={role:p},sent=[],env={store,send(type,w){sent.push({type,bytes:w instanceof Writer?w.done():Buffer.from(w)});},log(){}};
 const call=(type,w)=>{const r=new Reader(w.done());assert.ok(handleOfficial(type,r,context,env)||handleGame(type,r,context,env));return new Reader(sent.findLast(v=>v.type===type).bytes);};
 const reload=()=>new SaveStore(dir).data.characters.find(r=>r.id===p.id);
 assert.equal(call(14502,new Writer().short(33).short(1679)).byte(),0);assert.ok(reload().quests.active[1679]);assert.equal(context.storyBattle.group,248);
 const beforeReward=p.coins;assert.equal(call(14503,new Writer().short(33).short(1679).int(0)).byte(),-1);assert.equal(p.coins,beforeReward);
 assert.equal(call(12501,new Writer().short(248)).byte(),0);assert.equal(context.battle.group,248);
 const result=new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(248).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(context.battle.token).byte(2);
 call(12502,result);assert.equal(p.quests.active[1679].counts[195],1);assert.equal(officialComplete(p,q),true);
 const beforeSubmit=p.coins;assert.equal(call(14503,new Writer().short(33).short(1679).int(0)).byte(),0);assert.equal(p.coins,beforeSubmit+q.money3);
 assert.equal(reload().quests.completed.includes(1678),false);assert.equal(reload().quests.completed.includes(1679),true);assert.equal(officialCanAccept(p,officialMissions.get(1680)),true);
 const coins=p.coins;assert.equal(call(14503,new Writer().short(33).short(1679).int(0)).byte(),-1);assert.equal(p.coins,coins);
 assert.equal(call(14502,new Writer().short(33).short(1680)).byte(),0);assert.ok(p.quests.active[1680]);assert.equal(p.quests.completed.includes(1678),false);
});

test('bridge preserves unrelated prerequisite rules and round-trips its replacement prerequisite in the native wire format',()=>{
 const next=officialMissions.get(1679),before=officialMissions.get(1677),p={id:1001,level:97,mapId:826,quests:{active:{},completed:[1676,1677]}};
 const wire=new NativeReader(officialMissionPacket(before,p,33).done()),decoded=d.Mission.fromBytes(wire);wire.finish();assert.equal(decoded.submitNextMissionID,1679);
 for(const q of officialMissions.values()){
  if(q.id===1679)continue;
  const original=(q.acceptCondition||[]).filter(c=>[9,10].includes(c.type));
  assert.deepEqual(missionConditions(q,'acceptCondition').filter(c=>[9,10].includes(c.type)),original,'unrelated prerequisites '+q.id);
 }
 assert.equal(missionConditions({...next,id:9999},'acceptCondition')[0].missionId,1678);
 assert.equal(missionConditions(next,'submitCondition')[0].monsterId,195);
});

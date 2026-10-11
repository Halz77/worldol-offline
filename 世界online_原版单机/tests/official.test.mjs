import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Writer,Reader as WireReader} from '../lib/codec.mjs';
import {Reader,decoders,protobufSchemas,protobuf} from '../tools/capture-decoders.mjs';
import {official,officialMaps,officialItems,officialMissions} from '../lib/official-data.mjs';
import {mapBattleData} from '../lib/official-packets.mjs';
import {worldData} from '../lib/world.mjs';
import {cityState} from '../lib/city-state.mjs';
import {normalizeRole,maps,walkable,hpMax,mpMax} from '../lib/content.mjs';
import {missionPacket} from '../lib/game-packets.mjs';
import {handleOfficial,handbookGroups,handbookPage} from '../lib/official-service.mjs';
import {handleGame,BATTLE_TRAILER} from '../lib/game-service.mjs';
import {availableSkills,learn,buyItem,equip,equipment,attributes} from '../lib/restoration.mjs';
import {missionBlockers,missionRewards,missionClientSetting,missionConditions} from '../lib/official-rules.mjs';
import {recordMissionCompletion} from '../lib/daily-activity.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
const role=()=>normalizeRole({id:1,name:'原版规则验收',level:20,race:1,job:1,sex:1,mapId:254,x:21,y:6});

test('all official item definitions preserve native fields after account-specific handbook metadata is removed',()=>{
 assert.ok(officialItems.size>=226);
 for(const e of officialItems.values()){
  const r=new Reader(Buffer.from(e.definitionBase64,'base64')),v=new d.Item();d.Item.fromBytesAtts2(v,r);r.finish();
  for(const key of ['id','name','type','grade','reqLv','reqStr','reqCon','reqAgi','reqIlt','reqWis','atkMin','atkMax','def_str','def_agi','def_mag','bagIcon','power1','powerValue1'])assert.equal(v[key],e[key],`${e.id}:${key}`);
  assert.equal(v.handBookItem,false);assert.equal(v.illusionItemId,undefined);
 }
});
test('every official scene round-trips through native NPC, group, monster, skill and AI decoders',()=>{
 for(const m of officialMaps.values()){
  const p=role();p.mapId=m.id;[p.x,p.y]=m.spawn;const r=new Reader(worldData(p,false).done());
  assert.equal(r.getInt(),m.id);assert.equal(r.getByte(),p.x);assert.equal(r.getByte(),p.y);assert.equal(r.getInt(),256|1024|2048|4096|(m.cityTemplate?32768:0));
  assert.equal(r.getString(),m.name);r.getString();r.getByte();r.take(3);
  // 本地在官方场景上补挂的角色（新月繁华之都的装备与补给商人、四位纪念 NPC）
  // 自己带 local 标记，数量按标记算，避免每加一个本地 NPC 就要回来改期望值。
  const local=maps[m.id].npcs.filter(n=>n.local).length;
  const count=r.getByte();assert.equal(count,m.npcs.length+local);
  for(let n=0;n<count;n++){const v=d.Npc.fromBytes(r);assert.ok(maps[m.id].npcs.some(x=>x.id===v.id));}
  const mon=d.monsters(r);for(const key of ['groups','monsters','ai']){assert.equal(mon[key].length,mapBattleData(m.id)[key].length);assert.ok(mon[key].length<=127);}
  if(m.cityTemplate){const city=cityState(p);assert.equal(r.getInt(),p.id);assert.equal(r.getString(),city.name);assert.equal(r.getInt(),city.prosperity);assert.equal(r.getInt(),city.army);assert.equal(r.getByte(),0);assert.equal(r.getByte(),city.level-1);}
  r.finish();assert.ok(walkable(m.id,...m.spawn),m.name);
  const ids=new Set(mon.monsters.map(m=>m.id));for(const g of mon.groups)for(const id of g.monsters)if(id>0)assert.ok(ids.has(id),`${g.groupId}:${id}`);
  for(const ai of mon.ai)for(const ref of [...ai.skill1,...ai.skill2])if(ref.id>0)assert.ok(ref.definitionFound,`${ai.id}:${ref.id}`);
 }
});
test('all merged mission definitions retain dialogue, reward and condition structure in native client format',()=>{
 const p=role();for(const q of officialMissions.values()){
  const r=new Reader(missionPacket(q,p).done()),v=d.Mission.fromBytes(r);r.finish();
  for(const key of ['id','name','level','dialogStartFinish','dialogStartNotFinish'])assert.equal(v[key],q[key],`${q.id}:${key}`);
  assert.equal(v.setting,missionClientSetting(q));
  for(const key of ['money2','money3','exp'])assert.equal(v[key],missionRewards(q)[key],`${q.id}:${key}`);
  assert.equal(v.acceptCondition?.length||0,missionConditions(q,'acceptCondition').length);assert.equal(v.submitCondition?.length||0,missionConditions(q,'submitCondition').length);
 }
});
test('offline handbook protobufs preserve the full imported catalogue without captured unlock or account state',()=>{
 const schemas=protobufSchemas(fs.readFileSync(new URL('../analysis/protobuf.decoded.js',import.meta.url),'utf8'));
 const groups=protobuf(handbookGroups(),'s2c_HandBookGroupList',schemas);assert.equal(groups.infos.length,4);const seen=new Set();
 for(const g of groups.infos)for(const t of g.info){const page=protobuf(handbookPage(g.group,t.type),'s2c_HandBookInfo',schemas);for(const i of page.itemInfos||[]){assert.equal(i.unlock,false);assert.equal(i.info.uuid,undefined);assert.equal(i.info.expireTime,undefined);seen.add(i.info.itemId);}assert.equal(page.canUnlock,false);}
 assert.ok(seen.size>=2146);assert.deepEqual([...seen].sort((a,b)=>a-b),official.catalog.map(i=>i.itemId).sort((a,b)=>a-b));
});
test('official kill quest counts and delivers once while incomplete item data no longer blocks accepting another quest',()=>{
 const p=role(),context={role:p},sent=[];let saves=0;const env={store:{save(){saves++;}},send(type,w){sent.push({type,b:w instanceof Writer?w.done():w});},log(){}};
 const call=(type,w)=>{const r=new WireReader(w.done());return handleOfficial(type,r,context,env)||handleGame(type,r,context,env);};
 const status=type=>new WireReader(sent.findLast(x=>x.type===type).b).byte();
 call(14502,new Writer().short(101).short(720));assert.equal(status(14502),0);assert.ok(p.quests.active[720]);
 const n=maps[254].npcs.findLast(n=>n.group===409);[p.x,p.y]=[n.x,n.y];p.hp=hpMax(p);p.mp=mpMax(p);
 call(12501,new Writer().short(409));assert.equal(status(12501),0);const token=context.battle.token;
 const result=new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(409).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(token).byte(2);
 call(12502,result);assert.equal(p.quests.active[720].counts[409],3);assert.equal(p.battles.kills[409],3);assert.throws(()=>call(12502,result),/已结算/);
 [p.x,p.y]=[21,6];call(14503,new Writer().short(101).short(720).int(0));assert.equal(status(14503),0);assert.ok(p.quests.completed.includes(720));const coins=p.coins;
 call(14503,new Writer().short(101).short(720).int(0));assert.equal(status(14503),-1);assert.equal(p.coins,coins);
 recordMissionCompletion(p,officialMissions.get(732));p.quests.completed.push(732); // Reveal this phased NPC with a completion from today.
 const npc=maps[254].npcs.find(n=>n.id===115);[p.x,p.y]=[npc.x,npc.y];call(14502,new Writer().short(115).short(735));assert.equal(status(14502),0);assert.ok(p.quests.active[735]);
 const restored=normalizeRole(JSON.parse(JSON.stringify(p)));assert.deepEqual(restored,p);assert.ok(saves>=4);
});
test('native equipment slots and extended career levels preserve active effects without applying them as passives',()=>{
 const p=role(),before=p.coins;buyItem(p,14029,1);const instance=p.inventory.find(i=>i.itemId===14029);equip(p,instance.slot);assert.equal(instance.slot,0);assert.equal(p.coins,before);
 assert.throws(()=>equip(p,30,7),/位置/);
 const list=[...availableSkills(p,305),...availableSkills(p,307)];assert.ok(list.length>=107);
 const s=list.find(s=>s.type===3&&s.reqLevel<=p.level),stats=attributes(p);assert.ok(s);learn(p,s.shop,s.id,1);assert.deepEqual(attributes(p),stats);learn(p,s.shop,s.id,2);assert.deepEqual(attributes(p),stats);
 const petSkill=availableSkills(p,2001)[0],snapshot=JSON.stringify(p);assert.ok(petSkill);assert.throws(()=>learn(p,2001,petSkill.id,1),/不能给人物学习/);assert.equal(JSON.stringify(p),snapshot);
});

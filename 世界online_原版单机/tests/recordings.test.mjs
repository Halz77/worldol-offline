import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {Writer,Reader as WireReader} from '../lib/codec.mjs';
import {decoders,Reader} from '../tools/capture-decoders.mjs';
import {itemInstance} from '../tools/capture-public-blocks.mjs';
import {readPetSummary,readInventoryItem} from '../../正式服录制工具/lib/pets.cjs';
import {recorded,petSources,recordedPets,recordedTitles,petFromRecord} from '../lib/recorded-content.mjs';
import {recordedDirectory,handleRecorded} from '../lib/recorded-service.mjs';
import {officialMissions} from '../lib/official-data.mjs';
import {petDetail} from '../lib/pet-packets.mjs';
import {itemPacket} from '../lib/restoration-packets.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {claimRecordedPet,equipPet,openContainer,gainPet,petAttributes} from '../lib/pet-state.mjs';
import {nativeCharacterStats} from '../lib/native-character-stats.mjs';
import {attributes} from '../lib/restoration.mjs';
import {SaveStore} from '../lib/store.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
const parsePet=d.native(42,'fromBytesDetail',{
 n:{default:{timer:{serverTime:0}}},a:{default:{processDataPlayerSkillMsg(r){return Array.from({length:r.getShort()},()=>d.Skill.fromBytes(r));}}},
 E:{default:{PET_BAG_SIZE:8}},f:{default:{fromBytes:r=>itemInstance(r,d).item}}
});
function role(){const p=normalizeRole({id:1001,name:'录制还原测试',level:97,job:1,race:0,sex:1,mapId:10});p.inventory=[];return p;}
function harness(p=role(),fail=false){const context={role:p},sent=[],store={save(){if(fail)throw Error('disk failure');}},env={store,send:(type,w)=>sent.push({type,b:w.done()}),log(){}};return {p,context,call(type,w=new Writer()){assert.equal(handleRecorded(type,new WireReader(w.done()),context,env),true);return new Reader(sent.findLast(x=>x.type===type).b);}};}

test('all 143 templates and actual pet snapshots preserve native quality, growth, skills and equipped gear',()=>{
 assert.equal(recordedPets.size,143);assert.equal(recorded.petSnapshots.length,23);
 for(const t of petSources.values()){
  const p=petFromRecord(t),r=new Reader(petDetail(new Writer(),p).done()),out={bag:{store:[]}};assert.equal(parsePet(r,out),0);r.finish();
  for(const k of ['level','grade','grow','cp','growLevel','job'])assert.equal(out[k],t[k],`${t.id}:${k}`);
  assert.equal(out.compre,t.comprehension);assert.equal(out.str,t.attributes.strength);assert.equal(out.ilt,t.attributes.intelligence);
  assert.deepEqual(Array.from(out.skillList,s=>[s.id,s.level,s.addLevel||0]),t.skills.map(s=>[s.id,s.level,s.addLevel||0]));
  for(const i of t.equipment)assert.equal(out.bag.store[i.slot].id,i.itemId);
  const owner=role(),item=claimRecordedPet(owner,t.id),bagReader=new Reader(itemPacket(new Writer(),item).done());const bag=readInventoryItem(bagReader,d);bagReader.finish();assert.ok(bag.pet);assert.equal(bag.pet.grade,t.grade);if(t.id===345)assert.equal(bag.pet.bagIcon,1088);
  equipPet(owner,item.slot,1);const before=structuredClone(item.pet);gainPet(owner,100);assert.equal(item.pet.level,before.level);assert.deepEqual(item.pet.baseStats,before.baseStats);assert.ok(item.pet.hp<=petAttributes(owner,item.pet).hp);
 }
});

test('native pet info/raiders and VIP queries consume full payloads with no account or purchase replay',()=>{
 const {call}=harness();
 for(const id of petSources.keys()){const r=call(15514,new Writer().int(id));assert.equal(r.getByte(),0);const out={bag:{store:[]}};assert.equal(parsePet(r,out),0);assert.equal(r.getString(),petSources.get(id).description||'');r.finish();}
 const roster=call(16009,new Writer().short(127).int(127).byte(-1));assert.equal(roster.getInt(),75);assert.equal(roster.getByte(),75);for(let n=0;n<75;n++){const p=readPetSummary(roster,d);assert.ok(recordedPets.has(p.id));roster.getString();}roster.finish();
 const vip=call(11055),vipInfo=vip.getString();assert.match(vipInfo,/当前 VIP/);assert.match(vipInfo,/待补/);assert.equal(vip.getInt(),0);assert.equal(vip.getInt(),2000);const count=vip.getByte();assert.equal(count,3);for(let n=0;n<count;n++){const item=new d.Item();d.Item.fromBytesAtts2(item,vip);if(item.id>=41000&&item.id<=41008)assert.equal(vip.getInt(),0);}vip.finish();
 for(const type of [11053,11160]){const r=call(type);assert.equal(r.getByte(),0);assert.equal(r.getShort(),1);r.getShort();r.getString();r.getByte();r.getInt();r.finish();}
 const limit=call(12052);assert.equal(limit.getByte(),9);limit.finish();
});

test('recorded titles apply their exact two powers to native score and the server, cancel, persist and reject save failures',()=>{
 const p=role(),h=harness(p),before=attributes(p),nativeBefore=nativeCharacterStats(p).stats;
 // MOD(original-titles)：称号表已从录制到的 20 条补齐成原版全部称号（data/recorded-content.json）。
 // 这里原先写死 20，与「补齐原版所有称号」互斥；改成按实际数据条数断言，
 // 逐条比对仍然校验每个称号的 id/名称/两条属性，不会漏掉解码问题。
 const list=h.call(11026);assert.equal(list.getShort(),recordedTitles.size);assert.ok(recordedTitles.size>=20);for(const t of recordedTitles.values()){assert.equal(list.getShort(),t.id);assert.equal(list.getString(),t.name);assert.equal(list.getByte()&255,t.power1);assert.equal(list.getShort(),t.value1);assert.equal(list.getByte()&255,t.power2);assert.equal(list.getShort(),t.value2);}list.finish();
 const set=h.call(11027,new Writer().short(1));assert.equal(set.getByte(),0);assert.equal(set.getString(),'给力！');assert.deepEqual([set.getShort(),set.getShort(),set.getShort(),set.getShort()],[3,15,1,15]);set.finish();
 assert.equal(p.titleId,1);assert.equal(attributes(p).base[0]-before.base[0],15);assert.equal(attributes(p).base[1]-before.base[1],15);assert.ok(nativeCharacterStats(p).stats.HPMAX>nativeBefore.HPMAX);
 const restored=normalizeRole(JSON.parse(JSON.stringify(p)));assert.equal(restored.titleId,1);assert.deepEqual(nativeCharacterStats(restored),nativeCharacterStats(p));
 assert.equal(h.call(11027,new Writer().short(-1)).getByte(),0);assert.deepEqual(attributes(p),before);
 for(const [type,w] of [[11027,new Writer().short(1)],[90004,new Writer().int(345)]]){const failed=harness(p,true),snapshot=JSON.stringify(p),r=failed.call(type,w);assert.equal(r.getByte(),-1);assert.match(r.getString(),/disk failure/);assert.equal(JSON.stringify(p),snapshot);}
 h.context.battle={};assert.equal(h.call(90004,new Writer().int(345)).getByte(),-1);
});

test('verified pumpkin receipt opens only the recorded excellent result and a pet claim survives real SaveStore reload',()=>{
 const egg=recorded.eggResults.find(e=>e.eggId===30076);assert.ok(egg.purchaseEvidence);assert.equal(egg.item.grade,1);assert.equal(egg.baseline.grow,53);
 const p=role();p.inventory=[{itemId:30076,slot:30,quantity:1}];const result=openContainer(p,30,1),pet=result.added[0].instance.pet;assert.equal(pet.grade,1);assert.equal(pet.grow,53);assert.equal(pet.comprehension,10);assert.deepEqual(pet.baseStats,[3,15,3,15,5]);assert.throws(()=>openContainer(p,30,1),/尚未采集/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-recordings-'));try{const store=new SaveStore(dir),account=store.account('recordings-test'),live=store.create(account,{name:'宠物存档测试',sex:1,race:0,job:1});live.level=97;live.titleId=1;const item=claimRecordedPet(live,345);equipPet(live,item.slot,1);store.save();const reloaded=new SaveStore(dir).data.characters[0];assert.equal(reloaded.titleId,1);assert.deepEqual(reloaded.inventory.find(i=>i.pet),item);}finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'worldol-recordings-'));fs.rmSync(dir,{recursive:true});}
});

test('public restoration directory separates complete templates, observed samples and missing quest rules',()=>{
 const data=recordedDirectory();assert.equal(data.pets.length,143);assert.equal(data.petSamples.length,23);assert.equal(data.sets.length,192);assert.equal(data.missions.length,officialMissions.size);assert.equal(data.petSkills.length,295);
 assert.ok(data.missions.some(q=>q.blockers.length));assert.ok(data.petEggs.some(e=>e.canOpen));assert.ok(data.petEggs.some(e=>!e.canOpen));assert.ok(!JSON.stringify(data).includes('petUid'));
});

test('native vitality shows real login progress, previews rewards and keeps early clicks safe',()=>{
 class Vitality{};Vitality.VITALITY_REWARD_ITEM_TYPE1=1;
 class Vector{constructor(){this.arr=[];}addElement(row){this.arr.push(row);}size(){return this.arr.length;}}
 const events={ActivityEvent:{ACTIVITE_RED_UP:1},MainEvent:{ON_MAIN_ICON:2},ActiveEvent:{ACTIVE_EVENT_INFO:3}},proxy={sendNt(){}};
 const parse=d.native(743,'enterCallback',{v:{default:Vitality},S:{default:Vector},go:{openPay:true},n:events,E:{default:{IS_OPEN_TYPE_DAILY_ICON:1}}});
 const h=harness(),r=h.call(14551);parse.call(proxy,{body:r});r.finish();
 assert.equal(proxy.vitality.allvalue,20);assert.equal(proxy.vitality.vItemVitality.size(),4);assert.equal(proxy.vitality.vConVitality.size(),17);
 assert.deepEqual(proxy.vitality.vItemVitality.arr.map(x=>x.rewardid),[100,200,300,400]);assert.ok(proxy.vitality.vItemVitality.arr.every(x=>x.status===0));assert.ok(proxy.vitality.vConVitality.arr.every(x=>x.progress===(x.conid===1?1:0)));
 const before=JSON.stringify(h.p),preview=h.call(14553,new Writer().int(100));assert.equal(preview.getByte(),0);assert.equal(preview.getByte(),1);assert.equal(preview.getByte(),1);const item=new d.Item();d.Item.fromBytesAtts2(item,preview);assert.equal(item.id,40001);assert.equal(preview.getByte(),1);assert.deepEqual([preview.getShort(),preview.getShort(),preview.getShort()],[0,0,0]);preview.finish();
 const response=h.call(14554,new Writer().int(100));assert.equal(response.getByte(),-1);assert.match(response.getString(),/尚未达到/);response.finish();assert.equal(JSON.stringify(h.p),before);
 class View{getItem(index){const row=this._proxy.vitalityData.vItemVitality.arr[index];return[row.rewardid,row.status];}doEnterInfo(){this._view.desc.text='原版';}}
 let dailyEntrySeeded=false;const window={};vm.runInNewContext(fs.readFileSync(new URL('../web/recorded-content.js',import.meta.url),'utf8'),{window});window.installRecordedVitality(id=>id===45?{default:{getInstance:{setFakeRed(){dailyEntrySeeded=true;}}}}:{MissionActiveMdr:View});assert.ok(dailyEntrySeeded);
 const view=new View();view._proxy={};view._view={desc:{}};assert.deepEqual([...view.getItem(0)],[0,-1]);assert.doesNotThrow(()=>view.doEnterInfo());
 view._proxy.vitalityData=proxy.vitality;assert.deepEqual(view.getItem(0),[100,0]);view.doEnterInfo();assert.match(view._view.desc.text,/每日零点刷新/);
});

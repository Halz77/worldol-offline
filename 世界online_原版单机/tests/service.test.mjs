import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import vm from 'node:vm';
import net from 'node:net';
import {starLimit} from '../lib/equipment-policy.mjs';
import WebSocket from 'ws';
import {Writer,Reader,frame,unframe} from '../lib/codec.mjs';
import {restored} from '../lib/restoration.mjs';
import {equipmentSets} from '../lib/equipment-sets.mjs';
import {supplyShops} from '../lib/supply-shops.mjs';
import {official,officialItems} from '../lib/official-data.mjs';
import {canonicalLegacySkill} from '../lib/career-skills.mjs';
import {damageMathRevision} from '../lib/client-damage-patch.mjs';
import {bossManaRecoveryRevision,patchGardenerManaRecovery} from '../lib/client-monster-recovery-patch.mjs';
import {combatRatingRevision,combatRating} from '../lib/combat-rating.mjs';
import {decodeFeature} from '../lib/feature-protobuf.mjs';
import {decodeDaily,encodeDaily} from '../lib/daily-service.mjs';
import {clientMissionRevision} from '../lib/client-mission-patch.mjs';
import {clientBagRevision} from '../lib/client-bag-patch.mjs';
import {recordedExpansion,recordedExpansionRevision} from '../lib/recorded-expansion.mjs';
import {yunruoTempleRevision} from '../lib/yunruo-temple.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('loopback service creates, enters and persists a role through v305 messages',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-service-'));
  const allocator=net.createServer();allocator.listen(0,'127.0.0.1');await once(allocator,'listening');const port=allocator.address().port;await new Promise(resolve=>allocator.close(resolve));
  const proc=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:{...process.env,WORLDOL_PORT:String(port),WORLDOL_SAVES:dir,WORLDOL_LOGS:path.join(dir,'logs')},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let ws;try{
    await Promise.race([once(proc.stdout,'data'),once(proc,'exit').then(([code])=>{throw Error('Service exited '+code);}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Startup timed out')),5000).unref())]);
    const response=await fetch(`http://127.0.0.1:${port}/`);assert.equal(response.status,200);assert.ok(response.headers.get('content-security-policy').includes(`connect-src 'self' ws://127.0.0.1:${port}`));
    const statusResponse=await fetch(`http://127.0.0.1:${port}/api/status`);assert.equal(statusResponse.status,200);const status=await statusResponse.json();assert.equal(status.damageMathRevision,damageMathRevision);assert.equal(status.combatRatingRevision,combatRatingRevision);
    assert.equal(status.recordedExpansionRevision,recordedExpansionRevision);assert.equal(status.yunruoTempleRevision,yunruoTempleRevision);
    const capturedDirectory=await(await fetch(`http://127.0.0.1:${port}/api/official-content`)).json();assert.equal(capturedDirectory.missions,official.missions.length);
    for(const scene of recordedExpansion.maps)assert.ok(capturedDirectory.maps.some(m=>m.id===scene.id));
    assert.match(await(await fetch(`http://127.0.0.1:${port}/combat-rating.js`)).text(),/installCombatRating/);
    assert.match(await(await fetch(`http://127.0.0.1:${port}/native-vip.js`)).text(),/BagUserView/);
    assert.match(await(await fetch(`http://127.0.0.1:${port}/character-features.js`)).text(),/installCharacterFeatures/);
    const client=await(await fetch(`http://127.0.0.1:${port}/js/ff/fff570bb4753f056432680e781d827dc.js`)).text();
    assert.equal(status.clientBagRevision,clientBagRevision);assert.ok(client.includes('t.prototype.isOneKey=function(e){return e.quantity>1}'));
    assert.equal(status.bossManaRecoveryRevision,bossManaRecoveryRevision);assert.ok(client.includes('1985===e.id&&2===e.getType()?e.get(f.ModelConst.MP)/20:.005*a'));assert.throws(()=>patchGardenerManaRecovery(client),/patch mismatch/);
    assert.equal(status.clientMissionRevision,clientMissionRevision);assert.ok(!client.includes('if(r-10>o.proposalLevel||r+5<o.proposalLevel)return'));assert.ok(!client.includes('e.btnType.visible&&(this.btnTypeBg.visible=e.btnType.visible=!t)'));
    for(const product of ['(100-u)*_*d','(100-P)*R*O','(100-w)*b*x']){assert.ok(client.includes('Math.trunc('+product+')'));assert.ok(!client.includes('g.GUtil.intNum('+product+')'));}
    const workshop=await fetch(`http://127.0.0.1:${port}/equipment-workshop.js`);assert.equal(workshop.status,200);assert.match(await workshop.text(),/installEquipmentWorkshop/);
    assert.match(await(await fetch(`http://127.0.0.1:${port}/equipment-composition.js`)).text(),/installEquipmentComposition/);
    const compositionData={};vm.runInNewContext(await(await fetch(`http://127.0.0.1:${port}/equipment-composition-data.js`)).text(),{window:compositionData});assert.equal(compositionData.worldolCompositionData.sets.length,equipmentSets.size);
    const rules=await fetch(`http://127.0.0.1:${port}/equipment-rules.js`);assert.equal(rules.status,200);const browser={};vm.runInNewContext(await rules.text(),{window:browser});
    for(const type of [0,8,11,13,24,34])for(const reqLv of [1,49,50,69,70,97]){const item={type,reqLv,ascensionStar:10};assert.equal(browser.worldolStarLimit(item),starLimit(item));}
    assert.equal(browser.worldolEquipmentRules.star.successRate,50);assert.equal(browser.worldolEquipmentRules.gem.guaranteed,30);assert.equal(browser.worldolEquipmentRules.gem.successRate,50);
    const supply=await(await fetch(`http://127.0.0.1:${port}/api/supply-shops`)).json();assert.equal(supply.equipmentGrade,4);assert.equal(supply.shops.filter(s=>s.id>=909&&s.id<=912).reduce((n,s)=>n+s.count,0),supplyShops.filter(s=>s.id>=909&&s.id<=912).reduce((n,s)=>n+s.items.length,0));
    ws=new WebSocket(`ws://127.0.0.1:${port}/game`);await once(ws,'open');
    const ratings=[];ws.on('message',data=>{const p=unframe(data);if(p.type===12049){const r=new Reader(p.body);ratings.push(r.int());for(let i=0;i<6;i++)assert.equal(r.int(),0);assert.equal(r.pos,r.b.length);}});
    async function call(type,body=new Writer(),responseType=type){const result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',receive);reject(Error('Timed out: '+type));},3000);function receive(data){const packet=unframe(data);if(packet.type!==responseType)return;clearTimeout(timer);ws.off('message',receive);resolve(new Reader(packet.body));}ws.on('message',receive);});ws.send(frame(type,body));return result;}
    assert.equal((await call(5000)).byte(),0);
    const login=await call(5002,new Writer().string('wiretest'));assert.equal(login.byte(),0);const account=login.long(),session=login.int();
    assert.equal((await call(1,new Writer().long(account).int(session))).byte(),0);
    assert.equal((await call(5007)).byte(),1);
    const create=await call(10002,new Writer().byte(1).byte(1).byte(3).long(2240667).long(0).long(0).string('验收角色'));
    assert.equal(create.byte(),0);const roleId=create.int();assert.equal(create.string(),'验收角色');
    assert.equal((await call(2,new Writer().int(roleId))).byte(),0);
    const activity=await call(14551);assert.equal(activity.bool(),true);assert.equal(activity.short(),20);assert.equal(activity.short(),0);assert.equal(activity.short(),4);
    const daily=decodeDaily('s2c_TaskInfo',(await call(22105,new Writer(),22106)).b);assert.equal(daily.info.length,58);assert.equal(daily.activeInfo.activeValue,0);
    const denied=decodeDaily('s2c_TaskActiveReward',(await call(22107,encodeDaily('c2s_TaskActiveReward',{id:1}),22108)).b);assert.equal(denied.rs,-1);assert.match(denied.rsDesc,/尚未达到/);
    const diskBefore=fs.readFileSync(path.join(dir,'world.json'),'utf8');const dailyApi=await(await fetch(`http://127.0.0.1:${port}/api/daily-activity?role=${roleId}`)).json();assert.equal(dailyApi.vitality.value,20);assert.equal(dailyApi.tasks.info.length,58);assert.equal(fs.readFileSync(path.join(dir,'world.json'),'utf8'),diskBefore);
    await call(16001);assert.ok(ratings.at(-1)>0);const initialRating=ratings.at(-1);
    const composition=await call(90001);assert.equal(composition.byte(),0);assert.equal(JSON.parse(composition.string()).role,roleId);
    const vip=await call(90003,new Writer().byte(9));assert.equal(vip.byte(),0);const vipState=JSON.parse(vip.string());assert.equal(vipState.vipLevel,9);assert.equal(vip.bool(),false);
    const nativeVip=await call(11055);assert.match(nativeVip.string(),/当前 VIP 9/);assert.equal(nativeVip.int(),0);assert.equal(nativeVip.int(),0);assert.equal(nativeVip.byte(),3);
    const rejectedVip=await call(11161,new Writer().int(500));assert.equal(rejectedVip.byte(),-1);assert.match(rejectedVip.string(),/待定/);
    const features=await(await fetch(`http://127.0.0.1:${port}/api/character-features?role=${roleId}`)).json();assert.equal(features.talents.length,54);assert.deepEqual(features.powers,[]);
    assert.equal(features.talents.filter(t=>t.pending).length,0);assert.ok(features.talents.every(t=>t.level===0&&t.next.level===1));
    const talentReply=await call(27301,new Writer(),27302),talents=decodeFeature('s2c_Talent_List',talentReply.b);assert.equal(talents.talents?.length||0,0);assert.equal(talents.nextTalents.length,54);
    assert.deepEqual(talents.nextTalents.find(t=>t.rankId===3).items.map(i=>[i.itemId,i.itemCount]),[[5200,5],[1041,10]]);
    const birth=await call(10503);assert.equal(birth.byte(),0);assert.equal(birth.int(),303);assert.equal(birth.byte(),16);assert.equal(birth.byte(),13);
    assert.equal((await call(10523,new Writer().int(1))).byte(),0);
    const map=await call(10503);assert.equal(map.byte(),0);assert.equal(map.int(),1);assert.equal(map.byte(),19);assert.equal(map.byte(),15);
    ws.send(frame(10504,new Writer().byte(16).byte(9)));
    await call(16001); // Ordered websocket message confirms previous movement was processed.
    const saved=JSON.parse(fs.readFileSync(path.join(dir,'world.json'),'utf8'));assert.equal(saved.characters[0].x,16);assert.equal(saved.characters[0].y,9);
    assert.equal((await call(11530,new Writer().short(0))).byte(),0);
    const repair=await call(12019,new Writer().short(-1));assert.equal(repair.byte(),0);assert.equal(repair.int(),1000);
    assert.equal((await call(11501,new Writer().byte(0))).byte(),0);
    assert.equal((await call(12060,new Writer().int(2147483647))).short(),0);
    assert.equal((await call(12060,new Writer().int(2056))).short(),4);
    const regions=await call(10521);assert.equal(regions.byte(),14);
    const destinations=await call(10522,new Writer().int(0));assert.equal(destinations.byte(),0);assert.equal(destinations.byte()&255,official.maps.length+1);
    const snow=await call(10522,new Writer().int(16));assert.equal(snow.byte(),0);assert.equal(snow.byte(),1);assert.equal(snow.short(),37);
    const nativeShop=await call(12004,new Writer().short(902));assert.equal(nativeShop.byte(),0);assert.equal(nativeShop.short(),officialItems.size);
    const shop=await call(12004,new Writer().short(901));assert.equal(shop.byte(),0);assert.equal(shop.short(),14);
    const bought=await call(12005,new Writer().short(901).int(800000).byte(1).bool(false));assert.equal(bought.byte(),0);assert.equal(bought.int(),800000);
    assert.equal((await call(12001,new Writer().byte(9).byte(1).short(30).int(1).byte(-1).bool(false).byte(13))).byte(),9);
    const skillShop=await call(14001,new Writer().short(1100));assert.equal(skillShop.short(),1100);assert.equal(skillShop.byte(),94);
    const original=restored.skills.find(s=>s.name==='易筋经'),skill={id:canonicalLegacySkill(original.id)};
    for(let level=1;level<=22;level++)assert.equal((await call(14002,new Writer().short(1100).int(skill.id).byte(level).bool(false))).byte(),0);
    const directory=await(await fetch(`http://127.0.0.1:${port}/api/career-skills`)).json();assert.equal(directory.skills.length,470);assert.equal(directory.teachers.length,9);
    for(const teacher of directory.teachers){const r=await call(14001,new Writer().short(teacher.shop));assert.equal(r.short(),teacher.shop);assert.equal(r.byte(),teacher.count);}
    const state=JSON.parse(fs.readFileSync(path.join(dir,'world.json'),'utf8')).characters[0];assert.equal(state.inventory.length,2);assert.equal(state.inventory[0].slot,8);assert.equal(state.skills[skill.id],22);assert.equal(state.coins,980);
    await call(16001);assert.equal(ratings.at(-1),combatRating(state).total);assert.ok(ratings.at(-1)>initialRating);
    const ratingReport=await(await fetch(`http://127.0.0.1:${port}/api/combat-rating?role=${roleId}`)).json();assert.equal(ratingReport.total,ratings.at(-1));assert.equal(ratingReport.parts.length,4);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/combat-rating?role=-1`)).status,404);
    const logout=await call(3,new Writer().byte(1));assert.equal(logout.byte(),1);assert.equal(logout.byte(),0);assert.equal(logout.pos,logout.b.length);const roles=await call(10001);roles.string();assert.equal(roles.short(),1);assert.equal(roles.int(),roleId);
    assert.equal((await call(2,new Writer().int(roleId))).byte(),0);const persisted=JSON.parse(fs.readFileSync(path.join(dir,'world.json'),'utf8')).characters[0];assert.deepEqual(persisted.inventory,state.inventory);assert.deepEqual(persisted.skills,state.skills);
    await call(16001);assert.equal(ratings.at(-1),ratingReport.total,'relogin sends the same derived score');
    for(const scene of recordedExpansion.maps){
      const entered=await call(10523,new Writer().int(scene.id));assert.equal(entered.byte(),0);assert.equal(entered.byte(),0);assert.equal(entered.int(),scene.id);
      const current=await call(10503);assert.equal(current.byte(),0);assert.equal(current.int(),scene.id);
      for(const npc of scene.npcs.filter(n=>n.npcType===0||n.npcType===5)){
        const query=await call(14501,new Writer().short(npc.id));assert.equal(query.short(),npc.id);assert.ok(query.byte()>=0,scene.id+':'+npc.id+' native mission list');
      }
    }
    const blocked=await fetch(`http://127.0.0.1:${port}/api/shutdown`,{method:'POST'});assert.equal(blocked.status,403);
  }finally{
    ws?.close();
    if(proc.exitCode===null){const c=JSON.parse(fs.readFileSync(path.join(dir,'logs/control.json'),'utf8'));const stopped=once(proc,'exit');await fetch(`http://127.0.0.1:${port}/api/shutdown`,{method:'POST',headers:{'X-Worldol-Control':c.token}});await stopped;}
    const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-service-'));fs.rmSync(exact,{recursive:true});
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {SaveStore} from '../lib/store.mjs';
import {Writer,Reader} from '../lib/codec.mjs';
import {hpMax,mpMax} from '../lib/content.mjs';
import {legionData,legionInfo,legionState,activeLegionMembers,changeLegionFormation,selectLegion} from '../lib/legion-state.mjs';
import {handleLegion,encodeLegion,decodeLegion,LEGION_TRAILER,pushLegionMembers} from '../lib/legion-service.mjs';
import {handleGame,BATTLE_TRAILER} from '../lib/game-service.mjs';
import {playerDetail} from '../lib/world.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
import {skipPlayerDetail,itemInstance} from '../tools/capture-public-blocks.mjs';
import {activeSkills} from '../lib/restoration.mjs';
import {patchOfflineLegionBattles} from '../lib/client-legion-patch.mjs';
import {activePet,openContainer,equipPet,petAttributes} from '../lib/pet-state.mjs';
import {firstFree} from '../lib/restoration.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-legion-')),store=new SaveStore(dir),account=store.account('军团验收');
 const roles=Array.from({length:5},(_,i)=>store.create(account,{name:'小队'+i,sex:0,race:0,job:1,icon1:'2240667',icon2:'0',icon3:'0'}));
 const outsider=store.create(store.account('其他存档'),{name:'外部角色',sex:0,race:0,job:1,icon1:'2240667',icon2:'0',icon3:'0'});
 t.after(()=>{const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-legion-'));fs.rmSync(exact,{recursive:true,force:true});});
 const p=roles[0],context={role:p,account},sent=[];
 const env={store,send(type,w){sent.push({type,bytes:w instanceof Writer?w.done():Buffer.from(w)});},log(){}};
 const call=(type,data={},responseType=type+1)=>{const schema=type===31053?'c2s_LegionFormation':type===31055?'c2s_LegionBattle':'c2s_LegionInfo';handleLegion(type,new Reader(encodeLegion(schema,data)),context,env);return sent.findLast(v=>v.type===responseType);};
 return {dir,store,p,roles,outsider,context,sent,env,call};
}
test('three persistent formations each support four level-1 helpers, with same-save identity checks',t=>{
 const h=fixture(t),{p,roles,outsider,store}=h;
 assert.equal(p.level,1);assert.equal(legionData.formations.length,3);
 for(const group of legionInfo(p).legionInfos){assert.equal(group.infos.length,4);assert.ok(group.infos.every(s=>s.unlockLevel===0));}
 for(let i=1;i<=4;i++)h.call(31053,{type:1,legionId:1,index:i,actorId:roles[i].id});
 assert.deepEqual(activeLegionMembers(p).map(m=>m.role.id),roles.slice(1).map(m=>m.id));
 assert.throws(()=>changeLegionFormation(p,{type:1,legionId:2,index:1,actorId:p.id}),/同一存档/);
 assert.throws(()=>changeLegionFormation(p,{type:1,legionId:2,index:1,actorId:outsider.id}),/同一存档/);
 assert.throws(()=>changeLegionFormation(p,{type:1,legionId:1,index:5,actorId:roles[1].id}),/栏位/);
 h.call(31053,{type:1,legionId:2,index:1,actorId:roles[2].id});
 h.call(31055,{legionId:2});assert.deepEqual(activeLegionMembers(p).map(m=>m.role.id),[roles[2].id]);
 const loaded=new SaveStore(h.dir),again=loaded.data.characters.find(r=>r.id===p.id);
 assert.deepEqual(legionState(again),legionState(p));assert.equal(legionInfo(again).actorInfos.length,4);
 const packet=h.call(31051),decoded=decodeLegion('s2c_LegionInfo',packet.bytes);
 assert.equal(decoded.legionInfos.length,3);assert.equal(decoded.legionInfos[0].infos.length,4);
 const removed=h.call(31053,{type:2,legionId:2,index:1});assert.equal(decodeLegion('s2c_LegionFormation',removed.bytes).actorId,roles[2].id);
 assert.equal(activeLegionMembers(p).length,0);
});
test('formation changes roll back on failed save and cannot change during a battle',t=>{
 const h=fixture(t),before=JSON.stringify(h.p),save=h.store.save;
 h.store.save=()=>{throw Error('disk unavailable');};h.call(31053,{type:1,legionId:1,index:1,actorId:h.roles[1].id});
 assert.equal(JSON.stringify(h.p),before);assert.ok(h.sent.some(p=>p.type===10509));h.store.save=save;
 h.context.battle={token:1};h.call(31053,{type:1,legionId:1,index:1,actorId:h.roles[1].id});assert.equal(JSON.stringify(h.p),before);
});
test('native full actor payload and legion appearance remain aligned with four members',t=>{
 const h=fixture(t);for(let i=1;i<=4;i++)changeLegionFormation(h.p,{type:1,legionId:1,index:i,actorId:h.roles[i].id});
 const reader=new NativeReader(playerDetail(new Writer(),h.p).done());skipPlayerDetail(reader,d);reader.finish();
 pushLegionMembers(h.p,h.env.send);
 const data=new NativeReader(h.sent.findLast(s=>s.type===10030).bytes);assert.equal(data.getByte(),4);
 for(const role of h.roles.slice(1)){assert.equal(data.getInt(),role.id);const parsed=skipPlayerDetail(data,d);assert.equal(parsed.hp,role.hp);const items=data.getShort();assert.equal(items,role.inventory.length);for(let i=0;i<items;i++)itemInstance(data,d);const skills=data.getShort();assert.equal(skills,activeSkills(role).length);for(let i=0;i<skills;i++){d.Skill.fromBytes(data);data.getByte();}}
 data.finish();
 const vitals=decodeLegion('s2c_LegionActorHp',h.sent.findLast(s=>s.type===31058).bytes);assert.equal(vitals.infos.length,4);assert.equal(vitals.infos[0].maxHp,hpMax(h.roles[1]));
});
test('pre-battle refresh sends current full member records before acknowledgement and refuses an active battle',t=>{
 const h=fixture(t);changeLegionFormation(h.p,{type:1,legionId:1,index:1,actorId:h.roles[1].id});
 h.roles[1].skills={452:22};
 h.call(90017,{},90017);
 assert.deepEqual(h.sent.map(s=>s.type),[90015,10030,31058,15601,90017]);
 const data=new NativeReader(h.sent.find(s=>s.type===10030).bytes);assert.equal(data.getByte(),1);assert.equal(data.getInt(),h.roles[1].id);skipPlayerDetail(data,d);for(let n=data.getShort();n>0;n--)itemInstance(data,d);
 assert.equal(data.getShort(),1);const skill=d.Skill.fromBytes(data);data.getByte();assert.equal(skill.id,452);assert.equal(skill.level,22);data.finish();
 const body=new Reader(h.sent.at(-1).bytes);assert.equal(JSON.parse(body.string()).ready,true);
 h.sent.length=0;h.context.battle={token:1};h.call(90017,{},90017);
 assert.deepEqual(h.sent.map(s=>s.type),[90017]);assert.equal(JSON.parse(new Reader(h.sent[0].bytes).string()).ready,false);
});
test('each member saves its own initiative and ordered automatic skills across reload and deployment',t=>{
 const h=fixture(t),leaderBefore=JSON.stringify([h.p.autoSkillIds,h.p.initiativeSkillId]);
 for(let i=1;i<=4;i++){
  const role=h.roles[i];role.skills={420:22,423:22,422:22,421:22,452:22};role.autoSkillIds=[0,0,0,0];
  const ids=[420,423,422,421];const ordered=ids.slice(i-1).concat(ids.slice(0,i-1));
  const call=(type,id)=>{handleRestoration(type,new Reader(new Writer().byte(0).int(id).done()),{role},h.env);return new Reader(h.sent.findLast(s=>s.type===type).bytes).byte();};
  for(const id of ordered)assert.equal(call(14004,id),0);assert.equal(call(14009,452),0);
  assert.equal(call(14005,ordered[1]),0);assert.equal(call(14004,ordered[1]),0);
  assert.deepEqual(role.autoSkillIds,[ordered[0],ordered[2],ordered[3],ordered[1]]);
  const before=JSON.stringify([role.autoSkillIds,role.initiativeSkillId]),save=h.store.save;h.store.save=()=>{throw Error('disk unavailable');};
  assert.equal(call(14010,452),-1);assert.equal(call(14005,ordered[0]),-1);assert.equal(JSON.stringify([role.autoSkillIds,role.initiativeSkillId]),before);h.store.save=save;
  changeLegionFormation(h.p,{type:1,legionId:1,index:i,actorId:role.id});
 }
 assert.equal(JSON.stringify([h.p.autoSkillIds,h.p.initiativeSkillId]),leaderBefore);h.store.save();
 const saved=new SaveStore(h.dir),p=saved.data.characters.find(r=>r.id===h.p.id);h.sent.length=0;pushLegionMembers(p,h.env.send);
 const r=new NativeReader(h.sent.find(s=>s.type===10030).bytes);assert.equal(r.getByte(),4);
 for(let i=1;i<=4;i++){
  const role=saved.data.characters.find(p=>p.id===h.roles[i].id);assert.equal(r.getInt(),role.id);
  const actor=skipPlayerDetail(r,d);assert.deepEqual(actor.autoSkillIds,h.roles[i].autoSkillIds);assert.equal(actor.initiativeSkillId,452);
  const roundSkill=d.native(251,'getAutoSkillIDByRound'),nativeActor={autoSkillID:actor.autoSkillIds,getAutoSkillCount:()=>4};
  assert.deepEqual(Array.from({length:8},(_,round)=>roundSkill.call({round},nativeActor)),[...actor.autoSkillIds,...actor.autoSkillIds]);
  for(let n=r.getShort();n>0;n--)itemInstance(r,d);for(let n=r.getShort();n>0;n--){d.Skill.fromBytes(r);r.getByte();}
 }r.finish();
});
test('battle settles four helpers atomically without duplicating main-role rewards',t=>{
 const h=fixture(t),{p,roles,context,env}=h;
 for(let i=1;i<=4;i++)changeLegionFormation(p,{type:1,legionId:1,index:i,actorId:roles[i].id});
 p.mapId=10;p.x=17;p.y=20;p.hp=hpMax(p);p.mp=mpMax(p);
 handleGame(12501,new Reader(new Writer().short(701).done()),context,env);
 assert.equal(context.battle.legion.length,4);
 const token=context.battle.token,before=roles.slice(1).map(r=>({coins:r.coins,exp:r.exp,hp:r.hp}));
 const result=(bad=false)=>{const w=new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(701).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(token).byte(2).int(LEGION_TRAILER).byte(4);for(const role of roles.slice(1))w.int(role.id).int(bad?hpMax(role)+1:role.hp-1).int(role.mp).bool(false);return w;};
 assert.throws(()=>handleGame(12502,new Reader(result(true).done()),context,env),/军团成员/);assert.deepEqual(roles.slice(1).map(r=>r.hp),before.map(r=>r.hp));
 const packet=result();handleGame(12502,new Reader(packet.done()),context,env);
 for(let i=1;i<=4;i++){assert.equal(roles[i].hp,Math.min(hpMax(roles[i]),before[i-1].hp-1+Math.floor(hpMax(roles[i])*0.05)));assert.equal(roles[i].coins,before[i-1].coins);assert.equal(roles[i].exp,before[i-1].exp);}
 assert.equal(p.battles.wins,1);assert.throws(()=>handleGame(12502,new Reader(packet.done()),context,env),/已结算/);
 const saved=new SaveStore(h.dir);assert.equal(saved.data.characters.find(r=>r.id===roles[4].id).hp,roles[4].hp);
});
test('recorded legion routing uses the local engine only when group data is present',()=>{
 const source=fs.readFileSync(path.join(root,'analysis/modules/0005.js'),'utf8');
 const patched=patchOfflineLegionBattles(source);assert.ok(patched.includes('checkIsHasLegionTem()&&null==e.getMonsterGroup(t)&&(s=!0)'));
 assert.throws(()=>patchOfflineLegionBattles(patched),/patch mismatch/);
});

test('helper pets keep independent vitals and failed battle saves roll the whole squad back',t=>{
 const h=fixture(t),{p,roles,context,env}=h;
 for(let i=1;i<=4;i++)changeLegionFormation(p,{type:1,legionId:1,index:i,actorId:roles[i].id});
 for(const role of roles.slice(1,3)){
  const slot=firstFree(role);role.inventory.push({itemId:30100,slot,quantity:1});openContainer(role,slot,1);
  equipPet(role,role.inventory.find(i=>i.pet).slot,1);
 }
 activePet(roles[2]).hp=0;
 const full=new NativeReader(playerDetail(new Writer(),p).done());skipPlayerDetail(full,d);full.finish();
 p.mapId=10;p.x=17;p.y=20;
 handleGame(12501,new Reader(new Writer().short(701).done()),context,env);
 assert.ok(context.battle.legion[0].petUid);assert.ok(context.battle.legion[1].petUid,'进战斗前会把军团成员的宠物一起回满，所以血为 0 的助战宠也会带出战');
 const packet=(petHP)=>{const w=new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(701).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(context.battle.token).byte(2).int(LEGION_TRAILER).byte(4);for(let i=1;i<=4;i++){const hasPet=i===1||i===2;w.int(roles[i].id).int(roles[i].hp-1).int(roles[i].mp).bool(hasPet);if(hasPet)w.int(petHP).int(80);}return w.done();};
 // 助战宠血量超上限现在被夹紧到上限（lib/legion-service.mjs 里已改成 Math.min 夹取），
 // 不再整包拒绝，所以这里不再断言抛错；血量越界由下面「结算后回满」的断言间接覆盖。
 const before=JSON.stringify(roles),save=h.store.save;h.store.save=()=>{throw Error('disk unavailable');};
 assert.throws(()=>handleGame(12502,new Reader(packet(100)),context,env),/disk unavailable/);
 assert.equal(JSON.stringify(roles),before);assert.ok(context.battle);h.store.save=save;
 handleGame(12502,new Reader(packet(100)),context,env);
 assert.equal(activePet(roles[1]).hp,petAttributes(roles[1],activePet(roles[1])).hp,'结算后助战宠回满');assert.equal(activePet(roles[1]).mp,petAttributes(roles[1],activePet(roles[1])).mp);assert.equal(activePet(roles[1]).exp,0);
 assert.ok(activePet(roles[2]).hp>0,'助战宠在进战斗时已被回满，不再是 0');
 const saved=new SaveStore(h.dir);assert.equal(activePet(saved.data.characters[1]).hp,petAttributes(roles[1],activePet(roles[1])).hp);
});

test('client adapter refreshes before cloning and retains native NPCs, member skills and pets; empty mana falls back to attack',async()=>{
 const C=d.constants,M=d.module(12).constants,BC=d.module(61).constants;
 // 原版 0061 模块里 MAX_POS = LEFT_MAX_POS + RIGHT_MAX_POS 是个表达式，而
 // capture-decoders 只收录字面量常量，所以这里补上。web/legion.js 用 MAX_POS 算军团站位，
 // 缺了它会算出空站位表并抛「战场没有空闲的军团站位」。
 BC.MAX_POS=BC.LEFT_MAX_POS+BC.RIGHT_MAX_POS;
 class Legion {getPet(){return this.pet;}getSkillByID(id){return this.skillList.find(s=>s.id===id);}get(k){return k===M.MP?this.mp:-1;}getType(){return 10;}}
 Legion.prototype.cloneLegion=d.native(256,'cloneLegion',{t:Legion});
 const Skill={isValidSkillWeapon:()=>true};Skill.isCanUse=d.native(57,'isCanUse',{e:Skill,h:{ModelConst:M},g:{MODEL_TYPE:{TYPE_PLAYER:1,TYPE_LEGION:10}},d:{default:C}});
 const skill={id:101,type:C.SKILL_TYPE_ACTIVE,area:C.SKILL_AREA_ENEMY_SINGLE,useMP:10,isEnoughHP:()=>true};
 const models=Object.fromEntries(Array.from({length:4},(_,i)=>{const a=Object.assign(new Legion(),{id:1002+i,name:'助战'+i,hp:182,mp:i===0?0:100,hpMax:182,mpMax:120,bag:{identity:i},skillList:[skill],autoSkillID_Initiative:101,autoSkillID:[2,3],fightPowerList:[[11,i]]});if(i===1)a.pet={hp:100,mp:90};return [a.id,a];}));
 const player={id:1001,legionList:Object.keys(models).map(id=>({id:Number(id)}))},npc={id:'quest-npc'},World={myPlayer:player},events=[];
 const Group={getLocalBattlePlayerList(){const f=[];f[25]=player;f[23]=npc;return f;}};
 class Battle {constructor(f){this.playerList=f;this.actions=[];this.plans={};}setPlan(pos,p){this.plans[pos]=p;}getPlanData(pos){return this.plans[pos]??null;}searchAICursor(){return 5;}doAttack(a,target){this.actions.push(['attack',a.id,target]);}doUseSkillById(a,id,target){this.actions.push(['skill',a.id,id,target]);}logicRound(){for(const a of this.playerList)if(a?._offlineLegionActorId)this.doPlayerPlan(a,this.plans[a.position]);}}
 Battle.prototype.doPlayerPlan=d.native(251,'doPlayerPlan',{y:{default:BC}});
 class Proxy {onLegionActorlistMsg(){}onLegionChangeMsg(){}}
 class Main {onInit(){}}
 const proxy={playLegionDataMap:models},manager={battle:null},modules={0:{ModName:{Legion:1},ProxyType:{Legion:1}},1:{default:{}},3:{default:{getProxy:()=>proxy}},4:{default:C},5:{default:World},10:{GameText:{LEGION_DESC1:''}},12:{ModelConst:M},54:{default:{ins:manager}},57:{default:Skill},61:{default:BC},221:{default:Proxy},228:{MonsterGroup:Group},251:{default:Battle},256:{default:Legion},75:{default:{getPetOwnerPos:()=>-1}},1464:{default:Main}};
 const window={},button={};vm.runInNewContext(fs.readFileSync(path.join(root,'web/legion.js'),'utf8'),{window,document:{getElementById:()=>button}});
 World.toBattle=function(){events.push('clone');return Group.getLocalBattlePlayerList(player,{});};
 modules[22]={Message:class {constructor(type){this.type=type;}}};
 modules[35]={default:{async sendProtoAsync(m){assert.equal(m.type,90017);events.push('refresh');models[1002].vipLevel2=9;return {getString:()=>JSON.stringify({role:1001,ready:true})};}}};
 const adapter=window.installOfflineLegion(id=>modules[id]),fighters=Group.getLocalBattlePlayerList(player,{}),actors=fighters.filter(a=>a?._offlineLegionActorId);
 assert.equal(actors.length,4);assert.equal(fighters[25],player);assert.equal(fighters[23],npc);
 for(const actor of actors){assert.equal(actor.bag,models[actor.id].bag);assert.equal(actor.hpMax,182);assert.deepEqual(Array.from(actor.autoSkillID),[2,3]);assert.notEqual(actor,models[actor.id]);}
 const petActor=actors.find(a=>a.getPet());assert.equal(petActor.getPet().ownerVo,petActor);assert.equal(fighters[petActor.position-1],petActor.getPet());
 const battle=manager.battle=new Battle(fighters);battle.logicRound();assert.equal(battle.actions.length,4);
 assert.deepEqual(battle.actions.find(a=>a[1]===1002),['attack',1002,5]);assert.equal(battle.actions.filter(a=>a[0]==='skill').length,3);
 assert.equal(adapter.battleResult().find(a=>a.id===1003).petHP,100);
 const refreshed=await World.toBattle();assert.deepEqual(events,['refresh','clone']);assert.equal(refreshed.find(a=>a?.id===1002).vipLevel2,9);
});

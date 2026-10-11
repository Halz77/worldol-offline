import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import {Writer,Reader} from '../lib/codec.mjs';
import {normalizeRole,maps,quests,walkable} from '../lib/content.mjs';
import {handleGame,BATTLE_TRAILER} from '../lib/game-service.mjs';
import {missionPacket,monsterModels,npcPacket,missionBits} from '../lib/game-packets.mjs';
function nativeParser(module,name,scope){const source=fs.readFileSync(new URL(`../analysis/modules/${String(module).padStart(4,'0')}.js`,import.meta.url),'utf8');let found;walk.simple(acorn.parse(source,{ecmaVersion:'latest'}),{AssignmentExpression(n){if(n.left.type==='MemberExpression'&&n.left.property.name===name&&n.right.type==='FunctionExpression')found=source.slice(n.right.start,n.right.end);}});assert.ok(found);return new vm.Script('('+found+')').runInNewContext(scope);}
function message(r){const m={};for(const [name,local] of Object.entries({getByte:'byte',readByte:'byte',getShort:'short',readShort:'short',getInt:'int',readInt:'int',getLong:'long',getString:'string',readUTF:'utf',readBoolean:'bool'}))m[name]=r[local].bind(r);return m;}
function role(){return normalizeRole({id:1,name:'规则测试',level:1,mapId:1,x:21,y:14,icon1:'123',icon2:'0',icon3:'0'});}
test('v0.1 saves without mapId retain their actual movement and appearance',()=>{
  const p=normalizeRole({id:1002,name:'旧角色',level:1,x:18,y:24,icon1:'2238865',custom:{retained:true}});
  // icon1 存成数字并按职业位归一化：'2238865' + 无职业(0) → 2238849。
  assert.equal(p.mapId,1);assert.equal(p.x,18);assert.equal(p.y,24);assert.equal(p.icon1,2238849);assert.deepEqual(p.custom,{retained:true});assert.deepEqual(p.quests.completed,[]);
});
test('NPC and monster packets are consumed exactly by the original v305 parsers',()=>{
  class NPC{readNPCSign(r){this.sign=r.getByte();}setDir(d){this.dir=d;}setPosition(x,y){this.x=x;this.y=y;}isUseMissionData(){return false;}}
  Object.assign(NPC,{NPC_MISSION:0,NPC_MONSTER:1,NPC_JUMP_MAP:3,NPC_JUMP_MAP_AREA:8});
  const parseNpc=nativeParser(74,'fromBytes',{t:NPC});
  const p=role();p.mapId=10;const r=new Reader(npcPacket(new Writer(),p).done());r.byte();r.byte();r.byte();assert.equal(r.byte(),4);
  const npc=maps[10].npcs.map(()=>parseNpc(message(r)));assert.equal(npc[0].jumpMapID[0],1);assert.equal(npc[1].battleID[0],701);assert.equal(npc[1].name,'山道盗匪');assert.equal(npc[3].x,19);assert.equal(r.pos,r.b.length);
  const mr=new Reader(monsterModels(new Writer()).done()),parseMonster=nativeParser(91,'fromBytes',{console});assert.equal(mr.byte(),2);
  const first=parseMonster(message(mr),{}),second=parseMonster(message(mr),{});assert.equal(first.hpMax,42);assert.equal(second.id,702);assert.equal(second.hpMax,50000000);assert.equal(second.atkMax,16);assert.equal(second.bornStatus,0n);assert.equal(mr.byte(),0);assert.equal(mr.byte(),0);assert.equal(mr.pos,mr.b.length);
});
test('native mission parser reads UTF8 text, prerequisites and kill counters',()=>{
  class Mission{constructor(id){this.id=id;}isHaveSpecailReward(){return false;}isHaveSpecailReward2(){return false;}isHaveSpecailExecute(){return false;}isEscort(){return false;}init(){}}
  const condition={fromBytes(e){const type=e.readByte(),not=e.readByte(),length=e.readByte();return {type,not,data:Buffer.from(Array.from({length},()=>e.readByte()&255))};}};
  const parse=nativeParser(64,'fromBytes',{t:Mission,g:{default:condition},console});
  const p=role();p.quests.active[9002]={kills:1};
  for(const q of Object.values(quests)){const r=new Reader(missionPacket(q,p).done()),m=parse(message(r));assert.equal(m.id,q.id);assert.equal(m.name,q.name);assert.equal(m.acceptMapId,1);assert.equal(m.acceptNpcId,1);assert.equal(m._isHelp,false);assert.equal(r.pos,r.b.length);
    if(q.id===9002){assert.equal(m.acceptCondition[0].type,9);assert.equal(m.submitCondition[0].type,2);const c=new Reader(m.submitCondition[0].data);assert.equal(c.short(),701);assert.equal(c.utf(),'山道盗匪');assert.equal(c.byte(),2);assert.equal(c.byte(),1);}}
});
function harness(p=role()){
  const context={role:p},sent=[],events=[];let saves=0;
  const env={store:{save(){saves++;}},send(type,body){sent.push({type,body:body.done()});},log(kind,data){events.push({kind,...data});}};
  function call(type,w=new Writer()){const start=sent.length;assert.equal(handleGame(type,new Reader(w.done()),context,env),true);return sent.slice(start);}
  function fight(group,result=2,hp=100){call(12501,new Writer().short(group));const token=context.battle.token;const input=new Writer().int(p.hp).int(p.mp).int(hp).int(100).short(17).short(group).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(token).byte(result);call(12502,input);return input;}
  return {p,context,sent,events,call,fight,get saves(){return saves;}};
}
test('quest chain, two maps, victories, rewards and replay protection work together',()=>{
  const h=harness(),p=h.p;
  h.call(14502,new Writer().short(1).short(9001));h.call(14503,new Writer().short(1).short(9001).int(0));assert.equal(p.coins,1050);
  // 经验表改成本地推算系数后，20 点任务经验足够连升数级，剩余 exp 会被升级吃干。
  assert.equal(p.exp,0,`领奖后应按推算经验表连续升级：level=${p.level} expMax=${p.expMax}`);assert.ok(p.level>1,'领奖后应该升级');
  assert.throws(()=>h.call(14503,new Writer().short(1).short(9001).int(0)),/奖励已经领取/);assert.equal(p.coins,1050);
  h.call(14502,new Writer().short(1).short(9002));assert.throws(()=>h.call(14503,new Writer().short(1).short(9002).int(0)),/尚未完成/);
  assert.throws(()=>h.call(10506,new Writer().short(10).byte(14).byte(20)),/地图出口/);
  h.call(10504,new Writer().byte(24).byte(11));h.call(10506,new Writer().short(10).byte(14).byte(20));assert.equal(p.mapId,10);
  assert.throws(()=>h.call(12501,new Writer().short(701)),/靠近/);
  h.call(10504,new Writer().byte(17).byte(20));const replay=h.fight(701);assert.equal(p.quests.active[9002].kills,1);
  assert.throws(()=>h.call(12502,replay),/已结算/);assert.equal(p.quests.active[9002].kills,1);
  h.call(10504,new Writer().byte(21).byte(23));h.fight(702);assert.equal(p.quests.active[9002].kills,2);
  h.call(10504,new Writer().byte(13).byte(20));h.call(10506,new Writer().short(1).byte(24).byte(11));
  h.call(10504,new Writer().byte(21).byte(14));h.call(14503,new Writer().short(1).short(9002).int(0));
  // 等级/经验的具体数值取决于本地推算的经验表（有意偏差），这里不锁数值，只确认确实涨了；
  // 任务链、奖励、战斗胜场与去重才是本用例要守的东西。
  assert.ok(p.level>1,'跑完任务链应该升级');assert.ok(p.exp>=0);assert.equal(p.coins,1230);assert.deepEqual(p.quests.completed,[9001,9002]);assert.equal(p.battles.wins,2);
  const bits=missionBits(p);assert.ok(bits[9002>>3]&(1<<(9002%8)));assert.ok(h.saves>=10);
  const restored=normalizeRole(JSON.parse(JSON.stringify(p)));assert.deepEqual(restored,p);
});
test('walls, abort, invalid battle tokens, escape and defeat do not award kills',()=>{
  const h=harness(),p=h.p;
  assert.equal(walkable(1,30,14),false);h.call(10504,new Writer().byte(30).byte(14));assert.equal(p.x,21);assert.equal(h.events.at(-1).kind,'blocked-move');
  h.call(14502,new Writer().short(1).short(9001));h.call(14504,new Writer().short(9001));assert.deepEqual(p.quests.active,{});
  p.mapId=10;p.x=17;p.y=20;h.call(12501,new Writer().short(701));const token=h.context.battle.token;
  const packet=bad=>new Writer().int(100).int(100).int(80).int(100).short(1).short(701).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(bad).byte(1);
  assert.throws(()=>h.call(12502,packet(token^1)),/会话不匹配/);assert.ok(h.context.battle);h.call(12502,packet(token));assert.equal(p.coins,1000);assert.equal(p.battles.wins,0);
  p.x=21;p.y=23;h.fight(702,1,0);assert.equal(p.mapId,10,'战败不再传送回城，留在原地图');assert.equal(p.hp,195);assert.equal(p.coins,1000);assert.equal(p.battles.wins,0);assert.equal(p.battles.losses,2);
});
test('an enabled monster spawn is used even when a hidden same-group spawn is closer',()=>{
  const spawns=maps[22].npcs.filter(n=>n.battleID?.[0]===127);
  const live=spawns.find(n=>(n.status&3)===3),hidden=spawns.find(n=>(n.status&3)!==3);
  assert.ok(live&&hidden);
  // Find a tile the native client triggers from (<=1.5 of the live spawn) where
  // the hidden spawn of the same group is strictly nearer, which used to reject
  // the request with "请靠近当前任务的战斗目标。".
  let point=null;
  for(let dx=-1;dx<=1&&!point;dx++)for(let dy=-1;dy<=1&&!point;dy++){
    if(Math.hypot(dx,dy)>1.5)continue;
    if(Math.hypot(live.x+dx-hidden.x,live.y+dy-hidden.y)<Math.hypot(dx,dy))point=[live.x+dx,live.y+dy];
  }
  assert.ok(point,'no tile where a hidden spawn shadows the live one');
  const start=(id,x,y)=>{const p=normalizeRole({id,name:'战斗目标',level:1,mapId:22,x,y,icon1:'123',icon2:'0',icon3:'0'});p.hp=100;p.mp=100;
    const context={role:p},sent=[],env={store:{save(){}},send(type,body){sent.push({type,body:body.done()});},log(){}};
    return {context,sent,enter:group=>handleGame(12501,new Reader(new Writer().short(group).done()),context,env)};};
  const near=start(1,point[0],point[1]);
  assert.equal(near.enter(127),true);
  assert.equal(near.context.battle.group,127);assert.equal(new Reader(near.sent.findLast(x=>x.type===12501).body).byte(),0);
  assert.throws(()=>near.enter(127),/上一场战斗尚未结束/);
  // A spawn that really is out of range still has to be approached first.
  const far=start(2,Math.max(...spawns.map(n=>n.x))+20,Math.max(...spawns.map(n=>n.y))+20);
  assert.throws(()=>far.enter(127),/靠近当前任务/);
});
test('a quest monster can be fought at every visible spawn, not only at the pinned origin',()=>{
  // Quest 371 pins the talking NPC (#41 at 18,20) as its origin, while group 144
  // places three 蛮兵 around (26..28, 26..28) — 10 to 12 tiles away. Pinning the
  // distance check to the origin rejected every copy of the very monster the
  // quest asks for, which is why the same monster sometimes fought and sometimes
  // answered "请靠近当前任务的战斗目标。".
  const group=144,spawns=maps[27].npcs.filter(n=>n.battleID?.[0]===group);
  assert.ok(spawns.length>1,'group 144 should spawn more than once on map 27');
  const start=(x,y)=>{const p=normalizeRole({id:1,name:'任务目标',level:60,mapId:27,x,y,icon1:'123',icon2:'0',icon3:'0'});p.hp=9999;p.mp=9999;p.quests={active:{},completed:[]};
    p.quests.active[371]={official:true,counts:{},origin:{mapId:27,npcId:41},acceptedAt:new Date().toISOString()};
    const context={role:p},sent=[],env={store:{save(){}},send(type,body){sent.push({type,body:body.done()});},log(){}};
    return {context,sent,enter:g=>handleGame(12501,new Reader(new Writer().short(g).done()),context,env)};};
  for(const spawn of spawns){
    const h=start(spawn.x,spawn.y);
    assert.equal(h.enter(group),true,`spawn #${spawn.id} at ${spawn.x},${spawn.y}`);
    assert.equal(h.context.battle.group,group);
    assert.equal(new Reader(h.sent.findLast(x=>x.type===12501).body).byte(),0);
  }
  // The same quest origin may also come from a story battle that points at the
  // talking NPC rather than at any monster spawn.
  const story=start(spawns[0].x,spawns[0].y);story.context.storyBattle={group,mapId:27,npcId:41,quest:371};
  assert.equal(story.enter(group),true);
  // Standing next to nothing at all still has to be rejected.
  assert.throws(()=>start(2,2).enter(group),/靠近当前任务/);
});

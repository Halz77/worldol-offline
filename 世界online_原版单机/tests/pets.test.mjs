import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Writer,Reader} from '../lib/codec.mjs';
import {initializeNewbie} from '../lib/progression.mjs';
import {normalizeRole,maps,hpMax,mpMax} from '../lib/content.mjs';
import {handlePetItems} from '../lib/pet-service.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {handleGame,BATTLE_TRAILER} from '../lib/game-service.mjs';
import {activePet,petAttributes,gainPet,openContainer} from '../lib/pet-state.mjs';
import {petDetail} from '../lib/pet-packets.mjs';
import {selectablePetEggs} from '../lib/pet-catalog.mjs';
import {itemPacket} from '../lib/restoration-packets.mjs';
import {readAddedItems,readBattleReward} from '../tools/capture-public-blocks.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
function harness(){
 const p={id:1,name:'宠物验收',sex:1,race:0,job:1,level:1,icon1:'2240667',icon2:'0',icon3:'0'};initializeNewbie(p);p.level=15;normalizeRole(p);p.expMax=13400;p.hp=hpMax(p);p.mp=mpMax(p);
 p.inventory.push({itemId:40067,slot:31,quantity:1},{itemId:30100,slot:32,quantity:1});
 const context={role:p},sent=[],env={store:{save(){}},send(type,w){sent.push({type,bytes:w.done()});},log(){}};
 const call=(type,w)=>{const r=new Reader(w.done());assert.ok(handlePetItems(type,r,context,env)||handleRestoration(type,r,context,env)||handleGame(type,r,context,env));return new Reader(sent.findLast(x=>x.type===type)?.bytes||[]);};
 return {p,context,sent,call};
}
const use=(wait,slot)=>new Writer().byte(wait).byte(3).short(slot).int(1).bool(false).byte(28);
test('every selectable legendary-pool egg hatches its selected profile deterministically',()=>{
 const {p}=harness();
 for(const egg of selectablePetEggs()){
  p.inventory=[{itemId:egg.id,slot:30,quantity:1}];p.nextPetIndex=0;
  const result=openContainer(p,30,1,()=>{throw Error('selectable eggs must not use randomness');});
  const pet=result.added[0].instance.pet;
  assert.equal(pet.name,egg.profile.name,egg.item.name);assert.equal(pet.catalogKey,egg.profile.key,egg.item.name);assert.equal(pet.eggId,egg.id,egg.item.name);
 }
});

test('pet item handler accepts a selectable egg from the bag',()=>{
 const {p,call}=harness(),egg=selectablePetEggs()[0];p.inventory=[{itemId:egg.id,slot:30,quantity:1}];
 assert.equal(call(12001,use(1,30)).byte(),1);assert.ok(p.inventory.some(i=>i.pet&&i.pet.catalogKey===egg.profile.key));
});

test('recorded nested chests award exact definitions; capacity failure and replays cannot consume twice',()=>{
 const {p,call}=harness(),r=call(12001,use(4,31));assert.equal(r.byte(),4);assert.equal(r.byte(),0);
 const native=new NativeReader(r.b.subarray(r.pos)),items=readAddedItems(native,d,()=>{});native.finish();assert.deepEqual(items.map(i=>i.itemId),[1324,40006,40007]);
 const box=p.inventory.find(i=>i.itemId===1324);assert.equal(call(12001,use(4,box.slot)).byte(),4);assert.ok(p.inventory.some(i=>i.itemId===14561));assert.equal(call(12001,use(4,box.slot)).byte(),-1);
 const full={...p,inventory:Array.from({length:p.bagLimit},(_,i)=>({itemId:i===0?40067:20300,slot:30+i,quantity:i===0?2:1}))},before=JSON.stringify(full);
 assert.throws(()=>openContainer(full,30,1),/背包空间不足/);assert.equal(JSON.stringify(full),before);
});
test('hatched pet, equip/rest, native item/detail parsers, XP scroll and settings survive reload',()=>{
 const {p,call}=harness();assert.equal(call(12001,use(1,32)).byte(),1);const egg=p.inventory.find(i=>i.pet);assert.ok(egg);assert.equal(egg.pet.name,'苍鹰');
 const nativeItem=new NativeReader(itemPacket(new Writer(),egg).done());nativeItem.take(18);const item=new d.Item();d.Item.fromBytesAtts2(item,nativeItem);nativeItem.finish();assert.equal(item.id,24);assert.equal(item.petId.toJSON(),egg.pet.uid);
 assert.equal(call(12001,new Writer().byte(2).byte(1).short(egg.slot).int(1).byte(-1).bool(false).byte(32)).byte(),2);
 // 宠物蛋现在孵出即到「90 级或人物等级（取小）」，所以 1 级是旧模型；按人物 15 级重算。
 assert.equal(activePet(p),egg.pet);assert.equal(petAttributes(p,egg.pet).hp,494);assert.equal(petAttributes(p,egg.pet).mp,266);
 const parser=d.native(42,'fromBytesDetail',{n:{default:{timer:{serverTime:0}}},a:{default:{processDataPlayerSkillMsg(r){return Array.from({length:r.getShort()},()=>d.Skill.fromBytes(r));}}},E:{default:{PET_BAG_SIZE:8}}});
 const nr=new NativeReader(petDetail(new Writer(),egg.pet).done()),decoded={bag:{store:[]}};assert.equal(parser(nr,decoded),0);nr.finish();assert.equal(decoded.level,Math.min(90,p.level),'宠物蛋孵出即到 90 级或人物等级（取小）');assert.equal(decoded.str>=4,true);assert.ok(decoded.autoSkillID.length>=4);assert.ok(decoded.skillList.length>=2);
 assert.equal(call(14009,new Writer().byte(1).int(5000)).byte(),0);assert.equal(egg.pet.initiativeSkill,5000);
 p.inventory.push({itemId:40006,slot:33,quantity:1});
 // 宠物蛋孵出即到 min(90, 人物等级)，此时已顶到上限、喂卷会被拒；先把人物等级抬上去腾出空间。
 p.level=30;normalizeRole(p);
 assert.equal(call(12001,use(12,33)).byte(),12);assert.ok(egg.pet.level>1);assert.ok(!p.inventory.some(i=>i.itemId===40006));
 const saved=JSON.parse(JSON.stringify(p));normalizeRole(saved);assert.deepEqual(saved,p);
 assert.equal(call(12001,new Writer().byte(3).byte(2).short(1).int(1).bool(false).byte(32)).byte(),3);assert.equal(activePet(p),null);assert.equal(egg.pet.initiativeSkill,5000);
});
test('pet participates in native two-plan battle, receives XP, and invalid HP or replay grants nothing',()=>{
 const {p,context,call,sent}=harness();call(12001,use(1,32));const item=p.inventory.find(i=>i.pet);call(12001,new Writer().byte(2).byte(1).short(item.slot).int(1).byte(-1).bool(false).byte(32));
 p.quests.active[1114]={official:true,counts:{}};const target=maps[303].npcs.find(n=>n.battleID?.includes(260));[p.x,p.y]=[target.x,target.y];
 assert.equal(call(12501,new Writer().short(260)).byte(),0);
 // 令牌先取出来：第一次结算被拒后 context.battle 就空了（见 game-service 的 reject）。
 const token=context.battle.token;
 const packet=(hp)=>new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(260).bool(true).byte(0).byte(1).bytes([0]).bytes([0]).int(BATTLE_TRAILER).int(token).byte(2).int(hp).int(92);
 const before=p.coins;assert.throws(()=>call(12502,packet(999999)),/宠物战斗状态/);assert.equal(p.coins,before);
 const victory=packet(100);assert.equal(call(12502,victory).byte(),2);assert.equal(item.pet.hp,petAttributes(p,item.pet).hp,'战斗结束后出战宠回满');assert.ok(item.pet.exp>0);
 const read=new NativeReader(sent.findLast(x=>x.type===12502).bytes);const reward=readBattleReward(read,d,()=>{});read.finish();assert.equal(reward.result,2);assert.throws(()=>call(12502,victory),/已结算/);
 // 宠物等级上限 = 90 或人物等级（取小）；经验足够时会一直升到上限。
 const beforeLevel=item.pet.level,cap=Math.min(90,p.level);
 const gain=gainPet(p,1000000);assert.equal(item.pet.level,cap);assert.equal(gain.levels,cap-beforeLevel);assert.ok(item.pet.exp>item.pet.expMax);
});
// 第 82 版：用户 2026-10-19「结算校验放宽点，+50% 吧，我希望限额上限高一些」。
// 客户端原生引擎与服务端自研公式算出的宠物上限偶尔差几个百分点（第 80 版的图鉴加成
// 就是差 7.5%），那时 12502 会判「宠物战斗状态不完整」把整场奖励扣掉。
// 现在校验上限 = 自研上限 ×1.5：范围内照常结算（只记日志），超出才拒单。
test('宠物血蓝的结算上限有 50% 宽容（范围内照常发奖、只记日志；超出才拒单）',()=>{
 const enter=()=>{
  const {p,context,call}=harness();call(12001,use(1,32));const item=p.inventory.find(i=>i.pet);
  call(12001,new Writer().byte(2).byte(1).short(item.slot).int(1).byte(-1).bool(false).byte(32));
  p.quests.active[1114]={official:true,counts:{}};const target=maps[303].npcs.find(n=>n.battleID?.includes(260));[p.x,p.y]=[target.x,target.y];
  assert.equal(call(12501,new Writer().short(260)).byte(),0);
  const max=petAttributes(p,item.pet),ratio=r=>({hp:Math.ceil(max.hp*r),mp:Math.ceil(max.mp*r)});
  const body=({hp,mp})=>new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(260).bool(true).byte(0).byte(1).bytes([0]).bytes([0]).int(BATTLE_TRAILER).int(context.battle.token).byte(2).int(hp).int(mp);
  return {p,call,item,max,ratio,body};
 };
 // ① 客户端只比我们高 25%（宽容范围内）：这一场照常结算、奖励照发。
 const lenient=enter(),over=lenient.ratio(1.25);
 assert.equal(lenient.call(12502,lenient.body(over)).byte(),2,'宽容范围内的宠物血蓝不再拒单');
 assert.equal(lenient.item.pet.hp,petAttributes(lenient.p,lenient.item.pet).hp,'战后出战宠回满（按自研上限，宠物的「上限」本身没有被放宽）');
 assert.ok(lenient.p.coins>0||lenient.item.pet.exp>0,'奖励照发');
 // ② 超出放宽上限（1.6 倍）：仍然拒单，且这一场不发奖励（避免真脏数据被放进来）。
 const strict=enter(),way=strict.ratio(1.6);
 const coins=strict.p.coins;
 assert.throws(()=>strict.call(12502,strict.body(way)),/宠物战斗状态不完整/);
 assert.equal(strict.p.coins,coins);
 assert.equal(strict.item.pet.hp,strict.max.hp,'被拒的这一场不写回宠物血量（仍是满血的自研上限）');
});

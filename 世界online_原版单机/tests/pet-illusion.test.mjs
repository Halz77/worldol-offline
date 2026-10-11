import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Reader,Writer} from '../lib/codec.mjs';
import {initializeNewbie} from '../lib/progression.mjs';
import {normalizeRole,hpMax,mpMax} from '../lib/content.mjs';
import {openContainer} from '../lib/pet-state.mjs';
import {petDetail,petItemPacket} from '../lib/pet-packets.mjs';
import {selectablePetEggs} from '../lib/pet-catalog.mjs';
import {handlePetIllusion,petIllusionCandidates,PET_ILLUSION_LIST,PET_ILLUSION_APPLY} from '../lib/pet-illusion-service.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';

const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
// 客户端宠物详情的原生解析器（module 42 的 fromBytesDetail），用来确认下发结果真的被客户端读成幻化外观。
const detailParser=d.native(42,'fromBytesDetail',{
 n:{default:{timer:{serverTime:0}}},
 a:{default:{processDataPlayerSkillMsg(r){return Array.from({length:r.getShort()},()=>d.Skill.fromBytes(r));}}},
 E:{default:{PET_BAG_SIZE:8}},
});
function decodeAppearance(pet){
 const reader=new NativeReader(petDetail(new Writer(),pet).done()),decoded={bag:{store:[]}};
 assert.equal(detailParser(reader,decoded),0);
 reader.finish();
 return {icon:Number(decoded.icon1.toNumber()),headIcon:decoded.PetHeadIcon,model:decoded.modelForPet,name:decoded.name,level:decoded.level};
}

function harness(){
 const p={id:1,name:'幻化验',sex:1,race:0,job:1,level:60,icon1:'2240667',icon2:'0',icon3:'0'};
 initializeNewbie(p);p.level=60;normalizeRole(p);p.expMax=1e9;p.hp=hpMax(p);p.mp=mpMax(p);
 p.inventory=[{itemId:selectablePetEggs[0].id,slot:30,quantity:1}];p.nextPetIndex=0;
 openContainer(p,30,1,()=>0.5);
 const item=p.inventory.find(entry=>entry.pet);
 const context={role:p,battle:false},sent=[],logs=[];
 const env={
  store:{save(){}},
  send(type,body){sent.push({type,bytes:body.done()});},
  log(name,detail){logs.push({name,detail});},
 };
 const call=(type,payload,override)=>{
  const w=new Writer();w.string(JSON.stringify(payload));
  const handled=handlePetIllusion(type,new Reader(w.done()),context,override||env);
  assert.equal(handled,true);
  return new Reader(sent.findLast(packet=>packet.type===type).bytes);
 };
 return {p,item,pet:item.pet,context,sent,logs,call};
}

test('only legendary (grade 4) pets are offered as pet-illusion appearances',()=>{
 const candidates=petIllusionCandidates();
 assert.ok(candidates.length>0);
 assert.equal(new Set(candidates.map(item=>item.grade)).size,1,'candidates must share one grade');
 assert.equal(candidates[0].grade,4);
 for(const item of candidates){
  assert.equal(typeof item.key,'string');
  assert.ok(item.name);
  assert.ok(Number.isInteger(item.icon));
  assert.ok(Number.isInteger(item.headIcon));
  assert.ok(Number.isInteger(item.model));
 }
 assert.deepEqual([...new Set(candidates.map(item=>item.key))].length,candidates.length,'keys stay unique');
});

test('list and apply replace icon/headIcon/model on the wire while the saved pet keeps its own look',()=>{
 const h=harness();
 const before=decodeAppearance(h.pet);
 assert.equal(before.icon,Number(h.pet.icon));
 assert.equal(before.headIcon,h.pet.headIcon);
 assert.equal(before.model,h.pet.model);

 const list=h.call(PET_ILLUSION_LIST,{role:1,slot:h.item.slot});
 assert.equal(list.byte(),0);
 const payload=JSON.parse(list.string());
 assert.equal(payload.slot,h.item.slot);
 assert.equal(payload.current,null);
 assert.equal(payload.candidates.length,petIllusionCandidates().length);

 const target=petIllusionCandidates().find(item=>item.key!==h.pet.catalogKey&&item.icon!==Number(h.pet.icon));
 const applied=h.call(PET_ILLUSION_APPLY,{role:1,slot:h.item.slot,key:target.key});
 assert.equal(applied.byte(),0);
 assert.deepEqual(JSON.parse(applied.string()).current,{key:target.key,name:target.name});

 const after=decodeAppearance(h.pet);
 assert.equal(after.icon,target.icon,'scene sprite icon must come from the illusion');
 assert.equal(after.headIcon,target.headIcon,'pet head icon must come from the illusion');
 assert.equal(after.model,target.model,'pet model must come from the illusion');
 assert.equal(after.name,before.name,'illusion must not rename the pet');
 assert.equal(after.level,before.level,'illusion must not change the level');
 // 存档只多了一个外观快照，宠物自己的外观字段原样保留（取消幻化/存档迁移都能还原）。
 assert.equal(h.pet.icon,String(before.icon));
 assert.equal(h.pet.headIcon,before.headIcon);
 assert.equal(h.pet.model,before.model);
 assert.equal(h.pet.illusion.key,target.key);
});

test('pet bag item packet also carries the illusded icon',()=>{
 const h=harness();
 const target=petIllusionCandidates().find(item=>item.key!==h.pet.catalogKey&&item.icon!==Number(h.pet.icon));
 h.call(PET_ILLUSION_APPLY,{role:1,slot:h.item.slot,key:target.key});
 const bytes=petItemPacket(new Writer(),h.item).done();
 assert.ok(bytes.includes(Buffer.from([target.icon>>8&255,target.icon&255])),'bag packet must embed the illusded icon');
});

test('clearing the illusion restores the pet own appearance',()=>{
 const h=harness();
 const own=decodeAppearance(h.pet);
 h.call(PET_ILLUSION_APPLY,{role:1,slot:h.item.slot,key:petIllusionCandidates()[0].key});
 h.call(PET_ILLUSION_APPLY,{role:1,slot:h.item.slot,key:''});
 assert.deepEqual(decodeAppearance(h.pet),own);
 assert.equal(h.pet.illusion,undefined);
});

test('non-legendary, unknown, wrong-role, empty-slot and battle requests are rejected',()=>{
 const h=harness();
 const message=reader=>{assert.equal(reader.byte(),-1);return reader.string();};
 // 火焰精灵是 grade 0，不在传说候选里
 assert.match(message(h.call(PET_ILLUSION_APPLY,{role:1,slot:h.item.slot,key:'火焰精灵:0'})),/传说/);
 assert.match(message(h.call(PET_ILLUSION_APPLY,{role:1,slot:h.item.slot,key:'不存在的宠物:9'})),/传说/);
 assert.match(message(h.call(PET_ILLUSION_LIST,{role:999,slot:h.item.slot})),/角色已切换/);
 assert.match(message(h.call(PET_ILLUSION_LIST,{role:1,slot:77})),/自己的宠物/);
 const battling=harness();battling.context.battle=true;
 assert.match(message(battling.call(PET_ILLUSION_LIST,{role:1,slot:battling.item.slot})),/战斗中/);
 // 被拒绝之后宠物外观必须一点没变
 assert.equal(h.pet.illusion,undefined);
});

test('a failed save rolls the appearance back for both apply and clear',()=>{
 const h=harness();
 h.call(PET_ILLUSION_APPLY,{role:1,slot:h.item.slot,key:petIllusionCandidates()[2].key});
 const kept=JSON.stringify(h.pet.illusion);
 const failing={store:{save(){throw Error('磁盘写入失败');}},send(type,body){h.sent.push({type,bytes:body.done()});},log(){}};
 const rejected=h.call(PET_ILLUSION_APPLY,{role:1,slot:h.item.slot,key:petIllusionCandidates()[5].key},failing);
 assert.equal(rejected.byte(),-1);
 assert.equal(rejected.string(),'磁盘写入失败');
 assert.equal(JSON.stringify(h.pet.illusion),kept,'failed save must keep the previous appearance');
 const clearFailed=h.call(PET_ILLUSION_APPLY,{role:1,slot:h.item.slot,key:''},failing);
 assert.equal(clearFailed.byte(),-1);
 assert.equal(JSON.stringify(h.pet.illusion),kept,'failed clear must keep the previous appearance');
});

test('other request shapes and unrelated opcodes are not swallowed',()=>{
 const h=harness();
 assert.equal(handlePetIllusion(90020,new Reader(new Writer().done()),h.context,{store:{save(){}},send(){},log(){}}),false);
 const malformed=new Reader(new Writer().string('{"role":1,"slot":30}').byte(9).done());
 handlePetIllusion(PET_ILLUSION_LIST,malformed,h.context,{store:{save(){}},send(type,body){h.sent.push({type,bytes:body.done()});},log(){}});
 assert.equal(new Reader(h.sent.at(-1).bytes).byte(),-1);
});

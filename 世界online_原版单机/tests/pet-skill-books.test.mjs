 assert.equal(book.learnSkill.powerValue2,-133);assert.equal(book.learnSkill.useMP,875);
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Writer,Reader} from '../lib/codec.mjs';
import {BLOOD_MIST_BOOK_ID,KNIGHTS_DEVOTION_BOOK_ID,KNIGHTS_DEVOTION_SKILL_ID} from '../lib/pet-skill-book-data.mjs';
import {handlePetItems} from '../lib/pet-service.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {recordedPetSkills} from '../lib/recorded-content.mjs';
import {equipment} from '../lib/restoration.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {initializeNewbie} from '../lib/progression.mjs';
import {openContainer,equipPet,gainPet} from '../lib/pet-state.mjs';
import {petDetail} from '../lib/pet-packets.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
const preview=(petSlot=1)=>new Writer().short(32).short(petSlot);
const confirm=(petSlot=1)=>new Writer().int(6079).byte(1).bool(true).short(32).short(petSlot);
function harness(save=()=>{}){
 const p={id:71,name:'封印书验收',sex:1,race:0,job:1,level:1};initializeNewbie(p);p.level=15;normalizeRole(p);
 p.inventory.push({itemId:30100,slot:31,quantity:1});openContainer(p,31,1);const item=p.inventory.find(i=>i.pet);equipPet(p,item.slot,1);
 p.inventory.push({itemId:BLOOD_MIST_BOOK_ID,slot:32,quantity:2});
 const sent=[],context={role:p},env={store:{save},send(type,w){sent.push({type,bytes:w.done()});},log(){}};
 return {p,context,sent,call(type,body){const r=new Reader(body.done());assert.ok(handlePetItems(type,r,context,env)||handleRestoration(type,r,context,env));const response=sent.findLast(s=>s.type===type).bytes;if(response.readInt8(0)>=0)assert.equal(r.pos,r.b.length);return response;}};
}
test('native seal-book item, preview and confirmation callbacks learn the captured automatic skill and remove exactly one book',()=>{
 const def=equipment.get(BLOOD_MIST_BOOK_ID),r=new NativeReader(Buffer.from(def.definitionBase64,'base64')),item=new d.Item();d.Item.fromBytesAtts2(item,r);r.finish();
 assert.equal(item.type,31);assert.equal(d.native(32,'isPetSealSkillBook',{a:{default:d.module(4).constants}}).call(item),true);
 let persisted;const h=harness(()=>{persisted=JSON.parse(JSON.stringify(h.p));}),before=JSON.stringify(h.p);
 const packet=new NativeReader(h.call(14016,preview()));assert.equal(JSON.stringify(h.p),before);
 d.Skill.prototype.getName=function(){return this.name;};d.Skill.prototype.getDesc=function(){return this.name;};
 const requests=[];let confirmAction,resultAction,removed;
 const clientPet={skills:[],learnSkill(s){this.skills.push(s);},checkHPMP(){}};
 d.Skill.learnPetSkillAskCb=d.native(57,'learnPetSkillAskCb',{e:d.Skill,u:{default:{myPlayer:{bag:{removeBagItemByPos:(slot,count)=>{removed={slot,count};}}}}},y:{default:{alertMessage(){},errorMessage:assert.fail}},o:{default:{sendNt(){}}},s:{SkillEvent:{}}});
 class Message extends Writer{constructor(type){super();this.type=type;}putInt(v){return this.int(v);}putByte(v){return this.byte(v);}putBoolean(v){return this.bool(v);}putShort(v){return this.short(v);}}
 class Text{value='';append(v){this.value+=v;}toString(){return this.value;}}
 const parsePreview=d.native(57,'doUsePetSealItemLearnSkillCb',{
  e:d.Skill,T:{default:Text},p:{GameText:{getText:()=>'',STR_USE_LEARN_SKILL_ITEM_NEW:'',STR_USE_LEARN_SKILL_ITEM_ADD:''}},
  E:{Tool:{manageStringList:()=>''}},_:{default:{confirm(text,cb){confirmAction=cb;}}},r:{default:{alloc:(owner,fn,args=[])=>fn.bind(owner,...args)}},
  a:{Message},l:{default:d.module(19).constants},n:{default:{Service:{sendProto:m=>requests.push(m),onProto(type,cb){assert.equal(type,14017);resultAction=cb;}}}},o:{default:{sendNt(){}}},s:{SkillEvent:{}},y:{default:{errorMessage:assert.fail}}
 });
 parsePreview({slotPos:32},true,clientPet,null,1,{body:packet});packet.finish();assert.equal(typeof confirmAction,'function');confirmAction();
 assert.equal(requests[0].type,14017);assert.deepEqual(requests[0].done(),confirm().done());
 const result=new NativeReader(h.call(14017,requests[0]));resultAction({body:result});result.finish();assert.deepEqual(removed,{slot:32,count:1});
 const learned=clientPet.skills[0],original=recordedPetSkills.get('6079:1');assert.equal(learned.isLearnByBook,true);
 for(const key of ['id','name','level','type','power1','powerValue1','area','round','useMP','statusBit1','anime2'])assert.equal(learned[key],original[key],key);
 assert.equal(h.p.inventory.find(i=>i.slot===32).quantity,1);assert.deepEqual(persisted,h.p);assert.deepEqual(normalizeRole(JSON.parse(JSON.stringify(h.p))),h.p);
 assert.equal(new Reader(h.call(14004,new Writer().byte(1).int(6079))).byte(),0);assert.ok(h.p.inventory.find(i=>i.pet).pet.autoSkills.includes(6079));
 const pet=h.p.inventory.find(i=>i.pet).pet,nativePet={bag:{store:[]}},detail=new NativeReader(petDetail(new Writer(),pet).done());
 const parsePet=d.native(42,'fromBytesDetail',{n:{default:{timer:{serverTime:0}}},a:{default:{processDataPlayerSkillMsg:r=>Array.from({length:r.getShort()},()=>d.Skill.fromBytes(r))}},E:{default:{PET_BAG_SIZE:8}}});
 assert.equal(parsePet(detail,nativePet),0);detail.finish();assert.ok(nativePet.autoSkillID.includes(6079));assert.equal(nativePet.skillList.find(s=>s.id===6079).isLearnByBook,true);
});
test('Knight’s Devotion level-eight book learns the exact captured skill and consumes one copy',()=>{
 const p={id:72,name:'骑士奉献书验收',sex:1,race:0,job:1,level:1};initializeNewbie(p);p.level=15;normalizeRole(p);
 p.inventory.push({itemId:30100,slot:31,quantity:1});openContainer(p,31,1);const petItem=p.inventory.find(i=>i.pet);equipPet(p,petItem.slot,1);
 p.inventory.push({itemId:KNIGHTS_DEVOTION_BOOK_ID,slot:32,quantity:1});
 const context={role:p},sent=[];let saves=0;
 const env={store:{save(){saves++;}},send(type,w){sent.push({type,bytes:w.done()});},log(){}};
 function call(type,body){assert.equal(handlePetItems(type,new Reader(body.done()),context,env),true);return new Reader(sent.findLast(x=>x.type===type).bytes);}
 assert.equal(call(14016,new Writer().short(32).short(1)).byte(),0);
 assert.equal(call(14017,new Writer().int(KNIGHTS_DEVOTION_SKILL_ID).byte(8).bool(true).short(32).short(1)).byte(),0);
 const learned=petItem.pet.skills.find(skill=>skill.id===KNIGHTS_DEVOTION_SKILL_ID),source=petSkillLevels.get(`${KNIGHTS_DEVOTION_SKILL_ID}:8`);
 assert.ok(learned);assert.equal(learned.isLearnByBook,true);
 for(const key of ['id','level','name','type','power1','powerValue1','round','useMP','useHP','anime2','statusBit1'])assert.equal(learned[key],source[key],key);
 assert.equal(p.inventory.some(item=>item.itemId===KNIGHTS_DEVOTION_BOOK_ID),false);assert.equal(saves,1);
});
test('preview binding, duplicate learning, invalid targets, battles and save failure never lose the book',()=>{
 for(const mode of ['no-preview','pet-swapped','cancel','wrong-skill','battle','expired','missing-book','save-failure']){
  const h=harness(()=>{if(mode==='save-failure')throw Error('disk failure');});if(mode!=='no-preview')h.call(14016,preview());
  if(mode==='pet-swapped')h.p.inventory.find(i=>i.pet).pet.uid='another-pet';
  if(mode==='battle')h.context.battle={};
  if(mode==='expired')h.p.inventory.find(i=>i.pet).pet.expiresAt=1;
  if(mode==='missing-book')h.p.inventory=h.p.inventory.filter(i=>i.itemId!==BLOOD_MIST_BOOK_ID);
  const before=JSON.stringify(h.p),request=mode==='cancel'?new Writer().int(6079).byte(1).bool(false).short(32).short(1):mode==='wrong-skill'?new Writer().int(6075).byte(1).bool(true).short(32).short(1):confirm();
  assert.equal(new Reader(h.call(14017,request)).byte(),-1,mode);assert.equal(JSON.stringify(h.p),before,mode);
 }
 const h=harness();h.call(14016,preview());h.call(14017,confirm());const before=JSON.stringify(h.p);
 assert.equal(new Reader(h.call(14017,confirm())).byte(),-1);assert.equal(new Reader(h.call(14016,preview())).byte(),-1);assert.equal(JSON.stringify(h.p),before);
});
test('book learns on the selected resting pet and survives recorded growth milestones',()=>{
 const h=harness(),pet=h.p.inventory.find(i=>i.pet).pet;h.p.inventory.find(i=>i.pet).slot=35;
 assert.equal(new Reader(h.call(14016,preview(35))).byte(),0);assert.equal(new Reader(h.call(14017,confirm(35))).byte(),0);
 const learned=structuredClone(pet.skills.find(s=>s.id===6079));h.p.inventory.find(i=>i.pet).slot=1;
 gainPet(h.p,1000000);assert.equal(pet.level,14);assert.deepEqual(pet.skills.find(s=>s.id===6079),learned);
});

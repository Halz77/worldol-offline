import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {scoreCombatStats,combatRating,combatRatingPacket,syncCombatRating,MAX_COMBAT_RATING} from '../lib/combat-rating.mjs';
import {nativeCharacterStats} from '../lib/native-character-stats.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {equipment,attributes} from '../lib/restoration.mjs';
import {itemSlots} from '../lib/official-data.mjs';
import {playerDetail} from '../lib/world.mjs';
import {handleAttributes} from '../lib/newbie-service.mjs';
import {Writer,Reader} from '../lib/codec.mjs';
import {decoders} from '../tools/capture-decoders.mjs';
const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
const role=()=>normalizeRole({id:1001,name:'战力验收',sex:1,race:1,job:3,icon1:'2240667',icon2:'0',icon3:'0',level:97,baseStats:[100,30,30,30,30],initialStats:[10,10,10,10,10],attributePoints:100,inventory:[],skills:{},restoration:{starterIssued:true}});

test('published scoring weights agree with an independent hand calculation and use the strongest output branch',()=>{
 const stats={ATK_STR_NEARBY:1000,ATK_MIN:100,ATK_MAX:200,ATK_TIME:4,ATK_MAGIC:100,HPMAX:2000,MPMAX:400,DEF_STR_NEARBY:100,DEF_STR_RANGE:100,DEF_AGI_NEARBY:200,DEF_AGI_RANGE:200,DEF_MAGIC:300,DEF_FIELD:80,SPEED:200,BRK_ARMOR:1000,MAGIC_PENETRATION:500,TOUGH:100,FORCE_HIT:10};
 for(const key of ['HIT_RATE','HIT_MAGIC','DODGE','CRITICAL','BLOCK','INSIGHT','WIL'])stats[key]=100;
 for(const key of ['IGNORE_BACK','IGNORE_MAGIC_BACK','IGNORE_BLOCK','IGNORE_INSIGHT','IGNORE_WIL','IGNORE_TOUCH'])stats[key]=50;
 for(const key of ['LIFE_ABSORPTION','MANA_ABSORPTION','HEAL_RECOVERY','MANA_RECOVERY'])stats[key]=25;
 const score=scoreCombatStats(stats,44);assert.equal(score.multiplier,100);assert.equal(score.total,94600);assert.deepEqual(score.parts.map(p=>p.score),[1600,12000,37000,44000]);
 assert.equal(scoreCombatStats({...stats,ATK_MAGIC:10000},44).total,103000);
 assert.equal(scoreCombatStats({...stats,ATK_STR_RANGE:500},44).total,94600,'secondary damage branches are not counted twice');
 assert.equal(scoreCombatStats({HPMAX:399}).total,1900,'multiply the original integer score by 100, preserving its rounding');
});

test('large ratings saturate instead of wrapping; invalid and negative stats cannot produce a negative score',()=>{
 assert.equal(scoreCombatStats({HPMAX:1e15}).total,MAX_COMBAT_RATING);
 assert.equal(scoreCombatStats({HPMAX:1e15}).capped,true);
 const belowCap=scoreCombatStats({HPMAX:429496720});assert.equal(belowCap.total,2147483600);assert.equal(belowCap.capped,false);
 const aboveCap=scoreCombatStats({HPMAX:429496740});assert.equal(aboveCap.total,MAX_COMBAT_RATING);assert.equal(aboveCap.capped,true);
 assert.equal(scoreCombatStats({HPMAX:-100,ATK_MIN:-100}).total,0);
 assert.throws(()=>scoreCombatStats({ATK_MAGIC:Infinity}),/Invalid/);
 const a=scoreCombatStats({FORCE_HIT:100}).total,b=scoreCombatStats({FORCE_HIT:500}).total;assert.equal(a,b);
});

test('native stat extraction handles every wearable template without mutating definitions or the role',()=>{
 const p=role();let count=0;
 for(const e of equipment.values()){
  const slots=e.native?itemSlots(e.type):[8,10];if(!slots.length)continue;
  p.inventory=[{itemId:e.id,slot:slots[0],quantity:1,bound:true}];
  const before=JSON.stringify(p),definition=e.definitionBase64;
  const result=combatRating(p);assert.ok(result.total>0,e.name);
  for(const value of Object.values(result.stats))assert.ok(Number.isInteger(value)&&value>=0,e.name);
  assert.equal(JSON.stringify(p),before);assert.equal(e.definitionBase64,definition);count++;
 }
 assert.ok(count>500);
});

test('binding, star upgrades, gems, skills, allocation, unequip and reload recompute from saved state',()=>{
 const p=role(),base=combatRating(p).total;
 p.inventory=[{itemId:28011,slot:8,quantity:1,bound:false,affixes:{bindPower1:{power:2,value:61}}}];
 const unbound=combatRating(p).total;p.inventory[0].bound=true;const bound=combatRating(p).total;assert.ok(bound>unbound);
 p.inventory[0].star=18;const starred=combatRating(p).total;assert.ok(starred>bound);
 p.inventory[0].gems=[{itemId:414,quantity:2}];const gems=combatRating(p).total;assert.ok(gems>starred);
 p.inventory[0].gemBroken=true;assert.equal(combatRating(p).total,gems,'broken sockets retain their previously successful bonuses');
 p.inventory[0].combinedSkill={id:4007,level:22};const combined=combatRating(p);assert.equal(combined.total,gems+22000);
 assert.equal(combatRating(JSON.parse(JSON.stringify(p))).total,combined.total);
 p.baseStats[0]+=100;assert.ok(combatRating(p).total>combined.total);
 p.inventory[0].slot=30;assert.ok(combatRating(p).total<combined.total);
 p.baseStats[0]-=100;assert.equal(combatRating(p).total,base,'bag items do not contribute');
 p.skills={452:1};const learned=combatRating(p).total;p.skills[452]=22;assert.equal(combatRating(p).total,learned+21000);
 const native=nativeCharacterStats(p);assert.equal(native.stats.HPMAX,attributes(p).hp);assert.equal(native.stats.MPMAX,attributes(p).mp);
});

test('native actor entry and attribute-allocation reply both carry the computed combat power',()=>{
 const p=role(),reader=new d.Reader(playerDetail(new Writer(),p).done());
 const value={fromItemSetData:d.native(56,'fromItemSetData')};
 const player=new Proxy(value,{get(target,key){if(key in target)return target[key];if(String(key).startsWith('set'))return v=>{const name=key.slice(3);target[name[0].toLowerCase()+name.slice(1)]=v;};}});
 d.native(56,'fromBytes').call(player,reader,player);assert.equal(player.combatPoint,combatRating(p).total);assert.ok(player.combatPoint>0);
 let reply;
 handleAttributes(11003,new Reader(new Writer().byte(1).short(6).int(100).done()),{role:p},{store:{save(){}},send:(_type,w)=>reply=w.done(),log(){}});
 const r=new d.Reader(reply),client={addValue(key,n){assert.equal(key,122);this.combatPoint=n;}};
 const apply=d.native(261,'onActorAddAttribuite',{p:{default:{myPlayer:client}},_:{ModelConst:{COMBATPOINT:122}},r:{RoleEvent:{ROLE_ATTR_UPDATE:1}}});
 apply.call({sendNt(){}},{body:r});r.finish();assert.equal(client.combatPoint,combatRating(p).total);assert.ok(client.combatPoint>player.combatPoint);
});

test('native combat-power update refreshes the actor; synchronization skips unchanged scores and follows role changes',()=>{
 const p=role(),context={role:p},sent=[];
 const send=(type,w)=>sent.push({type,bytes:w.done()});syncCombatRating(context,send);syncCombatRating(context,send);assert.equal(sent.length,1);assert.equal(sent[0].type,12049);
 p.hp=1;p.mp=0;p.coins+=1000;p.x++;syncCombatRating(context,send);assert.equal(sent.length,1,'remaining vitals, money and movement do not affect standing power');
 p.baseStats[0]+=100;syncCombatRating(context,send);assert.equal(sent.length,2);
 const r=new d.Reader(combatRatingPacket(p).done()),player={addValue(key,value){assert.equal(key,122);this.combatPoint=value;}};
 const apply=d.native(261,'onActorCombatpower',{p:{default:{myPlayer:player}},_:{ModelConst:{COMBATPOINT:122}},r:{RoleEvent:{ROLE_COMBATPOWER:1}}});
 apply.call({sendNt(){}},{body:r});r.finish();assert.equal(player.combatPoint,combatRating(p).total);assert.equal(player.ignore_touch,0);
 context.role=null;syncCombatRating(context,send);context.role=p;syncCombatRating(context,send);assert.equal(sent.length,3);
 context.role={...p,id:1002};syncCombatRating(context,send);assert.equal(sent.length,4);
});

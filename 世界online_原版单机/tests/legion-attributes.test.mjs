import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {decoders} from '../tools/capture-decoders.mjs';
import {Writer} from '../lib/codec.mjs';
import {playerDetail} from '../lib/world.mjs';
import {itemPacket,skillList} from '../lib/restoration-packets.mjs';
import {equipment} from '../lib/restoration.mjs';
import {itemSlots} from '../lib/official-data.mjs';
import {hpMax,mpMax,normalizeRole} from '../lib/content.mjs';
import {characterFeatureDirectory} from '../lib/character-features.mjs';
import {featureData} from '../lib/feature-protobuf.mjs';
import {buildCharacterImport} from '../tools/import-character-export.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root),M=d.module(12).constants,C=d.constants;
const statKeys=[...new Set([...d.native(56,'get').toString().matchAll(/case\s+_\.ModelConst\.(\w+)/g)].map(m=>m[1]))].filter(k=>['STR','CON','AGI','ILT','WIS'].includes(k)||k==='HPMAX'||k==='MPMAX'||[...d.native(56,'get').toString().matchAll(/case\s+_\.ModelConst\.(\w+)/g)].findIndex(m=>m[1]===k)>29);
const powerIds=[...new Set(Object.entries(C).filter(([k,v])=>k.startsWith('POWER_')&&Number.isInteger(v)&&v>0).map(([,v])=>v))];
const intNum=d.native(13,'intNum'),Tool={MAX_VALUE_int:2147483647,MAX_VALUE_short:32767,sumValue:(v,a,min,max)=>Math.max(min,Math.min(max,v+a))};
const Item=d.Item,itemScope={e:Item,a:{default:C},E:{GUtil:{intNum}},d:{Tool}};Item.isUpgradeItemOpen=true;
Item.getpowerValueAdd=d.native(32,'getpowerValueAdd',itemScope);
const readItem=d.native(32,'fromBytesAtts1',itemScope);
for(const key of ['get','getPowerValue','getPower1AndPower2','isAscension','isAutoBinding','isBinded','isTimeItem','isTimeItemTimeOut','isVipItem','isVipItemTimeOut','getItemHitRate','getItemSetID'])Item.prototype[key]=d.native(32,key,itemScope);
d.Skill.prototype.getPowerValue=d.native(57,'getPowerValue');
const BagConstants=d.module(33).constants,bagMethods={};
for(const key of ['get','getForPos','getForArray','get_3','getItemAtkType','getEquipPowerValue','getEquipItemSetNum','isValidPos','getItem'])bagMethods[key]=d.native(33,key,{e:BagConstants,a:{default:Item},n:{default:C}});
const zeroFields='speed atkMin atkMax atk_time atk_str atk_agi atk_magic def_str def_agi def_magic dodge hitrate hitMagic critical forceHit wil tough block brkArmor magic_penetration insight def_field back magic_back life_absorption mana_absorption heal_recovery mana_recovery recovery keepout_atk_time ignore_back ignore_magic_back ignore_block ignore_insight ignore_wil ignore_touch ignoreCritical criticalDmg atk_str_range atk_str_nearby atk_agi_range atk_agi_nearby def_str_range def_str_nearby def_agi_range def_agi_nearby exp_up argo _hpMax _mpMax titlePower1 titlePowerValue1 titlePower2 titlePowerValue2 power powerValue countrypowerValue'.split(' ');
class Player {
 constructor(){Object.assign(this,Object.fromEntries(zeroFields.map(k=>[k,0])));this.type=3;this.skillList=[];this.autoSkillID=[];}
 getPet(){return null;}getType(){return this.type;}getVipLevel2(){return this.vipLevel2;}
 getPower(){return this.type===3?nativeArtifactCache:0;}
}
let nativeArtifactCache=0,receiveFeature;
Player.getItemSetID=d.native(56,'getItemSetID');Player.getItemSetNum=d.native(56,'getItemSetNum');
const scope={t:Player,n:{default:C},a:{Tool},r:{default:Item},s:{default:BagConstants},_:{ModelConst:M},g:{GUtil:{intNum}},y:{default:{isPreviewBeta:true}},P:{default:{getSpecialIconData:()=>null}},e:{prototype:{get(key){if(key===M.LEVEL)return this.level;if(key===M.LEVEL2)return this.level2;throw Error('Unmapped native attribute '+key);}}}};
for(const key of ['get','getAttribute','getBaseValue','getPowerValue','getPowerValueCal','getPowerValueByBuffer','getBagEquipPowerValue','getEquipWeaponType','addWeaponSkillDamageOrDur','addWeaponSkillAtkTime','getSkillPowerValue','getCountryBuffer','fromItemSetData'])Player.prototype[key]=d.native(56,key,scope);
const nativeGet=Player.prototype.get;Player.prototype.get=function(key){const value=nativeGet.call(this,key);return value<=0&&key===M.LEFT_ATK_MIN?12:value<=0&&key===M.LEFT_ATK_MAX?18:value;};
class Legion extends Player {constructor(){super();this.type=10;}get(key){return key===M.HPMAX?this.hpMax:key===M.MPMAX?this.mpMax:super.get(key);}}
Legion.prototype.cloneLegion=d.native(256,'cloneLegion',{t:Legion});
class Proxy {onLegionActorlistMsg(){}onLegionChangeMsg(){}}
class Artifact {selectTypeData(){}}
class Main {onInit(){}}
class Battle {logicRound(){}}
const World={},proxy={playLegionDataMap:{}},modules={0:{ModName:{},ProxyType:{}},1:{default:{}},3:{default:{getProxy:()=>proxy}},4:{default:C},5:{default:World},10:{GameText:{LEGION_DESC1:''}},12:{ModelConst:M},22:{},31:{MODEL_TYPE:{TYPE_PLAYER:3}},35:{default:{}},43:{default:{Service:{onNt(type,cb){receiveFeature=cb;}}}},54:{default:{ins:{}}},56:{default:Player},57:{default:d.Skill},61:{default:d.module(61).constants},113:{RoleGodData:{getPower:()=>nativeArtifactCache}},221:{default:Proxy},228:{MonsterGroup:{getLocalBattlePlayerList(){}}},251:{default:Battle},256:{default:Legion},261:{default:Proxy},75:{default:{getPetOwnerPos:()=>-1}},843:{default:Artifact},1464:{default:Main}};
const window={},document={getElementById:()=>({})},context={window,document,fetch:async()=>({json:async()=>({itemIds:[]})})};
vm.runInNewContext(fs.readFileSync(new URL('../web/character-features.js',import.meta.url),'utf8'),context);window.installCharacterFeatures(id=>modules[id]);
vm.runInNewContext(fs.readFileSync(new URL('../web/legion.js',import.meta.url),'utf8'),context);window.installOfflineLegion(id=>modules[id]);
function readRole(role,Class){
 const model=new Class(),setter=new ProxyObject(model,{get(target,key,receiver){if(key in target)return Reflect.get(target,key,receiver);if(typeof key==='string'&&key.startsWith('set'))return value=>{const name=key.slice(3);target[name[0].toLowerCase()+name.slice(1)]=value;};}});
 const reader=new d.Reader(playerDetail(new Writer(),role,{includeLegion:false}).done());d.native(56,'fromBytes').call(setter,reader,setter);
 model.bag=Object.assign({store:Array(160).fill(null)},bagMethods);
 for(const instance of role.inventory){const r=new d.Reader(itemPacket(new Writer(),instance).done()),item=new Item();readItem(item,r);Item.fromBytesAtts2(item,r);r.finish();model.bag.store[instance.slot]=item;}
 const sr=new d.Reader(skillList(new Writer(),role).done());for(let n=sr.getShort();n>0;n--){const skill=d.Skill.fromBytes(sr);skill.addLevel=sr.getByte();model.skillList.push(skill);}sr.finish();
 model.hpMax=hpMax(role);model.mpMax=mpMax(role);
 receiveFeature({body:{getString:()=>JSON.stringify(characterFeatureDirectory(role))}});
 return model;
}
// Keep the language Proxy constructor distinct from the mocked UI proxy class.
const ProxyObject=globalThis.Proxy;
function role(){return normalizeRole({id:1002,accountId:1,name:'属性对照',sex:1,race:1,job:3,level:97,icon1:'2240667',icon2:'0',icon3:'0',baseStats:[200,80,70,60,50],initialStats:[10,10,10,10,10],inventory:[],skills:{},restoration:{starterIssued:true},vipLevel2:9});}
function snapshot(p){return {vip:p.getVipLevel2(),stats:Object.fromEntries(statKeys.map(k=>[k,p.get(M[k])])),equipment:powerIds.map(k=>[k,p.getBagEquipPowerValue(k)]).filter(([,v])=>v),passive:powerIds.map(k=>[k,p.getSkillPowerValue(C.SKILL_TYPE_PASSIVE,k)]).filter(([,v])=>v),features:powerIds.map(k=>[k,p.getPower(k)]).filter(([,v])=>v),skills:JSON.parse(JSON.stringify(p.skillList)),auto:Array.from(p.autoSkillID),initiative:p.autoSkillID_Initiative};}
function compare(p){const single=readRole(p,Player),member=readRole(p,Legion),battle=member.cloneLegion();assert.deepEqual(snapshot(member),snapshot(single),'loaded member must match standalone');assert.deepEqual(snapshot(battle),snapshot(single),'battle member must match standalone');return {single,member,battle};}

test('every wearable template uses identical native stats and equipment powers when deployed as a legion member',()=>{
 const p=role();let count=0;
 for(const template of equipment.values()){
  const slots=template.native?itemSlots(template.type):[8];if(!slots.length)continue;
  p.inventory=[{itemId:template.id,slot:slots[0],quantity:1,bound:true}];compare(p);count++;
 }
 assert.ok(count>500);console.log('Legion attribute audit: '+count+' equipment templates, '+statKeys.length+' stats, '+powerIds.length+' power IDs');
});

test('full loadout keeps stacked equipment skills, stars, gems, affixes, VIP set, talents and artifact powers',()=>{
 const p=role();p.inventory=[{itemId:28011,slot:8,quantity:1,bound:true,star:18,gems:[{itemId:414,quantity:3}],affixes:{power1:{power:69,value:2684},power2:{power:54,value:403},bindPower1:{power:2,value:61},bindPower2:{power:259,value:61},power3:{power:134,value:61}},combinedSkill:{id:4007,level:22}},{itemId:11648,slot:2,quantity:1,bound:true,combinedSkill:{id:111,level:11}},{itemId:11648,slot:16,quantity:1,bound:true,combinedSkill:{id:111,level:11}},{itemId:31173,slot:15,quantity:1,bound:true}];
 p.skills={452:22};p.autoSkillIds=[452,0,0,0];p.initiativeSkillId=4007;
 p.characterFeatures={talents:Object.fromEntries(featureData.talents.filter(t=>t.rankLevel===1).map(t=>[t.rankId,1])),artifact:{stage:1,exp:0,skills:Object.fromEntries(featureData.artifact.skills.filter(s=>s.lv===1).map(s=>[s.type,1])),decorations:Object.fromEntries(featureData.artifact.decorations.filter(s=>s.lv===1).map(s=>[s.type,1]))}};
 nativeArtifactCache=900;const full=compare(p);assert.equal(full.battle.skillList.find(s=>s.id===111).level,22);assert.equal(full.battle.skillList.find(s=>s.id===4007).useMP,1100);
 assert.ok(full.battle.getPower(11)>0);assert.equal(full.battle.vipLevel2,9);
 const stronger=snapshot(full.battle);p.characterFeatures=undefined;p.inventory=p.inventory.filter(i=>i.itemId!==11648);p.inventory[0].slot=30;const bare=compare(p);assert.notDeepEqual(snapshot(bare.battle),stronger);nativeArtifactCache=0;
});

test('all decoded flat combat modifiers and VIP state survive native legion cloning independently',()=>{
 const {member}=compare(role());for(const field of zeroFields)if(!field.startsWith('_')&&!['power','powerValue','titlePower1','titlePowerValue1','titlePower2','titlePowerValue2','countrypowerValue'].includes(field))member[field]=17;
 member.fightPowerList=[[11,90]];member.vipLevel=8;member.vipLevel2=9;
 const battle=member.cloneLegion();assert.deepEqual(snapshot(battle),snapshot(member));assert.notEqual(battle.fightPowerList,member.fightPowerList);assert.notEqual(battle.itemSetData,member.itemSetData);
});

test('imported character has identical native attributes and skills standalone and as a legion member',()=>{
 const document=JSON.parse(fs.readFileSync(new URL('./fixtures/character-export.json',import.meta.url),'utf8'));
 const {role:p}=buildCharacterImport({schema:1,nextAccount:2,nextRole:1003,accounts:[{id:1,name:'import-test'}],characters:[]},document,{accountName:'import-test'});
 const {single,battle}=compare(p);assert.equal(single.get(M.HPMAX),55065);assert.equal(single.get(M.ATK_STR_NEARBY),80930);assert.equal(battle.skillList.length,68);assert.deepEqual(Array.from(battle.autoSkillID),[518,0,0,0,0]);assert.equal(battle.autoSkillID_Initiative,456);
});

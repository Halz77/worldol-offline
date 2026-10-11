import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {exportEquipment,exportSkill,exportLong,importedCombatFields} from '../lib/character-import-codec.mjs';
import {normalizeRole,maps} from '../lib/content.mjs';
import {careers} from '../lib/career-skills.mjs';
import {activeSkills,attributes,equipment} from '../lib/restoration.mjs';
import {setAttributeData} from '../lib/equipment-sets.mjs';
import {nativeCharacterStats} from '../lib/native-character-stats.mjs';
import {decoders} from './capture-decoders.mjs';
import {itemPacket} from '../lib/restoration-packets.mjs';
import {Writer} from '../lib/codec.mjs';
import {enterWorld} from '../lib/world.mjs';
import {petAttributes} from '../lib/pet-state.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
// 官方目录里的宝石（type 30）按「属性位:每颗数值」索引（含单机补充的 +4 档）。
// 导出文件只给 attachPower/attachValue，靠这张表才能还原成一件真实宝石道具。
const gemByPowerValue=new Map([...equipment.values()].filter(e=>e.type===30&&e.power1&&e.powerValue1>0&&!e.power2&&!e.power3).map(e=>[`${e.power1}:${e.powerValue1}`,e.id]));
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const integer=(v,name,min=0,max=2147483647)=>{if(!Number.isInteger(v)||v<min||v>max)throw Error('无效导出字段: '+name);return v;};
const statNames=['str','con','agi','ilt','wis'];
function importPet(source,id){
 const s=source.stats;if(!s)throw Error('宠物基础属性缺失。');if(source.items?.length)throw Error('此格式的宠物装备导入尚未核验。');
 return {uid:String(id*10000+1),name:source.name,level:source.level,grade:source.grade,job:source.job,icon:exportLong(source.icon1),hp:s._hp,mp:s._mp,exp:s._exp,expMax:s._expMax,sp:s._sp,baseStats:statNames.map(k=>integer(s[k],k,0,32767)),grow:s.grow,comprehension:s.compre,cp:s.cp,growLevel:s.growLevel,expiresAt:s.ageTime,hit:s.petHitrate,attackType:s.atkType,attackMin:s.atkMin,attackMax:s.atkMax,attackTimes:s.petAtkTime,autoSkills:[...(source.autoSkillID||s.autoSkillID||[])],initiativeSkill:source.autoSkillID_Initiative??s.autoSkillID_Initiative??-1,skills:source.skills.map(x=>({...exportSkill(x),addLevel:x.addLevel||0})),vipLevel:s.vipLevel||0,bornStatus:exportLong(s.bornStatus),headIcon:s.PetHeadIcon,model:s.modelForPet??-1,equipment:[],imported:true};
}
export function buildCharacterImport(world,document,{accountName,sourceSHA256,sourceFile='character-export.json',now=new Date().toISOString()}={}){
 if(world.schema!==1||!Array.isArray(world.characters)||!Array.isArray(world.accounts))throw Error('无法识别目标存档。');
 const source=document.after,s=source?.stats;
 if(!source?.found||!s||!Array.isArray(source.items)||!Array.isArray(source.skills)||document.target!==source.id)throw Error('此文件不是完整的人物对象导出。');
 const account=world.accounts.find(a=>a.name===accountName);if(!account)throw Error('目标本地账号不存在。');
 const existing=world.characters.filter(p=>p.accountId===account.id);
 if(existing.some(p=>p.importedCharacter?.originalId===source.id))throw Error('这个正式服角色已在列表中；不会重复导入或覆盖。');
 if(existing.length>=6||existing.some(p=>p.name===source.name))throw Error('角色列表已满或角色名重复，未修改存档。');
 const id=Math.max(integer(world.nextRole,'nextRole',1001),...world.characters.map(p=>p.id+1));
 const p={id,accountId:account.id,name:source.name,sex:source.sex,race:source.race,job:source.job,level:integer(source.level,'level',1,97),level2:s.level2||0,exp:s._exp||0,exp2:s._exp2||0,expMax2:s._expMax2??0,hp:integer(s._hp,'hp'),mp:integer(s._mp,'mp'),baseStats:statNames.map(k=>integer(s[k],k,0,32767)),attributePoints:s.cp||0,skillPoints:s._sp||0,coins:integer(source.money.copper,'copper'),gold:integer(source.money.gold,'gold'),silver:integer(source.money.silver,'silver'),vipLevel2:s.vipLevel2||0,icon1:exportLong(source.icons.icon1),icon2:exportLong(source.icons.icon2),icon3:exportLong(source.icons.icon3),bagLimit:90,bagPages:s.numBag||1,storageSlots:s.numStroe||24,mapId:5,x:maps[5].spawn[0],y:maps[5].spawn[1],status:0,createdAt:now,inventory:[],skills:{},restoration:{starterIssued:true,careerSkills:careers.version},autoSkillIds:[...(source.autoSkillID||s.autoSkillID||[])],initiativeSkillId:source.autoSkillID_Initiative??s.autoSkillID_Initiative??-1,importedSkillDefinitions:{},importedRolePowers:{...source.role_power},importedCombatModifiers:Object.fromEntries(importedCombatFields.map(k=>[k,integer(s[k]||0,k,-2147483648)]))};
 if(typeof p.name!=='string'||!p.name.length||p.name.length>16)throw Error('导出角色名称无效。');
 for(const [key,value] of Object.entries(p.importedRolePowers)){integer(Number(key),'role_power key',1,32767);integer(value,'role_power value',-32768,32767);}
 p.initialStats=[...p.baseStats];
 if(s.title){p.titleId=-id;p.importedTitle={id:-id,name:s.title,power1:s.titlePower1||0,value1:s.titlePowerValue1||0,power2:s.titlePower2||0,value2:s.titlePowerValue2||0};}if(source.pet)p.nextPetIndex=1;
 for(const row of source.skills){const skill=exportSkill(row),base=skill.level-integer(row.addLevel||0,'addLevel',0,skill.level);p.importedSkillDefinitions[`${skill.id}:${skill.level}`]=skill;if(base)p.skills[skill.id]=base;}
 const pet=source.pet?importPet(source.pet,id):null,slots=new Set();
 for(const row of source.items){
  const slot=integer(row.slotPos,'slot',0,119);if(slots.has(slot))throw Error('导出装备位置重复。');slots.add(slot);
  if(row.type===32){if(!pet||slot!==1)throw Error('导出宠物与宠物栏不一致。');p.inventory.push({itemId:24,slot,quantity:1,bound:!!(row.status&2),pet});continue;}
  const e=exportEquipment(row,equipment.get(row.illusionItemId)),gems=[];
  // 导出里只有 attachPower（属性位）与 attachValue（颗数×每颗数值），没有宝石道具本身。
  // 按「属性位 + 每颗数值」回查官方目录（含单机补充的 +4 档），还原成一件真实宝石道具：
  // 力量/体质/敏捷/智力/感知的 +1～+4 都受支持，生命、魔法宝石同理。
  if(row.attachDone){const each=row.attachValue/row.attachDone;const gemId=Number.isInteger(each)?gemByPowerValue.get(`${row.attachPower}:${each}`):undefined;if(!gemId)throw Error('该宝石组合尚未核验。');gems.push({itemId:gemId,quantity:row.attachDone});}
  p.inventory.push({itemId:row.id,slot,quantity:integer(row.quantity||1,'quantity',1,999),bound:!!(row.status&2),durability:row.durability,star:e.star||0,gems,gemBroken:!!(row.status&32),recordedDefinition:e});
 }
 p.importedCharacter={format:'native-object-export-v1',originalId:source.id,sourceSHA256,sourceFile:path.basename(sourceFile),importedAt:now,originalCombatPoint:source.combatPoint,originalBagSize:s.bagSize,originalItemSetData:source.itemSetData,sourceError:document.hook?.error||null,pending:['原服任务进度、城市、军团及未导出的背包物品待定。','神器、图鉴已保留合计属性；独立等级待定。','单机战力继续使用本地评分，原服评分仅留档。','本地装备沿用单机永久持有规则；原服有效期保存在原始导出文件中。']};
 normalizeRole(p);
 if(pet){const max=petAttributes(p,pet);pet.importedVitals={hp:pet.hp,mp:pet.mp,reportedHpMax:source.pet.stats._hpMax,reportedMpMax:source.pet.stats._mpMax};if(pet.hp>max.hp||pet.mp>max.mp){pet.hp=Math.min(pet.hp,max.hp);pet.mp=Math.min(pet.mp,max.mp);p.importedCharacter.pending.push('宠物未导出有效血蓝上限，原服当前血蓝高于已知加成计算结果；已按单机计算上限校正，原值留档。');}}
 const effective=activeSkills(p);assert.equal(effective.length,source.skills.length,'有效技能条数');
 for(const sourceSkill of source.skills){const actual=effective.find(s=>s.id===sourceSkill.id);assert.ok(actual,'技能缺失 '+sourceSkill.id);for(const k of ['level','type','power1','power2','power3','powerValue1','powerValue2','powerValue3','useMP','useHP','atk_time','round','area'])assert.equal(actual[k]||0,sourceSkill[k]||0,'技能 '+sourceSkill.id+' '+k);assert.equal(actual.addLevel||0,sourceSkill.addLevel||0,'技能额外等级 '+sourceSkill.id);}
 const activeIds=new Set(effective.map(s=>s.id));for(const skill of [...p.autoSkillIds,p.initiativeSkillId])if(skill>0)assert.ok(activeIds.has(skill),'自动技能不存在 '+skill);
 const d=decoders(root);d.Item.prototype.isTimeItem=d.native(32,'isTimeItem',{e:d.Item});
 for(const item of p.inventory){const reader=new d.Reader(itemPacket(new Writer(),item).done()),decoded=new d.Item();d.native(32,'fromBytesAtts1',{e:d.Item})(decoded,reader);d.Item.fromBytesAtts2(decoded,reader);reader.finish();assert.equal(decoded.id,item.itemId);if(item.pet)continue;const e=item.recordedDefinition;for(const k of ['star','upgradeStar','ascensionStar','upgradeAscensionStar','def_str','def_agi','def_mag','power1','powerValue1','power2','powerValue2','power3','powerValue3','bindPower1','bindPowerValue1','bindPower2','bindPowerValue2','enchantLevel','enchantPower1','enchantPowerValue1','enchantPower2','enchantPowerValue2','itemSet'])assert.equal(decoded[k]||0,e[k]||0,'装备 '+item.itemId+' '+k);for(const side of ['Left','Right'])assert.deepEqual({...decoded['css'+side+'ItemPower']},e['css'+side+'ItemPower']);assert.equal(decoded.skill?.id,e.skill?.id);assert.equal(decoded.skill?.level,e.skill?.level);}
 const setRows=values=>Array.from({length:values.length/3},(_,n)=>values.slice(n*3,n*3+3)).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 assert.deepEqual(setRows(setAttributeData(p)),setRows(source.itemSetData),'套装属性不一致');
 const stats=nativeCharacterStats(p).stats,a=attributes(p);assert.equal(a.hp,stats.HPMAX,'血量公式与原版客户端不一致');assert.equal(a.mp,stats.MPMAX,'蓝量公式与原版客户端不一致');
 const bytes=enterWorld(p).done();assert.ok(bytes.length>0);assert.deepEqual(normalizeRole(structuredClone(p)),p,'导入后存档规范化应幂等');
 const next=structuredClone(world);next.characters.push(p);next.nextRole=id+1;
 assert.deepEqual(next.characters.slice(0,-1),world.characters);assert.deepEqual(next.accounts,world.accounts);
 return {world:next,role:p,report:{account:accountName,roleId:id,originalId:source.id,name:p.name,level:p.level,equipment:p.inventory.filter(i=>!i.pet).length,skills:effective.length,learnedSkills:Object.keys(p.skills).length,pet:pet?{name:pet.name,level:pet.level,skills:pet.skills.length,autoSkills:pet.autoSkills,initiative:pet.initiativeSkill,vitals:petAttributes(p,pet),originalVitals:pet.importedVitals}:null,autoSkills:p.autoSkillIds,initiative:p.initiativeSkillId,vip:p.vipLevel2,originalCombatPoint:source.combatPoint,nativeStats:stats,worldPacketBytes:bytes.length,unchangedExistingCharacters:true,unchangedAccountSelection:true,pending:p.importedCharacter.pending}};
}
async function main(){
 const args=process.argv.slice(2),arg=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
 const sourceFile=arg('--source'),saveFile=arg('--save'),accountName=arg('--account'),output=arg('--out');
 if(!sourceFile||!saveFile||!accountName||!output)throw Error('Required: --source JSON --save world.json --account NAME --out DIR [--apply --expected-sha HASH]');
 const source=fs.readFileSync(sourceFile),saved=fs.readFileSync(saveFile),beforeSHA256=sha256(saved);
 if(arg('--expected-source-sha')&&arg('--expected-source-sha').toLowerCase()!==sha256(source))throw Error('角色导出文件已变化，未写入。');
 const result=buildCharacterImport(JSON.parse(saved),JSON.parse(source),{accountName,sourceSHA256:sha256(source),sourceFile});
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'source-character.json'),source);fs.writeFileSync(path.join(output,'world.preview.json'),JSON.stringify(result.world,null,2)+'\n');
 if(args.includes('--apply')){
  if(arg('--expected-sha')?.toLowerCase()!==beforeSHA256||sha256(fs.readFileSync(saveFile))!==beforeSHA256)throw Error('存档哈希已变化，未写入。');
  const backup=path.join(output,'world.before.json');fs.writeFileSync(backup,saved,{flag:'wx'});const temp=saveFile+'.import.tmp';fs.writeFileSync(temp,JSON.stringify(result.world,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,saveFile);
 }
 const report={...result.report,applied:args.includes('--apply'),saveFile,sourceSHA256:sha256(source),beforeSHA256,afterSHA256:sha256(JSON.stringify(result.world,null,2)+'\n')};fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(e=>{console.error(e);process.exitCode=1;});

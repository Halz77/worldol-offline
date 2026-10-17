import {Writer} from './codec.mjs';

// Explicit v305 wire fields only. Exported object keys and debug strings are data,
// never evaluated. Values are re-read by the original client decoder at import.
export const importedCombatFields='ignore_back ignore_magic_back ignore_block ignore_insight ignore_wil ignore_touch ignoreCritical criticalDmg atk_str_range atk_str_nearby atk_agi_range atk_agi_nearby def_str_range def_str_nearby def_agi_range def_agi_nearby'.split(' ');
export function exportLong(value=0){
 if(value&&typeof value==='object'&&Number.isInteger(value.high)&&Number.isInteger(value.low))return BigInt.asIntN(64,(BigInt(value.high)<<32n)|BigInt(value.low>>>0)).toString();
 if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('导出的长整数不精确。');
 return BigInt(value||0).toString();
}
const skillFields='id level name type info skillWeapon power1 powerValue1 power2 powerValue2 power3 powerValue3 skillAtkType area round atk_time useMP useHP anime1 anime2 anime3 position statusBit1 statusBit2 statusBit3 isLearnByBook'.split(' ');
export function exportSkill(source){
 const s=Object.fromEntries(skillFields.filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
 if(!Number.isInteger(s.id)||s.id<1||s.id>65535||!Number.isInteger(s.level)||s.level<1||s.level>127||![1,2,3].includes(s.type))throw Error('无效的导出技能。');
 s.native=true;s.powers=[1,2,3].filter(n=>s['power'+n]).map(n=>[s['power'+n],s['powerValue'+n]]);
 s.wireBase64=skillBytes(s).toString('base64');return s;
}
export function skillBytes(s,item=false){
 const w=new Writer().short(s.id).byte(s.level).string(s.name||'').byte(s.type).string(s.info||'').byte(s.skillWeapon||0);
 for(const n of [1,2,3])w.short(s['power'+n]||0).short(s['powerValue'+n]||0);
 if(s.type!==1){w.byte(s.skillAtkType||0).byte(s.area||0).byte(s.round||0).byte(s.atk_time||0).short(s.useMP||0).short(s.useHP||0).byte(s.anime1||0).short(s.anime2||0).short(s.anime3||0).byte(s.position||0).byte(s.statusBit1||0).byte(s.statusBit2||0).byte(s.statusBit3||0);}
 if(!item)w.bool(!!s.isLearnByBook);return w.done();
}
const itemFields='type id name bagIcon info grade autoBinding stackNum decomCHest icon ownTime durMax price attachCount itemSet reqLv reqStr reqCon reqAgi reqIlt reqWis def_str def_agi def_mag power1 powerValue1 power2 powerValue2 power3 powerValue3 skillDesc bindPower1 bindPowerValue1 bindPower2 bindPowerValue2 atkType atk_time atkMin atkMax ascensionStar star hitrate vipLevelReq enchantPower1 enchantPowerValue1 enchantPower2 enchantPowerValue2 enchantLevel cssLeftChannel cssRightChannel cssLeftHasItem cssRightHasItem cssLeftPowerPer cssRightPowerPer cssLeftItemId cssLeftItemGrade cssLeftItemIcon cssRightItemId cssRightItemGrade cssRightItemIcon isUpgradeItem power4 powerValue4 power5 powerValue5 power6 powerValue6 power7 powerValue7 upgradeAscensionStar upgradeStar handBookItem isHandBookActivated illusionItemId'.split(' ');
export function exportEquipment(source,illusionDefinition){
 const raw={...source.values,...source},e=Object.fromEntries(itemFields.filter(k=>raw[k]!==undefined).map(k=>[k,raw[k]]));
 if(!Number.isInteger(e.id)||e.id<1||!(e.type>=0&&e.type<=12||e.type>=13&&e.type<=24||e.type>=34&&e.type<=39))throw Error('暂不支持此导出物品类型: '+e.type);
 if(raw.illusionItemId){if(illusionDefinition?.id!==raw.illusionItemId||!illusionDefinition.definitionBase64)throw Error('导出的幻化缺少独立物品定义。');e.illusionDefinitionBase64=illusionDefinition.definitionBase64;}
 for(const side of ['Left','Right'])e['css'+side+'ItemPower']=Object.fromEntries(Object.entries(raw['css'+side+'ItemPower']||{}).filter(([k,v])=>Number(k)>0&&Number.isInteger(v)&&v!==0).map(([k,v])=>[Number(k),v]));
 for(const key of ['fashIcon1','fashIcon2','fashIcon3','illusionEndTime'])e[key]=exportLong(raw[key]);
 e.illusion=(raw.illusion||[]).map(x=>({currency:x.currency,day:x.day,price:x.price}));
 e.skill=raw.skill?exportSkill(raw.skill):null;e.combinUpSkillList=(raw.combinUpSkillList||[]).map(exportSkill);
 return finishEquipment(e);
}
export function finishEquipment(e){
 return {...e,native:true,imported:true,level:e.reqLv||0,requirements:['Str','Con','Agi','Ilt','Wis'].map(k=>e['req'+k]||0),durability:e.durMax||0,localPrice:0,localIcon:e.bagIcon,attackTimes:(e.atk_time||0)+1,hit:e.hitrate||0,powers:[1,2,3].filter(n=>e['power'+n]).map(n=>[e['power'+n],e['powerValue'+n]]),definitionBase64:equipmentBytes(e).toString('base64')};
}
// 字节写出只有这一份实现：所有装备定义（官方抓包、本地补充、导入码）都走它，
// 一漂移就是「鉴定属性错位」，所以别再另写一份。
function writeEquipment(e,offsets){
 const weapon=(e.type>=13&&e.type<=24)||(e.type>=34&&e.type<=39),w=new Writer().byte(e.type).bool(!!e.handBookItem);
 const mark=k=>{if(offsets)offsets[k]=w.done().length;};
 if(e.handBookItem){w.bool(!!e.isHandBookActivated).byte(e.illusion?.length||0);for(const i of e.illusion||[])w.byte(i.currency).int(i.day).int(i.price);w.int(e.illusionItemId||0).long(e.illusionEndTime||0);if(e.illusionItemId)w.raw(Buffer.from(e.illusionDefinitionBase64,'base64'));}
 mark('id');w.int(e.id).string(e.name||'');
 mark('bagIcon');w.int(e.bagIcon||0).string(e.info||'');
 mark('grade');w.byte(e.grade||0).byte(e.autoBinding||0);
 mark('stackNum');w.byte(e.stackNum||1).bool(!!e.decomCHest);
 mark('icon');w.short(e.icon||0).short(e.ownTime||0);
 mark('durMax');w.int(e.durMax||0);
 mark('price');w.int(e.price||0);
 mark('attachCount');w.byte(e.attachCount||0).byte(e.itemSet||0);
 mark('reqLv');w.byte(e.reqLv||0);
 for(const k of ['reqStr','reqCon','reqAgi','reqIlt','reqWis','def_str','def_agi','def_mag']){mark(k);w.short(e[k]||0);}
 for(const n of [1,2,3]){mark('power'+n);w.short(e['power'+n]||0);mark('powerValue'+n);w.short(e['powerValue'+n]||0);}
 mark('skillFlag');w.bool(!!e.skill);if(e.skill)w.raw(skillBytes(e.skill,true));w.byte(e.combinUpSkillList?.length||0);for(const s of e.combinUpSkillList||[])w.bool(true).raw(skillBytes(s,true));
 mark('skillEnd');mark('skillDesc');w.string(e.skillDesc||'');mark('skillDescEnd');
 for(const k of ['bindPower1','bindPowerValue1','bindPower2','bindPowerValue2']){mark(k);w.short(e[k]||0);}
 if(weapon){mark('atkType');w.byte(e.atkType||0).byte(e.atk_time||0);mark('atkMin');w.short(e.atkMin||0);mark('atkMax');w.short(e.atkMax||0);}
 mark('ascensionStar');w.byte(e.ascensionStar||0);
 mark('star');w.byte(e.star||0);
 if(weapon){mark('hitrate');w.byte(e.hitrate||0);}else if(e.type===12)for(const k of ['fashIcon1','fashIcon2','fashIcon3'])w.long(e[k]||0);
 mark('vipLevelReq');w.byte(e.vipLevelReq||0);
 for(const k of ['enchantPower1','enchantPowerValue1','enchantPower2','enchantPowerValue2','enchantLevel']){mark(k);w.short(e[k]||0);}
 for(const k of ['cssLeftChannel','cssRightChannel','cssLeftHasItem','cssRightHasItem'])w.bool(!!e[k]);
 mark('cssLeftPowerPer');w.short(e.cssLeftPowerPer||0).short(e.cssRightPowerPer||0);
 for(const side of ['Left','Right'])if(e['css'+side+'HasItem']){const powers=Object.entries(e['css'+side+'ItemPower']||{});w.int(e['css'+side+'ItemId']||0).byte(e['css'+side+'ItemGrade']||0).short(e['css'+side+'ItemIcon']||0).byte(powers.length);for(const [id,value] of powers)w.short(Number(id)).short(value);}
 w.bool(!!e.isUpgradeItem);if(e.isUpgradeItem)for(const n of [4,5,6,7]){mark('power'+n);w.short(e['power'+n]||0);mark('powerValue'+n);w.short(e['powerValue'+n]||0);}
 mark('upgradeAscensionStar');w.byte(e.upgradeAscensionStar||0);
 mark('upgradeStar');w.byte(e.upgradeStar||0);
 return w.done();
}
export function equipmentBytes(e){return writeEquipment(e,null);}

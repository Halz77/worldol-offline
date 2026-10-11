// Power numbers are verified against v305 module 0004. Labels must also agree
// with each source row; a numeric key alone is not sufficient evidence.
export const fields={
 power:[1,'力量'],powerPercentage:[2,'力量'],constitution:[3,'体质'],constitutionPercentage:[4,'体质'],
 agile:[5,'敏捷'],agilePercentage:[6,'敏捷'],intelligence:[7,'智力'],intelligencePercentage:[8,'智力'],
 perception:[9,'感知'],perceptionPercentage:[10,'感知'],basicHP:[11,'生命上限'],bloodVolumePercentage:[12,'生命上限'],mana:[13,'法力上限'],manaPercentage:[14,'法力上限'],
 move:[53,'出手速度'],movePercentage:[23,'出手速度'],hit:[54,'物理命中'],hitPercentage:[24,'物理命中率'],dodge:[55,'躲闪'],dodgePercentage:[25,'躲闪'],
 magicHit:[56,'魔法命中'],magicHitPercentage:[26,'魔法命中'],deadly:[57,'致命点'],deadlyPercentage:[27,'致命率'],
 basicChopAttack:[58,'劈砍攻击力'],chopAttackPercentage:[28,'劈砍攻击力'],basicPuncture:[59,'穿刺攻击力'],puncturePercentage:[29,'穿刺攻击力'],basicMagic:[60,'魔法攻击力'],magicPercentage:[30,'魔法攻击力'],
 chopDefense:[61,'劈砍防御力'],chopDefensePercentage:[31,'劈砍防御力'],punctureDefense:[62,'穿刺防御力'],punctureDefensePercentage:[32,'穿刺防御力'],magicDefense:[63,'魔法防御力'],magicDefensePercentage:[33,'魔法防御力'],
 state:[64,'状态抵抗值'],statePercentage:[34,'基础状态抵抗'],damageReduction:[65,'伤害减免'],block:[67,'格挡'],insight:[68,'洞察'],insightPercentage:[38,'洞察'],
 armourBreaking:[69,'破甲'],armourBreakingPercentage:[39,'破甲'],manaShield:[70,'法力护盾'],manaShieldPercentage:[40,'法力护盾'],
 counterAttack:[71,'反击'],counterAttackPercentage:[41,'反击'],magicFeedback:[72,'魔法反馈'],lifeAbsorption:[73,'基础生命吸收'],manaAbsorption:[74,'基础法力吸收'],magicPenetration:[75,'魔法穿透'],magicPenetrationPercentage:[45,'魔法穿透'],forcedHit:[76,'基础强制命中率'],HPRecovery:[77,'每回合自动恢复生命'],manaRegeneration:[78,'每回合自动恢复法力'],
 swordAttackTimes:[122,'用剑时攻击次数'],sabreAttackTimes:[123,'用刀时攻击次数'],heavyAttackTimes:[124,'用重型武器时攻击次数'],longHandleAttackTimes:[125,'用长柄武器时攻击次数'],staffAttackTimes:[126,'用法杖时攻击次数'],empty_handedAttackTimes:[127,'空手时攻击次数'],long_rangeAttackTimes:[128,'用远程武器时攻击次数'],attackTimes:[130,'攻击次数'],
 swordWeaponDamage:[133,'剑类武器伤害、耐久'],sabreWeaponDamage:[134,'刀类武器伤害、耐久|刀类伤害、耐久'],heavyWeaponDamage:[135,'重型武器伤害、耐久'],longHandleWeaponDamage:[136,'长柄武器伤害、耐久'],staffWeaponDamage:[137,'法杖武器伤害、耐久'],empty_handedWeaponDamage:[138,'空手伤害'],long_rangeWeaponDamage:[139,'远程武器伤害、耐久'],
 ignorecounterAttack:[168,'无视反击'],ignoreMagicFeedback:[169,'无视魔法反馈'],ignoreBlock:[170,'无视格挡'],ignoreInsight:[171,'无视洞察'],disregardState:[172,'无视状态抵抗值'],ignoreDamageReduction:[173,'无视伤害减免'],magicInstrumentAttackTimes:[174,'用法器时攻击次数'],magicInstrumentWeaponDamage:[175,'法器武器伤害、耐久'],artilleryAttackTimes:[190,'用火枪时攻击次数'],artilleryWeaponDamage:[191,'火枪类武器伤害、耐久']
};
export const percentField=key=>key.endsWith('Percentage')||key.endsWith('WeaponDamage');
const meta=new Set(['name','value','skillAttribute','checked','dataProvision','describe','armsLimitation','version']);
export function skillPowers(row){
 const entries=Object.entries(row).filter(([key])=>!meta.has(key));
 if(!entries.length||entries.length>3)throw Error('属性数量或额外效果不支持');
 const lines=[...(row.skillAttribute||[])].map(x=>x.replace(/\s/g,'').replace(/％/g,'%'));
 const powers=entries.map(([key,value])=>{
   const spec=fields[key];if(!spec||!Number.isInteger(value)||value< -32768||value>32767)throw Error('未知字段或数值越界: '+key);
   const index=lines.findIndex(line=>spec[1].split('|').some(label=>line===label+(value>=0?'+':'')+value+(percentField(key)?'%':'')));
   if(index<0)throw Error('文字与数值不一致: '+key);
   lines.splice(index,1);return [spec[0],value];
 });
 if(lines.length)throw Error('存在未转换的效果文字');
 return powers;
}

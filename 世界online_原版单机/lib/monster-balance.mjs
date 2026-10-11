import {Writer} from './codec.mjs';

// Local gameplay tuning, separate from the preserved official recordings.
export const monsterBalance={1985:{hp:10,stats:1}};
// v305 Monster.fromBytes field order after identity/appearance/level/type.
const fields=[
 ['hpMax','int'],['mpMax','int'],['speed','int'],['atkType','byte'],
 ['atkMin','int'],['atkMax','int'],['atk_time','byte'],
 ...['dodge','atk_str','atk_str_nearby','atk_str_range','atk_agi','atk_agi_nearby','atk_agi_range','atk_magic','def_str','def_str_nearby','def_str_range','def_agi','def_agi_nearby','def_agi_range','def_magic','hitrate','hitMagic'].map(k=>[k,'int']),
 ['critical','short'],
 ...['ignoreCritical','criticalDmg','ignore_back','ignore_magic_back','ignore_block','ignore_insight','ignore_touch','ignore_wil','wil','tough','block','brkArmor','insight','def_field','back','magic_back','life_absorption','mana_absorption','magic_penetration'].map(k=>[k,'int']),
 ['bornStatus','long'],['newReflection','int']
];
export function balancedMonster(monster){
 const rule=monsterBalance[monster.id];if(!rule)return monster;
 const result={...monster};
 for(const [key,type] of fields){
  if(key==='atkType'||key==='bornStatus')continue;
  // Native atk_time is one less than the actual number of attacks.
  const value=key==='atk_time'?(monster[key]+1)*rule.stats-1:monster[key]*(key==='hpMax'?rule.hp:rule.stats);
  const max=type==='byte'?127:type==='short'?32767:2147483647;
  if(!Number.isSafeInteger(value)||value<0||value>max)throw Error(`Monster ${monster.id} ${key} exceeds native ${type}`);
  result[key]=value;
 }
 return result;
}
export function balancedMonsterPacket(monster){
 if(!monsterBalance[monster.id])return Buffer.from(monster.wireBase64,'base64');
 const m=balancedMonster(monster),w=new Writer().int(m.id).string(m.name).long(m.icon1).byte(m.level).byte(m.monstertype);
 for(const [key,type] of fields)w[type](m[key]);
 return w.done();
}

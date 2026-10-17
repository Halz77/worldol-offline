import { Writer } from './codec.mjs';
import {normalizeRole,maps} from './content.mjs';
import {missionBits,missionsPacket,npcPacket,monsterGroups,monsterModels} from './game-packets.mjs';
import {bagPacket,skillList} from './restoration-packets.mjs';
import {activePet} from './pet-state.mjs';
import {petDetail} from './pet-packets.mjs';
import {localVipLevel,setAttributeData} from './equipment-sets.mjs';
import {combatRating} from './combat-rating.mjs';
import {selectedTitle} from './recorded-content.mjs';
import {isPersonalCity,cityState} from './city-state.mjs';
import {legionAppearance} from './legion-packets.mjs';
import {importedCombatFields} from './character-import-codec.mjs';
import {actorSettings} from './system-settings-service.mjs';
import {towerExtraGroups} from './climb-tower.mjs';
import {trialExtraGroups} from './trial-challenge.mjs';
// Native v305 actor layout, populated from this local character.
export function playerDetail(w,p,{includeLegion=true}={}){
  normalizeRole(p);
  const title=selectedTitle(p);
  w.int(p.id).string(p.name).string('本地单机角色').string(title?.name||'')
    .byte(p.sex).byte(p.race).byte(p.job).byte(p.level).byte(p.level2||0).int(p.exp2||0).int(p.expMax2??100)
    .long(p.icon1).long(p.icon2).long(p.icon3).int(actorSettings(p)).int(1).byte(0)
    .int(-1) // no country
    .int(p.exp).int(p.expMax).int(p.hp).int(p.mp).short(p.attributePoints||0).int(p.skillPoints||0)
    .short(p.baseStats[0]).short(p.baseStats[1]).short(p.baseStats[2]).short(p.baseStats[3]).short(p.baseStats[4])
    .int(p.gold||0).int(p.silver||0).int(p.coins).byte(p.bagPages||24).byte(p.storageSlots||24)
    .int(0).int(p.cityUnlocked?1000:-1).int(p.battles.wins).int(0).int(0).byte(0).int(-1).string('').string('');
  w.int(0).int(0).int(0).int(combatRating(p).total);
  for(const key of importedCombatFields)w.int(p.importedCombatModifiers?.[key]||0);
  w.byte(localVipLevel(p)).byte(localVipLevel(p)).byte(0).byte(p.autoSkillIds?.length||0);
  for(const id of p.autoSkillIds||[])w.short(id);
  w.short(p.initiativeSkillId??-1);const sets=setAttributeData(p);w.byte(sets.length);for(const value of sets)w.short(value);
  w.short(0).short(0).short(title?.power1||0).short(title?.value1||0).short(title?.power2||0).short(title?.value2||0);
  w.byte(0).int(0).byte(0);
  petDetail(w,activePet(p)).byte(0); // no hired mercenaries
  if(includeLegion)legionAppearance(w,p);else w.byte(0);
  return w.bool(false).int(p.bagLimit||24).byte(0).string('0').string('0');
}
export function worldData(p,detail=true){
  normalizeRole(p);
  const w=new Writer();
  const city=isPersonalCity(p.mapId)?cityState(p):null;
  const flags=(detail?2|4|8|16|32:0)|256|1024|2048|4096|(city?32768:0);
  w.int(p.mapId||1).byte(p.x??19).byte(p.y??15).int(flags);
  if(detail){playerDetail(w,p);w.bytes(missionBits(p));missionsPacket(w,p);bagPacket(w,p);skillList(w,p);}
  w.string(maps[p.mapId].name).string('').byte(0);
  // 永泽塔按层现场生成编队（不在任何地图的 spawn 里），挑战期间要把那一组一起下发，
  // 否则客户端 World.toBattle(group) 找不到组、会改发 12503 远程战斗。
  // 无限试炼的编队同样不在任何地图上，挑战期间要一起下发（trialExtraGroups 内部
  // 会先确认这一组真的存在，避免存档里残留的标记把整包写歪 → 客户端 Error #1025）。
  const extra=[...towerExtraGroups(p),...trialExtraGroups(p)];
  npcPacket(w,p);monsterGroups(w,p,extra);monsterModels(w,p,extra);
  if(city)w.int(p.id).string(city.name).int(city.prosperity).int(city.army).byte(0).byte(city.level-1);
  return w;
}
export function enterWorld(p){
  const w=new Writer().byte(0).int(0)
    .byte(2).int(0) // forget skill cost
    .byte(2).int(0).int(0) // attribute reset
    .byte(2).int(0) // country activation
    // 宠物改名费用：byte 货币类型 + short 金额。金额 0 = 免费（单机版约定），
    // 客户端 getPetChangeNameMoneyText() 在金额 <= 0 时不显示费用行。
    // 与 15511（lib/pet-rename-service.mjs）是同一条链：那边收改名请求、这边报价格。
    .byte(2).short(0) // pet rename
    .byte(2).int(0); // partner cost
  return w.raw(worldData(p).done());
}

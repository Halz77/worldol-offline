import {vipBenefits} from './home-feature-data.mjs';
import {nativeCharacterPowers} from './native-character-stats.mjs';
import {hpMax,mpMax} from './content.mjs';
import {equipment} from './restoration.mjs';
import {itemWithAffixes} from './item-affixes.mjs';
import {activePet,petAttributes} from './pet-state.mjs';

export function battleRecoveryPercent(p){
 const bag=nativeCharacterPowers(p).equipment(98),spirit=p.inventory?.find(i=>i.slot===17);
 let recordedSpirit=0;
 if(spirit&&spirit.itemId>=41000&&spirit.itemId<=41008){const item=itemWithAffixes(equipment.get(spirit.itemId),spirit);for(const n of [1,2,3])if(item?.['power'+n]===98)recordedSpirit+=item['powerValue'+n]||0;}
 return Math.max(0,bag-recordedSpirit+vipBenefits(p).recoveryPercent);
}
export function applyBattleRecovery(p){
 // The offline rule restores every participating role and its equipped pet,
 // including fallen units, after rewards have updated their level/stat caps.
 const before=[p.hp,p.mp];
 p.hp=hpMax(p);p.mp=mpMax(p);
 const recovery={hp:p.hp-before[0],mp:p.mp-before[1]},pet=activePet(p);
 if(pet){
  const max=petAttributes(p,pet);
  recovery.pet={hp:max.hp-pet.hp,mp:max.mp-pet.mp};
  pet.hp=max.hp;pet.mp=max.mp;
 }
 return recovery;
}

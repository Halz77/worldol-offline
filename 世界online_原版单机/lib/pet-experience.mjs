import {official} from './official-data.mjs';
import {petCatalog} from './pet-catalog.mjs';
const templates=new Map((official.petContent?.pets||[]).map(p=>[p.eggId,p]));
export const PET_EXPERIENCE_DIVISOR=petCatalog.rules.experienceDivisor;
// Always derive from source data, never divide a value already saved by a
// previous version. Reopening a pet or reloading a save cannot reduce it again.
export function requiredPetExperience(pet){
 if(pet.level>=97)return 0;
 const base=templates.get(pet.eggId)?.expTable[pet.level]??petCatalog.expTable[pet.level];
 if(!Number.isFinite(base)||base<=0)throw Error('缺少该等级的宠物升级经验。');
 return Math.max(1,Math.ceil(base/PET_EXPERIENCE_DIVISOR));
}
export function normalizePetExperience(pet){
 pet.expMax=requiredPetExperience(pet);
 // Keep accumulated XP and all cultivated state; the next reward settles any
 // surplus against the new thresholds, respecting the owner's level cap.
 return pet;
}

import {officialItems} from './official-data.mjs';
import {petEquipmentDefinition,PET_EQUIPMENT_SLOTS} from './pet-equipment-data.mjs';
import {petEquipmentSkillLevels,petEquipmentSkillIds} from './pet-equipment-skill-levels.mjs';
// A derived view, so books/mentors still train the saved learned levels.
export function petEquipmentSkills(pet){
 const bonuses=new Map(),slots=new Set(),uids=new Set();
 for(const item of pet.equipment||[]){
  if(!Number.isInteger(item.slot)||item.slot<0||item.slot>=PET_EQUIPMENT_SLOTS||slots.has(item.slot))continue;
  const e=petEquipmentDefinition(officialItems.get(item.itemId),item);
  if(uids.has(e.petUid))continue;slots.add(item.slot);uids.add(e.petUid);
  if(e.skill&&e.petEquipSkillLevel>0&&e.petLevel>=e.petLowLevel)bonuses.set(e.skill.id,(bonuses.get(e.skill.id)||0)+e.petEquipSkillLevel);
 }
 const result=[];
 for(const id of [...pet.skills.map(s=>s.id),...[...bonuses.keys()].filter(id=>!pet.skills.some(s=>s.id===id))]){
  const saved=pet.skills.find(s=>s.id===id),base=Math.max(0,(saved?.level||0)-(saved?.addLevel||0)),bonus=(bonuses.get(id)||0)+Math.max(0,(saved?.addLevel||0)-(pet.recordedEquipmentSkillBonuses?.[id]||0));
  if(!petEquipmentSkillIds.has(id)){if(saved)result.push(saved);continue;}
  if(!bonus&&!saved?.addLevel){if(saved)result.push(saved);continue;}
  if(base+bonus<=0)continue;
  const level=Math.min(32,base+bonus);
  if(level===saved?.level){result.push({...saved,addLevel:Math.max(0,level-base)});continue;}
  const data=petEquipmentSkillLevels.get(`${id}:${level}`);if(!data){if(saved)result.push(saved);continue;}
  result.push({...data,addLevel:Math.max(0,level-base)});
 }
 return result;
}

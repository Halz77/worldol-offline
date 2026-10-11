import fs from 'node:fs';
export const petEquipmentSkillData=JSON.parse(fs.readFileSync(new URL('../data/pet-equipment-skills32.json',import.meta.url),'utf8'));
export const petEquipmentSkillLevels=new Map(petEquipmentSkillData.skills.map(s=>[`${s.id}:${s.level}`,s]));
export const petEquipmentSkillIds=new Set(petEquipmentSkillData.skills.map(s=>s.id));

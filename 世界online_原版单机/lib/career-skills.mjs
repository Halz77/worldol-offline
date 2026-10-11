import fs from 'node:fs';

export const careers=JSON.parse(fs.readFileSync(new URL('../data/career-skills.json',import.meta.url),'utf8'));
export const careerSkills=new Map(careers.skills.map(s=>[s.id,s]));
export const careerDirectory=fs.readFileSync(new URL('../data/career-skill-directory.json',import.meta.url),'utf8');
export const canonicalLegacySkill=id=>careers.aliases[id]??id;

// Old community imports used IDs now occupied by native hammer/fan skills.
// Migrate once, from a snapshot, so swaps/collisions cannot destroy learned levels.
export function migrateCareerSkills(p){
 p.restoration??={};
 if(p.restoration.careerSkills===careers.version)return;
 const before={...(p.skills||{})},after={};
 for(const [id,level] of Object.entries(before)){
  const target=canonicalLegacySkill(Number(id));after[target]=Math.max(after[target]||0,level);
 }
 const remap=id=>Object.hasOwn(before,id)?canonicalLegacySkill(id):id;
 p.skills=after;p.autoSkillIds=(p.autoSkillIds||[]).map(remap);p.initiativeSkillId=remap(p.initiativeSkillId??-1);
 p.restoration.careerSkills=careers.version;
}

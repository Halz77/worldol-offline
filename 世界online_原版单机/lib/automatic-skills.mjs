export const automaticSkillRevision='automatic-skills-expand-v1';

// Only available round skills can occupy the rotation. Compact stale slots and
// duplicates while keeping existing spare slots for native client compatibility.
export function automaticSkillSlots(ids,skills){
 const valid=new Set(skills.filter(s=>s.type===2).map(s=>s.id));
 const current=Array.isArray(ids)?ids:[],chosen=[...new Set(current.filter(id=>valid.has(id)))];
 return chosen.concat(Array(Math.max(0,current.length-chosen.length)).fill(0));
}

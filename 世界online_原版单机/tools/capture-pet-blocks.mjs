export function readPetDetail(r,d){
 const index=r.getByte();if(index<0)return null;
 r.getString(); // An individual pet can be renamed; never export that name.
 const p={level:r.getByte(),icon:r.getLong().toJSON(),hp:r.getInt(),mp:r.getInt(),exp:r.getInt(),expMax:r.getInt(),sp:r.getInt()};
 p.baseStats=Array.from({length:5},()=>r.getShort());p.grow=r.getByte();p.comprehension=r.getByte();p.cp=r.getByte();p.growLevel=r.getByte();
 p.lifeMs=r.getLong().toNumber();p.hit=r.getShort();p.attackType=r.getByte();p.attackMin=r.getShort();p.attackMax=r.getShort();p.attackTimes=r.getByte();p.job=r.getByte();p.grade=r.getByte();
 p.autoSkills=Array.from({length:r.getByte()&255},()=>r.getShort());p.initiativeSkill=r.getShort();p.skills=Array.from({length:r.getShort()&65535},()=>d.Skill.fromBytes(r));
 p.vipLevel=r.getByte();p.bornStatus=r.getLong().toJSON();p.headIcon=r.getShort();p.model=r.getInt();
 if(r.getByte()!==0)throw Error('Pet equipment definitions need a separate parser');
 for(let n=r.getShort();n>0;n--){const id=r.getInt(),addLevel=r.getByte(),skill=p.skills.find(s=>s.id===id);if(skill)skill.addLevel=addLevel;}
 return p;
}
export function readPetLevelReward(r,d){
 const out={exp:r.getInt(),levels:r.getByte()};
 if(out.levels){out.sp=r.getShort();out.growLevels=r.getByte();out.stats=out.growLevels?Array.from({length:5},()=>r.getShort()):[0,0,0,0,0];out.currentExp=r.getInt();out.expMax=r.getInt();out.cp=r.getByte();out.skills=Array.from({length:r.getByte()&255},()=>d.Skill.fromBytes(r));}
 return out;
}

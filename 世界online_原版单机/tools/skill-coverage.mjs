// Coverage counts observed definitions only. A gap is never filled by interpolation.
export function referenceLevel(value) {
  const matches=[...String(value?.name||'').matchAll(/(\d+)\s*级/g)];
  if(matches.length!==1)return null;
  const level=Number(matches[0][1]);
  return level>0&&level<=1000?level:null;
}

export function referenceCoverage(row) {
  const entries=[row.raw,...(row.raw.children?.skillLevel||[])];
  const known=[...new Set(entries.map(referenceLevel).filter(n=>n!==null))].sort((a,b)=>a-b);
  const highestListed=known.at(-1)||null;
  const missingThroughListed=highestListed?Array.from({length:highestListed},(_,i)=>i+1).filter(n=>!known.includes(n)):[];
  return {known,highestListed,missingThroughListed,unknownLevelEntries:entries.filter(e=>referenceLevel(e)===null).length,completeThroughListed:!!highestListed&&!missingThroughListed.length};
}

export function skillCoverage(skills,references) {
  const groups=new Map();
  for(const skill of skills){const group=groups.get(skill.id)||[];group.push(skill);groups.set(skill.id,group);}
  const official=[...groups].map(([id,rows])=>{
    const known=[...new Set(rows.map(s=>s.level))].sort((a,b)=>a-b);
    const teacherRows=rows.filter(s=>s.sources?.some(x=>x.origin==='shop'||x.origin==='learned-definition'));
    const teacherKnown=[...new Set(teacherRows.map(s=>s.level))].sort((a,b)=>a-b);
    const maxLevel=Math.max(0,...rows.map(s=>s.maxLevel||0))||null;
    const missing=maxLevel?Array.from({length:maxLevel},(_,i)=>i+1).filter(n=>!known.includes(n)):[];
    return {id,name:rows[0].name,known,teacherKnown,maxLevel,missing,completeToServerMax:maxLevel!==null&&missing.length===0};
  }).sort((a,b)=>a.id-b.id);
  const reference=references.map(row=>({recordId:row.record_id,name:row.name,group:row.group,sourcePointer:row.source_pointer,...referenceCoverage(row)}));
  return {
    schema:1,generatedAt:new Date().toISOString(),clientVersion:305,
    allSkillsKnown:false,allSkillLevelsKnown:false,
    counts:{official:{skillIds:official.length,levelRecords:official.reduce((n,r)=>n+r.known.length,0),withServerMax:official.filter(r=>r.maxLevel!==null).length,completeToServerMax:official.filter(r=>r.completeToServerMax).length,expectedLevelsForKnownMax:official.reduce((n,r)=>n+(r.maxLevel||0),0),missingLevelsForKnownMax:official.reduce((n,r)=>n+r.missing.length,0)},reference:{records:reference.length,nestedEntries:references.reduce((n,r)=>n+(r.raw.children?.skillLevel?.length||0),0),levelRecords:reference.reduce((n,r)=>n+r.known.length,0),completeThroughListed:reference.filter(r=>r.completeThroughListed).length,partial:reference.filter(r=>r.missingThroughListed.length).length,withoutNumericLevel:reference.filter(r=>!r.known.length).length}},
    official,reference,
    limits:['正式服技能按编号和等级去重；装备附带、导师、角色数据保留来源。','有服务器最高等级的技能可以统计缺级；其余技能的完整范围未知。','社区按原始条目和等级去重，同名或不同流派不会合并。','社区的最高列出等级不代表正式服最高等级；连续列出也不代表 v305 已核验。','没有用公式、插值或同名匹配补出未采集属性。']
  };
}

import {lazyBox,lazyJson} from './lazy-data.mjs';
import {official} from './official-data.mjs';
import {applyRecordedExpansionEvents} from './recorded-expansion.mjs';

/**
 * 已录制的公开内容（17.4 MB）+ 六张派生索引表。
 *
 * 这一份几乎全部服务于「录制内容 / 宠物与称号」面板，但以前模块顶层的
 * eager 解析 + 一堆 `new Map(...)` 让它进了每一个连接的服务端堆（架构评审 P1-1）。
 * 现在整套派生都放进 ensure()，导出走惰性代理；使用方代码不变。
 *
 * 注意 `recorded` 是惰性代理：`applyRecordedExpansionEvents(recorded)` 会往
 * `recorded.questEvents` 里 push，代理的 get/set 会原样转发到真值数组，行为一致。
 */
export const recorded=lazyJson(new URL('../data/recorded-content.json',import.meta.url),'recorded');

let built=null;
function ensure(){
 if(built)return built;
 // These are public definitions, never a restored official account/session.
 applyRecordedExpansionEvents(recorded);
 const recordedTitles=new Map(recorded.titles.map(t=>[t.id,t]));
 const recordedPets=new Map(recorded.pets.map(p=>[p.id,p]));
 const observedNames=new Map(recorded.petSnapshots.filter(p=>p.speciesName).map(p=>[p.model,p.speciesName]));
 const recordedPetSamples=new Map(recorded.petSnapshots.map((p,i)=>[-i-1,{...p,id:-i-1,speciesName:p.speciesName||recordedPets.get(p.model)?.name||observedNames.get(p.model)||`宠物 ${p.model}`,name:(p.speciesName||recordedPets.get(p.model)?.name||observedNames.get(p.model)||'已录制宠物')+` · ${p.level}级样本`,description:'保留本次实际宠物的品质、成长、技能与装备；不同样本不是连续升级公式。'}]));
 const builds=new Map();
 for(const p of recordedPetSamples.values())if(p.level===97&&p.model>0&&p.skills.length){
  const signature=petBuildSignature(p),old=builds.get(signature),at=v=>Math.max(0,...(v.sources||[]).map(s=>Date.parse(s.at)||0));
  if(!old||at(p)>at(old))builds.set(signature,p);
 }
 const buildCounts=new Map(),buildIndexes=new Map();
 for(const p of builds.values())buildCounts.set(p.model,(buildCounts.get(p.model)||0)+1);
 const recordedFinishedPets=new Map([...builds.values()].map(p=>{
  const configuration=(buildIndexes.get(p.model)||0)+1;buildIndexes.set(p.model,configuration);
  return [p.id,{...p,name:`${p.speciesName} · 97级${buildCounts.get(p.model)>1?' · 配置'+configuration:''}`,configuration,shopLifeDays:100,description:'成品宠物：保留实际录制的品质、成长、技能配置和已有装备。免费购买后恢复100天寿命，需要人物97级出战。'}];
 }));
 const petSources=new Map([...recordedPets,...recordedPetSamples,...recordedFinishedPets]);
 built={
  recordedTitles,
  recordedPets,
  recordedPetSamples,
  recordedFinishedPets,
  petSources,
  recordedPetSkills:new Map(recorded.petSkills.map(s=>[`${s.id}:${s.level}`,s])),
  recordedSummary:{revision:recorded.revision,captures:new Set([...recorded.captures,...(recorded.petImports||[])].map(c=>c.id)).size,sets:recorded.sets.length,titles:recorded.titles.length,pets:recorded.pets.length,petSkills:recorded.petSkills.length,petEggs:recorded.petEggs.length,petEquipment:recorded.petEquipment.length,gems:recorded.gems.length,vipRecords:recorded.vip.length},
 };
 return built;
}

export const recordedTitles=lazyBox(()=>ensure().recordedTitles,'recordedTitles');
export const recordedPets=lazyBox(()=>ensure().recordedPets,'recordedPets');
export const recordedPetSamples=lazyBox(()=>ensure().recordedPetSamples,'recordedPetSamples');
export const recordedFinishedPets=lazyBox(()=>ensure().recordedFinishedPets,'recordedFinishedPets');
export const petSources=lazyBox(()=>ensure().petSources,'petSources');
export const recordedPetSkills=lazyBox(()=>ensure().recordedPetSkills,'recordedPetSkills');
export const recordedSummary=lazyBox(()=>ensure().recordedSummary,'recordedSummary');

// Ignore remaining life, current HP/MP and XP when deduplicating repeated views
// of the same build. Skill assignments, bonuses and equipment remain distinct.
export function petBuildSignature(p){
 const fields=['model','icon','headIcon','level','attributes','grow','comprehension','cp','growLevel','sp','hit','attackType','attackMin','attackMax','attackTimes','job','grade','autoSkills','initiativeSkill','vipLevel','bornStatus'];
 return JSON.stringify({...Object.fromEntries(fields.map(k=>[k,p[k]])),skills:[...p.skills].sort((a,b)=>a.id-b.id),equipment:[...(p.equipment||[])].sort((a,b)=>a.slot-b.slot)});
}
export const selectedTitle=p=>p.importedTitle?.id===p.titleId?p.importedTitle:ensure().recordedTitles.get(p.titleId);
export function titlePowers(p){const t=selectedTitle(p);return t?[[t.power1,t.value1],[t.power2,t.value2]].filter(([id])=>id>0):[];}
export function restoreRecordedPetEquipment(p){
 // Earlier saves retained the slot and catalog ID but dropped the observed
 // equipment level/affixes. Restore only an unchanged recorded equipment set.
 const {petSources}=ensure();
 const source=petSources.get(p.templateId),signature=rows=>JSON.stringify((rows||[]).map(i=>[i.slot,i.itemId]).sort((a,b)=>a[0]-b[0]));
 if(!source?.equipment?.length||signature(source.equipment)!==signature(p.equipment))return;
 for(const i of p.equipment){
  if(i.petEquipment||i.recordedDefinition)continue;
  const e=recorded.petEquipment.find(e=>e.id===i.itemId&&e.petLevel>0);if(!e)continue;
  const definition=structuredClone(e);delete definition.sources;delete definition.variants;delete definition.wireBase64;
  i.recordedDefinition={...definition,imported:true};
 }
 if(!p.recordedEquipmentSkillBonuses){p.recordedEquipmentSkillBonuses={};for(const item of p.equipment){const e=item.recordedDefinition;if(e?.skill&&e.petEquipSkillLevel)p.recordedEquipmentSkillBonuses[e.skill.id]=(p.recordedEquipmentSkillBonuses[e.skill.id]||0)+e.petEquipSkillLevel;}}
}
export function petFromRecord(template){
 const p=structuredClone(template);delete p.sources;delete p.variants;
 p.baseStats=['strength','constitution','agility','intelligence','wisdom'].map(k=>p.attributes[k]);
 p.templateId=p.id;delete p.id;p.expiresAt=Date.now()+(p.shopLifeDays?p.shopLifeDays*86400000:Math.max(0,Number(p.lifeMs)));
 p.equipment=(p.equipment||[]).map(i=>({slot:i.slot,itemId:i.itemId,quantity:1,bound:true}));
 restoreRecordedPetEquipment(p);
 return p;
}
export function petBagAppearance(p){
 const id=p.templateId>0?p.templateId:p.model;
 const catalog=official.catalog.find(x=>x.itemId===id&&x.sources.some(s=>s.group===3&&[7,8,9].includes(s.type)))||official.catalog.find(x=>String(x.icon)===String(p.headIcon)&&x.grade===p.grade&&x.sources.some(s=>s.group===3&&[7,8,9].includes(s.type)));
 return {bagIcon:Number(catalog?.bagIcon)||1001,autoBinding:0};
}
// Never treat a level-one preview as a complete random growth curve.
export const growthNotice='宠物资料优先保留抓包值，缺失品质、技能等级与成长曲线已按单机规则推算；传说宠物蛋等概率孵化1级传说及进化宠物。';

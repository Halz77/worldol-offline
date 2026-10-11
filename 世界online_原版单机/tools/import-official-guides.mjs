import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readGuideCapture,mergeGuide,guideSkills,guideTasks} from './guide-core.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),captureRoot=path.resolve(root,'../正式服录制数据');
const pages=[],snapshots=[];
const folders=process.argv.slice(2).length?process.argv.slice(2):fs.readdirSync(captureRoot).map(f=>path.join(captureRoot,f));
for(const folder of folders.sort()){
 if(!fs.existsSync(path.join(folder,'status.json')))continue;
 const result=readGuideCapture(folder);for(const p of result.pages)mergeGuide(pages,p);if(result.snapshot.responses)snapshots.push(result.snapshot);
}
const collectionFile=path.resolve(root,'../正式服录制工具/collection/catalog-v305.json');
if(fs.existsSync(collectionFile)){
 const collection=JSON.parse(fs.readFileSync(collectionFile,'utf8'));
 for(const page of collection.guidePages||[])if(!pages.some(p=>p.id===page.id)){
  // Automatic collection is still sourced from the same archived frames above;
  // never import the collector's in-memory result as independent evidence.
  throw Error('Collected guide page is absent from verified capture: '+page.id);
 }
}
const skills=JSON.parse(fs.readFileSync(path.join(root,'data/catalog-skills.json'),'utf8')),records=guideSkills(pages,skills),pending=guideTasks(pages);
const career=pages.find(p=>p.title==='职业技能'),professions=(career?.entries||[]).filter(e=>e.type===0).map(e=>({name:e.name.replace(/技能$/,''),pageId:e.id,records:records.filter(r=>r.profession===e.name.replace(/技能$/,'')).length,categories:[...new Set(records.filter(r=>r.profession===e.name.replace(/技能$/,'')).map(r=>r.category))]}));
const result={schema:1,clientVersion:305,generatedAt:new Date().toISOString(),sourceKind:'official-guide-text',snapshots,pages,records,pending,professions,counts:{pages:pages.length,skillDescriptions:records.length,professions:professions.length,skillCategoryPages:new Set(records.map(r=>r.pageId)).size,visiblePendingPages:pending.length},limits:['Guide entry IDs are menu IDs, not skill IDs.','Matching skill IDs are candidates based on name and type; numeric combat definitions are separate.','Level-22 text does not provide levels 2-21 or unlisted combat parameters.']};
result.verification={allListedCareerCategoriesCollected:professions.length>0&&pending.length===0&&professions.every(p=>['被动','自动','主动'].every(type=>p.categories.includes(type))),allRecordsLevel22:records.every(r=>r.level===22),emptyDescriptions:records.filter(r=>!r.content).length,uniqueNameTypeMatches:records.filter(r=>r.matchingSkillIds.length===1).length,missingNameTypeMatches:records.filter(r=>r.matchingSkillIds.length===0).length,ambiguousNameTypeMatches:records.filter(r=>r.matchingSkillIds.length>1).length,allCombatDefinitionsReady:false};
const file=path.join(root,'data/official-guides.json');fs.writeFileSync(file+'.tmp',JSON.stringify(result,null,2)+'\n');fs.renameSync(file+'.tmp',file);
const report={generatedAt:result.generatedAt,counts:result.counts,verification:result.verification,professions,pending,snapshots,limits:result.limits};fs.writeFileSync(path.join(root,'analysis/official-guide-coverage.json'),JSON.stringify(report,null,2)+'\n');
const table=professions.map(p=>`| ${p.name} | ${['被动','自动','主动'].map(type=>records.filter(r=>r.profession===p.name&&r.category===type).length).join(' | ')} | ${p.records} |`).join('\n');
fs.writeFileSync(path.join(root,'analysis/全职业22级技能采集核验.md'),`# 正式服职业攻略22级技能\n\n采集范围：正式服游戏内“攻略 → 职业技能”可见目录。${professions.length} 个职业，${result.counts.skillCategoryPages} 个技能分类页面，${records.length} 条效果说明。当前已发现目录待采集 ${pending.length} 页。\n\n| 职业 | 被动 | 自动 | 主动 | 合计 |\n|---|---:|---:|---:|---:|\n${table}\n\n每条保留正式服原文、已列出的效果/消耗/范围/回合/武器限制、请求响应序号和 SHA256。所有已用攻略回包均配对校验并读取至包尾；正在录制的会话以完整日志行的快照为准。\n\n名称与类型匹配：${result.verification.uniqueNameTypeMatches} 条对应一个已录技能编号，${result.verification.missingNameTypeMatches} 条尚无同名同类型定义，${result.verification.ambiguousNameTypeMatches} 条对应多个编号。攻略菜单编号单独保存，不直接当技能编号使用。\n\n这批是22级攻略说明，尚未全部接入本地战斗；未列出的参数和2–21级数据不由22级推算。\n\n[本地资料库](http://127.0.0.1:8779/catalog?kind=skill&source=guide)\n\n数据：data/official-guides.json；核验：analysis/official-guide-coverage.json；导入：tools/import-official-guides.mjs。\n`);
console.log(JSON.stringify(report,null,2));

import fs from 'node:fs';
import path from 'node:path';
import {root} from './catalog-core.mjs';
import {fields,percentField} from '../lib/reference-fields.mjs';
import {powerFormatter} from './catalog-format.mjs';
import {skillCoverage,referenceCoverage} from './skill-coverage.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const official=read(path.join(root,'data/official-v305.json')),skills=read(path.join(root,'data/catalog-skills.json'));
const guideFile=path.join(root,'data/official-guides.json'),guides=fs.existsSync(guideFile)?read(guideFile):null;
const progressionFile=path.join(root,'data/skill-progression.json'),progression=fs.existsSync(progressionFile)?read(progressionFile):null;
const report=read(path.join(root,'analysis/catalog-coverage.json')),source=path.resolve(root,'../网络攻略资料_20260920/整理数据');
const powerNames=Object.fromEntries(Object.entries(fields).map(([k,[id,label]])=>[id,{label:label.split('|')[0],percent:percentField(k)}]));
const grades=['普通','精致','稀有','史诗','传说'];
const summaryPower=powerFormatter(root);
const isWeapon=d=>(d.type>=13&&d.type<=24)||(d.type>=34&&d.type<=39);
const itemLines=d=>[...(isWeapon(d)?[`攻击 ${d.atkMin}–${d.atkMax}`,`命中 ${d.hitrate&255}`,`攻击次数 ${d.atk_time+1}`]:[]),d.durMax?`耐久 ${d.durMax}`:'',...[['reqLv','需要等级'],['reqStr','需要力量'],['reqCon','需要体质'],['reqAgi','需要敏捷'],['reqIlt','需要智力'],['reqWis','需要感知']].filter(([key])=>d[key]).map(([key,label])=>`${label} ${d[key]}`),...[1,2,3,4,5,6,7].filter(n=>d['power'+n]).map(n=>(n>=4?'进阶：':'')+summaryPower(d['power'+n],d['powerValue'+n])),...[1,2].filter(n=>d['bindPower'+n]).map(n=>'绑定后：'+summaryPower(d['bindPower'+n],d['bindPowerValue'+n]))].filter(Boolean);
const rows=[],details=new Map(official.items.map(i=>[i.id,i])),ranges=new Map((official.identification||[]).map(x=>[x.itemId,{...x,slots:x.slots.map(slot=>({...slot,options:slot.options.map(p=>({...p,description:p.min===p.max?summaryPower(p.power,p.min):`${summaryPower(p.power,p.min)} ～ ${summaryPower(p.power,p.max)}`}))}))}]));
for(const item of official.catalog){const d=details.get(item.itemId);rows.push({key:'item:'+item.itemId,kind:'equipment',id:item.itemId,name:item.name,source:'official',status:d?'detail':'catalog',grade:grades[item.grade]||'',level:d?.reqLv,type:d?.type??item.type,info:d?.info||item.info,detail:d||null,range:ranges.get(item.itemId)||null,lines:d?itemLines(d):[]});}
for(const d of official.items.filter(i=>!official.catalog.some(x=>x.itemId===i.id)))rows.push({key:'item:'+d.id,kind:'equipment',id:d.id,name:d.name,source:'official',status:'detail',grade:grades[d.grade]||'',level:d.reqLv,type:d.type,info:d.info,detail:d,range:ranges.get(d.id)||null,lines:itemLines(d)});
for(const s of skills)rows.push({key:`skill:${s.id}:${s.level}`,kind:'skill',id:s.id,name:s.name,source:'official',status:'detail',level:s.level,type:s.type,group:s.sources.some(x=>x.origin==='learned-definition'||x.origin==='shop'&&x.shopId<2000)?'角色技能':s.sources.some(x=>x.origin==='shop'&&x.shopId>=2000&&x.shopId<4000)?'宠物技能':s.sources.some(x=>x.origin==='equipment-skill')?'装备附带技能':'战斗技能',info:s.info,detail:s,lines:[`法力消耗 ${s.useMP||0} · 生命消耗 ${s.useHP||0}`,...[1,2,3].filter(n=>s['power'+n]).map(n=>summaryPower(s['power'+n],s['powerValue'+n],s))]});
const skillReferences=read(path.join(source,'技能索引.json')).records.filter(x=>x.versions.includes('世界H5'));
for(const g of guides?.records||[])rows.push({key:g.key,kind:'skill',name:g.name,source:'guide',status:'guide',level:g.level,type:g.type,group:`${g.profession} · ${g.category}技能`,info:'正式服游戏内攻略的技能效果说明。',lines:g.effects.map(e=>`效果${e.index}：${e.description}`).concat((g.parameters||[]).map(f=>`${f.label}：${f.value}`)),detail:g});
for(const s of progression?.skills||[])rows.push({key:s.key,kind:'skill',name:s.name,source:'progression',status:'progression',type:s.type,group:`${s.profession} · ${s.category}技能`,detail:s});
for(const [name,kind] of [['装备索引','equipment'],['技能索引','skill']])for(const row of read(path.join(source,name+'.json')).records.filter(x=>x.versions.includes('世界H5'))){const r=row.raw;rows.push({key:'reference:'+row.record_id,kind,name:row.name,source:'reference',status:'reference',group:row.group,mode:row.mode,grade:r.quality||'',level:r.levelLimits,info:r.describe,lines:r.attribute||r.skillAttribute||[],reference:r,...(kind==='skill'?{levelCoverage:referenceCoverage(row)}:{}),sourcePointer:row.source_pointer,sourceURL:'https://github.com/treefuture/world-online/tree/main/JSON_Data'});}
const coverage=skillCoverage(skills,skillReferences);
const result={schema:1,generatedAt:new Date().toISOString(),counts:report.counts,skillLevels:report.skillLevels,skillCoverage:{counts:coverage.counts,official:coverage.official},guideCoverage:guides?{counts:guides.counts,professions:guides.professions,pending:guides.pending}:null,progression:progression?{...progression,skills:undefined}:null,referenceCounts:{equipment:rows.filter(r=>r.source==='reference'&&r.kind==='equipment').length,skills:rows.filter(r=>r.source==='reference'&&r.kind==='skill').length},powerNames,rows,limits:report.limits};
const file=path.join(root,'data/content-library.json');fs.writeFileSync(file,JSON.stringify(result)+'\n');console.log(JSON.stringify({file,rows:rows.length,official:report.counts,reference:result.referenceCounts}));

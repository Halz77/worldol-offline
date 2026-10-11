import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {simple} from 'acorn-walk';
import {decoders} from './capture-decoders.mjs';
import {powerFormatter} from './catalog-format.mjs';
import {projectSkill,COST_POLICY,MODEL_VERSION} from './skill-projection-core.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>JSON.parse(fs.readFileSync(path.resolve(root,p),'utf8').replace(/^\uFEFF/,''));
const guides=read('data/official-guides.json'),catalog=read('data/catalog-skills.json');
const referenceFile='../网络攻略资料_20260920/整理数据/技能索引.json',references=read(referenceFile).records;
const d=decoders(root),format=powerFormatter(root),texts={...d.constants};
simple(parse(fs.readFileSync(path.join(root,'analysis/modules/0004.js'),'utf8'),{ecmaVersion:'latest'}),{AssignmentExpression(n){
 if(n.left.type==='MemberExpression'&&['bufferText','skillAreaText','skillWeaponText','AtkTypeText'].includes(n.left.property.name)&&n.right.type==='ArrayExpression')
  texts[n.left.property.name]=n.right.elements.map(x=>x.value);
}});
for(const name of ['bufferText','skillAreaText','skillWeaponText','AtkTypeText'])if(!texts[name]?.length)throw Error('Native text table missing: '+name);
const bufferString=d.native(4,'getBufferString',{e:texts});
function nativeDisplay(s){
 const effects=[];
 for(const i of [1,2,3])if(s['power'+i]){
  const value=s['powerValue'+i],status=s['statusBit'+i];
  const text=[value?format(s['power'+i],value,s):'',status?bufferString(status):''].filter(Boolean).join('，');
  if(text)effects.push({index:i,text,origin:'official-definition'});
 }
 const parameters=[],p=(label,value)=>parameters.push({label,text:String(value),origin:'official-definition'});
 if(s.type!==1){p('消耗法力值',s.useMP||0);p('消耗生命值',s.useHP||0);p('持续回合',s.round||0);p('攻击次数',(s.atk_time||0)+1);p('技能类型',texts.AtkTypeText[s.skillAtkType]??'原版未命名类型');p('技能范围',texts.skillAreaText[s.area]??'原版未命名范围');}
 p('需求武器',texts.skillWeaponText[s.skillWeapon]??'原版未命名限制');
 return {level:s.level,origin:'official-definition',effects,parameters};
}
const native=catalog.map(s=>({...s,display:nativeDisplay(s)}));
const skills=guides.records.map(g=>projectSkill(g,native,references));
const countOrigins=rows=>rows.reduce((a,l)=>(a[l.origin]=(a[l.origin]||0)+1,a),{});
const levels=skills.flatMap(s=>s.levels),professions=[...new Set(skills.map(s=>s.profession))].map(name=>{
 const rows=skills.filter(s=>s.profession===name);return {name,skills:rows.length,levels:rows.length*22,origins:countOrigins(rows.flatMap(s=>s.levels))};
});
const counts={professions:professions.length,skills:skills.length,levelRecords:levels.length,origins:countOrigins(levels),
 skillsWithH5Reference:skills.filter(s=>s.reference?.versions.includes('世界H5')).length,
 skillsWithOtherVersionReference:skills.filter(s=>s.reference&&!s.reference.versions.includes('世界H5')).length,
 skillsWithoutReference:skills.filter(s=>!s.reference).length,
 resolvedNativeIds:skills.filter(s=>s.identity.id!==null).length,
 recordedDefinitions:levels.filter(l=>l.completeCombatDefinition).length,
 rawShopQuotes:levels.reduce((n,l)=>n+l.learning.observed.length,0),
 priceRowsWithObservedQuote:levels.filter(l=>l.learning.own.origin==='observed-quote'||l.learning.cross.origin==='observed-quote').length,
 priceRowsEstimated:levels.filter(l=>l.learning.own.origin==='estimated'&&l.learning.cross.origin==='estimated').length,
 conflicts:skills.reduce((n,s)=>n+s.conflicts.length,0),anomalies:skills.reduce((n,s)=>n+s.anomalies.length,0)};
for(const s of skills){
 if(s.levels.length!==22||s.levels.some((l,i)=>l.level!==i+1))throw Error('Non-contiguous skill '+s.key);
 for(const l of s.levels){if(!l.effects.length)throw Error('Empty effects '+s.key+' '+l.level);
  for(const mode of ['own','cross'])for(const key of ['sp','copper','goldLeaves','gold'])if(!Number.isSafeInteger(l.learning[mode][key])||l.learning[mode][key]<0)throw Error('Invalid cost '+s.key);
 }
}
const snapshot=f=>({file:f,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.resolve(root,f))).digest('hex')});
const result={schema:1,modelVersion:MODEL_VERSION,generatedAt:new Date().toISOString(),scope:'九个职业的正式服攻略目录；不包括宠物、怪物和全部装备专属技能',
 counts,professions,costPolicy:COST_POLICY,sources:[
  {kind:'official-game-guide',...snapshot('data/official-guides.json'),protocol:16005},
  {kind:'official-skill-definitions-and-shop-quotes',...snapshot('data/catalog-skills.json')},
  {kind:'community-dataset',url:'https://github.com/treefuture/world-online/blob/main/JSON_Data/vocationalSkills.json',...snapshot(referenceFile)},
  {kind:'historical-player-fee-bands',url:COST_POLICY.historicalSource,versionMatch:false},
 ],rules:[
  '1–21级有正式回包时保留正式定义；否则使用对应社区逐级条目。22级原文保留正式服攻略。',
  '优先世界H5分支；缺失时比较其他版本与正式服22级及已录等级的数值，保留被选分支及候选列表。跨版本数据仍标待核验。',
  '只有缺失等级才推算：同属性两侧有锚点则线性插值并四舍五入；只有单侧锚点则按等级比例推算。',
  '攻击次数、持续回合、状态、范围、免疫、阈值和武器限制用最近较低等级保持值；只有上级资料则沿用上级，并标低置信度。不会对协议ID或状态位做数值插值。',
  '社区文字与同条结构化数值矛盾时，另给结构化值作为暂定修复并标推算；四个相邻等级证实同一直线上的孤立离群值，另给插值。所有被替代原文保留在冲突记录，其他突变保持原值。正式回包和22级攻略不改。',
  COST_POLICY.explanation,
  '所有推算费用用于本地资料和预算；未自动修改角色余额、已学技能或正式服录制数据。',
 ],skills};
fs.writeFileSync(path.join(root,'data/skill-progression.json'),JSON.stringify(result)+'\n');
const issues=skills.filter(s=>s.conflicts.length||s.anomalies.length||!s.reference||s.identity.id===null).map(s=>({key:s.key,name:s.name,profession:s.profession,identity:s.identity,reference:s.reference,conflicts:s.conflicts,anomalies:s.anomalies}));
fs.writeFileSync(path.join(root,'analysis/skill-progression-audit.json'),JSON.stringify({generatedAt:result.generatedAt,counts,professions,issues},null,2)+'\n');
const table=professions.map(p=>`| ${p.name} | ${p.skills} | ${p.levels} | ${p.origins['official-definition']||0} | ${p.origins['official-guide']||0} | ${p.origins['community-h5']||0} | ${p.origins['community-other-version']||0} | ${p.origins.estimated||0} |`).join('\n');
const sample=skills.find(s=>s.name==='基础掌法');
const costTable=sample.levels.map(l=>{const c=l.learning.own;return `| ${l.level} | ${c.sp} | ${c.copper} | ${c.goldLeaves} | ${c.gold} | ${c.origin==='observed-quote'?'录制报价（上下文需核验）':'推算 / 高级金额本地暂定'} |`;}).join('\n');
const report=`# 全职业技能 1–22 级重建资料\n\n生成时间：${result.generatedAt}\n\n已覆盖九职业攻略目录的 ${counts.skills} 个技能、${counts.levelRecords} 条等级记录。**包含社区资料和推算，不等于全等级正式回包采集完成，也不代表全部技能已接入战斗。**\n\n## 职业覆盖\n\n| 职业 | 技能 | 等级记录 | 正式定义 | 正式22级攻略 | 社区H5 | 社区其他版本 | 推算或暂定修复 |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${table}\n\n## 学习费用\n\n技能点、铜币、金叶、黄金都已列出每级新增消耗和从0级开始的累计消耗，并区分本职业与跨职业。保存了 ${counts.rawShopQuotes} 条人物导师实际报价；${counts.priceRowsEstimated} 条等级价格没有相应正式报价。\n\n本职 SP 使用 5×技能等级，跨职用双倍。低级铜币根据每个技能已录档位推算（存在500、1000、10000铜币基准的差异）；高级金额为明确标记的本地暂定规则。费用不是四种货币同时扣除。默认国家税率0；金叶区、国家税及技能书学习不能由此确定。\n\n${COST_POLICY.explanation}\n\n普通500铜基准示例（基础掌法，本职、0税率）：\n\n| 学到等级 | 本级技能点 | 铜币 | 金叶 | 黄金 | 数据性质 |\n|---:|---:|---:|---:|---:|---|\n${costTable}\n\n到22级累计示例：技能点 ${sample.levels[21].learning.own.total.sp}，铜币 ${sample.levels[21].learning.own.total.copper}，金叶 ${sample.levels[21].learning.own.total.goldLeaves}，黄金 ${sample.levels[21].learning.own.total.gold}。高级金额是预算假设，不是现行正式服价格。\n\n## 推算与冲突处理\n\n${result.rules.map(x=>'- '+x).join('\n')}\n\n有 ${counts.conflicts} 项来源数值差异、${counts.anomalies} 项逐级突变提示，详见同目录 skill-progression-audit.json。每项保留双方原值及来源；不把已知差异伪装成正式校准。\n\n## 查阅与来源\n\n- 本地查询：http://127.0.0.1:8779/catalog?kind=skill&source=progression\n- 完整结构化数据：../data/skill-progression.json\n- 社区逐级技能表：https://github.com/treefuture/world-online/blob/main/JSON_Data/vocationalSkills.json\n- 历史人物费用分段：https://www.962.net/gl/31533.html （旧版资料，现行H5高级金额未核实）\n- 正式回包、攻略：见完整数据中的 sources 和每项 sourceRefs，可追溯至录制文件SHA256。\n`;
fs.writeFileSync(path.join(root,'analysis/全职业技能1-22级重建说明.md'),report);
console.log(JSON.stringify({counts,professions,bytes:fs.statSync(path.join(root,'data/skill-progression.json')).size},null,2));

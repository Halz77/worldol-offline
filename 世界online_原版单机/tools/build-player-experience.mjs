import fs from 'node:fs';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('..',import.meta.url));
const sourceDir=path.join(root,'analysis/experience-sources');
const cells=JSON.parse(fs.readFileSync(path.join(sourceDir,'sheet1.xml.json'),'utf8'));
const recorded=JSON.parse(fs.readFileSync(path.join(root,'data/official-v305.json'),'utf8')).newbie;
const rawRows=cells.slice(1).map(row=>{
 const a=Object.keys(row).find(k=>/^A\d+$/.test(k)),r=a.slice(1);
 return {level:Number(row[a]),total:Number(row['C'+r]),displayedNext:Number(row['B'+r]),cell:`Sheet1!C${r}`};
});
const levels=[];let previous=0,cumulative=0;
for(const row of rawRows.filter(r=>r.level<=97)){
 const requirement=row.total-previous;previous=row.total;
 if(row.level!==levels.length+1||!Number.isSafeInteger(requirement)||requirement<=0)throw Error('Invalid source row '+row.level);
 if(recorded.expTable[row.level]!==undefined&&recorded.expTable[row.level]!==requirement)throw Error('Recording mismatch at level '+row.level);
 levels.push({level:row.level,nextLevel:row.level<97?row.level+1:null,requiredExp:row.level<97?requirement:0,totalExpToReach:cumulative,
  source:row.level===97?'recorded-level-cap':row.level<=15?'recorded-and-community-table':'community-table',
  sourceCell:row.cell,sourceCumulative:row.total,skillPointsOnUpgrade:row.level<97?10*row.level:0,attributePointsOnUpgrade:row.level<97?3:0});
 if(row.level<97)cumulative+=requirement;
}
if(levels.length!==97)throw Error('Incomplete player experience table');
const result={version:1,maxLevel:97,revision:'community-xlsx-aligned-v1',
 source:{title:'人物升级经验.xlsx',url:'https://github.com/treefuture/world-online/blob/main/部分文档收录/人物升级经验.xlsx',
  gitBlob:'13a4f6355d4899af32617336f7c62afcb9ba9629',sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceDir,'人物升级经验.xlsx'))).digest('hex'),
  kind:'player-maintained-public-document',official:false,checkedAt:new Date().toISOString()},
 notes:[
  '工作簿 B 列比录制确认的当前等级升级需求提前一行。使用同等级 C 列减上一行 C 列，1级以0为前值，15个录制等级全部一致。',
  '16—96级采用社区表累计列差值，尚未逐级在正式服录制确认；未使用单机拟合曲线。',
  '同仓库旧图片的40级需求写153200，工作簿差值为163200；图片累计列和部分经验书数量另有算术差异，采用更完整的工作簿。',
  '97级是当前单机及已录正式服上限，经验/需求均为0。表格的98—100级不启用。',
  '技能点升级增量为升级前等级乘10，与录制1—14级和社区技能点公式差分一致；沿用录制初始10点，不补发该表初始20点差异。',
  '人物每次升级增加3属性点，来自录制；已有已分配属性、额外赠送点数及手动设级存档不重置、不追补技能点。'
 ],scrolls:[{id:100156,name:'人物经验卷(15000）',experience:15000},{id:40007,name:'人物经验卷(30000）',experience:30000}],levels};
fs.writeFileSync(path.join(root,'data/player-experience.json'),JSON.stringify(result,null,2)+'\n');
const text=['# 世界OL人物升级经验与经验卷规则','',`来源：[人物升级经验.xlsx](${result.source.url})。社区资料，非官方发布；1—15级与现有录制逐项吻合。`,'',
 'Excel 的 B 列“下一级所需经验”错位一行。采用 C 列同等级累计值减上一等级累计值，避免全表等级错位。',
 '16—96级按社区表补齐，尚未全部在正式服逐级核验。旧图片40级写153200，Excel差值为163200，采用Excel；累计值在本报告重新计算。','',
 '## 使用与升级规则','',
 '- 战斗、任务和人物经验卷共用经验表，经验满后自动升级，余量可连续升级。',
 '- 15000与30000经验卷每次使用1本，只消耗对应经验卷，不扣货币。人物卷不会给宠物增加经验。',
 '- 战斗中不能使用；校验道具、数量、物品等级及VIP要求。已恢复的两种人物卷均无额外等级/VIP要求，未添加每日次数上限。',
 '- 接近97级时可使用，达到97级的剩余溢出不再累计；已经97级则拒绝使用且不扣卷。',
 '- 每次升级增加“升级前等级 × 10”技能点及3属性点，生命和法力回满，结果随存档保存。',
 '- 97级显示经验0/0；原有装备、宠物、技能及已分配点数保留。手动设级不会再次补发升级技能点。','',
 '| 当前等级 | 升到 | 本级所需经验 | 从1级到当前级累计 | 资料 |','|---:|---:|---:|---:|---|',
 ...levels.map(r=>`| ${r.level} | ${r.nextLevel??'满级'} | ${r.requiredExp.toLocaleString('en-US')} | ${r.totalExpToReach.toLocaleString('en-US')} | ${r.level===97?'录制满级':r.level<=15?'录制+社区表':'社区表'} |`),''];
fs.writeFileSync(path.join(root,'analysis/人物1-97级经验与经验卷.md'),text.join('\n'));
console.log(JSON.stringify({levels:levels.length,recordedMatches:15,totalTo97:cumulative,level96:levels[95],source:result.source},null,2));

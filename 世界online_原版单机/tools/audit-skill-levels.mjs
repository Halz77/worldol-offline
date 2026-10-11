import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {skillCoverage} from './skill-coverage.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const skills=read(path.join(root,'data/catalog-skills.json'));
const references=read(path.resolve(root,'../网络攻略资料_20260920/整理数据/技能索引.json')).records.filter(r=>r.versions.includes('世界H5'));
const report=skillCoverage(skills,references);
const guideFile=path.join(root,'data/official-guides.json'),guide=fs.existsSync(guideFile)?read(guideFile):null;
if(guide)report.officialGuide={counts:guide.counts,professions:guide.professions,pending:guide.pending};
report.queryFindings=[
  {protocol:16005,meaning:'正式服游戏攻略',request:'int 服务端目录中返回的页面编号',result:'职业菜单和22级技能效果文字；不是完整二进制技能定义，也不含全部中间等级',evidence:['analysis/modules/0207.js:doBrowseGameHelpList/fromBytes','data/official-guides.json']},
  {protocol:14001,meaning:'导师技能列表',request:'short 导师编号；无技能编号和等级字段',result:'每项当前可学等级的定义和最高等级',evidence:['analysis/modules/0018.js:createBrowseSkillShop','analysis/modules/0890.js:onGetSkillShopList']},
  {protocol:14011,meaning:'角色技能更新',request:'客户端只注册接收处理',result:'角色当前技能及装备加成等级',evidence:['analysis/modules/0261.js:onSkillUpdate','analysis/modules/0018.js:processDataPlayerSkillMsg']},
  {protocol:27331,meaning:'流派技能树列表',request:'仅树 id',result:'SkillTree 含 curLv/maxLv 及一份属性，没有各等级数组',evidence:['analysis/modules/0261.js:doSkillTreeList','analysis/protobuf.decoded.js:c2s_SkillTree_List/SkillTree']},
  {protocol:29002,meaning:'神器技能列表',request:'无任意技能等级参数',evidence:['analysis/modules/0261.js:doArtifactSkill','analysis/protobuf.decoded.js:c2s_ArtifactSkill']},
  {protocols:[14002,14008,14017,27337,29008],meaning:'学习、确认、升级',decision:'修改正式服角色或消耗资源；不纳入只读采集白名单',evidence:['analysis/modules/0057.js:doLearnSkill/learnSkillAskCb/learnPetSkillAskCb','analysis/modules/0261.js:doSkillTreeLearn/doArtifactSkillUp']}
];
report.conclusion='在已检查的 v305 客户端技能调用中未发现按任意技能编号和等级读取完整定义的通用只读接口。可以持续合并实际下发的等级；不能据此宣称全服务器、全等级已经采齐。';
fs.writeFileSync(path.join(root,'analysis/skill-collection-audit.json'),JSON.stringify(report,null,2)+'\n');
const c=report.counts;
const doc=`# 技能与等级采集核验\n\n${report.conclusion}\n\n- 原版回包：${c.official.skillIds} 个技能编号，${c.official.levelRecords} 份不同等级定义。\n- 已下发最高等级的技能：${c.official.withServerMax} 个；这些范围合计 ${c.official.expectedLevelsForKnownMax} 个等级位置，仍缺 ${c.official.missingLevelsForKnownMax} 个。无最高等级信息的其他技能不纳入该分母。\n- 社区 H5：${c.reference.records} 个原始条目，按条目＋等级去重后 ${c.reference.levelRecords} 份；${c.reference.partial} 个条目中间缺级，${c.reference.withoutNumericLevel} 个没有可解析等级。\n- 社区有 ${c.reference.completeThroughListed} 个条目从 1 级连续列到资料中最高等级；这不等于正式服全等级，也未自动覆盖战斗数值。\n\n## 后续采集方式\n\n录制自己的正常游玩、导师预览及技能升级回包，可以逐步补充真实出现过的等级。重复查看同一级不会增加覆盖。其他职业、特殊技能、流派和宠物需要相应可见内容；不把一个角色的列表当成服务器总表。通用只读全等级接口目前未找到，完整还原仍需要缺失等级的实际回包或经核验的完整配置。\n\n详细编号、已录等级、缺级列表及协议依据见 [skill-collection-audit.json](skill-collection-audit.json)。[本地资料库](http://127.0.0.1:8779/catalog?kind=skill) 可按来源查阅。\n`;
const guideDoc=guide?`\n## 正式服游戏内攻略\n\n新增确认只读攻略协议 16005，目录列出 ${guide.counts.professions} 个职业。当前已解析 ${guide.counts.skillCategoryPages} 个技能分类页面，共 ${guide.counts.skillDescriptions} 条技能效果说明；尚有 ${guide.pending.length} 个已发现目录页面待查，未展开目录的子页继续动态加入。已记录内容可在本地资料库选择“正式服攻略”查看。\n\n攻略菜单编号不是技能编号；名称与类型匹配结果单独保存，不覆盖原版二进制定义。22级说明不会自动推算2–21级或未列出的战斗参数。录制工具的“补齐装备与技能”已加入职业攻略树遍历，使用已登录角色的正常读取连接。\n` : '';
fs.writeFileSync(path.join(root,'analysis/技能采集核验.md'),doc+guideDoc);
console.log(JSON.stringify({counts:report.counts,conclusion:report.conclusion},null,2));

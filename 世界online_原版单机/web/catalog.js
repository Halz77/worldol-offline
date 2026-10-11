const $=id=>document.getElementById(id);let data,shown=100,selected;
const initialKind=new URLSearchParams(location.search).get('kind');if(['equipment','skill'].includes(initialKind))$('kind').value=initialKind;
const initialSource=new URLSearchParams(location.search).get('source');if(['official','guide','progression','reference','all'].includes(initialSource))$('source').value=initialSource;
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e;};
function list(parent,title,values){if(!values?.length)return;parent.append(el('h3',title));const ul=el('ul');for(const v of values)ul.append(el('li',v));parent.append(ul);}
const origins={'official-definition':'正式服技能回包','official-guide':'正式服22级攻略','community-h5':'社区 H5 逐级资料','community-other-version':'社区其他版本 · 待核验','estimated':'推算 · 待核验'};
const methods={'linear-between-anchors':'相邻已知等级插值','proportional-single-anchor':'单侧数值按等级比例推算','step-hold':'沿用邻近等级，变化门槛未知','community-field-conflict':'社区文字与数值矛盾，暂取结构化数值','outlier-neighbor-trend':'社区孤立异常值，按相邻等级暂定修复'};
function markSelection(){document.querySelectorAll('.row').forEach(b=>b.classList.toggle('selected',b.dataset.key===selected));}
function renderProgression(row,level=22){
 selected=row.key;const s=row.detail,l=s.levels.find(x=>x.level===level),target=$('detail');
 target.replaceChildren(el('h2',`${s.name} · ${level}级`),el('p',`${s.profession} · ${s.category} · ${origins[l.origin]}`,'muted'));
 target.append(el('p','效果与学习费用分别核对来源。高级学习金额为本地暂定值；这份表不代表全部技能已经接入战斗。','note'));
 const buttons=el('div',undefined,'level-buttons');for(let i=1;i<=22;i++){const b=el('button',i+'级');b.disabled=i===level;b.onclick=()=>renderProgression(row,i);buttons.append(b);}target.append(buttons);
 function fields(title,values,params=false){if(!values.length)return;target.append(el('h3',title));const ul=el('ul');for(const f of values){const li=el('li',params?`${f.label}：${f.text}`:f.text);if(f.origin==='estimated')li.append(el('small',`推算：${methods[f.method]}；依据 ${f.basis.map(b=>b.level+'级').join('、')}`,'field-source'));ul.append(li);}target.append(ul);}
 fields('属性与效果',l.effects);fields('施放、范围与限制',l.parameters,true);
 function costTable(title,cumulative=false){
  target.append(el('h3',title));const wrap=el('div',undefined,'table-scroll'),table=el('table'),head=el('tr');for(const label of ['学习方式','技能点','铜币','金叶','黄金'])head.append(el('th',label));table.append(head);
  for(const [key,name] of [['own','本职业'],['cross','跨职业']]){const cost=cumulative?l.learning[key].total:l.learning[key],tr=el('tr');for(const text of [name,cost.sp,cost.copper,cost.goldLeaves,cost.gold])tr.append(el('td',text));table.append(tr);}wrap.append(table);target.append(wrap);
 }
 costTable(`升到${level}级的本级费用`);costTable(`从未学习到${level}级的累计费用`,true);
 target.append(el('p',`本职：${l.learning.own.context} 跨职：${l.learning.cross.context}`,'muted'),el('p',data.progression.costPolicy.explanation,'note'));
 if(s.learning.acquisition!=='has-character-shop-quote')target.append(el('p',s.learning.acquisition==='equipment-listed-no-character-shop-quote'?'社区将该项列为装备技能，尚未取得人物导师报价；费用仅为模拟预算。':'尚未取得该项人物导师报价；费用与可学习资格仍待实录核对。','note'));
 if(s.reference)target.append(el('p',`社区对照版本：${s.reference.versions.join('、')}。${s.reference.versions.includes('世界H5')?'':'对应等级未全部核验到当前 H5。'}`,'muted'));
 if(s.conflicts.length||s.anomalies.length)target.append(el('p',`本技能有 ${s.conflicts.length} 项来源数值差异、${s.anomalies.length} 项逐级突变提示，原值和差异已保留在完整记录。`,'note'));
 const guide=el('details');guide.append(el('summary','核对正式服22级原文'),el('p',s.guideContent));target.append(guide);
 const full=el('details');full.append(el('summary','查看来源、推算依据和完整记录'),el('pre',JSON.stringify(s,null,2)));target.append(full);markSelection();
}
function renderDetail(row){
 if(row.source==='progression')return renderProgression(row);
 selected=row.key;const target=$('detail');target.replaceChildren(el('h2',row.name),el('p',`${row.source==='official'?'原版录制':row.source==='guide'?'正式服攻略':'社区 H5 资料 · 待核验'}${row.id?' · 编号 '+row.id:''}${row.level?' · 等级 '+row.level:''}${row.grade?' · '+row.grade:''}`,'muted'));
 if(row.source==='guide'){target.append(el('p',row.group),el('p','这是正式服攻略下发的文字说明，可核对22级效果；未列出的中间等级、消耗和战斗参数仍需技能定义。','note'));if(row.detail.matchingSkillIds.length)target.append(el('p',`同名同类型技能编号：${row.detail.matchingSkillIds.join('、')}（攻略菜单编号另行保存）`,'muted'));}
 if(row.status==='catalog')target.append(el('p','目前仅有名称、图标和分类；完整属性尚未采集。','note'));
 if(row.source==='reference')target.append(el('p','这份资料已可查询，但未直接替代本地角色的原版装备或技能数值。','note'));
 if(row.info)target.append(el('p',row.info));list(target,'属性与效果',row.lines);
 if(row.levelCoverage){const c=row.levelCoverage;target.append(el('h3','社区等级覆盖'),el('p',c.known.length?`有资料的等级：${c.known.join('、')}`:'此条目没有标明可确认的数字等级。'));if(c.missingThroughListed.length)target.append(el('p',`从 1 级到资料中最高的 ${c.highestListed} 级，尚缺：${c.missingThroughListed.join('、')}`,'note'));else if(c.highestListed)target.append(el('p',`已连续列出 1–${c.highestListed} 级；该范围尚未核验为正式服完整等级表。`,'muted'));}
 if(row.range){target.append(el('h3','已录制的鉴定与合成范围'),el('p','这里显示服务器下发的基础范围；游戏内还会按绑定和星级调整。','muted'));for(const slot of row.range.slots){const section=el('div',undefined,'slot'),titles={power1:'普通属性一',power2:'普通属性二',bindPower1:'绑定属性一',bindPower2:'绑定属性二',power3:'合成属性',power4:'进阶属性一',power5:'进阶属性二',power6:'进阶属性三',power7:'进阶属性四'};list(section,titles[slot.field]||slot.field,slot.options.map(p=>p.description||`${data.powerNames[p.power]?.label||'属性 '+p.power}：${p.min}–${p.max}${data.powerNames[p.power]?.percent?'%':''}`));target.append(section);}}
 else if(row.detail&&Object.entries(row.detail).some(([k,v])=>/^(power\d|bindPower\d)$/.test(k)&&[121,131].includes(v)))target.append(el('p','这件装备的鉴定／合成范围还在待采集队列中。','note'));
 const levels=row.reference?.children?.skillLevel;if(levels){target.append(el('h3',`资料中的等级记录（${levels.length} 条）`));for(const l of levels){const box=el('details');box.append(el('summary',l.name||'技能等级'));list(box,'效果',l.skillAttribute);target.append(box);}}
 const attached=[...(row.detail?.skill?[row.detail.skill]:[]),...(row.detail?.combinUpSkillList||[])];if(attached.length)list(target,'附带技能',attached.map(s=>`${s.name} · ${s.level} 级`));
 if(row.kind==='skill'&&row.source==='official'){
  const known=data.rows.filter(s=>s.kind==='skill'&&s.source==='official'&&s.id===row.id).map(s=>s.level).sort((a,b)=>a-b);
  const coverage=data.skillCoverage?.official.find(s=>s.id===row.id);
  target.append(el('h3','等级采集情况'),el('p',`资料中已录等级（含装备附带）：${known.join('、')}`));
  if(coverage?.teacherKnown.length)target.append(el('p',`导师／角色已录等级：${coverage.teacherKnown.join('、')}`));
  if(coverage?.missing.length)target.append(el('p',`所有已录来源合计仍缺等级：${coverage.missing.join('、')}（服务器已下发最高等级 ${coverage.maxLevel}）`,'note'));
  else if(coverage?.maxLevel)target.append(el('p',`已取得 1–${coverage.maxLevel} 级的定义；不同来源均保留标记。`,'muted'));
  else target.append(el('p','尚未取得这项技能的完整等级范围。','muted'));
  const siblings=data.rows.filter(s=>s.kind==='skill'&&s.source==='official'&&s.id===row.id).sort((a,b)=>a.level-b.level);if(siblings.length>1){target.append(el('h3','切换已录等级'));const buttons=el('div',undefined,'level-buttons');for(const sibling of siblings){const button=el('button',`${sibling.level} 级`);button.disabled=sibling.key===row.key;button.onclick=()=>renderDetail(sibling);buttons.append(button);}target.append(buttons);}
 }
 if(row.detail?.sources){const origins=new Set(row.detail.sources.map(s=>s.origin));target.append(el('p',origins.has('equipment-skill')?'包含装备附带技能记录；这不代表已还原全部战斗效果。':'数据来自本机保存的正式服回包。','muted'));}
 const detail=el('details');detail.append(el('summary','查看完整记录'),el('pre',JSON.stringify(row.reference||row.detail||{id:row.id,name:row.name},null,2)));target.append(detail);
 document.querySelectorAll('.row').forEach(b=>b.classList.toggle('selected',b.dataset.key===selected));
}
function render(){
 const text=$('search').value.trim().toLowerCase(),kind=$('kind').value,source=$('source').value,status=$('status').value,profession=$('profession').value;
 $('profession').hidden=kind!=='skill'||!['progression','guide'].includes(source);
 const rows=data.rows.filter(r=>r.kind===kind&&(source==='all'||r.source===source)&&(status==='all'||r.status===status)&&($('profession').hidden||profession==='all'||r.detail?.profession===profession)&&(!text||(`${r.name} ${r.id||''} ${r.group||''}`).toLowerCase().includes(text)));
 $('matches').textContent=source==='progression'?`找到 ${rows.length} 个技能 · 每个技能含1–22级效果和费用，共 ${rows.length*22} 条`:`找到 ${rows.length} 条记录 · 同名版本和不同技能等级分别保留`;
 $('rows').replaceChildren();for(const row of rows.slice(0,shown)){const b=el('button',undefined,'row');b.dataset.key=row.key;const title=el('span');title.append(el('strong',row.name),el('small',`${row.id?'#'+row.id+' · ':''}${row.source==='progression'?'1–22级 · ':row.level?'等级 '+row.level+' · ':''}${row.group||row.grade||''}`));b.append(title,el('span',row.status==='catalog'?'待采集':row.source==='reference'?'社区资料':row.source==='guide'?'正式服攻略':row.source==='progression'?'重建 · 含推算':'原版详情','badge '+row.status));b.onclick=()=>renderDetail(row);$('rows').append(b);}$('more').hidden=rows.length<=shown;markSelection();
}
for(const id of ['search','kind','source','status','profession'])$(id).addEventListener('input',()=>{shown=100;render();});$('more').onclick=()=>{shown+=100;render();};
$('download-progression').onclick=()=>{const blob=new Blob([JSON.stringify({...data.progression,skills:data.rows.filter(r=>r.source==='progression').map(r=>r.detail)})],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='世界OL-全职业技能1-22级-含推算.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
fetch('/api/content-library').then(r=>{if(!r.ok)throw Error('资料载入失败');return r.json();}).then(value=>{
 data=value;const g=data.guideCoverage;if(g)$('guide-summary').textContent=`正式服攻略：${g.counts.professions} 个职业目录 · 已保存 ${g.counts.skillDescriptions} 条技能效果说明 · 已读 ${g.counts.skillCategoryPages} 个技能分类页面。`;
 const p=data.progression;if(p){$('progression-summary').textContent=`1–22级重建：${p.counts.professions} 职业 · ${p.counts.skills} 技能 · ${p.counts.levelRecords.toLocaleString()} 条等级记录，其中 ${p.counts.origins.estimated.toLocaleString()} 条含推算或暂定修复。含本职、跨职学习费用及累计预算。`;$('download-progression').hidden=false;for(const job of p.professions){const option=el('option',job.name);option.value=job.name;$('profession').append(option);}}
 const c=data.counts;$('summary').textContent=`原版目录装备 ${c.equipmentCatalog} · 已录物品详情 ${c.itemDetails} · 鉴定表 ${c.identificationTables} · 技能 ${c.skillIds} 种 / 等级记录 ${c.skillDefinitions} 条 · 社区 H5 装备 ${data.referenceCounts.equipment} / 技能条目 ${data.referenceCounts.skills}`;
 const levels=data.skillCoverage?.counts;if(levels)$('skill-summary').textContent=`正式回包完整度：${levels.official.withServerMax} 个原版技能已下发最高等级，其范围内还缺 ${levels.official.missingLevelsForKnownMax} 份定义。重建推算不计入正式采集完成数。`;
 render();if(initialSource==='progression'){const first=data.rows.find(r=>r.source==='progression');if(first)renderDetail(first);}
}).catch(error=>$('summary').textContent=error.message);

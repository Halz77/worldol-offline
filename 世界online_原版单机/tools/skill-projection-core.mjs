// Research model only: no generated row is a native packet or a permission to learn.
import {fields,percentField} from '../lib/reference-fields.mjs';
export const MODEL_VERSION='career-levels-v1';
export const JOBS={'侠客':1,'修真':2,'战士':3,'法师':4,'贤者':5,'枪王':10,'武圣':6,'锤师':11,'岚舞':12};
const ALIASES={
 '侠客|绝情绝刀':'绝情双刀','侠客|隐秘步法空蝉':'隐秘步法空蝉',
 '修真|秘传封魔决':'秘传封魔诀','贤者|权仗使用':'权杖使用','武圣|天地无情决':'天地无情诀',
 // Explicit aliases reviewed against the matching career/category and level-22 effects.
 '战士|斩杀':'斩击','锤师|永不绝灭':'永不灭绝','锤师|恶灵封散决':'恶灵封散诀',
 '岚舞|宝扇修护':'宝扇修复','岚舞|星舞炫风':'星舞旋风','岚舞|奉衲':'奉纳',
};
export function skillName(name,profession=''){
 const clean=String(name).replace(/\d+\s*级/g,'').replace(/[\s()（）「」“”"'‘’\-－—:：]/g,'');
 return ALIASES[profession+'|'+clean]||clean;
}
export const levelNumber=row=>Number(String(row?.name||'').match(/(\d+)\s*级/)?.[1])||null;
const tidy=x=>String(x??'').replace(/\r/g,'').replace(/[;；\s]+$/g,'').trim();
export const numbers=text=>(String(text).match(/[+-]?\d+(?:\.\d+)?/g)||[]).map(Number);
const valuesKey=text=>numbers(text).join(',');
function percentText(text){return text.replace(/百分比\s*([+-]?\d+(?:\.\d+)?)/g,'$1%');}
function comparisonText(value){
 return percentText(tidy(value))
  .replace(/造成最大生命(?:值)?([+-]?\d+(?:\.\d+)?)%的伤害/g,(_,n)=>'扣除最大生命'+Math.abs(Number(n))+'%')
  .replace(/造成([+-]?\d+(?:\.\d+)?)伤害/g,(_,n)=>'生命-'+Math.abs(Number(n)))
  .replace(/(?:技能附带)?无视目标([+-]?\d+)(?:点)?(物理防御|魔法防御|反击|魔法反馈|格挡|洞察|伤害减免|状态抵抗)/g,(_,n,p)=>'目标'+p+'值-'+Math.abs(Number(n)))
  .replace(/技能附带无视(反击|魔法反馈|格挡|洞察|伤害减免|状态抵抗)([+-]?\d+)/g,(_,p,n)=>'目标'+p+'值-'+Math.abs(Number(n)));
}
// Keep numeric signs in the same semantic form as effectKey. For example,
// "ignore reduction +420" means "target reduction -420", not +420.
export const modelNumbers=text=>numbers(comparisonText(text));
export function effectKey(text){
 return comparisonText(text).replace(/物理命中/g,'命中').replace(/躲闪/g,'闪避')
  .replace(/基础(力量|体质|敏捷|智力|感知)/g,'$1').replace(/魔法攻击力/g,'魔法攻击')
  .replace(/魔法防御力/g,'魔法防御').replace(/空手/g,'肉搏').replace(/(刀|剑|锤|扇)类武器/g,'$1类')
  .replace(/生命值/g,'生命').replace(/法力值/g,'法力').replace(/造成([+-]?\d+(?:\.\d+)?)伤害/g,'生命$1')
  .replace(/法力上限/g,'法力').replace(/生命上限/g,'生命').replace(/技能附带物理命中/g,'技能附带命中')
  .replace(/[，,](火烧|中毒|流血)(?=$|[，,])/g,'')
  .replace(/[+-]?\d+(?:\.\d+)?/g,'#').replace(/[\s,，。:：;；]/g,'');
}
function effect(text,origin,index){return {index,text:tidy(text),origin};}
function parameter(label,value,origin){return {label,text:tidy(value),origin};}
export function referenceAnchor(row,origin){
 const parameters=[];
 for(const [key,label] of [['round','持续回合'],['additionalAttackTimes','攻击次数'],['attackMode','技能类型'],['range','技能范围'],['armsLimitation','需求武器'],['describe','补充说明']])
  if(row[key]!==undefined&&tidy(row[key])!=='')parameters.push(parameter(label,row[key],origin));
 if(row.skillConsumption!==undefined){
  const text=String(row.skillConsumption),matches=[...text.matchAll(/(\d+)\s*(法力|生命)/g)];
  if(matches.length)for(const m of matches)parameters.push(parameter(m[2]==='法力'?'消耗法力值':'消耗生命值',m[1],origin));
  else parameters.push(parameter('技能消耗',text,origin));
 }
 const level=levelNumber(row),effects=(row.skillAttribute||[]).filter(x=>tidy(x)).map((x,i)=>effect(x,origin,i+1));
 for(const [key,value] of Object.entries(row)){
  const spec=fields[key];if(!spec||!Number.isFinite(value))continue;
  const labels=spec[1].split('|').map(label=>effectKey(label+'+'+value+(percentField(key)?'%':'')));
  const matched=effects.filter(e=>numbers(e.text).length===1&&labels.includes(effectKey(e.text)));
  if(matched.length===1&&numbers(matched[0].text)[0]!==value){
   const f=matched[0];Object.assign(f,{rawText:f.text,text:interpolateText(f.text,[value]),origin:'estimated',method:'community-field-conflict',confidence:'low',numericField:key,basis:[{level,origin,field:key,value}]});
  }
 }
 return {level,origin:effects.some(f=>f.origin==='estimated')?'estimated':origin,effects,parameters};
}
export function guideAnchor(guide){return {level:22,origin:'official-guide',effects:guide.effects.map(e=>effect(e.description,'official-guide',e.index)),parameters:(guide.parameters||[]).map(p=>parameter(p.label==='范围'?'技能范围':p.label,p.value,'official-guide'))};}
function vector(row){return row.effects.map(e=>valuesKey(e.text)).join('|');}
export function resolveNative(guide,natives){
 const matches=natives.filter(n=>n.type===guide.type&&skillName(n.name,guide.profession)===skillName(guide.name,guide.profession));
 const ids=[...new Set(matches.map(x=>x.id))];
 if(ids.length<=1)return {id:ids[0]??null,method:ids.length?'unique-name-type':'unmatched',candidates:ids};
 const careerIds=ids.filter(id=>matches.some(s=>s.id===id&&s.reqJob===JOBS[guide.profession]&&s.sources?.some(x=>x.origin==='shop'&&x.shopId<2000)));
 return {id:careerIds.length===1?careerIds[0]:null,method:careerIds.length===1?'career-shop-name-type':'ambiguous',candidates:ids};
}
export function selectReference(guide,references,nativeAnchors=[]){
 const candidates=references.filter(r=>r.mode===guide.category&&skillName(r.name,guide.profession)===skillName(guide.name,guide.profession)&&
  (r.group===guide.profession||r.group==='装备技能'&&['浩然正气','第七感'].includes(guide.name)));
 const agreement=(a,b)=>a.effects.reduce((total,f,i)=>{
  const other=b.effects[i];if(!other)return total;
  const x=modelNumbers(f.text),y=modelNumbers(other.text),sameLabel=effectKey(f.text)===effectKey(other.text);
  const same=x.length===y.length&&x.every((n,j)=>n===y[j]);
  const magnitude=x.length===y.length&&x.every((n,j)=>Math.abs(n)===Math.abs(y[j]));
  // Damage/ignore descriptions may encode the same magnitude with the opposite sign.
  // Magnitude agreement helps rank a known alias, but never turns another version into verified data.
  return total+(same&&sameLabel?20:x.length&&same?8:x.length&&magnitude?5:0);
 },0);
 const score=r=>{
  const anchors=[r.raw,...r.raw.children?.skillLevel||[]].map(x=>referenceAnchor(x,'community'));
  let value=r.versions.includes('世界H5')?10000:0;
  const top=anchors.filter(x=>x.level===22);value+=50*Math.max(0,...top.map(x=>agreement(x,guideAnchor(guide))));
  for(const a of nativeAnchors)value+=5*Math.max(0,...anchors.filter(x=>x.level===a.level).map(x=>agreement(x,a)));
  value+=new Set(anchors.map(a=>a.level).filter(Boolean)).size;
  if(r.versions.includes('古德/基础版'))value+=0.5;
  return value;
 };
 candidates.sort((a,b)=>score(b)-score(a)||a.record_id.localeCompare(b.record_id));
 return {selected:candidates[0]||null,candidates:candidates.map(r=>({recordId:r.record_id,versions:r.versions,score:score(r)}))};
}
function fieldId(field,kind){return kind==='parameters'?field.label:effectKey(field.text);}
function scalable(field,kind){
 if(kind==='parameters')return ['消耗法力值','消耗生命值'].includes(field.label)&&/^\d+$/.test(field.text);
 if(/^每回合(?:自动)?恢复(?:法力|生命)/.test(field.text))return true;
 // Status, target counts, thresholds and conditional prose are discrete, never scaled.
 return numbers(field.text).length>0&&!/次数|回合|\d+级|\d+人|免疫|状态|复活|小于|大于|低于|高于|几率|概率|时|每|叠加/.test(field.text);
}
function interpolateText(template,values){let i=0;return template.replace(/[+-]?\d+(?:\.\d+)?/g,token=>{const v=values[i++];return token.startsWith('+')&&v>=0?'+'+v:String(v);});}
export function estimateField(field,kind,level,anchors){
 const id=fieldId(field,kind),points=anchors.flatMap(a=>a[kind].filter(f=>fieldId(f,kind)===id).map(f=>({level:a.level,field:f,origin:a.origin})));
 const lower=points.filter(p=>p.level<level).at(-1),upper=points.find(p=>p.level>level);
 const chosen=lower||upper;if(!chosen)throw Error('Missing projection anchor');
 const base={...chosen.field,origin:'estimated',basis:[lower,upper].filter(Boolean).map(p=>({level:p.level,origin:p.origin}))};
 if(!scalable(chosen.field,kind))return {...base,method:'step-hold',confidence:'low'};
 const a=modelNumbers(lower?.field.text||''),b=modelNumbers(upper?.field.text||'');
 const restoreSign=(field,values)=>{const raw=numbers(field.text),modeled=modelNumbers(field.text);return interpolateText(field.text,values.map((n,i)=>raw[i]&&modeled[i]&&Math.sign(raw[i])!==Math.sign(modeled[i])?-n:n));};
 if(lower&&upper&&a.length===b.length){
  const weight=(level-lower.level)/(upper.level-lower.level);
  return {...base,text:restoreSign(lower.field,a.map((n,i)=>Math.round(n+(b[i]-n)*weight))),method:'linear-between-anchors',confidence:'medium'};
 }
 const values=modelNumbers(chosen.field.text).map(n=>Math.round(n*level/chosen.level));
 return {...base,text:restoreSign(chosen.field,values),method:'proportional-single-anchor',confidence:'low'};
}
function estimateLevel(level,anchors){
 const lower=anchors.filter(a=>a.level<level).at(-1),upper=anchors.find(a=>a.level>level),template=lower||upper;
 if(!template)throw Error('No effects anchor');
 return {level,origin:'estimated',effects:template.effects.map(f=>estimateField(f,'effects',level,anchors)),parameters:template.parameters.map(f=>estimateField(f,'parameters',level,anchors))};
}
const cleanPrice=s=>({sp:s.sp,gold:s.money1,goldLeaves:s.money2,copper:s.money3});
const totalZero=()=>({sp:0,copper:0,goldLeaves:0,gold:0});
export const COST_POLICY={
 id:'local-provisional-v1',taxRate:0,ownSpPerLevel:5,crossMultiplier:2,
 currencyBands:[{from:1,to:10,currency:'copper'},{from:11,to:15,currency:'goldLeaves'},{from:16,to:22,currency:'gold'}],
 premiumFormula:'(2 * level - 14) * (observed base copper / 500)',
 premiumFormulaStatus:'local-assumption-not-observed',
 explanation:'1–10级使用回包铜币档位推算。11–15金叶、16–22黄金的分段参考旧版人物攻略；高级金额的 2L−14 和特殊技能档位倍数是本地暂定规则，非已确认的正式服售价。跨职按双倍、国家税率按0估算。',
 historicalSource:'https://www.962.net/gl/31533.html',
 rejectedSource:'宠物11–20级费用表不作为人物费用证据；无法核实的22级售价问答未采用。',
};
export function learningCosts(guide,nativeRows){
 const observed=nativeRows.filter(s=>Number.isInteger(s.sp)&&s.sources?.some(x=>x.origin==='shop'&&x.shopId<2000))
  .map(s=>({level:s.level,...cleanPrice(s),requiredJob:s.reqJob,requiredRoleLevel:s.reqLevel,source:`native:${s.id}:${s.level}`}));
 const bases=observed.filter(p=>p.level<=10&&p.sp>0&&p.gold===0&&p.goldLeaves===0)
  .map(p=>p.copper/(p.sp/(5*p.level))/p.level).filter(n=>Number.isFinite(n)&&n>0);
 const baseCounts=new Map();for(const n of bases)baseCounts.set(n,(baseCounts.get(n)||0)+1);
 const base=[...baseCounts].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0]??(['贤者','枪王'].includes(guide.profession)?1000:500);
 const totals={own:totalZero(),cross:totalZero()},levels=[];
 for(let level=1;level<=22;level++){
  const price={sp:5*level,copper:level<=10?Math.round(base*level):0,goldLeaves:level>=11&&level<=15?Math.round((2*level-14)*base/500):0,gold:level>=16?Math.round((2*level-14)*base/500):0};
  const plans={};
  for(const [relation,multiplier] of [['own',1],['cross',2]]){
   const projected=Object.fromEntries(Object.entries(price).map(([k,n])=>[k,n*multiplier]));
   // A matching SP pattern only classifies the observed quote; it cannot prove tax or payer profession.
   const candidates=observed.filter(p=>p.level===level&&p.sp===projected.sp);
   const signatures=[...new Set(candidates.map(p=>JSON.stringify(cleanPrice({sp:p.sp,money1:p.gold,money2:p.goldLeaves,money3:p.copper}))))];
   const quote=signatures.length===1?candidates[0]:null;
   if(quote)Object.assign(projected,{sp:quote.sp,copper:quote.copper,goldLeaves:quote.goldLeaves,gold:quote.gold});
   for(const k of Object.keys(totals[relation]))totals[relation][k]+=projected[k];
   plans[relation]={...projected,origin:quote?'observed-quote':'estimated',context:quote?'按技能点倍率匹配的实际报价；角色职业及国家税率上下文未证实。':(level>10?'高级金额为本地暂定':'按已录档位及本职/跨职规则推算'),...(quote?{source:quote.source}:{}),total:{...totals[relation]}};
  }
  levels.push({level,...plans,observed:observed.filter(p=>p.level===level)});
 }
 return {policy:COST_POLICY.id,baseCopper:base,baseEvidence:observed.length?'derived-from-observed-quotes':'profession-default-assumption',observed,levels};
}
export function projectSkill(guide,natives,references){
 const identity=resolveNative(guide,natives),nativeRows=identity.id===null?[]:natives.filter(s=>s.id===identity.id&&s.level>=1&&s.level<=22);
 const nativeAnchors=nativeRows.map(s=>s.display),reference=selectReference(guide,references,nativeAnchors),ref=reference.selected;
 const anchors=new Map(),conflicts=[];
 const origin=ref?.versions.includes('世界H5')?'community-h5':'community-other-version';
 for(const raw of ref?[ref.raw,...ref.raw.children?.skillLevel||[]]:[]){
  const a=referenceAnchor(raw,origin);if(!a.level||a.level>22||!a.effects.length)continue;
  for(const f of a.effects.filter(f=>f.rawText))conflicts.push({level:a.level,kind:'community-text-numeric-conflict',field:f.numericField,originalText:f.rawText,selectedText:f.text,action:'numeric-field-provisional-reconciliation'});
  if(anchors.has(a.level)&&vector(anchors.get(a.level))!==vector(a))conflicts.push({level:a.level,kind:'community-duplicate-level',selected:a,alternative:anchors.get(a.level)});
  anchors.set(a.level,a);
 }
 for(const a of nativeAnchors){
  const old=anchors.get(a.level);if(old&&vector(old)!==vector(a))conflicts.push({level:a.level,kind:'official-overrides-community',selected:a,alternative:old});
  anchors.set(a.level,a);
 }
 const top=guideAnchor(guide),oldTop=anchors.get(22);
 if(oldTop&&vector(oldTop)!==vector(top))conflicts.push({level:22,kind:'guide-differs-from-other-source',selected:top,alternative:oldTop});
 anchors.set(22,top);
 const sorted=[...anchors.values()].sort((a,b)=>a.level-b.level);
 // Only repair a community outlier when four surrounding consecutive levels agree on one line.
 // Native records and guide endpoints are immutable. The original text stays in the audit.
 for(let i=2;i<sorted.length-2;i++){
  const window=sorted.slice(i-2,i+3),center=sorted[i];
  if(window.some((a,j)=>a.level!==window[0].level+j))continue;
  for(const f of center.effects){
   if(!f.origin.startsWith('community-')||numbers(f.text).length!==1||!scalable(f,'effects'))continue;
   const neighbors=[0,1,3,4].map(j=>window[j].effects.find(e=>effectKey(e.text)===effectKey(f.text)));
   if(neighbors.some(e=>!e||numbers(e.text).length!==1))continue;
   const values=neighbors.map(e=>modelNumbers(e.text)[0]),step=(values[3]-values[0])/4;
   if(Math.abs(values[1]-values[0]-step)>0.01||Math.abs(values[2]-values[0]-3*step)>0.01)continue;
   const expected=Math.round(values[0]+2*step),original=modelNumbers(f.text)[0];
   if(Math.abs(expected-original)<=Math.max(2,Math.abs(step)*2))continue;
   const corrected=estimateField(f,'effects',center.level,sorted.filter(a=>a.level!==center.level));
   conflicts.push({level:center.level,kind:'isolated-community-outlier',originalText:f.text,selectedText:corrected.text,neighbors:[0,1,3,4].map((j,k)=>({level:window[j].level,text:neighbors[k].text})),action:'provisional-interpolation'});
   Object.assign(f,corrected,{rawText:f.text,method:'outlier-neighbor-trend'});center.origin='estimated';
  }
 }
 const costs=learningCosts(guide,nativeRows),levels=[];
 for(let level=1;level<=22;level++){
  const a=anchors.get(level)||estimateLevel(level,sorted);
  levels.push({...a,learning:costs.levels[level-1],completeCombatDefinition:nativeRows.some(s=>s.level===level),...(nativeRows.some(s=>s.level===level)?{definitionRef:`native:${identity.id}:${level}`}:{})});
 }
 // Non-monotonic facts remain intact; flag rather than silently smoothing a possible threshold or typo.
 const anomalies=[];
 for(let i=1;i<sorted.length-1;i++)for(const f of sorted[i].effects){
  const left=sorted[i-1].effects.find(x=>effectKey(x.text)===effectKey(f.text)),right=sorted[i+1].effects.find(x=>effectKey(x.text)===effectKey(f.text));
  if(!left||!right||numbers(f.text).length!==1)continue;
  const n=numbers(f.text)[0],a=numbers(left.text)[0],b=numbers(right.text)[0];
  if(n<Math.min(a,b)||n>Math.max(a,b))anomalies.push({level:sorted[i].level,text:f.text,previous:{level:sorted[i-1].level,text:left.text},next:{level:sorted[i+1].level,text:right.text},action:'preserved-for-review'});
 }
 return {key:'progression:'+guide.key,name:guide.name,profession:guide.profession,type:guide.type,category:guide.category,identity,
  sourceGuideKey:guide.key,guideContent:guide.content,reference:ref?{recordId:ref.record_id,versions:ref.versions,sourcePointer:ref.source_pointer,group:ref.group,candidates:reference.candidates}:null,
  sourceRefs:{guide:guide.sources,native:nativeRows.map(s=>({key:`native:${s.id}:${s.level}`,sources:s.sources}))},
  learning:{policy:costs.policy,baseCopper:costs.baseCopper,baseEvidence:costs.baseEvidence,acquisition:costs.observed.length?'has-character-shop-quote':ref?.group==='装备技能'?'equipment-listed-no-character-shop-quote':'no-character-shop-quote'},
  levels,conflicts,anomalies,limits:['逐级效果资料包含推算值，不能代替未采集的技能执行协议。','效果为资料值不代表该技能可由人物导师学习；学习渠道和最高可学等级仍以正式回包为准。']};
}

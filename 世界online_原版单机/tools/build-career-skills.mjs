import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {simple} from 'acorn-walk';
import {Writer} from '../lib/codec.mjs';
import {decoders} from './capture-decoders.mjs';
import {powerFormatter} from './catalog-format.mjs';
import {normalizeSkillEffectUnits} from './skill-effect-text.mjs';
import {JOBS,skillName,effectKey,numbers,modelNumbers} from './skill-projection-core.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const projection=read('data/skill-progression.json'),catalog=read('data/catalog-skills.json'),legacy=read('data/restored-v03.json');
const d=decoders(root),format=powerFormatter(root),texts={};
simple(parse(fs.readFileSync(path.join(root,'analysis/modules/0004.js'),'utf8'),{ecmaVersion:'latest'}),{AssignmentExpression(n){
 if(n.left.type==='MemberExpression'&&['bufferText','skillAreaText','skillWeaponText','AtkTypeText'].includes(n.left.property.name)&&n.right.type==='ArrayExpression')texts[n.left.property.name]=n.right.elements.map(x=>x.value);
}});
const teacherShops={'侠客':[304,308,400,1101],'修真':[307,311,403,1102],'战士':[306,310,402,1103],'法师':[305,309,401,1104],'贤者':[600,601,602,603,1105],'枪王':[607,608,609,610,1110],'武圣':[1106],'锤师':[1111],'岚舞':[1112]};
const byNative=new Map(),used=new Set(catalog.map(s=>s.id));
for(const s of catalog){if(!byNative.has(s.id))byNative.set(s.id,[]);byNative.get(s.id).push(s);}
for(const list of byNative.values())list.sort((a,b)=>a.level-b.level);
for(const s of legacy.skills)used.add(s.id);
const previous=fs.existsSync(path.join(root,'data/career-skills.json'))?read('data/career-skills.json'):null;
const priorIDs=new Map(previous?.skills.filter(s=>s.sourceId===null).map(s=>[s.key,s.id])||[]);
let nextId=4800;
function allocate(key){if(priorIDs.has(key))return priorIDs.get(key);while(used.has(nextId))nextId++;if(nextId>=5000)throw Error('Local player skill ID range exhausted');const id=nextId++;used.add(id);return id;}
const issues=[],aliases={};
const clean=t=>String(t).replace(/\s|[，,。；;]/g,'').replace(/％/g,'%');
const removePoisonBleeding=t=>String(t||'').replace(/中毒状态法力恢复、吸收失效/g,'').replace(/[，,]\s*(?:中毒|流血)/g,'').trim();
function effectText(t){return normalizeSkillEffectUnits(t)
 .replace(/百分比\s*([+-]?\d+(?:\.\d+)?)/g,'$1%')
 .replace(/(?:造成目标生命值|燃烧目标生命值)([+-]?\d+)(%?)/g,(_,n,p)=>p?'造成最大生命值'+Math.abs(Number(n))+'%的伤害':'生命-'+Math.abs(Number(n)))
 .replace(/燃烧目标法力值([+-]?\d+)(%?)/g,(_,n,p)=>p?'扣除最大法力值'+Math.abs(Number(n))+'%':'法力-'+Math.abs(Number(n)))
 .replace(/造成最大生命值([+-]?\d+)%的?伤害/g,(_,n)=>'造成最大生命值'+Math.abs(Number(n))+'%的伤害')
 .replace(/燃烧最大法力值([+-]?\d+)%的法力/g,(_,n)=>'扣除最大法力值'+Math.abs(Number(n))+'%')
 .replace(/燃烧目标([+-]?\d+)的法力/g,(_,n)=>'法力-'+Math.abs(Number(n)))
 .replace(/技能附带回复([+-]?\d+)(%?)(生命|法力)/g,'恢复自身$3$1$2')
 .replace(/回复([+-]?\d+)(生命|法力)/g,'$2+$1')
 .replace(/回复最大(生命|法力)值([+-]?\d+)%的?(生命|法力)/g,'回复最大$1值$2%')
 .replace(/恢复目标(生命|法力)值([+-]?\d+)(%?)/g,(_,p,n,v)=>v?'回复最大'+p+'值'+n+'%':p+n)
 .replace(/技能附带([+-]?\d+)%生命吸收/g,'附带生命吸收$1%')
 .replace(/技能附带魔法穿透([+-]?\d+)/g,'无视目标$1点法术防御').replace(/技能附带破甲([+-]?\d+)/g,'无视目标$1点物理防御')
 .replace(/无视目标(\d+)点魔法防御/g,'无视目标+$1点法术防御')
 .replace(/技能附带无视目标(\d+(?:\.\d+)?)%状态抵抗/g,'目标状态抵抗率-$1')
 .replace(/每回自动|每回合(?!自动)/g,'每回合自动')
 .replace(/致命值|致命(?=[+-])/g,'致命点').replace(/法球/g,'法器')
 .replace(/(?<!用)(剑|刀|法杖)时攻击次数/g,'用$1时攻击次数')
 .replace(/锤类攻击次数/g,'用锤类时攻击次数').replace(/扇类攻击次数/g,'用扇子时攻击次数')
 .replace(/造成([+-]?\d+)伤害回复/g,'生命$1')
 .replace(/无视目标(魔法反馈|洞察|状态抵抗|反击)(\d+)/g,'无视$1+$2')
 .replace(/魔法攻击无效/g,'魔攻无效').replace(/目标伤害减免(?=[+-])/g,'目标伤害减免值')
 .replace(/(?<!无视|基础)状态抵抗([+-]?\d+)%/g,'基础状态抵抗$1%')
 .replace(/劈砍防御(?=[+-])/g,'劈砍防御力').replace(/穿刺防御(?=[+-])/g,'穿刺防御力')
 .replace(/魔攻攻击/g,'魔法攻击').replace(/为主人承受伤害/g,'为其承受伤害')
 .replace(/(清除目标(?:不死意志|死者苏生|全减益免疫|增益|物攻无效|魔攻无效))$/g,'$1状态');}
function key(t){return effectKey(effectText(t)).replace(/(?:基础)?物理命中率/g,'命中率').replace(/基础生命吸收/g,'生命吸收').replace(/基础法力吸收/g,'法力吸收').replace(/基础强制命中率/g,'强制命中率').replace(/用重型武器时/g,'用重型时').replace(/用长柄武器时/g,'用长柄时').replace(/(?<!用)远程武器时/g,'用远程武器时').replace(/火枪类武器/g,'火枪类').replace(/技能附带/g,'附带').replace(/附带魔法命中/g,'附带命中').replace(/附加强制命中率/g,'附带强制命中率').replace(/法术防御/g,'魔法防御').replace(/魔法抗性/g,'魔法防御').replace(/生命恢复/g,'恢复生命').replace(/法力恢复/g,'恢复法力').replace(/无视状态抵抗值/g,'无视状态抵抗').replace(/(?<!无视|基础)状态抵抗(?=#)/g,'状态抵抗值').replace(/每回合自动扣除/g,'每回合自动恢复').replace(/目标魔攻反馈/g,'目标魔法反馈');}
const combatIds=Object.entries(d.constants).filter(([k,v])=>k.startsWith('POWER_')&&Number.isInteger(v)&&v>0&&v<=265).map(x=>x[1]).filter(id=>id<99||[113,114,115,116,117,122,123,124,125,126,127,128,129,130,133,134,135,136,137,138,139,140,141,142,145,146,147,148,149,150,151,152,153,154,155,156,168,169,170,171,172,173,174,175,178,190,191,192,193,194,195,201,202,203,204,210,211,212,213,214,215,216,230,231,232,233,234,235,236,250,251,252,253,254,255,256,257,258,259,260,261,262,263,264,265].includes(id));
const probeCache=new Map();
function probeInfo(id,value,template){const k=id+':'+value+':'+(template?.skillAtkType??0);if(!probeCache.has(k)){const text=format(id,value,template);probeCache.set(k,{text,key:key(text),values:modelNumbers(effectText(text))});}return probeCache.get(k);}
function convertEffect(originalText,template,type,index){
 const statusName=texts.bufferText.find((s,i)=>i>0&&new RegExp('(?:[，,]|^)'+s+'$').test(originalText));
 const text=effectText(statusName?originalText.replace(new RegExp('[，,]'+statusName+'$'),''):originalText);
 const wanted=key(text),values=modelNumbers(text),candidates=[];
 const status=statusName?texts.bufferText.indexOf(statusName):(template?.['statusBit'+index]||0);
 if(text==='无')return {id:0,value:0,status:0,method:'empty'};
 for(const id of new Set([template?.['power'+index],...combatIds])){
  if(!id)continue;
  if([79,88].includes(id)){
   for(let v=1;v<texts.bufferText.length;v++)if(key(format(id,v,template))===wanted)candidates.push({id,value:v,status,score:100});
   continue;
  }
  for(const probe of [100,-100]){
   const sample=probeInfo(id,probe,template),sampleValues=sample.values;
   if(sample.key!==wanted||sampleValues.length!==1||values.length!==1||!sampleValues[0])continue;
   const value=Math.round(values[0]*probe/sampleValues[0]);
   if(value< -32768||value>32767||(value!==0&&key(format(id,value,template))!==wanted))continue;
   let score=clean(format(id,value,template))===clean(text)?20:0;
   if(id===template?.['power'+index])score+=50;
   if(type===1&&[11,12,13,14,168,169,170,171,172,173].includes(id))score+=5;
   if(type!==1&&[49,50,51,52,151,152,153,154,155,156].includes(id))score+=5;
   candidates.push({id,value,status,score});
  }
 }
 candidates.sort((a,b)=>b.score-a.score||a.id-b.id);
 if(candidates.length)return {...candidates[0],method:'native-text-inverse'};
 // Preserve a captured discrete/status operation. Never scale encoded status values.
 const id=template?.['power'+index],value=template?.['powerValue'+index],bit=template?.['statusBit'+index]||0;
 if(id){return {id,value,status:bit,method:'captured-template-fallback',unmapped:originalText};}
 return {id:0,value:0,status:0,method:'description-only',unmapped:originalText};
}
function encode(s){
 const w=new Writer().short(s.id).byte(s.level).string(s.name).byte(s.type).string(s.info||'').byte(s.skillWeapon||0);
 for(let i=1;i<=3;i++)w.short(s['power'+i]||0).short(s['powerValue'+i]||0);
 if(s.type!==1){w.byte(s.skillAtkType||0).byte(s.area||0).byte(s.round||0).byte(s.atk_time||0).short(s.useMP||0).short(s.useHP||0).byte(s.anime1||0).short(s.anime2||0).short(s.anime3||0).byte(s.position||0);for(let i=1;i<=3;i++)w.byte(s['statusBit'+i]||0);}
 return w.bool(false).done().toString('base64');
}
function parameter(s,level,template){
 const params=Object.fromEntries(level.parameters.map(p=>[p.label,p.text]));
 for(const [label,field] of [['消耗法力值','useMP'],['消耗生命值','useHP'],['持续回合','round']])if(params[label]!==undefined&&numbers(params[label]).length===1)s[field]=Math.max(0,Math.round(numbers(params[label])[0]));
 if(params['攻击次数']!==undefined){const v=params['攻击次数'];if(numbers(v).length===1)s.atk_time=Math.max(0,numbers(v)[0]-(v.startsWith('+')?0:1));}
 for(const [label,field,table] of [['技能类型','skillAtkType','AtkTypeText'],['技能范围','area','skillAreaText'],['需求武器','skillWeapon','skillWeaponText']]){
  if(params[label]===undefined)continue;const v=clean(params[label]).replace(/、/g,'').replace(/单体目标/g,'单体').replace(/(近身|远程)(劈砍|穿刺)攻击/g,'$1$2').replace(/己方/g,'我').replace(/敌方/g,'敌').replace(/全部/g,'全体').replace(/(?:侠客|修真|战士|法师|贤者|枪王|武圣|锤师|岚舞)$/,'').replace(/^无$/,'无限制');
  const id=texts[table].findIndex(t=>clean(t).replace(/、/g,'')===v);if(id>=0)s[field]=id;else if(!template)issues.push({name:s.name,level:s.level,parameter:label,text:params[label],fallback:s[field]||0});
 }
 const consumption=params['技能消耗'];if(consumption){const mp=consumption.match(/(?:法力|魔法|MP)(?:值)?\s*[:：]?\s*(\d+)/i),hp=consumption.match(/(?:生命|HP)(?:值)?\s*[:：]?\s*(\d+)/i);if(mp)s.useMP=Number(mp[1]);if(hp)s.useHP=Number(hp[1]);}
 for(const field of ['round','atk_time'])s[field]=Math.min(127,Math.max(0,s[field]||0));
 for(const field of ['useMP','useHP'])s[field]=Math.min(65535,Math.max(0,s[field]||0));
}
const skills=projection.skills.map(g=>{
 const id=g.identity.id??allocate(g.key),job=JOBS[g.profession],nativeLevels=byNative.get(g.identity.id)||[],shop=1300+job;
 const old=g.type===1?legacy.skills.find(s=>s.job===job&&skillName(s.name,g.profession)===skillName(g.name,g.profession)):null;
 if(old)aliases[old.id]=id;
 const shops=[shop,...teacherShops[g.profession],...(old?[1100]:[])];
 const levels=g.levels.map(l=>{
  const exact=nativeLevels.find(s=>s.level===l.level);
  if(exact)return {...exact,id,wireBase64:exact.wireBase64||encode(exact),native:true,reconstructed:false,reqJob:job,reqLevel:1,origin:'official-definition',powers:[1,2,3].filter(i=>exact['power'+i]).map(i=>[exact['power'+i],exact['powerValue'+i]])};
  const template=nativeLevels.filter(s=>s.level<=l.level).at(-1)||nativeLevels[0];
  const s={id,level:l.level,name:g.name,type:g.type,skillWeapon:template?.skillWeapon||0,skillAtkType:template?.skillAtkType??4,area:template?.area??(g.type===2?30:10),round:template?.round||0,atk_time:template?.atk_time||0,useMP:template?.useMP||0,useHP:template?.useHP||0,anime1:template?.anime1||0,anime2:template?.anime2||0,anime3:template?.anime3||0,position:template?.position||0,reqJob:job,reqLevel:1,native:true,reconstructed:true,origin:l.origin};
  const methods=[];
  for(let i=1;i<=3;i++){
   const effect=l.effects.find(e=>e.index===i)||l.effects[i-1],mapped=effect?convertEffect(effect.text,template,g.type,i):{id:0,value:0,status:0,method:'empty'};
   s['power'+i]=mapped.id;s['powerValue'+i]=mapped.value;s['statusBit'+i]=mapped.status;methods.push(mapped.method);
   if(mapped.unmapped)issues.push({id,name:g.name,profession:g.profession,level:l.level,effect:i,text:mapped.unmapped,method:mapped.method});
  }
  parameter(s,l,template);
  s.info='单机重建（含社区资料与推算）\n'+l.effects.map(e=>normalizeSkillEffectUnits(e.text)).join('\n')+(methods.some(m=>m.includes('fallback')||m==='description-only')?'\n部分特殊效果沿用已录定义或仅供查阅，尚待实战校准。':'');
  s.powers=[1,2,3].filter(i=>s['power'+i]).map(i=>[s['power'+i],s['powerValue'+i]]);s.wireBase64=encode(s);return s;
 });
 if(id===435)for(const skill of levels){
  skill.statusBit1=0;skill.statusBit2=0;
    skill.info=(skill.info||'').split('\n').map(removePoisonBleeding).filter(Boolean).join('\n');
  skill.wireBase64=encode(skill);
 }
 return {id,key:g.key,sourceId:g.identity.id,name:g.name,profession:g.profession,category:g.category,type:g.type,native:true,career:true,job,shop,shops,levels};
});
const unmappedLegacy=legacy.skills.filter(s=>!Object.hasOwn(aliases,s.id));if(unmappedLegacy.length)throw Error('Legacy skills without migration: '+unmappedLegacy.map(s=>s.name).join(','));
if(new Set(skills.map(s=>s.id)).size!==skills.length)throw Error('Runtime IDs collide');
const teachers=Object.entries(JOBS).map(([name,job])=>({name,job,shop:1300+job,shops:teacherShops[name],count:skills.filter(s=>s.profession===name).length}));
const result={schema:1,version:'career-teachers-v1',effectRevision:'force-hit-unit-v2',generatedAt:new Date().toISOString(),learningMode:'free-local',maxLearned:100,aliases,teachers,skills};
fs.writeFileSync(path.join(root,'data/career-skills.json'),JSON.stringify(result)+'\n');
const metadata={version:result.version,effectRevision:result.effectRevision,learningMode:result.learningMode,maxLearned:result.maxLearned,teachers,skills:skills.map(s=>({id:s.id,key:s.key,name:s.name,profession:s.profession,category:s.category,type:s.type,shop:s.shop,maxLevel:22,levels:s.levels.map(l=>{const source=projection.skills.find(g=>g.key===s.key).levels[l.level-1];return {level:l.level,origin:l.origin,effects:source.effects.map(e=>normalizeSkillEffectUnits(s.id===435?removePoisonBleeding(e.text):e.text)),parameters:source.parameters.map(p=>s.id===435?{...p,text:removePoisonBleeding(p.text)}:p),learning:source.learning,reconstructed:l.reconstructed};})}))};
fs.writeFileSync(path.join(root,'data/career-skill-directory.json'),JSON.stringify(metadata)+'\n');
const counts={teachers:teachers.length,skills:skills.length,levels:skills.length*22,recorded:skills.flatMap(s=>s.levels).filter(l=>!l.reconstructed).length,localIds:skills.filter(s=>s.sourceId===null).length,legacyAliases:Object.keys(aliases).length,unmappedEffects:issues.filter(i=>i.effect).length,unmappedParameters:issues.filter(i=>i.parameter).length};
fs.writeFileSync(path.join(root,'analysis/career-skill-runtime-audit.json'),JSON.stringify({counts,teachers,issues},null,2)+'\n');
console.log(JSON.stringify(counts,null,2));

import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {fields,percentField,skillPowers} from '../lib/reference-fields.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(process.argv[2]||path.join(root,'../网络攻略资料_20260920'));
const files=['GitHub数据快照/vocationalSkills.json','公开数据快照/equipmentAtlas.json'];
const snapshots=files.map(file=>{const b=fs.readFileSync(path.join(source,file));return {file,sha256:createHash('sha256').update(b).digest('hex'),data:JSON.parse(b.toString('utf8').replace(/^\uFEFF/,''))};});
const jobs=[['swordsman','侠客',1],['xiuZhen','修真',2],['warrior','战士',3],['master','法师',4],['sages','贤者',5],['Woosung','武圣',6],['gunKing','枪王',10]];
const result={schema:1,client:305,source:'社区攻略；非官方配置，未核实与 v305 完全一致',sourceURL:'https://github.com/treefuture/world-online/tree/main/JSON_Data',snapshots:snapshots.map(({data,...s})=>s),policy:{ids:'本地分配，非官方 ID',skillCost:'本地体验规则：免费，等级不高于角色等级；只开放从 1 级连续可核验的等级，最多 20 级',equipment:'无强化、无鉴定、无附带技能、无套装效果的确定基础属性；售价为本地测试价',icons:'使用已有通用图标，非原物品图标映射'},jobs:jobs.map(([key,name,id])=>({key,name,id,shop:1100+id})),skills:[],equipment:[],skipped:[]};
for(const [job,name,jobId] of jobs){
 const rows=snapshots[0].data[job].passive;
 rows.forEach((s,index)=>{
   if(!s.version?.includes('世界H5'))return;
   const levels=[];let reason='';
   const rows=s.children?.skillLevel||[];
   for(let level=1;level<=20;level++){
     const candidates=rows.map((r,i)=>({r,i})).filter(({r})=>r.name?.match(/\((\d+)级\)/)?.[1]===String(level));
     if(candidates.length!==1){reason='缺少或重复等级 '+level;break;}
     const {r,i}=candidates[0];
     try{if(s.special)throw Error('含特殊机制，待还原');levels.push({level,powers:skillPowers(r),effects:r.skillAttribute,sourcePointer:`/${job}/passive/${index}/children/skillLevel/${i}`});}
     catch(e){reason=`等级 ${level}: ${e.message}`;break;}
   }
   const id=3000+jobId*100+index;
   if(levels.length)result.skills.push({id,name:s.value,job:jobId,type:1,shop:1100+jobId,levels,sourcePointer:`/${job}/passive/${index}`,stoppedAt:reason||'首批最高 20 级'});
   else result.skipped.push({kind:'skill',name:s.value,job:jobId,reason});
 });
}
// First batch uses single-hand swords. Their minimum/maximum damage, hit rate,
// attack count and requirements are explicit in the H5 source; no star extrapolation.
const h5=snapshots[1].data.equipmentAtlas.worldH5;
for(let g=0;g<h5.length;g++)h5[g].children.forEach((e,index)=>{
 const pointer=`/equipmentAtlas/worldH5/${g}/children/${index}`;
 if(e.types!=='单手剑')return;
 try{
  if(e.identify!=='不可鉴定'||e.skill||e.coordinatesEffect||e.advancedAttribute||e.status!=='不绑定')throw Error('包含未接入的鉴定、技能、套装或绑定机制');
  const [min,max,level,dur]=[e.minimumWeaponDamage,e.maximumWeaponDamage,e.levelLimits,e.durable];
  if(![min,max,level,dur].every(Number.isInteger)||min<0||max<min||max>32767||level<1||level>60||dur<1)throw Error('基础数值不完整');
  const constants=e.constantAttribute||[],hit=constants.find(x=>x.value==='hit')?.dataValue,times=constants.find(x=>x.value==='swordAttackTimes')?.dataValue;
  if(constants.length!==2||!Number.isInteger(hit)||hit<0||hit>255||!Number.isInteger(times)||times<1||times>10||e.attackMode!=='近身穿刺')throw Error('攻击模式、次数或命中不支持');
  const req=[0,0,0,0,0],labels=['力量','体质','敏捷','智力','感知'];
  if(!Array.isArray(e.wearingRestrictions))throw Error('缺少穿戴条件');
  for(const text of e.wearingRestrictions){const m=text.match(/^(\d+)(力量|体质|敏捷|智力|感知)$/);if(!m)throw Error('穿戴条件不明确');req[labels.indexOf(m[2])]=Number(m[1]);}
  const powers=[];
  for(const a of e.fixedAttribute||[]){
   if(a.option?.length!==a.basic?.length||a.attribute?.length!==a.basic?.length)throw Error('属性项长度不一致');
   for(let i=0;i<a.option.length;i++){
    const key=a.option[i].value,spec=fields[key],v=String(a.basic[i]);
    if(!spec||!/^\d+%?$/.test(v)||v.endsWith('%')!==percentField(key)||Number.parseInt(v)>32767||/绑定/.test(a.attribute[i]))throw Error('基础属性或绑定属性不支持');
    powers.push([spec[0],Number.parseInt(v)]);
   }
  }
  if(powers.length>3)throw Error('超出三个基础属性');
  const grade=['普通','精致','稀有','史诗','传说'].indexOf(e.quality);if(grade<0)throw Error('未知品质');
  result.equipment.push({id:800000+g*1000+index,name:e.name,type:13,grade,level,requirements:req,durability:dur,atkMin:min,atkMax:max,hit,attackTimes:times,powers,sourcePointer:pointer,sourceEffects:[...(e.attribute||[]),...(e.fixedAttribute||[]).flatMap(x=>x.attribute.map((a,i)=>`${a}: ${x.basic[i]}`))],localPrice:Math.max(20,level*20),localIcon:24});
 }catch(error){result.skipped.push({kind:'equipment',name:e.name,reason:error.message,sourcePointer:pointer});}
});
const output=path.join(root,'data/restored-v03.json');fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output,skills:result.skills.length,levels:result.skills.reduce((n,s)=>n+s.levels.length,0),equipment:result.equipment.length,jobs:result.jobs.map(j=>({job:j.name,skills:result.skills.filter(s=>s.job===j.id).length})),equipmentNames:result.equipment.map(e=>`${e.name}(${e.level})`),skipped:result.skipped.length},null,2));

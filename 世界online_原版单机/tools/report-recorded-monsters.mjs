import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {simple} from 'acorn-walk';
import {recordedExpansion as bundle} from '../lib/recorded-expansion.mjs';
import {official} from '../lib/official-data.mjs';
import {applyBossChallenges} from '../lib/boss-challenges.mjs';
import {mapBattleData} from '../lib/official-packets.mjs';
import {powerFormatter} from './catalog-format.mjs';
import {normalizeSkillEffectUnits} from './skill-effect-text.mjs';
import {decoders,Reader} from './capture-decoders.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const out=path.resolve(process.argv[2]||path.join(root,'analysis/本轮怪物属性'));
const d=decoders(root),format=powerFormatter(root),texts={};
const arrays=['bufferText','skillAreaText','skillTypeText','AtkTypeText','monsterAIConditionText','monsterAIText','monsterTypeText'];
simple(parse(fs.readFileSync(path.join(root,'analysis/modules/0004.js'),'utf8'),{ecmaVersion:'latest'}),{AssignmentExpression(n){
 if(n.left.type==='MemberExpression'&&arrays.includes(n.left.property.name)&&n.right.type==='ArrayExpression')texts[n.left.property.name]=n.right.elements.map(x=>x.value);
}});
for(const key of arrays)assert.ok(texts[key]?.length,key);
const labels={id:'怪物编号',name:'名称',icon1:'模型编号',level:'等级',monstertype:'怪物分类编码',hpMax:'最大生命',mpMax:'最大法力',speed:'速度',atkType:'攻击类型编码',atkMin:'伤害下限',atkMax:'伤害上限',atk_time:'攻击次数原字段（实际次数减一）',dodge:'闪避',atk_str:'劈砍攻击',atk_str_nearby:'近战劈砍攻击附加',atk_str_range:'远程劈砍攻击附加',atk_agi:'穿刺攻击',atk_agi_nearby:'近战穿刺攻击附加',atk_agi_range:'远程穿刺攻击附加',atk_magic:'魔法攻击',def_str:'劈砍防御',def_str_nearby:'近战劈砍防御附加',def_str_range:'远程劈砍防御附加',def_agi:'穿刺防御',def_agi_nearby:'近战穿刺防御附加',def_agi_range:'远程穿刺防御附加',def_magic:'魔法防御',hitrate:'物理命中',hitMagic:'魔法命中',critical:'致命',ignoreCritical:'忽视致命',criticalDmg:'致命伤害加成',ignore_back:'忽视反击',ignore_magic_back:'忽视魔法反馈',ignore_block:'忽视格挡',ignore_insight:'忽视洞察',ignore_touch:'忽视伤害减免',ignore_wil:'忽视状态抵抗',wil:'状态抵抗',tough:'伤害减免',block:'格挡',brkArmor:'破甲',insight:'洞察',def_field:'法力护盾',back:'反击',magic_back:'魔法反馈',life_absorption:'生命吸收',mana_absorption:'法力吸收',magic_penetration:'魔法穿透',bornStatus:'天生状态位掩码',newReflection:'反射原字段'};
const base=JSON.parse(fs.readFileSync(path.join(root,'data/official-v305.json')));applyBossChallenges(base);
const previous=new Set(base.monsters.map(m=>m.id));
const last=bundle.captures.at(-1),skillMap=new Map(bundle.skills.map(s=>[s.id+':'+s.level,s]));
const aiMap=new Map(bundle.ai.map(a=>[a.id,a]));
const mapRows=bundle.maps.map(m=>({id:m.id,name:m.name,...mapBattleData(m.id)}));
const clean=s=>String(s??'').replace(/\/c[0-9a-fA-F]{6}|\/p/g,'');
const name=(table,value)=>texts[table]?.[value]||'编码 '+value;
function skill(ref){
 if(!ref?.id)return null;
 const raw=skillMap.get(ref.id+':'+ref.level);
 if(!raw)return {...ref,missing:true,name:'技能 '+ref.id,description:'未下发完整技能定义'};
 const effects=[1,2,3].filter(i=>raw['power'+i]||raw['statusBit'+i]).map(i=>({slot:i,power:raw['power'+i],value:raw['powerValue'+i],statusId:raw['statusBit'+i],text:raw['power'+i]?clean(normalizeSkillEffectUnits(format(raw['power'+i],raw['powerValue'+i],raw))):'无数值效果',status:raw['statusBit'+i]?name('bufferText',raw['statusBit'+i]):'无'}));
 return {id:raw.id,level:raw.level,name:raw.name,type:name('skillTypeText',raw.type),attackType:name('AtkTypeText',raw.skillAtkType),area:name('skillAreaText',raw.area),rounds:raw.round,useMP:raw.useMP,useHP:raw.useHP,extraAttacks:raw.atk_time,effects,raw};
}
const monsters=bundle.monsters.map(raw=>{
 const check=new Reader(Buffer.from(raw.wireBase64,'base64')),roundtrip=JSON.parse(JSON.stringify(d.Monster.fromBytes(check)));check.finish();
 for(const [key,value] of Object.entries(roundtrip)){assert.deepEqual(raw[key],value,raw.id+':'+key);if(key!=='wireBase64')assert.ok(labels[key],'unlabelled field '+key);}
 const ai=aiMap.get(raw.id),skills=new Map();
 const rules=ai?.conType.map((type,i)=>{
  const refs=[ai.skill1[i],ai.skill2[i]].map(skill);for(const s of refs)if(s)skills.set(s.id+':'+s.level,s);
  return {order:i+1,condition:name('monsterAIConditionText',type).replace('%U',ai.conValue[i]),conditionCode:type,value:ai.conValue[i],target:name('monsterAIText',ai.targetType[i]),targetCode:ai.targetType[i],speech:ai.msg[i],slots:refs.map(s=>s?{id:s.id,level:s.level,name:s.name}:null)};
 })||[];
 const bits=BigInt(raw.bornStatus),states=[];for(let bit=1;bit<64;bit++)if(bits&(1n<<BigInt(bit)))states.push({bit,name:texts.bufferText[bit]||'未知状态位 '+bit});
 return {id:raw.id,name:raw.name,newToLocal:!previous.has(raw.id),latestCapture:raw.sources.some(s=>s.capture===last.id),category:name('monsterTypeText',raw.monstertype),attackType:name('AtkTypeText',raw.atkType),actualBasicAttacks:Math.max(1,Math.min(99,raw.atk_time+1)),maps:mapRows.filter(m=>m.monsters.some(x=>x.id===raw.id)).map(m=>({id:m.id,name:m.name})),states,aiPresent:!!ai,aiRules:rules,skills:[...skills.values()],raw,aiRaw:ai||null};
}).sort((a,b)=>Number(b.latestCapture)-Number(a.latestCapture)||b.raw.hpMax-a.raw.hpMax||a.id-b.id);
const report={generatedAt:new Date().toISOString(),cutoff:last.audit.cutoffAt,captures:bundle.captures.map(c=>({id:c.id,cutoff:c.audit.cutoffAt,cleanEnd:c.audit.cleanEnd,cutoffSeq:c.audit.cutoffSeq})),counts:{monsters:monsters.length,newToLocal:monsters.filter(m=>m.newToLocal).length,latestCapture:monsters.filter(m=>m.latestCapture).length,withAI:monsters.filter(m=>m.aiPresent).length,withoutAI:monsters.filter(m=>!m.aiPresent).length},labels,monsters};
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'怪物完整属性与技能.json'),JSON.stringify(report,null,2)+'\n');
const num=v=>typeof v==='number'?v.toLocaleString('en-US'):String(v);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const table=rows=>'<table><tbody>'+rows.map(([k,v])=>'<tr><th>'+safe(k)+'</th><td>'+safe(v)+'</td></tr>').join('')+'</tbody></table>';
const intro=`本轮 ${bundle.captures.length} 份录制，共 ${monsters.length} 种怪物；最近一份含 ${report.counts.latestCapture} 种。本次相对修复前单机新增 ${report.counts.newToLocal} 种。校验截止北京时间 ${new Date(last.audit.cutoffAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}。${last.audit.cleanEnd?'最新一份录制已正常结束，本报告已包含其结束前全部可解码定义。':'最新录制尚未结束，之后新增包不包含在本报告中。'}`;
const limits='以下是服务器下发的完整 Monster 基础属性块，逐条按原版 v305 解码。属性原值不等于最终伤害或百分比；例如伤害减免 60000 不能写成 60000%。战斗内临时增益、阵型倍率和动态结算需另算。AI 未下发不代表怪物没有技能。怪异的园丁仍保留你先前的单机调整；本表列正式服原始值。';
const md=['# 本轮录制怪物完整属性与技能','',intro,'',limits,'',`已下发 AI：${report.counts.withAI} 种；未下发 AI：${report.counts.withoutAI} 种。`,'','## 快速索引','','| 名称 / 编号 | 等级 | 生命 | 法力 | 劈砍 / 穿刺 / 魔法防御 | 伤害减免 | 技能数 |','|---|---:|---:|---:|---|---:|---:|'];
for(const m of monsters)md.push(`| ${m.name} [${m.id}] | ${m.raw.level} | ${num(m.raw.hpMax)} | ${num(m.raw.mpMax)} | ${num(m.raw.def_str)} / ${num(m.raw.def_agi)} / ${num(m.raw.def_magic)} | ${num(m.raw.tough)} | ${m.aiPresent?m.skills.length:'未下发AI'} |`);
const cards=[];
for(const m of monsters){
 const rows=Object.entries(labels).filter(([k])=>k in m.raw).map(([k,label])=>[label+' · '+k,num(m.raw[k])]);
 const state=m.states.map(s=>s.name+'（位 '+s.bit+'）').join('、')||'无';
 md.push('',`## ${m.name} [${m.id}]`,'',`关联地图：${m.maps.map(x=>x.name+' ['+x.id+']').join('、')||'仅在战斗定义中出现'}。分类：${m.category}。攻击类型：${m.attackType}。普通攻击次数：${m.actualBasicAttacks}（原字段 + 1）。`,'','| 属性 / 原字段 | 数值 |','|---|---:|',...rows.map(([k,v])=>`| ${k} | ${v} |`),'','天生状态位：'+state+'。','');
 let html='<h2>'+safe(m.name)+' <small>#'+m.id+'</small></h2><p>'+safe(m.maps.map(x=>x.name).join(' · ')||'仅有战斗定义')+' · '+safe(m.category)+' · '+safe(m.attackType)+' · 普攻 '+m.actualBasicAttacks+' 次</p><h3>全部基础属性</h3><div class="stats">'+table(rows)+'</div><h3>天生状态</h3><p>'+safe(state)+'</p><p class="note">状态位是原客户端标记；对应减益位可能用于免疫判定，不应直接理解为正在承受减益。</p><h3>技能与 AI</h3>';
 if(!m.aiPresent){md.push('此怪物未下发 AI / 技能关联，暂无法确认完整技能表。');html+='<p>此怪物未下发 AI / 技能关联，暂无法确认完整技能表。</p>';}
 for(const rule of m.aiRules){const line=`规则 ${rule.order}：${rule.condition}；目标：${rule.target}；技能槽 1：${rule.slots[0]?rule.slots[0].name+' Lv.'+rule.slots[0].level:'无'}；技能槽 2：${rule.slots[1]?rule.slots[1].name+' Lv.'+rule.slots[1].level:'无'}。`;md.push('- '+line);html+='<p>'+safe(line)+'</p>';}
 md.push('','技能槽和条件按原包列出；多条“50%执行”不代表所有技能各自独立占50%。');
 for(const s of m.skills){
  md.push('',`### ${s.name} Lv.${s.level} [${s.id}]`,'');html+='<h4>'+safe(s.name)+' Lv.'+s.level+' ['+s.id+']</h4>';
  if(s.missing){md.push(s.description);html+='<p>'+safe(s.description)+'</p>';continue;}
  const meta=`${s.type}；${s.attackType}；范围：${s.area}；耗蓝 ${s.useMP}、耗血 ${s.useHP}；持续回合原值 ${s.rounds}；附加攻击次数原值 ${s.extraAttacks}。`;
  md.push(meta,'','| 效果 | 状态 | power / value |','|---|---|---|');html+='<p>'+safe(meta)+'</p><ul>';
  for(const e of s.effects){md.push(`| ${e.text} | ${e.status} | ${e.power} / ${e.value} |`);html+='<li>'+safe(e.text)+'；状态：'+safe(e.status)+' <small>('+e.power+' / '+e.value+')</small></li>';}
  html+='</ul>';
 }
 const source=m.raw.sources[0];md.push('',`属性证据：${source.capture}，包序号 ${source.seq}，协议 ${source.protocol}，SHA256 ${source.sha256}。`);
 html+='<details><summary>原始字段与来源</summary><pre>'+safe(JSON.stringify({monster:m.raw,ai:m.aiRaw,skills:m.skills.map(s=>s.raw||s)},null,2))+'</pre></details>';
 cards.push({id:m.id,name:m.name,level:m.raw.level,hp:m.raw.hpMax,latest:m.latestCapture,fresh:m.newToLocal,text:[m.name,m.id,...m.maps.map(x=>x.name),...m.skills.map(s=>s.name)].join(' '),html});
}
fs.writeFileSync(path.join(out,'怪物完整属性与技能.md'),md.join('\n')+'\n');
const data=JSON.stringify(cards).replace(/</g,'\\u003c');
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本轮怪物属性 · 世界 OL</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0e1723;color:#e5edf6;font:15px/1.65 system-ui,"Microsoft YaHei",sans-serif}header{padding:28px 32px 20px;border-bottom:1px solid #334158}h1{font-size:27px;margin:0 0 12px}h2{font-size:26px;color:#8dd9ff}h3{margin-top:32px;border-bottom:1px solid #364a60}h4{color:#eac27b}p{max-width:1100px}small,.note{color:#a2b4c8}main{display:grid;grid-template-columns:300px 1fr;min-height:70vh}nav{padding:18px;max-height:85vh;overflow:auto;position:sticky;top:0;border-right:1px solid #334158}input,select{width:100%;padding:11px;margin-bottom:10px;color:inherit;background:#182737;border:1px solid #47617b;border-radius:6px}button{display:block;width:100%;background:#172739;color:inherit;border:1px solid #2a3e54;padding:10px;text-align:left;margin:7px 0;border-radius:5px;cursor:pointer}button[aria-current=true]{border-color:#6dc6f4;background:#22435b}article{padding:16px 35px 50px;min-width:0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px 12px;border-bottom:1px solid #283c50}th{font-weight:400;color:#b7c8da}td{font-variant-numeric:tabular-nums;color:#fff}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#101d2d;padding:16px;font-size:12px}details{margin-top:25px}a{color:#8dd9ff}@media(min-width:1050px){.stats{columns:2;column-gap:24px}.stats tr{break-inside:avoid}.stats table{display:block}}@media(max-width:700px){header{padding:20px}main{display:block}nav{max-height:290px;position:static}article{padding:15px}h1{font-size:22px}}
</style></head><body><header><h1>世界 OL · 新录制怪物完整属性</h1><p>${safe(intro)}</p><p class="note">${safe(limits)}</p><p>原始数据：<a href="怪物完整属性与技能.json">JSON</a> · 全文：<a href="怪物完整属性与技能.md">Markdown</a></p></header><main><nav><label for="search">搜索名称 / 编号 / 地图 / 技能</label><input id="search" placeholder="例如：复仇死神、炼药大师"><select id="filter" aria-label="数据范围"><option value="all">本轮全部 ${monsters.length} 种</option><option value="latest">最近一份 ${report.counts.latestCapture} 种</option><option value="fresh">此次新增单机 ${report.counts.newToLocal} 种</option></select><p id="count"></p><div id="list"></div></nav><article id="detail" aria-live="polite"></article></main><script>
const rows=${data};let selected=4133;const search=document.getElementById('search'),filter=document.getElementById('filter'),list=document.getElementById('list'),detail=document.getElementById('detail');
function render(){const query=search.value.trim().toLowerCase(),found=rows.filter(r=>r.text.toLowerCase().includes(query)&&(filter.value==='all'||filter.value==='latest'&&r.latest||filter.value==='fresh'&&r.fresh));document.getElementById('count').textContent='共 '+found.length+' 种';if(!found.some(r=>r.id===selected))selected=found[0]?.id;list.replaceChildren();for(const r of found){const b=document.createElement('button');b.type='button';b.textContent=r.name+' · '+r.level+'级 / #'+r.id;b.setAttribute('aria-current',String(r.id===selected));b.onclick=()=>{selected=r.id;render()};list.append(b)}detail.innerHTML=rows.find(r=>r.id===selected)?.html||'<p>没有匹配的怪物。</p>'}search.oninput=render;filter.onchange=render;render();
</script></body></html>`;
fs.writeFileSync(path.join(out,'怪物完整属性与技能.html'),html);
console.log(JSON.stringify({out,...report.counts,cutoff:report.cutoff,bytes:Buffer.byteLength(html)},null,2));

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {projectSkill,estimateField,resolveNative,learningCosts,selectReference,referenceAnchor} from '../tools/skill-projection-core.mjs';
const guide={key:'guide:1:2',name:'样例',profession:'侠客',type:1,category:'被动',effects:[{index:1,description:'力量+100'}],parameters:[],content:'效果1：力量+100',sources:[]};
const anchor=(level,text,origin='official-definition')=>({level,origin,effects:[{index:1,text,origin}],parameters:[]});
test('missing levels interpolate signed magnitudes, preserve exact anchors and never execute as a packet',()=>{
 const natives=[{id:42,name:'样例',type:1,level:1,display:anchor(1,'力量+5'),sources:[]},{id:42,name:'样例',type:1,level:11,display:anchor(11,'力量+55'),sources:[]}];
 const skill=projectSkill(guide,natives,[]);assert.equal(skill.levels.length,22);assert.equal(skill.levels[5].effects[0].text,'力量+30');assert.equal(skill.levels[0].effects[0].text,'力量+5');assert.equal(skill.levels[21].effects[0].text,'力量+100');assert.equal(skill.levels[5].origin,'estimated');assert.equal(skill.levels[5].completeCombatDefinition,false);assert.equal(skill.levels[5].wireBase64,undefined);
 const negative=estimateField({text:'生命-100'},'effects',6,[anchor(1,'生命-100'),anchor(11,'生命-600')]);assert.equal(negative.text,'生命-350');
});
test('discrete thresholds, state, attack count and target range are step-held, not multiplied',()=>{
 for(const text of ['用剑时攻击次数+3','免疫物理攻击','生命小于50%时复活','持续5回合']){const result=estimateField({text},'effects',5,[anchor(22,text)]);assert.equal(result.text,text);assert.equal(result.method,'step-hold');assert.equal(result.confidence,'low');}
 const points=[{...anchor(1,'力量+1'),parameters:[{label:'技能范围',text:'敌2人'}]},{...anchor(22,'力量+22'),parameters:[{label:'技能范围',text:'敌6人'}]}];assert.equal(estimateField({label:'技能范围',text:'敌2人'},'parameters',15,points).text,'敌2人');
});
test('same-name pet or monster skill is not linked when a career shop disambiguates it',()=>{
 const native=[{id:14,name:'样例',type:1,reqJob:1,sources:[{origin:'shop',shopId:304}]},{id:968,name:'样例',type:1,reqJob:8,sources:[{origin:'shop',shopId:2003}]},{id:1400,name:'样例',type:1,sources:[{origin:'monsterAI'}]}];
 assert.equal(resolveNative(guide,native).id,14);assert.equal(resolveNative(guide,native.slice(1)).id,null);
});
test('cost preserves actual tier and quote, rejects pet fee anchors, keeps four currencies and totals distinct',()=>{
 const s={id:14,level:1,sp:5,money1:0,money2:0,money3:10000,reqJob:1,reqLevel:57,sources:[{origin:'shop',shopId:308}]};
 const result=learningCosts(guide,[s,{...s,money3:1,sources:[{origin:'shop',shopId:2001}]}]);assert.equal(result.baseCopper,10000);assert.equal(result.observed.length,1);assert.equal(result.levels[0].own.copper,10000);assert.equal(result.levels[1].cross.copper,40000);assert.equal(result.levels[10].own.origin,'estimated');assert.equal(result.levels[10].own.gold,0);assert.equal(result.levels[15].own.goldLeaves,0);assert.equal(result.levels[21].own.total.sp,1265);assert.equal(result.levels[21].cross.total.sp,2530);
});
test('other-version reference selected by observed anchors remains explicitly unverified',()=>{
 const make=(name,value)=>({record_id:name,group:'侠客',mode:'被动',name:'样例(22级)',versions:['小程序'],raw:{name:'样例(22级)',skillAttribute:['力量+'+value],children:{skillLevel:[{name:'样例(1级)',skillAttribute:['力量+5']}]}}});
 const references=[make('wrong',200),make('matching',100)];assert.equal(selectReference(guide,references).selected.record_id,'matching');const result=projectSkill(guide,[],references);assert.equal(result.levels[0].origin,'community-other-version');assert.equal(result.levels[21].origin,'official-guide');
});
test('community duplicate or official conflict remains reviewable without modifying source objects',()=>{
 const row={record_id:'test',group:'侠客',mode:'被动',name:'样例(22级)',versions:['世界H5'],raw:{name:'样例(22级)',skillAttribute:['力量+100'],children:{skillLevel:[{name:'样例(1级)',skillAttribute:['力量+7']}]}}};const before=JSON.stringify(row);
 const result=projectSkill(guide,[{id:1,name:'样例',type:1,level:1,display:anchor(1,'力量+5'),sources:[]}],[row]);assert.equal(result.levels[0].effects[0].text,'力量+5');assert.equal(result.conflicts[0].alternative.effects[0].text,'力量+7');assert.equal(JSON.stringify(row),before);
});
test('resource costs are separate from skill learning cost',()=>{
 const result=referenceAnchor({name:'火云掌(1级)',skillAttribute:['生命-100'],skillConsumption:'10法力、2生命',round:1,range:'敌正方'},'community-h5');assert.deepEqual(result.parameters.filter(p=>p.label.startsWith('消耗')).map(x=>[x.label,x.text]),[['消耗法力值','10'],['消耗生命值','2']]);
});
test('text/numeric contradictions and isolated source typos are corrected provisionally with original evidence',()=>{
 const corrected=referenceAnchor({name:'基础掌法(20级)',empty_handedWeaponDamage:105,hit:105,skillAttribute:['空手伤害+2%','物理命中+2']},'community-h5');
 assert.equal(corrected.origin,'estimated');assert.equal(corrected.effects[0].text,'空手伤害+105%');assert.equal(corrected.effects[0].rawText,'空手伤害+2%');
 const ref={record_id:'test',group:'侠客',mode:'被动',name:'样例(22级)',versions:['世界H5'],raw:{name:'样例(22级)',skillAttribute:['力量+100'],children:{skillLevel:[1,2,3,4,5].map(level=>({name:`样例(${level}级)`,skillAttribute:[`力量+${level===3?99:level*5}`]}))}}};
 const result=projectSkill(guide,[],[ref]);assert.equal(result.levels[2].effects[0].text,'力量+15');assert.equal(result.levels[2].effects[0].rawText,'力量+99');assert.equal(result.levels[2].origin,'estimated');
});
test('recovery amounts interpolate while immunity and statuses remain discrete',()=>{
 const result=estimateField({text:'每回合自动恢复法力+10'},'effects',6,[anchor(1,'每回合自动恢复法力+10'),anchor(11,'每回合自动恢复法力+110')]);assert.equal(result.text,'每回合自动恢复法力+60');
 const damage=estimateField({text:'造成最大生命值1%的伤害'},'effects',6,[anchor(1,'造成最大生命值1%的伤害'),anchor(11,'造成最大生命值-5%的伤害')]);assert.equal(damage.text,'造成最大生命值3%的伤害');
});
test('delivered nine-profession dataset has all 22 levels and exact official guide end points',()=>{
 const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8')),data=read('../data/skill-progression.json'),guides=read('../data/official-guides.json').records;
 assert.equal(data.skills.length,470);assert.equal(data.counts.professions,9);assert.equal(data.counts.levelRecords,10340);const keys=new Set();
 for(const skill of data.skills){assert.ok(!keys.has(skill.key));keys.add(skill.key);assert.deepEqual(skill.levels.map(l=>l.level),Array.from({length:22},(_,i)=>i+1));const original=guides.find(g=>g.key===skill.sourceGuideKey);assert.deepEqual(skill.levels.at(-1).effects.map(e=>e.text),original.effects.map(e=>e.description.trim().replace(/[;；\s]+$/g,'')));
  const sums={own:{sp:0,copper:0,goldLeaves:0,gold:0},cross:{sp:0,copper:0,goldLeaves:0,gold:0}};
  for(const level of skill.levels){assert.ok(level.effects.length);for(const mode of ['own','cross'])for(const key of Object.keys(sums[mode])){const price=level.learning[mode][key];assert.ok(Number.isSafeInteger(price)&&price>=0);sums[mode][key]+=price;assert.equal(level.learning[mode].total[key],sums[mode][key]);}for(const e of [...level.effects,...level.parameters]){assert.ok(!/NaN|undefined|Infinity/.test(e.text));if(e.origin==='estimated'){assert.ok(e.method);assert.ok(e.basis.length);}}}
 }
});

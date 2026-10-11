import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {parse} from 'acorn';
import {simple} from 'acorn-walk';
import {fileURLToPath} from 'node:url';
import {Reader} from '../tools/capture-decoders.mjs';
import {decodeGuide,guideRequest,guideTasks,guideSkills,guideFields,mergeGuide,readGuideCapture} from '../tools/guide-core.mjs';
import {request,decode,initialState,applyResult} from '../tools/catalog-core.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),folder=path.resolve(root,'../正式服录制数据/2026-09-20T14-58-37-867Z_50e9cd');
const sample=fs.readFileSync(path.join(folder,'blobs/2e/2ef4f519262d6c19ddc46b04c2765236ed10e5c06648cc978af89cec423233e3.bin'));

test('recorded level-22 guide matches the native parser and preserves every complete effect',()=>{
 const page=decodeGuide(1201,sample);assert.equal(page.title,'22级被动技能效果');assert.equal(page.parentId,1200);assert.equal(page.entries.length,24);
 const raw=fs.readFileSync(path.join(root,'analysis/modules/0207.js'),'utf8'),source=raw.startsWith('function(')?'('+raw+')':raw;let code;
 simple(parse(source,{ecmaVersion:'latest'}),{AssignmentExpression(n){if(n.left.type==='MemberExpression'&&n.left.property.name==='fromBytes'&&n.right.type==='FunctionExpression')code=source.slice(n.right.start,n.right.end);}});
 assert.ok(code);class Entry{}Entry.TYPE_CONTENT=1;
 const native=new vm.Script('('+code+')').runInNewContext({e:Entry,go:{isWxP8:false}},{timeout:1000}),r=new Reader(sample.subarray(4));
 assert.equal(r.getInt(),page.parentId);assert.equal(r.getString(),page.title);assert.equal(r.getByte(),page.entries.length);
 for(const entry of page.entries){const value=native.call(Entry,r);assert.equal(value.id,entry.id);assert.equal(value.type,entry.type);assert.equal(value.menu,entry.name);assert.equal(value.content,entry.content);}r.finish();
 assert.equal(page.entries[0].content,'效果1：法力上限+900  效果2：智力+80  效果3：生命上限+900  需求武器：无限制');
 assert.throws(()=>decodeGuide(1201,sample.subarray(0,-1)),/envelope/);
});

test('guide queue follows only server-listed career links and never guesses IDs or reads content as pages',()=>{
 assert.deepEqual(guideTasks([]).map(q=>q.id),[0]);
 const rootPage={id:0,parentId:-1,title:'',entries:[{id:38,type:0,name:'职业技能'},{id:999,type:0,name:'其他功能'}]},career={id:38,parentId:0,title:'职业技能',entries:[{id:1200,type:0,name:'修真技能'}]},profession={id:1200,parentId:38,title:'修真技能',entries:[{id:1201,type:0,name:'22级被动技能效果'},{id:1202,type:0,name:'22级自动技能效果'}]};
 assert.deepEqual(guideTasks([rootPage]).map(q=>q.id),[38]);assert.deepEqual(guideTasks([rootPage,career]).map(q=>q.id),[1200]);
 const pages=[rootPage,career,profession,decodeGuide(1201,sample)];assert.deepEqual(guideTasks(pages).map(q=>q.id),[1202]);assert.ok(!guideTasks(pages).some(q=>[999,1205].includes(q.id)));
});

test('guide skill effects retain menu identity and stay separate from complete native skill definitions',()=>{
 const rows=guideSkills([{id:1200,title:'修真技能'},decodeGuide(1201,sample)],[{id:701,name:'灵性根基',type:1,level:1}]);
 assert.equal(rows.length,24);const skill=rows.find(s=>s.name==='灵性根基');
 assert.equal(skill.guideEntryId,1205);assert.deepEqual(skill.matchingSkillIds,[701]);assert.equal(skill.level,22);assert.equal(skill.profession,'修真');assert.equal(skill.completeCombatDefinition,false);assert.equal(skill.wireBase64,undefined);
 assert.deepEqual(skill.effects.map(e=>e.description),['法力上限+900','智力+80','生命上限+900']);assert.equal(skill.weaponRequirement,'无限制');
 const pages=[];mergeGuide(pages,decodeGuide(1201,sample,{seq:1}));mergeGuide(pages,decodeGuide(1201,sample,{seq:2}));assert.equal(pages.length,1);assert.equal(pages[0].sources.length,2);
 const changed={...decodeGuide(1201,sample,{seq:3}),wireBase64:'changed-definition'};mergeGuide(pages,changed);assert.equal(pages[0].sources.length,1);assert.equal(pages[0].sources[0].seq,3);assert.equal(pages[0].variants[0].sources.length,2);
 const state=initialState({catalog:[]});applyResult(state,{kind:'guide',id:1201},decode({kind:'guide',id:1201},sample));assert.equal(state.guidePages.length,1);assert.equal(state.skillDefinitions.length,0);
 assert.equal(request({kind:'guide',id:1201}).hex,guideRequest(1201).hex);assert.throws(()=>request({kind:'guide',id:-1}),/Invalid/);assert.throws(()=>request({kind:'guide',id:1.5}),/Invalid/);
});

test('live capture extraction pairs and hash-checks public guide frames without exporting login or chat',()=>{
 const result=readGuideCapture(folder);assert.ok(result.pages.some(p=>p.id===1201));assert.ok(result.snapshot.responses>=12);
 assert.ok(result.pages.every(p=>p.sources.every(s=>s.protocol===16005&&s.requestSeq&&s.seq&&s.sha256)));
 assert.equal(JSON.stringify(result).includes('5002'),false);assert.equal(result.snapshot.pendingRequests,0);
});

test('active guide separates costs, attack count, status and range without dropping negative or semicolon effects',()=>{
 const fields=guideFields('效果1：造成-1470伤害;效果二：附带命中+280  消耗法力值：220  技能类型：近身劈砍攻击  攻击次数：1  持续回合：5  范围：敌正方  侠客  需求武器：空手');
 assert.deepEqual(fields,[{label:'效果1',value:'造成-1470伤害'},{label:'效果二',value:'附带命中+280'},{label:'消耗法力值',value:'220'},{label:'技能类型',value:'近身劈砍攻击'},{label:'攻击次数',value:'1'},{label:'持续回合',value:'5'},{label:'范围',value:'敌正方  侠客'},{label:'需求武器',value:'空手'}]);
});

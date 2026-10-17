#!/usr/bin/env node
/**
 * 副本数据缺口扫描 —— 回答「我的版本还缺什么」。
 *
 * 用法：
 *   node tools/audit-dungeon-gaps.mjs [对方工程或data目录]
 *   node tools/audit-dungeon-gaps.mjs C:/path/to/other/data
 *
 * 对比四层数据，缺的按「能不能补」分类：
 *   ① 任务链断点：submitNextMissionID 指向不存在的任务（副本链断在这里）
 *   ② 缺地形图的地图：有任务在用，但 data/maps/<id>.json 不存在
 *   ③ 未注册场景：对方有场景记录、自己没有
 *   ④ 道具缺口：对方有、自己没有（并检查定义是否完整 —— 不完整的移过来也用不了）
 *
 * 只报告不改数据。要补的话按报告里给出的 id 逐项处理。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const theirDir=process.argv[2];

function readJson(p){try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}}

// —— 本工程：数据是「官方表 + 若干扩展」叠出来的，得全部读 ——
const myData=path.join(root,'data');
const myTables=[['official-v305.json'],['recorded-expansion-20260922.json'],['captured81-20260926.json']];
const my={missions:new Map(),groups:new Map(),monsters:new Map(),maps:new Map(),items:new Map()};
for(const [file] of myTables){
 const d=readJson(path.join(myData,file));if(!d)continue;
 for(const q of d.missions||[])my.missions.set(q.id,q);
 for(const g of d.groups||[])my.groups.set(g.groupId,g);
 for(const m of d.monsters||[])my.monsters.set(m.id,m);
 for(const m of d.maps||[])my.maps.set(m.id,m);
 for(const i of d.items||[])my.items.set(i.id,i);
}
// 本地补写的场景（content.mjs / 新模块造的）也要算进来，用运行时结果最准
const official=await import(pathToFileURL(path.join(root,'lib','official-data.mjs')).href);
for(const q of official.officialMissions.values())my.missions.set(q.id,q);
for(const m of official.official.maps)my.maps.set(m.id,m);
for(const i of official.officialItems.values())my.items.set(i.id,i);
for(const g of official.officialGroups.values())my.groups.set(g.groupId,g);
for(const m of official.officialMonsters.values())my.monsters.set(m.id,m);

const myMapFiles=new Set(fs.existsSync(path.join(myData,'maps'))
 ?fs.readdirSync(path.join(myData,'maps')).filter(f=>f.endsWith('.json')).map(f=>+f.replace('.json','')):[]);

console.log('本工程：任务 '+my.missions.size+'｜场景 '+my.maps.size+'｜编队 '+my.groups.size+
 '｜怪物 '+my.monsters.size+'｜道具 '+my.items.size+'｜地形文件 '+myMapFiles.size);

/* ---------- ① 任务链断点 ---------- */
console.log('\n【① 任务链断点】（下一环任务不存在 = 副本链断在这里）');
// 必须走 missionFollowupId：1677→1678 和 1358→1358 这类缺失由它特判绕过
// （见 lib/official-rules.mjs），直接看 submitNextMissionID 会把已通的链误报成断点。
const {missionFollowupId}=await import(pathToFileURL(path.join(root,'lib','official-rules.mjs')).href);
const broken=[...my.missions.values()].filter(q=>{
 const next=missionFollowupId(q);
 return next>0&&!my.missions.has(next);
});
if(!broken.length)console.log('  无');
for(const q of broken.sort((a,b)=>a.mapId-b.mapId||a.id-b.id))
 console.log('  地图'+String(q.mapId).padStart(4)+'  '+q.id+' '+q.name+' → 缺失 '+q.submitNextMissionID);

/* ---------- 没有对方数据时只看本地 ---------- */
if(!theirDir){
 console.log('\n（未提供对方目录，只做了本地体检。传一个 data 目录可以对比补齐）');
 process.exit(0);
}

const their={missions:new Map(),groups:new Map(),monsters:new Map(),maps:new Map(),items:new Map()};
for(const f of ['official-v305.json','data/recorded-expansion-20260922.json','data/captured81-20260926.json']){
 const d=readJson(path.join(theirDir,f))||readJson(path.join(theirDir,path.basename(f)));
 if(!d)continue;
 for(const q of d.missions||[])their.missions.set(q.id,q);
 for(const g of d.groups||[])their.groups.set(g.groupId,g);
 for(const m of d.monsters||[])their.monsters.set(m.id,m);
 for(const m of d.maps||[])their.maps.set(m.id,m);
 for(const i of d.items||[])their.items.set(i.id,i);
}
console.log('\n对方：任务 '+their.missions.size+'｜场景 '+their.maps.size+'｜编队 '+their.groups.size+
 '｜怪物 '+their.monsters.size+'｜道具 '+their.items.size);

/* ---------- ② 有任务在用但缺地形 ---------- */
console.log('\n【② 缺地形图】（任务引用了它，但 data/maps/<id>.json 不在）');
const noTerrain=[...my.missions.values()]
 .map(q=>q.mapId||0).filter(id=>id>0&&!myMapFiles.has(id));
const needTerrain=[...new Set(noTerrain)].sort((a,b)=>a-b);
console.log(needTerrain.length?needTerrain.map(id=>'  '+id).join('\n'):'  无');

/* ---------- ③ 对方有、我没有的场景 ---------- */
console.log('\n【③ 对方有场景、我没有】（可直接搬）');
const sceneGap=[...their.maps.keys()].filter(id=>!my.maps.has(id)).sort((a,b)=>a-b);
console.log(sceneGap.length?sceneGap.map(id=>'  '+id+' '+their.maps.get(id).name).join('\n'):'  无');

/* ---------- ④ 道具缺口 ---------- */
console.log('\n【④ 道具缺口】（★ = 定义不完整，搬了也用不了）');
const itemGap=[...their.items.values()].filter(i=>!my.items.has(i.id));
const usable=itemGap.filter(i=>i.definitionBase64);
console.log('  共 '+itemGap.length+' 件，其中定义完整可用的 '+usable.length+' 件');
if(usable.length)console.log('  可用：'+usable.slice(0,40).map(i=>i.id+' '+i.name).join(' / '));

/* ---------- ⑤ 断点能否用对方的数据补 ---------- */
console.log('\n【⑤ 断点补齐可行性】');
for(const q of broken){
 const ok=their.missions.has(q.submitNextMissionID);
 console.log('  '+q.id+' → '+q.submitNextMissionID+(ok?'  ★对方有，可搬':'  对方也缺，只能补写'));
}
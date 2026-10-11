import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mergeLocalPets,localPetData} from '../lib/local-pets.mjs';
import {applyLocalPetAssets} from '../lib/local-pet-assets.mjs';
import {buildReskin} from '../tools/build-pet-reskin.mjs';
import {petProfiles,selectablePetEggs,legendaryPetPool,SELECTABLE_PET_EGG_ID_START} from '../lib/pet-catalog.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const raw=path.join(root,'client');

/** 造一个最小的上游目录，够 mergeLocalPets 做继承与重名校验用。 */
function upstream(){
 const parent={
  key:'电气鼠(变异):4',name:'电气鼠（变异）',grade:4,evolved:false,family:'电气鼠',quality:'传说',
  baseline:{level:1,icon:'111',hp:170,mp:310,grade:4,model:345,headIcon:545,templateId:345,
   catalogKey:'电气鼠(变异):4',
   attributes:{strength:3,constitution:9,agility:19,intelligence:28,wisdom:25},
   baseStats:[3,9,19,28,25],grow:95,comprehension:95,hit:220,attackType:4,
   attackMin:30,attackMax:450,attackTimes:2,job:7,skills:[{id:5124,level:1}],autoSkills:[],initiativeSkill:-1},
 };
 return {map:new Map([[parent.key,parent]]),parent};
}

test('本地宠物：没配（或文件不存在）时目录与上游逐项一致',()=>{
 assert.equal(localPetData(),null,'当前仓库的 local-pets.json 是空模板 → 整个目录与上游一致');
 assert.equal(petProfiles.size,504);
 assert.equal(legendaryPetPool().length,146);
 // 这两条是「空配置零变化」的硬证据：改坏了立刻就能看出来。
 assert.equal(selectablePetEggs().length,146);
 assert.equal(selectablePetEggs().at(-1).id,SELECTABLE_PET_EGG_ID_START+145);
});

test('mergeLocalPets：继承上游数值，覆盖只影响写了的字段',()=>{
 const {map,parent}=upstream();
 const {profiles}=mergeLocalPets({profiles:[{key:'冰霜幼龙:4',name:'冰霜幼龙',grade:4,extends:'电气鼠(变异):4',
  baseline:{model:60000,headIcon:60001,baseStats:[10,20,30,60,40],
   attributes:{strength:10,constitution:20,agility:30,intelligence:60,wisdom:40}}}],legendaryKeys:[]},map);
 const p=profiles[0];
 assert.equal(p.name,'冰霜幼龙');
 assert.equal(p.baseline.model,60000,'外观按配置走');
 assert.equal(p.baseline.hp,170,'没写的字段从上游继承');
 assert.equal(p.baseline.job,7);
 assert.equal(p.baseline.skills.length,1,'技能表也继承');
 assert.deepEqual(p.baseline.baseStats,[10,20,30,60,40]);
});

test('mergeLocalPets：catalogKey 钉成本地 key、templateId 跟随 model',()=>{
 // growthProfile(pet) 第一条回退就是 petProfiles.get(pet.catalogKey)，孵化时写的正是
 // profile.key —— 这里钉死，自制宠物的成长才一定命中自己而不是撞到上游同阶模板。
 const {map}=upstream();
 const {profiles}=mergeLocalPets({profiles:[{key:'冰霜幼龙:4',extends:'电气鼠(变异):4',
  baseline:{model:60000}}],legendaryKeys:[]},map);
 assert.equal(profiles[0].baseline.catalogKey,'冰霜幼龙:4');
 assert.equal(profiles[0].baseline.templateId,60000,'上游的规律是 templateId === model');
});

for(const [label,spec,expect] of [
 ['与上游重名','本地宠物 key 与上游目录重复',''],
 ['extends 找不到',null,'在上游目录里找不到'],
 ['baseStats 长度不对',null,'必须是 5 个数字'],
 ['attributes 缺字段',null,'baseline.attributes.'],
]){
 test('mergeLocalPets：'+label+' → 抛错而不是静默',()=>{
  const {map}=upstream();
  const base={key:'冰霜幼龙:4',extends:'电气鼠(变异):4'};
  const data={profiles:[label==='与上游重名'?{...base,key:'电气鼠(变异):4'}
   :label==='extends 找不到'?{...base,extends:'不存在:9'}
   :label==='baseStats 长度不对'?{...base,baseline:{baseStats:[1,2,3]}}
   :{...base,baseline:{attributes:{strength:1}}}]};
  assert.throws(()=>mergeLocalPets(data,map),expect?new RegExp(expect.replace(/[.]/g,'\\.')):Error);
 });
}

test('mergeLocalPets：本地 key 重复 / legendaryKeys 指向不存在的宠物 → 抛错',()=>{
 const {map}=upstream();
 const one={key:'冰霜幼龙:4',extends:'电气鼠(变异):4',baseline:{model:60000}};
 assert.throws(()=>mergeLocalPets({profiles:[one,{...one}],legendaryKeys:[]},map),/key 重复/);
 assert.throws(()=>mergeLocalPets({profiles:[one],legendaryKeys:['查无此宠:4']},map),/既不是本地宠物也不在上游目录里/);
 const ok=mergeLocalPets({profiles:[one],legendaryKeys:['冰霜幼龙:4','电气鼠(变异):4']},map);
 assert.deepEqual(ok.legendaryKeys,['冰霜幼龙:4','电气鼠(变异):4'],'上游的 key 也可以直接列进来');
});

test('本地宠物进池子后：新蛋追加在末尾，已有 146 个蛋的编号一个都不动',async()=>{
 // 宠物蛋道具号 = SELECTABLE_PET_EGG_ID_START + 下标。插到前面会让老存档里已存在的
 // 宠物蛋整体错位一只，所以只能追加 —— 这条用例就是防那个的。
 const file=path.join(root,'data','local-pets.json');
 const backup=fs.readFileSync(file);
 try{
  fs.writeFileSync(file,JSON.stringify({revision:'local-pets-test',
   profiles:[{key:'测试冰龙:4',name:'测试冰龙',grade:4,extends:'电气鼠(变异):4',baseline:{model:60000,headIcon:60001}}],
   legendaryKeys:['测试冰龙:4']},null,2));
  // 带查询串强制重新执行模块顶层，绕过 ESM 缓存与 ensure() 的 built 缓存。
  const fresh=await import('../lib/pet-catalog.mjs?case=with-local');
  assert.equal(fresh.petProfiles.size,505);
  assert.equal(fresh.legendaryPetPool().length,147);
  const eggs=fresh.selectablePetEggs();
  assert.equal(eggs[0].id,SELECTABLE_PET_EGG_ID_START,'第一只蛋编号不变');
  assert.equal(eggs[145].id,SELECTABLE_PET_EGG_ID_START+145,'第 146 只蛋编号不变');
  assert.equal(eggs[146].id,SELECTABLE_PET_EGG_ID_START+146,'新蛋接在末尾');
  assert.match(eggs[146].item.name,/测试冰龙/);
  assert.equal(eggs[146].item.power1,109,'与普通宠物蛋同规格');
  assert.ok(fresh.selectablePetEggsById.get(SELECTABLE_PET_EGG_ID_START+146));
  assert.equal(fresh.petProfiles.get('测试冰龙:4').baseline.model,60000);
 }finally{
  fs.writeFileSync(file,backup);
 }
});

test('换皮：只改 files 里的编号，frames / anis 与底模逐字节一致',()=>{
 // 这是路径 C 的核心不变量：fi 是 files 的下标，所以换皮不需要重画任何一帧。
 // 素材用底模自己的贴图（尺寸天然一致），checkOnly 模式不写任何文件。
 const gd=JSON.parse(fs.readFileSync(path.join(raw,'v/gd/305.json'),'utf8'));
 const baseId=504,h=gd.url.assets.sprite.model[`${baseId}.json`];
 const base=JSON.parse(fs.readFileSync(path.join(raw,'assets',h.slice(0,2),h+'.json'),'utf8'));
 const artDir=path.join(root,'data','local-pet-art');
 fs.mkdirSync(artDir,{recursive:true});
 const art=path.join(artDir,'__test-body.png');
 const src=path.join(raw,'assets',gd.url.assets.sprite.fragment['12017.png'].slice(0,2),
  gd.url.assets.sprite.fragment['12017.png']+'.png');
 fs.copyFileSync(src,art);
 try{
  const {manifest,models}=buildReskin({root,checkOnly:true,
   config:{fragmentIdStart:40000,modelIdStart:60000,
    entries:[{key:'测试冰龙:4',baseModel:baseId,baseHead:503,
     replace:{model:[0]},textures:{model:['__test-body.png']}}]}});
  const modelId=Number(Object.keys(models)[0]);
  assert.ok(modelId>=60000);
  const out=models[modelId];
  assert.equal(out.files.length,base.files.length);
  assert.ok(out.files[0]>=40000,'主体槽位指向新贴图编号');
  assert.notEqual(out.files[0],base.files[0]);
  assert.deepEqual(out.frames,base.frames,'frames 必须逐字节一致');
  assert.deepEqual(out.anis,base.anis,'anis 必须逐字节一致');
  assert.ok(Object.values(manifest.fragments).length===1);
  assert.equal(manifest.assign['测试冰龙:4'].model,modelId);
  assert.equal(manifest.written??undefined,undefined);
  assert.ok(!Object.keys(manifest).includes('written'));
 }finally{
  fs.rmSync(art,{force:true});
 }
});

test('换皮：尺寸对不上底模就抛错，不让错位的帧进包',()=>{
 const art=path.join(root,'data','local-pet-art','__test-bad.png');
 // 1×1 的透明 PNG（底模 12017 是 118×80）
 fs.writeFileSync(art,Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/1s0mAAAAABJRU5ErkJggg==','base64'));
 try{
  assert.throws(()=>buildReskin({root,checkOnly:true,
   config:{fragmentIdStart:40000,modelIdStart:60000,
    entries:[{key:'坏图:4',baseModel:504,replace:{model:[0]},textures:{model:['__test-bad.png']}}]}}),
   /必须像素级一致/);
 }finally{
  fs.rmSync(art,{force:true});
 }
});

test('换皮：素材张数与槽位数不一致 / 槽位越界 → 抛错',()=>{
 assert.throws(()=>buildReskin({root,checkOnly:true,config:{entries:[
  {key:'x:4',baseModel:504,replace:{model:[0,1]},textures:{model:['a.png']}}]}}),/槽位|只给了/);
 assert.throws(()=>buildReskin({root,checkOnly:true,config:{entries:[
  {key:'x:4',baseModel:504,replace:{model:[9]},textures:{model:['__test-body.png']}}]}}),/越界|找不到素材/);
});

test('applyLocalPetAssets：贴图实体缺失时不登记，绝不让游戏起不来',()=>{
 // client/ 不入库，换台机器可能只有登记表没有图 —— 那时宁可这只宠物沿用底模外观。
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-petassets-'));
 assert.ok(dir.startsWith(os.tmpdir()));
 try{
  const manifest={url:{assets:{sprite:{fragment:{},model:{}}}}};
  assert.equal(applyLocalPetAssets(manifest,dir),0,'没有登记表 → 0');
  fs.mkdirSync(path.join(dir,'data'),{recursive:true});
  fs.writeFileSync(path.join(dir,'data','local-pet-assets.json'),JSON.stringify({
   fragments:{'40000.png':'aabbccddeeff0011'},models:{'60000.json':'1122334455667788'}}));
  assert.equal(applyLocalPetAssets(manifest,dir),0,'实体文件不存在 → 不登记');
  assert.deepEqual(manifest.url.assets.sprite.fragment,{});
  const dirA=path.join(dir,'client','assets','aa');
  fs.mkdirSync(dirA,{recursive:true});
  fs.writeFileSync(path.join(dirA,'aabbccddeeff0011.png'),Buffer.from([1]));
  assert.equal(applyLocalPetAssets(manifest,dir),1,'只登记有实体的那一个');
  assert.equal(manifest.url.assets.sprite.fragment['40000.png'],'aabbccddeeff0011');
  assert.equal(manifest.url.assets.sprite.model['60000.json'],undefined);
 }finally{
  fs.rmSync(dir,{recursive:true,force:true});
 }
});

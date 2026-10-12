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
import {petSpriteOf} from '../lib/pet-sprite.mjs';

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

test('本地宠物：仓库里的 local-pets.json 现在有冰冰一只，上游 504 条与已有 146 个蛋的编号都不动',()=>{
 const data=localPetData();
 assert.ok(data,'仓库里已经有自制宠物（冰冰）—— 这份文件不再是空模板');
 assert.equal(petProfiles.size,505,'504 条上游 + 1 只本地');
 assert.equal(legendaryPetPool().length,147);
 assert.equal(selectablePetEggs().length,147);
 // 「新蛋只能追加在末尾」是硬约束：宠物蛋道具号 = 起始号 + 池子下标，
 // 插到前面会让老存档里已经存在的蛋整体错位一只。前 146 个编号逐个钉住。
 const eggs=selectablePetEggs();
 for(let i=0;i<146;i++)assert.equal(eggs[i].id,SELECTABLE_PET_EGG_ID_START+i,'第 '+(i+1)+' 个蛋的编号不能动');
 assert.equal(eggs[146].id,SELECTABLE_PET_EGG_ID_START+146,'新蛋接在末尾');
 assert.match(eggs[146].item.name,/冰冰/);
});

test('冰冰：local-pets.json 写的外观号、换皮构建产出的号、客户端算出来的精灵号，三处必须一致',()=>{
 // 同一个号只能有一处定义。这条用例把三处钉在一起：
 //   配置 baseline.icon  →  构建产出的 model/战斗号  →  客户端按 500+风格号-1 算出来的号。
 // 任何一处改了而别处没改（比如换了风格号却忘了重跑换皮工具），这里立刻报警。
 const data=JSON.parse(fs.readFileSync(path.join(root,'data','local-pet-assets.json'),'utf8'));
 const assign=data.assign['冰冰:4'];
 assert.deepEqual(assign,{model:552,battle:652},'换皮产出：风格号 53 → 世界 552 / 战斗 652');
 const pet=petProfiles.get('冰冰:4');
 const sprite=petSpriteOf(pet);
 assert.equal(sprite.style,53);
 assert.equal(sprite.color,0,'色号必须是 0：客户端会在 fragment 号上叠加色号');
 assert.equal(sprite.world,assign.model,'配置算出来的世界观精灵 = 构建产出的那个');
 assert.equal(sprite.battle,assign.battle);
 assert.equal(pet.baseline.headIcon,sprite.world,'headIcon 跟世界号走（与上游 style20 那几只同一规律）');
 assert.equal(pet.name,'冰冰');
 assert.equal(pet.extends,undefined);
 assert.equal(pet.provenance.extends,'红炎少女(进化):4','数值/技能继承自红炎少女(进化)');
 assert.deepEqual(pet.baseline.baseStats,petProfiles.get('红炎少女(进化):4').baseline.baseStats);
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

test('换皮：宠物必须世界+战斗两套一起换，精灵号可以按风格号指定',()=>{
 // 客户端是按「500/600 + 风格号 - 1」去查精灵的（SpriteTool.getPetSpriteByIcon），
 // 所以自制宠物不能随手发一个 60000 段的号 —— modelIds 要写死，否则地图上换了、一进战斗变回原版。
 const gd=JSON.parse(fs.readFileSync(path.join(raw,'v/gd/305.json'),'utf8'));
 const frag=gd.url.assets.sprite.fragment;
 const artDir=path.join(root,'data','local-pet-art');
 fs.mkdirSync(artDir,{recursive:true});
 const art=path.join(artDir,'__test-world.png');
 fs.copyFileSync(path.join(raw,'assets',frag['12005.png'].slice(0,2),frag['12005.png']+'.png'),art);
 try{
  const {manifest,models}=buildReskin({root,checkOnly:true,
   config:{fragmentIdStart:40000,modelIdStart:60000,
    entries:[{key:'测试剑姬:4',baseModel:501,baseBattle:601,
     modelIds:{model:559,battle:659},
     replace:{model:[0],battle:[0]},
     textures:{model:['__test-world.png'],battle:['__test-world.png']}}]}});
  // 559/659 = 风格号 60（客户端里空着的号段），必须是我们指定的这个
  assert.deepEqual(Object.keys(models).map(Number).sort((a,b)=>a-b),[559,659]);
  assert.equal(manifest.assign['测试剑姬:4'].model,559);
  assert.equal(manifest.assign['测试剑姬:4'].battle,659);
  // 两套 frames 来自不同的底模（501 是世界、601 是战斗），逐字节照抄各自的
  for(const [id,baseId] of [[559,501],[659,601]]){
   const h=gd.url.assets.sprite.model[`${baseId}.json`];
   const base=JSON.parse(fs.readFileSync(path.join(raw,'assets',h.slice(0,2),h+'.json'),'utf8'));
   assert.deepEqual(models[id].frames,base.frames,`精灵 ${id} 的 frames 应等于底模 ${baseId}`);
   assert.deepEqual(models[id].anis,base.anis);
   assert.ok(models[id].files[0]>=40000);
  }
  assert.equal(Object.keys(manifest.fragments).length,2,'两套各占用一个新贴图编号');
  // 只换世界观、忘了战斗 → 必须有一条 ⚠ 提醒（宠物的战斗精灵是另一套图）
  const notes=[];
  buildReskin({root,checkOnly:true,log:(...a)=>notes.push(String(a[0]).replace(/%s/g,'X'))||0,
   config:{fragmentIdStart:40000,modelIdStart:60000,
    entries:[{key:'只换一半:4',baseModel:501,modelIds:{model:559},
     replace:{model:[0]},textures:{model:['__test-world.png']}}]}});
  assert.ok(notes.some(n=>/没给 baseBattle/.test(n)),'只给世界观精灵时要有提醒');
  // 要求换战斗却没给战斗底模 → 报错说清缺哪个
  assert.throws(()=>buildReskin({root,checkOnly:true,config:{entries:[
   {key:'缺战斗底模:4',baseModel:501,replace:{battle:[0]},textures:{battle:['__test-world.png']}}]}}),
   /baseBattle/);
  assert.throws(()=>buildReskin({root,checkOnly:true,config:{entries:[
   {key:'坏号:4',baseModel:501,modelIds:{model:'559'},
    replace:{model:[0]},textures:{model:['__test-world.png']}}]}}),/modelIds 必须是整数/);
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

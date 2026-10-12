/**
 * 底模参考包导出工具（tools/export-pet-reskin-templates.mjs）的守卫用例。
 *
 * 这里钉的三件事都是**踩过坑**的：
 *   1. `textureUsage` 必须按 `[贴图下标, 部件号, ...]` 的**下标**分开统计 ——
 *      把整个 model 的部件并起来算，会让第二、三张贴图标出一堆不属于它的部件号，
 *      照着画就是白画（参考包第一版就是这么错的）。
 *   2. 资源不全在 `assets/<hash 前两位>/`：还有一部分（含 frag12013 的图集）在
 *      `assets/dirad/`。只认前两位会误判成「这张贴图没有图集」，于是 12013 的
 *      部件布局整块丢失。
 *   3. model json 里 `frames` 的键是**姿态**、值是部件清单；`anis.gesture` 才是时间线。
 *      统计口径不能混。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resolveAsset,textureUsage,atlasRows,cleanOutput,petSpriteOf,styleIndex,styleTargets,GENERIC_REFERENCE_LIMIT,SHARED_REFERENCE_LIMIT,PET_WORLD_BASE,PET_BATTLE_BASE} from '../tools/export-pet-reskin-templates.mjs';

const model={
 files:[12017,12065],
 frames:{
  0:[[0,1,0,0,0],[0,3,10,0,0],[1,5,20,0,0]],
  1:[[0,1,1,0,0],[1,5,21,0,0],[1,6,22,0,0]],
  2:[[1,5,30,0,0]],
 },
};

test('textureUsage 按贴图下标分开统计部件，并把姿态数与单姿态上限算对',()=>{
 // 下标 0 的贴图只用到部件 1、3；下标 1 的只用到 5、6。混在一起算就会给出 1,3,5,6。
 assert.deepEqual(textureUsage(model,0),{subs:[1,3],poses:2,maxParts:2});
 assert.deepEqual(textureUsage(model,1),{subs:[5,6],poses:3,maxParts:2});
 // 没被任何姿态用到的下标：空集而不是报错 —— 参考包里会出现（图集里有、动画没用到）。
 assert.deepEqual(textureUsage(model,9),{subs:[],poses:0,maxParts:0});
});

test('atlasRows 按部件号排序，没有图集时返回 null（整张图就是一个部件）',()=>{
 const atlas={frames:{'2':{x:10,y:0,w:5,h:5},'0':{x:0,y:0,w:4,h:4},'1':{x:4,y:0,w:6,h:6}}};
 assert.deepEqual(atlasRows(atlas).map(r=>r.id),[0,1,2]);
 assert.equal(atlasRows(atlas)[0].w,4);
 assert.equal(atlasRows({}),null);
 assert.equal(atlasRows(null),null);
});

test('资源解析走 assets/<前两位>/ 并在缺失时回退 assets/dirad/',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-petreskin-'));
 try{
  fs.mkdirSync(path.join(root,'assets','ab'),{recursive:true});
  fs.mkdirSync(path.join(root,'assets','dirad'),{recursive:true});
  fs.writeFileSync(path.join(root,'assets','ab','abc123.png'),'x');
  fs.writeFileSync(path.join(root,'assets','dirad','def456.json'),'{}');
  assert.equal(resolveAsset(root,'abc123','.png'),path.join(root,'assets','ab','abc123.png'));
  // 前两位目录里没有就回退 dirad —— frag12013 的图集正是只存在于 dirad。
  assert.equal(resolveAsset(root,'def456','.json'),path.join(root,'assets','dirad','def456.json'));
  assert.equal(resolveAsset(root,'000000','.png'),null);
  assert.equal(resolveAsset(root,undefined,'.png'),null);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('通用件的阈值是「被几百个 model 引用」，别把主体误判成通用件',()=>{
 // 参考包里判「要不要画」用的就是这个阈值：几千个模型共用的才是阴影/光效。
 assert.equal(GENERIC_REFERENCE_LIMIT,500);
 assert.ok(GENERIC_REFERENCE_LIMIT>100,'阈值太低会把半通用的主体也划进去');
 // 半通用（几十上百只宠物共用的小配件）另有一档：改了会连带改到别的宠物。
 assert.ok(SHARED_REFERENCE_LIMIT<GENERIC_REFERENCE_LIMIT);
});

test('宠物精灵号 = 500/600 + 风格号 - 1，风格号取自 icon 低 6 位；`model` 字段不是精灵号',()=>{
 // 这几个数都是拿真实宠物目录 + 客户端资源核过的：
 //   哈士奇 icon=1  → 世界 500（拼出来确实是坐着的哈士奇）
 //   萌系女仆 icon=2 → 501（女仆，端盘子）
 //   玛玛哈哈 icon=68 → style 4、颜色 1 → 世界 503 / 战斗 603
 //   红炎少女 icon=212 → style 20、颜色 3 → 世界 519 / 战斗 619（与魔法少女共用一套图）
 assert.deepEqual(petSpriteOf({baseline:{icon:'1',headIcon:500}}),{style:1,color:0,world:500,battle:600,head:500});
 assert.deepEqual(petSpriteOf({baseline:{icon:68,headIcon:503}}),{style:4,color:1,world:503,battle:603,head:503});
 assert.deepEqual(petSpriteOf({baseline:{icon:212,headIcon:519}}),{style:20,color:3,world:519,battle:619,head:519});
 // 风格号占满 6 位：63 是上限，不可能算出 500 号段以外的世界精灵。
 assert.equal(petSpriteOf({baseline:{icon:63}}).world,562);
 assert.equal(petSpriteOf({baseline:{icon:63}}).battle,662);
 // 没有 icon / icon=0 的条目直接跳过，而不是退回 model 字段 ——
 // model 是**模板号**，拿它查精灵表会得到一只毫不相干的宠物（参考包第一版就是这么错的）。
 assert.equal(petSpriteOf({baseline:{model:504,headIcon:503}}),null);
 assert.equal(petSpriteOf({baseline:{icon:0,model:504}}),null);
 assert.equal(PET_WORLD_BASE,500);assert.equal(PET_BATTLE_BASE,600);
});

test('同一个风格号的宠物归成一个目录，展示名优先取颜色 0 那只',()=>{
 const catalog={profiles:[
  {key:'魔法少女:4',name:'魔法少女',baseline:{icon:20,headIcon:519}},
  {key:'红炎少女:4',name:'红炎少女',baseline:{icon:212,headIcon:519}},
  {key:'虚无少女:4',name:'虚无少女',baseline:{icon:148,headIcon:519}},
  // 同名多阶只记一次（目录里每个宠物有 0~4 阶好几条）
  {key:'魔法少女:0',name:'魔法少女',baseline:{icon:20,headIcon:519}},
  {key:'复仇焰魂:0',name:'复仇焰魂',baseline:{model:331}},   // 没有 icon，整条跳过
 ]};
 const index=styleIndex(catalog);
 assert.deepEqual([...index.keys()],[20]);
 // 颜色 0 的魔法少女当代表（红炎少女是色 3、虚无少女是色 2）
 const [target]=styleTargets(catalog,[20]);
 assert.equal(target.label,'魔法少女-style20');
 assert.equal(target.world,519);assert.equal(target.battle,619);
 assert.equal(target.pets.length,3);
 assert.match(target.title,/魔法少女/);
 // 不存在的风格号要报错，而不是安静导出一个空目录
 assert.throws(()=>styleTargets(catalog,[2]),/没有任何宠物/);
});

test('--clean 只删本工具产出的目录，别人的文件一律不碰',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-petclean-'));
 try{
  for(const name of ['世界女仆-style02','九尾灵狐-style34','哈士奇(进化)-model516','我的素材'])
   fs.mkdirSync(path.join(dir,name),{recursive:true});
  fs.writeFileSync(path.join(dir,'我的素材','body.png'),'x');
  // 同名但**是文件**的不动：只清目录，免得误删谁的同名说明。
  fs.writeFileSync(path.join(dir,'reskin.json'),'{}');
  const removed=cleanOutput(dir);
  assert.deepEqual(removed.sort(),['世界女仆-style02','哈士奇(进化)-model516','九尾灵狐-style34'].sort());
  // 手工放的目录与文件必须原样还在
  assert.ok(fs.existsSync(path.join(dir,'我的素材','body.png')));
  assert.equal(fs.readFileSync(path.join(dir,'reskin.json'),'utf8'),'{}');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

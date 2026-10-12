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
import {resolveAsset,textureUsage,atlasRows,GENERIC_REFERENCE_LIMIT} from '../tools/export-pet-reskin-templates.mjs';

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
});

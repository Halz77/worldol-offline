// 美容院造型道具的贴图清单 / 图标图集守卫（tools/build-fashion-icons.mjs + lib/fashion-icons.mjs）。
//
// 「世界OL_源码」下的 face_png_i / face_png_o / hair_png_i / hair_png_o 是给美容院用的
// 发型/脸型贴图（i = 男、o = 女）。这份测试会重新按像素比对一遍，确认：
//   1. data/fashion-icons.json 与那四份目录完全一致（文件换过就会失败）；
//   2. 每个贴图都能对回客户端 client/assets 里的角色碎片，且性别分组正确；
//   3. 图标图集 PNG / 帧表文件都还在，且 md5 与清单记录的一致；
//   4. 资源清单注入后，客户端能按道具编号拿到图集子键。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build, buildCatalog, readPayload, assetFile, composeAvatar, FOLDERS, SOURCE_ROOT, REVISION, SHEET_NAME, SHEET_URL} from '../tools/build-fashion-icons.mjs';
import {applyFashionIcons} from '../lib/fashion-icons.mjs';
import {nativeResourceManifest} from '../lib/native-ui-restoration.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));

// 那四份目录是「一次性素材」：贴图生成进游戏之后就被清掉了。它们不在时，
// 只有需要拿源素材重跑的那些用例才失去意义；图集字节、帧表 md5、资源清单注入、
// 图标取帧这些守生成物的用例照常跑，所以这里只做条件跳过，不整份丢掉。
const missingSources=Object.values(FOLDERS).filter(name=>!fs.existsSync(path.join(SOURCE_ROOT,name)));
const skipNoSources=missingSources.length
 ?`四份贴图源目录已清理（缺 ${missingSources.join('、')}），跳过需要源素材的比对`
 :false;

test('data/fashion-icons.json 与四份贴图目录一致（按像素重新比对）',{skip:skipNoSources},()=>{
 const stored=readPayload();
 const rebuilt=buildCatalog();
 assert.equal(stored.revision,REVISION);
 assert.deepEqual(stored.hair,rebuilt.hair,'发型清单和贴图目录对不上，请重新生成');
 assert.deepEqual(stored.faces,rebuilt.faces,'脸型清单和贴图目录对不上，请重新生成');
 assert.deepEqual(stored.folders,rebuilt.folders,'贴图目录的文件集合变了，请重新生成');
});

test('每个贴图都落在正确的性别分组上，且发型碎片编号能被 SpriteTool 公式还原',()=>{
 const {hair,faces}=readPayload();
 assert.ok(hair.length>0&&faces.length>0);
 for(const entry of hair){
  // 发型碎片 = 8*style - 7 + 4*gender + color
  for(const [index,gender] of [[entry.male,0],[entry.female,1]]){
   if(index===null)continue;
   const restored=8*entry.style-7+4*gender+entry.color;
   assert.equal(index,restored,`发型 ${entry.id} 的碎片编号与样式/颜色/性别对不上`);
  }
 }
 for(const entry of faces){
  // 脸型碎片 = 1000 + 8*style - 7 + 4*gender
  for(const [index,gender] of [[entry.male,0],[entry.female,1]]){
   if(index===null)continue;
   assert.equal(index,1000+8*entry.style-7+4*gender,`脸型 ${entry.id} 的碎片编号与样式/性别对不上`);
  }
 }
});

test('每张贴图至少出现在一个性别里，编号连续且按实际顺序排',()=>{
 const {hair,faces,itemIds}=readPayload();
 for(const entry of [...hair,...faces])assert.ok(entry.male!==null||entry.female!==null,`${entry.id} 没有任何贴图`);
 // 编号落在原版给造型道具预留的号段：发型 40100..40199、脸型 40200..40249
 // （主包 ModelConst.ITEM_ID_HAIR_START / ITEM_ID_FACE_START），客户端 isHairItem/
 // isFaceItem 只认这一段，否则不会走「买下即换造型」的分支。
 assert.deepEqual(hair.map(e=>e.id),hair.map((_,i)=>40101+i));
 assert.deepEqual(faces.map(e=>e.id),faces.map((_,i)=>40201+i));
 assert.ok(hair.every(e=>e.id>=40100&&e.id<=40199),'发型道具必须落在 40100..40199');
 assert.ok(faces.every(e=>e.id>=40200&&e.id<=40249),'脸型道具必须落在 40200..40249');
 assert.deepEqual(itemIds,[...hair.map(e=>e.id),...faces.map(e=>e.id)]);
 const hairOrder=hair.map(e=>[e.style,e.color]);
 assert.deepEqual(hairOrder,[...hairOrder].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),'发型应按（样式,颜色）升序');
 assert.deepEqual(faces.map(e=>e.style),[...faces.map(e=>e.style)].sort((a,b)=>a-b),'脸型应按样式升序');
});

test('icon 字段就是客户端 updateHair/updateFace 期待的外观编码',()=>{
 const {hair,faces}=readPayload();
 for(const entry of hair){
  assert.equal(entry.icon,entry.male??entry.female,`发型 ${entry.id} 的 icon 应该是该款的男性碎片编号`);
  // 客户端：i=icon-START_HAIR(0)；样式=1+(i-1)/8、颜色=(i-1)%8
  assert.equal(1+Math.floor((entry.icon-1)/8),entry.style,`发型 ${entry.id} 的 icon 反推不出样式`);
  assert.equal((entry.icon-1)%8%4,entry.color,`发型 ${entry.id} 的 icon 反推不出颜色`);
 }
 for(const entry of faces){
  assert.equal(entry.icon,entry.male??entry.female,`脸型 ${entry.id} 的 icon 应该是该款的男性碎片编号`);
  // 客户端：i=icon-START_FACE(1000)；样式=1+(i-1)/8
  assert.equal(1+Math.floor((entry.icon-1000-1)/8),entry.style,`脸型 ${entry.id} 的 icon 反推不出样式`);
 }
});

test('图标图集与帧表都被写进 client/assets，md5 与清单记录一致',()=>{
 const data=readPayload();
 const atlas=assetFile(data.atlas.hash,'.png');
 const table=assetFile(data.sheetTable.hash,'.json');
 assert.ok(fs.existsSync(atlas),'缺少图集 PNG：'+atlas);
 assert.ok(fs.existsSync(table),'缺少图集帧表：'+table);
 assert.equal(crypto.createHash('md5').update(fs.readFileSync(atlas)).digest('hex'),data.atlas.hash);
 assert.equal(crypto.createHash('md5').update(fs.readFileSync(table)).digest('hex'),data.sheetTable.hash);
 // 帧表是「原版 assets/data/sheet.json + 我们的 fashion_icon 一项」
 const entries=JSON.parse(fs.readFileSync(table,'utf8'));
 const mine=entries.map(entry=>JSON.parse(entry)).find(entry=>entry.key===`resource/${SHEET_URL}.json`);
 assert.ok(mine,'帧表里缺少 resource/ui/fashion_icon.json');
 assert.deepEqual(mine.value.frames,data.atlas.frames);
 for(const frame of Object.values(data.atlas.frames)){
  assert.ok(frame.x>=0&&frame.y>=0&&frame.x+frame.w<=data.atlas.width&&frame.y+frame.h<=data.atlas.height,`帧 ${JSON.stringify(frame)} 超出图集范围`);
 }
});

test('图标是「脸型 + 发型」合成的头像，每件道具都有男/女两张帧',()=>{
 const data=readPayload();
 assert.equal(data.avatar,true,'图标应该是脸型和发型叠出来的头像，不是孤立碎片');
 assert.equal(data.genderFrames,true,'头像要分男/女两份');
 // 帧键就是「道具编号」（男）与「道具编号f」（女）
 assert.deepEqual(Object.keys(data.atlas.frames).sort(),[
  ...data.itemIds.map(id=>String(id)),
  ...data.itemIds.map(id=>id+'f'),
 ].sort());
 for(const item of [...data.hair,...data.faces]){
  for(const key of [String(item.id),`${item.id}f`]){
   const frame=data.atlas.frames[key];
   assert.equal(frame.offX,0);assert.equal(frame.offY,0);
   assert.ok(frame.w>1&&frame.h>1,`${key} 的帧尺寸不合理`);
   assert.equal(frame.w,frame.sourceW);assert.equal(frame.h,frame.sourceH);
  }
 }
 // 帧尺寸确实等于「该款脸 + 该款头发」叠出来的尺寸（不是碎片原图）
 const hairSample=data.hair[0];
 const expected=composeAvatar(data.avatarFace[0],hairSample.male??hairSample.female);
 const frame=data.atlas.frames[String(hairSample.id)];
 assert.equal(frame.w,expected.width,'发型道具的头像没有和脸合成');
 assert.equal(frame.h,expected.height,'发型道具的头像没有和脸合成');
 assert.ok(frame.h>(hairSample.male?0:1),'合成后应该比头发碎片本身高（下面接了一张脸）');
});

test('重新构建出的图集字节与磁盘上的完全一致（构建可复现）',{skip:skipNoSources},()=>{
 const rebuilt=build();
 const data=readPayload();
 assert.equal(rebuilt.payload.atlas.hash,data.atlas.hash);
 assert.ok(fs.readFileSync(assetFile(data.atlas.hash,'.png')).equals(rebuilt.atlasPng));
 assert.deepEqual(rebuilt.payload,data);
});

test('服务端/构建期资源清单会把图集挂上去，且不写坏归档清单',()=>{
 const raw=path.join(root,'client');
 const archived=JSON.parse(fs.readFileSync(path.join(raw,'v','gd','305.json'),'utf8'));
 const manifest=nativeResourceManifest(root,raw);
 const data=readPayload();
 assert.ok(manifest.res.resources.some(entry=>entry.name===SHEET_NAME),'缺少 fashion_icon 资源');
 const resource=manifest.res.resources.find(entry=>entry.name===SHEET_NAME);
 assert.equal(resource.url,SHEET_URL);
 assert.deepEqual(resource.subkeys.split(','),Object.keys(data.atlas.frames));
 // 子键是道具编号；女性那份多一个 f 后缀（<编号> 男、<编号>f 女）。
 for(const subkey of resource.subkeys.split(','))assert.match(subkey,/^\d+f?$/,`图集子键 ${subkey} 应该是道具编号或编号+f`);
 assert.equal(manifest.url.resource.ui[`${SHEET_NAME}.png`],data.atlas.hash);
 assert.equal(manifest.url.resource.ui[`${SHEET_NAME}.json`],data.sheetTable.hash);
 assert.equal(manifest.url.assets.data['sheet.json'],data.sheetTable.hash);
 for(const group of manifest.res.groups)assert.ok(group.keys.split(',').includes(SHEET_NAME),`资源组 ${group.name} 没有挂上图集`);
 assert.ok(manifest.res.groups.some(entry=>entry.name===SHEET_NAME));
 // 归档清单必须保持原样：图集只存在于内存里生成的那份清单上。
 assert.equal(archived.url.resource.ui[`${SHEET_NAME}.png`],undefined,'不能改归档清单');
 assert.equal(archived.res.resources.some(entry=>entry.name===SHEET_NAME),false,'不能改归档清单');
 assert.equal(archived.res.groups.some(entry=>entry.keys.split(',').includes(SHEET_NAME)),false,'不能改归档清单');
});

test('applyFashionIcons 在产出文件缺失时安静返回（不影响游戏启动）',()=>{
 const manifest={url:{resource:{ui:{}},assets:{data:{}}},res:{resources:[],groups:[{name:'a',keys:'a'}]}};
 const temp={url:JSON.parse(JSON.stringify(manifest.url)),res:{resources:[...manifest.res.resources],groups:manifest.res.groups.map(g=>({...g}))}};
 // 用一个不存在 data/fashion-icons.json 的根目录
 const empty=fs.mkdtempSync(path.join(process.env.TEMP||'/tmp','fashion-'));
 assert.equal(applyFashionIcons(temp,empty),null);
 assert.equal(temp.res.resources.length,0);
 fs.rmSync(empty,{recursive:true,force:true});
});

test('客户端图标钩子：造型道具按角色性别取头像帧，图集没就绪才退回问号图',()=>{
 const src=fs.readFileSync(new URL('../web/offline.js',import.meta.url),'utf8');
 assert.match(src,/id>=40101&&id<=40129/);
 assert.match(src,/id>=40201&&id<=40214/);
 assert.match(src,/playerIsFemale/,'要按角色性别取男/女那份头像');
 assert.match(src,/\?\s*base\+'f'\s*:\s*base/,'女性用 <编号>f 那张帧');
 assert.match(src,/req\(132\)\.default\.getRes\(candidate\)/,'要先问一下图集资源在不在');
 assert.match(src,/common_icon_wenhao2/,'图集没就绪时要退回问号图');
});

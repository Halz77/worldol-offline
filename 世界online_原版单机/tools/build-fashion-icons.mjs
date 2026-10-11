// 从「世界OL_源码」下的四份贴图目录（face_png_i / face_png_o / hair_png_i / hair_png_o，
// i = 男性、o = 女性）反推出美容院造型道具的清单，并顺手拼出给商店列表用的图标图集。
//
// 为什么能反推：这些 PNG 本来就是从客户端 client/assets/**/*.png 里切出来的角色碎片，
// 与 SpriteTool 的编号一一对应（analysis/modules/0055.js）：
//   发型碎片 = 0  + 8*style - 7 + 4*gender + color    （gender 0 = 男，1 = 女；color 0..3）
//   脸型碎片 = 1000 + 8*style - 7 + 4*gender
// 这里按像素做精确匹配（尺寸 + RGBA 字节），把每个文件定位回碎片编号，再按 (样式, 颜色)
// 取两个性别的并集——发型道具是性别无关的，同一件道具男女各自取自己那份碎片。
//
// 产出：
//   data/fashion-icons.json               清单 + 图集帧表（服务端和构建期都读它）
//   client/assets/<hh>/<md5>.png          图标图集
//   client/assets/<hh>/<md5>.json         追加了图集帧表后的 assets/data/sheet.json
//
// 用法：node tools/build-fashion-icons.mjs [--check]
//   --check 只校验现有产出是否与贴图目录一致，不写文件（给测试用）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {decodePng,encodePng,blit,blitOver} from './png-mini.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const gameRoot=path.resolve(here,'..');
const packageRoot=path.resolve(gameRoot,'..');
const assetsRoot=path.join(gameRoot,'client','assets');
const dataFile=path.join(gameRoot,'data','fashion-icons.json');

export const REVISION='fashion-icons-20261010c';
export const SHEET_NAME='fashion_icon';
export const SHEET_URL='ui/fashion_icon';
// 道具编号直接用原版给发型/脸型道具预留的号段（主包 ModelConst）：
//   ITEM_ID_HAIR_START=40100 / ITEM_ID_HAIR_END=40199
//   ITEM_ID_FACE_START=40200 / ITEM_ID_FACE_END=40249
// 客户端 isHairItem/isFaceItem 只认这两个区间，命中后就把道具当成「买下即换造型」
// 的服务道具处理（updateHair / updateFace），不会走装备流程——这正是原版的用法。
export const HAIR_BASE=40101;
export const FACE_BASE=40201;

// 四份贴图源目录放在游戏源码包的上一层（世界OL_源码/ 下）。它们只是一次性的素材：
// 贴图生成进 data/fashion-icons.json + 图集之后就没人再需要它们了，所以允许被清理。
// 测试靠 FOLDERS / SOURCE_ROOT 判断源素材还在不在，不在就跳过「按像素重新比对」。
export const FOLDERS={hairMale:'hair_png_i',hairFemale:'hair_png_o',faceMale:'face_png_i',faceFemale:'face_png_o'};
export const SOURCE_ROOT=packageRoot;

function manifest(){
 return JSON.parse(fs.readFileSync(path.join(gameRoot,'client','v','gd','305.json'),'utf8'));
}
function hashedPath(node,segments){
 let cursor=node;
 for(const segment of segments)cursor=cursor&&cursor[segment];
 return cursor;
}
export function assetFile(hash,extension){
 return path.join(assetsRoot,hash.slice(0,2),hash+extension);
}

function fragmentHashMap(){
 const url=manifest().url.assets.sprite.fragment;
 const map=new Map();
 for(const name of Object.keys(url)){
  const base=name.replace(/\.png$/,'');
  if(/^\d+$/.test(base))map.set(Number(base),name);
 }
 return map;
}

function loadFragment(id){
 const url=manifest().url.assets.sprite.fragment;
 const name=url[String(id)+'.png'];
 if(!name)return null;
 const file=assetFile(name,'.png');
 if(!fs.existsSync(file))return null;
 const image=decodePng(fs.readFileSync(file));
 return {...image,id,hash:name,pixels:crypto.createHash('sha256').update(image.rgba).digest('hex')};
}

function readFolder(folder){
 const dir=path.join(packageRoot,folder);
 if(!fs.existsSync(dir))throw Error(`缺少贴图目录：${dir}`);
 return fs.readdirSync(dir).filter(name=>/^\d+\.png$/.test(name))
  .map(name=>({name,order:Number(name.replace(/\.png$/,''))}))
  .sort((a,b)=>a.order-b.order)
  .map(entry=>{
   const image=decodePng(fs.readFileSync(path.join(dir,entry.name)));
   return {...image,name:entry.name,order:entry.order,pixels:crypto.createHash('sha256').update(image.rgba).digest('hex')};
  });
}

function hairParts(id){
 const index=id-1;
 return {style:1+Math.floor(index/8),gender:(index%8)>>2,color:index%4};
}
function faceParts(id){
 const index=id-1000-1;
 return {style:1+Math.floor(index/8),gender:(index%8)>>2};
}

/** 把某一类（hair/face）的碎片编号做成「像素签名 → 编号」的索引，用来定位贴图文件。 */
function indexFragments(kind){
 const index=new Map();
 const range=kind==='hair'?[1,132]:[1001,1200];
 for(let id=range[0];id<=range[1];id++){
  const fragment=loadFragment(id);
  if(!fragment)continue;
  const key=[fragment.width,fragment.height,fragment.pixels].join(':');
  if(!index.has(key))index.set(key,fragment);
 }
 return index;
}

function locate(folder,fragments,index,kind){
 return folder.map(file=>{
  const key=[file.width,file.height,file.pixels].join(':');
  const fragment=index.get(key);
  if(!fragment)throw Error(`${folder.name} 里的 ${file.name} 在客户端碎片表里找不到对应的 ${kind}`);
  return {...file,fragmentId:fragment.id};
 });
}

export function buildCatalog(){
 const hairMale=locate(readFolder(FOLDERS.hairMale),'hair',indexFragments('hair'),'发型碎片');
 const hairFemale=locate(readFolder(FOLDERS.hairFemale),'hair',indexFragments('hair'),'发型碎片');
 const faceMale=locate(readFolder(FOLDERS.faceMale),'face',indexFragments('face'),'脸型碎片');
 const faceFemale=locate(readFolder(FOLDERS.faceFemale),'face',indexFragments('face'),'脸型碎片');

 for(const file of hairMale)if(hairParts(file.fragmentId).gender!==0)throw Error(`${FOLDERS.hairMale}/${file.name} 不是男性发型碎片`);
 for(const file of hairFemale)if(hairParts(file.fragmentId).gender!==1)throw Error(`${FOLDERS.hairFemale}/${file.name} 不是女性发型碎片`);
 for(const file of faceMale)if(faceParts(file.fragmentId).gender!==0)throw Error(`${FOLDERS.faceMale}/${file.name} 不是男性脸型碎片`);
 for(const file of faceFemale)if(faceParts(file.fragmentId).gender!==1)throw Error(`${FOLDERS.faceFemale}/${file.name} 不是女性脸型碎片`);

 const hairByGender={0:new Map(),1:new Map()};
 for(const file of hairMale){const p=hairParts(file.fragmentId);hairByGender[0].set(`${p.style}:${p.color}`,file.fragmentId);}
 for(const file of hairFemale){const p=hairParts(file.fragmentId);hairByGender[1].set(`${p.style}:${p.color}`,file.fragmentId);}
 const hairKeys=[...new Set([...hairByGender[0].keys(),...hairByGender[1].keys()])]
  .map(key=>key.split(':').map(Number))
  .sort((a,b)=>a[0]-b[0]||a[1]-b[1]);

 const faceByGender={0:new Map(),1:new Map()};
 for(const file of faceMale)faceByGender[0].set(faceParts(file.fragmentId).style,file.fragmentId);
 for(const file of faceFemale)faceByGender[1].set(faceParts(file.fragmentId).style,file.fragmentId);
 const faceStyles=[...new Set([...faceByGender[0].keys(),...faceByGender[1].keys()])].sort((a,b)=>a-b);

 // icon：客户端 updateHair / updateFace 读的那个字段，等于该款造型的「男性碎片编号」。
 //   updateHair: i=icon-START_HAIR(0)；样式=1+(i-1)/8、颜色=(i-1)%8
 //   updateFace: i=icon-START_FACE(1000)；样式=1+(i-1)/8
 // 男性碎片 8*style-7+color / 1000+8*style-7 正好落在这两个公式上。只有女性贴图的
 // 款式用女性碎片也成立：多出来的 +4 只落在颜色的高位，被 2 位掩码截掉。
 const hair=hairKeys.map(([style,color],index)=>{
  const male=hairByGender[0].get(`${style}:${color}`)??null;
  const female=hairByGender[1].get(`${style}:${color}`)??null;
  if(male===null&&female===null)throw Error(`发型样式 ${style}·颜色 ${color} 没有可用贴图`);
  return {id:HAIR_BASE+index,style,color,male,female,icon:male??female};
 });
 const faces=faceStyles.map((style,index)=>{
  const male=faceByGender[0].get(style)??null;
  const female=faceByGender[1].get(style)??null;
  if(male===null&&female===null)throw Error(`脸型样式 ${style} 没有可用贴图`);
  return {id:FACE_BASE+index,style,male,female,icon:male??female};
 });

 return {
  hair,faces,
  folders:{
   hairMale:hairMale.map(file=>file.fragmentId),
   hairFemale:hairFemale.map(file=>file.fragmentId),
   faceMale:faceMale.map(file=>file.fragmentId),
   faceFemale:faceFemale.map(file=>file.fragmentId),
  },
 };
}

/** 把清单里的每件道具合成一张「头像」：脸型碎片打底、发型碎片盖在上面。
 *
 *  为什么不再直接拿碎片当图标：碎片是从角色画布上裁下来的图层——发型碎片只有一撮
 *  头发、脸型碎片只有一张脸，单独显示和角色身上的样子对不上（这正是「道具贴图与
 *  实际表现不一样」）。拼在一起才跟 render 出来的形象同源。
 *
 *  对齐：两类碎片都是紧贴内容裁切的，头顶都压在裁切框的顶边，所以「水平居中 +
 *  头发盖住脸的上沿约四分之一」就等价于它们在角色身上的相对位置。
 *  每件道具出两张帧：<编号> 用男性碎片、<编号>f 用女性碎片，客户端按角色性别取图。 */
const AVATAR_FACE={0:1009,1:1013}; // 样式 2 的男/女脸：给发型道具打底
const AVATAR_HAIR={0:2,1:6};       // 样式 1·颜色 1 的男/女发：给脸型道具打底

export function composeAvatar(faceId,hairId){
 const face=loadFragment(faceId),hair=loadFragment(hairId);
 if(!face||!hair)return null;
 const padding=1;
 const width=padding*2+Math.max(face.width,hair.width);
 // 头发压住脸的高度：碎片高度约四分之一，实测这个比例下刘海正好落在额头上沿。
 const overlap=Math.max(1,Math.round(hair.height*0.26));
 const height=padding*2+Math.max(hair.height,overlap+face.height);
 const rgba=Buffer.alloc(width*height*4);
 const center=image=>padding+Math.round((width-padding*2-image.width)/2);
 blitOver(rgba,width,face,center(face),padding+overlap); // 先脸
 blitOver(rgba,width,hair,center(hair),padding);         // 后头发，盖住额头
 return {width,height,rgba};
}

function buildAtlas(catalog){
 const entries=[];
 const push=(key,faceId,hairId)=>{
  const image=composeAvatar(faceId,hairId);
  if(!image)throw Error(`碎片缺失，没法合成造型图标 ${key}`);
  entries.push({key,image});
 };
 // 发型道具：固定脸打底，换上这一款头发。某款只有单性别贴图时两边都用同一份。
 for(const item of catalog.hair){
  push(String(item.id),AVATAR_FACE[0],item.male??item.female);
  push(item.id+'f',AVATAR_FACE[1],item.female??item.male);
 }
 // 脸型道具：固定头发打底，换上这一张脸。
 for(const item of catalog.faces){
  push(String(item.id),item.male??item.female,AVATAR_HAIR[0]);
  push(item.id+'f',item.female??item.male,AVATAR_HAIR[1]);
 }
 const maxWidth=1024,padding=1;
 let x=padding,y=padding,rowHeight=0;
 const frames={};
 for(const entry of entries){
  if(x+entry.image.width+padding>maxWidth){x=padding;y+=rowHeight+padding;rowHeight=0;}
  frames[entry.key]={x,y,w:entry.image.width,h:entry.image.height,offX:0,offY:0,sourceW:entry.image.width,sourceH:entry.image.height};
  x+=entry.image.width+padding;
  rowHeight=Math.max(rowHeight,entry.image.height);
 }
 const width=Math.max(...entries.map(entry=>frames[entry.key].x+frames[entry.key].w))+padding;
 const height=y+rowHeight+padding;
 // 宽度取 2 的整数幂，避免个别 GPU/解码器对非二次幂贴图的采样问题。
 const atlasWidth=2**Math.ceil(Math.log2(width));
 const rgba=Buffer.alloc(atlasWidth*height*4);
 for(const entry of entries){
  const frame=frames[entry.key];
  blit(rgba,atlasWidth,entry.image,frame.x,frame.y);
 }
 return {png:encodePng(atlasWidth,height,rgba),frames,width:atlasWidth,height,count:entries.length};
}

function mergedSheetTable(frames){
 const url=manifest().url;
 const hash=hashedPath(url,['assets','data','sheet.json']);
 const file=assetFile(hash,'.json');
 const table=JSON.parse(fs.readFileSync(file,'utf8'))
  .filter(entry=>!String(entry).includes(`resource/${SHEET_URL}.json`));
 table.push(JSON.stringify({key:`resource/${SHEET_URL}.json`,value:{frames}}));
 return Buffer.from(JSON.stringify(table),'utf8');
}

export function build(){
 const catalog=buildCatalog();
 const atlas=buildAtlas(catalog);
 const atlasHash=crypto.createHash('md5').update(atlas.png).digest('hex');
 const sheetTable=mergedSheetTable(atlas.frames);
 const sheetHash=crypto.createHash('md5').update(sheetTable).digest('hex');
 const payload={
  revision:REVISION,
  sheet:SHEET_NAME,
  url:SHEET_URL,
  // 图标是「脸型 + 发型」合成的头像，每件两张帧：<编号>（男）/<编号>f（女）。
  avatar:true,
  genderFrames:true,
  avatarFace:AVATAR_FACE,
  avatarHair:AVATAR_HAIR,
  atlas:{hash:atlasHash,width:atlas.width,height:atlas.height,frames:atlas.frames},
  sheetTable:{hash:sheetHash},
  hair:catalog.hair,
  faces:catalog.faces,
  folders:catalog.folders,
  itemIds:[...catalog.hair,...catalog.faces].map(item=>item.id),
 };
 return {payload,atlasPng:atlas.png,sheetTable};
}

export function payloadPath(){return dataFile;}
export function readPayload(){return JSON.parse(fs.readFileSync(dataFile,'utf8'));}

function sameJson(a,b){return JSON.stringify(a,null,1)===JSON.stringify(b,null,1);}

function main(){
 const check=process.argv.includes('--check');
 const built=build();
 if(check){
  const current=fs.existsSync(dataFile)?readPayload():null;
  if(!current)throw Error('data/fashion-icons.json 还没生成，先跑一次 node tools/build-fashion-icons.mjs');
  if(!sameJson(current,built.payload))throw Error('data/fashion-icons.json 与贴图目录不一致，请重新生成');
  for(const [hash,extension] of [[built.payload.atlas.hash,'.png'],[built.payload.sheetTable.hash,'.json']]){
   if(!fs.existsSync(assetFile(hash,extension)))throw Error(`缺少产出文件 assets/${hash.slice(0,2)}/${hash}${extension}`);
  }
  if(!fs.readFileSync(assetFile(built.payload.atlas.hash,'.png')).equals(built.atlasPng))throw Error('图集 PNG 与当前贴图目录不一致');
  console.log(`贴图清单校验通过：发型 ${built.payload.hair.length} 件、脸型 ${built.payload.faces.length} 件。`);
  return;
 }
 fs.writeFileSync(dataFile,JSON.stringify(built.payload,null,1)+'\n');
 fs.writeFileSync(assetFile(built.payload.atlas.hash,'.png'),built.atlasPng);
 fs.writeFileSync(assetFile(built.payload.sheetTable.hash,'.json'),built.sheetTable);
 console.log(`已生成：发型 ${built.payload.hair.length} 件、脸型 ${built.payload.faces.length} 件`);
 console.log(`  图集 client/assets/${built.payload.atlas.hash.slice(0,2)}/${built.payload.atlas.hash}.png（${built.payload.atlas.width}×${built.payload.atlas.height}）`);
 console.log(`  帧表 client/assets/${built.payload.sheetTable.hash.slice(0,2)}/${built.payload.sheetTable.hash}.json`);
 console.log(`  清单 ${path.relative(gameRoot,dataFile)}`);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();

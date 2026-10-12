/**
 * 宠物换皮构建工具 —— 把你画的贴图做成客户端能加载的精灵资源。
 *
 *   node tools/build-pet-reskin.mjs            # 构建
 *   node tools/build-pet-reskin.mjs --check    # 只校验尺寸，不写文件
 *
 * 原理（实测结论，别推倒重来）：
 *   一个宠物精灵 = assets/sprite/model/<id>.json，结构是
 *     files:[贴图编号...]                     ← fragment 表的编号
 *     frames:{0..8:[[fi,sub,x,y,flag],...]}   ← fi 是 files 的**下标**，不是编号
 *     anis:[{id:0|2,...}]                     ← 待机 / 攻击
 *   既然 fi 只是下标，换皮就**只需要把 files[槽位] 换成一个新编号**，
 *   frames / anis 一个字节都不用动 —— 朝向、动作、攻击帧全部白送。
 *
 * 产出：
 *   client/assets/<hh>/<md5>.png   新贴图（内容哈希命名，与官方同规则）
 *   client/assets/<hh>/<md5>.json  新 model（files[槽位] 指向新贴图，其余照抄底模）
 *   data/local-pet-assets.json     登记表（构建期/服务端据此把它们补进资源清单）
 *
 * 注意：client/ 不入库（.gitignore），所以贴图本身不进 git；换机器后重跑本工具即可重建。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const md5=buf=>crypto.createHash('md5').update(buf).digest('hex').slice(0,16);
const assetPath=(raw,hash,ext)=>path.join(raw,'assets',hash.slice(0,2),hash+ext);
const PNG_COLOR={0:'灰度',2:'RGB',3:'索引色',4:'灰度+α',6:'RGBA'};
export function pngSize(file){
 const b=fs.readFileSync(file);
 if(b.length<24||b.slice(1,4).toString()!=='PNG')throw Error(`不是 PNG 文件：${file}`);
 return [b.readUInt32BE(16),b.readUInt32BE(20)];
}
/**
 * 原版贴图**全部**是索引色（色型 3）+ tRNS，且 alpha 只有 0/255 两个值（硬边，无羽化）。
 * 客户端解码器对别的色型能不能正确处理没有实测证据，所以这里只警告不阻止：
 * 尺寸与布局是硬约束，色型是「未知风险」—— 交给玩家拿试包在手机上确认。
 */
export function pngColorType(file){
 const b=fs.readFileSync(file);
 if(b.length<26||b.slice(1,4).toString()!=='PNG')return null;
 return {code:b[25],label:PNG_COLOR[b[25]]||`未知(${b[25]})`,depth:b[24]};
}

/**
 * 执行一次换皮构建。纯逻辑与写盘分开，测试可以直接调它验证「frames 逐字节不变」。
 * @returns {{manifest:object,models:Record<string,object>,written:string[],removed:string[]}}
 */
export function buildReskin({root,config,previous={},checkOnly=false,log=()=>{}}){
 const raw=path.join(root,'client');
 const gd=JSON.parse(fs.readFileSync(path.join(raw,'v/gd/305.json'),'utf8'));
 const fragTable=gd.url.assets.sprite.fragment,modelTable=gd.url.assets.sprite.model;
 const modelFile=id=>{
  const h=modelTable[`${id}.json`];
  if(!h)throw Error(`底模 model ${id}.json 不在资源清单里。`);
  return path.join(raw,'assets',h.slice(0,2),h+'.json');
 };
 const fragFile=id=>{
  const h=fragTable[`${id}.png`];
  return h?path.join(raw,'assets',h.slice(0,2),h+'.png'):null;
 };

 const next={revision:`local-pet-assets-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`,
  fragments:{},models:{},assign:{},files:{}};
 const models={},written=[],removed=[];
 // 编号分配：同一只宠物沿用上次分到的编号，避免每次构建漂移（编号要写进 local-pets.json）。
 let fragCursor=config.fragmentIdStart??40000,modelCursor=config.modelIdStart??60000;
 const nextFragId=()=>{while(fragTable[`${fragCursor}.png`]||next.fragments[`${fragCursor}.png`])fragCursor++;return fragCursor++;};
 const nextModelId=()=>{while(modelTable[`${modelCursor}.json`]||next.models[`${modelCursor}.json`])modelCursor++;return modelCursor++;};

 function reskin(entry,part){
  const slots=entry.replace?.[part]||[],textures=entry.textures?.[part]||[];
  if(!slots.length)return null;
  if(slots.length!==textures.length)
   throw Error(`${entry.key} 的 ${part}：replace 有 ${slots.length} 个槽位，textures 只给了 ${textures.length} 张图。`);
  const baseId=part==='model'?entry.baseModel:entry.baseHead;
  const base=JSON.parse(fs.readFileSync(modelFile(baseId),'utf8'));
  const files=[...base.files];
  for(let i=0;i<slots.length;i++){
   const slot=slots[i];
   if(!Number.isInteger(slot)||slot<0||slot>=files.length)
    throw Error(`${entry.key} 的 ${part}：槽位 ${slot} 越界（底模 ${baseId} 只有 ${files.length} 张贴图）。`);
   const src=path.join(root,'data','local-pet-art',textures[i]);
   if(!fs.existsSync(src))throw Error(`找不到素材：data/local-pet-art/${textures[i]}`);
   const want=fragFile(files[slot]);
   if(!want)throw Error(`${entry.key} 的 ${part}：底模原贴图 ${files[slot]} 不在清单里，无法比对尺寸。`);
   const [ww,wh]=pngSize(want),[gw,gh]=pngSize(src);
   if(ww!==gw||wh!==gh)
    throw Error(`${entry.key} 的 ${part} 第 ${i+1} 张（${textures[i]}）尺寸 ${gw}×${gh}，底模要求 ${ww}×${wh} —— 必须像素级一致，否则帧坐标会全部错位。`);
   const wantType=pngColorType(want),gotType=pngColorType(src);
   if(wantType&&gotType&&gotType.code!==wantType.code)
    log('  ⚠ %s 是 %s（%d 位），底模原图是 %s —— 原版贴图一律索引色+硬边，'
      +'别的色型没实测过，建议先在手机上试一只再批量做。',textures[i],gotType.label,gotType.depth,wantType.label);
   const id=nextFragId(),buf=fs.readFileSync(src),hash=md5(buf);
   next.fragments[`${id}.png`]=hash;
   next.files[hash]={kind:'fragment',key:entry.key,part,slot};
   if(!checkOnly){
    const dest=assetPath(raw,hash,'.png');
    fs.mkdirSync(path.dirname(dest),{recursive:true});
    if(!fs.existsSync(dest))fs.writeFileSync(dest,buf);
    written.push(dest);
   }
   log('  贴图 %s %sx%s → fragment %s（%s）',textures[i],gw,gh,id,hash);
   files[slot]=id;
  }
  const modelId=previous.assign?.[entry.key]?.[part]??nextModelId();
  // frames / anis 原样保留：只换 files 里的编号，朝向与动作全部沿用底模。
  const json={...base,files};
  const hash=md5(Buffer.from(JSON.stringify(json),'utf8'));
  next.models[`${modelId}.json`]=hash;
  next.files[hash]={kind:'model',key:entry.key,part};
  models[modelId]=json;
  if(!checkOnly){
   const dest=assetPath(raw,hash,'.json');
   fs.mkdirSync(path.dirname(dest),{recursive:true});
   if(!fs.existsSync(dest))fs.writeFileSync(dest,Buffer.from(JSON.stringify(json),'utf8'));
   written.push(dest);
  }
  log('  → model %s（%s）',modelId,hash);
  return modelId;
 }

 let built=0;
 for(const entry of config.entries||[]){
  log('\n=== %s ===',entry.key);
  const model=reskin(entry,'model'),head=reskin(entry,'head');
  if(model===null&&head===null){log('  （没有要换的贴图，跳过）');continue;}
  next.assign[entry.key]={...(previous.assign?.[entry.key]||{}),...(model!==null?{model}:{}),...(head!==null?{head}:{})};
  built++;
 }

 // 清掉上次产出、这次不再用到的文件（同一只宠物重画时避免垃圾堆积）。
 for(const [hash,info] of Object.entries(previous.files||{})){
  if(next.files[hash])continue;
  const f=assetPath(raw,hash,info.kind==='model'?'.json':'.png');
  if(!fs.existsSync(f))continue;
  if(!checkOnly)fs.unlinkSync(f);
  removed.push(f);
  log('  清理旧产物 %s（%s %s）',hash,info.key,info.part);
 }
 return {manifest:next,models,written,removed,built};
}

const isCli=process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url));
if(isCli){
 const root=fileURLToPath(new URL('..',import.meta.url));
 const CONFIG=path.join(root,'data','local-pet-art','reskin.json');
 const OUT=path.join(root,'data','local-pet-assets.json');
 const checkOnly=process.argv.includes('--check');
 if(!fs.existsSync(CONFIG)){
  console.log('没有找到 data/local-pet-art/reskin.json —— 还没有要换皮的宠物。');
  console.log('把要做的宠物按下面的格式写进 data/local-pet-art/reskin.json，贴图放同一个目录：');
  const sample={
   fragmentIdStart:40000,modelIdStart:60000,
   entries:[{
    key:'冰霜幼龙:4',baseModel:504,baseHead:503,
    replace:{model:[0],head:[0]},
    textures:{model:['冰霜幼龙/body.png'],head:['冰霜幼龙/head.png']},
   }],
  };
  console.log(JSON.stringify(sample,null,2));
  process.exit(0);
 }
 const config=JSON.parse(fs.readFileSync(CONFIG,'utf8'));
 const previous=fs.existsSync(OUT)?JSON.parse(fs.readFileSync(OUT,'utf8')):{};
 const {manifest,removed,built}=buildReskin({root,config,previous,checkOnly,log:console.log});
 if(checkOnly){
  console.log('\n--check 模式：只校验，未写任何文件。');
  process.exit(0);
 }
 fs.writeFileSync(OUT,JSON.stringify(manifest,null,2)+'\n','utf8');
 console.log('\n构建完成：%d 只宠物，%d 张贴图，%d 个 model（清理旧产物 %d 个）',
  built,Object.keys(manifest.fragments).length,Object.keys(manifest.models).length,removed.length);
 console.log('登记表 → data/local-pet-assets.json');
 console.log('\n接下来把编号填进 data/local-pets.json 的 baseline：');
 for(const [key,a] of Object.entries(manifest.assign))
  console.log('  %s → model:%s  headIcon:%s',key,a.model??'(沿用)',a.head??'(沿用)');
}

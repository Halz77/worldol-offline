/**
 * 导出「宠物换皮底模参考包」—— 给要手绘贴图的人一份能照着画的底稿。
 *
 *   node tools/export-pet-reskin-templates.mjs                     # 导出到默认目录
 *   node tools/export-pet-reskin-templates.mjs --out D:/somewhere  # 换输出目录
 *   node tools/export-pet-reskin-templates.mjs --pets 504,516,708  # 只导这几只
 *   node tools/export-pet-reskin-templates.mjs --all               # 导全部有 model 的宠物
 *
 * 产出（每只底模一个目录）：
 *   slot<槽位>_frag<编号>_<宽>x<高>.png   场景/战斗贴图（槽位 = 底模 json 的 files 下标）
 *   头像/slot<槽位>_frag<编号>_<宽>x<高>.png
 *   layout-frag<编号>.json                图集区域表（原样抄客户端那份）
 *   布局图-frag<编号>.svg                 可视化：格子 + 部件号 + 尺寸，用到的部件标红
 *   README.md / 00-尺寸清单.md / 01-部件布局.md   三份说明，每次都重写
 *
 * 几个**实测踩过**的点，别改回去：
 *   · 资源不全在 assets/<hash 前两位>/：还有一部分（含 12013 的图集）在 assets/dirad/。
 *     只认前两位会认为「这张贴图没有图集」—— 上一版参考包就是这么漏掉 12013 的。
 *   · model json 里 frames 的键是**姿态/朝向**，不是帧；值是「若干部件的拼装清单」
 *     `[贴图下标, 部件号, x, y, flag]`。一条 anis 的 gesture 才是动画时间线。
 *     所以「每朝向 7~8 帧」是错的，应该是「每个姿态最多 7~8 个部件」。
 *   · 某张贴图「用到的部件」必须按 `贴图下标` 分开统计。把整个 model 的部件并起来算，
 *     会让第二、三张贴图标出一堆根本不属于它的部件号（上一版也踩了这个）。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** 参考包默认落在这里（仓库外，和之前那份一致）。 */
export const DEFAULT_OUT=path.join(path.resolve(fileURLToPath(new URL('../../../../..',import.meta.url))),'MobileFile','pet-reskin-templates');

/** 默认导出的底模：5 只手工挑过的「好画又好用」的代表。 */
export const DEFAULT_PETS=[504,516,548,532,708];

/** 被这么多个 model 引用就认定是通用小件（阴影/光效），不建议重画。 */
export const GENERIC_REFERENCE_LIMIT=500;

const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const pad=n=>String(n).padStart(2,'0');

/**
 * 资源解析：先找 `assets/<hash 前两位>/<hash><ext>`，再回退 `assets/dirad/<hash><ext>`。
 * @returns {string|null} 实际存在的路径
 */
export function resolveAsset(rawRoot,hash,ext){
 if(!hash)return null;
 const primary=path.join(rawRoot,'assets',hash.slice(0,2),hash+ext);
 if(fs.existsSync(primary))return primary;
 const fallback=path.join(rawRoot,'assets','dirad',hash+ext);
 return fs.existsSync(fallback)?fallback:null;
}

/**
 * 一张贴图（`files[slot]`）实际用到哪些部件、出现在几个姿态里、单姿态最多几个部件。
 *
 * `[贴图下标, 部件号, x, y, flag]` 的第一项是下标，所以必须按它过滤 —— 这是把
 * 「一张贴图的部件」和「整个模型的部件」分开的唯一依据。
 */
export function textureUsage(model,slot){
 const subs=new Set();
 let poses=0,maxParts=0;
 for(const pose of Object.keys(model.frames||{})){
  const parts=(model.frames[pose]||[]).filter(part=>part[0]===slot);
  if(!parts.length)continue;
  poses++;maxParts=Math.max(maxParts,parts.length);
  for(const part of parts)subs.add(part[1]);
 }
 return {subs:[...subs].sort((a,b)=>a-b),poses,maxParts};
}

/** 图集区域表 → 行数组（按部件号排序）。图集缺失时返回 null（说明这张图是单部件）。 */
export function atlasRows(atlas){
 if(!atlas?.frames)return null;
 return Object.keys(atlas.frames).map(Number).sort((a,b)=>a-b)
  .map(id=>({id,...atlas.frames[String(id)]}));
}

/** 有多少个 model 引用这张贴图 —— 数字很大就是「几千个模型共用的小件」，别重画。 */
export function referenceCounts(modelTable,rawRoot){
 const count=new Map();
 for(const key of Object.keys(modelTable)){
  const file=resolveAsset(rawRoot,modelTable[key],'.json');
  if(!file)continue;
  let model;
  try{model=JSON.parse(fs.readFileSync(file,'utf8'));}catch{continue;}
  for(const id of model.files||[])count.set(id,(count.get(id)||0)+1);
 }
 return count;
}

function svgFor(pet,frag,atlas,usage,png){
 const [w,h]=[png.w,png.h],scale=4,pad0=20,header=30;
 const rows=atlasRows(atlas)||[{id:0,x:0,y:0,w,h}];
 const used=new Set(usage.subs);
 const colors=['#e57373','#81c784','#64b5f6','#ffb74d','#ba68c8','#4db6ac','#f06292','#a1887f'];
 const parts=[];
 parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w*scale+pad0*2}" height="${h*scale+header+pad0}" viewBox="0 0 ${w*scale+pad0*2} ${h*scale+header+pad0}">`);
 parts.push(`<rect width="100%" height="100%" fill="#fafafa"/>`);
 parts.push(`<text x="10" y="18" font-family="sans-serif" font-size="13" fill="#333">${esc(pet.name)} frag${frag}　画布 ${w}×${h}　图集 ${rows.length} 个部件　该贴图用到 ${usage.subs.length} 个（红框=要画）</text>`);
 parts.push(`<g transform="translate(${pad0},${header})">`);
 parts.push(`<rect x="0" y="0" width="${w*scale}" height="${h*scale}" fill="#fff" stroke="#bbb" stroke-dasharray="4 3"/>`);
 for(const [index,row] of rows.entries()){
  const on=used.has(row.id),color=colors[index%colors.length];
  parts.push(`<rect x="${row.x*scale}" y="${row.y*scale}" width="${row.w*scale}" height="${row.h*scale}" fill="${color}" fill-opacity="${on?0.30:0.08}" stroke="${on?color:'#ccc'}" stroke-width="${on?1.5:1}" stroke-dasharray="3 2"/>`);
  parts.push(`<text x="${row.x*scale+2}" y="${row.y*scale+10}" font-family="monospace" font-size="13" fill="#222">${row.id}</text>`);
  parts.push(`<text x="${row.x*scale+2}" y="${row.y*scale+row.h*scale-2}" font-family="monospace" font-size="10" fill="#444">${row.w}×${row.h}</text>`);
 }
 parts.push(`</g></svg>`);
 return parts.join('\n')+'\n';
}

function loadModel(rawRoot,modelTable,id){
 const file=resolveAsset(rawRoot,modelTable[`${id}.json`],'.json');
 if(!file)throw Error(`底模 model ${id}.json 找不到（表里有键但文件缺失）。`);
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function loadAtlas(rawRoot,fragTable,id){
 const file=resolveAsset(rawRoot,fragTable[`${id}.json`],'.json');
 return file?JSON.parse(fs.readFileSync(file,'utf8')):null;
}
function pngSizeOf(rawRoot,fragTable,id){
 const file=resolveAsset(rawRoot,fragTable[`${id}.png`],'.png');
 if(!file)return null;
 const b=fs.readFileSync(file);
 return {w:b.readUInt32BE(16),h:b.readUInt32BE(20),file};
}

/** 导出全部：写盘 + 返回生成的说明文本（测试可以直接看返回的字符串）。 */
export function exportTemplates({rawRoot,outDir,pets,log=()=>{}}){
 const gd=JSON.parse(fs.readFileSync(path.join(rawRoot,'v/gd/305.json'),'utf8'));
 const fragTable=gd.url.assets.sprite.fragment,modelTable=gd.url.assets.sprite.model;
 fs.mkdirSync(outDir,{recursive:true});
 const refs=referenceCounts(modelTable,rawRoot);
 let sizeDoc=['# 宠物换皮 · 底模贴图尺寸清单','',
  '每个目录里的 png 就是底模用的全部贴图。你要画的图必须**整张尺寸像素级一致**（构建会挡住不符的）。',
  '',`文件名 = \`slot<槽位>_frag<贴图编号>_<宽>x<高>.png\`，**槽位就是底模 json 里 files 数组的下标**`,
  '（写 reskin.json 的 `replace` 时填的就是它）。',''].join('\n');
 let layoutDoc=['# 宠物换皮 · 部件布局（重绘看这份）','',
  '**贴图不是「一只宠物」，而是一张拼装用的部件雪碧图。** 渲染时每帧按',
  '`[贴图下标, 部件号, x偏移, y偏移, flag]` 把若干部件拼成一只完整的宠物。',
  '所以换皮要画的是**这些部件**，而且每个部件必须待在下面标注的位置与尺寸上（差一个像素就错位）。','',
  '每张图配一张 `布局图-fragXXXX.svg`（浏览器打开）：**红框 = 这张图真正用到的部件，浅框 = 图里有但用不到，可以先不画。**',
  '没有 `layout-*.json` 的贴图说明它**没有图集**：整张图就是 1 个部件（sub 恒为 0），照整张画即可。',''].join('\n');

 const readme=[];
 for(const pet of pets){
  const scene=loadModel(rawRoot,modelTable,pet.model);
  const head=loadModel(rawRoot,modelTable,pet.head);
  const dir=path.join(outDir,`${pet.name}-model${pet.model}`);
  const headDir=path.join(dir,'头像');
  fs.mkdirSync(headDir,{recursive:true});
  // 清掉**上一版命名**留下的 `NN_fragNNNNN_WxH.png`：它和新命名会并存，
  // 混在一起谁也不知道该照哪份画。只删这个固定模式，别人的文件一律不碰。
  const legacy=/^\d{2,3}_frag\d+_\d+x\d+\.png$/;
  for(const folder of [dir,headDir])
   for(const name of fs.readdirSync(folder))
    if(legacy.test(name))fs.unlinkSync(path.join(folder,name));
  const scenes=[],heads=[];
  const emit=(model,slot,list,into)=>{
   const frag=model.files[slot],png=pngSizeOf(rawRoot,fragTable,frag);
   if(!png)throw Error(`${pet.name} 的 frag${frag} 找不到图片文件。`);
   const atlas=loadAtlas(rawRoot,fragTable,frag);
   const usage=textureUsage(model,slot);
   const base=`slot${slot}_frag${frag}_${png.w}x${png.h}`;
   fs.writeFileSync(path.join(into,base+'.png'),fs.readFileSync(png.file));
   if(atlas)fs.writeFileSync(path.join(into,`layout-frag${frag}.json`),JSON.stringify(atlas,null,2)+'\n');
   fs.writeFileSync(path.join(into,`布局图-frag${frag}.svg`),svgFor(pet,frag,atlas,usage,png));
   const row={slot,frag,w:png.w,h:png.h,atlas,usage,refs:refs.get(frag)||0,fileName:base+'.png'};
   list.push(row);log('  %s frag%s %dx%d（槽位 %d，用到 %d 个部件，被 %d 个 model 引用）',into===dir?'场景':'头像',frag,png.w,png.h,slot,usage.subs.length,row.refs);
   return row;
  };
  log('\n=== %s model=%s head=%s ===',pet.name,pet.model,pet.head);
  for(let slot=0;slot<scene.files.length;slot++)emit(scene,slot,scenes,dir);
  for(let slot=0;slot<head.files.length;slot++)emit(head,slot,heads,headDir);

  const poseCount=Object.keys(scene.frames||{}).length;
  const anis=scene.anis.map(a=>`${a.id===0?'待机':a.id===2?'攻击':'动作'+a.id} ${a.gesture.length} 帧`).join('、');
  const body=scenes[0];
  // 「要不要画」的判据是**被多少个 model 引用**：几千个模型共用的那张一定是
  // 阴影/光效这类通用件，重画它既没意义又会把别的宠物一起改掉。
  const verdict=r=>r===body?'**主体 · 必画**'
   :r.refs>=GENERIC_REFERENCE_LIMIT?`通用件（${r.refs} 个 model 共用）· **不用画**`
   :`可画（${r.refs} 个 model 共用）`;
  const table=rows=>['| 槽位 | 编号 | 尺寸 | 要不要画 | 被几个 model 引用 |','|---|---|---|---|---|',
   ...rows.map(r=>`| ${r.slot} | frag${r.frag} | ${r.w}×${r.h} | ${verdict(r)} | ${r.refs} |`)].join('\n');
  const needDraw=[...scenes,...heads].filter(r=>r===body||r.refs<GENERIC_REFERENCE_LIMIT).length;

  sizeDoc+=`\n## ${pet.name}　model=${pet.model}　head=${pet.head}\n\n`
   +`- 场景/战斗：**${scenes.length} 张**贴图，${poseCount} 个姿态（朝向），${anis}\n`
   +`- 头像：**${heads.length} 张**贴图（宠物栏 / 头像用的另一套 model）\n`
   +`- 真正要动手画的：**${needDraw} 张**（主体 + 该底模专属的部件图；通用件别碰）\n\n`
   +`场景贴图（画这些，文件名前缀 = 槽位）\n\n${table(scenes)}\n\n`
   +`头像贴图（放在 \`头像/\` 目录里）\n\n${table(heads)}\n\n`;

  layoutDoc+=`\n## ${pet.name}　model=${pet.model}\n`;
  for(const [i,r] of scenes.entries()){
   const rows=atlasRows(r.atlas);
   layoutDoc+=`\n### 场景槽位 ${r.slot}　frag${r.frag}（${r.w}×${r.h}）${i===0?'　← 主体':''}\n\n`
    +`- 图集部件 **${rows?rows.length:1}** 个，这张贴图实际用到 **${r.usage.subs.length}** 个`
    +`（出现于 ${r.usage.poses} 个姿态，单姿态最多 ${r.usage.maxParts} 个）\n`
    +`- 用到的部件号：\`${r.usage.subs.join(', ')||'0（无图集，整张即一个部件）'}\`\n`
    +`- 布局图：\`布局图-frag${r.frag}.svg\`（浏览器打开）\n`;
   if(rows)layoutDoc+=`\n| 部件 | x | y | 宽 | 高 | 用到 |\n|---|---|---|---|---|---|\n`
    +rows.map(row=>`| ${row.id} | ${row.x} | ${row.y} | ${row.w} | ${row.h} | ${r.usage.subs.includes(row.id)?'✔':'—'} |`).join('\n')+'\n';
   else layoutDoc+=`\n（没有图集：整张 ${r.w}×${r.h} 就是 1 个部件，sub 恒为 0。）\n`;
  }
  readme.push({pet,scenes,heads,poseCount,anis});
 }

 fs.writeFileSync(path.join(outDir,'00-尺寸清单.md'),sizeDoc+'\n');
 fs.writeFileSync(path.join(outDir,'01-部件布局.md'),layoutDoc+'\n');
 fs.writeFileSync(path.join(outDir,'README.md'),readmeDoc(readme));
 return {outDir,sizeDoc,layoutDoc,pets:readme};
}

function readmeDoc(readme){
 const lines=['# 宠物换皮 · 底模参考包','',
  '这是给「自己画宠物贴图」用的**底稿 + 说明书**，不是游戏资源。配合仓库里的',
  '`tools/build-pet-reskin.mjs` 使用 —— 换皮只需要重画 1~5 张图，朝向、动作、攻击帧全部白送。','',
  '## 目录里三个文件各是什么','',
  '| 文件 | 是什么 |','|---|---|',
  '| `slot<槽位>_frag<编号>_<宽>x<高>.png` | 底模原贴图。名字里的**槽位**就是 `files` 数组下标，`frag<编号>` 是客户端里的贴图编号 |',
  '| `布局图-frag<编号>.svg` | 浏览器直接打开：格子 + 部件号 + 每格尺寸，**红框 = 这张图真正用到的部件** |',
  '| `layout-frag<编号>.json` | 上面那张图的原始数据（图集区域表），给工具用的 |',
  '| `头像/` | 宠物栏 / 头像小图用的另一套 model（`head=` 那个号），规则完全相同 |',
  '| `00-尺寸清单.md` | 每只底模有哪些贴图、多大、**哪几张真的需要画** |',
  '| `01-部件布局.md` | 每张贴图的部件表 + 哪些部件用得到（重绘时对着看） |','',
  '## 场景贴图 vs 头像贴图','',
  '- **场景贴图**（`<宠物>-model<号>/` 根目录）：地图上站着、战斗中跑动的那只，朝向/待机/攻击全靠它。',
  '- **头像贴图**（`头像/`）：宠物栏、头像小图。**可以整个不换** —— reskin.json 里省略 `replace.head`',
  '  / `textures.head` 就沿用底模头像。','',
  '## 重绘怎么下手（四步）','',
  '1. **挑底模**：看 `00-尺寸清单.md` 的「真正要动手画的」那一行。场景贴图里绝大多数是几千个 model',
  '   共用的通用件（阴影、光效），**不用画**；真正要画的通常只有 1~2 张，加上头像也就 2~5 张。',
  '2. **打开布局图**：按**红框**画。浅框是图集里有、动画没用到的部件，可以留空 —— 但要保持透明、别改画布尺寸。',
  '3. **尺寸必须像素级一致**：整张画布与该贴图原图完全相同（差 1 像素，所有帧坐标就会错位）。',
  '   `build-pet-reskin.mjs --check` 会先验一遍，不符直接报错。',
  '4. **写 reskin.json 并构建**：','',
  '```json',
  '{',
  '  "fragmentIdStart": 40000,',
  '  "modelIdStart": 60000,',
  '  "entries": [',
  '    {',
  '      "key": "冰霜幼龙:4",',
  '      "baseModel": 504,',
  '      "baseHead": 503,',
  '      "replace": { "model": [0], "head": [0] },',
  '      "textures": { "model": ["冰霜幼龙/body.png"], "head": ["冰霜幼龙/head.png"] }',
  '    }',
  '  ]',
  '}',
  '```','',
  '```','node tools/build-pet-reskin.mjs --check   # 只验尺寸','node tools/build-pet-reskin.mjs           # 构建','```','',
  '- `replace.model` / `replace.head` 里的数字 = **槽位**（就是文件名里的 `slot<数字>`）。',
  '- 只想换主体就写 `[0]`；不换头像就整个省略 `replace.head` / `textures.head`。','',
  '## 哪些不用画','',
  '- **被成百上千个 model 引用的贴图**是通用小件（阴影、光效、小图标）。`00-尺寸清单.md` 里那列「被几个 model 引用」',
  '  就是干这个用的：数字几百以上的一律别重画，构建时原样保留。',
  '- 图集里**浅框**的部件动画用不到，可以先不画。','',
  '## 每只底模的槽位速查','',
  '「通用」= 被几百上千个 model 共用的小件（阴影/光效），**别重画**，构建时原样保留。','',
  '| 底模 | 场景贴图（槽位 → 编号 尺寸） | 头像贴图 | 要画几张 |','|---|---|---|---|'];
 for(const {pet,scenes,heads} of readme){
  const fmt=list=>list.map(r=>`\`${r.slot}\` → frag${r.frag} ${r.w}×${r.h}${r.refs>=GENERIC_REFERENCE_LIMIT?'（通用）':''}`).join('<br>')||'—';
  const need=[...scenes,...heads].filter((r,i)=>i===0||r.refs<GENERIC_REFERENCE_LIMIT).length;
  lines.push(`| ${pet.name}（model ${pet.model}） | ${fmt(scenes)} | ${fmt(heads)} | ${need} 张 |`);
 }
 lines.push('','> 这份包由 `node tools/export-pet-reskin-templates.mjs` 生成，可以随时重跑；','> 仓库里的 `client/` 不入库，换机器后重跑即可重建。','');
 return lines.join('\n');
}

const isCli=process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url));
if(isCli){
 const root=fileURLToPath(new URL('..',import.meta.url));
 const rawRoot=path.join(root,'client');
 const argOf=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;};
 const outDir=argOf('--out')?path.resolve(argOf('--out')):DEFAULT_OUT;
 const petsArg=argOf('--pets');
 // 名字 / 头像 model 都从宠物目录里按 model 号反查 —— 底模清单不在这里另抄一份。
 const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/pet-catalog.json'),'utf8'));
 const byModel=new Map();
 for(const profile of catalog.profiles||[]){
  const model=profile.baseline?.model,head=profile.baseline?.headIcon;
  if(Number.isInteger(model)&&!byModel.has(model))byModel.set(model,{model,head:Number.isInteger(head)?head:model,name:profile.name});
 }
 let pets;
 if(process.argv.includes('--all'))pets=[...byModel.values()];
 else{
  const wanted=petsArg?petsArg.split(',').map(Number).filter(Number.isInteger):DEFAULT_PETS;
  const missing=wanted.filter(id=>!byModel.has(id));
  if(missing.length)console.log('[warn] 这些 model 号在宠物目录里查不到，已跳过：%s',missing.join(', '));
  pets=wanted.filter(id=>byModel.has(id)).map(id=>byModel.get(id));
 }
 if(!pets.length){console.error('没有可导出的底模。');process.exit(1);}
 if(!fs.existsSync(path.join(rawRoot,'v/gd/305.json'))){
  console.error('找不到 client/v/gd/305.json —— 这台机器上没有客户端资源，没法导出底模。');
  process.exit(1);
 }
 // 默认输出目录的**父目录**必须已存在：默认路径是靠相对层级拼出来的，
 // 层级数写错就会安静地把参考包吐到一个莫名其妙的地方（踩过一次）。
 // 宁可在这里炸掉，也不要把几 MB 贴图写到错的目录里。
 if(!fs.existsSync(path.dirname(outDir))){
  console.error('输出目录的父目录不存在：%s\n请用 --out <目录> 明确指定。',path.dirname(outDir));
  process.exit(1);
 }
 console.log('导出 %d 只底模 → %s',pets.length,outDir);
 const result=exportTemplates({rawRoot,outDir,pets,log:(...a)=>console.log(...a)});
 console.log('\n完成：%s',result.outDir);
}

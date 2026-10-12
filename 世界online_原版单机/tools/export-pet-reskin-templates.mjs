/**
 * 导出「宠物换皮底模参考包」—— 给要手绘贴图的人一份能照着画的底稿。
 *
 *   node tools/export-pet-reskin-templates.mjs                     # 默认那几只（见 DEFAULT_STYLES）
 *   node tools/export-pet-reskin-templates.mjs --styles 2,20,34    # 按风格号挑
 *   node tools/export-pet-reskin-templates.mjs --all               # 客户端里有精灵的全部风格
 *   node tools/export-pet-reskin-templates.mjs --list              # 只打印风格清单，不导出
 *   node tools/export-pet-reskin-templates.mjs --clean             # 先清掉上一次的产物目录
 *   node tools/export-pet-reskin-templates.mjs --out D:/somewhere  # 换输出目录
 *
 * ── 宠物的精灵号是怎么来的（实测链，别再猜）────────────────────────────
 *
 *   客户端 SpriteTool.getPetSpriteByIcon(icon1)：
 *     style = icon1.low >> OFFSET_PET_STYLE(0) & LEN_PET_STYLE(6 位)
 *     世界/地图精灵 = SPR_INDEX_PET_WORLD_START(500) + style - 1
 *     战斗精灵     = SPR_INDEX_PET_BATTLE_START(600) + style - 1
 *   同一份 ModelConst 里还有 PET_COLOR（icon1.low 的第 6~7 位，2 位）→ 引擎按它调色，
 *   **同一张贴图出四种配色**。所以「红炎少女(色3) / 魔法少女(色0) / 虚无少女(色2)」
 *   是同一套图；「黑夜猫女(色2) / 可爱猫女(色0) / 红艳猫女(色1)」也是同一套。
 *
 *   ⚠ 宠物目录（data/pet-catalog.json）里的 `baseline.model` **不是精灵号** ——
 *     它是模板号（480/504 条与 templateId 完全相同）。拿它去查 sprite/model 表，
 *     会拿到一只毫不相干的精灵（实测 template 504 → 火焰元素、516 → 天空战神、
 *     708 → 骑马的骑士）。真正的入口只有 `baseline.icon`（= 抓包来的 icon1）。
 *
 *   ⚠ 世界精灵与战斗精灵是**两套不同的 model**：实测 52 个风格里 0 个相同。
 *     只换一套 = 地图上是你画的那只、一进战斗就变回原版。
 *
 * 产出（每个风格号一个目录）：
 *   <代表宠物>-style<风格号>/世界/slot<槽位>_frag<编号>_<宽>x<高>.png
 *   <代表宠物>-style<风格号>/战斗/同上
 *   <代表宠物>-style<风格号>/头像/（headIcon 号；与世界图同一个号时不再导出）
 *   layout-frag<编号>.json / 布局图-frag<编号>.svg   每张贴图的图集与可视化
 *   README.md / 00-尺寸清单.md / 01-部件布局.md       三份说明，每次都重写
 *
 * 几个**实测踩过**的点，别改回去：
 *   · 资源不全在 assets/<hash 前两位>/：还有一部分（含 12013 的图集）在 assets/dirad/。
 *     只认前两位会认为「这张贴图没有图集」—— 参考包第一版就是这么漏掉 12013 的。
 *   · model json 里 frames 的键是**姿态/朝向**，不是帧；值是「若干部件的拼装清单」
 *     `[贴图下标, 部件号, x, y, flag]`。一条 anis 的 gesture 才是动画时间线。
 *     所以「每朝向 7~8 帧」是错的，应该是「每个姿态最多 7~8 个部件」。
 *   · 某张贴图「用到的部件」必须按 `贴图下标` 分开统计。把整个 model 的部件并起来算，
 *     会让第二、三张贴图标出一堆根本不属于它的部件号（上一版也踩了这个）。
 *   · 部件的位置是 `frames` 里的 (x,y)，**图集区域自身的 x/y 不能再加一次** ——
 *     加上去每块部件都会偏出去，拼出来是一堆散件（拼姿态预览时踩过）。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PET_WORLD_BASE,PET_BATTLE_BASE,PET_STYLE_MASK,PET_COLOR_SHIFT,PET_COLOR_MASK,petSpriteOf,freePetStyles} from '../lib/pet-sprite.mjs';

// 编号规则在 lib/pet-sprite.mjs（唯一来源，换皮构建工具也用同一份），这里只是转出去方便调用。
export {PET_WORLD_BASE,PET_BATTLE_BASE,PET_STYLE_MASK,PET_COLOR_SHIFT,PET_COLOR_MASK,petSpriteOf,freePetStyles};

/** 参考包默认落在这里（仓库外，和之前那份一致）。 */
export const DEFAULT_OUT=path.join(path.resolve(fileURLToPath(new URL('../../../../..',import.meta.url))),'MobileFile','pet-reskin-templates');

/** 被这么多个 model 引用就认定是**半通用件**（几十上百只宠物共用的小配件）：
 *  改它会把别的宠物一起改掉，所以默认不画，但不像通用件那样绝对。 */
export const SHARED_REFERENCE_LIMIT=100;

/** 被这么多个 model 引用就认定是通用小件（阴影/光效），不建议重画。 */
export const GENERIC_REFERENCE_LIMIT=500;

/** 默认导出的风格号：**人形优先**，按「要动手画的张数」从少到多排。
 *   2  萌系女仆/朝比奈实玖琉/守护女仆   世界与战斗通用一张 112×61（最省事）
 *   20 魔法少女/红炎少女/虚无少女       一张 145×72
 *   12 可爱猫女/黑夜猫女/红艳猫女       一张 108×78（猫耳小女仆）
 *   34 九尾狐妖/九尾灵狐                两张（尾巴那张 110×40 只在战斗用）
 *   31 青蛇/蛇妖                        两张
 *   21 蒙面骑士/天空骑士/能天使         三张（人形骑士）
 *   16 罗贝尔特/狂暴女仆/守护女仆       四张（战斗比世界多两张）
 *   7  仙灵/魔法仙灵/弓灵               小型飞行体，当参照
 * 其余人形风格（鬼神 28 / 女娲后裔 30 / 灯神 26 / 告命天使 17 / 独角人马兽 44）
 * 用 `--styles 28,30` 单独导出，成本见 00-尺寸清单.md。 */
export const DEFAULT_STYLES=[2,20,12,34,31,21,16,7];

const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

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

/**
 * 宠物目录 → 「风格号 → 共用这套图的宠物们」。
 * 只保留有 icon 的条目；同名宠物只记一次（目录里同名多阶是常态）。
 */
export function styleIndex(catalog){
 const styles=new Map();
 for(const profile of catalog.profiles||[]){
  const sprite=petSpriteOf(profile);
  if(!sprite)continue;
  const row=styles.get(sprite.style)??{style:sprite.style,pets:[],colors:new Set(),heads:new Set()};
  if(!row.pets.some(p=>p.name===profile.name))
   row.pets.push({name:profile.name,key:profile.key,color:sprite.color});
  row.colors.add(sprite.color);
  if(sprite.head)row.heads.add(sprite.head);
  styles.set(sprite.style,row);
 }
 return new Map([...styles].sort((a,b)=>a[0]-b[0]));
}

/** 风格号 → 导出目标（含展示名、共用这套图的宠物名单、头像号）。 */
export function styleTargets(catalog,styleNumbers){
 const index=styleIndex(catalog);
 return styleNumbers.map(style=>{
  const row=index.get(style);
  if(!row)throw Error(`风格号 ${style} 在宠物目录里没有任何宠物（可用 --list 看清单）。`);
  const main=[...row.colors].includes(0)
   ?(row.pets.find(p=>p.color===0)?.name??row.pets[0].name)
   :row.pets.find(p=>p.color===Math.min(...row.colors)).name;
  return {style,
   label:`${main}-style${String(style).padStart(2,'0')}`,
   title:row.pets.filter(p=>p.name===main||p.color!==0).map(p=>p.name).join(' / '),
   pets:row.pets,
   head:row.heads.size===1?[...row.heads][0]:null,
   world:PET_WORLD_BASE+style-1,
   battle:PET_BATTLE_BASE+style-1};
 });
}

function svgFor(target,part,frag,atlas,usage,png,rarity){
 const [w,h]=[png.w,png.h],scale=4,pad0=20,header=30;
 const rows=atlasRows(atlas)||[{id:0,x:0,y:0,w,h}];
 const used=new Set(usage.subs);
 const colors=['#e57373','#81c784','#64b5f6','#ffb74d','#ba68c8','#4db6ac','#f06292','#a1887f'];
 const parts=[];
 parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w*scale+pad0*2}" height="${h*scale+header+pad0}" viewBox="0 0 ${w*scale+pad0*2} ${h*scale+header+pad0}">`);
 parts.push(`<rect width="100%" height="100%" fill="#fafafa"/>`);
 parts.push(`<text x="10" y="18" font-family="sans-serif" font-size="13" fill="#333">${esc(target.title)}　${part}精灵 ${target[part==='世界'?'world':'battle']}　frag${frag}　画布 ${w}×${h}　图集 ${rows.length} 个部件　该贴图用到 ${usage.subs.length} 个（红框=要画）　被 ${rarity} 个 model 引用</text>`);
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
 if(!file)return null;
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
export function exportTemplates({rawRoot,outDir,targets,log=()=>{}}){
 const gd=JSON.parse(fs.readFileSync(path.join(rawRoot,'v/gd/305.json'),'utf8'));
 const fragTable=gd.url.assets.sprite.fragment,modelTable=gd.url.assets.sprite.model;
 fs.mkdirSync(outDir,{recursive:true});
 const refs=referenceCounts(modelTable,rawRoot);
 let sizeDoc=['# 宠物换皮 · 底模贴图尺寸清单','',
  '**每个目录 = 一个「风格号」，不是一只宠物。** 同一个风格号下的宠物共用同一套贴图，',
  '在游戏里靠 icon 里的**颜色位**（2 位，0~3）区分配色，所以它们的图是同一份，改一次全变。','',
  '宠物精灵的编号规则（客户端 `SpriteTool.getPetSpriteByIcon` / `ModelConst`）：','',
  '```',
  'style        = icon 低 6 位（1..63）',
  '世界/地图精灵 = 500 + style - 1',
  '战斗精灵      = 600 + style - 1',
  '颜色          = icon 的第 6~7 位（0..3）',
  '```','',
  '⚠ **世界精灵和战斗精灵是两套不同的 model**，实测 52 个风格里没有一对相同。',
  '只重画一套，地图上是你画的那只、一进战斗就变回原版。','',
  '你要画的图必须**整张尺寸像素级一致**（构建会挡住不符的）。',
  '',`文件名 = \`slot<槽位>_frag<贴图编号>_<宽>x<高>.png\`，**槽位就是精灵 json 里 files 数组的下标**`,
  '（写 reskin.json 的 `replace` 时填的就是它）。',''].join('\n');
 let layoutDoc=['# 宠物换皮 · 部件布局（重绘看这份）','',
  '**贴图不是「一只宠物」，而是一张拼装用的部件雪碧图。** 渲染时每帧按',
  '`[贴图下标, 部件号, x偏移, y偏移, flag]` 把若干部件拼成一只完整的宠物。',
  '所以换皮要画的是**这些部件**，而且每个部件必须待在下面标注的位置与尺寸上（差一个像素就错位）。','',
  '每张图配一张 `布局图-fragXXXX.svg`（浏览器打开）：**红框 = 这张图真正用到的部件，浅框 = 图里有但用不到，可以先不画。**',
  '没有 `layout-*.json` 的贴图说明它**没有图集**：整张图就是 1 个部件（sub 恒为 0），照整张画即可。',''].join('\n');

 const readme=[];
 for(const target of targets){
  const dir=path.join(outDir,target.label);
  const sections=[['世界',target.world],['战斗',target.battle],['头像',target.head]];
  const report=[];
  log('\n=== %s（style %d）世界 %d / 战斗 %d ===',target.title,target.style,target.world,target.battle);
  for(const [part,modelId] of sections){
   if(!modelId){report.push({part,modelId:null,rows:[]});continue;}
   const model=loadModel(rawRoot,modelTable,modelId);
   if(!model){
    report.push({part,modelId,rows:[],missing:true});
    log('  %s 精灵 %d 不在客户端资源里（跳过）',part,modelId);
    continue;
   }
   if(part==='头像'&&modelId===target.world){report.push({part,modelId,rows:[],sameAsWorld:true});log('  头像与世界观精灵同号（%d），不再重复导出',modelId);continue;}
   const into=path.join(dir,part);
   fs.mkdirSync(into,{recursive:true});
   // 清掉**上一版命名**留下的 `NN_fragNNNNN_WxH.png`：它和新命名会并存，
   // 混在一起谁也不知道该照哪份画。只删这个固定模式，别人的文件一律不碰。
   const legacy=/^\d{2,3}_frag\d+_\d+x\d+\.png$/;
   for(const name of fs.readdirSync(into))if(legacy.test(name))fs.unlinkSync(path.join(into,name));
   const rows=[];
   for(let slot=0;slot<model.files.length;slot++){
    const frag=model.files[slot],png=pngSizeOf(rawRoot,fragTable,frag);
    if(!png)throw Error(`${target.title} 的 ${part}精灵 ${modelId} 里 frag${frag} 找不到图片文件。`);
    const atlas=loadAtlas(rawRoot,fragTable,frag);
    const usage=textureUsage(model,slot);
    const refCount=refs.get(frag)||0;
    const base=`slot${slot}_frag${frag}_${png.w}x${png.h}`;
    fs.writeFileSync(path.join(into,base+'.png'),fs.readFileSync(png.file));
    if(atlas)fs.writeFileSync(path.join(into,`layout-frag${frag}.json`),JSON.stringify(atlas,null,2)+'\n');
    fs.writeFileSync(path.join(into,`布局图-frag${frag}.svg`),svgFor(target,part,frag,atlas,usage,png,refCount));
    rows.push({slot,frag,w:png.w,h:png.h,atlas,usage,refs:refCount,fileName:base+'.png',model:modelId});
    log('  %s 槽位 %d frag%s %dx%d（用到 %d 个部件，被 %d 个 model 引用）',part,slot,frag,png.w,png.h,usage.subs.length,refCount);
   }
   report.push({part,modelId,rows,poses:Object.keys(model.frames||{}).length,anis:model.anis||[]});
  }

  // 「要不要画」分三档：专属件必画；上百个 model 共用的小配件改了会连带改到别的宠物，
  // 默认不画；上千个共用的一定是阴影/光效，绝对别画。
  const verdict=r=>r.refs>=GENERIC_REFERENCE_LIMIT?`通用件（${r.refs} 个 model 共用）· **不用画**`
   :r.refs>=SHARED_REFERENCE_LIMIT?`半通用（${r.refs} 个 model 共用）· 一般别画`
   :`**要画**（${r.refs} 个 model 共用）`;
  // 同一张 frag 可能同时被世界与战斗引用 —— 画一张两边都能用，所以按 frag 去重后再报数。
  const byFrag=new Map();
  for(const s of report)for(const r of s.rows){
   if(r.refs>=SHARED_REFERENCE_LIMIT)continue;
   const cur=byFrag.get(r.frag)??{frag:r.frag,w:r.w,h:r.h,refs:r.refs,parts:new Set()};
   cur.parts.add(s.part);byFrag.set(r.frag,cur);
  }
  const bodyRows=[...byFrag.values()];
  const table=rows=>['| 槽位 | 编号 | 尺寸 | 要不要画 | 被几个 model 引用 |','|---|---|---|---|---|',
   ...rows.map(r=>`| ${r.slot} | frag${r.frag} | ${r.w}×${r.h} | ${verdict(r)} | ${r.refs} |`)].join('\n');
  const poseLine=s=>s.missing?'（客户端里没有这个号）':s.sameAsWorld?'（与世界精灵同一个号，见上）'
   :s.rows.length?`${s.rows.length} 张贴图，${s.poses} 个姿态（朝向）${s.anis.length?`，动作 ${s.anis.map(a=>`${a.id===0?'待机':a.id===2?'攻击':'动作'+a.id} ${a.gesture.length} 帧`).join('、')}`:''}`:'（没有精灵）';

  sizeDoc+=`\n## style${target.style} · ${target.title}\n\n`
   +`- 共用这套图的宠物：${target.pets.map(p=>`${p.name}（颜色 ${p.color}）`).join('、')}\n`
   +`- 世界/地图精灵 **${target.world}**：${poseLine(report[0])}\n`
   +`- 战斗精灵 **${target.battle}**：${poseLine(report[1])}\n`
   +`- 头像精灵 ${target.head??'（与世界精灵同号）'}：${poseLine(report[2])}\n`
   +`- 真正要动手画的：**${bodyRows.length} 张** —— ${bodyRows.length?bodyRows.map(r=>`frag${r.frag}（${r.w}×${r.h}，${[...r.parts].join('+')}）`).join('、'):'（没有）'}\n\n`
   +report.filter(s=>s.rows.length).map(s=>`${s.part}精灵 ${s.modelId}（放在 \`${s.part}/\`）\n\n${table(s.rows)}\n`).join('\n');

  layoutDoc+=`\n## style${target.style} · ${target.title}（世界 ${target.world} / 战斗 ${target.battle}）\n`;
  for(const s of report)for(const [i,r] of s.rows.entries()){
   const rows=atlasRows(r.atlas);
   layoutDoc+=`\n### ${s.part}精灵 ${r.model}　槽位 ${r.slot}　frag${r.frag}（${r.w}×${r.h}）${i===0?'　← 主体':''}\n\n`
    +`- 图集部件 **${rows?rows.length:1}** 个，这张贴图实际用到 **${r.usage.subs.length}** 个`
    +`（出现于 ${r.usage.poses} 个姿态，单姿态最多 ${r.usage.maxParts} 个）`
    +`｜被 ${r.refs} 个 model 引用${r.refs>=GENERIC_REFERENCE_LIMIT?'（通用件，别画）':r.refs>=SHARED_REFERENCE_LIMIT?'（半通用，一般别画）':''}\n`
    +`- 用到的部件号：\`${r.usage.subs.join(', ')||'0（无图集，整张即一个部件）'}\`\n`
    +`- 布局图：\`布局图-frag${r.frag}.svg\`（浏览器打开）\n`;
   if(rows)layoutDoc+=`\n| 部件 | x | y | 宽 | 高 | 用到 |\n|---|---|---|---|---|---|\n`
    +rows.map(row=>`| ${row.id} | ${row.x} | ${row.y} | ${row.w} | ${row.h} | ${r.usage.subs.includes(row.id)?'✔':'—'} |`).join('\n')+'\n';
   else layoutDoc+=`\n（没有图集：整张 ${r.w}×${r.h} 就是 1 个部件，sub 恒为 0。）\n`;
  }
  readme.push({target,report,drawCount:bodyRows.length});
 }

 fs.writeFileSync(path.join(outDir,'00-尺寸清单.md'),sizeDoc+'\n');
 fs.writeFileSync(path.join(outDir,'01-部件布局.md'),layoutDoc+'\n');
 fs.writeFileSync(path.join(outDir,'README.md'),readmeDoc(readme));
 return {outDir,sizeDoc,layoutDoc,targets:readme};
}

function readmeDoc(readme){
 const lines=['# 宠物换皮 · 底模参考包','',
  '这是给「自己画宠物贴图」用的**底稿 + 说明书**，不是游戏资源。配合仓库里的',
  '`tools/build-pet-reskin.mjs` 使用 —— 换皮只需要重画 1~5 张图，朝向、动作、攻击帧全部白送。','',
  '## 先搞清三个编号（这是最容易搞错的地方）','',
  '| 名字 | 例子 | 是什么 |','|---|---|---|',
  '| **风格号** style | 20 | 宠物外观的编号，来自宠物数据里 `icon` 的**低 6 位**（1~63） |',
  '| **世界精灵** | 500 + style − 1 | 地图上站着那只的 model 号（一个 model = 几张拼图贴图） |',
  '| **战斗精灵** | 600 + style − 1 | 战斗里那只的 model 号，**和世界精灵是两套不同的图** |',
  '| **颜色** color | 0~3 | `icon` 的第 6~7 位；引擎按它调色，**同一套贴图出四种配色** |','',
  '所以「一个目录 = 一个风格号」，同一目录下的宠物（红炎少女 / 魔法少女 / 虚无少女…）在游戏里',
  '长得基本一样，只是配色不同。','',
  '> ⚠ 宠物目录 `data/pet-catalog.json` 里的 `model` 字段**不是精灵号**，是模板号。',
  '> 用它去查 sprite/model 表会拿到毫不相干的精灵（实测 template 504 → 火焰元素、',
  '> 516 → 天空战神、708 → 骑马的骑士）。真正的入口只有 `icon`。参考包第一版就是踩了这个坑。','',
  '## 想要「人形」宠物：这几个风格号最合适','',
  '世界OL 的宠物里人形其实是**一小撮共用贴图**的：一个风格号下面的几只，游戏里只差配色。',
  '按「专属件要画几张」排序（张数越少越省事）：','',
  '| 风格号 | 目录/宠物 | 世界精灵 | 战斗精灵 | 专属件要画 | 长什么样 |','|---|---|---|---|---|---|',
  '| **style2** | 世界女仆 / 萌系女仆 / 朝比奈实玖琉 / 守护女仆 | 501 | 601 | **1 张** frag12005 112×61 | 粉发女仆，端盘子 |',
  '| **style12** | 可爱猫女 / 黑夜猫女 / 红艳猫女 | 511 | 611 | **1 张** frag12045 108×78 | 猫耳小女仆 |',
  '| **style20** | 魔法少女 / 红炎少女 / 虚无少女 | 519 | 619 | **1 张** frag12077 145×72 | 长裙少女（另带一只小精灵） |',
  '| style28 | 鬼神 / 恶鬼 / 大神 | 527 | 627 | 2 张 | 人形恶鬼 |',
  '| style30 | 女娲后裔 / 女娲化身 / 妙法蛇妖 | 529 | 629 | 2 张 | 人形女子 |',
  '| style31 | 青蛇 / 蛇妖 / 黑蛇守卫 | 530 | 630 | 2 张 | 人形蛇妖 |',
  '| style34 | 九尾狐 / 九尾狐妖 / 九尾灵狐 | 533 | 633 | 2 张 | 猫耳少女 + 一条大尾巴 |',
  '| style21 | 蒙面骑士 / 天空骑士 / 能天使 | 520 | 620 | 3 张 | 人形骑士 |',
  '| style16 | 罗贝尔特 / 狂暴女仆 / 战女仆 | 515 | 615 | 4 张 | 拿武器的女仆 |',
  '| style26 | 灯神 / 灯灵 | 525 | 625 | 4 张 | 半身灯神 |',
  '| style44 | 独角人马兽 | 543 | 643 | 5 张 | 人马（上半身人形） |',
  '| style7 | 仙灵 / 魔法仙灵 / 弓灵 | 506 | 606 | 2 张 | 小型飞行体，非人形参照 |','',
  '默认只导出前三个 + 34/31/21/16/7；想要表里其余的，用 `--styles 28,30,26,17,44` 单独导。','',
  '## 目录里几个文件是什么','',
  '| 文件 | 是什么 |','|---|---|',
  '| `slot<槽位>_frag<编号>_<宽>x<高>.png` | 底模原贴图。**槽位**就是精灵 json 里 `files` 数组的下标 |',
  '| `布局图-frag<编号>.svg` | 浏览器直接打开：格子 + 部件号 + 每格尺寸，**红框 = 这张图真正用到的部件** |',
  '| `layout-frag<编号>.json` | 上面那张图的原始数据（图集区域表），给工具用的 |',
  '| `世界/` | 地图上那只（500 号段） |',
  '| `战斗/` | 战斗里那只（600 号段）。**与世界是两套图，两边都要画** |',
  '| `头像/` | 宠物栏头像（`headIcon` 号）；与世界观精灵同号时不重复导出 |',
  '| `00-尺寸清单.md` | 每个风格有哪些贴图、多大、**哪几张真的需要画** |',
  '| `01-部件布局.md` | 每张贴图的部件表 + 哪些部件用得到（重绘时对着看） |','',
  '## 重绘怎么下手（四步）','',
  '1. **挑风格号**：看 `00-尺寸清单.md` 的「真正要动手画的」那一行。贴图里绝大多数是几千个 model',
  '   共用的通用件（阴影、光效），**不用画**。人形里最省事的是 style20（1 张）和 style2（1 张，世界战斗通用）。',
  '2. **打开布局图**：按**红框**画。浅框是图集里有、动画没用到的部件，可以留空 —— 但要保持透明、别改画布尺寸。',
  '3. **尺寸必须像素级一致**：整张画布与该贴图原图完全相同（差 1 像素，所有帧坐标就会错位）。',
  '   `build-pet-reskin.mjs --check` 会先验一遍，不符直接报错。',
  '4. **两套都要换**：`世界/` 与 `战斗/` 各来一份，尺寸分别按各自的原图。','',
  '## 做一只**全新**的自制宠物：挑个空风格号','',
  '风格号只有 6 位，客户端里已被 1~52 占用，**53~63 是空的**（模型表里没有对应资源）。',
  '自制宠物建议占一个空号，这样不会连带改到原有宠物；然后：','',
  '```',
  'data/local-pets.json   baseline.icon = 空号（想要别的配色再加颜色位，比如 空号 | (1 << 6)）',
  '                       baseline.headIcon = 与你画的世界精灵同号',
  '```','',
  '> 反过来，如果去重画**已有**风格号的图（比如 style2 萌系女仆），那一套图会被 4 只宠物一起用',
  '> （世界女仆 / 朝比奈实玖琉 / 萌系女仆 / 守护女仆），它们会同时变成你画的样子。',
  '> 只想改自己那只，就用空号。','',
  '## 每只风格的槽位速查','',
  '「要画几张」= 只算**专属件**（被个位数 model 引用）。被上百个 model 共用的叫「半通用」',
  '（几十上百只宠物共用的小配件），被上千个共用的一定是阴影/光效 —— 这两类改了会连带把别的',
  '宠物一起改掉，所以默认都不画，构建时原样保留。','',
  '| 风格 | 宠物 | 世界精灵 | 战斗精灵 | 要画几张 |','|---|---|---|---|---|'];
 for(const {target,report,drawCount} of readme){
  const fmt=s=>s.modelId?`${s.modelId}`:'—';
  lines.push(`| style${target.style} | ${target.title} | ${fmt(report[0])} | ${fmt(report[1])} | ${drawCount} 张 |`);
 }
 lines.push('','> 这份包由 `node tools/export-pet-reskin-templates.mjs` 生成，可以随时重跑；','> 仓库里的 `client/` 不入库，换机器后重跑即可重建。','');
 return lines.join('\n');
}

/** 只清掉**本工具自己产出**的目录：`xxx-styleNN` 与上一版的 `xxx-modelNNN`。 */
export function cleanOutput(outDir,log=()=>{}){
 if(!fs.existsSync(outDir))return [];
 const removed=[];
 for(const name of fs.readdirSync(outDir)){
  const full=path.join(outDir,name);
  if(!fs.statSync(full).isDirectory())continue;
  if(!/^(.*-style\d{2}|.*-model\d+)$/.test(name))continue;
  fs.rmSync(full,{recursive:true,force:true});
  removed.push(name);log('  清掉旧目录 %s',name);
 }
 return removed;
}

const isCli=process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url));
if(isCli){
 const root=fileURLToPath(new URL('..',import.meta.url));
 const rawRoot=path.join(root,'client');
 const argOf=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;};
 const outDir=argOf('--out')?path.resolve(argOf('--out')):DEFAULT_OUT;
 const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/pet-catalog.json'),'utf8'));
 const index=styleIndex(catalog);

 if(process.argv.includes('--list')){
  console.log('客户端里有精灵的风格号（可用 --styles 指定）：');
  for(const t of styleTargets(catalog,[...index.keys()]))
   console.log('  style%s → 世界 %d / 战斗 %d　%s',String(t.style).padStart(2,'0'),t.world,t.battle,t.title);
  console.log('\n空风格号（自制宠物可以用）：%s',freePetStyles(new Set(index.keys())).join(', '));
  process.exit(0);
 }

 const stylesArg=argOf('--styles');
 const wanted=process.argv.includes('--all')?[...index.keys()]
  :stylesArg?stylesArg.split(',').map(Number).filter(Number.isInteger)
  :DEFAULT_STYLES;
 const missing=wanted.filter(s=>!index.has(s));
 if(missing.length)console.log('[warn] 这些风格号没有宠物在用，已跳过：%s',missing.join(', '));
 const targets=styleTargets(catalog,wanted.filter(s=>index.has(s)));
 if(!targets.length){console.error('没有可导出的风格。');process.exit(1);}
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
 console.log('导出 %d 个风格 → %s',targets.length,outDir);
 if(process.argv.includes('--clean'))cleanOutput(outDir,console.log);
 const result=exportTemplates({rawRoot,outDir,targets,log:(...a)=>console.log(...a)});
 console.log('\n完成：%s',result.outDir);
}

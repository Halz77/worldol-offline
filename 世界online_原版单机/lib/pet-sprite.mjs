/**
 * 宠物精灵编号的**唯一来源**。
 *
 * 客户端 `SpriteTool.getPetSpriteByIcon(icon1)` 就是这么算的（`ModelConst` 给位域）：
 *
 *     style = icon1.low >> OFFSET_PET_STYLE(0) & LEN_PET_STYLE(6 位)     // 1..63
 *     世界/地图精灵 = SPR_INDEX_PET_WORLD_START(500) + style - 1
 *     战斗精灵     = SPR_INDEX_PET_BATTLE_START(600) + style - 1
 *     颜色         = icon1.low >> OFFSET_PET_COLOR(6) & LEN_PET_COLOR(2 位)  // 引擎按它调色
 *
 * 两个必须记住的结论：
 *   · 一个**风格号**对应一整套贴图，多只宠物共用，只差颜色位（红炎少女=色3、
 *     魔法少女=色0、虚无少女=色2，是同一套图）。
 *   · 世界精灵与战斗精灵是**两套不同的 model**（实测 52 个风格里 0 个相同）。
 *
 * ⚠ `data/pet-catalog.json` 里的 `baseline.model` **不是精灵号**，是模板号
 *   （480/504 条与 templateId 完全相同）。拿它查 sprite/model 表会得到一只毫不相干的
 *   宠物（实测 template 504 → 火焰元素、516 → 天空战神、708 → 骑马的骑士）。
 *   真正的入口只有 `baseline.icon`（抓包来的 icon1）。
 */
export const PET_WORLD_BASE=500;
export const PET_BATTLE_BASE=600;
export const PET_STYLE_MASK=0x3f;   // LEN_PET_STYLE = 6 位
export const PET_COLOR_SHIFT=6;
export const PET_COLOR_MASK=3;      // LEN_PET_COLOR = 2 位
export const PET_STYLE_MIN=1,PET_STYLE_MAX=63;

/**
 * 宠物目录里的一个 profile → 它真正用的精灵号。
 * 没有 icon（或 style=0）时返回 null —— **不要退回 model 字段**，那是模板号。
 * @returns {{style:number,color:number,world:number,battle:number,head:number|null}|null}
 */
export function petSpriteOf(profile){
 const icon=Number(profile?.baseline?.icon);
 if(!Number.isInteger(icon))return null;
 const style=icon&PET_STYLE_MASK;
 if(style<=0)return null;
 const head=Number(profile?.baseline?.headIcon);
 return {style,
  color:(icon>>PET_COLOR_SHIFT)&PET_COLOR_MASK,
  world:PET_WORLD_BASE+style-1,
  battle:PET_BATTLE_BASE+style-1,
  head:Number.isInteger(head)&&head>0?head:null};
}

/** icon1（低位）→ 风格号。 */
export const petStyleOf=icon=>{
 const n=Number(icon);
 return Number.isInteger(n)?(n&PET_STYLE_MASK):0;
};
/** icon1 → 颜色位（0..3，引擎按它调色）。 */
export const petColorOf=icon=>{
 const n=Number(icon);
 return Number.isInteger(n)?((n>>PET_COLOR_SHIFT)&PET_COLOR_MASK):0;
};
/** 风格号 + 颜色 → 写进 baseline.icon 的 icon1。 */
export const petIconOf=(style,color=0)=>(style&PET_STYLE_MASK)|((color&PET_COLOR_MASK)<<PET_COLOR_SHIFT);

/** 这个精灵号是不是「宠物世界观精灵」（500 号段）。 */
export const isPetWorldModel=id=>Number.isInteger(id)&&id>=PET_WORLD_BASE&&id<PET_WORLD_BASE+PET_STYLE_MAX;
/** 这个精灵号是不是「宠物战斗精灵」（600 号段）。 */
export const isPetBattleModel=id=>Number.isInteger(id)&&id>=PET_BATTLE_BASE&&id<PET_BATTLE_BASE+PET_STYLE_MAX;
/** 世界/战斗精灵号 → 风格号（不在号段里返回 0）。 */
export const petStyleOfWorldModel=id=>isPetWorldModel(id)?id-PET_WORLD_BASE+1:0;
export const petStyleOfBattleModel=id=>isPetBattleModel(id)?id-PET_BATTLE_BASE+1:0;
/** 世界号段里，客户端**还没有**精灵的号 —— 自制宠物的首选（不会连带改到原有宠物）。 */
export const freePetStyles=used=>{
 const taken=used instanceof Set?used:new Set(used||[]);
 const out=[];
 for(let style=PET_STYLE_MIN;style<=PET_STYLE_MAX;style++)if(!taken.has(style))out.push(style);
 return out;
};

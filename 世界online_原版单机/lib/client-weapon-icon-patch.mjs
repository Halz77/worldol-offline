export const weaponIconRevision='weapon-icon-v2';

// MOD(weapon-icon)：角色模型上的武器贴图 —— Player.updateIcon 往 icon2 写
// LWEAPON_*（左手槽 WEAPON_LEFT_POS=8）与 RWEAPON_*（右手槽 WEAPON_RIGHT_POS=10）。
//
// 角色贴图是「躯体模型 + 零件碎片」两层，两层都只认 icon2：
//   · 躯体模型（assets/sprite/model/{nameID}.json，决定手臂姿势和每个零件的偏移）
//     = SpriteTool.getSpriteIdByIcon(icon1, icon2, icon3)
//     → getSpriteNameIDByWeapon(基础体, 左武器style, 右武器style, 双持标志, 战斗标志)
//       左/右 style 先按 (style-1)>>4 换算成「武器类型组」，再映射成 113(单手剑)/136(双手锤)…
//       注意最后是 `var l=r;0!=s&&(l=s)` —— 右手武器会**盖掉**左手，躯体姿势以右手为准。
//   · 武器零件碎片 = getWeaponIcon(左 style, color)，右手在双持模型里才是第二个零件槽。
// 也就是说：**只要两把武器的类型组不同，躯体姿势会按右手摆、武器贴图却按左手画** ——
// 于是贴图跟手臂对不上（飘在身后），而右手的武器贴图也会一起画出来。
//
// 本补丁做两件事：
//
// 1) 两处武器判定都补上幻化解算（原版只有时装/坐骑有，武器没有）：
//    时装与坐骑的写法是 `if(x.illusionItemId){var y=this.getIllusionItem(x.illusionItemId,x);y&&(x=y)}`，
//    武器这里照同一套补，幻化后的外观才算进 icon2。
//
// 2) 右手槽的武器判定加「显示守卫」，让左手槽说话（★ v2 修正：守卫必须挂在最终条件上，
//    v1 把它当逗号表达式里的一个中间语句，结果被丢弃、守卫等于没生效）：
//    只有满足下列条件才把右手武器写进 icon2，否则右手位不参与渲染：
//      · 左槽没有可显示武器（空槽 / 盾类 icon=0）→ 允许（只有右手持械的玩家照常显示）；
//      · 左右「解算幻化后的类型组」相同，且两边都不是双手类型 → 允许（双剑/双刀等原样保留）；
//      · 其余（两把不同类型武器）→ 拒绝，只画左手，躯体姿势也按左手摆。
//    「双手类型」集合与 Bag.isTwoHandWeaponType 一致（内联数字，不依赖 bag 上该方法是否可见）：
//    14 双手剑 / 16 双手刀 / 18 双手重武 / 19 双手法杖 / 20 双手长枪 / 22 双手弩 / 23 双手弓 /
//    34 法术球 / 36 双手火枪 / 38 双手锤 / 39 双手扇。
//    类型组与客户端 getSpriteNameIDByWeapon 的换算保持一致：13~23、34~39 用自身，
//    24(盾/护手) 与其它一律视作「无武器姿势 0」。
export function patchWeaponIcon(source){
  const lpos='s["default"].WEAPON_LEFT_POS';
  const rpos='s["default"].WEAPON_RIGHT_POS';
  // 幻化替换片段：借用已声明的 t，不引入新变量
  const ill='null!=e&&e.illusionItemId&&null!=(t=this.getIllusionItem(e.illusionItemId,e))&&(e=t),';

  // 右手显示守卫（★ 必须作为最终条件的一部分，不能只当中间语句）
  const guard='(function(p,b,R){'
    +'var L=b.getItem('+lpos+');'
    +'var E=function(x){if(!x)return null;if(x.illusionItemId){var y=p.getIllusionItem(x.illusionItemId,x);if(y)return y}return x};'
    +'var G=function(x){if(!x||!(x.icon>0))return 0;var t=x.type;return (t>=13&&t<=23)||(t>=34&&t<=39)?t:0};'
    +'var T=function(x){if(!x)return 0;var t=x.type;return (t==14||t==16||t==18||t==19||t==20||t==22||t==23||t==34||t==36||t==38||t==39)?1:0};'
    +'if(!R)return 0;'
    +'var le=E(L),re=E(R),lg=G(le),rg=G(re);'
    +'return !lg?1:(lg==rg&&!T(le)&&!T(re)?1:0)'
    +'})(this,this.bag,e)&&';

  const leftFrom=',e=this.bag.getItem('+lpos+'),null!=e&&e.icon>0&&(t=e.icon>3e4?e.icon-_.ModelConst.START_WEAPON_ADD1:e.icon-_.ModelConst.START_WEAPON,t>0)){';
  const leftTo=',e=this.bag.getItem('+lpos+'),'+ill+'null!=e&&e.icon>0&&(t=e.icon>3e4?e.icon-_.ModelConst.START_WEAPON_ADD1:e.icon-_.ModelConst.START_WEAPON,t>0)){';

  const rightFrom=',e=this.bag.getItem('+rpos+'),null!=e&&e.icon>0&&(t=e.icon>3e4?e.icon-_.ModelConst.START_WEAPON_ADD1:e.icon-_.ModelConst.START_WEAPON,t>0)){';
  const rightTo=',e=this.bag.getItem('+rpos+'),'+ill+guard+'null!=e&&e.icon>0&&(t=e.icon>3e4?e.icon-_.ModelConst.START_WEAPON_ADD1:e.icon-_.ModelConst.START_WEAPON,t>0)){';

  let out=source;
  for(const [from,to] of [[leftFrom,leftTo],[rightFrom,rightTo]]){
    const hits=out.split(from).length-1;
    if(hits===1){out=out.replace(from,to);continue;}
    if(hits===0&&out.includes(to))continue;   // 已打过：幂等
    throw Error('v305 weapon icon patch mismatch ('+hits+'): '+from.slice(0,70));
  }
  return out;
}

export const weaponSlotRevision='weapon-slots-any-v1';

// MOD(weapon-slots-any)：解除武器槽的双手 / 同类限制。
//
// v305 的 EquipItem（module 0033）在装备武器时先做一次判定：
//
//   if (0==r && 1==isValidWeaponPos(i[0]) &&
//       (this.isSameWeaponType(o.type)<0 || 1==this.isTwoHandWeaponType(o.type)))
//     return this.equipWeapon(o.slotPos);
//
// isSameWeaponType()<0 表示「要和已装备的武器类型不一致」，1==isTwoHandWeaponType()
// 表示「这是双手武器」。两者任一成立就整体走 equipWeapon()：先把左右两个武器槽
// 里的东西全挪回背包，新武器只能落到左手。结果是双手武器永远只能装备一把，
// 不同类型的武器也没法各占一个槽。
//
// 现在把这个分支堵掉（条件恒假），装武器就只剩下面那个循环：
// 有空的武器槽就放进去，两个槽都满才与左手交换。于是两把双手武器、
// 或任意两种不同类型的武器都能同时装上，人物面板的两个武器槽都可用。
//
// 服务端 lib/restoration.mjs 的 equipWeaponItem() 有同款分支，必须一起改，
// 否则客户端装上了、服务端不认（或反过来）。
export function patchWeaponSlots(source){
  const from=',0==r&&1==e.isValidWeaponPos(i[0])&&(this.isSameWeaponType(o.type)<0||1==this.isTwoHandWeaponType(o.type)))return this.equipWeapon(o.slotPos);';
  const to=',0==r&&1==e.isValidWeaponPos(i[0])&&(!1))return this.equipWeapon(o.slotPos);';
  if(source.includes(to))return source;            // 已经是改后形态（幂等）
  if(source.split(from).length!==2)throw Error('v305 weapon slot patch mismatch');
  return source.replace(from,to);
}

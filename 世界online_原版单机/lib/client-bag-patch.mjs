export const clientBagRevision='bulk-use-all-items-v2';

// Keep the native quantity picker and item eligibility. Remove the VIP gates
// for one-key use, and open the "use any amount" menu to every usable item so
// that no item is limited to one-at-a-time any more.
export function patchBulkItemUse(source){
 const rules=[
  ['var p=_["default"].myPlayer.getVipLevel2();p>7&&e.quantity>1&&_["default"].isVip(_["default"].myPlayer)&&P.Tool.addChoiceMenu(r,v.GameText2.STR_USE_BY_ONE_KEY',
   'e.quantity>1&&P.Tool.addChoiceMenu(r,v.GameText2.STR_USE_BY_ONE_KEY'],
  ['t.prototype.isOneKey=function(e){return e.quantity>1&&p["default"].myPlayer.getVipLevel2()>7&&!p["default"].isVipOverDue(p["default"].myPlayer)}',
   't.prototype.isOneKey=function(e){return e.quantity>1}'],
  // The archived pet shortcut only logs a message; use the working native
  // quantity dialog with the same item/pet callback arguments.
  ['_.UseByOneKey.creatInputNumUI(o["default"].alloc(p["default"],p["default"].onOneKeyUseItem,[e,a.item,a.myPet,t]))',
   '_["default"].showOperateItem(e,"一键使用",o["default"].alloc(p["default"],p["default"].onOneKeyUseItem,[e,a.item,a.myPet,t]))'],
  // 「任意使用」（原生就是"选数量再使用"，最终发同一个 12001，只是带上数量）
  // 原来要求 VIP 且物品 power1 落在 _byOneUseListPower 白名单里，所以药品
  // (power1 49~52) 根本没有这个入口，只能一次一个。改成：只要是"可使用"的
  // 物品（isCanUse(1) 即 CAN_USE_WORLD，放行 27/28/31 等使用类，材料/宝石/
  // 任务品仍被排除）或"对宠物可用"，且数量>1，就给出「任意使用」。
  // 已经走「一键使用」的宠物/人物经验卷、国家指令书不重复给入口。
  ['_["default"].isVip(_["default"].myPlayer)&&(this._byOneUseListPower.indexOf(i.power1)>=0&&i.quantity>1&&P.Tool.addChoiceMenu(e,v.GameText2.STR_SELL_BY_ONE_USE,t,m.UIDefine.EVENT_ALL_ITEM_SELL_BY_ONE_USE)',
   '(i.quantity>1&&!i.isCanUseByOneKeyItem()&&(1==i.isCanUse(1)||i.isPetCanUseItem())&&P.Tool.addChoiceMenu(e,v.GameText2.STR_SELL_BY_ONE_USE,t,m.UIDefine.EVENT_ALL_ITEM_SELL_BY_ONE_USE)']
 ];
 for(const [from,to] of rules){
  if(source.split(from).length!==2)throw Error('v305 bulk item use patch mismatch: '+from);
  source=source.replace(from,to);
 }
 return source;
}

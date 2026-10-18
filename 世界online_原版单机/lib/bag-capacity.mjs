// 背包容量（bagLimit）。
//
// 客户端把槽位分成三段（analysis/modules/0033.js 的原版常量）：
//   EQUIP_POS_END = 30                 装备槽 0..29
//   BAG_START     = 30                 背包槽 30 .. 30+bagSize-1
//   STORE_START   = 630                仓库从 630 开始
// 所以背包的物理上限是 630-30 = 600 格，再往上就会踩进仓库的槽位。
// 本地版把新角色/老存档的容量直接给到 300（INITIAL_BAG_CAPACITY），
// 「背包扩展卷」这类道具（ITEM_ID_ADD_BAG_SIZE=288）每颗 +10 格。
//
// ⚠ INITIAL_BAG_CAPACITY 是**初始值/补发值**，不是上限；上限一律用
// MAX_BAG_CAPACITY —— 以前 bagCapacity() 拿 INITIAL_BAG_CAPACITY 当 Math.min 的
// 上限，所以 +10 的道具永远只提示「背包容量已增加」而实际格子没变（第 73 版修）。
export const INITIAL_BAG_CAPACITY=300;
export const BAG_EXPAND_STEP=10;
export const MAX_BAG_CAPACITY=600;

// 扩容：每颗 +BAG_EXPAND_STEP 格，到顶就抛错（让客户端提示，而不是白吃道具）。
// 只改 bagLimit 一个字段，不动背包里的槽位。
export function expandBagCapacity(p,step=BAG_EXPAND_STEP){
 if(!Number.isInteger(step)||step<1)throw Error('背包扩展数量无效。');
 const before=Math.max(1,p.bagLimit||24),after=Math.min(MAX_BAG_CAPACITY,before+step);
 if(after<=before)throw Error(`背包容量已经是上限（${MAX_BAG_CAPACITY} 格）。`);
 p.bagLimit=after;
 return {before,after};
}

// Upgrade old save files on load. Only the capacity field is changed; keep
// inventory positions, account data, progression, and unknown fields intact.
export function expandSavedBags(data){
 const changes=[];
 for(const p of data.characters){
  if(Number.isInteger(p.bagLimit)&&p.bagLimit>=INITIAL_BAG_CAPACITY)continue;
  changes.push({role:p.id,before:p.bagLimit??24,after:INITIAL_BAG_CAPACITY});
  p.bagLimit=INITIAL_BAG_CAPACITY;
 }
 return changes;
}

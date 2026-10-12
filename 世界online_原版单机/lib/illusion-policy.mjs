import {itemSlots} from './official-data.mjs';

/**
 * 装备幻化的**唯一合法判定**。
 *
 * 原版只允许「同 type」互幻（大刀只能幻化成刀），我们在 lib/client-illusion-patch.mjs 里
 * 有意放开了：**只要共用装备槽位就能幻化**。所有武器共用槽位 [8,10]，所以剑/刀/法杖/枪/
 * 弓/盾… 之间可以互相幻化；装甲各自独占槽位，行为与原版一致。
 *
 * 这条规则以前写了两份 —— 幻化服务用「同槽位」，而下发物品包时用「同 type」，于是
 * 跨类型幻化能存进存档、却在下发时抛错。那个错发生在**进入世界的整包**里
 * （enterWorld → worldData → bagPacket → itemPacket），整包发不出去，
 * 玩家选这个角色进游戏就**卡在黑屏**，其他没跨类型幻化的角色正常（第 43 版修）。
 *
 * 所以此后：判「能不能幻化」只准调用这里的函数，两处都必须 import 它。
 */
export const shareSlot=(a,b)=>a.some(slot=>b.includes(slot));

/** 两个装备 type 是否共用至少一个装备槽位。未知 type 返回 false。 */
export function shareEquipSlot(typeA,typeB){
 const a=itemSlots(typeA),b=itemSlots(typeB);
 return a.length>0&&b.length>0&&shareSlot(a,b);
}

/**
 * 这条外观现在还能不能被 selfType 幻化成？可以返回 null，否则返回一句原因。
 *
 * 两个使用方，判定必须一致：
 *   · 幻化服务（lib/illusion-service.mjs）—— 拒绝时给玩家看；
 *   · 下发物品包（lib/restoration-packets.mjs）—— 不合法就**降级按本体下发**。
 */
export function illusionBlockReason(appearance,selfType){
 if(!appearance)return '不在装备表里';
 if(!appearance.native)return '不是原版装备';
 // 下发时 exportEquipment 要把完整外观内嵌进物品包，缺它整包构建会失败。
 if(!appearance.definitionBase64)return '缺少独立物品定义';
 if(!shareEquipSlot(appearance.type,selfType))return `type ${appearance.type} 与装备 type ${selfType} 不共用装备槽位`;
 return null;
}

/**
 * 下发物品包时遇到「用不了」的幻化记录，就记在这里、并**按本体下发**。
 *
 * 为什么是降级而不是抛错：itemPacket 在进入世界的整包里
 * （enterWorld → worldData → bagPacket）被调用，抛一个错就等于整包发不出去，
 * 玩家选这个角色**永远卡在黑屏**、只能删号 —— 代价远大于「幻化外观不显示」。
 * 历史存档里可能存着早期判定放进去的记录，这里兜住它们。
 */
const fallbacks=[];
export function noteIllusionFallback(info){
 fallbacks.push(info);
 if(fallbacks.length>50)fallbacks.shift();
}
export function illusionFallbacks(){return fallbacks.slice();}
export function clearIllusionFallbacks(){fallbacks.length=0;}

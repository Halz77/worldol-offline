/*
 * 运行时全局变量
 *
 * 这几块在原版里是 server.mjs 用 HTTP 动态生成的（/equipment-rules.js、
 * /equipment-composition-data.js、/pet-snapshot-data.js）。standalone 没有 HTTP，
 * 改成在这里直接把同样的全局变量铺好。
 */
import { upgradeRules, upgradeIdentifyItemIds } from '../../世界online_原版单机/lib/item-affixes.mjs';
import { spiritRules } from '../../世界online_原版单机/lib/spirit-seal-data.mjs';
import { starLimit } from '../../世界online_原版单机/lib/equipment-policy.mjs';
import { setData, VIP_MAX } from '../../世界online_原版单机/lib/equipment-sets.mjs';
import { petSnapshotDirectory } from '../../世界online_原版单机/lib/pet-snapshot-vitals.mjs';

// 对应 server.mjs 里的 /equipment-rules.js
export const equipmentRules = {
  ...upgradeRules,
  advanced: { ...upgradeRules.advanced, identifyItemIds: upgradeIdentifyItemIds },
  spirit: spiritRules
};

// 对应 /equipment-rules.js 里的 window.worldolStarLimit
export { starLimit };

// 对应 /equipment-composition-data.js
export const compositionData = {
  vipMax: VIP_MAX,
  sets: setData.sets.map(({ id, bonuses }) => ({ id, bonuses }))
};

// 对应 /pet-snapshot-data.js
export { petSnapshotDirectory };

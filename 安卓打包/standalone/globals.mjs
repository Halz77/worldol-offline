/*
 * 运行时全局变量
 *
 * 这几块在原版里是 server.mjs 用 HTTP 动态生成的（/equipment-rules.js、
 * /equipment-composition-data.js、/pet-snapshot-data.js）。standalone 没有 HTTP，
 * 改成在这里直接把同样的全局变量铺好。
 *
 * **这几个对象本身从 lib/generated-globals.mjs 取，不要在这里抄表达式** ——
 * 第 37 版两处各写一份、只改了服务端那份，结果包进 APK 后客户端拿到的
 * identifyItemIds 是个函数，`new Set()` 抛 "function is not iterable"，单机菜单整个
 * 加载不出来。要改就改 lib/generated-globals.mjs 那一份，两个投放口一起生效。
 */
import { equipmentRulesGlobals, compositionGlobals } from '../../世界online_原版单机/lib/generated-globals.mjs';
import { starLimit } from '../../世界online_原版单机/lib/equipment-policy.mjs';
import { petSnapshotDirectory } from '../../世界online_原版单机/lib/pet-snapshot-vitals.mjs';

// 对应 server.mjs 里的 /equipment-rules.js
export const equipmentRules = equipmentRulesGlobals();

// 对应 /equipment-rules.js 里的 window.worldolStarLimit
export { starLimit };

// 对应 /equipment-composition-data.js
export const compositionData = compositionGlobals();

// 对应 /pet-snapshot-data.js
export { petSnapshotDirectory };

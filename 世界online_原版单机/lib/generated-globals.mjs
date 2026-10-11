/**
 * 「动态生成的客户端全局变量」的唯一来源。
 *
 * 有三个 `<script>` 原本由服务端按请求现算（/equipment-rules.js、
 * /equipment-composition-data.js、/pet-snapshot-data.js），它们有**两个投放口**：
 *
 *   · 服务端路径 —— `lib/http-routes.mjs` 里把对象 JSON.stringify 进脚本正文；
 *   · 安卓包（standalone 没有 HTTP）—— `安卓打包/standalone/globals.mjs` 在 entry 里
 *     直接把同样的对象铺成全局变量。
 *
 * 以前两处各抄一遍同样的表达式，于是**改一处漏一处**：第 37 版把
 * `upgradeIdentifyItemIds` 从数组常量改成函数（为了能惰性加载鉴定表）时只改了服务端那份，
 * 包里那份还是 `identifyItemIds: upgradeIdentifyItemIds`（函数本身），客户端
 * `new Set(rules.advanced.identifyItemIds)` 直接抛
 * `function is not iterable (cannot read property Symbol(Symbol.iterator))` ——
 * 整个单机菜单加载不出来，只能放出第 38 版重打包。
 *
 * 所以这份文件只留一份实现：要这几个对象都从这儿取，别再抄表达式。
 * `tests/generated-globals.test.mjs` 会把两个投放口的产物对一遍，并断言它们都是纯数据
 * （不含函数 —— 函数进了 JSON.stringify 会被静默丢掉，两条路给的形状就不一样了）。
 */
import {upgradeRules,upgradeIdentifyItemIds} from './item-affixes.mjs';
import {spiritRules} from './spirit-seal-data.mjs';
import {setData,VIP_MAX} from './equipment-sets.mjs';

/**
 * 对应 `window.worldolEquipmentRules`。
 *
 * 是函数不是常量：`identifyItemIds` 要遍历鉴定表（惰性加载），模块加载期不该把它拉起来。
 */
export const equipmentRulesGlobals=()=>({...upgradeRules,advanced:{...upgradeRules.advanced,identifyItemIds:upgradeIdentifyItemIds()},spirit:spiritRules});

/** 对应 `window.worldolCompositionData`。 */
export const compositionGlobals=()=>({vipMax:VIP_MAX,sets:setData.sets.map(({id,bonuses})=>({id,bonuses}))});

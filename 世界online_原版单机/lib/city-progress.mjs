/**
 * 城市升级任务（3002—3005）的「完成」判定 —— 从城市等级反推。
 *
 * ## 为什么需要
 * 本工程的任务完成判定是「`quests.completed` 里有这个 id」，而
 * `lib/daily-activity.mjs` 的 `ensureDaily()` 跨天会把**非新手任务**从 `completed`
 * 里清掉（这是刻意的：跨天重开天然成立，见 lib/replayable-chains.mjs 的说明）。
 * 3002—3005 的 `setting`（288 / 800）里没有每日位，所以它们会被一起清掉，
 * 而城市等级 `p.city.level` 是**存档里的持久字段**，留着不动 —— 于是：
 *   1. 城市里的任务板 / 市长又把「升级到 N 级城市」摆出来，玩家接了就卡死：
 *      `lib/city-state.mjs` 的 `applyCityMission()` 会以
 *      「城市等级已变化，请重新查看任务。」拒绝交付，任务也退不掉；
 *   2. 任何「前置是升级到 N 级城市」（acceptCondition type 9）的任务重新变成不可接。
 *
 * 城市等级本身就是这四个任务完成的证据，所以直接从等级推导完成状态：
 * 等级 ≥ 2 就认为 3002 完成、≥ 3 认为 3003 完成，依此类推。
 *
 * 与「幻想世界OL 2.0 新版」的 `lib/city-progress.mjs` 同一口径（`level >= id-3000`）。
 *
 * 刻意**不** import `city-state.mjs`：那个模块 import 了 `official-data.mjs`，
 * 而 daily-activity / official-rules 这条链已经在 import official-data，
 * 绕过去会形成循环。等级默认值 1 与 `cityState()` 的默认值保持一致。
 */
export const cityUpgradeIds=[3002,3003,3004,3005];

/** 城市升级任务：只要城市等级到了，就算完成任务（与是否还留着完成记录无关）。 */
export const cityUpgradeDone=(p,id)=>!!p.cityUnlocked&&cityUpgradeIds.includes(Number(id))&&(p.city?.level||1)>=Number(id)-3000;

/** 当前城市等级已经证明完成的那几个升级任务。 */
export const completedCityUpgrades=p=>cityUpgradeIds.filter(id=>cityUpgradeDone(p,id));

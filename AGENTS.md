# 世界OL 单机版 — 项目指引（AGENTS.md）

给《世界OL》（原版 H5 客户端 v305）做的**离线单机服务端 + 客户端补丁 + 安卓打包**工程。
服务端用 Node.js 复刻原版二进制协议，让原版客户端连本机端口离线玩；客户端表现通过
「字符串替换补丁」在运行时（电脑版）或构建期（APK）注入；最后用 Capacitor 出 APK。

> 本文件是**项目记忆的活文档**，由旧工具 `.workbuddy/memory/MEMORY.md` 迁移而来。
> 详细开发日志见 `docs/memory/`（INDEX.md 有索引）。逐版改动流水见 `修复记录.txt`。
> 面向「不开 AI 也能自己改」的完整手册见 `改BUG与重新打包APK指南.md`。

---

## 仓库与目录

根目录：`世界OL_源码/`（git 仓库，分支 `main`）。

| 路径 | 说明 |
| --- | --- |
| `世界online_原版单机/` | ★ 源码主目录。`server.mjs` + `lib/`（~150 模块）+ `web/` + `data/` + `tests/` + `tools/` |
| `世界online_原版单机/client/` | 原版 H5 客户端（148MB，**只读**，不入库；补丁在内存里打，不落盘） |
| `世界online_原版单机/analysis/` | 由 client 反编译得到（15MB，不入库）。`gd.decoded.js` 是引导补丁锚点来源 |
| `安卓打包/` | Capacitor 打包管线：`standalone/build.mjs`（生成站点）→ `构建APK.ps1` → APK |
| `docs/memory/` | 开发日志（本项目记忆的详细版） |
| `修复记录.txt` | 逐版改动流水（5655+ 行，CRLF 无 BOM） |
| `.scratch/` | **已删除**（用户 2026-10-18 清空）。历史报告看 `docs/`（如 `对比报告-幻想世界OL2.0新版.md`、`改BUG与重新打包APK指南.md`） |

**不入库**：`client/` `analysis/` `node_modules/` `saves|logs|backups|runtime/` `安卓打包/app/www/` `.scratch/`。

---

## 常用命令

在 `世界online_原版单机/` 下：

- `npm test` —— 主测试（pretest 先跑语法基线）。判定标准：**新增失败必须为 0**，
  不比 pass/fail 绝对数（不同机器会漂，要「同一批改动前后逐条比对」）。
- `npm run check` —— 语法检查。
- 测试可直接读 `analysis/modules/00XX.js`（不入库，缺失整文件 skip）：
  `vm.runInNewContext`(模块工厂) + 桩 require 拿真常量；
  `acorn + acorn-walk` 抽函数体配桩对象跑真逻辑
  （见 `tests/game.test.mjs` 的 nativeParser、`tests/battle-power-rules.test.mjs`）。
- 电脑版启动：双击 `启动单机.cmd`（8775）/ `继续测试角色.cmd`（8776）/ `停止单机.cmd`。
- **打包统一用 `安卓打包/一键打包.bat`**（双击即用；四步：环境自检 → `node standalone/build.mjs`
  → `构建APK.ps1` → 归档 `output/worldol-<时间戳>.apk`，留最近 5 个）。
  参数 `release` / `fresh` / `noopen` / `nopause`。
  ⚠ 终端用管道调它时 `$LASTEXITCODE` 会失真报 failed，以脚本自打印的「四步全部成功，退出 0」
  和 `output/` 里的 APK 为准。

---

## 三条铁律（核心机制）

1. **`lib/` 是唯一一份源码**，电脑版与 APK 都从它取 → 只改一遍。
   - 电脑版：服务端**运行时**把补丁打到客户端；APK 版：构建时把同一批补丁写进站点。
2. **不要直接改 `client/js/ff/fff570bb….js`**（压缩产线包，构建时会被重新平铺覆盖）。
   改客户端要写补丁：`lib/client-*-patch.mjs`（字符串替换）。
3. **新增客户端补丁必须两边都挂，顺序一致**：
   - `server.mjs`（运行时，补丁链最外层）+ `/api/status` 加 revision；
   - `安卓打包/standalone/build.mjs`（构建期）。
   - 补丁锚点不匹配会**直接抛错**（故意的）：`if(source.split(from).length!==2)throw Error('… mismatch')`。

---

## 单一来源 / 数据契约

- 补丁链 `client-patch-chain.mjs`、动态全局量 `generated-globals.mjs`（**都有两个投放口，改一处必崩**）。
- `data/*.json` 是抓包产物，**一字节不改**；`career-skills.json` 是上游验收契约
  （`tests/career-skills.test.mjs` 断言恰好 470 个技能、每个 1–22 级）。
- 改技能效果走 `data/local-skill-overrides.json` + `lib/local-skill-overrides.mjs`
  （`restoration.mjs` 的 `ensure()` 套用，覆盖后重算 powers 与 wireBase64）。
  支持 `perLevel`（优先于 set）+ 白名单 `OVERRIDABLE_FIELDS`。
- **装备技能与人技能共用 skill id**（513 个装备技能有 301 个与 career-skills 重叠）→ 一条规则两边生效。
  装备路径定义来自 `nativeEquipmentSkill(item)` 与叠加等级池（不在 skills 表）→
  `restoration.mjs` 的 `activeSkills()` 拼完 definitions 后要再套 `applyOverrideToDefinitions`，
  `learned()` 的 importedSkillDefinitions 也套一次。
- **怪物技能定义在 `official.skills`**（不在 restoration 的 skills 表），战斗包发
  `monsterWireBase64||wireBase64` → 覆盖生效要改两处：official-data ensure() 套整表 +
  `rebuildLevel()` 同时重算 monsterWireBase64（只改 wireBase64 怪物仍放旧效果）。

---

## 通用坑（反复踩）

- **`x||1` 不能用来判断"是否为零"**：`0` 被默认值吃掉。典型事故
  `filter(i=>(i.quantity||1)!==0)` 恒真 → 背包留 `quantity=0` 幽灵道具。正确：`i.quantity!==0`。
  （全库唯一一处已在 `planGemReplace` 修掉，见 2026-10-17 日志）
- **查询类接口不许改角色**：快照/只读路径必须走纯读函数，否则"打开面板"就把存档写脏。
  永泽塔用 `towerCountsReadonly`，无限试炼用 `readTrialState`（`trialState` 只给写入路径）。
  守卫：`assert.deepEqual(p,before)`（tests/home-features.test.mjs、trial-challenge.test.mjs）。
- **`INITIAL_*`「初始值」常量不要当上限用**（第 73 版）：`bagCapacity` 原来写
  `Math.min(INITIAL_BAG_CAPACITY, …)` → 「10格背包扩展」这类**扩容道具**就算服务端把 `bagLimit`
  加上去了也读不出来（表现是「提示了但格子没多」，一切看起来正常）。
  现在 `lib/bag-capacity.mjs` 分成 `INITIAL_BAG_CAPACITY(300)`（新角色/老存档补发的初值）、
  `BAG_EXPAND_STEP(10)`、`MAX_BAG_CAPACITY(600)`（客户端背包槽位是 30..629，
  再往上会踩 `STORE_START=630` 的仓库槽位）。
- **`itemPacket` 宁可降级绝不抛错**：`enterWorld→…→bagPacket→itemPacket`，一件抛错整包发不出 → 黑屏。
  「下架」只改名单，定义留着。
- **JSDoc 注释里别写 `*/` 字样**（如 `power*/powerValue*`）→ 块注释提前关掉 → SyntaxError。
- **跨 try/catch 用的变量必须在 try 之前声明**（否则 catch 里访问 ReferenceError）。
- **`planItemRewards` 碰到无定义道具会整包抛错** → 奖励表只引用有定义的道具；
  宝箱 1759/1760/1770 无定义，发放要跳过并记账。
- **「内存标记」与「存档字段」两份别各记一份**（第 72 版回归）：棋盘完成状态既是
  `context.solar.completed`（会话内存）又是 `p.quests.active[任务].solarBoard.completed`（存档）。
  我重写时把 `persist()` 改成读 `board.completed`，而唯一被赋值的是内存那个 → 存档里永远是 false →
  **重进游戏「赛程完成」丢失**（走到交付点被拦）。规矩：`persist()` 必须把两边一起写，
  重启后以存档字段为准恢复。
- **怪物 wire 的名字是「3 字节长度 + UTF-16BE」**，不是 `Reader.utf()`（2 字节 + UTF-8）：
  克隆怪（`cloneMonster`）只换头 4 字节 id 与名字，属性区逐字节保留；名字要逐字
  `writeUInt16BE`，写 `utf16le` 会乱码（见 lib/dungeon-challenge-data.mjs）。
- **「查看一件我没有的道具」这类接口的回包**（第 81 版）：客户端 `Tool.sendProtoAsync`
  （模块 0035）里有一张 `resultMsg` 名单（167 条协议），名单里的协议**回包必须以状态字节开头**
  —— 正数/0 继续，负数则把后面的字符串弹成提示。12016（`CG_ITEMTYPE_GETINFO`，图鉴点条目、
  首充预览、奖励格预览共用）在名单里，回包 = `byte(0)` + 道具定义 + `byte(套装组数)`；
  16051（`CG_HAND_BOOK_ITEM_INFO`，目录的定义就是采它）**不在**名单里，回包必须是纯定义。
  第 77 版把 12016 写成「定义 + 一个 0」→ 客户端把定义的第一个字节当状态字节读掉、
  从第二个字节开始解析 → `Truncated` 被 `getItemUseId` 的 catch 吞掉 → **界面毫无反应**
  （「点了没反应」和「不认识这个包」症状一样）。查客户端行为见「客户端要点」最后一条。

---

## 服务端要点

- `protocol-constants.mjs`（写 `P.<名>`）；本地裸号 90021/90022/32107/22106。
- `protocol-dispatch.mjs` INBOUND_CHAIN **22 段有序不重排**（第 63 版新增 solarChallenge）；
  拒绝回 false **且不许读字节**（读过要还原 `r.pos`）。
- `http-routes.mjs` 405 门位置承重；`lazy-data.mjs` **数组不能包代理**（数组型导出改函数）。
- 战斗 12501/12502：`context.battle` 被拒要搬 `rejectedBattle` **并清空**（否则 20+ 守卫锁死玩家）；
  报错点名哪一项；包尾 `locateTrailer()`；血蓝上限 `nativeVitalsCeiling()` 分级放宽
  （坑：nativeCharacterStats 对残缺角色静默返回 0）。
  宠物血蓝的校验上限走 `petVitalsCeiling()`（第 82 版）= 自研上限 ×(1+`PET_VITALS_TOLERANCE_PERCENT`(50)%)
  —— 第 80 版图鉴加成让客户端上限比服务端高 7.5%，那时每场都判「宠物战斗状态不完整」不发奖励；
  现在只有超出 1.5 倍才拒单，超出自研上限但在宽容内照常结算 + 记 `battle-pet-vitals-over-self`。
  ⚠ 放宽的只是**校验**，`petAttributes()`（宠物面板/宠物包/战后回满用的那个值）没变。
- **不在地图上的战斗组**（塔层、太阳棋盘、试炼）必须跳过 12501「请靠近战斗目标」距离校验，
  并强制走官方怪物表；下发世界数据前要确认组真存在（`worldData()` 收 towerExtraGroups +
  trialExtraGroups），残留标记会让整包写歪 → 客户端 `Error #1025`。
- **延迟注册顺序**：`official-data.mjs` `ensure()` 里建 officialGroups/officialMonsters Map，
  运行时再注册的进不了 Map → 必须注册在索引构建**之前**（push 后重建 Map）。
- **任务锚点 vs 怪刷新点**：怪组在同图常有多刷新点，任务锚点常是对话 NPC →
  开战判定应为「锚点近则用锚点，否则用当前可见可打的同组最近刷新点」。
- **城市升级任务（3002—3005）的完成状态从城市等级推导**（`lib/city-progress.mjs`，第 71 版）：
  `ensureDaily()` 跨天会把非新手任务从 `quests.completed` 里清掉，而 `p.city.level` 是持久字段 →
  只看完成记录的话，第二天升级任务会被重新摆出来，接了还卡死（`applyCityMission()` 报
  「城市等级已变化，请重新查看任务。」），所有「前置=升级到 N 级城市」的任务也会一起失效。
  挂了三处：`daily-activity.missionDone()`、跨天重置的 completed 过滤、`game-packets.missionBits()`。
  该模块刻意不 import `city-state.mjs`（会经 official-data 绕成循环）。
- **城市模板（`cityTemplate` 地图 1000/3090）的三处小修**在 `lib/city-template-fixes.mjs`：
  任务公告板补可见位（`status|1`，见「客户端要点」的状态位表）、市长扩建后对白、
  飞行驿站补【主城】【地区】【副本】【节日】60 条航线（落点取目标地图 `spawn`、无门槛）。
  调用点在 `official-data.ensure()` 里**所有补地图的补丁之后、建索引之前**（晚于 `applyOpenPortals`）；
  目的地缺项只告警跳过，不抛错 —— 这段在 `ensure()` 里跑，抛错等于服务起不来。
- **老存档没有城市 → 按需补发**（第 72 版）：`p.cityUnlocked` 只有跑完任务 42 才置上，
  GM 改过等级 / 正式服导出的存档没有这一位 → 10510（回城）与 10511—10515（城市面板）
  永远回「请先完成获得新的城市任务。」。修法 `city-state.unlockCity(p)`（等级 1 / 繁荣 0 / 军力 0，
  与做完 42 之后一致）：10510 在 `official-service`、10511—10515 在 `city-service`（面板首屏也补，
  否则玩家点「城市」永远报错）；已有城市不重复补发，只 `log('city-unlocked',…)` 不发公告。
- **棋盘玩法有三份 host**（第 72 版两份 + 第 83 版问剑十一峰，`lib/solar-challenge-service.mjs`）：
  太阳神殿（map 262，13 格，
  有 powers，`implicitMission`）与 BOSS 挑战赛 1305（map 14，5 格 0-1-2-3-100，无 powers）。
  协议 14508/14509/14510/14511/14514 共用，按 `p.mapId` 认领；BOSS 那盘开在普通城镇图上，
  多一条「身上没有 1305 就不认领」（否则玩家一站到广场就弹棋盘）。对外只认
  `boardMissionOfGroup`（12501 跳过距离校验 + 强制官方怪表）与 `isBoardMission`
  （`officialComplete` 的交付门；1305 的 submitCondition 是空的，全靠棋盘走完的 `solarDone` 拦）。
  进度字段沿用 `p.quests.active[任务].solarBoard` / `solarDone`（改名会毁老存档）；
  数据在 `lib/boss-tournament-data.mjs`（`applyBossTournament` 挂在 `applyDungeonChallengeRepairs` 之后）。
  1305 这一版**不做**入场券 119 / 券店 2061（NPC 菜单里那一项也摘掉）/ 奖励盒 1480–1482 / 2454 每日赠券。
- **问剑十一峰是同框架的第三份 host**（第 83 版，`lib/ask-sword-data.mjs`）：风雪之城 map 37 /
  NPC 11「封印守卫者」、13 格线性山道（0 → 1..11 峰 → 100）、三档任务 2604/2650/2651
  （`setting:8` 可重复挑战、押金 `escortCost` 接取时收一次、奖励 732/716/733 + 40001/40023）。
  客户端主包里**没有「问剑」字样**（这是对方自研玩法），所以整块复用棋盘界面、**不改客户端**。
  「怪缩放 1/1.7/2.6」= **编队系数** 100/170/260（客户端 0228 `getClone(coefficient)` → 0091
  `setMonsterData` 把 speed/atk/def/hpMax/mpMax 全乘 `coefficient/100`，奖励不动）→
  33 个单挑编队（11 峰 × 3 档）30301..30311 / 30321..30331 / 30341..30351。
  ⚠ `applyAskSword(official)` 必须排在**所有补怪补地图的补丁之后**（第 2 峰的 3244
  「冰风鹰身人」是 `applyDungeonStoryRepairs` 克隆的，排早了静默缺失那一峰）、建索引之前。
  ⚠ 任务包 `officialMissionPacket` 里 `money2/money3` 是 **short**（官方最大 30000 / 500，
  超了客户端读成负数）；押金不在任务包里，可以到 20 万。
- **挑战副本目录（第 84 版，`lib/daily-dungeon-directory.mjs`）**：看板从录制的 58 行扩到
  **99 行** = 58 录制 + 38 条目录（59—96）+ 97/98/99（`STORY_ROW_CREATE_IDS`，按故事链根的
  `origins()[0]` 现场建行）。38 行里 **16 行绑了进度/导航**（12 个故事副本 + `TERMINAL_BY_DIRECTORY`
  = 70→1052 / 79→1942 / 80→3972 / 94→1305 四个收尾任务型，94 每天 2 次），其余 22 行是**纯目录导航**
  （`linkage:null` → 永远停在「未开始」，靠行自带的 `mapId/npcID/px/py` 导航）。
  调用顺序：`daily-activity.ensure()` 里 `applyDailyDungeonDirectory` **先于** `applyRepairedDaily`
  （绑定要能找到行）；`applyDailyDungeonEntrances(official)` 在 `official-data.ensure()` 的
  **所有补地图补丁之后、建索引之前**（只告警跳过、不抛错 —— 这段在 ensure 里跑）。
  ⚠ **不要**照 4.0 把这批登记成「通关即复位」的重玩链（`repairedReplayChains`）：交付收尾任务的
  **当下**就会把它从 `quests.completed` 抹掉，而 1052/1942/3972/1305 是**录制任务**，
  `missionIdFinish` 与 NPC 可见位都依赖它们留在完成记录里（tests/boss-tournament.test.mjs 当场红）。
  跨天 `ensureDaily` 本来就清 `completed`，「第二天能重玩」不受影响 —— 只是不做「同一天重玩」。
- **守卫挑战（第 84 版，`lib/guard-challenges-data.mjs`）**：征战广场 945 的 2/3 号守卫各挂一套
  「接取即开战」的 33 条单体 BOSS 挑战（8901—8933，17/16 分；`setting:1034`、exp/money3 各 10000、
  `submitBattleID:0`、可重复）。6 个新编队 12100—12103 / 20501 / 20502 + 9 只本地怪 4200—4208 +
  怪物侧技能 9999:1「不死不灭」+ AI 4204；其余 27 条复用录制编队（11811 暗精灵王-夕、11781 库库尔坎…）。
  ⚠ `applyGuardChallenges(official)` 必须排在 `official-data.ensure()` 的 **所有补怪补编队之后**
  （`applyAskSword` 之后）、建索引之前 —— 放进 `applyBossChallenges`（ensure 第一步）会当场
  「缺少击杀目标怪物 2524」整个服务起不来。
  ⚠ 90 级条件**只作说明不设卡**：`missionConditions(q,'acceptCondition')` 对非城市任务只保留
  type 9/10（与 4.0 同款），等级条件写进定义但不进任务包。
  ⚠ 奖励箱 9300931 两边都无定义 → `missionRewards()` 静默滤掉（任务照常可接可打可交，箱子不发）。
- **三件「客户端认识、服务端要接」的背包道具**（第 73 版，`lib/bag-actions.mjs` + `restoration-service.mjs`
  + `pet-state.mjs`/`pet-service.mjs`）：288 背包扩展（wait **20**；回 `byte(20)` **并另推 12058
  + `int(新容量)`** —— 客户端对 288 根本不读回包容量，只弹一句「背包容量已增加」）；
  42000 变性卷轴（wait **21**；回 `byte(21) long(icon1) long(icon2) long(icon3) byte(sex) string(提示)`；
  性别位就是 icon1 低 32 位 bit0，改完要 `syncJobIcon()` 保住职业位）；
  40005 宠物返老还童石（宠物链 wait **14**；包体在 `quantity` 之后多一个 `short(petSlot)`
  *仅* `isPetCanUseItem()` 的道具才有 —— 已确认 288/42000 不是这一类；回 `byte(14) long(剩余毫秒)`；
  寿命重置 100 天且**过期宠物也能用**）。三件都在补给商人「消耗品」免费领。
- **补给商人菜单第 73 版合并成一条**：`MERGED_SUPPLY_SHOP=921`「强化、鉴定、宝石」，
  `items` 是 903/904/905 的并集，**只进 `supplyShopById` 与 `supplyNpc.shops`、不进 `supplyShops`**
  —— 后者是「物品列表不许重复」的那张表（tests/supply-shops.test.mjs 有这条等式）。
  903/904/905 三个商店定义**保留**：背包/装备工坊直连开店与 +4 宝石入口都按原号发请求。
  菜单内容由 `game-packets.mjs` 读 `n.shops` 下发，客户端不用改逻辑（`web/offline.js` 的
  `localShops` 加 921 即可放行开店）。
- **多阶段副本用「NPC 战斗菜单逐段入口」，不要指望续战**（第 74 版）：客户端本地战斗胜利后若
  续战会发 **12503** 远程战斗，本工程只接 12501（抓包里 `nextBattleGroupID` 全是 0）。
  菜单可用性掩码 `6` = 进行中/可交付、`1` = 今日已通过；追加菜单顺带 `status |= 3`；
  `npcType 0 → 5` 是安全的（客户端 `doMissionNpc` 对 5 会额外调 `addPowerNPCChoice`）。
  这一版的挑战副本都按这条做：葬送佣兵团队长三战（2312—2314，按「魔物-刑天」200 克隆）、
  堕狼魔再战入口、十殿阎罗逐殿菜单（组 11706/30001—30009）、剧情副本「接受即开战」重试、
  跨服副本五连战（新号 **9176**，紫禁城 824:112）、紫禁城菜单缺的编队 1838（克隆 1833 姬无丹）。
- **日常副本看板 8 行第 74 版接上了**（`lib/dungeon-repairs.mjs` + `lib/replayable-chains.mjs`）：
  位表 = `data/replayable-chains.json` 的 `daily-*` 链节点（30=20、31=71、33=22、34=29、35=35、
  36=41 含我方 9139/9140、37=23、38=61，与录制 `progressSum` 一致）；「前往」由 `taskSnapshot`
  在 `status===1` 时填 `findMisId/findMisSta/findMapId/findPx/findPy`（客户端只在进行中读 `find*`，
  未开始读行自带的 `mapId/npcID`）；副本链打完整条复位 → **当天就能从第一环重玩**。
  ⚠ 链里的 `optional`（晴菜 1822 / 晴菜后续 1395）= **留在链节点集合里、只从看板位表里去掉**：
  复位会清 `completed`，若把 1820 当收尾环，交付 1820 的瞬间就会抹掉 1822 的入口
  （它的 NPC 833:39 可见位挂在「1817 完成」上，`npcEnabled` 用 missionData 判定）
  → `tests/recorded-expansion.test.mjs` 的菜花村路线当场红。行 27/45/57 也顺手接上
  （葬送 3 队长占进度、失魂沙漠并进本地续篇 28→33→34→35→36、跨服行改接 9176）。
  ⚠ 跨服行的按钮：客户端 `r_shopId>0` 时行按钮是「进商店」，所以录制的 `shopid:11315`
  （券店）必须清成 0，否则点它是去开商店而不是导航；`missionId` 要留 `-1`
  （客户端对 `missionId!=-1 && !missionIdFinish` 的行直接不显示）。
- **城市日常与加工材料（第 74 版，`lib/custom-adventures.mjs`）**：1002 铁矿 / 1011 二级碎木 /
  1022 二级碎石 / 1032 二级碎矿按同类基底（1001/1010/1021/1031）的定义字节重建
  （`byte(type) bool(handBookItem) int(id) string(name) int(bagIcon) string(info)` + tail，
  先原样回写逐字节比对，对不上抛错）；城市任务两条纪律：`_isHelp:false`
  （客户端 `isForHelp()` 会给它加一个「求助」按钮）、`sources` 同时登记 `1000:n` 与 `3090:n`
  （`cityTarget` 按名字映射到当前城市场景）。等级条件与社区版同法：3068—3071/3074/3075 的
  127 收到人物上限 97（`minimum` 与 rawHex 同步，type 1 的 rawHex 就是 1 字节等级，0x61=97）、
  3052/3072/3073 直接删掉超限/引擎不认识的条件。城里仍留 3030「国家专用发展证领取」待定
  （submit 条件 type 6 = 消耗 500 国家贡献度，本工程没有国家系统）。
- **英雄图鉴（第 77 版，`lib/handbook.mjs` + `lib/handbook-item.mjs`）**：32101→32102（真实
  `unlock/level/rate/canUnlock`，`power=1` 否则客户端 `updatePage` 按「暂未开放」整页灰掉）、
  32103→32104+32109（客户端只发 group+type，**没有 itemIds** → 「点亮一页」由服务端说了算）。
  存档契约 `p.handbook={unlocked:{"组:类":[编号]}, lit, powers}`：`unlocked/lit` 是唯一真源，
  `powers` 是历史字段、**第 80 版起恒为 `{}`**。
  ⚠ **第 80 版把图鉴加成整块删除了**（用户：加成过于变态）：第 77 版照参考实现做过四张加成表
  （宠物 7·8·9·41 / 坐骑 11 / 特殊 19·24·34·37·39 / 其余走「物攻·魔攻·武器伤害」），
  折进 `native-character-stats` 的 `getSkillPowerValue`（原版落点是战斗单位的 `getPower`
  = `RoleGodData + BookGroupModel.getBookGroupPower`，我们的落点更靠前、会更狠），
  并用 32109 把同一份合计发给客户端。实测后果：97 级角色点亮几页就有「攻击次数+50」
  「魔攻+600」；更糟的是宠物表给的能力号 89–96 正是**主人侧宠物百分比能力**，客户端算出的
  宠物血蓝上限比服务端 `petAttributes` 高 7.5%（756516/703394）→ 12502 的
  「宠物战斗状态不完整」把**每一场**结算都拒掉 → 奖励全不发（用户报的就是这个）。
  现在：`refreshHandbook()` 只把 `powers` 清成 `{}`（进世界时清老存档的旧加成）、
  `handbookPowers()` 恒返回 `{}` → 32109 恒为空包，客户端 `onHandBookPowerInfo` 收到空包会
  **清空**静态的 `bookGroupPower`（这就是「客户端不用改一行」的原因），
  `native-character-stats` 不再读 `p.handbook`。收集率/图鉴等级（`handbookLevel`）只用于显示；
  客户端文案（`web/offline.js` 的 `getGroupTypeDes`）改成一句「仅作收集，不提供属性加成」，
  测试里有一条守卫：那段返回文案里**不许出现数字**（要恢复加成时它会先红）。
  ⚠ 取状态是**只读**的（`handbookState` 对老存档返回不进存档的空壳；写路径才用
  `ensureHandbookState`），32101 一行都不许写角色。
  ⚠ 尊贵 type 28 道具的字节定义：`power3/powerValue3` **只在 `power1===181`（附魔卡）时才存在**
  （`Item.fromBytesAtts2` 的条件读），无 power 的道具多写 4 字节 → `Reader.finish()` 报
  `Unconsumed bytes`。道具 800110「点亮所有图鉴」走 12001/action3（`waitType` 必须是
  `BAG_NO_WAIT(0)`，客户端该分支本地扣件不等回包）→ `lit=true` + 推 32109 + 公告 10509。
- **无限试炼的奖励规则（第 78 版，`lib/trial-challenge.mjs`）**：原版战斗本地算伤害，服务端
  只拿得到胜负 → 两条路都可能先到，闸门是 `state.awarded`（**同一场只发一次奖**）：
  ① 打赢 → 12502 的 `settleTrialBattleAndNotify` 按**满伤害**吃最高档（老客户端也不漏奖）；
  ② 没打赢 → 服务端没有伤害数字，**不发奖**，等客户端战斗结束上报 `trial-settle` 按真实比例定档。
  后到的那条只 `recordTrialDamage()` 刷「我的最高伤害」+ 写一条 `history`（最近 20 条、
  **跨天不清**，`trialSnapshot` 里带）。`trial-challenge` 受理时 `state.awarded=false` 重新开闸。
  ⚠ 别再拿 `p.trialPendingGroup` 当「这一场是不是我们下发的」判据：12501 受理时**已经**
  `delete` 它（`lib/game-service.mjs`），旧版本因此实战里永远不发奖（单测直接调函数才看不出来）。
  ⚠ 90020 处理 `trial-settle` 时在回包里附 `trialReport={damage,tier,granted,bestDamage}`
  （`homeSnapshot` 本身保持纯读）：打赢那份是 12502 发的，这条上报的 `granted` 自然是 0。
- **永泽塔（第 79 版，`lib/climb-tower.mjs`）**：塔层数据（`data/home-features-v1.json`，两边**字节一致**）
  从不缺，缺的是接线；塔怪 2700–3000 **不在官方怪物表**、两边都没技能/AI（`skillsPending/aiPending`），
  「搬他们的塔怪数据」不存在。真缺口是**困难塔 121—132 复用普通塔 1—120 的怪物 id 却属性 ×7**
  —— 一个 id 只能带一份属性（客户端按 id 认怪），所以第二份现场换成 `LOCAL_TOWER_VARIANT_BASE=21000`
  起的本地号（官方 id ≤4071、20000–32767 本工程无占用；上限 32767 因为**编队槽位是 short**）：
  `towerMonsterSignature()` 按「除 wire/sources 外的全字段」判同 id 是否两份属性（同签名复用、不同换号），
  `reidMonsterWire()` **只改 wire 头 4 字节 int id**（塔怪 wire 是「3 字节长度 + UTF-16BE 名字」那套，
  重写属性区必乱码），编队槽位与模型包都取自 `towerFloorMonsterIds(floorId)`（两处必须同源）。
  三处「单机修改」照参考实现（用户 2026-10-19「照做吧」）：① 全层开放（`floorsWithOpenFloor()` 全 `openFloor=0`，
  0 是「无前置」别用 `x||1` 兜）；② 每层奖励统一 `TOWER_FLOOR_REWARD=[[-1,50],[100781,1],[-6,30]]`
  —— **30002 下发的 `first`/`normal` 也要一起换**（否则客户端奖励栏显示抓包旧表、与实际发放不符），
  行→itemInfo 按 `towerRewardRow`（正数查定义补 name/bagIcon/grade，负数按 `TOWER_MONEY_GRADE`）；
  抓包原表留在数据文件里不再使用（1759/1760/1770 宝箱本来就没有道具定义）；③ `TOWER_BUY_COUNT` 10→1
  —— 客户端**没有**永泽塔购买入口（无 `C2S_CLIMB_TOWER_BUY`，1496 界面只有帮助/模式两按钮），
  两边都是死代码。⚠ 傲雪凌霜礼盒 100781 是 type 28，本工程**还没有开箱机制**，只能当收藏。
  奖励结算抽成了 `planTowerRewardRows(p,rows)`（缺定义道具跳过并记账，单测直接喂行）。
- **免费装备合成（90001/90002/90003，`lib/equipment-composition.mjs`）三种模式**：`attribute` 改
  131 合成格、`skill` 改合成技能、`identify`（第 85 版）自选鉴定属性。`identify` 一次提交整组：
  `picks` 必须覆盖**全部**普通鉴定格（`identifyRanges(template)`，与界面同源）、可选 `upgradePicks`
  覆盖**全部**进阶格（`upgradeIdentifyRanges`，power4—7；`applyUpgradeFields` 按数量校验整组，
  少一格就抛「无效进阶鉴定属性」）。范围都取自已录原版（`usableOptions` 滤掉写不进 short 的项；
  进阶任一格没有可用范围 → 整组不给）。⚠ 装备没有普通鉴定格时 `picks` 要传 `[]` 且**不写
  `affixes`**：空对象 `{}` 是 truthy，会让 `itemWithAffixes` 走进字节补丁分支（无 layout 的装备
  当场抛「此物品尚未核验独立鉴定属性」）。界面在 `web/equipment-composition.js` 的
  `renderIdentify()`（每格一个下拉 + 数值框 + 实时「合成效果」），web/* 是静态资源、不进补丁链。

---

## 客户端要点

- 主包 `client/js/ff/fff570bb….js` 4,557,839 → 补丁后 **4,567,833 字符**
  （链测试用**字符数**，别用字节数）。`.orig` 必须保持未打补丁的原始版本。
  （近两次：第 75 版 battleCheckFields 补一行派生属性 +76；第 76 版 attackPlan 补
  逐手武伤/攻次 +1961。改补丁必须同步 `tests/client-patch-chain.test.mjs` 的长度。）
- **补丁注入点分「语句 / 表达式」上下文**：webpack 类成员常是
  `return __extends(t,e),t.prototype.a=…,t.prototype.b=…,t` 逗号链。
  往链里插分号 → return 提前结束 → IIFE 返回不是类 → 进战斗报「r.show is not a function」。
  安全做法：注入函数体开头；守卫用 acorn 比对「不在 return 里的 prototype 赋值」数量。
- **`World.toBattle` 的远程/本地开关**：三个条件
  `isLeader()&&isHasPlayerMember()` / `isNetBattleID(t)` / `isEscortStatus()` 任一为真就走
  **12503 远程战斗**，而服务端只接 12501 → 客户端静默无反应。
  修法：三个条件都加 `&&null==e.getMonsterGroup(t)`（本地世界数据里有这组就别走远程）。
- **打完棋盘战斗必须把棋盘自己弹回来**（第 70 版）：棋盘（英雄挑战赛/团队副本）一行棋就进
  `StartBattleCmd → World.closeAllUI()` 把棋盘藏掉，打完点「确定」又走
  `exitBattle → ON_BATTLE_END → EndBattleCmd → World.showMain()` 再藏一次；
  而这两处**只藏窗口、不清 `World.escort`** → `MyPlayer.isCanMove()=!World.isEscortStatus()`
  恒 false → 表现是「棋盘没了 + 人物走不动」（背包/人物/宠物照常，那些是 Main 自己的按钮）。
  服务端补发 14508 救不回来（时机早于玩家点「确定」，且棋盘一藏起来客户端就停发 14511 轮询）。
  修法在 `lib/client-escort-board-patch.mjs`：`BattleProxy.exitBattle` 里把棋盘排进 `viewData`
  （客户端自带的「战后恢复界面」开关，`if(t)` 块会按它 showWin 回来）；
  与「幻想世界OL 2.0 新版」同一处、同一手法（对方漏了 `isWin:!0`，我们补上——
  原版开棋盘（14508）就是 showWin，棋盘得留在 UISTACK 上）。
- **让主界面按钮消失：`buttons` 白名单 ≠ 隐藏**（第 73 版）：`web/home-features.js` 的
  `buttons` 只负责「强制显示」列在里面的按钮，其它按钮的可见性由原版自己的 setLayout/回调决定
  （打榜 `btnCrossPla`、对战 `btnPetBattle` 就是这样，从来没进过白名单却一直在）。
  要消失必须进 `removedButtons`（`visible()` 末尾统一 hide）；矿洞 `btnDigHole`、
  新手 `btnNewTask` 两边都动（白名单摘掉 + 强制隐藏），它们的内容仍在单机菜单里。
- **摘掉单机菜单的 UI 元素要连定时器一起摘**（第 73 版）：`web/offline.js` 有一个每 1 秒刷新的
  `for(const id of [...])document.getElementById(id).disabled=…`，删了 `#talents-open` /
  `#artifact-open` / `#legion-open` 三个按钮就得同步从这份名单（以及 `legion-open` 那一行）里去掉，
  否则元素没了、定时器还在对它赋值 → 每秒一个 TypeError。
- **战斗提示弹窗（Briefing）不要慢慢滚**（第 73 版，`lib/client-prompt-patch.mjs`）：
  `MiscProxy.addPromptMsg`（模块 0062）把文本压进 `promptMsssage` 队列再 `Briefing.show()`，
  `Briefing`（模块 0370，`Layer.tip` 上 y=200 的单例）一次只显示一条、**每条固定 `TIME=2e3`**，
  而队列**没有上限** → 战斗里一轮刷好几条，打完了还在慢慢滚。
  补丁只动显示层三处：`TIME` → 800ms；`delayCall(…, max(250, min(TIME, 2000/队列长度)))`；
  入队后裁到 6 条（丢最旧的）。节奏常量在模块顶部（`PROMPT_TIME_MS`/`PROMPT_QUEUE_LIMIT`/
  `PROMPT_MIN_MS`/`PROMPT_REF_MS`），改完必须重新打包。
- **永泽塔挑战进战斗是客户端补的桥**（第 69 版）：原生 `TowerProxy.onClimbTowerChallenge`
  收到 30004 后只 `sendNt(TowerEvent.TowerChallenge)`，**全客户端没有监听者** → 点了没反应。
  桥全在 `web/home-features.js`：接管 `req(1500).default.prototype.sendClimbTowerChallenge`
  记层号，再包一层 `World.addMonsterGroup`（模块 0005；0018 解析 10503 时逐组调它），
  收到 `23000+层号` 那一组才 `World.toBattle`。
  ⚠️ 触发条件必须用「**收到塔组**」，不能用「发过请求」：服务端只在受理时才随 10503 下发该组，
  而组一旦进 `monsterGroupList` 就长期不清 → 用「发过请求」会在「同层已缓存 + 这次被拒」时误开战。
  （`sendClimbTowerChallenge` 是 UI 动态查属性、覆盖必命中；`onProto(proto,handler)` 是初始化时
  按引用注册的，改原型对它无效 —— 别拿它当钩子。）
- **长 NPC 菜单要客户端分页**（第 72 版，`web/offline.js`）：飞行驿站补到 65 条航线后，
  原版 `UI.createMissionUI` → `MissionDialogMdr` 把整份选项一次铺进对话窗 → 溢出、后面的点不到。
  做法：包 `req(1).default.createMissionUI`，只对 `subType===SUB_MISSION_NPC_MENU` 且选项数
  ≥25 的菜单切页（每页 8 项），页首/页尾插 `◀ 上一页` / `下一页 ▶（n/N）`，动作是 sentinel
  `[FLIGHT_PAGE_TAG,页号]`；再包 `req(737).MissionDialogMdr.prototype.executeChoice` 拦 sentinel，
  **先 `executeHide()` 再重开**同一个对话窗（不关就重开会把 egret 监听器挂两遍）。
  选项仍是原版数组里那一条 → `jumpMapID` 下标、门槛、落点全不变。兜底仍把 `list_choice`
  套 `eui.Scroller`（补给商人那套）。测试 `tests/client-menu-paging.test.mjs`。
- **NPC 记录的状态字节是一张位表**（主包 `ModelConst`，偏移约 1147619，逐字核对过）：
  `STATUS_VISIBLE=1`、`STATUS_ENABLE=2`、`STATUS_PASSABLE=4`、`STATUS_MISSION_DATA_USE=8`、
  `STATUS_MISSION_LOAD_EVERY_TIME=16`、`STATUS_JUMP_ICON=32`、`STATUS_HIDE_PLAYER=64`、
  `STATUS_GUIDE_NPC=128`、`STATUS_INIT_VISIBLE=1024`、`STATUS_INIT_ENABLE=2048`。
  → `status=2` 是「可交互但**看不见**」（个人城市的任务公告板就是这样，见第 71 版；
  BOSS 挑战赛入口 NPC 103 是 66 = 64|2，同样看不见，见第 72 版）；
  `status&8` 时记录里多 6 字节 missionData（short/byte/short/byte）；本地 type 0 用 23 就是
  「可见+可交互+可穿过+每次重读任务」。
- NPC 记录布局（客户端 `readPowerNPCData`）：14 头 + 名字/招呼/对话 + 状态/朝向/x/y/范围x/范围y
  （**这五个是各 1 字节，别读成 6 个**）
  + [missionData 6 字节，仅当状态&8] + 按 npcType 分支（type 5 = 传送菜单/战斗菜单/商店菜单/导师菜单
  四段，每段 byte 计数；传送项 = 菜单名(utf) 地图(short) x(byte) y(byte) 需求任务(short) 需求状态(byte)；
  战斗/商店/导师项 = 菜单名(utf) + short(编号) + short + byte）。
  改这类记录照 `lib/boss-hub.mjs` / `lib/city-template-fixes.mjs`：先按布局解析、用原值**原样重建
  一次并与原件逐字节比对**，才敢写入；测试用 `tools/capture-decoders.mjs` 的 `Npc.fromBytes`
  （就是主包模块 74 的原函数）读回来对。
  「下架一个菜单项」= 把该段计数位写 0、整段条目删掉（第 72 版摘掉 NPC 103 的券店菜单就是这样；
  ⚠️ 整段删空后客户端干脆不建 `menuShop`/`shopID` 字段，断言要按「空」判）。
- 图标 = bagIcon 十进制字符串作**全局数值子键**解析；item_icon0..7、bb_head（宠物头像）；
  蛋图标 = headIcon。资源表 `305.json` 顶层 `res.resources`。
- **文本两套命名空间**：`GameText`(模块 10) 与 `GameText2`(模块 23)。`STR_ATTR_IGNORE_*`
  只在 GameText2 → `window.__worldReq(23).GameText2.…`。全库文本常量可从主包正则抠出按值反查。
- **伤害按「逐手武伤 + 逐手攻次」算**（第 76 版，`lib/client-attack-plan-patch.mjs`）：
  原版每次攻击的武伤都取 `ATK_MIN..ATK_MAX`，而 `ModelConst.ATK_MIN = max(左手武伤, 右手武伤)`
  （模块 0056 的 `get`）→ **双持时永远用较好的那只手**，另一只手白拿；左右手攻次只看
  `LEFT_ATK_TIME>0 && RIGHT_ATK_TIME>0` 就 50/50 平均交替，不看两只武器各自的攻次（`EQP_HIT_TIME`）。
  我们第 4x 版解除了「两把武器不能同时装」的限制（`client-weapon-slot-patch.mjs`）→ 双持是常规玩法，
  这两条立刻可见。修法照搬参考实现：Battle 类补 `buildAttackPlan(actor,skill)` 出「每次攻击用哪只手」
  的计划（每项 `{left,min,max,type}`，长度仍是 `ATK_TIME+skill.atk_time` 夹 1..99 → **总攻次不变**，
  变的是分配：左 3 右 1 是 L,R,L,L），`calDamage` 循环逐次挂 `this._currentAttackHand`（try/finally
  还原），`BATTLE_RAND_ATC` / `BATTLE_AP_MAGIC` 改成按当前手取值（魔法武伤门槛从「玩家」扩到
  军团 / 离线佣兵，并只认当前手的武器类型）。空手/拳套/耐久 0（`getEquipWeaponType()` = -401）
  与怪物/宠物都走单项计划 → 与改动前等价。他们同处还有一条**没搬**：`delDamageEffect` 按真实掉血
  算吸血/仇恨/反击（与武伤攻次无关，要时再单独评估）。
  ⚠ 改这段要同步 `tests/client-patch-chain.test.mjs` 的长度与桩用例。
- **图鉴的加成文案在 `web/offline.js` 覆写 `BookGroupModel.prototype.getGroupTypeDes`**（第 77 版）：
  原版靠 `getPowerDesc(power, powerValue+addValue*档位)` 一次只描述得出一条属性，而图鉴每档是
  好几条一起加（宠物全属性+宠物伤害、坐骑致命点+无视伤害减免+攻击次数…）→ 整段换成字符串表，
  档位阈值与 `lib/handbook.mjs` 的 `BONUS_TABLES` 一一对应（测试逐档对数字），`level<=0` 返回「无」。
  `web/*.js` 是静态资源：电脑版直接加载、APK 由 `standalone/build.mjs` 平铺 `web/` → **不用两边挂补丁**，
  也不进 `client-patch-chain`（那条链只给主包 `fff570bb….js` 打字符串补丁）。
- **无限试炼用原版 FinalBoss 界面（第 78 版，`web/home-features.js`）**：原版那套窗口
  （模块 1472 Proxy / 1473 主界面 / 1475 编队 / 1477 玩家信息 / 1479 排行榜 / 1481 记录 /
  0146 FinalBossData）全靠 `C2S_FINAL_BOSS_*` 协议驱动，本工程一条没接 → 做法是
  **本地 90019 数据塞进 `FinalBossProxy._data.finalBossInfo` + 把门面六个方法换成本地 90020 动作**
  （`applyFinalBossInfo/Challenge/BuyTimes/SetPets/Rank/Record`），界面本身一行不改。
  伤害由客户端统计（hook 战斗单位 `delDamageEffect`，累加「我方→敌方」正伤害），
  `ON_BATTLE_END` 用 `trial-settle` 上报；进战斗仍是「收到试炼组才开战」
  （`World.addMonsterGroup` 认领 24000 → `World.toBattle`，与永泽塔塔组同一套桥）。
  ⚠ **`onShow` 必 await `applyFinalBossInfo()`** → 它必须一起换掉，否则塞进去的数据被协议回包冲掉
  （表现「界面开了但全空」）。
  ⚠ 编队槽位只能是**宠物模型上的真 Long**（`addPet/delPet/isPetSelected` 都对它调 `.eq()`，
  字符串当场 TypeError）；存档存字符串，`buildTrialInfo` 用 `trialPetRefs()` 经宠物代理换回来。
  ⚠ 排行榜条目 `rank` 是 **0 基**（模块 0339 里 `n=rank+1`）；1479 在列表里找不到自己会
  `new pb.FinalBossRankInfo`（本工程**没有 `pb` 全局**）→ 一律把玩家那行补进列表走 early-return。
  ⚠ 假 Long 够用：`Tool.getHeadIcon2/getJobByIcon1` 只调 `.toNumber()`；奖励格（模块 0086）
  要 `getNameInfo/getIconString/getIsItemPetEquip/grade(0..6)` + `doViewItem()`（发 12016，已实现）。
  ⚠ 「+」购买按钮**不要重绑**：原版 `onTapBuyTimes` → `_proxy.applyBuyTimes()` 已经指向本地动作，
  再 `listen` 一次就是「点一下买两次」（`Mdr.listen` 不查重）；原版「还有剩余次数先 Tips」照抄。
- **战斗查看的「生命百分比伤害减免」是算出来的，不是 wire 字段**（第 75 版，`lib/client-battle-check-patch.mjs`）：
  战斗减伤走 `BattleCalc.calTouch` → `calTouchDmg`（`n=TOUGH`，血/弱减半 → 减 `IGNORE_TOUCH`
  与技能 `POWER_SKILL_TARGET_TOUCH` → 上限 `MAX_RATE_TOUCH=700` → `伤害×(1-n/1000)`），
  即**引擎里 TOUGH 是千分比**（700 = 70% 封顶）。
  面板显示的算式**按用户要求照抄参考实现「幻想世界OL」**：`min(TOUGH/100, 80)%`
  —— ⚠ 这与引擎自身换算差 10 倍（同一条 TOUGH 只显示 1/10），是有意为之；
  要改成引擎真值就是把 `/100→/10`、`80→70`（一行）。
  面板只有一条分支 → 玩家 / 宠物 / 怪物同一段代码（原生 `NEW_REFLECTION`「抵挡时百分比伤害抵消」
  是另一条属性，见 `processBattleKeepOutPower`，需要时再往面板上加）。
  改这一行会让主包长度变化：同步 `tests/client-patch-chain.test.mjs` 与本节上面的长度。
- 怪物血蓝条用游戏自带的条（改 `hideMsg()`），**不要自绘**。战斗属性缓存见
  `web/worldol-battle-attr-cache.js`。
- 查询客户端行为**要去主包里搜协议常量名顺藤读码，别推断**。
  （`analysis/modules/00XX.js` 是反编译出来、缩进可读的那一套：图鉴主页 1150、
  图鉴代理 1147 + 0179、道具类 0032、宠物类 0042、协议表 0019、`sendProtoAsync` 在 0035。
  「查看一件我没有的道具」= 16051 → `Item.getItemUseId` → **12016**（回包形状见「通用坑」第 81 版那条）；
  「查看一只我没有的宠物」= 15514 → `fromBytesDetail`，回包 = `byte(0)` + 宠物详情 + `string(图鉴说明)`。）

---

## 单机版编号约定

- 造型 40101+/40201+、宝石 800401–800405、本地道具 ≥900000、宠物蛋 30000000+、
  封印书 920000000+、技能书 930000000+（后两者 `base+技能号*128+等级`）。
  800110 = 「点亮所有图鉴」（消耗品，补给商人免费领，定义在 `lib/handbook-item.mjs`）。
- 919 只卖训练师教不到的满级技能书；遗忘 14003/14006；改名 15511；公告在 `web/offline.js` 的 `applyNotice`。
- 本地 NPC 由 `content.mjs` push 进 `maps[].npcs`（**地形之后**），编号 0..127。
- **怪物本地号 21000–32767**（第 79 版）：永泽塔困难塔复用普通塔 id 但属性不同的那一份换到这里
  （官方怪物 id ≤4071，这段无占用；上界由编队槽位的 short 决定）。见 `lib/climb-tower.mjs`。
- **守卫挑战的本地号**（第 84 版，照 4.0 原样）：怪 **4200–4208**、编队
  **12100–12103 / 20501 / 20502**、任务 **8901–8933**、怪物侧技能 **9999:1**、AI 4204；
  奖励箱 9300931 无定义（只记账）。见 `lib/guard-challenges-data.mjs`。

---

## 打包与 APK 的坑

- **APK 里 `fs.existsSync` 对 `data/**` 恒为 false**：node:fs 是 VFS shim，existsSync 只查**已预载**
  内存表，而预载清单只有 6 个文件、不含 data/；data 走 XHR 现取。
  正确写法 `try{fs.readFileSync(x,'utf8')}catch(e){if(e?.code==='ENOENT')…}`。
  守卫：`tests/skill-editor.test.mjs` 断言 lib 里除 store.mjs / http-routes.mjs 外不得出现 existsSync。
- **bat 必须 GBK(936) + CRLF**（cmd 按 ANSI 解析，UTF-8 会乱码甚至拆坏整行命令）。
  用 Edit 工具改过必须转回：`[IO.File]::WriteAllText($p,$t,[Text.Encoding]::GetEncoding(936))`。
  bat 里写路径别用 `>`（会被当重定向）。ps1 固定 UTF-8 → bat 调用前 `chcp 65001`、后 `chcp 936`。
- **ps1 必须带 BOM 的 UTF-8**；`.gradle`/`.java`/`.properties` **不能**带 BOM。
- **构建指纹必须覆盖 `data/**`**：data 不预载、URL 无版本号 → 只改资料指纹不变 → WebView 缓存不清。
- 跑构建前同进程设 `CODEBUDDY_SAFE_DELETE_ENABLED=0`（`cap sync` 删 9999 文件会被保护拦，
  报 `[safe-delete] count:9999`，看着像 capacitor 坏了）。
- `构建APK.ps1` 内联了一份 MainActivity 模板会覆盖源码 —— 模板与工程那份已同步并带
  `WORLDOL_ACTIVITY_V2` 标记，识别到标记就跳过覆盖。**以后改 MainActivity 必须两处同步。**
- 覆盖安装不清 WebView 缓存 → 已做「构建指纹 + 缓存自愈」（build-version.json + primeChangedAssets
  + MainActivity 删缓存目录）。**绝不清 localStorage**（存档在里面，键前缀 `worldol-fs:`）。

---

## 环境特殊行为（这台机器）

- **命令一律走 WSL（`bash`），尽量不用 PowerShell**（用户 2026-10-19 明确要求）。项目在 WSL 里是
  `/mnt/f/<项目目录>/.../世界OL_源码/世界online_原版单机`；跨盘调用用
  `wsl bash -lc 'cd "/mnt/f/…/世界online_原版单机" && npm ...'`。
  PowerShell 只在 WSL 做不到的事上用（例如 `Get-Content` 级别的 GBK 输出，或 .bat/.ps1 的自检）；
  ps1/bat 本身仍按下面的规矩写（GBK/CRLF/BOM）。
- `CODEBUDDY_SAFE_DELETE_ENABLED=0` 常设；**spawn 到 node.exe 恒 EBUSY**；
  `fs.cpSync` 拷大目录会原生崩溃 → 用 `copyTree()` 或系统 node；
  `.ps1` 需同进程 `Set-ExecutionPolicy -Scope Process Bypass`；vm 跨 realm 先 JSON 克隆。
- **项目目录内的删除会进 F 盘回收站**（`%TEMP%` 里直接消失）。沙箱里跑打包会把 Gradle 中间产物
  塞进回收站（一次 1.5–2 万条）→ 用 `安卓打包/清理回收站.bat`。
- Git Bash /tmp = `<用户目录>\AppData\Local\Temp`。

---

## 记忆与文档

- **本文件（AGENTS.md）是活记忆**：新踩的坑、新约定请追加到相关小节。
- `docs/memory/` 是开发日志（INDEX.md 有索引），记录每个版本的动机、根因、验证与教训。
- `修复记录.txt` 是面向玩家的改动流水（逐版）。
- `docs/memory/MEMORY.md` 是迁移前的原样快照（保留作为历史，内容已并入本文件）。
- `docs/对比报告-幻想世界OL2.0新版.md` —— 与另一位开发者「幻想世界OL 2.0 新版」APK 的
  完整差异 + 可移植清单（服务端 34 模块 / 客户端 hook 与外挂脚本 / 数据差异 / 移植优先级）。
  ⚠ 对方**旧版**的解包产物（`%TEMP%\opencode\fxol2\` 172.5 MB + `%TEMP%\opencode\cmp\`
  里 127 个 `theirlib/*.mjs` 与中间结论）已于 2026-10-18 按要求删除；等新版本上传后解包回
  同一个位置重跑对比 —— 报告第 1—9 节的结论**只对旧版本成立**。
- `docs/对比报告-幻想世界OL3.0最终版.md` —— 对「3.0 最终版」APK 的**全量差异扫描**
  （2026-10-18，解包在 `%TEMP%\opencode\fxol3\`、模块切在 `%TEMP%\opencode\fxol3lib\`）。
  ⚠ **3.0 已停止参考（2026-10-19，用户）：3.0 的 APK 与解包产物已删除，报告只作历史证据保留。**
  新参考版本是「幻想世界OL 4.0AI版」，到手后按下面的流程重新解包对比；本节的结论只对 3.0 成立。
  要点：① 他们 3.0 把服务端 bundle **加密了**（XOR 0x5A + Base64，`standalone.html` 里有同款解码；
  解密后 127 个模块，与我们重名 98）；② 他们补上了**永泽塔 / 无限试炼 / 问剑十一峰**（2.0 时
  永泽塔还抛「尚未录全」占位），永泽塔客户端桥与我们第 69 版同一套；③ 他们仍独有
  **佣兵 4 模块 / 账号仓库 90040 / 联机 / 装备工作台 / 染色+光效 / 怪物·物品编辑器 18 份数据 /
  根特**；④ 我们独有 **24 个客户端补丁链**（他们 2）与本地内容（9100–9124、地图 277、138 称号、
  8 条日常链）；⑤ 协议号冲突：**90022 我们=外观同步 / 他们=副本刷新**（要搬必须换号）。
  ⚠ 他们的 `analysis/` 是陈旧产物（5 个差异模块里 0008/1147/1149 在出厂主包里对不上），
  别拿它当「他们改过什么」的证据。
- `docs/对比报告-幻想世界OL4.0AI版-副本数据.md` —— **当前参考版本（4.0AI版）的副本专题对比**
  （2026-10-19，解包 `%TEMP%\opencode\fxol4\`、bundle 解密 `fxol4lib\worldol-standalone-decoded.js`，
  仍是 Base64 + XOR 0x5A）。结论：**副本骨架两边同一套**（14 张动态副本 / 76 团队副本编队 / 81 怪 /
  11 种挑战副本全部对得上，只有 3 个任务号不同：9141/9143/9145 = 我们 9170/9172/9174）；
  4.0 多出来的是外围层 —— ①`dungeon-reward-repairs.json` 169 条（补上我们任务奖励里
  135 种无定义道具中的 132 种）②38 条副本入口目录（id 59—96）+ 30 行看板进度绑定（我们 11 行）
  ③手动「副本刷新」（他们 90022，与我们外观同步冲突 → 移植要换号）④副本进度面板
  `web/dungeon-repairs.js` ⑤33 条守卫挑战 8901—8933（征战广场 945，27 条零新增战斗数据）。
  不建议抄的：团队副本 6 只怪属性 ×10、本地怪 4200—4208（全 65535）、奖励箱 9300931（他们也没定义）。
- **协作约定（谁验证）**：AI 只负责**改**并把「改了什么、结论是什么」讲清楚；**打包 / 起服务 /
  上机跑游戏这类验证由用户自己来**。必要的额外验证（单测、语法检查）可以做，但只报结论；
  真要用别的验证手段（E2E、装包、远程调试）时**先跟用户说一声**再动手。

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

---

## 服务端要点

- `protocol-constants.mjs`（写 `P.<名>`）；本地裸号 90021/90022/32107/22106。
- `protocol-dispatch.mjs` INBOUND_CHAIN **22 段有序不重排**（第 63 版新增 solarChallenge）；
  拒绝回 false **且不许读字节**（读过要还原 `r.pos`）。
- `http-routes.mjs` 405 门位置承重；`lazy-data.mjs` **数组不能包代理**（数组型导出改函数）。
- 战斗 12501/12502：`context.battle` 被拒要搬 `rejectedBattle` **并清空**（否则 20+ 守卫锁死玩家）；
  报错点名哪一项；包尾 `locateTrailer()`；血蓝上限 `nativeVitalsCeiling()` 分级放宽
  （坑：nativeCharacterStats 对残缺角色静默返回 0）。
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
- **棋盘玩法有两份 host**（第 72 版，`lib/solar-challenge-service.mjs`）：太阳神殿（map 262，13 格，
  有 powers，`implicitMission`）与 BOSS 挑战赛 1305（map 14，5 格 0-1-2-3-100，无 powers）。
  协议 14508/14509/14510/14511/14514 共用，按 `p.mapId` 认领；BOSS 那盘开在普通城镇图上，
  多一条「身上没有 1305 就不认领」（否则玩家一站到广场就弹棋盘）。对外只认
  `boardMissionOfGroup`（12501 跳过距离校验 + 强制官方怪表）与 `isBoardMission`
  （`officialComplete` 的交付门；1305 的 submitCondition 是空的，全靠棋盘走完的 `solarDone` 拦）。
  进度字段沿用 `p.quests.active[任务].solarBoard` / `solarDone`（改名会毁老存档）；
  数据在 `lib/boss-tournament-data.mjs`（`applyBossTournament` 挂在 `applyDungeonChallengeRepairs` 之后）。
  1305 这一版**不做**入场券 119 / 券店 2061（NPC 菜单里那一项也摘掉）/ 奖励盒 1480–1482 / 2454 每日赠券。
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

---

## 客户端要点

- 主包 `client/js/ff/fff570bb….js` 4,557,839 → 补丁后 **4,565,871 字符**
  （链测试用**字符数**，别用字节数）。`.orig` 必须保持未打补丁的原始版本。
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

---

## 单机版编号约定

- 造型 40101+/40201+、宝石 800401–800405、本地道具 ≥900000、宠物蛋 30000000+、
  封印书 920000000+、技能书 930000000+（后两者 `base+技能号*128+等级`）。
- 919 只卖训练师教不到的满级技能书；遗忘 14003/14006；改名 15511；公告在 `web/offline.js` 的 `applyNotice`。
- 本地 NPC 由 `content.mjs` push 进 `maps[].npcs`（**地形之后**），编号 0..127。

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
  要点：① 他们 3.0 把服务端 bundle **加密了**（XOR 0x5A + Base64，`standalone.html` 里有同款解码；
  解密后 127 个模块，与我们重名 98）；② 他们补上了**永泽塔 / 无限试炼 / 问剑十一峰**（2.0 时
  永泽塔还抛「尚未录全」占位），永泽塔客户端桥与我们第 69 版同一套；③ 他们仍独有
  **佣兵 4 模块 / 账号仓库 90040 / 联机 / 装备工作台 / 染色+光效 / 怪物·物品编辑器 18 份数据 /
  根特**；④ 我们独有 **24 个客户端补丁链**（他们 2）与本地内容（9100–9124、地图 277、138 称号、
  8 条日常链）；⑤ 协议号冲突：**90022 我们=外观同步 / 他们=副本刷新**（要搬必须换号）。
  ⚠ 他们的 `analysis/` 是陈旧产物（5 个差异模块里 0008/1147/1149 在出厂主包里对不上），
  别拿它当「他们改过什么」的证据。
- **协作约定（谁验证）**：AI 只负责**改**并把「改了什么、结论是什么」讲清楚；**打包 / 起服务 /
  上机跑游戏这类验证由用户自己来**。必要的额外验证（单测、语法检查）可以做，但只报结论；
  真要用别的验证手段（E2E、装包、远程调试）时**先跟用户说一声**再动手。

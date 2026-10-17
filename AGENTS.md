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
- **`itemPacket` 宁可降级绝不抛错**：`enterWorld→…→bagPacket→itemPacket`，一件抛错整包发不出 → 黑屏。
  「下架」只改名单，定义留着。
- **JSDoc 注释里别写 `*/` 字样**（如 `power*/powerValue*`）→ 块注释提前关掉 → SyntaxError。
- **跨 try/catch 用的变量必须在 try 之前声明**（否则 catch 里访问 ReferenceError）。
- **`planItemRewards` 碰到无定义道具会整包抛错** → 奖励表只引用有定义的道具；
  宝箱 1759/1760/1770 无定义，发放要跳过并记账。

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

---

## 客户端要点

- 主包 `client/js/ff/fff570bb….js` 4,557,839 → 补丁后 **4,565,641 字符**
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
- **永泽塔挑战进战斗是客户端补的桥**（第 69 版）：原生 `TowerProxy.onClimbTowerChallenge`
  收到 30004 后只 `sendNt(TowerEvent.TowerChallenge)`，**全客户端没有监听者** → 点了没反应。
  桥全在 `web/home-features.js`：接管 `req(1500).default.prototype.sendClimbTowerChallenge`
  记层号，再包一层 `World.addMonsterGroup`（模块 0005；0018 解析 10503 时逐组调它），
  收到 `23000+层号` 那一组才 `World.toBattle`。
  ⚠️ 触发条件必须用「**收到塔组**」，不能用「发过请求」：服务端只在受理时才随 10503 下发该组，
  而组一旦进 `monsterGroupList` 就长期不清 → 用「发过请求」会在「同层已缓存 + 这次被拒」时误开战。
  （`sendClimbTowerChallenge` 是 UI 动态查属性、覆盖必命中；`onProto(proto,handler)` 是初始化时
  按引用注册的，改原型对它无效 —— 别拿它当钩子。）
- **NPC 记录的状态字节是一张位表**（主包 `ModelConst`，偏移约 1147619，逐字核对过）：
  `STATUS_VISIBLE=1`、`STATUS_ENABLE=2`、`STATUS_PASSABLE=4`、`STATUS_MISSION_DATA_USE=8`、
  `STATUS_MISSION_LOAD_EVERY_TIME=16`、`STATUS_JUMP_ICON=32`、`STATUS_HIDE_PLAYER=64`、
  `STATUS_GUIDE_NPC=128`、`STATUS_INIT_VISIBLE=1024`、`STATUS_INIT_ENABLE=2048`。
  → `status=2` 是「可交互但**看不见**」（个人城市的任务公告板就是这样，见第 71 版）；
  `status&8` 时记录里多 6 字节 missionData（short/byte/short/byte）；本地 type 0 用 23 就是
  「可见+可交互+可穿过+每次重读任务」。
- NPC 记录布局（客户端 `readPowerNPCData`）：14 头 + 名字/招呼/对话 + 状态/朝向/x/y/范围x/范围y
  + [missionData 6 字节，仅当状态&8] + 按 npcType 分支（type 5 = 传送菜单/战斗菜单/商店菜单/导师菜单
  四段，每段 byte 计数；传送项 = 菜单名(utf) 地图(short) x(byte) y(byte) 需求任务(short) 需求状态(byte)；
  战斗/商店/导师项 = 菜单名 + short + short + byte）。
  改这类记录照 `lib/boss-hub.mjs` / `lib/city-template-fixes.mjs`：先按布局解析、用原值**原样重建
  一次并与原件逐字节比对**，才敢写入；测试用 `tools/capture-decoders.mjs` 的 `Npc.fromBytes`
  （就是主包模块 74 的原函数）读回来对。
- 图标 = bagIcon 十进制字符串作**全局数值子键**解析；item_icon0..7、bb_head（宠物头像）；
  蛋图标 = headIcon。资源表 `305.json` 顶层 `res.resources`。
- **文本两套命名空间**：`GameText`(模块 10) 与 `GameText2`(模块 23)。`STR_ATTR_IGNORE_*`
  只在 GameText2 → `window.__worldReq(23).GameText2.…`。全库文本常量可从主包正则抠出按值反查。
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
- **协作约定（谁验证）**：AI 只负责**改**并把「改了什么、结论是什么」讲清楚；**打包 / 起服务 /
  上机跑游戏这类验证由用户自己来**。必要的额外验证（单测、语法检查）可以做，但只报结论；
  真要用别的验证手段（E2E、装包、远程调试）时**先跟用户说一声**再动手。

# 世界OL 单机版 — 项目指引（AGENTS.md）

给《世界OL》（原版 H5 客户端 v305）做的**离线单机服务端 + 客户端补丁 + 安卓打包**工程。
服务端用 Node.js 复刻原版二进制协议；客户端补丁在电脑版运行时、或 APK 构建期注入；
最后用 Capacitor 出 APK。

- 详细开发日志：`docs/memory/INDEX.md`
- 逐版玩家改动：`修复记录.txt`
- 不开 AI 的操作手册：`手动改BUG指南.md`
- 本文件只保留长期有效的高频信息；具体版本过程看上面的日志。
- 新踩的坑、新约定请追加到对应小节，不要在版本日志里只记一份。

## 一、目录与命令

根目录：`世界OL_源码/`（git，分支 `main`）。

| 路径 | 说明 |
| --- | --- |
| `世界online_原版单机/` | ★ 源码主目录：`server.mjs` + `lib/` + `web/` + `data/` + `tests/` + `tools/` |
| `世界online_原版单机/client/` | 原版 H5 客户端（只读，不入库；补丁只在内存里打） |
| `世界online_原版单机/analysis/` | 客户端反编译产物（不入库，缺失时相关测试跳过） |
| `安卓打包/` | `standalone/build.mjs` → `构建APK.ps1` → APK |
| `docs/memory/` | 开发日志与版本决策 |
| `修复记录.txt` | 面向玩家的逐版流水（CRLF 无 BOM） |

不入库：`client/`、`analysis/`、`node_modules/`、`saves|logs|backups|runtime/`、
`安卓打包/app/www/`。

在 `世界online_原版单机/` 下：

- `npm test`：主测试（pretest 先跑语法基线）。判定标准是**同一批改动前后新增失败为 0**，
  不比较不同机器的 pass/fail 绝对数。
- `npm run check`：语法检查。
- 基础自检：根目录 `运行基础自检.cmd`（环境 + 存档/覆盖 JSON + 语法 + 26 个核心用例）。
- 启动：`启动单机-新存档.cmd`（8775，账号 `xia-v05-qa`）、`继续测试角色.cmd`（8776）、`停止单机.cmd`。
- 打包统一用 `安卓打包/一键打包.bat`（`release` / `fresh` / `noopen` / `nopause`）。
  管道调用时 `$LASTEXITCODE` 可能失真，以脚本打印的「四步全部成功」和 `output/` 的 APK 为准。
- 两个「双击即用」编辑器：`技能编辑器.html`（技能 → `data/local-skill-overrides.json`）、
  `装备编辑器.html`（装备 → `data/local-item-overrides.json`）。
  内嵌目录由 `tools/build-*-editor-data.mjs` 生成，改完资料要重跑。
  ⚠ 装备编辑器的属性名来自技能编辑器的 labels，改了 `build-skill-editor-data.mjs`
  必须**两个生成器都重跑**。主包是压缩包，`return "…"` 与 `return"…"` 两种写法都有，
  正则必须都容忍，否则效果名会静默退回英文。
  ⚠ 长下拉字段用 `.field.stack`（标签/控件/提示各一行），不要把长选项塞回单行布局。

## 二、三条铁律

1. **`lib/` 是唯一一份源码**：电脑版运行时和 APK 构建都从它取，只改一遍。
2. **不要直接改 `client/js/ff/fff570bb….js`**（压缩产线包，构建会被覆盖）。
   改客户端要写 `lib/client-*-patch.mjs` 做字符串替换。
3. **新增客户端补丁必须两边都挂，顺序一致**：
   `server.mjs`（运行时，补丁链最外层）+ `/api/status` revision；
   `安卓打包/standalone/build.mjs`（构建期）。
   锚点不匹配要**直接抛错**：`if(source.split(from).length!==2)throw Error('… mismatch')`。

补丁链 `client-patch-chain.mjs` 和动态全局量 `generated-globals.mjs` 都有两个投放口，
改一处必崩。

## 三、数据与覆盖层

- `data/*.json` 是抓包产物，**一字节不改**。`career-skills.json` 是验收契约：
  `tests/career-skills.test.mjs` 断言恰好 470 个技能、每个 1–22 级。
- **技能覆盖**：`data/local-skill-overrides.json` + `lib/local-skill-overrides.mjs`。
  支持 `perLevel`（优先于 set）+ 白名单 `OVERRIDABLE_FIELDS`。
  - 必须挂在 `official-data.ensure()` 的最后一环（`applyCaptured81` 之后、建索引之前）：
    捕获包会逐字节比对，提前改 `wireBase64` 会抛
    `Conflicting captured81 skill`，服务端起不来。
  - 装备技能与人技能共用 id；`restoration.activeSkills()` 和 `learned()` 的导入定义
    都要套覆盖。
  - 怪物技能在 `official.skills`；`official-data.ensure()` 套整表，同时
    `rebuildLevel()` 重算 `monsterWireBase64`（只改 `wireBase64` 怪物仍放旧效果）。
- **装备覆盖**：`data/local-item-overrides.json` + `lib/item-overrides.mjs`。
  - 在 `official-data.ensure()` 的**所有补道具补丁之后、建 `officialItems` 之前**套用。
  - 必须用 `equipmentBytes` 重写 `definitionBase64`：客户端收到的定义和服务端算属性
    用的都是这段字节；只改 JSON 字段游戏里不会变。
  - `ITEM_FIELDS` 是编辑器表单 + 服务端校验的唯一字段表；`id` / `type` /
    `handBookItem` 禁改。派生字段（`powers` / `level` / `requirements` /
    `durability` / `attackTimes` / `hit`）覆盖后一起重算。
  - 覆盖改的是**定义**，同一件装备的所有副本一起变；存档里的 `inventory[].affixes`
    是实例数据，归鉴定/合成管。
  - **覆盖过的装备不能再走 `item-affixes` 的原始 SHA-256 字节补丁路径**：
    `itemWithAffixes()` 用 `hasItemOverride()` 认领后用 `finishEquipment()` 整份重编码，
    否则鉴定/强化/附魔/赋灵会报「物品定义已变化」。非覆盖装备仍走原字节补丁。
  - 只打开 `isUpgradeItem` 不会自动生成进阶鉴定范围；要在编辑器的 identify 段补
    `power4—7`。
- **装备词条/合成**：
  - 普通鉴定格 `121`、合成格 `131`、进阶格 `power4—7`；鉴定范围以
    `official.identification` 为唯一来源（12060 回包与服务端随机共用）。
  - `identify` 模式要求 `picks` 覆盖全部普通格；进阶 `upgradePicks` 也必须整组给全。
    没有普通格时传 `picks:[]` 且**不要写空 `affixes`**（空对象是 truthy，会误入字节分支）。
  - 合成/鉴定/强化/附魔/赋灵的最终定义都由 `itemWithAffixes()` / `finishEquipment()` 产出。

## 四、服务端要点

- 协议常量在 `protocol-constants.mjs`（写 `P.<名>`）；本地裸号
  90021/90022/32107/22106。
- `protocol-dispatch.mjs` 的 INBOUND_CHAIN **22 段有序，不重排**；拒绝时返回 `false`
  **且不许读字节**（读过要还原 `r.pos`）。
- `http-routes.mjs` 的 405 门位置承重；`lazy-data.mjs` 的数组不能包代理，
  数组型导出改成函数。
- **新增 `web/*.js` / `web/*.css` 必须加入 `lib/http-routes.mjs` 的 `WEB_PATHS`**：
  电脑版是显式白名单，漏了就是 404；APK 由 `standalone/build.mjs` 平铺整个 `web/`。
  ⚠ 电脑版 CSP 是 `script-src 'self' 'unsafe-eval'`，**内联 `<script>` 会被拦掉**；
  页面逻辑放外部 JS，用相对路径（`file://` 和电脑版都能找到）。
- `official-data.ensure()` 里建 `officialGroups/officialMonsters` 等 Map；
  运行时注册的怪/编队/地图必须注册在建索引**之前**，否则索引里没有。
- **`web/offline.js` 里调用新的 `window.installXxx(req)` 必须带存在性保护**
  （`if(typeof window.installXxx==='function')`）：多个测试只加载 offline.js 跑 vm，
  不加载全部 web 文件；且玩家端旧缓存/旧包缺文件时，增强层不能把离线安装链带挂
  （第 93 版 skill-fx 踩过：4 个无关测试全红）。
- **技能 `area` 号段已被扩展占用**：原版 0—38，第 93 版把 **40—49 定为「敌随机 1—10」、
  50—59 定为「我随机 1—10」**（39 留空缓冲），见 `lib/client-random-target-patch.mjs` 的
  `decodeRandomArea` 与技能编辑器的 `SKILL_AREAS`。新增 area 号段前先查这两处，别撞号。
- **玩法开关走「配置 + 全局变量 + 补丁」三件套，不许塞进技能/装备字节**：
  `data/local-*.json`（独立文件）→ `/xxx.js` 动态路由（电脑版）+ `globals.mjs`/`entry.mjs`（APK）
  → `lib/client-*.mjs` 包装对应函数（配置缺失一律退化为原生行为）。范例：
  `local-auto-skill-chance.mjs` + `/skill-auto-chance.js` + `client-auto-skill-chance-patch.mjs`。
- 战斗 12501/12502：`context.battle` 被拒要搬 `rejectedBattle` 并清空；报错点名哪一项；
  包尾用 `locateTrailer()`。血蓝上限 `nativeVitalsCeiling()` 分级放宽；
  宠物走 `petVitalsCeiling()`（自研上限 + 50% 宽容），放宽的只是校验，
  `petAttributes()` 的面板和回满数值不变。
- 不在地图上的战斗组（塔层、太阳棋盘、试炼）要跳过 12501 距离校验，并强制官方怪表；
  下发世界数据前确认组存在（`worldData()` 的 tower/trial extraGroups），
  否则客户端 `Error #1025`。
- 任务锚点和怪刷新点常常不是同一个：开战判定优先锚点，锚点远则用当前可见可打的
  同组最近刷新点。
- 查询/快照接口必须走纯读函数，**不许改角色**（如 `towerCountsReadonly`、
  `readTrialState`），守卫用 `assert.deepEqual(p,before)`。

### 常见功能入口

| 功能 | 主要文件 | 必须知道 |
| --- | --- | --- |
| 城市 | `city-state.mjs`、`city-progress.mjs`、`city-template-fixes.mjs` | 升级任务从 `p.city.level` 推导；老存档用 `unlockCity()` 补发 |
| 棋盘/问剑 | `solar-challenge-service.mjs`、`boss-tournament-data.mjs`、`ask-sword-data.mjs` | 三份 host 共用 14508—14514；`applyAskSword` 排在所有补怪之后 |
| 挑战副本 | `daily-dungeon-directory.mjs`、`dungeon-repairs.mjs`、`replayable-chains.mjs` | 38 条目录行；录制收尾任务不要做同日复位 |
| 守卫挑战 | `guard-challenges-data.mjs` | 8901—8933；必须排在所有补怪/补编队之后 |
| 英雄图鉴 | `handbook.mjs`、`handbook-item.mjs` | 只做收集显示，**不提供属性加成**；读状态只读 |
| 阵法 | `formation-data.mjs`、`restoration-service.mjs`、`world.mjs`、`supply-shops.mjs`、`client-formation-book-patch.mjs` | 16 本 `62009—62144`、商店 922、`DATA_FORMATION`、`14012/14013/14015`、`14014` 同步；`skillId` 必须写阵型 id，不能照 APK 写 0 |
| 无限试炼 | `trial-challenge.mjs`、`web/home-features.js` | 发奖闸门 `state.awarded`；同一场只发一次 |
| 永泽塔 | `climb-tower.mjs` | 困难塔变体怪用本地号 21000+；奖励表与 30002 下发同步 |
| 免费装备合成 | `equipment-composition.mjs` | `attribute` / `skill` / `identify` 三种模式 |
| 伤害计算器 | `damage-calculator.mjs`、`web/damage-calculator.*` | 只读存档；导入会话只在内存；仅 `/api/damage-calculator/*` 开 CORS |

细节和版本动机看 `docs/memory/`，这里只列入口。

## 五、客户端要点

- 主包 `client/js/ff/fff570bb….js` 原始 4,557,839 → 补丁后 **4,568,725 字符**
  （测试用字符数）。`.orig` 保持未打补丁；改补丁必须同步
  `tests/client-patch-chain.test.mjs` 的长度和桩用例。
- 补丁注入点分「语句 / 表达式」：webpack 类成员常是
  `return __extends(...),t.prototype.a=…,t` 逗号链。往链里插分号会让 return 提前结束，
  进战斗报「r.show is not a function」。安全做法是注入函数体开头，并用 acorn
  检查「不在 return 里的 prototype 赋值」数量。
- `World.toBattle` 的三个远程条件：`isLeader()&&isHasPlayerMember()`、
  `isNetBattleID(t)`、`isEscortStatus()`，任一为真走 12503 远程战斗（服务端只接 12501，
  客户端会静默无反应）。三个条件都加 `&&null==e.getMonsterGroup(t)`。
- 棋盘战斗后要把棋盘自己弹回来：`BattleProxy.exitBattle` 把棋盘排进 `viewData`，
  不能只靠服务端补发 14508。
- `web/home-features.js` 的 `buttons` 只是强制显示白名单；要隐藏按钮必须进
  `removedButtons`。删除单机菜单按钮时，同步删掉 `web/offline.js` 每秒刷新名单里的 id。
- 战斗提示 `Briefing` 一次只显示一条且队列无上限：`client-prompt-patch.mjs` 已把
  单条时间降到 800ms、队列裁到 6 条。
- NPC 状态位：`1` 可见、`2` 可交互、`4` 可穿过、`8` 有 missionData、
  `16` 每次重读任务、`32` 跳跃图标、`64` 隐藏玩家、`128` 引导 NPC、
  `1024/2048` 初始可见/可交互。`status=2` 是「能交互但看不见」。
  NPC 记录布局：14 头 + 名字/招呼/对话 + 状态/朝向/x/y/范围x/范围y（各 1 字节）
  + `status&8` 时的 6 字节 missionData + 按 npcType 分支。改这类记录必须
  **先按原值原样重建并逐字节比对**，再用 `tools/capture-decoders.mjs` 读回验证。
- 图标 = bagIcon 十进制字符串作全局数值子键；蛋图标 = headIcon；
  资源表是 `305.json` 的 `res.resources`。文本有两套命名空间：
  `GameText`(模块 10) 与 `GameText2`(模块 23)，`STR_ATTR_IGNORE_*` 只在 GameText2。
- 伤害按「逐手武伤 + 逐手攻次」：`client-attack-plan-patch.mjs` 的
  `buildAttackPlan()` 决定每次用哪只手，总攻次不变；空手/拳套/耐久 0/怪物/宠物走单项计划。
- 战斗「查看」面板的 10 个攻击侧字段保留；「生命百分比伤害减免」是按参考实现
  显示的派生值（`min(TOUGH/100,80)%`），与引擎千分比换算有意不同。
  改这一行要同步补丁链长度测试。
- 查询客户端行为**去主包搜协议常量名顺藤读码**，不要凭推断。
  `analysis/modules/` 是可读反编译：道具 0032、宠物 0042、协议表 0019、
  `sendProtoAsync` 0035、图鉴 1147/1150/0179。

## 六、编号约定

- 造型 40101+/40201+，宝石 800401—800405，本地道具 ≥900000，宠物蛋 30000000+，
  封印书 920000000+，技能书 930000000+（后两者 `base+技能号*128+等级`）。
- 800110 = 「点亮所有图鉴」；919 卖训练师教不到的满级技能书；
  遗忘 14003/14006；改名 15511；公告在 `web/offline.js` 的 `applyNotice`。
- 本地 NPC 由 `content.mjs` push 进 `maps[].npcs`（地形之后），编号 0..127。
- 怪物本地号 **21000–32767**（永泽塔困难塔变体）；守卫挑战本地号：
  怪 4200—4208、编队 12100—12103/20501/20502、任务 8901—8933、
  怪物技能 9999:1、AI 4204。

## 七、打包与 APK

- APK 里 `fs.existsSync` 对 `data/**` 恒为 false（VFS 只预载少量文件）。
  用 `try{fs.readFileSync(...)}catch(e){if(e?.code==='ENOENT')…}`。
  守卫：`tests/skill-editor.test.mjs` 禁止 lib 里乱用 `existsSync`。
- `.bat` 必须 **GBK(936) + CRLF**；`.ps1` 必须 **UTF-8 BOM**；
  `.gradle` / `.java` / `.properties` **不能带 BOM**。
  用 Edit 改过 bat 要转回 GBK；bat 里路径别用 `>`。
- 构建指纹必须覆盖 `data/**`，否则只改资料时 WebView 缓存不会清。
- 跑构建前同进程设 `CODEBUDDY_SAFE_DELETE_ENABLED=0`，避免 `cap sync` 被
  safe-delete 保护拦住。
- `构建APK.ps1` 内联了一份 MainActivity 模板，带 `WORLDOL_ACTIVITY_V2` 标记；
  改 MainActivity 必须两处同步。
- 覆盖安装不清 WebView 缓存，已有「构建指纹 + 缓存自愈」；
  **绝不清 localStorage**（存档键前缀 `worldol-fs:`）。

## 八、常见坑速查

- `x||1` 不能判断「是否为零」：`quantity=0` 会被吃成 1。用 `i.quantity!==0`。
- `INITIAL_*` 是初值，不是上限；背包扩展要走 `BAG_EXPAND_STEP`，
  上限 `MAX_BAG_CAPACITY=600`（客户端槽位 30..629，再往上是仓库 630）。
- `itemPacket` 在 `enterWorld→bagPacket→itemPacket` 链上，**宁可降级也绝不抛错**，
  否则整包发不出直接黑屏。
- 奖励表不要引用无定义道具：`planItemRewards` 会整包抛错；
  1759/1760/1770、9300931 等无定义宝箱要跳过并记账。
- 内存标记和存档字段不要各记一份；`persist()` 两边都写，重启以存档为准恢复。
- JSDoc 注释里不要出现 `*/`；跨 `try/catch` 的变量在 try 之前声明。
- 道具 `byte` 字段在 wire 上是有符号字节（`itemSet=-43`、`hitrate=-1`），
  校验范围放 -128..255。
- 怪物 wire 名字是「3 字节长度 + UTF-16BE」，不是 `Reader.utf()`；
  克隆怪只改头 4 字节 id 与名字，写 `utf16le` 会乱码。
- 12016 这类在客户端 `resultMsg` 名单里的协议，回包必须以状态字节开头：
  `byte(0)+定义+byte(套装组数)`；16051 不在名单，回包是纯定义。
- 大目录删除进 F 盘回收站；Gradle 中间产物用 `安卓打包/清理回收站.bat` 清。

## 九、环境与协作

- 命令优先走 WSL/bash；项目在
  `/mnt/f/<项目目录>/世界OL_源码/世界online_原版单机`。
  PowerShell 只在 WSL 不适用时用（GBK 输出、bat/ps1 自检）。
- 跨机器：`.gitattributes` 已把 `data/**` 标成 `-text`，仓库内用 `core.autocrlf=false`；
  不要跑 `git add --renormalize`。公开仓库前先清理本机绝对路径、账号/邮箱等个人信息
  （当前文件与提交历史都要查）。
- `CODEBUDDY_SAFE_DELETE_ENABLED=0` 常设；spawn `node.exe` 常 EBUSY；
  `fs.cpSync` 拷大目录会崩，用 `copyTree()` 或系统 node。
- 打包工具链在 `E:\apk_pack_tool`（`jdk-21` / `android-sdk` / `gradle-home`），
  环境变量 `JAVA_HOME`、`ANDROID_HOME`、`GRADLE_USER_HOME` 都指向这里。
  `环境.ps1` 由 `安装环境.ps1` 生成；改路径要连默认值一起改。
- 删除超长路径目录用 `robocopy <空目录> <目标> /MIR` 清空后再 `rd /s /q`。
- 文档：`docs/memory/` 记录动机和根因；`修复记录.txt` 面向玩家；
  当前参考版本是「幻想世界OL 4.0AI版」，对比报告见
  `docs/对比报告-幻想世界OL4.0AI版-副本数据.md`。
- **协作约定**：AI 只负责改并讲清「改了什么、结论是什么」；打包、起服务、
  上机跑游戏由用户验证。单测/语法检查可以做，但只报结论；要用 E2E、装包、
  远程调试等额外手段前先跟用户说一声。

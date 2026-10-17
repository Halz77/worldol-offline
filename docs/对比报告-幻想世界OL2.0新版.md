# 对比报告：本工程 vs《幻想世界OL 2.0 新版》（另一位开发者）

- 对比对象：`<用户目录>\Desktop\幻想世界OL2,0新版.apk`（131 MB，2026-10-17 23:57）
- 分析日期：2026-10-18
- 说明：下面所有条目都是从对方 APK 里**直接解包读出来**的（原始解包位置见第 10 节），
  不是猜的；少数只能推断的地方标了 ⚠。对方的 `世界OL_字体注入版 (3)_sign.apk`（上次对比用的那份）
  已按用户要求删除，所以「本次新增」只能对照 `docs/memory/2026-10-17.md` 里的旧记录来写。

---

## 0. 一句话结论

**同一份原版客户端 v305、同一套「独立单机服务端」血统的两个分支。**
对方那一支版本号更高（包内自述 v1.7.17、MOD-22/23 之类），
玩法模块比我们多 **34 个服务端模块 + 27 个 web 脚本 + 11 个 client 脚本**，
而且他们额外做了 **联机 / 账号仓库 / 角色佣兵 / PWA 网页版** 这些我们完全没有的东西；
我们那一支的优势是 **23 个客户端补丁链改造**（他们只有 2 个）和 **永泽塔已经能进战斗**（他们还是「待补」占位）。

可移植的东西很多，第 8 节按性价比排了序。

---

## 1. 对方 APK 的基本情况

| 项 | 对方 | 我们 |
| --- | --- | --- |
| 形态 | Capacitor APK **+ PWA 网页版**（`manifest.json`、`worldoffline-sw.js`、`pwa-register.js`、`install.html`、`standalone.html`、`WorldOffline.mobileconfig`） | 只有 APK（`安卓打包/`） |
| 站点根 | `assets/www/`，四个子目录 `client/` `web/` `data/` `analysis/` | `世界online_原版单机/`（`server.mjs` + `lib/` + `web/` + `data/` + `analysis/`） |
| 原版客户端 | **v305，和我们是同一份**：主包同名 `client/js/ff/fff570bb4753f056432680e781d827dc.js`，`analysis/modules` 都是 1613 个文件 | 同左 |
| 主包形态 | **被格式化过**（33,680 行 / 5,355,561 B）＋**构建期打好了补丁**（内嵌 hook 点） | 保持原样压缩（138 行 / 4,696,705 B），补丁在**运行时**用字符串替换打（`lib/client-*-patch.mjs`） |
| 服务端 | `assets/www/client/worldol-standalone.js`，1,374,947 字符 / 30,396 行，**未压缩**，模块边界是 `// lib/xxx.mjs` 注释（能直接切出 127 个模块） | `lib/*.mjs` 146 个文件（ESM，服务端直接 import） |
| 数据格式 | **混用**：部分文件美化缩进（如 `career-skills.json` 50 万行），部分压缩成一行（如 `official-v305.json`） | 与对方**正好相反**（`career-skills.json` 压缩 2 行，`official-v305.json` 美化 100 万行）→ **字节数完全不可比，必须按 JSON 内容比** |
| 自有素材 | 有：`client/assets/ghent/*.webp`（神之都根特自绘场景）、`client/banner/voice-data.js`（技能语音） | 无 |

服务端模块对比：**他们 127 个（打包产物里能看到的）/ 我们 146 个，重名 94 个**。

---

## 2. 他们有、我们没有 —— 服务端模块（34 个）

> 行数=我从他们 bundle 里切出来的模块行数。表格按「整块玩法」分组。

### 2.1 佣兵 / 联机账号（上次对比就评价「性价比最高」）

| 模块 | 行数 | 干什么 | 关键编号 |
| --- | --- | --- | --- |
| `mercenary.mjs` | 287 | 佣兵合同/状态机（SLEEP/FIGHT/SACK），用 `window.__wolRealNow` 真实时间，出战上限 2 | 原生协议 15503–15510 |
| `mercenary-data.mjs` | 148 | 本地佣兵商品与店铺（4 普通 + 4 精英 + 狂战士珍尼） | 编队 28001–28009；店 20003/20007/20010/20011 |
| `player-mercenaries.mjs` | 141 | **角色佣兵**：把玩家自己的角色做成永久副本 | 协议 **90030**，编号 30000–30999 |
| `player-mercenary-snapshot.mjs` | 104 | 角色佣兵的完整原生战斗快照（双持/回复/武器技能，Monster 包表达不了） | — |
| `account-storage.mjs` | 1234 | **账号仓库**：同账号角色共享，容量 300，需先解锁城市 | 协议 **90040** |

### 2.2 副本（他们把「挑战类副本」做成一套修复框架）

| 模块 | 行数 | 干什么 |
| --- | --- | --- |
| `dungeon-challenge-repairs.mjs` | 412 | **11 项挑战型副本本地重建**：光之试炼(1051)、暗之试炼(1053)、虚空幻境(1605)、十殿阎罗(3972)、凋羽台之争(1940)、沙漠奇美拉(3103)、追捕逃犯(2564)、千年魔牛(2453)、精英沙漠炎帝(2769)、**BOSS挑战赛(1305，棋盘)**、**跨服副本·单机合作(9100，五连战)**；外加修复 BOSS 代金券店 **2061** |
| `dungeon-repairs.mjs` | 128 | 8 个日常副本的导航/重玩整合（刺杀行动/玛雅/晴菜与精灵/幻兽/火焰/机械城/后续两条）＋补一个「姬无丹」平民决斗（1838） |
| `dungeon-reward-repairs.mjs` | 297 | 副本奖励本地化：给缺定义的任务奖励补箱子/代币定义，发不出的记「欠账回执」（数据 `dungeon-reward-repairs.json`） |
| `dungeon-reset.mjs` | 80 | **副本刷新**（协议 **90022**）：一键跑一次每日重置，并把「每日/可重复任务 + 日常任务链」从 `questHistory` 里清掉（否则刷新后仍被判已完成） |
| `team-dungeon-data.mjs` | 159 | 团队副本 + **太阳神殿/英雄挑战赛**：用捕获包重建怪物与编队；怪的血按 `捕获值 × mult`（龙/红名 20、其他 10）；`SOLAR_CHALLENGES` 6 档（2592/2593/2594/2596/2605/2597/2606），按 `fighters` 裁剪对手；**轩姐古龙直挑**单独克隆（26207，血量=捕获 2320×3＝4.2 亿，`tough+300`＝30% 物理魔法减伤），AI 一起克隆并把 `wireBase64` 前 2 字节 BE 改成新 id |
| `team-dungeon-service.mjs` | 159 | 团队副本棋盘（13 个点位、事件文本 600–619：加索/苦行僧/锁链巨力/寒冰之心/浪漫刺客/自由之剑/狂蛇枪客/魔翼狂刀/阳炎/魔弓邪眼/西域刺客/御林军银枪/鹰首智华/红袍法师/巨龙） |

### 2.3 宠物

| 模块 | 行数 | 干什么 |
| --- | --- | --- |
| `pet-skill-abandon-service.mjs` | 80 | **宠物技能遗忘/逐级遗忘**（协议 14003 / 14006，请求带 requestId 防重放） |
| `pet-skill-abandon-levels.mjs` | 80 | 遗忘前的技能字节布局校验 |
| `choose-pet-egg.mjs` | 32 | **自选传说宠物蛋**（先选正常/进化形态 → 搜名字 → 输入 1–97 级；与传说蛋同池 146 种） |
| `pet-item-definitions.mjs` | 12 | 宠物回春石（40005，寿命重置 100 天，过期宠物也能用） |
| `pet-illusion.mjs` | 100 | 宠物幻化（style 1–52，排除 4/17/46/50；池来自 `pet-catalog.json`，按 legendary/recorded/catalog 三级优先） |

> 注：宠物技能遗忘我们其实**已经有**（`lib/restoration-service.mjs` 里处理 14003/14006），
> 我们缺的是他们的「逐级遗忘」和客户端那半套 UI（见 4.2）。

### 2.4 外观 / 城镇

| 模块 | 行数 | 干什么 |
| --- | --- | --- |
| `salon.mjs` | 1179 | **美容院**：更换发型 / 脸型 / 全新发型，商店清单与改外观都在服务端做（不依赖客户端那条 `updateHair` 分支）；含 120 条配色名表。协议 **12081/12082**，店 51/52/55 |
| `icon-appearance.mjs` | 277 | `icon1` 形象字段的位偏移编解码（发型/发色/脸/手/脚/头盔 的 style/color 段） |
| `ghent-region.mjs` | 51 | **神之都根特**：新区域（id 61）+ 5 座城镇，走原生地图/NPC/商店/传送协议；数据是自绘 webp 场景（`data/ghent-region.json` + `data/maps/6100..6104.json` + `client/assets/ghent/*.webp`） |
| `custom-sprites` 相关 | — | 自定义贴图清单 `custom-sprites.json` |

### 2.5 装备 / 道具

| 模块 | 行数 | 干什么 |
| --- | --- | --- |
| `custom-equipment-data.mjs` | **2734** | 自定义装备表：神话武器（龙形坐骑 9300001、星弓 9300002、飞景/流彩剑 9300003/9300004…）、配套技能 8101–8104+（飞景·华星/丹霞流转…22 级合成）、双持合成规则 |
| `dormant-mounts-data.mjs` | **5620** | **休眠坐骑 128 件**（9300031–9300127）+ 鉴定槽池（power/取值区间），数据 `data/dormant-mounts.json` |
| `ported-gear-rules.mjs` | 38 | 移植装备 9300018–9300029 的 power 缩放规则（含「位面核心」按星级加成） |
| `mythic-chest.mjs` | 61 | **神话装备箱** 9300930，5% 掉率，池 = 自定义装备表去掉移植件/坐骑/下架件 |
| `supply-boxes.mjs` | 313 | **宝箱/补给箱开启**统一规则：识别箱类模板（type45 / power1∈{100,101,102,183,184}）、装备箱按名分类（防具箱不出武器）、品质随机、文案与实际发放统一；含 **40048 大额充值赠送** 的强制登记。数据 `data/drop-catalog.json`、`box-rewards.json` |
| `removed-items.mjs` | 26 | 下架道具清理：9300009–9300014（翅膀背饰版，用户实测否决后整体撤除），扫背包+已删角色 |

### 2.6 任务 / 剧情 / 城市

| 模块 | 行数 | 干什么 |
| --- | --- | --- |
| `custom-adventures.mjs` | 132 | 自定义冒险剧情链（带证据链注释）：81 级后续（902–922、1421–1430）、太阳神地下宫殿（3219 + 8700–8709 + 1824）；含「120 级条件按对白适配为 81 级」等本地说明。数据 `data/custom-adventure-notes.json` |
| `city-progress.mjs` | 5 | 城市升级判定（3002–3005） |
| `city-template-fixes.mjs` | 90 | 城市模板 NPC 修复：任务公告板开状态位、市长对白改成「扩建后」版本（改前先用 Reader 读回校验 `wireBase64`） |
| `maya-progress.mjs` | 13 | 玛雅旧任务进度迁移归档（3220–3226、1823） |
| `ghent-region.mjs` | 51 | 见 2.4 |

### 2.7 其他

| 模块 | 行数 | 干什么 |
| --- | --- | --- |
| `ask-sword-data.mjs` | 194 | **问剑十一峰** 三档（2604 初级 lv50 / 2650 中级 lv60 / 2651 高级），怪缩放 1 / 1.7 / 2.6，押金与奖励不同；地图 37，NPC 11，终点 100 |
| `ask-sword-service.mjs` | 179 | 问剑棋盘（13 个点、连接关系、进度持久化到任务） |
| `actor-service.mjs` | 42 | 用**改名卷轴 40016** 改名（协议 11038），带失败回滚；我们对应 `role-rename-service.mjs`，功能等价 |
| `achievement-service.mjs` | 112 | 成就（含神话称号批次 mythicSpear/Fan/Chunqiu 等自定义指标）；我们对应 `achievements.mjs` |

---

## 3. 他们有、我们没有 —— 客户端

### 3.1 主包里嵌的 hook 点（他们构建期注入，`window.*` 回调）

这才是他们客户端改造的**主线**：主包里只埋回调，功能代码全在外挂脚本里。

| hook | 作用 |
| --- | --- |
| `window.worldolEquipmentRepairPlan(player, slot)` | 装备修理计划（装备详情窗） |
| `window.__worldolGlowPick/GlowPrep/GlowFragPick/GlowBtnInstall` | 宝石光效自选 |
| `window.__worldolWeaponDye(e,t)` + `__worldolDyeBtnInstall` | 武器染色按钮与取色 |
| `window.__wolRealNow()` | 真实时间（佣兵合同、到期时间、团队回合）——绕开被加速的游戏时钟 |
| `window.__wolMythicSkillText(e)` | 神话技能详情文本 |
| `window.__worldolRuntimePart(e,t)` + `runtime://` 伪 URL | **运行时资源替换**（自定义图标/贴图直接喂引擎） |
| `window.worldolNativeOnline` | 联机（战斗玩家、配置战斗、战斗结束） |
| `view.__wolCityIncome` | 城市面板加一行「金库收入」 |
| `window.worldolDungeonRepairs.TabMdr` | 日常任务页加「副本进度」页签 |
| `window.__wolTitleColors` / `__wolMythicTitles` / `__wolTitleGlow` | 称号颜色表 + 神话称号流光（含 `__wolTitleGlowTimer` 每 80ms 重绘） |
| 模块 0056：属性上限写死 `100000` | 放开属性上限（我们是 `MAX_OTHER_ATTRIBUTE`） |
| 模块 0008 `getHeadIndex`：去掉 `t==EAST` 国家判断 | 头像/原画索引只按性别+职业（`jingji_pic_*`） |
| 模块 0426：创角按钮文案 `创建角色` → `创角角色` | 他们改了一个字 |
| 模块 1147/1149：图鉴全亮 | ⚠ 这两处**只在他们的 `analysis/modules` 里**（`worldol_handbook_all_lit`），**现网主包里没有**（详见 3.4） |

### 3.2 他们的 `client/worldol-*.js`（独立脚本，11 个）

**注意：这些大多是「运行时找 webpack 模块再 hook」，不一定要改主包**——挂 `<script>` 就能用，
这对我们是个好消息（我们的 `web/` 也是被服务端直接 serve 的）。

| 脚本 | 大小 | 作用 |
| --- | --- | --- |
| `worldol-float-text.js` | 161 KB / 2203 行 | **战斗浮动跳字**（伤害/暴击/扣蓝/衰弱/流血到目标头顶）；只观察不干预，hook 0243 BufferedNumEffect |
| `worldol-skill-banner.js` | 57 KB / 1079 行 | **技能演出 + 语音**（v1.7.4；`client/banner/voice-data.js`） |
| `worldol-mythic-quality.js` | 64 KB / 1123 行 | **神话品质镭射全息流光**（v3.2.2，含「任务介绍文本误命中流光」的修复） |
| `worldol-mythic-combat.js` | 14 KB / 267 行 | 神话武器战斗补丁（0251 演算类；天生状态压制、星落技能兼容） |
| `worldol-custom-icons.js` | **718 KB** / 180 行 | 自定义装备图标注入（v1.0.0；2026-10-01 起对现网物品已无引用，但支持 9416–9512 那批 bagIcon 键） |
| `worldol-identify-picker.js` | 11 KB | **[MOD-22] 鉴定自选**：鉴定不再随机，弹窗列全部可选属性（协议 11577/11578） |
| `worldol-attr-fast.js` | 9 KB | **[MOD-23] 快速加点**：属性界面右侧 +100/−100 按钮 |
| `worldol-shop-probe.js` | 19 KB | 商店直通 v1.8.0：修 11601–11603 技能书格点不动、修美容院 51/52/55/10052/10057 被 `go.openPay=false` 挡住 |
| `worldol-handbook-lit.js` | 7 KB | 图鉴一键点亮 v3.0.0（`localStorage: worldol_handbook_all_lit` + 常驻守护按钮） |
| `worldol-pet-skill-abandon.js` | 13 KB | 宠物技能遗忘 UI（全部 / 逐级） |
| `worldol-battle-attr-cache.js` | 9 KB | 战斗属性查询缓存（**这个我们已经有了**：`web/worldol-battle-attr-cache.js`） |
| `worldol-standalone.js` | 1424 KB | 服务端 bundle（服务端，不是客户端脚本） |

### 3.3 他们的 `web/*.js`（54 个，比我们多 27 个）

| 新增脚本 | 作用 |
| --- | --- |
| `native-online.js`（899 行） | **联机**：共享回合（用 wall time）、原生协议桥 |
| `online-account.js`（416） | 在线账号/存档云备份（`/api/online`、IndexedDB 备份） |
| `online-world.js`（10）/ `online.css` / `online-world.css` | 联机世界入口（old name 保留给菜单引导） |
| `account-storage.js` + `-html.js` + `-native.js` + `.css` | 账号仓库 UI |
| `player-mercenaries.js`（160） | 角色佣兵窗口 |
| `gm-console.js`（257） | **GM 控制台**（移植自他们的 nodejs-project；走 `/api/gm/*`，用 `window.fetch` 模拟） |
| `standalone-save.js`（280） | 独立版存档导出/导入/回滚（`window.worldolSave.*`） |
| `phone-menu.js`（247） | **手机悬浮 HTML 菜单**（不依赖 egret 触摸管线；`worldolPhoneHtmlDialogs=true` 让功能窗走原生 HTML） |
| `weapon-dye.js`（557） | 武器染色（色相环调色板，运行时 Canvas 调色） |
| `runtime-dye.js`（622） | 运行时调色共享核心（武器 + 宝石光效共用） |
| `glow-color.js`（776） | 宝石光效自选（可逐武器、双持分别设色） |
| `equipment-workspace.js` + `-html.js` + `-native.js` + `.css` | 装备工作台（改造/强化一体化窗口） |
| `exchange-tools.js`（314） | 交易所「一键挂售史诗及以上」 |
| `ghent-world.js` + `.css` | 神之都根特：地区图 + WebP 场景/NPC |
| `dungeon-repairs.js`（226） | 「副本进度」面板（挂进日常页签） |
| `dungeon-refresh.js`（41） | 「副本刷新」按钮 |
| `battle-log.js`（150） | 战斗日志环形采集（静默，`__wolBattleLog.exportFile()` 导出） |
| `choose-pet-egg.js`（211） | 自选传说宠物蛋三步窗口 |
| `native-engine-version.js` | 引擎版本探测 |
| `viewport.js`（108）/ `role-slots.js`（66） | 我们有同名文件但更小（各 3 KB / 2 KB vs 6 KB / 4 KB） |

### 3.4 主包实际改动只有 5 个函数级差异（重要）

两边的 `analysis/modules`（1613 个）逐一哈希对比，**只有 5 个文件不同**：
`0008.js`、`0056.js`、`0426.js`、`1147.js`、`1149.js`。
其中 `0008 / 0056 / 0426` 的改动在对方主包里能对上，`1147/1149`（图鉴全亮）**对不上**
（对方主包里 `worldol_handbook_all_lit` 出现 0 次）→ 对方 APK 里那份 `analysis/` 与主包**不是同一次构建**，
是随包带的旧产物，只能当参考。

结论：他们的客户端改造**几乎全在「hook + 外挂脚本」**上，主包本体改得极少（3 处）。
我们的路线正好相反（字符串替换 20 多个补丁点）。**两条路线可以并存**：
他们那套外挂脚本，我们只要照抄脚本 + 在自己补丁链里加对应 hook（或干脆不改主包）就能吃下。

---

## 4. 我们有、他们没有

### 4.1 我们独有的服务端功能（29 个模块）

- **永泽塔** `climb-tower.mjs` + `tower-shop.mjs`：**我们已经能进战斗**（第 69 版），
  他们还是占位（见第 7 节）
- **太阳棋盘** `solar-challenge-data.mjs` / `solar-challenge-service.mjs`（我们的太阳棋盘；
  他们把同类需求做进 `team-dungeon-data.mjs`）
- **无限试炼** `trial-challenge.mjs` / `trial-challenge-data.mjs`
- **BOSS 枢纽** `boss-hub.mjs`（他们对应的是 `dungeon-challenge-repairs` 里的 1305 BOSS挑战赛）
- **派遣/护送线**：`lost-soul-desert.mjs`、`memorial-npcs.mjs`、`mid-autumn-final-boss.mjs`（中秋终战）
- **本地内容**：`local-items.mjs`、`local-gems.mjs`、`local-fashion.mjs`、`fashion-icons.mjs`、
  `local-career-skills.mjs`、`local-skill-overrides.mjs`（技能效果覆盖）、`equipment-direct-grants.mjs`
- **服务端骨架**（对方是打包成一个 bundle，所以这些名字在他们那里看不到，不代表他们没有）：
  `protocol-constants.mjs`、`protocol-dispatch.mjs`、`http-routes.mjs`、`lazy-data.mjs`、
  `generated-globals.mjs`、`reference-fields.mjs`、`role-list.mjs`、`dungeon-challenge-data.mjs`、
  `pet-rename-service.mjs`、`illusion-policy.mjs`、`role-rename-service.mjs`

### 4.2 我们独有的客户端补丁链（他们只有 2 个）

我们：`lib/client-*-patch.mjs` + `client-patch-chain.mjs`（20 个补丁 + 链）
—— 背包、怪物血蓝条、战斗检查、战斗字体(模块180)、法力回复、战斗技能面板、战斗倍速持久化(1/3/5)、
伤害、护送战斗开关、幻化、军团×3（含宠物守护/幸存者）、任务、怪物回复、幻影免疫、进阶、角色删除、
武器图标、武器槽位。

他们（本版 bundle 里只剩）：`client-progression-patch.mjs`、`client-combat-limits.mjs`。
（`client-progression-patch` 我们也有；上次对比时他们还有 `battle-font-module180`——
**本版已经没有了**，而我们的战斗字体补丁是从他们那份「字体注入版」移植来的，等于我们保住了。）

⚠ 但要说清：客户端补丁**数量少不等于功能少**——他们用 hook+外挂脚本做了另一批我们完全没有的
客户端功能（跳字/流光/染色/光效/鉴定自选/快速加点/商店直通/图鉴点亮/手机菜单/副本进度页签/属性上限…）。

---

## 5. 数据文件差异

### 5.1 他们独有（10 个）

| 文件 | 大小 | 用途 |
| --- | --- | --- |
| `box-rewards.json` | 19 KB | 宝箱/补给箱奖励表 |
| `community-titles.json` | 9 KB | 社区称号（他们把称号从 `recorded-content.json` 挪到了这里） |
| `custom-items-v2.json` | 256 KB | 自定义道具定义（神话武器/坐骑/移植装备…） |
| `custom-sprites.json` | 2 KB | 自定义贴图清单 |
| `custom-adventure-notes.json` | 3 KB | 自定义冒险的证据链与本地适配说明 |
| `daily-dungeon-expansion.json` | 18 KB | 日常副本扩展 |
| `dormant-mounts.json` | 18 KB | 休眠坐骑清单（128 件） |
| `dungeon-reward-repairs.json` | 27 KB | 副本奖励本地化 + 欠账回执 |
| `ghent-region.json` | 10 KB | 神之都根特（区域 61、5 镇 6100–6104） |
| `vip-task-materials.json` | 0 KB | VIP 任务材料（空壳） |

### 5.2 我们独有（9 个）

`local-career-skills.json`(119KB)、`local-skill-overrides.json`(3KB)、`fashion-icons.json`(17KB)、
`solar-challenge-monsters.json`(101KB)、`tower-shop.json`(1KB)、`equipment-skill-levels-extra.json`(2KB)、
`pet-import-20260923.json`(2KB)、`SOURCES.md`(12KB)、`maps/277.json`(18KB)

### 5.3 同名但内容不同（按 JSON 内容比，不是字节）

| 文件 | 差异 |
| --- | --- |
| `official-v305.json` | 他们 `identification` 1045 vs 我们 1008（+37）、`items` 2507 vs 2505（+2）；**其余 20 个顶层键完全一致** → 主体同源 |
| `recorded-content.json` | 我们 `titles` **138** vs 他们 **20**（他们把称号挪去 `community-titles.json`）；他们 `petSkills` 457 vs 我们 456 |
| `recorded-expansion-20260922.json` | 我们 `missions` **889** vs 他们 850（+39）、`maps` 87 vs 86 |
| `equipment-sets.json` | 他们 `sets` **203** vs 我们 192（+11 套） |
| `item-affix-layouts.json` | 他们 `items` **2178** vs 我们 2136（+42） |
| `native-commerce.json` | 我们 `items` 78 vs 他们 73（+5） |
| `boss-challenges-v1.json` | 我们 groups/missions 各 3 vs 他们 2（我们多 1 项） |
| `career-skill-directory.json` | 我们 474 vs 他们 470（多的是我们本地 4 个：465/652/653/757） |
| `career-skills.json` | **两边都是 470 个技能**；316 条内容不同，我们普遍更「重」（多 `sources`/blobs 字段，总差 +212 KB）——所以**我们这份其实更全**，不用急着同步 |
| `restored-v03.json` | 我们 equipment 15 vs 他们 14 |
| `drop-catalog.json` | `policy` 我们 9 键 vs 他们 8 键 |
| `yunruo-temple-v1.json` / `captured81-20260926.json` | 结构一致，个别字段长度略差，要逐条 diff 才有意义 |

`data/maps/*.json`：我们 161 个、他们 160 个，只差我们自己的 `maps/277.json`。
`data/references/world-online-221f8cf/*.json`：6 个文件**完全一致**（artifact / enchantAttribute /
petInnateAttribute(+-older) / talent / vocationalSkills）。

---

## 6. 他们也有「半成品」（别照抄这些）

他们的单机功能清单里有明确写着「待补」的项：

- **永泽塔**：`["tower","永泽塔","普通120层、困难12关及160种怪物属性预览；阵容、技能、AI与场景待补。"]`，
  且 30003/30005 直接抛错：
  `"永泽塔战斗阵容、技能、AI与场景尚未录全，挑战和扫荡待补。已采集的132个关卡可查看怪物属性。"`
  → **这一块我们现在反而领先**（第 69 版已能进战斗）
- **矿洞**：`"已采集5个矿点入口及次数配置；产出、宠物驻守与战斗规则待补。"`
- **抽奖**：`"已恢复录制奖池和价格；概率与抽奖结算待补。"`

---

## 7. 移植建议（按性价比排序）

### 第一档：纯服务端 / 我们有现成 UI 入口，能直接吃

1. **副本刷新 `dungeon-reset.mjs`（90022）**——他们只需要一个按钮，我们 `web/offline.js` 单机菜单里加一项就行。
   收益立竿见影（不用等到次日才能再打副本/挑战赛）。
2. **挑战型副本修复 `dungeon-challenge-repairs.mjs`（11 项）**——上次对比就点出：我们只做了前 9 项，
   缺 **1305 BOSS挑战赛（棋盘）**、**9100 跨服副本（五连战）** 和修复 BOSS 代金券店 **2061**。
3. **佣兵系统**（`mercenary` + `mercenary-data` + `player-mercenaries` + `player-mercenary-snapshot`）——
   上次评价「性价比最高」；复用原生 15503–15510 协议，加 90030。
4. **休眠坐骑**（`dormant-mounts-data.mjs` 5620 行 + `dormant-mounts.json` + 鉴定池）——
   我们第 64 版移除过，这次可以整体搬（含图标键 9416–9512 与 `worldol-custom-icons.js`）。
5. **问剑十一峰**（`ask-sword-data/service`，2604/2650/2651，棋盘地图 37）。
6. **补给箱/宝箱统一开启 `supply-boxes.mjs` + `box-rewards.json`**——顺带解决 40048 大额充值赠送、
   装备箱分类（防具箱不出武器）、「简介写了几率」的箱子。
7. **神话宝箱 `mythic-chest.mjs`（9300930，5%）**。
8. **下架道具清理 `removed-items.mjs`（9300009–14）**——一次性小模块。
9. **美容院 `salon.mjs`（12081/12082 + 店 51/52/55）**——我们现在只在「商店白名单」那一层碰过美容院，
   他们是整套（含 120 条配色名）。
10. **形象字段 `icon-appearance.mjs` + `custom-sprites`**——改外观类功能的底座。
11. **人物技能书 `player-legend-skill-books.mjs`（14007/14008）** + **自选传说宠物蛋 `choose-pet-egg.mjs`**
    + **宠物回春石 `pet-item-definitions.mjs`** —— 都是小模块。
12. **账号仓库 `account-storage.mjs`（90040）**——纯服务端，配他们的 `web/account-storage*.js` 更完整。
13. **城市/玛雅小补丁**（`city-progress`、`city-template-fixes`、`maya-progress`）——都是几十行。
14. **移植装备规则 `ported-gear-rules.mjs`（9300018–9300029）** + **自定义装备表 `custom-equipment-data.mjs`**。
15. **团队副本/太阳神殿 `team-dungeon-*`**——注意他们对「太阳神殿打不动」的处理：
    怪按捕获值×mult 重建、按 fighters 裁对手、古龙单独克隆（26207）；我们 `solar-challenge-*`
    当年只有注释没实现，可以对照搬。
16. **自定义冒险剧情 `custom-adventures.mjs`**（81 级后续 + 太阳神宫殿 8700–8709）。
17. **神之都根特**（`ghent-region.mjs` + `ghent-region.json` + `maps/6100–6104` + `client/assets/ghent/*.webp`
    + `web/ghent-world.js`）——工作量中等（要带自绘素材），但**是全新区域**，观感收益大。
18. **成就 `achievement-service.mjs`**（我们已有 `achievements.mjs`，可对比他们的自定义指标写法）。

### 第二档：照抄外挂脚本 +（可选）在自己补丁链里加 hook

他们的这些脚本都是「运行时找 webpack 模块 hook」，**不改主包也能挂**（他们的 index.html 就是直接
`<script src="worldol-xxx.js">`）。我们可以把脚本放进 `web/`（我们的站点本来就 serve 这个目录），
在 `web/index.html` 里加 script 标签：

- 战斗浮动跳字 `worldol-float-text.js`（我们目前是「原生跳字」路线，这是增强版）
- 神话品质流光 `worldol-mythic-quality.js` / 神话战斗 `worldol-mythic-combat.js`
- 技能演出+语音 `worldol-skill-banner.js`（需 `banner/voice-data.js`）
- 鉴定自选 `worldol-identify-picker.js`（协议 11577/11578，服务端要配套）
- 快速加点 `worldol-attr-fast.js`
- 商店直通 `worldol-shop-probe.js`
- 图鉴一键点亮 `worldol-handbook-lit.js`
- 宠物技能遗忘 UI `worldol-pet-skill-abandon.js`
- 武器染色 `weapon-dye.js` + `runtime-dye.js`、宝石光效 `glow-color.js`（纯运行时 Canvas 调色）
- 装备工作台 `equipment-workspace*.js`
- 交易所一键挂售 `exchange-tools.js`
- 手机悬浮菜单 `phone-menu.js`、独立版存档管理 `standalone-save.js`
- 副本进度面板 `dungeon-repairs.js` + 刷新按钮 `dungeon-refresh.js`
- 战斗日志 `battle-log.js`（排障利器）

需要**改主包**（加 hook）的只有少数：装备修理计划、副本进度页签、城市金库收入行、
称号颜色/神话称号流光、属性上限 100000、头像 `jingji_pic` 去国家限制。

### 第三档：大工程（要不要做另说）

- **联机**：`native-online.js`(899) + `online-account.js`(416) + `online-world.js` + `/api/online` + 账号仓库。
- **GM 控制台**：`gm-console.js` + `/api/gm/*`（他们是移植自 nodejs-project，用 `window.fetch` 模拟）。
- **PWA 网页版**：`manifest.json` + `worldoffline-sw.js` + `pwa-register.js` + `install.html` +
  `standalone.html` + iOS `mobileconfig`（想「不开 APK 也能玩/可安装到桌面」时再做）。

### 不建议照抄

- 他们的永泽塔/矿洞/抽奖占位（我们永泽塔已经更好）
- 他们的 `analysis/` 随包产物（与本包主包不一致，会误导）
- 他们改主包创角按钮为「创角角色」这种文案改动（看着像笔误）

---

## 8. 值得学的工程习惯（不涉及功能）

1. **代码里留证据链注释**：capture id + 官方公告 URL + 「为什么本地适配」。
2. **改 `wireBase64` 前先 Reader 读回校验**，不一致直接 throw（`city-template-fixes`）。
3. **数据冲突/编号撞号直接 throw**，不静默覆盖（`captured81`、各 `localReconstruction`）。
4. **协议布局标注来源工厂号**（如「Original 15503-15510 layouts are recovered from client factories 18/91/102」）。
5. **注释写「为什么」不写「是什么」**。
6. 他们那份 `worldol-standalone.js` **不压缩**，模块之间留 `// lib/xxx.mjs` 边界注释
   → 对方自己/别人都能直接切模块读；这一点我们可以学（我们本来就是分文件，OK）。

---

## 9. 与上次对比（`世界OL_字体注入版 (3)_sign.apk`，versionCode 1.26.1017）的差异

上次结论记在 `docs/memory/2026-10-17.md`（旧 APK 与旧报告已按用户要求删除）。对照如下：

| 项 | 上次（字体注入版） | 本次（幻想世界OL2.0新版） |
| --- | --- | --- |
| 服务端模块数 | 123 | **127** |
| 太阳血量方案 | `SOLAR_HP_DIV` / `SOLAR_HP_FIX`（team-dungeon-data 58–100 行） | ⚠ **这两个标识已不存在**；改为 `SOLAR_CHALLENGES`（6 档，按 `fighters` 裁对手、血按捕获值×mult）+ 古龙直挑克隆 26207 |
| 幽暗城 5 图 | 有 | **`幽暗城` 出现 0 次**；本次是**神之都根特**（区域 61、5 镇、自绘 webp）——疑为同一批新场景的重做/改名 |
| 客户端补丁模块 | 他们 3 个（progression / combat-limits / battle-font-module180） | 他们 **2 个**（progression / combat-limits）；**battle-font 没了** |
| 上次未记录的本次新增 | — | 联机（native-online/online-account/online-world）、账号仓库、角色佣兵、GM 控制台、手机悬浮菜单、独立版存档管理、装备工作台、交易所一键挂售、副本进度/刷新、战斗日志、鉴定自选、快速加点、商店直通、图鉴点亮、称号颜色与流光、属性上限放宽、头像索引、技能演出语音、神话流光 |
| 上次已记录、本次仍在 | 佣兵、问剑十一峰、团队副本+英雄挑战赛、休眠坐骑、自定义冒险、玛雅宫殿、捕获81、补给箱、城市模板修复、dungeon-challenge-repairs 11 项 | 同左，全部仍在 |

---

## 10. 附录：本次分析的产物位置（都在临时目录，可能被清）

对方 APK 解包（我只解了 `assets/www/{client,web,data,analysis}`，没解资源二进制）：

- `<用户目录>\AppData\Local\Temp\opencode\fxol2\`
  - `client\worldol-standalone.js` —— 他们的服务端 bundle（未压缩，可直接读）
  - `client\worldol-*.js`、`client\index.html`、`client\standalone.html`、`client\standalone-files.json`
  - `web\`（54 个）、`data\`（214 个）、`client\js\ff\fff570bb….js`（他们打好补丁的主包）
  - `analysis\modules\`（1613 个）
- `<用户目录>\AppData\Local\Temp\opencode\cmp\`
  - `theirlib\` —— 从 bundle 切出来的 **127 个 `lib/*.mjs`**（可逐个 grep/对比）
  - `lib-diff.txt`（模块清单差异）、`data-diff.txt`、`web-list.txt`、`analysis-diff.txt`（5 个差异模块）、
    `client5-diff.txt` / `client5-pos.txt`（客户端差异细节）、`hooks.txt`、`topshape.txt`（JSON 内容对比）、
    `bundle-markers.txt`（主包 hook 点）、`theirs-misc.txt`、`client-scripts-heads.txt`、`theirs-extra.txt`、
    `shape2.txt` / `shape3.txt`（数据内容对比）、`kw.txt`（功能词汇频次）

> ⚠ 这些是 **131 MB 解包产物 + 中间结论**，我没有写进仓库（`data/*.json` 有一字节不改的规矩，
> 对方的解包也不该混进来）。要长期留着的话说一声，我把它挪到项目里某个 gitignore 目录。

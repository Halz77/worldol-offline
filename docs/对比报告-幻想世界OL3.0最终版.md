# 对比报告：本工程 vs《幻想世界OL 3.0 最终版》（另一位开发者）

> ⚠ **历史文档（2026-10-19 起停止参考）**：用户已明确不再参考 3.0，桌面上的
> `幻想世界OL，3.0最终版.apk` 与解包产物（`%TEMP%\opencode\fxol3\`、`fxol3lib\`）都已删除。
> 这份报告只作为当时的证据链保留 —— 里面的结论**只对 3.0 成立**，不要再拿来当「4.0 也是这样」。
> 新参考版本是「幻想世界OL 4.0AI版」，到手后重新解包、重跑对比。

- 对比对象：`<用户目录>\Desktop\幻想世界OL，3.0最终版.apk`（131.74 MB / 12793 条目 / 内部构建时间 2026-10-18 12:44）
- 分析日期：2026-10-18（同一天对上的两份包）
- 解包位置：`%TEMP%\opencode\fxol3\`（= 对方 APK 的 `assets/www/`，**已跳过 10828 个 `client/assets` 资源文件**，1951 个文件 / 178.55 MB）
- 上一轮（对方 **2.0**）的对比见 `docs/对比报告-幻想世界OL2.0新版.md`；本报告末尾第 7 节专门写「3.0 相对 2.0 变了什么」。
- 说明：下面所有条目都是从对方包里**直接解包读出来的**，不是猜的；只有一处标了 ⚠ 表示来源无法确定。

---

## 0. 一句话结论

**同一份原版客户端 v305、同一套「独立单机服务端」血统的两个分支，第二次对上，差距明显在缩小。**

- 对方这版把 **服务端 bundle 加密了**（XOR 0x5A + Base64，2.0 是明文），但解密后模块数还是 **127 个**，
  和我们重名 **98 个** → 骨架基本同源，差异集中在「玩法层」。
- **他们 3.0 最大的动作是把上次还抛错占位的『永泽塔 / 无限试炼 / 问剑十一峰』真的实装了**，
  而且永泽塔的客户端桥（`World.addMonsterGroup` + `23000+层号`）和我们第 69 版**同一套做法**。
  也就是说：**上次我们「永泽塔领先」这条优势，这次没有了**。
- 我们这边的优势换成三块：**① 客户端补丁链 24 个（他们只有 2 个）**、
  **② 本地内容/本地数据（跨服五连战 9100–9124、地图 277、138 条称号、8 条日常副本链、日 4 技能/掉落倍率）**、
  **③ 明确不要的箱子/奖励体系我们没做（他们做了 300+ 行）**。
- 他们比我们多的东西仍集中在：**佣兵（4 模块）/ 账号仓库 / 联机 / 装备工作台 / 武器染色+宝石光效 /
  怪物·物品编辑器生态（18 份独有数据）/ 根特新区域 / 一批 `worldol-*.js` 外挂脚本**。

---

## 1. 基本情况对照

| 项 | 对方 3.0 | 我们 |
| --- | --- | --- |
| 形态 | Capacitor APK **+ PWA 网页版**（`manifest.json`、`worldoffline-sw.js`、`pwa-register.js`、`install.html`、`standalone.html`、`WorldOffline.mobileconfig`） | 只有 APK（`安卓打包/`） |
| 站点根 | `assets/www/`：`client/`（10883 文件，含 10828 个资源）`web/`(57) `data/`(224) `analysis/`(1613) | `世界online_原版单机/`：`server.mjs` + `lib/`(**151** 个 `.mjs`) + `web/`(28) + `data/`(213) + `analysis/`(1613) |
| 原版客户端 | **同一份 v305**：主包同名 `client/js/ff/fff570bb4753f056432680e781d827dc.js`；`analysis/modules` 都是 1613 个，**逐文件哈希只有 5 个不同** | 同左 |
| 主包形态 | 格式化 + **构建期打好补丁**：5,367,191 B（2.0 是 5,355,561） | 保持原版压缩 4,696,705 B，补丁**运行时**用字符串替换打（`lib/client-*.mjs`） |
| 服务端 | `client/worldol-standalone.js` = **XOR 0x5A + Base64 加密**（3.0 新增）；解码后 1,389,610 字符，模块边界仍是 `// lib/xxx.mjs`，切出 **127 个模块** | `lib/*.mjs` 151 个（ESM，服务端直接 import）；**重名 98 个** |
| 加载脚本 | 引擎内 `WEB_SCRIPTS`（**37 项**）+ `client/index.html`（10 个 `worldol-*.js`）+ `client/standalone.html`（**20 个** `script`） | `web/index.html` 静态列 **24** 个 + `lib/http-routes.mjs` 的 `WEB_PATHS` 白名单（**两处必须同改**） |
| 预载清单 | `client/standalone-files.json`：**212 项**（6 个 analysis 模块 + 160 张地图 + 46 个 data）灌进 `window.__worldolFiles` | 只有 5 项 `{vfs,url}`（`安卓打包/standalone`） |
| 数据格式 | **混用**：有的美化（`career-skills.json` 50 万行）有的压一行（`official-v305.json`） | 与对方**正好相反** → 字节数完全不可比，本报告一律按 JSON 内容比 |
| 自有素材 | `client/assets/ghent/*.webp`（根特自绘 5 镇）、`client/banner/voice-data.js`（技能语音） | 无 |
| 构建活跃度 | 包内标记到 **20261018**（standalone.html）/ 20261017（web/index.html）/ 20261016（craft-exchange 数据）→ 同一天还在改 | 第 74 版提交 `3344746` |

---

## 2. 他们有、我们没有 —— 服务端（独有 29 个模块）

> 按「整块玩法」分组；「我们」一列写我们**现有**的对应物（有同功能但文件不同名的一律写出来，避免误判成缺口）。

### 2.1 佣兵体系（4 模块，**纯缺口，也是这次最大的整块缺口**）

| 模块 | 行数 | 干什么 | 关键编号 |
| --- | --- | --- | --- |
| `mercenary.mjs` | 288 | 佣兵合同/状态机（SLEEP/FIGHT/SACK，出战上限 2），合同用**真实墙钟**（`window.__wolRealNow`，游戏加速改不了到期时间） | 原生 **15503–15510** |
| `mercenary-data.mjs` | 149 | 本地佣兵商品（4 普通 + 4 精英 + 狂战士珍尼），`MERCENARY_DATA_REVISION="local-mercenaries-v1"` | 编队 **28001–28009**；店 20003/20007/20010/20011 |
| `player-mercenaries.mjs` | 142 | **角色佣兵**：把本账号自己的角色做成永久副本（角色本体不消耗） | 协议 **90030**，编号 **30000–30999** |
| `player-mercenary-snapshot.mjs` | 105 | 角色佣兵的完整原生战斗快照（双持/回复/武器技能，Monster 包表达不了） | — |

我们：**整块没有**。`90030` 在我们库里只在录制数据里出现（140 次），没有任何实现。

### 2.2 账号仓库 / 编辑器生态

| 模块 | 行数 | 干什么 | 我们 |
| --- | --- | --- | --- |
| `account-storage.mjs` | 1243 | **账号仓库**：同账号角色共享 300 格，需先解锁城市 | 无（`90040` 只在我们 qa 存档 / `offline-update.json` 里出现字样） |
| `custom-equipment-data.mjs` | **2764** | 自定义装备表：神话武器 9300001–9300004+、技能 8101–8104、双持合成规则 | 无 |
| `dormant-mounts-data.mjs` | **5621** | **休眠坐骑 96 件**（9300031–9300127）+ 鉴定槽池 | 无（2.0 报告就建议整体搬） |
| `ported-gear-rules.mjs` | 39 | 移植装备 9300018–9300029 的 power 缩放（位面核心按星级） | 无 |
| `mythic-chest.mjs` | 62 | 神话装备箱 9300930（5% 掉率） | 无（**用户明确不要箱子/奖励**） |
| `supply-boxes.mjs` | 314 | 宝箱/补给箱统一开启（type45 / power1∈{100,101,102,183,184}、装备箱分类、品质随机） | 部分（我们 `pet-service`/`supply-shops` 里有开箱路径，无这套统一规则） |
| `removed-items.mjs` | 27 | 下架道具清理（9300009–9300014，玩家实测否决后撤除） | 无（我们有等价的「下架」处理，但按名单屏蔽而非扫背包） |

### 2.3 副本 / 棋盘

| 模块 | 行数 | 干什么 | 我们 |
| --- | --- | --- | --- |
| `dungeon-challenge-repairs.mjs` | 413 | 11 项挑战型副本重建 + BOSS 代金券店 2061 | **我们已有等价实现**：`boss-challenges.mjs`（第 74 版，含三队长/堕狼魔/十殿逐殿/剧情重试），五连战我们换成 **9176** |
| `dungeon-reward-repairs.mjs` | 298 | 缺定义奖励补箱子/代币 + 「欠账回执」 | 无（**用户不要奖励**；我们只有记账） |
| `dungeon-reset.mjs` | 81 | **副本刷新**（协议 **90022**）：跑一次每日重置并把任务链从 `questHistory` 清掉 | ⚠ **编号冲突**：我们的 `90022` 是「外观同步到角色列表」（`server.mjs:121`）→ 要移植必须换号 |
| `team-dungeon-data.mjs` + `team-dungeon-service.mjs` | 160 + 160 | 团队副本 + **太阳神殿/英雄挑战赛**（13 点位棋盘、事件文本 600–619）；怪按捕获值 ×mult（龙/红名 20、其他 10） | **我们已有等价**：`solar-challenge-data/-service.mjs`（第 72 版双棋盘）+ `boss-tournament-data.mjs`（1305） |

### 2.4 宠物

| 模块 | 行数 | 干什么 | 我们 |
| --- | --- | --- | --- |
| `pet-skill-abandon-levels.mjs` + `-service.mjs` | 81 + 81 | 宠物技能遗忘/逐级遗忘（14003 / 14006，带 requestId 防重放） | **已有**：`lib/restoration-service.mjs` + `tests/skill-level-forget.test.mjs`（29 处断言） |
| `pet-item-definitions.mjs` | 13 | 回春石 40005（寿命重置 100 天，过期可用） | **已有**（第 73 版 `pet-state.mjs`） |
| `pet-illusion.mjs` | 101 | 宠物幻化（style 1–52，排除 4/17/46/50） | **已有**：`pet-illusion-service.mjs` + `web/pet-illusion.js`（两边同用 **90023** ✓） |
| `choose-pet-egg.mjs` | 33 | 自选传说宠物蛋（三步：形态→搜名→输入 1–97 级） | **已有等价**：补给商人的「自选宠物蛋」（`supply-shops.mjs` 文案 + 免费固定孵化） |

### 2.5 其他（都是「他们独有」，逐条给我们的状态）

| 模块 | 行数 | 干什么 | 我们 |
| --- | --- | --- | --- |
| `ask-sword-data.mjs` + `ask-sword-service.mjs` | 195 + 180 | **问剑十一峰**三档（2604 lv50 / 2650 lv60 / 2651 高级），怪缩放 1/1.7/2.6，地图 **37** NPC **11** 终点 100，棋盘 13 点 | **全库 0 命中（纯缺口）** |
| `salon.mjs` | 1204 | **美容院**（换发型/脸型/全新发型，商店清单+改外观都在服务端；含 120 条配色名表） | **已有**（`local-fashion.mjs` + `web/offline.js` + `tests/beauty-salon-shops.test.mjs`），但没有他们那份 120 配色名表 |
| `ghent-region.mjs` | 52 | **神之都根特**：区域 id 61 + 5 镇，走原生地图/NPC/商店/传送协议 | **半成品**：我们 `data/maps/6100–6104.json` **与对方逐字节相同**（还带他们的 `ghent` 键），但**缺** `ghent-region.json` + `web/ghent-world.js/.css` + `client/assets/ghent/*.webp` → 不可达 |
| `icon-appearance.mjs` | 278 | `icon1` 形象字段位偏移编解码（发型/发色/脸/手/脚/头盔 style+color） | 我们用**另一条路线**（`client-weapon-icon-patch.mjs` + `illusion-policy.mjs` + `fashion-icons.mjs`），无同名模块 |
| `achievement-service.mjs` | 113 | 成就（含 mythicSpear/Fan/Chunqiu 等自定义指标） | **已有**：`achievements.mjs`（我们的自定义指标写法不同） |
| `actor-service.mjs` | 43 | 改名卷轴 40016（协议 11038，带失败回滚） | **已有**：`role-rename-service.mjs` |

> **注意**：`dungeon-repairs.mjs` 这次**不在「他们独有」里**了 —— 因为我们在第 74 版也建了同名模块，
> 现在两边都有 `dungeon-repairs.mjs`（重名数 94 → 98 就是这么来的）。

---

## 3. 他们有、我们没有 —— 客户端

### 3.1 主包里的 5 个差异模块（逐字节复核过）

| 模块 | 改了什么 | 真在对方出厂主包里吗 | 我们 |
| --- | --- | --- | --- |
| `0056.js` | 属性上限：破甲/魔法穿透固定 `100000`；`ATK_*` 家族上限放大（`2000000` / `5000000`）；状态图标换行 | ✅ 在 | **有等价补丁** `lib/client-combat-limits.mjs`（数值不同：我们 5,000,000/10,000,000）；**「破甲/魔穿上限」那一条我们没有** |
| `0426.js` | 创角按钮文案 `创建角色` → `创角角色`（1 字） | ✅ 在 | 无（纯文案） |
| `0008.js` | `getHeadIndex` 去掉 `t==EAST/WEST` 国家判断 | ❌ **不在**（对方 `analysis/` 陈旧产物） | 无需 |
| `1147.js` | 图鉴全亮（读 `localStorage['worldol_handbook_all_lit']`） | ❌ 不在 | 无（他们靠外挂脚本 `handbook-lit.js` 实现） |
| `1149.js` | 图鉴「一键点亮所有」按钮 | ❌ 不在 | 无 |

**并且**：对方出厂主包里还有一批 `analysis/` 里**看不到**的 hook（我们全库 0 命中）：
`window.worldolEquipmentRepairPlan`、`__worldolGlowPick/GlowPrep`、`__worldolWeaponDye`、
`__worldolRuntimePart` + `runtime://` 伪 URL、`__wolRealNow`、`worldolNativeOnline`、
`__wolCityIncome`、`worldolDungeonRepairs.TabMdr`、`__wolTitleColors/__wolMythicTitles/__wolTitleGlow`、
`__wolMythicSkillText`。
→ 结论不变：**他们把主包当「钩子宿主」，功能全在外挂脚本里；我们是反过来（24 个字符串替换补丁）**。

### 3.2 他们的 11 个 `client/worldol-*.js`

| 脚本 | 3.0 体积（2.0） | 用途 | 我们 |
| --- | --- | --- | --- |
| `worldol-custom-icons.js` | **860.3 KB**（718） | 自定义图标注入（含美容院发色 3 档配色） | 无 |
| `worldol-float-text.js` | 165.6 KB（161） | 战斗浮动跳字（hook 0243/0241/0056） | 不同路线（原生跳字 + `client-battle-font-patch.mjs`） |
| `worldol-mythic-quality.js` | 64.1 KB（64） | 神话品质镭射流光（v3.2.2） | 无 |
| `worldol-skill-banner.js` | 56.6 KB（57） | 技能演出 + 语音（要 `banner/voice-data.js`） | 无 |
| `worldol-mythic-combat.js` | 13.9 KB（14） | 神话武器战斗补丁（0251 `calDamage`） | 无 |
| `worldol-pet-skill-abandon.js` | 13.0 KB（13） | 宠物技能遗忘 UI | 服务端有，客户端 UI 无 |
| `worldol-identify-picker.js` | 11.3 KB（11） | **[MOD-22] 鉴定自选**（协议 **11577/11578**，要服务端配套） | 无 |
| `worldol-battle-attr-cache.js` | 9.4 KB（9） | 战斗属性查询缓存 | **已有** `web/worldol-battle-attr-cache.js` |
| `worldol-shop-probe.js` | 8.9 KB（19） | 商店直通（修 11601–11603、美容院被 `openPay=false` 挡住） | 部分（`web/offline.js` 里有 `doBrowseShop`） |
| `worldol-attr-fast.js` | 8.8 KB（9） | **[MOD-23] 快速加点** +100/−100 | 无 |
| `worldol-handbook-lit.js` | 6.5 KB（7） | 图鉴一键点亮 v3.0.0 | 无 |

（另有一个 `worldol-float-text.js.bak-v1.1.31`，104.3 KB —— 他们自己的备份文件也打进包了。）

### 3.3 他们的 `web/`（独有 31 个）

我们只有 **2 个**独有 web 文件（`pet-illusion.css`、`worldol-battle-attr-cache.js`），他们独有 31 个：

- **联机**：`native-online.js`(61 KB) / `online-account.js`(30 KB，`/api/online` + IndexedDB 备份) / `online-world.js`(329 B 转发) / `online.css` / `online-world.css`
- **账号仓库**：`account-storage.js` + `-html.js` + `-native.js` + `.css`
- **角色佣兵**：`player-mercenaries.js`（协议 90030）
- **GM 控制台**：`gm-console.js`（`/api/gm/*`，导出/导入走 `window.worldolSave`）
- **手机悬浮菜单**：`phone-menu.js`（`window.__wolSpeed` 加速 1–4 倍、`__wolFast3s` 挂机秒过）
- **存档**：`standalone-save.js`（导出/导入/回滚；我们等价功能在 `安卓打包/standalone/boot.js` + `shims/vfs.mjs`，**桌面 web/ 没有**）
- **装备工作台**：`equipment-workspace.js` + `-html.js` + `-native.js` + `.css`（5 个 tab：合成/强化/鉴定/宝石/幻化）
- **交易所**：`exchange-tools.js`（一键挂售，常驻轮询找「最靠右的挂售文字」）
- **副本**：`dungeon-repairs.js`（「副本进度」页签）+ `dungeon-refresh.js`（副本刷新按钮）
- **外观**：`weapon-dye.js` + `runtime-dye.js`（Canvas 调色核心，`VIRTUAL_BASE=900000`）+ `glow-color.js`（宝石光效自选，11 组占位件 15001…15053）
- **宠物/试炼/字体**：`choose-pet-egg.js`、`trial.js`、`crit-font.js`（暴击跳字字体面板）
- **根特**：`ghent-world.js` + `.css`（5 镇硬编码 6100–6104，NPC artId 61001–61010）
- **排障**：`battle-log.js`（战斗日志环形采集 + `__wolBattleLog.exportFile()`）
- **死文件**：`home-features-v2.js`（43 KB，**不在 `WEB_SCRIPTS`、也不被 index.html 引用**；`web/trial.js` 只被它引用 → `trial.js` 实际是孤儿，他们的试炼实现活在 `home-features.js` / `native-features.js` 里）

**共有但内容不同的 14 个**（挑要紧的）：

| 文件 | 差别 |
| --- | --- |
| `home-features.js` | 他们 `buttons` **保留** `btnCharge/btnReward/btnFuLi/btnLottery/btnDigHole/btnNewTask/btnBulk/btnBuddy`；我们用 `removedButtons` **强制隐藏**这批 + `btnCrossPla/btnPetBattle`（他们 0 命中） |
| `career-skills.js` | 我们**点一次学满级**（接管 `ShopSkillLearnMdr`）；他们是自建 1–22 级下拉 |
| `offline.js` | 他们多 `installDungeonRepairs` / `installDungeonRefresh`，公告含「游戏加速 1-4 倍」「挂机秒过」（我们 0 命中）；**他们删掉了我们那个单机菜单抽屉** |
| `native-features.js` | 他们 131 KB（我们 13 KB）：把佣兵/账号仓库/装备工作台/联机全部镜像进去 |
| `pet-illusion.js` | 两边同用 **90023**；他们另做现场渲染造型缩略图（读 `/v/gd/305.json` 的 sprite.model/fragment） |
| `recorded-content.js` | 我们多 `rateMultiplier` 掉率倍率 + 宠物商店数动态刷新 |
| `viewport.js` | 他们多了 `visualViewport → --worldol-visual-height/top` CSS 变量（手机键盘）；我们只有触摸换算 |
| `character-features.js` | 他们保留「天赋/神器」入口 + 城市金库日收入行；我们第 73 版摘掉 |

### 3.4 壳层 / 打包（他们比我们多的东西）

- **服务端 bundle 加密**：`standalone.html` 里 `atob → 逐字节 ^0x5A → TextDecoder → Blob URL`（标记 `【mod59】`）。**2.0 是明文，3.0 才加密** → 他们的搬运门槛变高了（但对我们只是多一步解码）。
- **`standalone-files.json` 212 项预载**：把 6 个 analysis 模块 + 160 张地图 + 46 个 data 先拉进 `window.__worldolFiles`；我们只预载 5 项。
- **PWA 全套**：`manifest.json`、`worldoffline-sw.js`（`worldoffline-*v3` 缓存策略）、`pwa-register.js`、`install.html`、`pwa-180/192/512.png`、`WorldOffline.mobileconfig`（iOS webClip 指向 `https://golan.030399.xyz:9443/client/standalone.html`）。
- **`standalone.html` 内联**：时间倍速 1/2/3/4、挂机瞬间完成、屏幕错误红条 + 最近协议日志、`__worldolPreload`、核心引擎解密加载。
- **入口页差异**：他们把 `entry-pledge.js`（游玩前承诺闸门）从独立版入口删掉，改成「入页即注入 `gd.js`」；我们 `build.mjs` 也是去掉闸门换 boot 脚本，**行为等价、形态不同**。

---

## 4. 我们有、他们没有

### 4.1 客户端补丁链（**24 个 `lib/client-*.mjs`**，他们只有 2 个）

背包（批量使用）、怪物血蓝条（原生 `_hpBar/_mpBar`）、战斗查看面板全字段、战斗字体（像素数字图）、
法力回复、战斗技能面板、战斗倍速 1/3/5 持久化、伤害（宽乘积防 int32 溢出）、护送/棋盘本地战斗开关、
棋盘战后恢复界面、幻化、武器图标、武器槽位、军团 ×3（含宠物守护/幸存者）、任务、怪物回复、
幻影免疫、进阶、角色删除、提示弹窗加速、菜单分页…
他们：`client-progression-patch.mjs`、`client-combat-limits.mjs` 两个（progression 我们也有）。

### 4.2 我们独有的服务端模块（53 个里挑实质的）

- **内容**：`climb-tower.mjs` + `tower-shop.mjs`（永泽塔，⚠ **3.0 对方也实装了**）、
  `boss-hub.mjs`（BOSS 直达 map **277**）、`boss-tournament-data.mjs`（1305 BOSS 挑战赛）、
  `trial-challenge*.mjs`（无限试炼）、`solar-challenge-*.mjs`（太阳棋盘）、
  `lost-soul-desert.mjs` / `memorial-npcs.mjs` / `mid-autumn-final-boss.mjs`（派遣/护送/中秋终战）
- **本地内容**：`local-items.mjs`、`local-gems.mjs`、`local-fashion.mjs`、`fashion-icons.mjs`、
  `local-career-skills.mjs`、`local-skill-overrides.mjs`（技能效果覆盖 + 重算 wireBase64）、
  `equipment-direct-grants.mjs`、`pet-rename-service.mjs`
- **服务端骨架**（他们打包成一个 bundle，名字看不到，不代表没有）：`protocol-constants.mjs`、
  `protocol-dispatch.mjs`（22 段有序链）、`http-routes.mjs`、`lazy-data.mjs`、`generated-globals.mjs`、
  `reference-fields.mjs`、`role-list.mjs`、`dungeon-challenge-data.mjs`、`illusion-policy.mjs`

### 4.3 我们独有的数据（7 份）+ 内容上我们多的

独有文件：`maps/277.json`、`local-career-skills.json`、`local-skill-overrides.json`、`fashion-icons.json`、
`equipment-skill-levels-extra.json`、`pet-import-20260923.json`、`SOURCES.md`。

内容计数（两边都是同一份抓包，差的是后处理）：

| 项 | 我们 | 他们 |
| --- | --- | --- |
| 职业技能 `career-skill-directory` | **474**（多 465/652/653/757） | 470 |
| 任务 `recorded-expansion` missions | **889**（多 9100–9124 跨服五连战） | 850 |
| 地图 | **161**（多 277） | 160 |
| 称号 `recorded-content.titles` | **138** | 20（挪去 `community-titles.json`） |
| 单机商品 `native-commerce.items` | **78** | 73 |
| 日常副本链 `replayable-chains` | **8 条** | 1 条 |
| BOSS 挑战 `boss-challenges-v1` | 3 组/3 任务 | 2/2 |
| 掉落策略 `drop-catalog.policy` | 多 `rateMultiplier` | 无 |

---

## 5. 数据层差异（独有 18 份 / 同名 18 份不同）

### 5.1 他们独有 18 份 —— 几乎全是「怪物/物品编辑器」的产物

其中 **8 份是 3.0 新增**（2.0 只有 10 份）：`craft-exchange.json`（太阳神殿富东海合成店 **6 个店号
10065/10074/10075/10084/10086/10500** —— 我们完全未占用，**是纯缺口**）、`custom-drops.json`、
`custom-gift-boxes.json`、`custom-mission-rewards.json`、`custom-monsters.json`、`custom-role-npcs.json`、
`extra-items.json`、`item-extras.json`。

其余 10 份（2.0 就有）：`box-rewards.json`、`community-titles.json`（我们已并表）、`custom-items-v2.json`、
`custom-sprites.json`、`custom-adventure-notes.json`、`daily-dungeon-expansion.json`、`dormant-mounts.json`、
`dungeon-reward-repairs.json`、`ghent-region.json`、`vip-task-materials.json`。

### 5.2 同名但内容不同（18 份）

**A. 只是排版/后处理差异（体积差会骗人，可忽略）**：
`career-skills.json`（双方都是 470 技能：他们 50 万行美化 / 我们 2 行压缩）、`equipment-skill-levels.json`
（51,506 行 vs 2 行）、`official-v305.json`（1 行 vs 99 万行）、`item-affix-layouts.json`、`captured81`、
`solar-challenge-monsters.json`（81 怪/76 组全同）、`equipment-upgrade-rules.json`（1 个值）、
`restored-v03.json`（我们 +1 件 800100）、`tower-shop.json`（他们 +1 项 9300025，我们刻意下架）。

**B. 真实内容差异（要记住）**：
- 他们多：`equipment-sets` **203 vs 192**（+11 套，全是自定义/移植装备）、`equipment-skill-levels`
  多 **8103/8104**（飞景·华星 / 流彩·丹霞）、`official-v305.items` 2507 vs 2505（+32000 守护之翼(进化)）、
  `identification` **1045 vs 1008**（+37 个 20480–20510/20550–20559/28303–28308 自定义装备鉴定槽）、
  `item-affix-layouts` **2178 vs 2136**（+42）。
- `career-skills.json` 双方 470 个技能里有 **316 条效果值不同**（我们带 `effectRevision=force-hit-unit-v2`）。
- **怪物数值是系统性分叉，不是噪声**：`official-v305` 57 只、`recorded-expansion` **321 只**、
  `captured81` 16 只、`yunruo` 9 只、`boss-challenges` 6 只、`solar` 7 只 ——
  他们普遍是 **2 倍血/攻防 + `ignore_*` 5000**，两边各自刻意调过 → **跨工程合并数据必须整表择一，不能逐只混**。
- 他们的自定义号段 **20480–28308**（装备）与 **9300031–9300127**（休眠坐骑）与我们
  `800401+`（宝石）/`40101+`（造型）/`9300025` 不冲突，可单独按 id 移植。

---

## 6. 双方已经「收敛」的地方（这次新出现的情况）

| 能力 | 2.0 时 | 3.0 时 |
| --- | --- | --- |
| 永泽塔进战斗 | 他们**抛错占位**（「阵容、技能、AI与场景尚未录全」） | **他们实装了**：`tower-info/tower-challenge/tower-settle/tower-sweep` + `towerExtraGroups` + 塔组奖励 + 客户端桥（`TOWER_GROUP_BASE=23000`、拦 `World.addMonsterGroup`）—— **与我们第 69 版同一套做法** |
| 无限试炼 | 他们说「试炼关卡、战斗配置与奖励结算待补」 | **实装**：`trial-buy/trial-config/trial-challenge/trial-settle` + `trialExtraGroups` |
| 问剑十一峰 | 他们已有 | 他们仍有（`askSwordExtraGroups`），**我们仍没有** |
| 挑战副本 | 他们有一套修复框架 | 他们仍有；**我们第 74 版也补齐了**（三队长/堕狼魔/十殿逐殿/剧情重试 + 9176 五连战） |
| 太阳神殿 / 团队副本 | 他们 `team-dungeon-*` | 双方都有（我们 `solar-challenge-*` + 1305 棋盘） |
| 日常副本带路 / 当天重玩 | 他们 `dungeon-repairs` 框架 | **我们第 74 版也有了**（8 行看板 + `find*` 导航 + 链复位） |

> ⚠ 一处来源存疑：他们 3.0 的 `home-features.js` 里，永泽塔桥注释写着
> 「（**移植自世界OL home-features-v2.js 同款实现**；TOWER_GROUP_BASE 与客户端原版一致=23000）」。
> 我们仓库里没有 `home-features-v2.js`，我们的注释写的是「移植自 `lib/climb-tower.mjs` 的 TOWER_GROUP_BASE …
> 与无限试炼同一套做法」。**谁参考了谁无法确定**（两边都可能是各自独立从客户端原版常量推出来的），
> 这条只作为线索记录，不作结论。

---

## 7. 对方 3.0 相对 2.0 变了什么

1. **服务端 bundle 加密**（XOR 0x5A + Base64）—— 2.0 明文；解码后 1,389,610 字符（2.0 1,374,947），
   模块数 **127 → 127**（没增没减）
2. **永泽塔 / 无限试炼实装**（2.0 的「尚未录全」报错字串在 3.0 包里 **0 次**）
3. **`web/` 54 → 57**：新增 `crit-font.js`、`trial.js`（孤儿）、`home-features-v2.js`（死文件）
4. **`data/` 独有 10 → 18**：新增 8 份编辑器产物（见 5.1）
5. **客户端主包** 5,355,561 → **5,367,191 B**；差异模块仍是那 5 个；外挂脚本仍是 11 个，
   但 `custom-icons.js` 718 → **860 KB**、`float-text.js` 161 → 165.6 KB
6. 版本标记：`standalone.html` 到 **20261018**、`web/index.html` **20261017**、
   `native-features.js?v=20261017-trial2`、`dungeon-repairs.js?v=lantern-riddle-20261014`、
   `craft-exchange.json` **20261016** → 他们这几天在集中做「编辑器 + 试炼」

---

## 8. 现在还剩什么值得移植（我们已做完第 74 版之后的清单）

**第一档（纯服务端、我们有现成入口，最划算）**

1. **佣兵 4 模块**（`mercenary` / `mercenary-data` / `player-mercenaries` / `player-mercenary-snapshot`）——
   最大的一块缺口，复用原生 15503–15510 + 新增 90030；客户端要配一个 `player-mercenaries.js` 级别的窗口
2. **问剑十一峰**（`ask-sword-data` + `ask-sword-service`，2604/2650/2651，地图 37 棋盘）
3. **副本刷新**（`dungeon-reset.mjs`）—— ⚠ 必须换协议号（我们 90022 被占）
4. **休眠坐骑 96 件**（`dormant-mounts-data.mjs` 5621 行 + `dormant-mounts.json`）—— 数据可整块搬（含图标键 9416–9512）
5. **太阳神殿合成店**（`craft-exchange.json` 6 个店号 10065/10074/10075/10084/10086/10500）—— 纯数据缺口
6. **账号仓库 90040**（`account-storage.mjs` 1243 行 + 4 个 web 文件；纯服务端 + UI 都好抄）
7. **移植装备规则 / 自定义装备**（`ported-gear-rules` + `custom-equipment-data`，9300018–9300029 + 20480–28308）
8. **`icon-appearance.mjs`**（icon1 位域编解码）—— 改外观类功能的底座，我们已经有一套等价但可对照

**第二档（照抄外挂脚本，运行时找 webpack 模块 hook，不改主包）**

`worldol-identify-picker.js`（协议 11577/11578，服务端要配套）、`worldol-attr-fast.js`、
`worldol-handbook-lit.js`、`worldol-shop-probe.js`、`worldol-float-text.js`、
`worldol-mythic-quality.js` / `mythic-combat.js`、`worldol-skill-banner.js`（+ `banner/voice-data.js`）、
`crit-font.js`、`worldol-pet-skill-abandon.js`。

**第三档（大工程，要不要做另说）**

装备工作台（5 合 1）、武器染色 + 宝石光效（`runtime-dye` 共享核心）、联机（`native-online` 61 KB +
`online-account` 30 KB）、GM 控制台、手机悬浮菜单、**神之都根特**（缺 5 张自绘 webp，属半成品）。

**明确不要照抄的**

`box-rewards.json` / `supply-boxes.mjs` / `mythic-chest.mjs` / `dungeon-reward-repairs.mjs`
（用户已明确「开的箱子、奖励都不需要」）、`removed-items.mjs`（他们那边是玩家实测否决后撤除的东西）、
`home-features-v2.js`（死文件）、`web/trial.js`（孤儿文件）。

---

## 9. 落点与冲突注意

- **协议号冲突**：`90022`（我们=外观同步 / 他们=副本刷新）→ 必须换号；
  `90023`（两边都是宠物幻化 ✓ 可直接复用）；`90020`（两边都是通用 action 通道 ✓，
  我们 `home-feature-service.mjs` 收 90019/90020/30001/30003/30005/13101，他们走 `planHomeAction`）。
- **加客户端脚本要改两处**：`web/index.html` 静态列表 **和** `lib/http-routes.mjs` 的 `WEB_PATHS` 白名单
  （对方是引擎内 `WEB_SCRIPTS` 一处），漏一处就 404。
- **他们的数据不能整表覆盖**：18 份独有文件与 18 份同名差异都是「编辑器产物 + 自调数值」，
  只能按 id 段挑着搬；`official-v305.json` / `recorded-expansion` 的怪物数值两边系统性不同（见 5.2）。
- **他们的 `analysis/` 是陈旧产物**：5 个差异模块里有 3 个（0008/1147/1149）在出厂主包里对不上，
  别拿 `analysis/` 当「他们改过什么」的证据。

---

## 10. 附录：本次分析的产物与复跑方法

解包（跳过 10828 个资源文件）：

```powershell
$apk="<用户目录>\Desktop\幻想世界OL，3.0最终版.apk"; $dst="$env:TEMP\opencode\fxol3"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[System.IO.Compression.ZipFile]::OpenRead($apk)
foreach($e in $zip.Entries){ $f=$e.FullName; if($f -notlike 'assets/www/*'){continue}
  $rel=$f.Substring('assets/www/'.Length); if($rel -like 'client/assets/*'){continue}
  $out=Join-Path $dst ($rel -replace '/','\'); New-Item -ItemType Directory -Path (Split-Path $out -Parent) -Force|Out-Null
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e,$out,$true) }
$zip.Dispose()
```

解密他们的服务端 bundle（XOR 0x5A + Base64；`standalone.html` 里有同款逻辑）：

```js
const enc = fs.readFileSync('fxol3/client/worldol-standalone.js','utf8').replace(/\s+/g,'');
const bin = Buffer.from(enc,'base64'); const arr = Buffer.alloc(bin.length);
for (let i=0;i<bin.length;i++) arr[i] = bin[i] ^ 0x5A;
fs.writeFileSync('fxol3/client/worldol-standalone.decoded.js', arr);   // 1,389,610 字符
```

- 按 `// lib/xxx.mjs` 切出的 127 个模块：`%TEMP%\opencode\fxol3lib\`
- 本次脚本：`diff3-inventory.mjs`（三层文件级对比）、`diff3-modules.mjs`（模块清单/体积）、
  `diff3-heads.mjs`（独有模块头部）、`diff3-probe*.mjs`（功能存在性探测）、`diff3-delta.mjs`、
  `diff3-final.mjs`、`diff3-tower*.mjs`、`diff3-ghent.mjs`、`diff3-dates.mjs`
- 输出：`inv3-utf8.txt`、`mod3-utf8.txt`、`heads3.txt`、`probe3.txt`、`probe3b.txt`、
  `delta3.txt`、`final3.txt`、`ourtower.txt`、`ghent.txt`

# 对比报告：幻想世界OL 5.0「副本排行榜修复版」

- 对比日期：2026-10-23
- APK：`幻想世界OL,5.0副本排行榜修复版.apk`
- 对比基线：当前仓库 `世界online_原版单机/`（`main`，最新提交 `10127fe`）
- 解包位置：`C:\Users\hal\AppData\Local\Temp\opencode\fxol5\`
- 服务端 bundle 解码：`assets/www/client/worldol-standalone.js` → `standalone-decoded.js`（Base64 + XOR `0x5A`，127 个 `// lib/...` 模块标记）
- 本报告原始版本只做对照分析，没有修改 `data/`、`lib/`、`web/`，也没有打包或跑游戏。
- 2026-10-24 补记：阵型已经按原生客户端界面落地（不是 APK 的 web 面板）；副本链复审结果见第 11 节。

---

## 0. 结论先行

### 0.1 这个 APK 不是当前工程的「干净超集」

APK 里同时有：

1. 5.0 新内容（血魔遗迹、阵型系统等）；
2. 4.0 时代但本仓库尚未移植的旧功能；
3. 开发中的半成品/未接线文件；
4. 本仓库已经做得更新、更完整的模块。

所以不能把 APK 的 `web/`、`lib/` 或主包整体覆盖过来。当前仓库 `lib/` 有 163 个文件，APK bundle 只有 127 个 `// lib/...` 模块；`home-features`、`equipment-composition` 等本地版本明确更新，`native-features`、`offline` 等结构也不同，不能按文件大小或单文件覆盖来判断。

### 0.2 值得考虑的只有四项

| 优先级 | 项目 | 结论 | 主要理由 |
| --- | --- | --- | --- |
| P0 | 阵型系统 | **已移植** | 16 阵 × 9 级已用原生客户端界面落地（见 11.1）；不依赖血魔地图 |
| P1 | 神之都根特 | **可移植** | 5 张地图本地已存在且字节一致；缺区域注册、NPC/商店/传送、6 MB 美术和 UI |
| P2 | 账号仓库 | **可移植** | 协议 90040、300 格、账号共享，服务端/网页完整；需要账号级存档与跨角色测试 |
| P3 | 角色佣兵 | **需适配 / 不建议直接搬** | 依赖本地完全没有的基础佣兵模块（`mercenary.mjs` 等）和客户端 actor 注入，工作量大 |
| — | 血魔遗迹 / 血海 | **明确不要** | 用户已排除；而且 APK 里这套数据本身不完整，任务目标怪物和战斗组缺失 |
| — | 副本排行榜 | **没有独立的 5.0 新模块** | 本地无限试炼已有 `rankInfo`/`history`；APK 的 ranking 代码反而更旧，`home-features-v2` 的天空竞技场未接线 |
| — | 其余 web/旧数据包 | **不建议/暂缓** | 多为 4.0 旧功能、在线专用、未加载的半成品，或本地已经删除/重写 |

**一句话：先移植阵型和根特，账号仓库可以排第三；角色佣兵要看是否愿意先补基础佣兵系统；血魔遗迹整包不要；副本排行榜不需要单独移植。**

---

## 1. 文件级差异证据

### 1.1 数据目录

| 项目 | APK | 本地 |
| --- | ---: | ---: |
| `data` 文件数 | 230 | 214 |
| 完全相同 | 184 | — |
| 内容不同 | 22 | — |
| APK 独有 | 24 | — |
| 本地独有 | 8 | — |

APK 独有的 24 个文件中，和 5.0 直接相关的只有：

- `ghent-region.json`（根特区域）
- `maps/9900.json`—`9904.json`（血魔/血海地图）
- `daily-dungeon-expansion.json`（其中新增第 97 行「血魔遗迹」）

其余多为 4.0/编辑器/旧内容包：`custom-*`、`dormant-mounts.json`、`dungeon-reward-repairs.json`、`extra-items.json`、`item-extras.json`、`repaired-dungeons.json`、`box-rewards.json`、`community-titles.json`、`craft-exchange.json`、`vip-task-materials.json`。这些不是 5.0 的核心增量，是否补要看后续需求。

### 1.2 `official-v305.json`

| 项目 | APK | 本地 | 结论 |
| --- | ---: | ---: | --- |
| 地图 | 66 | 63 | APK 多 `9901/9902/9903`（血海三图） |
| 任务 | 736 | 733 | APK 多 `20020/20021/20022`（血魔遗迹） |
| 道具（唯一 ID） | 2506 | 2505 | APK 多 `32000 守护の之翼（进化）`；APK 文件里实际有 2507 条，`31200` 重复了一条 |
| 怪物 / 编队 / 技能 ID | 无 ID 差异 | 无 ID 差异 | 血魔任务引用的怪物并不在官方表里 |

`32000` 是 type 11（坐骑）、5 星、需求 90 级、`ascensionStar=18`，和血魔地图没有直接关系；如果喜欢这件坐骑，应走本地道具层补定义，不要改抓包 JSON。

另外，APK 的 `official-v305.json` 里 `31200` 有两条数据：原来的「独裁者机甲」和一条同 ID 的「守护の之翼（进化）」（定义字节与 `32000` 相同）。这是 APK 数据本身的重复/改名残留，**不能原样导入**，否则会覆盖本地 `31200` 的「独裁者机甲」。要加就只加 `32000`，并保留本地 `31200`。

### 1.3 web 与客户端

| 项目 | APK | 本地 | 说明 |
| --- | ---: | ---: | --- |
| `web` 文件 | 60 | 30 | APK 独有 34，本地独有 4 |
| 客户端文件 | 11,298 | 10,169 | APK 独有 1,134；Ghent 美术 43 文件 / 6.00 MB |
| 分析模块 | 1,613 | 1,613 | 仅 5 个模块不同：`0008/0056/0426/1147/1149` |
| 主包 | 约 5.23M 字符（约 5.37MB） | 补丁后 4,568,770 字符 | 不能直接替换；本地补丁链和测试长度都按 4,568,770 写死 |

APK 独有 web 文件里：

- 真功能候选：`account-storage*`（4 个）、`player-mercenaries.js`、`ghent-world.js/css`、`worldol-formation-panel.js`
- 4.0/旧界面候选：`equipment-workspace*`（4 个）、`dungeon-refresh.js`、`dungeon-repairs.js`、`exchange-tools.js`、`choose-pet-egg.js`、`runtime-dye.js`、`weapon-dye.js`、`crit-font.js`、`phone-menu.js`
- 在线专用：`online-*`、`native-online.js`、`account-online` 一类
- 本地明确删过的：`battle-log.js`（本地第 90 版按用户要求删除，APK 保留只能说明 APK 基于旧线）
- 未接线实验：`home-features-v2.js`（`skyarena` 天空竞技场）

本地独有的 `damage-calculator.*` 是本仓库第 90 版新功能，`pet-illusion.css`、`worldol-battle-attr-cache.js` 也是本地较新的资源；这些不能因为 APK 没有就删。

### 1.4 启动脚本与「半成品」判定

APK 的 `WEB_SCRIPTS` 启动列表和 `web/index.html` 都没有引用以下文件：

- `worldol-formation-panel.js`
- `ghent-world.js`
- `equipment-workspace*.js`
- `home-features-v2.js`

这些文件在 APK 里存在，但不会被自动加载。也就是说：

- APK 的阵型：**服务端数据/逻辑有，面板没挂上**；
- APK 的根特：**服务端区域和传送门有，独立区域 UI 没挂上**；
- APK 的装备工作台、天空竞技场：**更接近开发残留**，不能按“已完成功能”看待。

---

## 2. 明确不要：血魔遗迹 / 血海整包

### 2.1 需要排除的具体对象

| 类型 | 内容 |
| --- | --- |
| 地图文件 | `data/maps/9900.json`—`9904.json` |
| 官方地图记录 | `official-v305.maps` 中 `9901` 血海·图一、`9902` 血海·图二、`9903` 血海·图三 |
| 区域 | `official-v305.areas` 中 `13 血海` |
| 地图列表 | `official-v305.mapList` 中 `9901/9902/9903` |
| 任务 | `20020 血魔遗迹·一层试炼`、`20021`、`20022` |
| 每日目录 | `daily-dungeon-expansion.json` 第 97 行「血魔遗迹」 |
| 客户端资源 | 随血海三图加入的地图 tile / 场景资源（APK 客户端 1,134 个独有文件中的一部分） |

其中 `9900` 和 `9904` 只是地图文件，没有对应的官方地图/mapList 记录；`9901—9903` 才是可玩的三张图。

### 2.2 为什么连「以后再说」都不建议

APK 这套血魔遗迹本身不完整：

- 任务 `20020` 的完成条件是击杀 `monsterId=20004` 五只；
- 但 APK 的 `official-v305.monsters` 里没有 `20004`；
- 没有任何 `groups` 编队引用 `20004`；
- 服务端 bundle 里搜索 `20004` 也是 0 次；
- 三张地图里的 NPC 记录没有 `monsterGroupID`，也没有可触发战斗的编队。

结论：**即使把地图、任务、NPC 全部搬过来，也没有怪物和战斗组，任务无法正常完成**。它更像 5.0 开发中的场景/任务骨架，不是一套完整玩法。用户已经明确不要，这个结论也支持不要。

### 2.3 阵型与血魔解耦

阵型代码注释写着“数据源：血海三图源码工程 formation-data.mjs / formation-book-data.mjs”，但这只是来源说明。阵型的 16 个阵、16 本书、属性加成、商店/面板逻辑都不依赖血海地图、任务、怪物或区域 13。**可以只移植阵型，不碰血魔遗迹。**

---

## 3. P0：阵型系统（已移植，见 11.1）

### 3.1 APK 内容

- 16 个阵型，上阵人数 2—5：
  天覆、地载、风扬、云垂、龙飞、虎翼、鸟翔、蛇蟠、一字长蛇、二龙出水、天地三才、四门兜底、五虎群羊、六丁六甲、七星北斗、八门金锁。
- 每个阵 3 条百分比属性，例如天覆阵：劈砍攻击 +22%、穿刺攻击 +16%、致命点 +11%。
- 书：`62009`、`62018`、……、`62144`，每个阵一本玖级书；`type=31`、`power1=182`、`powerValue1=阵 id`、`powerValue2=9`、`reqLv=50`、`price=0`。
- 存档字段：`p.formations`（阵 id → 等级）和 `p.activeFormationId`。
- 服务端逻辑：
  - `formationBonusPct(role)` 把当前阵法的三条属性按百分比加到角色 `get()`；
  - `learnFormationFromBook()` 购买/使用后直接学到 9 级并激活；
  - 购买时自动扣书并从背包移除；
  - 面板 API：`window.__worldolStandalone.formation.get()/set(formId)`。
- 面板：`web/worldol-formation-panel.js`，入口写的是「单机功能菜单」和「背包功能界面右下角」。

### 3.2 APK 里的缺口

1. **面板没有加载**：APK 的 `index.html` 和启动脚本都没有 `worldol-formation-panel.js`，所以实际打开 APK 不会自动出现面板。
2. **书没有可靠商店入口**：虽然注释写“注入商店 16 本玖级阵法书”，但服务端只把书推进了 `official.items`；本地/APK 的 `supplyCategory` 对 `type=31` 只把宠物技能书放进 919，阵法书 `62009` 不在宠物技能书 ID 集合里，因此不会自动出现在 919 商店。需要显式加商店或免费领取入口，否则只能 GM 发书。
3. **属性引擎要接入本地版本**：APK 是在它的 `nativePlayer().get()` 里叠加 `formationBonusPct`；本地的 `lib/native-character-stats.mjs` 结构不同，不能整段复制，只能按本地引擎补同样的“当前阵法百分比”逻辑。
4. **面板 API 要补**：本地 `web/offline.js` 已有 `__worldolStandalone`，但没有 `formation` 子对象，需要补 `get/set`，并让 `set` 校验已学阵、写存档、刷新世界。

### 3.3 移植建议

- 新建本地 `lib/formation.mjs`（或并入 `local-items`/`native-character-stats`），保留 16 阵数据和 16 本书的定义；
- 在 `official-data.ensure()` 的本地道具注入阶段加书，**不要改 `data/official-v305.json`**；
- 在商店/背包入口显式挂书，价格按单机习惯定（APK 原值为 0，可改成铜币或免费）；
- 在 `native-character-stats.mjs` 的玩家 `get` 叠加当前阵法，**只作用于玩家，不作用于宠物**；
- 把面板加入 `web/index.html`、`WEB_PATHS`，并补 `__worldolStandalone.formation`；
- 测试至少覆盖：学书、切阵、存档恢复、属性只加一次、未学阵不能激活、面板 API 不写坏存档。

**工作量：低—中。风险：中低。** 主要风险不是数据，而是“属性叠加口径”和“面板/商店接线”；建议先做无面板版本（发书 + 服务端加成 + 存档字段），面板后补。

---

## 4. P1：神之都根特（可移植）

### 4.1 APK 内容

- 区域：`id=61`，名称「神之都根特」，副标题「天界 · 云海之上的机械皇都」。
- 5 个城镇：
  - `6100` 根特
  - `6101` 天界皇宫
  - `6102` 鲁夫特悬空海港
  - `6103` 海上列车
  - `6104` 无法地带
- 每城 2 个 NPC，共 10 个；NPC 有立绘、头像、对白、商店。
- 13 个不同商店 ID：903/904/905/906/907/908/909/910/911/912/916/918/919。**这些商店本地全部已存在**（`lib/supply-shops.mjs`）。
- 入口：在 `mapId=1` 放置 `id=125`「天界传送门」，坐标 `(19,18)`，目标 `6100 (32,28)`。
- 地图文件：`data/maps/6100.json`—`6104.json`。**本地已有，且和 APK 字节一致**，不需要覆盖。
- 美术：`client/assets/ghent/`，43 个文件、6.00 MB；本地没有。
- 服务端：`lib/ghent-region.mjs` 安装区域/地图/mapList/NPC/传送门，复用现有地图、NPC、商店、旅行协议。
- 网页区域图：`web/ghent-world.js/css`，但 APK 启动列表和 `index.html` 都没加载。

### 4.2 移植范围

1. 复制 `data/ghent-region.json` 和 `client/assets/ghent/` 美术；
2. 新增 `lib/ghent-region.mjs`，在 `official-data.ensure()` 的地图注册阶段、索引建立之前安装；
3. 区域 61 注册进 `official.areas`、`areaScenes`、`official.maps`、`official.mapList`；
4. 地图 6100—6104 不需要复制，直接读取本地现有文件；
5. NPC 的 13 个商店全部本地已有，不需要补商品表；
6. `mapId=1` 的 NPC 125 要先检查是否被占用，沿用 APK 的冲突抛错；
7. 如果要做区域图 UI：加入 `ghent-world.js/css`、`WEB_PATHS`、`index.html`，并修正资源基路径。

### 4.3 关键风险

- **资源基路径**：`ghent-world.js` 用 `new URL('assets/ghent/', document.baseURI)`，而 APK 实际美术在 `client/assets/ghent`；在电脑版/APK 的 `web/` 基路径下可能解析错。移植时要改成 `/client/assets/ghent/` 或在构建时把资源复制到 `web/assets/ghent/`。
- **区域 UI 没有接线**：APK 的 `ghent-world.js` 没被启动脚本加载，不能假设它已经可用；先做服务端区域 + 传送门 + 商店，UI 作为可选第二步。
- **地图索引顺序**：`ghent-region` 必须在建 `officialMaps`/`officialGroups` 索引之前安装；否则世界数据里没有根特。
- **构建指纹**：如果 `data/ghent-region.json` 和 `client/assets/ghent` 进入包，必须更新构建指纹，否则 WebView 缓存不会清。
- **APK 的 `ghent-world` 是 2026-10-14 的 `native-style-v2`**，比 5.0 的阵型早；它不是必须和血魔一起移植。

**工作量：中。风险：中。** 数据和商店风险低，主要成本在 6 MB 美术、区域 UI 和构建路径。

---

## 5. P2：账号仓库（可移植）

### 5.1 APK 内容

- 协议：`90040`（本地未占用）。
- 容量：300 格。
- 数据归属：**账号级共享**，同一账号下不同角色共用。
- 前置：角色必须先解锁自己的城市（服务端校验 `cityUnlocked`）。
- 功能：背包 ↔ 账号仓库存取、刷新、容量显示、物品筛选/搜索。
- 服务端：`lib/account-storage.mjs`；网页：`account-storage.js`、`account-storage-native.js`、`account-storage-html.js`、`account-storage.css`。
- 入口：城市界面按钮「账号仓库」；网页端还有 HTML 对话框版本。
- 服务端会校验账号、角色归属、物品来源和背包/仓库容量；改动后发送角色包/背包包。

### 5.2 移植建议

- 新增 `lib/account-storage.mjs`，把处理器挂到 inbound chain（在 `handleSystemSettings` 之后、`handlePlayerMercenary` 之前的位置可参考 APK）；
- 存档新增账号级 `accountStorage`（不要塞进单个角色存档，否则跨角色不共享）；
- 物品实例要保留完整定义/数量/绑定/鉴定等字段，不能只存 `itemId`；
- 网页 4 个文件加入 `WEB_PATHS` 和启动脚本；如果本地布局和 APK 城市界面不同，按钮挂载点要适配；
- 测试：同账号两角色存取、容量边界、堆叠/拆分、带鉴定装备、战斗中/未解锁城市拒绝、存档重启恢复。

**工作量：中。风险：中。** 没有协议冲突，但账号级存档迁移和物品实例完整性是重点；建议在阵型/根特之后做。

---

## 6. P3：角色佣兵（需适配，不建议直接搬）

### 6.1 APK 内容

- 协议：`90030`（本地未占用）。
- 角色佣兵编号：`30000—30999`。
- 来源：同账号的其他角色（`sourceRoleId`）。
- 行为：`list / create / refresh / remove`；创建的是**永久快照**，复制外观、属性、技能、出战宠物；来源角色的背包/宠物不会被消耗或改变。
- 出战上限沿用基础佣兵系统；创建前检查战斗状态；成功后发送 `10503` 世界刷新。
- 客户端：`web/player-mercenaries.js` + `web/offline.js` 里对 `_offlinePlayerMercenarySnapshot` 的 actor 注入。
- 服务端依赖：`mercenary.mjs`、`mercenary-data.mjs`、`player-mercenary-snapshot.mjs`、`player-mercenaries.mjs`。

### 6.2 为什么不能直接搬

本地 `lib/` **没有基础佣兵系统**：

- 没有 `mercenary.mjs`
- 没有 `mercenary-data.mjs`
- 没有 `player-mercenary-snapshot.mjs`
- 没有 `MERCENARY_ACTIVE_LIMIT` 等基础常量

而角色佣兵不是独立的“复制角色”功能，它建立在基础佣兵记录、出战上限、actor 包、宠物装备序列化之上。只搬 `player-mercenaries` 会缺依赖；只搬 UI 会没有服务端数据。

### 6.3 建议

- 如果只是想要“用自己的其他角色当跟班”，更稳的做法是基于本地现有的军团/队伍系统做一个简化版，而不是整套移植 APK 的佣兵框架；
- 如果坚持原版角色佣兵，需要先移植基础佣兵系统，再移植快照和客户端 actor 注入，工作量和回归风险都会上一个台阶；
- 不建议作为 5.0 的第一批移植项。

**工作量：高。风险：高。**

---

## 7. 不建议 / 暂缓的项目

### 7.1 装备工作台（`equipment-workspace*`）

4 个文件（`equipment-workspace.js/html/native/css`），APK 启动列表和 `index.html` 都没加载。本地已有 `equipment-workshop.js`、`equipment-composition.js`，而且本地装备覆盖/鉴定/强化/附魔/赋灵链路比 APK 新。**不建议整包搬**；如果只是想要统一界面，单独做 UI 适配，不要覆盖现有工作台。

### 7.2 副本刷新 / 副本修复面板

- `web/dungeon-refresh.js`、`web/dungeon-repairs.js` 是 APK 的网页面板；
- 本地已有 `lib/dungeon-repairs.mjs` 服务端逻辑，缺的只是面板；
- APK 的 `dungeon-reset` 使用 **90022**，而本地 `web/offline.js` 把 90022 用于外观同步。**协议冲突**，不能原样搬；如果要面板，先换一个本地未占用号。
- 该功能属于 4.0 时代的副本修复/刷新，不是 5.0 核心；建议暂缓。

### 7.3 `home-features-v2.js` / 天空竞技场

- APK `web/index.html` 加载的是 `home-features.js`，不是 v2；
- v2 里的 `skyarena` 是实验代码，服务端只有 `skyarenaPoint` 字段，没有对应处理器；
- 本地的无限试炼已有 `rankInfo`、`bestDamage`、`history`、`awarded` 发奖闸门，排名逻辑不比 APK 差；
- **不建议移植 v2**。

### 7.4 `battle-log.js`

本地第 90 版已按用户要求删除战报/日志，改为「查看」面板 + 伤害计算器。APK 保留 `battle-log.js` 只能说明它基于旧线，不是 5.0 新功能，**不要回滚**。

### 7.5 在线相关

`online-*`、`native-online.js`、`online-account.js`、`online-world.js` 依赖在线后端，不属于单机离线功能；不建议移植。

### 7.6 其他 APK 独有数据包

`dormant-mounts.json`、`extra-items.json`、`item-extras.json`、`custom-items-v2.json`、`custom-gift-boxes.json`、`repaired-dungeons.json`、`dungeon-reward-repairs.json`、`box-rewards.json`、`community-titles.json`、`craft-exchange.json`、`vip-task-materials.json` 等，多数是 4.0/编辑器/旧内容包，和 5.0 阵型/根特没有直接关系。是否补，按后续具体需求单独立项；不要因为它们在 APK 里就整批导入。

其中 `dungeon-reward-repairs.json` 的 169 个奖励道具，本地源码里除 `9310000` 外基本都能找到对应 ID（说明大部分 4.0 奖励链已经处理过），不建议为了“齐全”再覆盖本地奖励表。

---

## 8. 关于「副本排行榜」

这次 APK 标题叫「副本排行榜修复版」，但代码里没有找到独立的 5.0 副本排行榜模块。实际能对上的只有：

1. **无限试炼伤害排名**：
   - 本地 `lib/trial-challenge.mjs` 已有 `rankInfo`、`bestDamage`、`history`、`awarded`；
   - APK bundle 里的试炼代码仍在旧的 `home-features` 模块中，结构比本地旧；
   - 本地第 78 版已经处理过试炼发奖闸门和伤害上报，不需要从 APK 回退。
2. **`home-features-v2.js` 的天空竞技场**：
   - 有“我的最高伤害/记录/排行榜”等文案；
   - 但 APK 没加载它，服务端也没有对应协议处理器；
   - 属于未接线实验，不能作为“5.0 排行榜”来移植。

结论：**如果只是标题里的「副本排行榜修复」，没有可单独搬的新模块；如果实际游戏里有具体排名错误，需要提供复现步骤，再按本地试炼/排行代码定位。** 不要为了这个标题去覆盖 `home-features.js`。

---

## 9. 建议的移植顺序与验收

### 9.1 顺序

1. **P0 阵型**：数据/书/存档/属性/面板/商店，先做服务端闭环，再做 UI。
2. **P1 根特**：先区域/地图/传送/商店，再考虑 `ghent-world` 区域图 UI。
3. **P2 账号仓库**：账号级存档 + 跨角色测试。
4. **P3 角色佣兵**：只有确认要基础佣兵系统时再做。
5. **不移植**：血魔遗迹/血海整包、副本刷新/修复面板、装备工作台整包、`home-features-v2`、`battle-log`、在线模块。

### 9.2 每个功能都要检查

- `data/*.json` 是否被改动（原则上一字节不改，新增内容走本地覆盖/注入）；
- 新 `web/*.js` / `*.css` 是否加入 `lib/http-routes.mjs` 的 `WEB_PATHS`；
- 新启动脚本是否两边都挂：电脑版 `index.html`/`offline.js`，APK `安卓打包/standalone/build.mjs`；
- 新资源是否进入构建指纹；
- 存档迁移是否兼容老角色；
- 协议号是否和本地冲突（尤其 90022）；
- 是否有只读接口被写坏（查询/快照要 `deepEqual` 守卫）。

### 9.3 本次没有做的事

- 没有修改任何 `data/`、`lib/`、`web/`、`client/` 文件；
- 没有打包 APK；
- 没有跑游戏/E2E；
- 工作树在 `10127fe` 后保持干净。

---

## 10. 附：关键判断表

| APK 项 | 本地对应 | 判断 |
| --- | --- | --- |
| 血海 9901—9903 + 血魔任务 20020—20022 | 无 | **明确不要**；任务目标 20004 怪物/编队缺失，无法完成 |
| 每日目录第 97 行「血魔遗迹」 | 本地已有 38 行 | **不要**；5.0 只多这一行血魔 |
| 阵型 16×9 + 16 本书 | `formation-data.mjs` + 商店 922 | **已移植**；用原生界面，见 11.1 |
| 根特 6100—6104 | 地图已有且一致；区域/NPC/美术/UI 无 | **P1 可移植**；补区域注册和 6MB 美术 |
| 账号仓库 90040 | 无 | **P2 可移植**；账号级存档 |
| 角色佣兵 90030 | 无基础佣兵 | **P3 需适配**；依赖大，不建议直接搬 |
| `32000 守护の之翼（进化）` | 官方表无 | 可选单件道具；走本地道具层，不是系统 |
| `ghent-world.js` | 无 | 可选 UI；APK 未加载，资源路径要修 |
| `worldol-formation-panel.js` | 不用 | APK 自己也没加载；本地直接用 v305 原生阵法界面 |
| `equipment-workspace*` | 本地有工作台/合成 | 不建议整包覆盖 |
| `dungeon-refresh/repairs` web | 本地服务端有 repairs | 暂缓；90022 冲突 |
| `home-features-v2` | 本地 `home-features.js` 更新 | 不建议 |
| `battle-log.js` | 本地已删除 | 不要回滚 |
| `online-*` | 单机不需要 | 不移植 |

---

## 11. 2026-10-24 落地与副本链复审

### 11.1 阵型已经落地（用客户端原生界面，不是 APK 的 web 面板）

APK 的 `worldol-formation-panel.js` 没有被启动脚本加载，服务端也缺世界数据下发；本地客户端主包本来就有完整的阵型协议和「阵法」页签。因此这次没有搬 APK 面板，而是直接接原生界面：

| 项目 | 本地实现 |
| --- | --- |
| 数据 | `lib/formation-data.mjs`：16 阵、16 本玖级书，编号 `62009—62144`（间隔 9），编号/数值与 APK 5.0 一致；说明文字补了两个缺失的 `%` |
| 道具 | `applyFormationBooks()` 在 `official-data.ensure()` 建索引前注入；不改 `data/*.json` |
| 商店 | `lib/supply-shops.mjs` 新增分类 `922 阵法书`，16 本全部免费 |
| 学/遗忘/切换 | `lib/restoration-service.mjs` 接 `14012/14013/14015`；`14012` 回包是 `byte(formationType)+formationSkill`，后两者是 `byte(0)+列表块` |
| 登录列表 | `worldData()` 置 `DATA_FORMATION (1<<20)`，在 `DATA_CITY` 之后下发「列表 + bool + 当前 formationSkill」完整块 |
| 属性 | `restoration.attributes()` 把阵型并入装备列；`native-character-stats.mjs` 给 `nativePlayer.formationSkill` 挂同一个桩，面板/战力/战斗校验同口径 |
| 客户端 | 只加一条字符串补丁：`type31` 的「使用」分支排除 `power1=182`，让阵法书走 `14012` 而不是人物技能书 `14007`；主包 4,568,725 → 4,568,770 |
| 同步 | 每次协议 `finally` 调 `syncFormation()` 补推 `14014`。客户端的 14012/14013/14015 回调只改 `formationList`、不改 `formationSkill`，所以状态一变就必须补推 |

说明：APK 把阵型的体质/智力 `power 3/7` 在下发时改成百分比键 `4/8`，本地也照这个口径做（否则 `getBaseValue()` 会把它们当固定值加）。还有一处**有意偏离 APK**：formationSkill 的 `skillId` 字段 APK 写 0，但客户端「设为默认 / 遗忘」会把 `skillId` 原样发回 14015/14013，写 0 等于每次都请求清空；本地写阵型 id，界面才能正常切阵和遗忘。血魔遗迹/血海没有碰。

### 11.2 副本目录：APK 只多一行血魔，其他「缺失备注」大多已过时

- 本地 `lib/daily-dungeon-directory.mjs` 是 38 行；APK 5.0 是 39 行，唯一新增是 `97 血魔遗迹`（已排除）。
- APK 行里的 `unavailable` 备注不能直接照抄：本地已经补齐 63、64、70、73、76、79、80、87、88、90、94、95、96 这些行对应的任务/地图/编队。
- 仍然真实的缺内容是：
  - 77 九歌端午与水底秘洞：缺地图 `943`；
  - 78 碧莲山·鹊桥：缺任务 `941`；
  - 86 奥哈拉·彩蛋森林：缺地图 `973`。
- APK 的 `repaired-dungeons.json`（14 张动态副本地图）在本地已经全部存在：逐张核对地图、NPC、编队、怪物，**没有缺失项**，不需要再搬。
- `replayable-chains.json`：本地 8 条链，APK 只有 1 条（玛雅太阳神）；本地是超集，不回退。

### 11.3 唯一实质缺口：任务材料/奖励道具没有定义

APK 的 `dungeon-reward-repairs.json` 有 169 条「只有元数据」的补配道具（`id/name/bagIcon/grade/taskMaterial/kind`），本地 `officialItems` 与 `equipment` 里 **169 条全部不存在**。其中 26 个是任务提交条件直接要求的：

`44,45,48,60,61,62,77,81,117,557,730,753,789,1051,5301,9038,9040,16006,16007,16008,16009,16010,16011,16013,16014,16015`

受影响目录行：65、68、70、73、74、76、77、78、80、81、82、84、86、89、90。表现是：
- 任务可以接，但 `CONDITION_HAVE_ITEM` 永远凑不齐；
- 即使某个道具是另一条任务的奖励，那条任务也因同一定义缺失而不会真正发出来；
- 服务端 `missionRewards()` 会过滤未知道具，`planItemRewards()` 对未知道具会抛错，所以现在不会误发，但任务链会停在这里。

APK 的完整方案不只是数据：它用参考道具 `1351` 克隆出 `type=28` 的补配道具，还带 `90031/90032` 领取欠账、兑换面板和持久化回执。**不建议整包搬**；如果只想让上面这些任务能交，最小改动是：

1. 只补这 26 个「任务材料」，用 `type=28`、`stackNum=99`、`autoBinding=1`、无属性、无效果的模板定义；
2. 奖励类道具如果确实要发，再按 `dungeon-reward-repairs.json` 的 `kind` 单独补，不要一次性导入 169 条；
3. 不引入 `90031/90032` 欠账系统，除非确实需要补发历史奖励。

`custom-mission-rewards.json` 的 55 条覆盖属于 4.0/怪物编辑器数据，不是 5.0 新增；本地已有自己的剧情修复和奖励过滤，不建议整批覆盖。

### 11.4 本次验证

- `formation.test.mjs`：7 个用例（书目/解码、商店、学书、世界数据、切换/遗忘、回滚、14014 同步）。
- `client-patch-chain.test.mjs`：补丁链顺序、长度与幂等。
- `server-dispatch.test.mjs`：`14012/14013/14015` 归属。
- 全量 `npm test`：96 文件 / 718 用例，717 通过；唯一失败是既有的 `loot.test.mjs`（本地覆盖把 747 圣诞衣服 grade 改成 4，超过该档 maxGrade 3），与阵型无关。

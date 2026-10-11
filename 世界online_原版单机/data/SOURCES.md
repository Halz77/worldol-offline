# `data/` 血缘说明

这份文档回答三个问题，**改数据之前先看**：

1. 这个文件从哪来？
2. 它能不能重建、用哪个脚本重建？
3. 它和别的文件冲突时，**谁说了算**？

评审（`架构评审-20261011.md` P3-2）点出的坑是：`data/` 里四类来源混在一起，`official-v305`
/ `content-library` / `recorded-content` / `career-skills` 之间**语义重叠**（都含"技能""道具"），
却没有一处写清权威关系。最容易出的返工是「改了 A，结果生效的是 B」。

---

## 一、四类来源

| 代号 | 含义 | 特征 | 能否重建 |
| -- | -- | -- | -- |
| **抓包** | 从正式服协议里直接解出来的原始定义 | 带 `wireBase64` / `sources`（capture+seq+sha256）、`clientVersion:305` | 需要原始抓包目录，一般**不可重跑** |
| **录制** | 本机在正式服实际操作、记录下来的公开内容 | 带 `capture`/`seq`/`at`、`revision` 像 `recorded-*-2026092x` | 需要录制包，**不可重跑** |
| **社区** | 社区仓库 <https://github.com/treefuture/world-online> 的 JSON 复原数据 | `sourceURL` 指向该仓库；数据与 v305 **未逐条核对** | 可（拉 upstream 再跑对应脚本） |
| **本地** | 单机版自己写的规则 / 生成的索引 / 手录补遗 | 文件名带 `local-*`，或脚本 `tools/build-*.mjs` 产出 | **可重建**（脚本就在 `tools/`） |

> 判定原则：**能重建的以脚本为准，不能重建的以文件为准。**
> 只改脚本不改文件（或反过来）都会在下一次重建时被覆盖或悄悄失配。

---

## 二、权威关系（谁覆盖谁）

### 道具 / 地图 / NPC / 任务 / 怪物

```
official-v305.json          ← 权威。抓包原始定义
  ├─ catalog-skills.json    ← 从 official 抽出的技能定义（构建中间产物）
  ├─ recorded-expansion-*.json  → 由 import-recorded-expansion 叠加进 official
  └─ recorded-content.json  → 由 merge-recorded-content 叠加进 official
```

- **`official-v305.json` 是道具/地图/NPC/任务/怪物的唯一权威。**
  任何"这个道具不存在""这张地图没有"的判断都以它为准。
- 录制与扩展批次是**增量**：`applyRecordedExpansion()` / `applyRecordedExpansionEvents()` 只
  往 official 里**补**缺失的条目；已存在的条目**不替换**（`items` 表尤其严格 —— 穿戴/绑定/强化过的
  实例是"证据"而不是"模板"）。冲突时抛错，不静默取一边。
- 本地手工补的道具（造型 40101+/40201+、+4 宝石 800401–800405、`local-*`）不在任何上游文件里，
  由 `lib/official-data.mjs` 顶层追加，编号区间与上游不重叠（有碰撞断言）。

### 技能（**最容易查错表的地方**）

运行期同时存在三套技能来源，**职责不同**：

| 文件 | 谁读 | 作用 | 权威性 |
| -- | -- | -- | -- |
| `official-v305.json` 的 `skills` | `lib/restoration.mjs`（`officialSkills`） | 商店/导师来源的**原版**技能定义，带 `wireBase64` | 原版技能的本体 |
| `career-skills.json` | `lib/career-skills.mjs` → `careerSkills` → 并进 `skills` 表 | 九职业技能树：等级、别名、导师、`maxLearned` | 本地整理，**覆盖**同 id 的原版条目以外的等级数据 |
| `local-career-skills.json` | `lib/restoration.mjs` | 国家专属技能（防御战术（劈砍）等）的补录 | 本地补遗，**只补不覆盖** |

- 三者按 id 合并进 `lib/restoration.mjs` 的 `skills` Map。合并顺序：`career-skills` →
  `local-career-skills` → `officialSkills`。
- **重号即抛错**：`Official skill ID conflicts with local data`。动了任何一份的编号都要跑全量测试。
- `skill-progression.json`（15 MB）与 `catalog-skills.json`（2.4 MB）**运行期完全不读** ——
  它们是 `tools/build-career-skills.mjs` / `build-content-library.mjs` / `build-skill-progression.mjs`
  的输入，属于构建产物。**别去 lib 里找它们。**

### 内容图鉴（面板专用）

- `content-library.json`（29 MB）**只服务 `/api/content-library`**，由 `web/catalog.js` 拉取。
  运行期（协议处理）**不读它**。改它不会影响任何一局游戏。
- `official-guides.json` 是 16005 攻略页的抓包结果，`build-content-library` / `build-skill-progression`
  用它补技能效果文字。

### 宠物

- `pet-catalog.json`：模板 / 品质 / 技能 / 经验表的权威（抓包 + 推算，**无重建脚本**）。
- `recorded-content.json` 的 `pets` / `petSnapshots` / `petSkills` / `petEquipment` 是**观测到的实例**，
  经 `lib/recorded-content.mjs` 折成 `petSources`（图鉴）与 `recordedFinishedPets`（97 级成品）。
- `pet-equipment-skills32.json`：宠物装备技能表。`pet-import-20260923.json` 是导入报告。

---

## 三、逐文件清单

"运行期"列 = 有玩家连线时会被读；否则只在构建 / 面板 / 工具里用。

| 文件 | 大小 | 来源 | 采集 / 生成 | 重建脚本 | 运行期 |
| -- | --: | -- | -- | -- | -- |
| `official-v305.json` | 34.0 MB | 抓包 | `sourceTime` 2026-09-19 | `import-official-capture` + `merge-official-capture` / `import-pet-and-chests` / `merge-recorded-content`（增量） | ✅ 权威 |
| `content-library.json` | 29.2 MB | 抓包 + 社区 | 2026-09-20 | `tools/build-content-library.mjs` | ❌ 仅 `/api/content-library` |
| `recorded-content.json` | 17.6 MB | 录制 | 2026-09-23 | `tools/merge-recorded-content.mjs`（+ `import-recorded-pets` / `import-recorded-vitality`） | ✅ 宠物/称号 |
| `skill-progression.json` | 15.0 MB | 社区 | 2026-09-20 | `tools/build-skill-progression.mjs` | ❌ 构建输入 |
| `recorded-expansion-20260922.json` | 12.7 MB | 录制 | 2026-09-22 | `tools/import-recorded-expansion.mjs` | ✅ 叠加进 official |
| `career-skill-directory.json` | 10.9 MB | 本地 | 2026-09-28 | `tools/build-career-skills.mjs` | ❌ 仅 `/api/career-skills`（原样发出，不解析） |
| `career-skills.json` | 8.3 MB | 本地 | 2026-09-28 | `tools/build-career-skills.mjs` | ✅ 技能表 |
| `pet-catalog.json` | 7.0 MB | 抓包 + 推算 | 2026-09-24 | **无**（一次性导入） | ✅ 宠物 |
| `catalog-skills.json` | 2.4 MB | 抓包 | 2026-09-20 前后 | `tools/import-catalog.mjs` | ❌ 构建输入 |
| `offline-update.json` | 2.1 MB | 本地 | — | — | ❌ 离线更新包描述 |
| `item-affix-layouts.json` | 1.8 MB | 抓包推导 | — | `tools/build-item-affix-layouts.mjs` | ✅ 鉴定/合成 |
| `equipment-skill-levels.json` | 1.1 MB | 社区 + 抓包 | — | **无** | ✅ 装备技能等级 |
| `official-guides.json` | 1.1 MB | 抓包（16005） | 2026-09-20 | `tools/import-official-guides.mjs` | ❌ 构建输入 |
| `drop-catalog.json` | 0.9 MB | 录制推导 | 2026-09-22 | `tools/build-drop-catalog.mjs` | ✅ 掉落 |
| `home-features-v1.json` | 0.9 MB | 抓包 | 2026-09-22 | `tools/import-home-features.mjs` | ✅ 家园 |
| `restored-v03.json` | 0.7 MB | 社区 | — | `tools/import-reference-data.mjs` | ✅ 背包初始装备 |
| `pet-equipment-skills32.json` | 273 KB | 抓包 | 2026-09-24 | **无** | ✅ 宠物装备技能 |
| `city-character-v1.json` | 189 KB | 录制 | 2026-09-22 | **无** | ✅ 城市角色 |
| `native-commerce.json` | 185 KB | 抓包 | 2026-09-22 | `tools/import-native-commerce.mjs` | ✅ 原版商店 |
| `spirit-seals.json` | 183 KB | 抓包（seq 617） | 2026-09-23 | **无** | ✅ 魂印 |
| `yunruo-temple-v1.json` | 161 KB | 录制 | — | `tools/import-yunruo-temple.mjs` | ✅ 永泽塔 |
| `equipment-sets.json` | 123 KB | 抓包 | 2026-09-21 | `tools/import-equipment-sets.mjs` | ✅ 套装 |
| `daily-activity-v1.json` | 119 KB | 本地 | 2026-09-25 | **无**（手写规则） | ✅ 每日活动 |
| `local-career-skills.json` | 119 KB | **本地** | 2026-10-07 | **手写** | ✅ 国家技能 |
| `boss-challenges-v1.json` | 54 KB | 本地 + 录制 | — | `tools/import-boss-challenges.mjs` | ✅ BOSS 挑战 |
| `community-growth.json` | 48 KB | 社区 | — | — | ✅ 天赋/神器 |
| `player-experience.json` | 30 KB | 社区（人物升级经验.xlsx） | — | `tools/build-player-experience.mjs` | ✅ 经验表 |
| `native-map-slices.json` | 20 KB | 本地 | 2026-09-22 | `tools/restore-native-map-slices.cjs` | ✅ 地图切片还原 |
| `fashion-icons.json` | 17 KB | **本地生成** | 2026-10-10 | `tools/build-fashion-icons.mjs` | ✅ 美容院 |
| `legion-v1.json` | 8 KB | 本地 | — | **手写** | ✅ 军团 |
| `spirit-seal-schemas.json` | 7 KB | 抓包 | — | **无** | ✅ 魂印编解码 |
| `home-feature-catalogs.json` | 3 KB | 抓包 | 2026-09-22 | `tools/import-home-catalogs.mjs` | ✅ 家园图鉴 |
| `pet-import-20260923.json` | 2 KB | 本地（报告） | 2026-09-23 | `tools/import-recorded-pets.mjs` | ❌ 导入报告 |
| `drop-web-references.json` | 2 KB | 本地 | — | **手写** | ✅ 掉落来源说明 |
| `manual-item-grants.json` | 2 KB | **本地手录** | — | `tools/extract-strength-enchant.mjs` | ✅ 手工附魔/宝石 |
| `world-travel-links.json` | 2 KB | 录制 | 2026-09-22 | `tools/import-world-travel-links.mjs` | ✅ 世界传送 |
| `equipment-skill-levels-extra.json` | 2 KB | **本地补遗** | 2026-10-08 | **手写** | ✅ 叠加装备技能等级 |
| `equipment-upgrade-rules.json` | 1 KB | **本地规则** | 2026-10-07 | `tools/build-item-affix-layouts.mjs`（v2 半自动） | ✅ 强化规则 |
| `maps/<id>.json` | 9.5 MB / 141 个 | 抓包 | — | `import-official-capture` / `merge-official-capture` / `import-recorded-expansion` / `import-yunruo-temple` / `import-boss-challenges` | ✅ 地形 |
| `references/world-online-221f8cf/` | 7.3 MB | **社区上游** | — | 只读，不修改 | ❌ 参考 |

> **`pending` 表示已知缺项**：`native-map-slices.json` 的 `pending`、`legion-v1.json` 的 `pending`、
> `pet-catalog.json` 的 `issues` 都是「还没采集到」的清单。补数据时先看这些字段，别重复找。

---

## 四、重建流程

只重建个别文件时按上表的脚本跑即可（脚本都在 `tools/`，多数是 `node tools/xxx.mjs`）。
涉及链条的要注意顺序：

```
import-official-capture       # official-v305 初建（需要抓包目录）
  → import-catalog            # catalog-skills
  → import-official-guides    # official-guides
  → build-skill-progression   # skill-progression（依赖 catalog-skills + official-guides）
  → build-career-skills       # career-skills + career-skill-directory
  → build-content-library     # content-library
```

**录制类**（`recorded-content` / `recorded-expansion`）与**抓包类**（`official-v305`）互相叠加，
重建前先确认手上的录制包是哪一批（见文件里的 `revision` / `capture`），否则会退回到更旧的版本。

**本地类**（`local-career-skills` / `equipment-skill-levels-extra` / `equipment-upgrade-rules` /
`legion-v1` / `daily-activity-v1` / `manual-item-grants`）是手写的，**没有脚本能重新生成** ——
改动它们请同时改对应的测试，并在 `修复记录.txt` 里记一笔。

---

## 五、和惰性加载的关系

`lib/` 侧对 `data/` 的读取分两档（见 `lib/lazy-data.mjs` 与 `tests/lazy-data.test.mjs`）：

- **启动就要用**：`official-v305`（经 `lib/content.mjs` 的地图/NPC）、`restored-v03`、
  `pet-catalog`、`recorded-expansion`、`career-skills`、`item-affix-layouts`、
  `equipment-skill-levels`、`maps/*`。这些第一次进世界前必定被解析。
- **按需才读**：`content-library`、`career-skill-directory`、`recorded-content`、`home-features-v1`、
  `drop-catalog`、`home-feature-catalogs`、`skill-progression`（运行期根本不读）。
  起 HTTP 服务、发静态资源、连上 WebSocket 都不会碰它们。

**移动一个文件到另一档之前先跑 `tests/lazy-data.test.mjs`** —— 它会告诉你这个文件是不是
被拉回启动路径了。

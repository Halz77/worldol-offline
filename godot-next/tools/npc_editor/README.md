# NPC 编辑器（第一版）

把 NPC 集中排进「展厅」分页地图，并在这里摆位 / 改名 / 换图标 / 改台词。
**NPC 交互逻辑不在本工具范围内**（用户自己设计）。

## 启动

```bat
"E:\Godot_v4.7.2-stable_win64\Godot_v4.7.2-stable_win64_console.exe" ^
  --path "C:\Users\hal\WorkBuddy\2026-10-24-23-22-43\godot-next" ^
  res://tools/npc_editor/NPCEditor.tscn
```

先在编辑器里把 `NPCEditor.tscn` 设为当前场景，之后按 F6 也能开。
想直接进某一页：设 `WORLDOL_NPC_PAGE=9901` 再启动。
截图或排查某个怪：设 `WORLDOL_NPC_SELECT=食人魔` 启动，会自动选中第一个名字命中的条目
（只选中、不改数据），右栏战斗数值立刻可见。

## 两个新增的数据视图（2026-11-18）

**1. 战斗数值（右栏预览图下方）**

选中一个怪就能看到，不用再去翻数据文件：

```
类型：怪物(1)
战斗：2 只 · 最高 Lv 3 · 总血 160 · 攻 1-5 · 防 0
单位：偷袭的箭手(Lv3)
```

- 链路：`NPC.battleID → groups/<id>.json`（monsters 是 10 个槽位）`→ monsters/<id>.json`。
- 同一种怪在编队里占 2 格就算 **2 只**，和原版战斗的实际站位一致。
- 282 条里有 **92 条配了编队**（75 个不同编队），其余是纯对话 NPC，显示「无战斗编队」。
- 数值来自 `monsters` 表 404 条记录（level / hpMax / atkMin / atkMax / def_str）。

**2. 类型筛选（左栏搜索框下方）**

全部 / 任务(0) / 怪物(1) / 商店(2) / 传送点(3) / 战力(5) / 交易(9) / 有战斗编队 / 无战斗编队。
`npcType` 用原版语义（`0074.js:930-943`），和搜索是「与」关系 ——
可以组合成「只看怪物 + 搜 食人魔」，列表会一起收窄。

## 操作

| 操作 | 说明 |
|---|---|
| 左键点 NPC | 选中（右栏显示全部字段） |
| 左键拖动 | 移动，自动吸附到格 |
| 中键拖动 | 平移视图 |
| 滚轮 | 以鼠标为锚点缩放 |
| `F` | 整图适配（默认视角是「看清约 5 列 × 3 行」） |
| `Ctrl+F` | 聚焦搜索框 |
| `Ctrl+S` | 保存（写 override，先备份原文件） |
| `Ctrl+Z` | 撤销（40 步；拖动/新增/复制/删除都算一步） |
| `Ctrl+N` / `Ctrl+D` | 新增 / 复制选中 NPC |
| `Del` | 删除选中 |
| `Esc` | 取消选中 |

左栏「全库搜索」勾上后搜索会跨所有页，点结果自动跳页并选中。

## 数据落在哪

```
data/overrides/npcs/index.json     页清单 + 排布参数
data/overrides/npcs/9901.json      唯一页 282 个造型（结构同 data/compiled/npcs/<mapId>.json）
...
data/overrides/maps.json           展厅页的地图元数据（追加，不覆盖已有键）
```

- 保存只动上面这些文件，**`data/compiled/npcs` 一个字节都不碰**。
- 保存前会把原文件备份到 `godot-next/_out/npc_backups/<页id>.json.bak`。
- 页内新增/删除 NPC 时，`index.json` 里的 `count` 会同步更新。
- 想彻底回滚：删掉 `data/overrides/npcs/` 目录，再把 `data/overrides/maps.json`
  里的 9901 起那些展厅页键删掉（或 git checkout）。

## 展厅是怎么排的

由 `tools/build_npc_showcase.gd` 一次性生成：

- **去重只看 `icon1`（造型）**：展厅是美术素材库，同一套造型只留一个模板。
  原版会把同一个怪摆到多张图甚至同一张图的多个格子（922 图 8 个「大剑食人魔」npcId 2..9，
  造型都是 15045），也会让不同名字共用一套造型（414 = 月狼宗剑手/刀手/族人）。
  1939 条合并掉 1657 条 → **282 个造型**。
  - 同组保留**信息最全**的一条（有名字/台词/任务组/商店优先），不是盲目留第一条；
  - 保留条带 `mergedCount` / `mergedNames`，右栏「来源」会显示「合并 N 条 · 原名：…」，
    选中一条就能看到这个造型原来还叫过哪些名字；
  - `icon1` 为空或 0 的条目直接丢；原版 31 条名字是空串，补占位名 `未命名-<icon1>`。
- 每页 **20 列 × 15 行 = 300 个**，282 个 → **1 页**（9901）。造型涨到 300 以上会自动分页。
- 每个 NPC 占 **5×5 格 = 120×120px**：`icon1` 是整套造型 model，0.45 缩放后 81×90，
  120 的格子正好留出名字和间距。
- 地图 2400×1800，没有 tile/图集/背景 JSON → 游戏里走「合成网格」兜底，正好当展厅地面。
- 顺序按「原地图 id → 原顺序」排，同一个城镇的 NPC 在展厅里也挨着，方便对照。

重排（会覆盖手工改动，慎用）：

```bat
set WORLDOL_NPC_REBUILD=1
godot --headless --path godot-next --script res://tools/build_npc_showcase.gd
```

## 和游戏里的关系

- `WorldMap.show_npcs` 默认 **关** —— 普通地图不画 NPC（数据还在，复选框可以临时打开看）。
- 展厅页（9901 起）在 `WorldScreen` 里自动打开，走进去就能看到排好的 NPC。
- 编辑器里看到的造型/位置/大小，和游戏里一致：`NpcOverlay` 用的定位公式
  与 `WorldMap._draw_npc_sprite` 完全同一套。改渲染定位时两处要一起改。
- **icon1 是「整套造型 model 编号」**（如 5004、15090），不是部件图编号。
  右栏「图标」下面会显示判定结果；填了不存在的编号会画成红叉并出现在校验里。

## 校验

编辑器「校验」按钮输出本页统计：空名字 / 图标缺失 / 越界 / 坐标重叠。
整体验收：

```bat
godot --headless --path godot-next --script res://tools/verify_npc_showcase.gd
```

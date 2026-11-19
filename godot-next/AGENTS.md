# godot-next — 世界OL Godot 4 重做工程

这个目录是「世界OL」单机版的 **Godot 4 重做**实现，与同仓库 `世界online_原版单机/`（Node 运行时 + 网页客户端）
是**两条独立的路**：

- `世界online_原版单机/` 是原版逆向出来的可跑运行时（JS），功能完整、仍在维护。
- `godot-next/` 是把客户端「用 Godot 从零重画」的实验线，核心诉求只有一条：
  **素材可掌控** —— 在 Godot 编辑器里能直接看见、替换每一张 PNG，不用和 JS 模块纠缠。

明确不追求的：测试护栏覆盖率、和 JS 客户端逐像素一致、性能优化。
不要用「测试护栏不够」或「不如继续改 JS」来劝回原方案，那条路 2026-11-15 已经停用。

## 文档分工

| 文档 | 读者 | 内容 |
|---|---|---|
| `开发指南.md` | **人，尤其新手** | 装工具 → 打开工程 → 跑起来 → 看图层 → 改界面/素材/数据 → 调试 → 自检 → 练手任务 |
| `AGENTS.md`（本文） | 写代码的人 / AI | 目录、规则、踩坑记录；动渲染/装备/外观前必读 |
| `GDD-重做方案.md` | 做功能决策 | 为什么这么设计、各阶段取舍、明确不做清单 |
| `docs/地图编辑与重命名指南.md` | 只想改地图 | 地图编辑器操作细节 |

新手先读 `开发指南.md`；本文假设你已经能跑起来，只讲"改之前必须知道的规则"。

## 目录结构

```
godot-next/
  project.godot              工程文件（渲染器：GL Compatibility）
  开发指南.md                 新手入门：装工具 / 跑起来 / 看图层 / 改东西 / 调试 / 练手
  自检.cmd                    一键跑资产闸门 + 七套验收（串行，失败非 0 退出）
  assets/
    sprite_model/<modelId>.json|png    角色/怪物模型（frames + anis 动作表）
    sprite_fragment/                   角色部件库（不要拿来当地图贴图）
    map/<mapId>.json                   地图视觉数据（mW/mH/tW、tiles、layers）
    map_merged/<mapId>.json|png        该地图的图集（frames 名 → 矩形）
    map_slice/<name>.png               全局切片图集（tile 层主要贴图来源）
    tilesets/map_ground.tres           地面图块库（TileSet，由 tools/build_map_tileset.gd 生成）
    ui/item_icon*.png|json             道具/坐骑/宠物图标图集 + 子区域帧表
    map_bg/<mapId>.jpg                 ⚠ 不是底图，见下
  data/compiled/
    mapFrames.json                     全局跨图集帧索引（name → atlas + frame）
    tileAtlas.json                     资源名 → TileSet source / 图集坐标 / 镜像变体
    itemIcons.json                     道具图标号 → 图集 + 矩形（924 个）
    npcs/<mapId>.json                  该地图 NPC
  scripts/
    ScreenState.gd       Autoload，全局状态 + 信号（含 equipped / appearance 两份独立存档）
    CharacterScreen.gd   角色屏（含"装备→"/"外观→"入口，快捷键 E / L）
    CharacterPlayer.gd   各屏共用立绘（SpriteComposer；装备切 model + 换部件，外观再叠一层）
    StatsPanel.gd        属性面板
    Equipment.gd         装备规则层：部位/属性加成/外观（武器切 model、防具换部件）
    EquipScreen.gd       装备屏：造型预览 + 部位槽 + 候选装备 + 属性变化
    Appearance.gd        外观规则层：发型/脸型/手/脚图号公式、可用档位、随机、自由调色表
    AppearanceScreen.gd  外观屏：缩略图选档 + 拾色器调色 + 实时预览 + 配色预设
    Recolor.gd           自由调色引擎：相对明度重映射（full 整层 / skin 只染肤色）
    WorldScreen.gd       世界地图屏（相机、输入、切图）
    WorldMap.gd          地图渲染核心：按 cfg 建图层节点（TileMapLayer / 物件层）+ 补洞 + 变换
    MapTiles.gd          地面 TileSet 索引：资源名 → source / 图集坐标 / 镜像变体
    MapObjectLayer.gd    一个物件层的绘制节点（自由坐标物件 + 旋转/镜像）
    MapCellOverlay.gd    单层格子叠色节点（100 号 106_1 轻微压暗）
    WorldPlayer.gd       地图上的角色（AnimatedSprite2D + SpriteFrames 的 idle/walk）
    ModelAnimations.gd   模型 anis → SpriteFrames（动作命名、帧率、循环）
    ItemIcons.gd         道具图标号 → AtlasTexture（assets/ui 图集 + itemIcons.json）
    SpriteComposer.gd    运行时拼角色部件成整图
    NpcInfo.gd           NPC 战斗信息聚合（npcType 语义 + battleID→group→monster 数值）
    Naming.gd            中文标签表
  scenes/                由 tools/build_*.gd 用 PackedScene.pack() 生成，可在编辑器里改
  docs/
    待改进方案.md                地图问题清单（玩法/渲染/内容）+ P0–P2 改进路线
    地图编辑与重命名指南.md      地图增删改、tile/阻挡/物件、三层名字与改名方案
  tools/
    build_scene.gd         生成 CharacterScreen.tscn
    build_world_scene.gd   生成 WorldScreen.tscn
    build_equip_scene.gd   生成 EquipScreen.tscn
    verify_character_screen.gd   44 项断言
    verify_world_map.gd          地图全量断言
    verify_map_editor.gd         地图编辑器断言（只在内存里改，不写真实 assets/map）
    verify_equipment.gd          装备系统断言（属性/外观/UI 穿脱链路）
    verify_appearance.gd         外观系统断言（图号公式/档位/渲染差异/存档往返/与装备共存）
    verify_npc_showcase.gd       NPC 展厅 + 编辑器断言（分页/不重叠/存储往返）
    build_npc_showcase.gd        把 1939 个 NPC 排进展厅分页（一次性生成 override）
    build_map_tileset.gd         扫地图 + map_slice → assets/tilesets/map_ground.tres + 索引
    verify_assets.gd             资产闸门：缺图 / 图块库过期 / 图标不可用 → 退出码 1
    extract_ui_frames.mjs        原版资源表 → assets/ui/*.json + data/compiled/itemIcons.json
    map_editor/
      MapEditor.tscn       地图编辑器入口（正常窗口跑，不做 @tool 插件）
      MapEditor.gd         载入 / tile·阻挡·物件三种画笔 / 图层增删 / 新建复制图 / 改尺寸 /
                            改名 / 批量换资源 / 校验 / 撤销 / 原子保存（第二版全实现）
      MapOverlay.gd        阻挡格 / 格线 / 悬停格 / 出生点 / 选中物件黄框
      README.md            操作、快捷键、保存行为与第二版边界
    npc_editor/
      NPCEditor.tscn       NPC 编辑器入口（正常窗口跑）
      NPCEditor.gd         分页/列表/全库搜索/点选拖动/属性编辑/新增复制删除/撤销/校验/保存
      NpcOverlay.gd        画 NPC 造型、名字、选中框、悬停框（定位公式与 WorldMap 一致）
      README.md            操作、数据落在哪、与游戏内渲染的关系
  data/overrides/
      map_names.json       地图改名 override（name_of 优先读它）
      maps.json            新建地图的元数据 override（ids/get_entry/name_of 三处都读）
      npcs/index.json      NPC 展厅页清单（页 id / 数量 / 排布参数）
      npcs/<页id>.json     NPC 展厅每页数据（结构同 data/compiled/npcs/<mapId>.json）
```

## 运行与验证

本机 Godot 在 `E:\Godot_v4.7.2-stable_win64\`（`Godot_v4.7.2-stable_win64.exe` + `_console.exe`，有 headless，非 mono 版）。
2026-11-17 用 4.7.2 跑过全部自检与三个验收脚本，均通过（`verify-data-compile` 的域数量断言已随阶段 3 更新为 12）。
⚠ 非 mono 版：工程里 `[dotnet]` 段已删、`project.godot` 的 `config/features` 写 `"4.7"`；
不要用旧 4.3 mono 版打开（会重写 project.godot 并加回 dotnet 段，features 打回 4.3）。

```bash
# 一键全跑（资产闸门 + 七套验收，按顺序跑；失败会以非 0 退出）
自检.cmd                     # Windows 直接双击也行；Godot 不在默认路径就 set GODOT=...

# 自检（headless）
Godot_v4.7.2-stable_win64_console.exe --headless --path godot-next --script res://tools/verify_assets.gd
Godot_v4.7.2-stable_win64_console.exe --headless --path godot-next --script res://tools/verify_world_map.gd
Godot_v4.7.2-stable_win64_console.exe --headless --path godot-next --script res://tools/verify_character_screen.gd
Godot_v4.7.2-stable_win64_console.exe --headless --path godot-next --script res://tools/verify_map_editor.gd

# 地图编辑器（正常窗口；保存直接写 assets/map/<id>.json，F5 生效）
Godot_v4.7.2-stable_win64_console.exe --path godot-next res://tools/map_editor/MapEditor.tscn

# 实拍截图（必须用正常窗口，headless 是 dummy 渲染驱动，截不了 UI）
WORLDOL_CAPTURE=1 WORLDOL_MAP=16 Godot_v4.7.2-stable_win64_console.exe \
  --path godot-next res://scenes/WorldScreen.tscn --quit-after 60
# 产物：godot-next/_out/world_screen.png
```

### 在编辑器里怎么看图层 / 图块（新手向）

1. Godot 启动界面 →「导入」→ 选 `godot-next/project.godot`，双击打开。
2. 底部「文件系统」里双击 `scenes/WorldScreen.tscn`；左侧「场景」面板显示节点树。
3. `WorldScreen → WorldMap` 下面有 `Layers / Npcs / Names` 三个容器。
   **`Layers` 的子节点是运行时按地图建的**，编辑器里是空的；要看到实际图层（`Layer5_tiles` 等）
   得先运行：按 **F6**（运行当前场景）或 F5，然后在「场景」面板左上角把
   **「本地 / Local」切到「远程 / Remote」**，再展开 `WorldScreen → WorldMap → Layers`。
4. 不想开界面时：`WORLDOL_TREE=1` 跑一次，控制台会打印整棵节点树。
5. 看图块本身：双击 `assets/tilesets/map_ground.tres`，底部会打开 TileSet 编辑器，
   一个来源 = 一张 map_slice 图，格子里就是切好的 24×24 图块。
   改图块属性（锚点/变体）在这里改，改完记得重跑生成器覆盖会丢。

两套自检**不要并行跑**，会抢同一个存档文件导致偶发失败。
`verify_character_screen.gd` 现在会**先备份、跑完还原** `user://character_screen.json`
（以前跑到一半被打断就把 `sex=男` 留在档里，下次「默认女」直接挂；顺手归一化到女/正常再验）。

**★ 新检出一份工程（或换机器 / 刚 git clone）后，第一次跑验收前必须先 `--import`**：
```bash
Godot_v4.7.2-stable_win64_console.exe --headless --path godot-next --import
```
否则 `.godot/imported` 是空的，`load("res://assets/map_merged/100.png")` 返回 null，
`verify_world_map` 会出现两条**假失败**（`带偏移帧用 sourceW/H 逻辑包围盒 (0.0, 0.0)`、
`本图缺帧时从别的图集补回`）——不是代码问题，是纹理没导入。导入后两条立刻转绿。

导出的 JSON/PNG 改动后如果 `load()` 报 "No loader found"，跑一次
`--headless --path godot-next --import` 生成 `.import`，不要把图当坏图。

### 素材读取缓存（2026-11-19）

`SpriteComposer` 每帧都要拼 10~12 个图层。改造前**每层都从磁盘重解 PNG**，
实测整帧 5.30ms，其中约 4.8ms 全是重复解码（单张小图解码 0.36ms、手部大图 0.45ms），
model JSON 一帧还被解析 2~3 次（0.17ms/次）。

现在按「文件修改时间」缓存三样东西：`图号 → Image`、`路径 → JSON`、`图号 → 帧表`。
**mtime 变了自动重读**，所以「改 PNG 下一帧立刻生效」这个约定没丢；
要强制重读（同组其他色号的 .json 改过、或同一秒内连写两次）调
`SpriteComposer.clear_asset_cache()`，角色屏「重新载入素材」按钮已经接上。

实测：首帧（冷）5.21ms → 同帧热态 **1.53ms**、换帧热态 **2.21ms**。
注意 `_atlas_of()` 返回的是缓存里的**共享 Image**：只能读；要 resize / 染色必须先 `duplicate()`
（`_sub_frame()` 已经保证对外返回新图）。

## 资产闸门（tools/verify_assets.gd，2026-11-19）

- **干什么**：确认「地图 tile / 物件、角色部件、道具图标、NPC 造型、UI 图集」引用到的文件都在。
- **为什么**：缺图在运行时是**静默跳过**的（少一块地面、空图标，不报错），只能靠人眼发现。
  挂进 `自检.cmd` 后，缺东西当场红。
- **口径**：
  - `data/asset_allowlist.json` 是**已知缺口基线**（原版客户端本身就没这些文件）。
  - 不在基线里的新缺口 → **退出码 1**，并打印 `tiles NOPE ← 地图 [100]（共 3 处）`。
  - 额外抓「图块库过期」：切片图在、`tileAtlas.json` 里没这个名字 → 改了素材但没重跑
    `tools/build_map_tileset.gd`。
  - 会真的把 924 个图标各造一次纹理：PNG 在但编号查不到 / 矩形越界同样算失败。
- **更新基线**：`-- --update-allowlist`（只在确认缺口是原版真实缺失后才用）。
- **当前基线**：地块 5 / 物件 37 / 部件 18；道具图标 2505 件全覆盖。
- **产物**：`_out/asset_report.json`（每个缺口影响哪些地图 / 模型 / 道具）。

## 道具图标（assets/ui + itemIcons.json，2026-11-19）

- 图集是 `assets/ui/item_icon*.png` / `item_mount` / `item_pet`
  ——一张图上摆着几十个尺寸不同的小图（70×70、32×32 混排），不是等距网格。
- 矩形来自原版资源表，由 `tools/extract_ui_frames.mjs` 抽成：
  - `assets/ui/<图集>.json`：与原图同名的帧表（name → x/y/w/h）
  - `data/compiled/itemIcons.json`：924 个图标，图标号 → 图集 + 矩形
- 运行时：`ItemIcons.texture(bagIcon)` → `AtlasTexture`（内部缓存）；没有图标返回 null。
  装备屏的候选列表（28px）与左侧槽位（20px）都已挂上。
- 改了图标素材 / 新增图集 → 重跑 `node tools/extract_ui_frames.mjs`（默认读原版资源表）。

## 地图图层节点化（2026-11-19：TileSet / TileMapLayer）

地面不再走 `_draw` 的即时绘制，而是**一个原版图层 = 一个节点**，挂在 `WorldMap/Layers` 下：

| 原版层 | 节点 | 说明 |
|---|---|---|
| type 2 地块层 | `TileMapLayer`（`Layer<i>_tiles`） | 共用 `assets/tilesets/map_ground.tres` |
| type 3 / 4 物件层 | `MapObjectLayer`（`Layer<i>_objects`） | 自由坐标物件，保留精灵式绘制 |
| 补洞层 | `TileMapLayer`（`Prefill`） | 旧实现画在最底层，这里同样是最底层节点 |
| 100 号压暗 | `MapCellOverlay`（`Layer<i>_tone`） | 紧跟所属地块层之后，保持「只压这一层」 |

- **顺序靠树顺序**：建节点时仍按 `layers.size()-1 → 0`，先建的在下。**不要改 z_index**，
  z_index 会把同层内部的前后关系也打乱。
- **物件不做成 tile**：物件坐标是任意像素、尺寸各异、还带 8 种旋转，TileMapLayer 是整数网格，
  放不下。原版本身也是「精灵自由定位」，所以只有地块层进 TileMapLayer。
- **图块库由 `tools/build_map_tileset.gd` 生成**：一个 `map_slice/<name>.png` → 一个
  `TileSetAtlasSource`，纹理区域 24×24，(col,row) 就是子格（206 张切片全部是 24 的整数倍）。
  镜像用 alternative tile：`transform 1 → flip_v`、`2 → flip_h`、`3 → 两者`；
  只给地图里真用到的组合建变体（920 图块 + 1164 变体，.tres 122KB）。
  **改了切片图或新地图用了新变换 → 重跑生成器**：
  `Godot --headless --path godot-next --script res://tools/build_map_tileset.gd`
  它会同时刷新 `data/compiled/tileAtlas.json`，两者必须成对更新。
- ★ **图层节点不要写死纹理过滤**：旧路径继承 WorldMap 的默认过滤，改成 NEAREST 会让
  整张图和改造前差 3.6% 像素（缩放时半像素偏移）。现在显式 `TEXTURE_FILTER_PARENT_NODE`。
- ★ **补缺图不能传染**：同层缺图格用「最近的、本来就有图的格子」补。旧实现的 `painted`
  数组在补的过程中不更新；新实现必须用 `built.duplicate()` 快照，否则补出来的格子会被
  后面的格子当样本，材质一路向内扩散（实测 121 格颜色全变）。
- **补洞从「每帧算」改成「载入时算一次」**：`_prefill_holes()` 只产出 `_prefill_cells`，
  由 `_rebuild_render()` 写进 `Prefill` 层。
- **刷新入口**：改完 `cfg` 调 `world_map.refresh()`（重建节点树 + 重画自身）。
  地图编辑器里 8 处 `queue_redraw()` 已全部换成它；只 `queue_redraw()` 不会重建图块。
- **「只看选中层」**：图层是真实节点，`solo_layer(li)` 直接切 `visible`，不重算数据。

### 验收口径（换渲染路径时最有用的一条）

新旧实现的截图在**同分辨率**（`--resolution 1200x960` + `WORLDOL_FIT=1`）下逐像素比对：
地图 4 / 100 / 17 / 458 / 2020 / 9901（NPC 展厅）**全部 0 像素差**。
以后再改渲染层，用这个办法先确认「画面没变」，再谈优化。

## 地图渲染的关键事实（都是踩过的坑，改之前先看这里）

### 1. 图层顺序：必须**倒序**建节点
原版 `scene.init` 从 `layers[length-1] downto 0` 逐个 `addChild`，所以 `layers[0]` 在最上层。
`_rebuild_render()` 也按倒序建节点，**不能**改成「先建全部 tile 层再建全部物件层」，
否则交替层的前后关系全错（tile 会盖住物件）。

### 2. tile 层数据编码
`layer.data[i]` 要 `& 255` 解码成 `tileList` 索引，只有**解码后 == 255** 才是空格。
原始数据里有约 1.8 万个负数是正常编码，直接判 `idx < 0` 会造出满屏白/紫色块。
`tiles` 定义是 `[图名, 变换, 横格数, 纵格数]`，先 row 后 col 展开；裁子帧时
**横纵要各自判断**，5×1 / 4×1 的图集不能要求两轴都大于 tile。

### 3. 变换 0–7 的权威语义（原版 `t.transform()`，egret 锚点在左上）
```
1 MIRROR_V      scaleY=-1                    y += h
2 MIRROR_H      scaleX=-1                    x += w
3 ROT180        scale=-1,-1                  x += w, y += h
5 ROT90         rotation=90                  x += h
6 ROT270        rotation=270                 y += w
4 MIRROR_H_90   scaleY=-1 + rotation=90      无位移
7 MIRROR_H_270  scaleY=-1 + rotation=270     x += h, y += w
```
**★ 位移和源矩形必须用纹理原始尺寸 `sourceW/sourceH`，不能用 `obj[4]/obj[5]`。**
旋转物件的 obj 宽高是转置的（纹理 104×58，obj 写 58×104），用 obj 算会画出黑边／错位。

**★ 不要用 `draw_set_transform` + 负缩放来画旋转物件。** 旋转后包围盒和目标矩形对不齐，
会露出底色方块（16 号石头 361 曾被画成青绿矩形）。现在走 `_transformed_texture()`：
按 region 裁子图 → `Image.flip_x/flip_y/rotate_90` → 按变换后尺寸画，并按
(纹理, 区域, 变换) 缓存。注意方向枚举是 `ClockDirection.CLOCKWISE`，**不是** `Image.Direction`。

### 4. 贴图优先级
`map_merged/<id>.json` 的 frames → `data/compiled/mapFrames.json` 全局帧 → `map_slice/<name>.png`。
**地图贴图绝不回退到 `sprite_fragment/`**（那是角色部件库），fragment 只用于 NPC 图标。
图集帧的 `sourceW/sourceH + offX/offY` 是逻辑包围盒（如 1101 是 61×55 像素 / 65×55 逻辑 / 左移 4），
必须先还原再画，否则物件错位拉伸。

### 5. 黑块 / 补洞：只能补「所有 tile 层都没内容」的格子
- `assets/map_bg/<id>.jpg` **不是地图底图**：全是 160×100 的原版「场景切换模糊过渡图」
  （`getMapBlurUrl`）。拉伸铺底会在 tile 空格处露出放大 7 倍的糊色块
  （16 号台阶石头连接处、19/23/24 的怪色块都是它）。正常地图一律不画，只给合成网格地图当底衬。
- 曾经把 tile 空格**一律**填成地面，结果 2 号湖面、7 号桥下、17 号台阶全被糊掉。**别再这么干。**
- 正确做法 `_prefill_holes()`：倒序算出每格最终可见的地面，只给「全层皆空」的格子补最近地面。
  补的时候跳过全透明图（`91.png` 之类 alpha≈0 的占位）和纯黑图
  （`91.png` 还有个 RGB 全 0、alpha≈0.4 的黑色阴影版本，当地面填就是黑方块），并优先选亮度 ≥0.30。
- 265/275/276/964 这类「没有背景图 + 大片空格」的地图仍有残留色差格，属已知取舍。

### 6. ★ 半透明叠加层不是地面（260/275/276 这类"地面断层"的根因）
`map_slice` 里有一批图整体 **alpha≈0.40**，它们天生是「叠在别的地面上」的叠加层：

| 资源 | RGB | 作用 |
|---|---|---|
| `137` | 石路纹 | 铺装纹理叠加 |
| `91` | 全 0 | 黑色阴影 |
| `135` | 全 0 | 更深的阴影 |
| `184` | 深绿灰 | 色调压暗 |
| `255` | 米黄 | 高光/日照 |

导出成 PNG 单看是"灰块"，其实是因为叠在了白底上。**判断"这一格有没有地面"必须看
实心程度**（`_region_is_solid()`：alpha≥0.85 的像素要过半），不能只看"有没有不透明像素"。
否则这些叠加层会被当成地面，而它们底下压根没有实心地面 → 叠出来就是一条条**半透明白斑**
（260 圆盘周围那片"地形明显不对"、"圆盘浮在雾上"就是这个）。

反过来，`135/184/255` 这类光照蒙版**必须照常画**：试过跳过它们，整张地图立刻变成
深浅交错的棋盘马赛克（100 号验证过）。它们本身没问题，问题只在"底下没有实心地面"。

### 7. 资源表里根本不存在的图
`map_slice` / `map_merged` / 全局帧索引里都查不到，原版 gd 资源表也没有 —— 这是原数据里的
死引用，客户端同样取不到：

- `182` / `183`（3×4 图集）、`136`（6×1）、`138`（2×1）—— 100 号 layer3 大量引用。

后果：那一层画不出来，盖不住底下 `layer5` 的淡色 `106_1`（亮度≈0.60，周围草地≈0.45），
100 号中下部就整片发白、边缘是直角阶梯。

处理：**没有替身图可用**（不要拿 304/水/石路去"补"——试过，拼出来是马赛克，比原来更糟）。
现在只对 100 号做「轻微压暗」（`_tone_down_map / _tone_down_srcs / _tone_down_alpha`），
把 106_1 压到接近周围草地，只调色不换铺装。

### 8. 角色行走（动画已改 SpriteFrames / AnimatedSprite2D）
`WorldPlayer` 用正常造型底盘（女 300 / 男 100），但**再走一遍装备外观**：
`Equipment.appearance(gd, 正常 model, equipped)` 决定最终 model（武器姿势 → +type；坐骑 → 整幅马 model），
再由 `SpriteComposer.render_frame_equipped()` 换部件图 / 叠披风，跟角色屏、装备屏同一条路径。
换装靠 `ScreenState.state_changed` 触发 `_rebuild_frames()`，不用重进场景。

行走只播 `anis[2]` 的 `[4,5,6,7,8,9]`，静止显示 `anis[0]` 首帧 0。**不要**取 `frame_numbers()` 全帧、
也不要跟随角色屏的战斗姿势（会混入战斗动作帧）。地图角色与角色屏**姿势**解耦，但**装备**同源。

动画结构（2026-11-19 起）：
- `ModelAnimations.build(model_id, replace, single_use, add_parts, cloak_model, tints)`
  把模型 `anis` 编译成 `SpriteFrames`：动作名 `idle`(id 0) / `walk`(id 2) / `action<id>`，
  帧率 `walk 7fps`、`idle 4fps`，循环取 `anis.loops`。
- 场景里 `Player/Sprite` 是 **AnimatedSprite2D**；走 `play("walk")`，停 `play("idle")` + `pause()` + `frame = 0`
  （保持改造前「静止只显示站立首帧」的画面）。
- `gesture` 里的第二列**不是毫秒**（0 号动画混着 4/1/2），所以不按它换算帧率，按动作类型给固定帧率。
- 为什么不烘 `.tres`：帧是「基础模型 + 装备换部件 + 外观换发型 + 自由调色」运行时合成的，
  组合数远超素材数量；`SpriteFrames` 在换装/换外观时重建一次（10 帧约 15ms）。
- NPC 展厅的 282 个造型仍是静态站立帧（282 个 SpriteFrames ≈ 4 秒，不值当）。

### 9. NPC
默认不渲染（`WorldMap.show_npcs = false`），左侧勾选恢复；数据全量保留。
`icon1` 可能是 fragment 静态图，也可能是 `sprite_model`（用 SpriteComposer 现拼，取 `anis[0]` 站立帧）。
越界 NPC 夹到地图边缘，不丢实体。任务系统本期不移植，`missionData` 原样留在数据里。

## 调试开关（环境变量，正常游玩不触发）

| 变量 | 作用 |
|---|---|
| `WORLDOL_MAP=<id>` | 启动直接进指定地图 |
| `WORLDOL_CAPTURE=1` | 渲染若干帧后存 `_out/world_screen.png` |
| `WORLDOL_FIT=1` | 整图缩放进窗口（坐标可线性换算，定位问题用这个） |
| `WORLDOL_GRID=1` | 画格子标尺（每 5 格一条线） |
| `WORLDOL_SKIP=<资源名>` | 不画指定物件（逗号分隔可多个） |
| `WORLDOL_SKIPTILE=<资源名>` | 不画指定资源的 tile（定位"这块地面是谁铺的"，如 `106_1`） |
| `WORLDOL_NOOBJ=1` | 不画物件层，只看地面 |
| `WORLDOL_ONLYLAYER=<n>` | 只画第 n 层 |
| `WORLDOL_NOTRANS=1` | 忽略旋转变换 |
| `WORLDOL_DEBUG_PREFILL=1` | 打印补洞格坐标与数量 |
| `WORLDOL_DEBUG_SKIP=1` | 打印资源缺失被跳过的格 |

地图编辑器专用（都不是正常游玩会触发的）：

| 变量 | 作用 |
|---|---|
| `WORLDOL_AUTOSHOT=<资源名>` | 截图前自动在地图上放一个该资源的物件（实测物件渲染） |
| `WORLDOL_QUITAFTER=<秒>` | 截图后自动退出（无人值守实测） |

编辑器的截图产物是 `_out/map_editor_screen.png`（游戏世界是 `_out/world_screen.png`）。

## 装备系统（基础版，2026-11-18 落地）

- **范围**：只做基础属性 + 外观；强化 / 鉴定 / 套装 / 绑定 / 时装全部不参与。无穿戴限制。
  入口：角色屏「装备 →」按钮或快捷键 `E`；装备屏 `Esc` / 返回按钮回角色屏。
- **数据真身**：`data/compiled/items/<id>.json`，2505 件。三个关键字段：
  `type`=部位（0头/1衣/2裤/3肩/4腰/5背/6鞋/7手/8链/9戒/10护符/11坐骑/12时装/13-24+34-39武器）；
  `def_str/def_agi/def_mag`+`powerN/powerValueN`=属性加成；**`icon` 是外观编码（部件图编号），不是背包图标**（`bagIcon` 才是图标）。
- **power id → 属性键**：常量表在 `analysis/modules/0004.js:2545+`；映射写在 `Equipment.gd:POWER_TO_STAT`。
  ⚠ `POWER_IDENTIFY=121` 是鉴定占位（高档装备大量出现），必须忽略；百分比类/技能类/宠物类本阶段不映射。
  注意 `def_str` 在道具表里是**装备提供的防御值**，映射到 `DEF_STR`（不是需求属性 `reqStr`）。
- **属性公式**：`Stats.gd` 的 20 角色基线是静态快照（已含 inventory 装备），**不能改**。
  装备屏显示的是「装备加成汇总」——`Equipment.aggregate_stats()` 把当前穿戴的加成算出来，
  界面标注"在所选角色基线之上叠加"，不重写基线、不追求逐字段对拍。
- **★ 外观三条路径（实测可用，别推倒重来）**：
  1. **武器 → 换整 model**：`sprite_model/<基础姿势 + 武器姿势偏移>.json`。偏移照
     `0055.js getSpriteNameIDByWeapon`：空手 24 / 重武 17 不加偏移（保持 100/300），
     单手锤 37→+44、双手枪 36→+73、扇 39→+37，其余 = type 本身（女正常 300 + 青铜剑 type13 = 313、
     法杖 type19 = 319；男 100+13=113）。基础 model 见 `ScreenState.MODEL_TABLE`。
     帧号校验：正常 model（100/300）与武器 model 帧号完全一致；战斗 model（200/400）武器 model 少 2-4 帧，
     `render_frame_image_equipped` 有 fallback 取首帧，不崩但个别战斗帧姿势会跳。
  1.5 **★ 槽位归属铁律（2026-11-18 三轮踩坑）**：`at = floor(部件id/1000)`，
     部位常量 `0055.js:19-35`：`PNG_SHOULDER=4 / BACK=5 / CLOTHES=6 / TROUSERS=7 / WEAPON=8 / HELMET=10 / TRANSPORT=14`。
     **头盔槽是 10021（at=10），绝不是 11001（at=11=EQUIP_OTHER=灰色脚底阴影）**——
     换错槽头盔就掉到脚底。武器部件是 model files 里 at=8 的项（313 的 8001 / 319 的 8385），
     换 model 后还要把它换成装备的具体武器图。
     **★ 武器图号 = icon 本身**：`0056.js:3574` 解码 `/4`、`0055.js:793 getWeaponIcon` 编码 `*4`，互逆。
     曾用 `/8` 解码导致法杖 8392→算成 8200（刀区间）、轻弩 8517 与重弩 8581 都回退共用图。
     直接 `weapon_fragment_id(icon)=icon` 才对，每件武器/每种弩各用各的图。
  2. **防具 → 换部件图（★ 2026-11-18 重做，别退回旧做法）**：
     原版 `0055.js doChangeSpriteIcon` 是「静态 model + 运行时按 icon 位域换 files 槽位图」，
     定位靠 `frame` 里烘焙的中心 (dx,dy) + 实际图尺寸/2 做锚点（`0366.js`，`SpriteComposer` 的
     `px=中心+dx-w/2` 已正确，不要改锚点公式）。**关键坑：性别半区**——
     衣/裤/肩每 style 占 8 个图号（4 男 + 4 女），装备表 `icon` 是男款号，女角色必须 +4 换女款图
     （`Equipment.part_fragment_id(icon,type,gender)` 忠实移植 `START+(style<<3)-7+(gender<<2)+color`）。
     实例：衣 6075→女款 6079、裤 7089→7093、肩 4145→4149（尺寸都不同，直接用 icon 就是让女角色穿男款图而错位）。
     头盔 4 步长、无性别位，icon 直接用。槽位 key 按 model 性别选：
     男 100/200 = 衣6001/裤7001/肩4001；女 300/400 = 衣6005/裤7005/肩4013（见 `Equipment.ARMOR_SLOT`）。
     鞋/护手/首饰 icon 多为 0、原版不改外观，跳过。
     **★ 护肩图集帧表要借色号**：基础肩 4013 是 2 帧图集（左右两片），model frame 引用两次。
     装备图（朱红支配衬肩 icon 4084→女款 4088、星月冥肩 4132→女款 4136）本身也是 2 帧图集，
     但**同款 4 个色号只有组首带 `.json` 帧表**（4081 有、4082~4084 没有）。
     缺表时会把整张双片图集当「一帧」画 → 两片被挤在一起/位置错位。
     `SpriteComposer.fragment_frames()` 缺表时借用「同组（4 色一组）、同画布尺寸」色号的帧表；
     `Equipment.is_multi_frame()` 走同一套判定，多帧就按 model 的两个 layer 各画一片。
     只有组内确实没有 json 的整图（如头发 1）才标 `single_use` 让 `SpriteComposer` 只画一次，
     且这种图宽 >34px 时等比缩到 34px、位置取多片中点（兜底机制，普通肩甲用不到）。
     **★ 不要靠「借邻居表」猜布局（2026-11-18 教训）**：恶魔之翼 `14169~14172` 当初看起来
     「整组缺表」，其实是**导出素材时漏了 1025 个部件帧表 + 417 个 model 表**（原版都有）。
     如果运行时按「同段 + 同尺寸」去借表，会误伤大量其他坐骑图集（同尺寸不等于同布局）。
     现在缺表一律**从原版补数据**：`python tools/restore_sprite_tables.py`
     （读原版 `client/v/gd/305.json` 的 `assets/sprite/{fragment,model}/<id>.json -> hash` 映射，
     部件只补「已有同名 PNG 但缺 json」的、model 缺表就补，可加 `--dry` 预览）。
     补完 14169 是 7 帧、14229 是 16 帧、4185 是 2 帧，整类「整张图集当一帧」的错位一起消失。
     ★ **缺 model 表的后果更隐蔽**：`Equipment.appearance()` 查不到 `743/943`（恶魔之翼无武器款）
     就直接保持基础造型，表现为「装备了坐骑但人物完全没变」；摩托 `758` 恰好存在所以看着正常。
     新增坐骑后先跑 `verify_equipment` 的「151 件坐骑 × 男女 × 空手/刀」断言，别让它静默回退。
  3. **★ 背部 / 坐骑 → 换整幅 model（2026-11-18 落地，别硬贴）**：
     原版这两类都不是「换某个部件图」，而是换 model id（`0055.js getSpriteIdByIcon`）：
     - **坐骑**：style = `1+((icon-14000-1)/4)`（14017 白狼 → style 5）。
       双人坐骑 11/54、以及无武器 / 重武(17) / 空手(24) → `700+style`（女 `900+style`）；
       其余 → `2000+100*(style-1)`，`>=4000` 再 +26000，女 +50，最后加**骑马**武器偏移
       （单手枪 35→42、双手枪 36→43、单手锤 37→24、双手锤 38→36、扇 39→37，其余 = type）。
       实例：男/s5/刀 = 2413、女 = 2463；无武器 男/s5 = 705、女 = 905。
       骑马 model 的 files 里已经含「坐骑片段 140xx + 角色部件 + 武器」，所以防具/武器替换照旧走 `part_replace`。
       ★ **坐骑颜色 = icon 低两位**（`0055.js` PNG_TRANSPORT 分支：`nt = ot-((ot-1)&3)+Z`）：
       icon `14025..14028` 是 style 7 的 4 个色号（飞龙/白幼龙/蓝幼龙/幼龙），
       `Equipment.transport_color_of_item()` 算出 0..3，`appearance()` 把 model 里的
       `14xxx` 图层换成同组对应色号。只按 style 取 model 会让 4 条龙全是一个颜色。
       ★ **空手要去掉武器层**：坐骑的无武器 model（743/943 等）与带武器款共用同一份 json，
       模型里可能带 at=8 图层；原版 `doChangeSpriteIcon` 在没装备武器时把它置 null。
       我们用 `part_replace[frag] = -1` 表示隐藏，`_blit_model()` 跳过该层。
       ★ 只在世界图（100/300）显示坐骑；战斗图（200/400）原版不骑马（`getSpriteIdByIcon` 的 `0==n` 分支）。
     - **背部**：backStyle = `1+((icon-5000-1)/4)`；cloak model = `1100+backStyle`。
       style 31 不显示；坐骑 style 36/42/43/48 时藏披风；衣服 style 51 强制 cloak 32（现有道具没有 51）。
     - **★ 披风定位 = coatPt（最容易错的一步）**：原版 `0365.js FrameBmp.draw` 会把该帧
       「衣服层」（`frag/1000==6`）的 `(dx,dy)` 记成 coatPt，`0364.js drawTo` 再把 cloakSprite
       整体平移到 coatPt，披风自己的 dx/dy 相对该点。少了这步披风会掉到脚底
       （model 100 帧 0 的 coatPt = `(-2,-35)`）。`SpriteComposer._frame_coat_point()` 取点，
       `_cloak_frame_index()` 让披风走自己的 0/1/2/1 循环。
     - `SpriteComposer` 仍保留 `add_parts` 追加图层能力（自检里有断言），但 `appearance` 不再生成它。
   4. **★ 武器特效层默认不画（at=15）**：每把武器的 model 都带一层 `15001`
      （`PNG_WEAPON_FLASH`，原版那圈绿色光效）。原版只在武器 icon 带 flash 样式时才画，
      普通武器会把这一层整个丢掉（`0055.js doChangeSpriteIcon` 把文件 id 置 null，
      `0365.js FrameBmp.draw` 的 `l && t.push(s)` 跳过）。我们暂不解析 flash 样式 →
      `SpriteComposer.draw_weapon_flash = false`，`_blit_model()` 直接跳过 at=15。
      需要复现原版特效时把它置 true（自检里就是这么对比的）。注意：武器贴图本身那条青色光刃
      属于 `8001` 武器图，不是这一层，去掉特效不会消失。
   5. **★ 无外观编码的槽位也要能选**：腰带(4)/鞋(6)/护手(7)/项链(8)/戒指(9)/护符(10)
      在原版道具表里 **icon 恒为 0**（本来就不改外观，只加属性）。
      `items_for_slot()` 以前要求 `icon>0`，结果这些槽位一件都列不出来；
      现在只按 type 过滤，穿上后走 `aggregate_stats()` 加属性，外观保持基础造型。
   6. **★ 时装（type 12）= 一整套部件覆盖，不是换 model**：道具不带外观 icon，
      而是带 `fashIcon1/2/3` 三段 64 位位域（另一套角色 icon）。原版
      `0056.js updateIconByFashion()` 在装备之后把它们覆盖到角色 icon 上，
      再走 `doChangeSpriteIcon` 换部件图。所以：
      - `Equipment.fashion_parts()` 解码 → `{at: 图号}`（0 发/1 脸/2 手/3 脚/4 肩/
        6 衣/7 裤/10 头），`appearance()` 把当前 model 里同 at 的图层整体替掉；
      - **不改 model id**，也不写 transport 位 → 穿时装不会顶掉坐骑（用户明确要求）；
        骑马 model 里有身体部件，时装照样生效；恶魔之翼这种「整个身体被翅膀替掉」的
        model 没有衣服槽，时装自然不显示，这是原版行为；
      - ★ **不能只按位域换图**：穿上时装后 `0055.js:265-460` 有 `switch(衣服style)`
        强制改手/脚/头/肩/脸/背的分支（`et = icon3.low bit30`，穿时装必置 1）。
        例：开拓者 F46 → 手 10 / 脚 11 / 头 46 / 肩 47；电玩英雄 F44 →
        脸 27 / 手 8 / 脚 9 / 肩 45；射手座 F39 → 头 `F+2=41` / 肩 40 / 女脚 5；
        F51 → 强制背 style 32。★ F31~40 的头盔是 **F+2**（39→41→图 10161），
        千万别写成 F+14（会变 10209，十二星座头全错）。
        少了这段 switch，开拓者/电玩英雄等大号 style 的时装就会渲染成乱配的装备。
        实现集中在 `_fash_styles()`。
      - ★ **披风 style 有三个位**：`low[0..3] + BACK_ADD(bit28)<<4 + BACK_ADD_2(high[0..1])<<5`。
        之前漏了 bit28、且把 add2 错移 4 位 → 翅膀配对全乱（开拓者 14→30、射手座 7→23、
        电玩英雄 13→29）。`fashion_back_style()` 现在按完整公式算。
      - 时装披风**只在玩家没有可见背部/翅膀时生效**；已穿背部优先（否则换时装会把玩家自己的
        天魔惊神之翼顶成时装自带那套，表现为"随机换翅膀"）。坐骑 36/42/43/48 仍藏披风。
      - ★ **只在「整颗头」时装隐藏头发**：模型图层顺序「脸 → 头发 → 头盔」，
        基础头发会盖在时装整颗脸/大头盔上（电玩英雄头盔 10121 是 1x1 空图，
        头其实是脸层 1213；勇气使徒 10213 是 42x35 大头盔）。条件：
        `fash_applied=true` **且**（时装定义了脸 **或** 头盔图宽 ≥38px）；
        小头盔/头饰必须保留头发，否则大片光头。实测 98 件中 12 件隐藏、86 件保留。
        整身坐骑 model 没有衣服槽 → 不触发。
      - ★ **时装部件不要套 `single_use` 的 34px 缩放**：那套兜底是给护肩双片图用的。
        时装头盔（如勇气使徒 10213，42x35 单帧）套上会被压成 34px 宽、位置取平均点，
        渲染直接坏掉。只有 at=4 肩部需要 `single_use`。
      - 数据事实：三件「开拓者时装」（15301 / 28005 魔导学 / 28006 物理学）的
        fashIcon 原始字节完全相同（只有属性/阶数不同），所以外观一样是数据决定的，
        不是渲染 bug；`15163/15174/15183` 射手座同理共用一套外观。
      - ★ **源码里的 `LEN_*` 是掩码不是位数**（0012.js `LEN_HAIR_STYLE = BIT_4 = 15`）。
        移植时要么 `& LEN_*`（掩码语义），要么像我们一样换成位数再用
        `(1<<len)-1`；混用会把 `3044618` 解出 `style=29962` 这种鬼值。
      - 模型 `15000~15186` 是原版预拼好的整套造型，但**原版时装走的是零件覆盖**，
        别直接把 model 切成 15xxx（那样会顶掉坐骑、也接不上装备槽）。
- **穿戴状态**：`ScreenState.equipped`（{slot:itemId}），单独存 `user://equipment.json`，
  **不碰 `character_screen.json`**（角色屏 44 项自检依赖其 version=1 结构）。`equip/unequip/clear_equipment` 广播 `state_changed("equip")`。
- **调试 / 截图**：
  - `WORLDOL_EQUIP_DEBUG=1` 正常窗口跑 EquipScreen，控制台打印每件装备的
    `部位 item=id icon=n gender=n → 槽位:旧图→新图`，用来定位某件装备的换算是否正确。
  - `WORLDOL_CAPTURE=1 WORLDOL_EQUIP=weapon:20300,clothes:10032,head:100664` → `_out/equip_screen.png`。
  - `--script res://tools/equip_compare.gd` → `_out/equip_compare.png`（左男款错图 / 右女款修复对比）。
  - `--script res://tools/equip_looks.gd` → `_out/equip_looks.png`（4×2 对照：裸/披风/黑翼/尾巴/
    白狼男/白狼女/狮鹫/凤凰，用来目视确认背/坐骑落点，headless 可跑）。
- 验收 `verify_equipment.gd` 全过：属性解析 / 鉴定忽略 / 叠加 / 武器换 model + 换武器图 /
  **性别半区换算（6075→6079、7089→7093、4145→4149）** / **头盔槽 10021（非 11001）** /
  **护肩帧表借用色号（4084/4088/4136）** / **武器姿势偏移表（不是直接 type）** /
  **背部 cloak 1101 + coatPt(-2,-35) + 画在角色后面** /
  **坐骑 705/905/2413/2463 + 战斗造型不骑马** / single_use 兜底 / 男女款渲染差异 / UI 穿脱链路 /
  **武器特效默认关闭（15001 像素对比）** / **14169 原版帧表已补齐（7 帧、与 14165 同表、子帧被裁切）** /
  **恶魔之翼/天使之翼无武器款 743/943/742/942** / **151 件坐骑 × 男女 × 空手/刀 不回退** /
  **坐骑色号（飞龙/蓝幼龙同 model 不同色）** /
  **腰/鞋/手/链/戒/护符 槽位有可选项（icon=0 也列）** /
  **时装 98 件不改 model、全身部件覆盖、披风 1110、时装+坐骑不顶掉坐骑** /
  **已穿翅膀优先（时装不覆盖背部）** / **勇气使徒头盔 10213 不缩到 34px** /
  **switch(F) 强制配件（开拓者手/脚/肩/头、电玩英雄换脸、射手座披风 1123）** /
  **F31~40 头盔 F+2 → 10161** / **仅整颗头时装隐藏头发（98 件中 12 件，其余保留）**。
  装备验收会临时改 `user://equipment.json`（ScreenState 内部会写盘），开跑前备份、结束还原。
- **自己改贴图**：图内容错→换同名 `sprite_fragment/<图号>.png` 立即生效；引用错→改
  `items/<id>.json` 的 `icon`（改前备份）；位置错→先开 `WORLDOL_EQUIP_DEBUG` 看换算，
  多数是性别半区/图号编码问题而非单张图坏。普通防具没有整套 model，别找映射表
  （300 段仅 22 个 model 全是武器偏移；7089/10101/4145 不在任何 model files 里）。
  护肩这类 2 帧图集：若换了新色号 PNG，注意同组只有组首有 `.json` 帧表，
  `SpriteComposer.fragment_frames()` 会自动借同组同尺寸色号的表，别手动复制错布局的 json。
  只有 type 12 时装走 15xxx/20xxx 整套 model，是独立分支。

## 角色外观系统（2026-11-18，阶段 3.7）

**能力**：发型 / 脸型 / 手部 / 脚部自由搭配，手和脚各有 4 档肤色；改动实时预览并自动存盘。
入口：角色屏「外观 →」或快捷键 `L`；场景 `res://scenes/AppearanceScreen.tscn`。

- **★ 图号公式（原版位域，别自己推）**
  - 常量 `0012.js:169-250`：`START_HAIR=0 / FACE=1000 / HAND=2000 / FEET=3000`；
    位偏移+长度：`HAIR_STYLE@7(4bit) / HAIR_COLOR@11(2bit) / FACE_STYLE@13(4bit) /
    HAND_STYLE@17 / HAND_COLOR@19 / FEET_STYLE@21 / FEET_COLOR@23`。
  - 换部件公式 `0055.js:405-530 doChangeSpriteIcon`：
    `id = START + (style<<3) - 7 + (gender<<2) + color`（**脸没有 color 项**）。
  - 每个 style 占 8 个连续图号：**前 4 男、后 4 女**；`color` 0-3 是组内偏移。
  - 自校验：model 300（女）`files=[1005,5,2005,3005,…]` = style1/color0/gender1；
    model 100（男）`[1001,1,2001,3001,…]` = style1/color0/gender0。两套都能被公式反推。
- **实测可用档位**（全量扫 `sprite_fragment`，不是猜的）
  - 发型 **14 档**（1-11、13-15；**12 缺图**，原版素材就没有）× 4 色号
  - 脸型 **15 档**，无颜色位 —— 肤色与五官跟着档位走，所以 14/15 是面具/兽脸类，
    13 是红面具；这是原版素材本身，不是错位
  - 手部 **3 档** × 4 色号、脚部 **3 档** × 4 色号。同 style 换色号是**纯换图**
    （尺寸一致），位置零风险
- **替换机制**：复用 `SpriteComposer.render_frame_image_equipped` 的 `part_replace`。
  `Appearance.part_replace(model_files, look, gender)` 只产 at=0/1/2/3 的键，与装备的
  衣/裤/肩/头/武器（at=4/5/6/7/8/10）**不重叠**；`CharacterPlayer.refresh()` 先取装备外观、
  再把外观键合并进去。**键必须是 int**（JSON 的 files 是 float，混用会匹配不上）。
- **状态**：`ScreenState.appearance`（7 字段）+ `gender()`（女=1/男=0），
  单独存 `user://appearance.json`（version=1），不碰 `character_screen.json`。
  `set_look(field, value)` 校验字段名、忽略未知键、值没变就不广播也不写盘。
- **界面要点**
  - **必须用缩略图选档**，不能只显示编号：14 档发型光看数字无法判断。
    `SpriteComposer.part_thumbnail(frag_id, sub, box)` 取子帧、等比放大、居中贴透明画布。
  - 缩略图子帧号：发型 0 / 脸 0 / 手 3 / 脚 0（`Appearance.PREVIEW_SUB`，沿用 model frame0
    首次引用该部件时的 sub）。头发是单帧整图，脸 sub[0..2]，手 28 帧、脚 14 帧。
  - 缩略图缓存 key = `部位|档位|色号|性别`；切性别必须 `clear()` 整套重算。
  - 发型/脸型放 `GridContainer(columns=7)`，否则 14 个一排会横向溢出屏幕。
  - 预览里的 Figure 必须用中心锚点（anchors 0.5 + offset ±90/±100），
    因为 CharacterPlayer 用 `pivot_offset=(90,100)` 做整数倍缩放。
- **截图**：`WORLDOL_CAPTURE=1 WORLDOL_LOOK="hair_style:5,hair_color:2,face_style:9,hair_rgb:#ff8800"`
  `WORLDOL_LOOK` 在 `ScreenState.load_appearance()` 末尾解析（只改内存、**不写盘**），
  所以**任何场景**都能带着指定外观截图，不会污染玩家存档；产物 `_out/appearance_screen.png`。
- **验收**：`verify_appearance.gd` **56 项**（图号公式 8 项 / 档位与 PNG 存在性 /
  替换只落 at0-3 / 换发型·脸·肤色各有像素差异 / 男款 model 同样能换 / 越界回退 /
  与装备替换键不重叠 / 存档往返 / 随机组合全部有图 / 场景可加载 / 自由调色 11 项）。

### 自由调色（任意 RGB，2026-11-19 追加）

用户明确要「任意 RGB」，原先「预渲染位图做不了」的结论作废。实现 `scripts/Recolor.gd`。

- **★ 算法 = 相对明度重映射，不是 modulate 也不是色相旋转**：
  `t = (V − 本层5%分位)/(95%分位 − 5%分位)` →
  `新 = HSV(目标H, 目标S×lerp(s_hi,0.70,t), 目标V×lerp(0.50,v_top,t))`。
  描边仍是最暗、高光仍是最亮，只换色族。
- **★ 必须用分位数、`s_hi/v_top` 必须夹紧**（两个都踩过）：
  ① 用中位数做除法则黑发（V 0.02~0.35）染白发时中间调过曝、暗部纯黑 → 一块块黑斑；
  ② 目标色 v=1.0 时 `×1.4` 削平高光 → 明暗排序塌掉（验收里 `_order_preserved` 抓的就是这个）。
  `s_hi = min(1.05, 1/目标S)`、`v_top = min(1.40, 1/目标V)`。
- **两种范围**：`full` 整层（头发）；`skin` 只染肤色（脸/手/脚），
  眼睛嘴唇指甲描边不动。肤色遮罩 = 色相距离众数 `smoothstep(0.040,0.075)` ×
  明度 `smoothstep(0.16,0.30)` × 饱和度 `1-smoothstep(0.58,0.82)`。
- **链路**：`Appearance.resolve_tints()` → `{部件图号:int → {color, mode}}` →
  `SpriteComposer.render_frame_*_equipped(..., tints)` 第 7 参；`Appearance.apply()` 同时给
  `{replace, tints}`，`CharacterPlayer` 与 `WorldPlayer` 共用（三处颜色必然一致，别再各写一遍）。
- **数据**：`hair_rgb/face_rgb/hand_rgb/feet_rgb`，`0xRRGGBB`，`-1` = 关；
  与档位字段同存 `user://appearance.json`（version 仍是 1，别升版本否则老档全丢）。
- **界面**：每部位一行「自由调色」= `ColorPickerButton` + `自定义 #hex` + `回到档位色`；
  顶栏 6 套配色预设 + 随机发色 + 取消全部调色。
  **色号那 4 个缩略图保持原版配色**（否则看不出预设会变成什么），启用自定义时全部取消选中；
  档位缩略图跟着调色走。拖拾色器时 `set_look(..., save=false)` 只广播不写盘，弹窗关闭才落盘。
- **性能**：180×200 单帧 5.5ms → 带 4 处调色 6.4ms，8fps 播放无压力（别为它上 shader）。

## NPC 展厅 + NPC 编辑器（2026-11-18 落地）

**背景**：NPC 先不散落到各自的原地图上（用户要求，NPC 交互逻辑等他自己设计）。
1939 条 NPC 按造型去重成 **282 个造型**，集中排进「展厅」地图，用专用编辑器摆位/改名/换图标/改台词。

- **★★ icon1 是「整套造型 model 编号」，不是部件图编号（2026-11-18 更正，代价最大的一条）**：
  1939 个 NPC 的 `icon1` **全部**能在 `assets/sprite_model/` 找到对应 model；
  其中 489 个编号在 `sprite_fragment/` 里**也**存在同名图（护肩、翅膀、武器光效碎片）。
  早先按「fragment 优先」取图，这批 NPC 全被画成翅膀/光效/图集碎片 —— 用户一眼看出「怎么都是特效图」。
  现在 `WorldMap._npc_texture()` **model 优先、fragment 只兜底**，
  `npc_uses_model()` / `npc_is_fragment()` 两个判定同步改过，`_draw_npc_sprite()` 的分支也跟着对调
  （model 走 0.45 缩放 + `offset(-90,-170)`，fragment 才 1:1 贴）。
  反编译依据：`0055.js getSpriteIdByIcon` 里 NPC 造型也是 `getDefaultSprNameID(sex)` 取基础 model，
  再 `doChangeSpriteIcon` 按 icon 位域换部件；`icon1` 的位域定义在 `0012.js:169-250`。
- **★★ 去重规则 = 只看 icon1（2026-11-18 用户定稿，别再改回按名字去重）**：
  展厅是**美术素材库**，同一套造型只留一个模板。原版会把同一个怪摆到多张图甚至同一张图的
  多个格子（922 图有 8 个「大剑食人魔」，npcId 2..9 不同但造型都是 15045），
  也会让**不同名字共用一套造型**（414 = 月狼宗剑手/刀手/族人，318 = 暴力女/中级护送/轩姐，
  15045 一条就合并了妖帅/天王屠夫/绿魔/食人魔/大剑食人魔…共 40 条）。
  用户 2026-11-18 明确：**同造型即使名字不同也可以删**，所以：
  - 分组键 = `icon1`，1939 条 → **282 个造型**（合并掉 1657 条）；
  - 同组保留 **信息最全** 的一条（有名字 +3 / 有台词 +3 / 有任务组 +2 / 有商店 +2 / npcType≠0 +1），
    不是盲目留第一条 —— 否则可能留下空壳；
  - 保留条带 `mergedCount` / `mergedFromMaps` / `mergedNames`（被合并掉的其它名字，最多 20 个），
    编辑器右栏会显示「合并 N 条 · 原名：…」，方便日后查「这个造型原本还叫过什么」；
  - `icon1` 为空或 0 的条目直接丢（没有美术，画不出来）；原版 31 条 `name` 是空串，
    生成时补占位名 `未命名-<icon1>` + `placeholderName=true`，列表里才认得出。
  - ⚠ 曾短暂用过「同名 + 同 npcId」和「同名 + 同 icon1」两版，都被用户否掉（列表里还是重复）。
- **数据落点（★ 不要改 `data/compiled/npcs`）**：
  - `data/overrides/npcs/index.json`：页清单 + 排布参数（cols/rows/cell/offset/w/h）+ 去重统计。
  - `data/overrides/npcs/<页id>.json`：该页 NPC 数组，结构与编译分片完全一致，
    额外带 `sourceMapId` / `sourceIndex` / `showcasePage` / `showcaseSlot`（溯源用）。
  - `data/overrides/maps.json`：追加 1 个展厅页的地图元数据（`has_config=false` →
    WorldMap 走「合成网格」兜底，正好当展厅地面）。
  - `GameData.get_entry("npcs", id)` 命中页 id 时整页读 override；`is_npc_page(id)`
    判断是否展厅页；`npc_pages()` 读清单。删掉 `data/overrides/npcs/` 即回滚。
- **生成**：`godot --headless --path godot-next --script res://tools/build_npc_showcase.gd`
  - 页 id 段 **9901 起**（真实地图最大 964，留足空间）；每页 20 列 × 15 行 = 300 个，
    282 个造型 → **1 页**（9901）。地图 2400×1800，tile 24。（造型再涨到 >300 会自动分页，
    页数不是写死的。）
  - **格子 5×5 格 = 120×120px**：icon1 是 model，0.45 缩放后 81×90，120 格正好留出名字与间距。
    （中间折腾过 96×120、216×144 两个版本，都是误以为 icon1 是部件图导致的，别照抄旧值。）
  - 落点 `x = 列*5+2`、`y = 行*5+3` → 像素 (120c+60, 120r+84)，x 正好是格心，脚底 97.5 不出格。
  - 已有 index 时脚本会跳过（保护手工改动）；要重排加 `WORLDOL_NPC_REBUILD=1`（会覆盖）。
    重排时会把「页数变少后多出来的旧页文件 + maps override 键」一并清掉。
- **渲染口径**：`WorldMap.show_npcs` 默认 **false**（普通地图一个 NPC 都不画，数据仍在）；
  `WorldScreen._load_map()` 里按 `is_npc_page(id)` 自动开关，复选框同步反映当前状态。
- **编辑器**：`godot --path godot-next res://tools/npc_editor/NPCEditor.tscn`
  - 左栏：页选择 / 搜索（可选「全库搜索」跨页）/ 本页列表 / 保存·撤销·校验 / 新增·复制·删除。
  - **搜索会命中 `mergedNames`**：按 icon1 合并后「大剑食人魔」这类旧名不在主字段里，
    搜它仍能定位到 icon1=15045 那条造型（`_match_merged()`）；列表项后缀 `+N`
    表示这条造型合并了 N 条同造型 NPC（`_merge_suffix()`）。
  - 右栏「来源」显示 `合并 N 条（造型同源，来自地图 …）` + `原名：…`（最多 8 个 + 总数），
    便于判断这个造型原本扮演过谁；地图号已转 int，不会显示成 `4.0`。
  - **★ 战斗数据（2026-11-18 加，`scripts/NpcInfo.gd`）**：预览图下面直接显示
    `类型：怪物(1)` + `战斗：N 只 · 最高 Lv X · 总血 Y · 攻 a-b · 防 d` + `单位：名字(LvN), …`。
    链路是 `NPC.battleID → groups/<id>.json（monsters 是 10 个槽位，同一 id 占 2 格就算 2 只）
    → monsters/<mid>.json（level/hpMax/atkMin/atkMax/def_str）`。
    展厅 282 条里 **92 条有 battleID**（75 个不同编队），其余是纯对话 NPC，显示「无战斗编队」。
    `npcType` 用原版语义（`0074.js:930-943`）：0 任务 / 1 怪物 / 2 商店 / 3 传送点 / 4 告示牌 /
    5 战力 / 6 礼品 / 7 教师 / 8 区域传送 / 9 交易 / 10 帮会 / 11 建筑 / 12 宠物恢复。
  - **类型筛选（左栏搜索框下方）**：全部 / 任务(0) / 怪物(1) / 商店(2) / 传送点(3) / 战力(5) /
    交易(9) / 有战斗编队 / 无战斗编队；与搜索是「与」关系（`_pass_filter()`）。
  - 中栏：点选、拖动移动（吸附到格）、中键平移、滚轮缩放、`F` 整图适配。
  - 右栏：名字、icon1（带预览与「整套造型 model / 部件图兜底 / 不存在」判定）、npcType、
    missionGroupID、businessIcon、direction、x、y、talkDetail（多行）、welcome、来源信息。
  - 保存只写 override 并把原文件备份到 `_out/npc_backups/<页id>.json.bak`；
    页内新增/删除会同步 index 里的 count。**`data/compiled` 一个字节都不动**。
  - 每页一份内存副本，切页不丢未保存改动；撤销 40 步（Ctrl+Z）。
- **踩过的坑**：
  1. **面板必须显式设 `ui.layer = 10` + 不透明 StyleBox**：NPC 是世界坐标里 Node2D 画的，
     第一版右栏没有底色，300 个 NPC 从面板缝里透出来，看着像"面板坏了"。
  2. **编辑器里的定位必须和 `WorldMap._draw_npc_sprite` 同一套公式**：
     model 走 `centered=false` + `offset(-90,-170)` + `scale .45` → 实际矩形
     `pos + (-40.5,-76.5)`、尺寸 81×90；部件图才是 `pos + (-w/2, -h+8)` 1:1。
     两处不一致就会"编辑器对了进游戏错"。
  3. **默认视角别 fit 整图**：`focus_default()` 只保证看清约 5 列 × 3 行，整图留给 `F`。
  4. 名字标签只在 `zoom >= 0.42` 时画，几百个标签在缩略视图里只会糊成一片；
     超过 9 个字截断加省略号（否则相邻格的标签会横向挤在一起）。
  5. **改完编辑器别只看界面**：验收里「搜旧名」「类型筛选」「编队数值」都是拿真实条目
     对真实怪物表比出来的。曾经因为断言里的 282 写死，数据被一次异常保存写成 281 才发现——
     现在断言仍是 282，但每次跑完会顺带核对 `9901.json` 条数与 `index.pages[0].count` 一致。
- **调试开关**：`WORLDOL_NPC_PAGE=9901` 直接进某页；`WORLDOL_NPC_SELECT=<名字片段>`
  启动后自动选中第一个命中的条目（只选中，不改数据），截图或排查战斗数值时用。
- **验收**：`godot --headless --path godot-next --script res://tools/verify_npc_showcase.gd`
  （**50 项**：分页 1 页/总数 282/同 icon1 无重复/每个造型都有 Model/不重不漏/坐标界内/
  格点对齐/普通地图 0 个实体/展厅页 282/搜旧名命中/编队聚合 2 只·Lv3·160 血·攻 1-5/
  无 battleID 返回 0/类型筛选只剩怪物/编辑器载入·命中·改名·新增·撤销·存盘往返）。
  同时 `verify_world_map.gd` 已按「295 张图 + 原版 1939 / 展厅 282 分开统计」更新口径。

## 地图编辑器第二版要点（2026-11-17 补完）

- 原作者只做了第一版（tile/阻挡画笔 + 撤销 + 保存），第二版缺口已补：
  **物件编辑**（放置/拖动/旋转/删除）、**图层增删**、**新建/复制地图**、
  **改尺寸**（keep/center/edge）、**批量换资源**、**改名**（写 override）、**保存前校验**。
- ★ 结构操作的撤销用「整 cfg 快照 + 递归原地恢复」（`_restore_value_inplace`）：
  必须原地改，不能整体替换 `cfg["layers"]`，否则 WorldMap 持有的数组引用会失效、
  撤销后画的还是旧数据。物件撤销同理（保持每个物件元素的引用）。
- ★ 新建/复制地图、改名都写 `data/overrides/`，**不碰 index.json 快照**；
  `GameData.reload_overrides()` 会清 `_cache`——不清的话新建图前那次 `get_entry(id)`
  缓存的空数组会让新图永远读不到元数据。
- 编辑器左侧面板内容多，套了 `ScrollContainer`；调色板固定 170px，
  **不要**改回 `SIZE_EXPAND_FILL`，否则会把第二版控件挤出可视区。
- 2026-11-19 起：改完 cfg 必须调 `world_map.refresh()`（重建 TileMapLayer 节点树），
  只 `queue_redraw()` 只重画底色/标尺，图块不会变。编辑器原有 8 处调用已全部替换。
- 新增「只看选中层（隐藏其它层）」开关 → `WorldMap.solo_layer(li)`，直接切图层节点 `visible`。

排查套路：先用 `FIT + GRID` 截图读格子坐标 → 用 node 读 `assets/map/<id>.json` 查该格各层
tile 与附近物件 → 用 `SKIP` / `NOOBJ` / `ONLYLAYER` 逐项排除 → 确认是「资源缺失」「变换错」
还是「原画本来如此」。临时验证底色时可以临时把 `_draw()` 里的底色改成品红，但**改完要还原**。

## 原画不等于 bug

- 31/32 火堆上方的深色剪影是 `213_3`（原版深红悬浮地台边缘，90% 近黑像素），原数据就摆在那儿。
- 257 的浮空小桌/烛台是原版冒险地图的浮空平台设计。
- 水域图块 `203_9/10/11` 本身就是青色棋盘动画。

按「素材可掌控」的原则这些都保留原画，只在这里记取舍；谁觉得突兀，自己去 Godot 里换图集帧，
不要改渲染逻辑去"美化"。

## 已知限制 / 待办

- 任务系统、战斗没移植（阶段 3 只做地图 + NPC）。
- 100 号中下部那块地面（106_1）只能压暗，因为本该盖住它的 182/183 在资源表里不存在。
- 964 的锁链是原数据里 50 个 `541`（39×42）密集铺出来的，叠成网状，素材本身偏亮；
  没有做改动——不确定原版期望效果，乱改风险大。
- `SpriteComposer` 直读 `res://` 原始 PNG，导出 exe 时要在导出预设里包含 `*.png` / `*.json`。
- 部件帧表曾漏导出 1025 个、model 表漏 417 个，已用 `tools/restore_sprite_tables.py` 从原版补齐；
  另有 23 个碎片原版就没有 PNG（补了表也用不上），少量部件（头发/身体）本来就是整图无表。
- 4 张地图（814/821/908/914）没有视觉 JSON，只有 NPC/名字，用合成网格兜底。
- 地图数据仍然以 `assets/map/<id>.json` 为唯一真源：TileMapLayer 是**运行时按 JSON 建**的，
  不是每张图一个 .tscn。想直接在 Godot 的 TileMap 面板里刷图，得先把某张图导出成场景
  （还没做，属于「把 JSON 真源换成场景真源」的下一步）。
- 物件层不是 TileMapLayer（自由坐标 + 旋转，网格放不下），但已经是独立节点。
- 没有 y-sort：角色/物件的前后关系仍按原版图层顺序，不按 y 坐标排序。

## 环境备注

- `--script` 模式下必须在 `_initialize()` 里实例化场景，`_init()` 里节点的 `_ready` 不会触发。
- headless 是 dummy 渲染驱动，**截不了 UI**，截图必须开正常窗口。
- 不要写 `Vector2i` 数组字面量直接 `for d in [...]` 再取 `d.x`（旧 4.3 推断失败报解析错；
  4.7 已放宽，但显式写法仍最稳）：`var dirs: Array = [...]` + `var dv: Vector2i = d`。

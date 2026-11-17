# godot-next — 世界OL Godot 4 重做工程

这个目录是「世界OL」单机版的 **Godot 4 重做**实现，与同仓库 `世界online_原版单机/`（Node 运行时 + 网页客户端）
是**两条独立的路**：

- `世界online_原版单机/` 是原版逆向出来的可跑运行时（JS），功能完整、仍在维护。
- `godot-next/` 是把客户端「用 Godot 从零重画」的实验线，核心诉求只有一条：
  **素材可掌控** —— 在 Godot 编辑器里能直接看见、替换每一张 PNG，不用和 JS 模块纠缠。

明确不追求的：测试护栏覆盖率、和 JS 客户端逐像素一致、性能优化。
不要用「测试护栏不够」或「不如继续改 JS」来劝回原方案，那条路 2026-11-15 已经停用。

## 目录结构

```
godot-next/
  project.godot              工程文件（渲染器：GL Compatibility）
  assets/
    sprite_model/<modelId>.json|png    角色/怪物模型（frames + anis 动作表）
    sprite_fragment/                   角色部件库（不要拿来当地图贴图）
    map/<mapId>.json                   地图视觉数据（mW/mH/tW、tiles、layers）
    map_merged/<mapId>.json|png        该地图的图集（frames 名 → 矩形）
    map_slice/<name>.png               全局切片图集（tile 层主要贴图来源）
    map_bg/<mapId>.jpg                 ⚠ 不是底图，见下
  data/compiled/
    mapFrames.json                     全局跨图集帧索引（name → atlas + frame）
    npcs/<mapId>.json                  该地图 NPC
  scripts/
    ScreenState.gd       Autoload，全局状态 + 信号
    CharacterScreen.gd   角色屏
    CharacterPlayer.gd   角色屏立绘（SpriteComposer）
    StatsPanel.gd        属性面板
    WorldScreen.gd       世界地图屏（相机、输入、切图）
    WorldMap.gd          地图渲染核心（tile 层 / 物件层 / 变换 / 补洞）
    WorldPlayer.gd       地图上的角色（行走动画）
    SpriteComposer.gd    运行时拼角色部件成整图
    Naming.gd            中文标签表
  scenes/                由 tools/build_*.gd 用 PackedScene.pack() 生成，可在编辑器里改
  docs/
    待改进方案.md                地图问题清单（玩法/渲染/内容）+ P0–P2 改进路线
    地图编辑与重命名指南.md      地图增删改、tile/阻挡/物件、三层名字与改名方案
  tools/
    build_scene.gd         生成 CharacterScreen.tscn
    build_world_scene.gd   生成 WorldScreen.tscn
    verify_character_screen.gd   44 项断言
    verify_world_map.gd          地图全量断言
    verify_map_editor.gd         地图编辑器断言（只在内存里改，不写真实 assets/map）
    map_editor/
      MapEditor.tscn       地图编辑器入口（正常窗口跑，不做 @tool 插件）
      MapEditor.gd         载入 / tile·阻挡·物件三种画笔 / 图层增删 / 新建复制图 / 改尺寸 /
                            改名 / 批量换资源 / 校验 / 撤销 / 原子保存（第二版全实现）
      MapOverlay.gd        阻挡格 / 格线 / 悬停格 / 出生点 / 选中物件黄框
      README.md            操作、快捷键、保存行为与第二版边界
  data/overrides/
      map_names.json       地图改名 override（name_of 优先读它）
      maps.json            新建地图的元数据 override（ids/get_entry/name_of 三处都读）
```

## 运行与验证

本机 Godot 在 `E:\Godot_v4.7.2-stable_win64\`（`Godot_v4.7.2-stable_win64.exe` + `_console.exe`，有 headless，非 mono 版）。
2026-11-17 用 4.7.2 跑过全部自检与三个验收脚本，均通过（`verify-data-compile` 的域数量断言已随阶段 3 更新为 12）。
⚠ 非 mono 版：工程里 `[dotnet]` 段已删、`project.godot` 的 `config/features` 写 `"4.7"`；
不要用旧 4.3 mono 版打开（会重写 project.godot 并加回 dotnet 段，features 打回 4.3）。

```bash
# 自检（headless）
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

两套自检**不要并行跑**，会抢同一个存档文件导致偶发失败。

导出的 JSON/PNG 改动后如果 `load()` 报 "No loader found"，跑一次
`--headless --path godot-next --import` 生成 `.import`，不要把图当坏图。

## 地图渲染的关键事实（都是踩过的坑，改之前先看这里）

### 1. 图层顺序：必须单遍**倒序**画
原版 `scene.init` 从 `layers[length-1] downto 0` 逐个 `addChild`，所以 `layers[0]` 在最上层。
我们的绘制也必须倒序遍历、边遍历边画，**不能**改成「先全部 tile 层再全部物件层」两遍，
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

### 8. 角色行走
`WorldPlayer` 固定用正常造型（女 300 / 男 100），行走只播 `anis[2]` 的 `[4,5,6,7,8,9]`，
静止显示 `anis[0]` 首帧 0。**不要**取 `frame_numbers()` 全帧、也不要跟随角色屏的战斗姿势
（会混入战斗动作帧）。地图角色与角色屏姿势完全解耦。

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
- 4 张地图（814/821/908/914）没有视觉 JSON，只有 NPC/名字，用合成网格兜底。

## 环境备注

- `--script` 模式下必须在 `_initialize()` 里实例化场景，`_init()` 里节点的 `_ready` 不会触发。
- headless 是 dummy 渲染驱动，**截不了 UI**，截图必须开正常窗口。
- 不要写 `Vector2i` 数组字面量直接 `for d in [...]` 再取 `d.x`（旧 4.3 推断失败报解析错；
  4.7 已放宽，但显式写法仍最稳）：`var dirs: Array = [...]` + `var dv: Vector2i = d`。

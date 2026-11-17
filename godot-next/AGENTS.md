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
  tools/
    build_scene.gd         生成 CharacterScreen.tscn
    build_world_scene.gd   生成 WorldScreen.tscn
    verify_character_screen.gd   44 项断言
    verify_world_map.gd          地图全量断言
```

## 运行与验证

本机 Godot 在 `E:\Godot_v4.3-stable_mono_win64\Godot_v4.3-stable_mono_win64\`，
用 `Godot_v4.3-stable_mono_win64_console.exe`（有 headless）。

```bash
# 自检（headless）
Godot_v4.3-stable_mono_win64_console.exe --headless --path godot-next --script res://tools/verify_world_map.gd
Godot_v4.3-stable_mono_win64_console.exe --headless --path godot-next --script res://tools/verify_character_screen.gd

# 实拍截图（必须用正常窗口，headless 是 dummy 渲染驱动，截不了 UI）
WORLDOL_CAPTURE=1 WORLDOL_MAP=16 Godot_v4.3-stable_mono_win64_console.exe \
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

### 6. 角色行走
`WorldPlayer` 固定用正常造型（女 300 / 男 100），行走只播 `anis[2]` 的 `[4,5,6,7,8,9]`，
静止显示 `anis[0]` 首帧 0。**不要**取 `frame_numbers()` 全帧、也不要跟随角色屏的战斗姿势
（会混入战斗动作帧）。地图角色与角色屏姿势完全解耦。

### 7. NPC
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
| `WORLDOL_NOOBJ=1` | 不画物件层，只看地面 |
| `WORLDOL_ONLYLAYER=<n>` | 只画第 n 层 |
| `WORLDOL_NOTRANS=1` | 忽略旋转变换 |
| `WORLDOL_DEBUG_PREFILL=1` | 打印补洞格坐标与数量 |
| `WORLDOL_DEBUG_SKIP=1` | 打印资源缺失被跳过的格 |

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
- 265 / 275 / 276 / 964 有残留色差格（原版阴影层铺在空洞处）。
- `SpriteComposer` 直读 `res://` 原始 PNG，导出 exe 时要在导出预设里包含 `*.png` / `*.json`。
- 4 张地图（814/821/908/914）没有视觉 JSON，只有 NPC/名字，用合成网格兜底。

## 环境备注

- `--script` 模式下必须在 `_initialize()` 里实例化场景，`_init()` 里节点的 `_ready` 不会触发。
- headless 是 dummy 渲染驱动，**截不了 UI**，截图必须开正常窗口。
- 429 行以上不要写 `Vector2i` 数组字面量直接 `for d in [...]` 再取 `d.x`，
  Godot 4.3 会推断失败报解析错，要显式 `var dirs: Array = [...]` + `var dv: Vector2i = d`。

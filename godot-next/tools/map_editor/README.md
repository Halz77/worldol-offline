# 地图编辑器（第二版）

直接读写 `assets/map/<id>.json` 的可视化编辑器。保存后**不需要导入 / 不需要重编译**，
回到游戏按 F5 就能看到修改（运行时 `WorldMap.load_map()` 读的是同一份文件）。

左侧面板内容较多，**可上下滚动**。

## 启动

```bat
"E:\Godot_v4.7.2-stable_win64\Godot_v4.7.2-stable_win64_console.exe" --path "C:\...\godot-next" res://tools/map_editor/MapEditor.tscn
```

也可以把 `res://tools/map_editor/MapEditor.tscn` 在 Godot 里设为「当前场景」后按 F6。
用环境变量指定初始地图（默认 4）：

```bat
set WORLDOL_MAP=912
```

## 界面（左侧栏，可滚动）

| 区域 | 作用 |
|---|---|
| 搜索框 / 地图下拉框 | 按名字或 id 过滤，294 张图，选中即载入（有未保存修改会先确认） |
| 信息行 | 尺寸、格数、`tile 条数 / 255`、图层数、地块层数 |
| 图层列表 | `layers[i]`；点选后决定 tile 画笔画在哪层，物件层/角色层标灰但可选 |
| 三种画笔 | `T` 地块 / `B` 阻挡 / `O` 物件 |
| 格线 / 阻挡 | 叠加层开关 |
| 调色板 | 地块模式下：`tileList` 展开的每一格（带真实子图预览），第一格是「空」 |
| **物件资源** | 第二版：搜索 2485 个资源名，点一下选为物件画笔 |
| **地图操作** | 第二版：+/-图层、新建图、复制图、改尺寸、改名、批量换资源、校验 |
| 撤销 / 保存 / 重载 | `Ctrl+Z` / `Ctrl+S` / 放弃修改重新载入 |

## 操作

| 输入 | 动作 |
|---|---|
| 左键拖动 | 地块/阻挡模式下用当前画笔连续画 |
| 右键拖动 | 擦除（tile 写 `255`；阻挡清 bit0；物件模式下删除命中的物件） |
| 中键拖动 | 平移视图 |
| 滚轮 | 以鼠标位置为锚点缩放 |
| `F` | 整图适配 |
| `T` / `B` / `O` | 切换地块 / 阻挡 / 物件画笔 |
| `Ctrl+Z` | 撤销（一次拖动 = 一步，最多 50 步） |
| `Ctrl+S` | 保存 |
| `Esc` | 清掉悬停框 / 物件选中框 |

叠加层：红块 = `blocks[i] & 1`，蓝框 = `worldMaps.<id>.spawn`，绿/橙框 = 悬停格，
黄框 = 选中的物件。

## 物件编辑（第二版）

1. 在「物件资源」搜索框输入资源名（如 `541`、`树`、`rock`），点列表里的一项
   → 自动切到物件模式。
2. 在地图上左键点空白处：放置一个物件（吸附 8px，坐标是像素左上角，
   宽高取帧的 `sourceW/sourceH`）。
3. 左键点已有物件：选中并拖动移动；`R` 循环变换 `0–7`；`Del` / `Backspace` 删除；
   右键点它也能删。
4. 物件写在**物件图层**（`type==3`，没有则取第一个带 `obj` 的层），
   数组格式 `[kind, src, x, y, w, h, transform]`。NPC/模型物件（kind 3/4）不参与选中。
5. 放置 / 移动 / 旋转 / 删除都进撤销栈（一步一撤）。

> ★ 变换 0–7 是原版语义（见 `AGENTS.md` §3），编辑器只循环数值，不自己推导。

## 地图操作（第二版）

| 按钮 | 行为 |
|---|---|
| `+图层` | 追加一个全空地块层到**末尾**（`layers[0]` 在最上层，追加即最底层） |
| `-图层` | 删除当前选中的图层（至少保留一层） |
| `新建图` / `复制图` | 以当前图为模板复制：改 id（默认取 `max+1`，建议手填 10001+），写 `assets/map/<id>.json`，并在 `data/overrides/maps.json` 登记元数据。**NPC 分片/图集不复制**，需另配传送才能走进去 |
| `改尺寸` | 输入新格数宽/高 + 策略：`keep` 留左上 / `center` 居中 / `edge` 扩边；同步重排每层 `data`、`blocks`，物件坐标按 center 策略平移 |
| `改名` | 写 `data/overrides/map_names.json`，**不改 index.json 快照**，全局生效、可回滚 |
| `批量换资源` | 把所有 tile 定义和物件里叫某名字的，全换成另一个名字（如 `106_1`→`304`） |
| `校验` | 跑 §4 硬约束 + 索引上限 + 物件不越界 + 传送目标存在，结果在状态栏 |

这些结构操作都可 `Ctrl+Z` 撤销（用整 cfg 快照，原地恢复，不破坏 WorldMap 的引用）。

## 保存行为

1. 序列化前把 JSON 解析出来的 float 整数**规范化回 int**（否则会把 `960` 写成 `960.0`）；
   键顺序保持解析时的顺序，输出与原文件同为紧凑单行。
2. 校验（不通过就不写文件）：
   - `mW/mH` 必须是 `tW/tH` 的整数倍；
   - 每个 type=2 图层的 `data` 长度必须等于 `cols*rows`；
   - `tileList` 不能超过 255 条（tile 索引只有 1 字节，255 = 空格）；
   - `blocks` 不能比格子数更长。
3. `blocks` 整个键缺失（如 450 号图）时保持缺失；只有你画阻挡才创建，并补齐到 `cols*rows`（补 0 = 可走）。
4. 写入顺序：写 `<id>.json.tmp` → 原文件备份到 `_out/map_backups/<id>.json.bak` → 覆盖目标。
5. **合成网格图不允许保存**（814 / 821 / 908 / 914，没有 `assets/map/<id>.json`）。

## 仍不做的

- 改单个物件的宽高 / 精确像素坐标（只能拖动吸附 8px；要精调改 JSON）。
- NPC / 传送 / 商店 / 任务的编辑（那是 `data/compiled/npcs` 的事，不是地图视觉层）。
- 地图增删的反向清理（删除地图不会自动清别处的 `jumpMapID`）。

## 验收

```bat
"E:\Godot_v4.7.2-stable_win64\Godot_v4.7.2-stable_win64_console.exe" --headless --path "...\godot-next" ^
  --script res://tools/verify_map_editor.gd
```

覆盖：场景可载入、关掉补洞、图层/调色板与数据一致、tile 画笔与撤销、阻挡画笔与撤销、
合成图拒绝保存、290 张图序列化往返、物件放置/选中/旋转/删除/撤销、图层增删、
改尺寸、批量替换、改名 override、保存前校验。全部只在内存里改，不写真实 `assets/map`。

截图实测（正常窗口）：

```bat
set WORLDOL_CAPTURE=1
set WORLDOL_MAP=4
set WORLDOL_AUTOSHOT=541
set WORLDOL_QUITAFTER=1
"E:\Godot_v4.7.2-stable_win64\Godot_v4.7.2-stable_win64_console.exe" --path "...\godot-next" res://tools/map_editor/MapEditor.tscn
# 产物：_out/map_editor_screen.png；AUTOSHOT=资源名可顺便放一个物件看渲染
```

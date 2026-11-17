# 地图编辑器（第一版）

直接读写 `assets/map/<id>.json` 的可视化编辑器。保存后**不需要导入 / 不需要重编译**，
回到游戏按 F5 就能看到修改（运行时 `WorldMap.load_map()` 读的是同一份文件）。

## 启动

```bat
"D:\Godot\Godot_v4.6.3-stable_win64_console.exe" --path "C:\...\godot-next" res://tools/map_editor/MapEditor.tscn
```

也可以把 `res://tools/map_editor/MapEditor.tscn` 在 Godot 里设为「当前场景」后按 F6。
用环境变量指定初始地图（默认 4）：

```bat
set WORLDOL_MAP=912
```

## 界面

左侧面板（360px）：

| 区域 | 作用 |
|---|---|
| 搜索框 | 按地图名或 id 过滤下面的下拉列表 |
| 地图下拉框 | 294 张图，选中即载入（有未保存修改会先确认） |
| 信息行 | 尺寸、格数、`tile 条数 / 255`、图层数、地块层数 |
| 图层列表 | `layers[i]`；灰色是物件/角色层（可查看，不能用 tile 画笔） |
| 地块 / 阻挡画笔 | 两个模式，快捷键 `T` / `B` |
| 格线 / 阻挡 | 叠加层开关 |
| 调色板 | 第一格是「空」，其余是 `tileList` 展开后的每一格（带真实子图预览） |
| 撤销 / 保存 / 重载 | `Ctrl+Z` / `Ctrl+S` / 放弃修改重新载入 |

## 操作

| 输入 | 动作 |
|---|---|
| 左键拖动 | 用当前画笔连续画 |
| 右键拖动 | 擦除（tile 写 `255`；阻挡清 bit0） |
| 中键拖动 | 平移视图 |
| 滚轮 | 以鼠标位置为锚点缩放 |
| `F` | 整图适配（地图落在左侧面板右边） |
| `T` / `B` | 切换地块 / 阻挡画笔 |
| `Ctrl+Z` | 撤销（一次拖动 = 一步，最多 50 步） |
| `Ctrl+S` | 保存 |
| `Esc` | 清掉悬停框 |

叠加层：红块 = `blocks[i] & 1`，蓝框 = `worldMaps.<id>.spawn` 出生格，绿/橙框 = 当前悬停格。

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

## 第一版不做的

- 物件层增删移 / 旋转（第二版）
- 新建地图、复制地图、改尺寸、登记 `worldMaps` / `index.json`（第二版）
- 改 `tiles` 定义（新增资源名）
- 地图重命名（走 `data/overrides/map_names.json`，见 `docs/地图编辑与重命名指南.md` §6）

## 验收

```bat
"D:\Godot\...\Godot_v4.6.3-stable_win64_console.exe" --headless --path "...\godot-next" ^
  --script res://tools/verify_map_editor.gd
```

覆盖：场景可载入、关掉补洞、图层/调色板与数据一致、tile 画笔与撤销、阻挡画笔与撤销、
合成图拒绝保存、290 张图序列化往返不丢信息且不出现小数。

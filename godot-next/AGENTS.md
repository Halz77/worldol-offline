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
    CharacterScreen.gd   角色屏（含"装备→"入口按钮，快捷键 E）
    CharacterPlayer.gd   角色屏/装备屏共用的立绘（SpriteComposer；装备时切 model + 换部件）
    StatsPanel.gd        属性面板
    Equipment.gd         装备规则层：部位/属性加成/外观（武器切 model、防具换部件）
    EquipScreen.gd       装备屏：造型预览 + 部位槽 + 候选装备 + 属性变化
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
    build_equip_scene.gd   生成 EquipScreen.tscn
    verify_character_screen.gd   44 项断言
    verify_world_map.gd          地图全量断言
    verify_map_editor.gd         地图编辑器断言（只在内存里改，不写真实 assets/map）
    verify_equipment.gd          装备系统断言（属性/外观/UI 穿脱链路）
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
`WorldPlayer` 用正常造型底盘（女 300 / 男 100），但**再走一遍装备外观**：
`Equipment.appearance(gd, 正常 model, equipped)` 决定最终 model（武器姿势 → +type；坐骑 → 整幅马 model），
再由 `SpriteComposer.render_frame_equipped()` 换部件图 / 叠披风，跟角色屏、装备屏同一条路径。
换装靠 `ScreenState.state_changed` 触发 `_rebuild_frames()`，不用重进场景。

行走只播 `anis[2]` 的 `[4,5,6,7,8,9]`，静止显示 `anis[0]` 首帧 0。**不要**取 `frame_numbers()` 全帧、
也不要跟随角色屏的战斗姿势（会混入战斗动作帧）。地图角色与角色屏**姿势**解耦，但**装备**同源。

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
- 部件帧表曾漏导出 1025 个、model 表漏 417 个，已用 `tools/restore_sprite_tables.py` 从原版补齐；
  另有 23 个碎片原版就没有 PNG（补了表也用不上），少量部件（头发/身体）本来就是整图无表。
- 4 张地图（814/821/908/914）没有视觉 JSON，只有 NPC/名字，用合成网格兜底。

## 环境备注

- `--script` 模式下必须在 `_initialize()` 里实例化场景，`_init()` 里节点的 `_ready` 不会触发。
- headless 是 dummy 渲染驱动，**截不了 UI**，截图必须开正常窗口。
- 不要写 `Vector2i` 数组字面量直接 `for d in [...]` 再取 `d.x`（旧 4.3 推断失败报解析错；
  4.7 已放宽，但显式写法仍最稳）：`var dirs: Array = [...]` + `var dv: Vector2i = d`。

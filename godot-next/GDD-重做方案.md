# 世界OL 单机重做 · Godot 4 方案

| 项 | 值 |
|---|---|
| 日期 | 2026-11-16 |
| 决策 | **改用 Godot 4 从零重做**，停止一切对旧 JS 引擎的改造 |
| 核心诉求 | 素材可掌控、引擎里直接看得见改得动；不再要 JS / WebView / Node 运行时 |
| 工程位置 | 工作区 `godot-next/`（独立于源码仓库） |
| 本机环境 | `D:\Godot\Godot_v4.6.3-stable_win64.exe`（4.6.3.stable.official，2026-11-17 全量自检 + 三个验收脚本通过） |
| 官方当前稳定版 | **4.7.2**（2026-08-18）；4.3 已 EOL，当前工程在 4.6.3 上验证通过 |
| 进度 | 阶段 0 ✅ 素材落地；阶段 1 ✅ 角色屏；阶段 2 ✅ 数据编译；**阶段 3 ✅ 世界地图 + 全部 NPC + 角色行走**；**阶段 3.5 ✅ 装备系统基础版**（2026-11-18，无战斗联动），见 §1.1–§1.4 |
| 旧 JS 仓库 | 阶段 2 那两批未提交改动已按指示**全部丢弃**；仓库干净，HEAD 停在 `13dc5e8` |

> **取舍已明确**：测试护栏不是目标，不为它保留 JS 工程；数值一致性按「可玩、可人工核对」推进，
> 不追求逐字段对拍。旧 `世界OL_源码/` 仓库**冻结为数据与规格来源，不再改一行**。

---

## 1. 已经落地（本轮，实机跑通）

`node godot-import.mjs` 一次性导入 → `godot-next/`：

| 产物 | 内容 |
|---|---|
| `assets/` | **10154 个素材 / 121.4 MB / 23 类**，按类别语义命名平铺，可直接浏览替换 |
| `assets/manifest.json` | 每个文件的分类、中文名、尺寸、别名；不带机器绝对路径 |
| `assets/sprite_model/*.json` | 3755 份组装表（`files` + `frames` + `anis`） |
| `assets/sprite_fragment/*.png / *.json` | 3588 张图集 + 946 份子帧表 |
| `data/manifest.json` | 52 个源 JSON / 144.3 MB 的体积、头部结构与**权威关系** |
| `data/baselines/character_stats.json` | 20 个基准角色数值快照（留着以后想核对随时可用，不是强制护栏） |
| `scripts/SpriteComposer.gd` | 原版帧表拼装器，纯 GDScript |
| `scripts/{GameData,Stats,Main}.gd` | 数据清单读取、数值占位、最小可跑主场景 |
| `tools/selfcheck.gd` | headless 自检（一次性「工程可用」检查，不需维护） |

**实机验证**（`Godot 4.3.stable.mono.official`，headless，退出码 0）：

```
[selfcheck] 素材 10154 个 / 分类 23 类
[selfcheck] 数据源 52 个 / 数值基线 20 角色
[selfcheck] Model300 帧数 10  非透明像素 1182
[selfcheck] Model323 帧数 10  非透明像素 1701
[selfcheck] Model465 帧数 27  非透明像素 2509
[selfcheck] 全部通过
```

主场景 `--headless --quit-after 5` 无 GDScript 报错。三张输出图在 `godot-next/_out/`：
`frame_300_0.png`（基础女角色）、`frame_323_0.png`（双手弓 + 青色光效）、
`frame_465_0.png`（双持大刀 + 蓝色光效）。**旋转部件 `flip=3/5` 的包围盒居中规则已正确移植**，
武器没有飘出人物。

---

## 1.1 阶段 1 · 角色屏（2026-11-16 落地并验收）

`project.godot` 的主场景已切到 `res://scenes/CharacterScreen.tscn`，
打开工程按 F5 就是这一屏；`scenes/Main.tscn` 保留作最小场景参考。

### 能做什么

- **造型播放器**：女/男 × 正常/战斗 → 四套基础造型（Model 300/400/100/200）；
  动作下拉按 `sprite_model/*.json` 的 `anis` 自动枚举（地图 2 个、战斗 9 个），
  中文名取自 `0055.js` 的 `ANIMATION_BATTLE_*` 常量；逐帧 ‹ ›、滑块、播放/暂停、
  0.5/1/2/4 倍速、1x–4x 最近邻整数倍放大、棋盘/纯白/纯黑背景、显示全部帧、
  重新载入帧表、重置选择。快捷键用物理键码：`← →` 逐帧、空格播放、`1/2` 性别、
  `3/4` 姿势、`R` 重载。
- **属性面板**：20 个基准角色快照，战力评分 38 项 / 战斗面板 59 项切换，
  59 个属性键全部有中文名，元信息显示等级、生命/魔法、装备与技能数、阵法模式。
  界面明确标注「数值来源：20 角色基线快照（原版 0056 get() 口径），非实时公式」。
- **改 PNG 立刻生效**：`SpriteComposer` 每帧用 `FileAccess.get_file_as_bytes` 直读原始 PNG，
  不经过 Godot 的纹理导入缓存，所以画图工具保存后下一帧就变，无需重新导入、无需 Node。

### 组织方式（可迁移范式）

| 范式 | 落点 |
|---|---|
| P3 全局状态 + 信号广播 | `scripts/ScreenState.gd` 注册为 Autoload（自动加载单例），变更 `state_changed` 广播 |
| P1 信号驱动 | 控件只调用状态 setter；播放器与属性面板订阅信号刷新，彼此不直接调用 |
| P5 组合优于继承 | `CharacterPlayer.gd` / `StatsPanel.gd` 两个独立组件，由 `CharacterScreen.gd` 注入状态后组合 |
| P8 JSON 选择存档 | `user://character_screen.json` 带 `version` 字段；缺字段或版本不符回默认值，不崩 |
| P9 物理键码 | 快捷键读 `physical_keycode`，避免中文输入法吞字母键 |

`scenes/CharacterScreen.tscn` 由 `tools/build_scene.gd` 调 Godot 自己的 `PackedScene.pack()`
序列化生成（40 个节点），**控件树在编辑器里可见可拖可改**，不是运行时凭空创建。
`scripts/Naming.gd` 是中文标签表，改名字直接编辑这一个文件。

### 实机验收

`tools/verify_world_map.gd` **全部通过，退出码 0**，覆盖：294 张地图逐张加载、
1939 个 NPC 全部有实体、tile 展开格数、全局帧索引、带偏移帧的逻辑包围盒、
跨图集补帧、障碍判定、行走 / 边界拦截、方向键动作真实驱动、名字开关、
切图后 NPC 总数一致；行走帧序列 `[4,5,6,7,8,9]`、静止帧 0、地图角色姿势固定正常 model
（2026-11-18 起再叠装备外观，见 §1.4）。
逐张实拍核对过用户点名的 1/2/3/4/7/8/10/11/12/13/15/16/17/19/20/22/23/24/31/32/
100/257/265/266/275/276/278。正常窗口 + `WORLDOL_CAPTURE=1` 生成
`_out/world_screen.png`；角色屏 44 项自检无回归。

## 1.2 修复：男性躯干漏图（2026-11-16）

用户反馈男性角色「胸没渲染出来」，画面是头 + 双臂 + 腿 + 影子、中间躯干空白。

**定位过程**：先用 Node 参考实现与 Godot 实现分别逐层渲染 Model100/200，
两边逐层输出完全一致（非透明像素都是 1200 / 1210），排除 GDScript 移植问题。
再逐层打印发现第 7 层 `frag 6001`（男性躯干，16×14）两边都返回 `BOX NULL`。

**根因不在渲染，也不在文件丢失**：`305.json` 声明 `sprite/fragment/6001.png`
的 hash 是 `adc261192fd4fc92`，按规则应在 `client/assets/ad/adc261192fd4fc92.png`，
但原版打包把它放进了 **`client/assets/dirad/adc261192fd4fc92.png`**。
两代导出器（`sprite-workbench.mjs` / `godot-import.mjs`）都只认标准 `assets/<hh>/` 路径，
所以这张图从未进入过 `sprites/素材/`，更没进 Godot 工程。

扫全清单后共有 **61 个逻辑资源**命中这个规律（hash 以 `ad` 开头、物理文件在 `dirad`），
其中 `sprite_fragment` 31 个、`sprite_model` 21 个，包含 12013–12016 等别名组。

**修复**：新增 `patch-dir-assets.mjs` —— 递归扫清单找「标准路径不存在、`dir<hh>` 备用路径存在」
的条目，只复制缺失文件、不覆盖已有素材，并同步更新 `assets/manifest.json` 与工作台映射；
`godot-import.mjs` 已接入它，将来重跑导入器不会再漏。
补齐后素材数 **10154 → 10215**，Model100 非透明像素 **1200 → 1278**、
Model200 **1210 → 1289**，胸部区域 312 个不透明像素。
验收脚本加了 5 项断言（6001 存在、两套男性造型像素阈值、胸部区域非空、女性未受影响），
`character_screen_male.png` 是修复后的实机截图。

环境变量 `WORLDOL_SEX` / `WORLDOL_POSE` 可在截图时覆盖性别与姿势（默认启动仍走存档）；
它必须放在存档读取**之后**应用，否则会被存档里的值覆盖回去 —— 这个顺序错误已修。

---

## 1.3 阶段 3 · 世界地图与 NPC（2026-11-16 落地并验收）

主场景仍是角色屏，标题行新增「进入地图 →」（快捷键 M）；地图屏右上角「返回角色屏」（Esc）。
场景文件 `scenes/WorldScreen.tscn`，由 `tools/build_world_scene.gd` 生成，节点树在编辑器里可改。

### 移植范围（全量，不是抽样）

| 内容 | 落点 | 数量 |
|---|---|---|
| 地图视觉 | `assets/map/<id>.json` + `assets/map_merged/` 图集 + `assets/map_slice/` 图块，运行时直读 | 290 张有视觉 JSON |
| 无视觉 JSON 的官方地图 | `worldMaps` 域标记 `has_config:false`，运行时用合成网格地图兜底 | 4 张（814 / 821 / 908 / 914） |
| 地图目录 | `data/compiled/worldMaps/<id>.json` | 294 张，带名字 / 尺寸 / 出生点 / NPC 数 |
| NPC 实体 | `data/compiled/npcs/<mapId>.json`（按地图分组，清掉抓包溯源字段） | 63 组 / **1939 个** |
| 玩家 | `scripts/WorldPlayer.gd`，WASD / 方向键，逐格障碍判定，脚下黄环定位 | — |

地图渲染严格照原版图层语义：type 2 是按格索引展开的 tile 层（3×3 / 5×1 / 4×1 的
切片要按 col/row 各自裁切，**不能要求横纵都大于格子**），type 3/4 是静态物件和地图自带
NPC 模型；变换 0–7 与原版 `MapTransform` 一致。

**画面质量修复（用户指出后逐张看图修正，不是只跑测试）**：

1. **图层顺序**：原版 `scene.init` 是 `i=length-1 downto 0` 逐个 `addChild`，
   也就是 `layers[0]` 最后加、画在最上层。初版按数组正序画，tile 层把前面的物件层
   全盖住了（地图看起来像一滩色块）。现在严格倒序绘制。
2. **资源回退**：地图贴图只能来自 `map_merged` 帧或 `map_slice` 切片。
   初版在找不到时回退到 `sprite_fragment`（角色部件库），把人物零件当地砖贴上；
   现在**彻底移除这条回退**。角色碎片只用于 NPC 图标，绝不进地面。
3. **跨图集补帧**：图集按地图打包但资源名是全局的；编译期生成
   `data/compiled/mapFrames.json`（267 个图集 / 2485 个资源名）。本图缺帧时从任意
   别的图集补回，修掉了 1345 处原本会开天窗的引用。
4. **帧偏移**：383 个帧带 `offX/offY/sourceW/sourceH`（如 `1101` 是 61×55 像素、
   逻辑框 65×55 且左偏移 4）。现在先还原成逻辑包围盒再画，物件不再错位/拉伸。
5. **补洞**：原包有 42 个地图资源名根本没导出（218 处引用）。这些格子用最近一格
   真实地面填充，保留地形连续性；不再留刺眼的深色方块。
6. **NPC 帧与标签**：模型不再取 `frames[0]`（有些是行走帧），改取 `anis[0]` 站立动作首帧；
   名字标签只显示角色周围 150px，不再糊满整屏。
7. **负数 tile 索引（用户点名 1–22 号后的真正主因）**：tile 层 `data[i]` 有约 1.8 万个负数，
   原版 sliceLayer 是 `cfg.data[i] & 255` 解码（`-1 → 255` 才是空格）。初版把全部负数当空格跳过，
   于是白块 / 紫块 / 黑块遍地。现在按字节解码，1 / 3 / 4 / 7 / 8 / 10 / 11 / 12 / 15 / 16 / 20 / 22
   逐张复看：桃树旁黑块、河流断口、白色方块、巨剑旁石头错位全部消失。
8. **tile 层不走图集**：原版 tile 层用 `setSrc()` 直接读 `map_slice/<name>.png`，
   物件层才用 `merged.getTexture()`。现在 `_resolve(name, prefer_slice)` 把两条路径分开，
   避免同名资源在图集与切片内容不同时贴错。
9. **NPC 默认关闭**：按用户要求，地图上的 NPC 实体与内嵌 NPC 模型默认不渲染；
   数据仍完整保留，左侧「显示 NPC」勾选后恢复。
10. **旋转变换（用户点名 16/20/265/266/278 后的根因）**：从原版 `t.transform()` 反出
    权威语义：`MIRROR_H_90(4)=scaleY(-1)+rotation90` 无位移，`MIRROR_H_270(7)=scaleY(-1)+
    rotation270+x+=h,y+=w`。初版给 4 多加了 h、给 7 少了 h，枯木/石头/树叶方向全乱。
    **最终实现不用画布旋转**：`draw_set_transform` + 负缩放叠加时，旋转后包围盒与目标矩形
    对不齐，会露出底色方块（16 号石头 361 被画成青绿矩形）。现在改成
    `_transformed_texture()`：先按 region 裁出子图 → 用 `Image.flip_x/flip_y/rotate_90`
    做变换 → 用变换后的尺寸画在 (x, y)，与 egret 旋转后的目标矩形完全一致，并按
    (纹理, 区域, 变换) 缓存。278 枯木、16/266 石头方向全部正常。
11. **地图底图不是 map_bg（16/19/23/24 怪色块的根因）**：`assets/map_bg/<id>.jpg` 是原版
    **场景切换模糊过渡图**（全部只有 160×100，对应 `getMapBlurUrl`），不是地图底图。
    初版把它拉伸到 720×1200 铺底，tile 空格处就露出放大 7 倍的糊色块。现在正常地图不画
    背景图，只有「没有视觉 JSON 的合成网格地图」才拿它当底衬。
12. **只在「所有 tile 层都没画出内容」的格子垫底（100/266/275/276 的洞）**：
    曾经把 tile 空格一律填成地面，结果 2 号湖面、7 号桥下、17 号台阶全被糊掉——那是错的。
    现在 `_prefill_holes()` 先算出每格最终可见的地面（倒序覆盖），只对「全部层都没内容」
    的格子补最近地面；补的时候还要跳过**全透明**（`91.png` 这类 RGB 全 0、alpha≈0.4 的
    黑色阴影不算地面）和**纯黑**资源，并优先选亮度 ≥0.30 的地面，避免填出黑方块。
    湖面/桥下/台阶因为下层有 tile，不会被填。
13. **角色行走动作（用户点名「移动用战斗帧」）**：初版 `WorldPlayer` 取
    `frame_numbers()` 全部帧并跟随角色屏姿势（可能停在战斗 model 200/400），于是走路时
    混进站立帧甚至战斗动作。现在固定用「正常」model（女 300 / 男 100），行走只播
    `anis[id=2]` 的 `[4,5,6,7,8,9]`，静止显示 `anis[0]` 首帧 0，与角色屏姿势解耦。
14. **排查开关**（都是环境变量，正常游玩不触发，方便以后定位）：`WORLDOL_SKIP=资源名`
    不画指定物件、`WORLDOL_NOOBJ=1` 不画物件层、`WORLDOL_ONLYLAYER=n` 只画某层、
    `WORLDOL_NOTRANS=1` 忽略旋转变换、`WORLDOL_GRID=1` 画格子标尺、
    `WORLDOL_DEBUG_PREFILL=1` 打印补洞格、`WORLDOL_DEBUG_SKIP=1` 打印资源缺失格。

### 明确不做 / 已知取舍

- **任务系统本期不移植**：NPC 的 `missionData` / `battleID` 原样保留在数据里，但界面只显示名字与台词。
- 3 张地图有 NPC 坐标超出视觉地图边界（930 等），运行时**夹到地图边缘**而不是丢弃实体。
- 19 个 `dir*` 补漏 PNG 首次需要跑一次 `godot --headless --path godot-next --import`
  生成 `.import`，否则 `load()` 会报"No loader found"。现已全部生成。
- 原版的水域图块 `203_9/10/11` 本身就是青色棋盘动画，截图里的青色格子是原画，不是渲染错误。
- **31/32 火堆上方的深色剪影是原素材**：资源 `213_3` 是原版深红色悬浮地台边缘（90% 近黑
  像素），原数据就把它摆在火堆上方，不是渲染错误；按「素材可掌控」原则不改原画。
  若嫌突兀，可直接在 Godot 里替换 `assets/map_merged/31.png` / `32.png` 里对应帧。
- **257 的浮空平台/小桌是原版冒险地图设计**：那些立在浮空石台上的烛台与小方桌是原画，
  不是贴错；缺失资源 `690_2` 只是少画一个物件，不影响整体。
- 密集地图（如 820）的怪物 NPC 用的是战斗模型，近看仍是「一堆小怪站在地图上」，
  这是原数据本身如此；若想换成更朴素的造型，改 `WorldMap.gd` 的 `_npc_texture()` 即可，
  不需要动地图数据。

### 实机验收

`tools/verify_world_map.gd` **全部通过，退出码 0**，覆盖：294 张地图逐张加载、
1939 个 NPC 全部有实体、tile 展开格数、全局帧索引、带偏移帧的逻辑包围盒、
跨图集补帧、障碍判定、行走 / 边界拦截、方向键动作真实驱动、名字开关、
切图后 NPC 总数一致；本轮新增：行走帧序列 `[4,5,6,7,8,9]`、静止帧 0、
地图角色姿势固定正常 model（不受战斗姿势影响）；2026-11-18 追加地图小人换装断言
（穿武器 +13 姿势、骑白狼切整幅 2413/2463、像素差异、还原存档）。Manual 比对图：`_out/world_screen.png`
（太阳城），并逐张实拍看过用户点名的 1/3/4/7/8/10/11/12/15/16/20/22、31/32/100/257/
265/266/275/276/278。正常窗口 + `WORLDOL_CAPTURE=1` 生成；角色屏 44 项自检无回归。

---

## 1.4 阶段 3.5 · 装备系统基础版（2026-11-18 落地并验收）

用户明确：战斗先不做、还在设计玩法，本轮只做装备的初步界面——无穿戴限制、
穿装备改属性、外观同步变化；强化 / 鉴定 / 套装不碰。

### 落地内容

| 内容 | 落点 | 说明 |
|---|---|---|
| 装备规则层 | `scripts/Equipment.gd` | 14 部位（type 映射）、属性加成解析（power 常量取自 0004.js）、外观决策、按部位列装备 |
| 装备状态 | `ScreenState.equipped` | 单独存 `user://equipment.json`，不动角色屏存档结构；`equip/unequip/clear` |
| 外观渲染 | `SpriteComposer.render_frame_*_equipped()` | 保留原函数签名（自检依赖），新增带部件替换的重载；CharacterPlayer 自动按 equipped 渲染 |
| 装备屏 | `scenes/EquipScreen.tscn` + `scripts/EquipScreen.gd` | 四列：造型预览 / 部位槽 / 候选装备 / 属性变化；角色屏「装备→」或 `E` 进入 |
| 验收 | `tools/verify_equipment.gd` | 90 项全过 |

### 关键设计取舍

- **属性不重写基线**：20 角色快照已含装备、是静态真身。装备屏显示的是"装备加成汇总"
  （`aggregate_stats`：def_* + powerN 映射成属性键，在基线之上叠加），不做实时公式、不追求逐字段对拍。
  `POWER_IDENTIFY=121` 等鉴定/百分比/技能类 power 一律忽略。
- **外观三条路径都用现成素材，不造新格式**：
  - 武器 = 换整 model：`基础姿势 + 武器姿势偏移`（0055.js 偏移表；刀 13→+13，空手 24→+0，双手枪 36→+73）。
  - 防具 = 换部件图：装备 `icon` 就是 `sprite_fragment` 编号，替换 model files 里的
    头 10021 / 衣 6005 / 裤 7005 / 肩 4013。经像素比对确认真的改变画面。
  - 背/坐骑 = 换整 model：背部 cloak `1100+style` 叠在角色后，坐骑用 `700+style` / `2000+…` 骑马 model。
- **外观定位修复（2026-11-18 二轮）**：首版发现大量防具错位，取证原版 `0055.js doChangeSpriteIcon`
  后确认根因是**性别半区**——衣/裤/肩每 style 8 个图号（4 男 4 女），装备 `icon` 是男款号，
  女角色必须 +4（衣 6075→6079、裤 7089→7093、肩 4145→4149，尺寸都不同）。现由
  `Equipment.part_fragment_id()` 按性别换算，槽位 key 也按 model 性别选（男 6001/7001/4001，女 6005/7005/4013）。
  锚点用烘焙 dx/dy + 实际尺寸/2（`SpriteComposer` 已正确，勿改）。`verify_equipment.gd` 现为 90 项全过。
  调试：`WORLDOL_EQUIP_DEBUG=1` 打印换算链；`tools/equip_compare.gd` 生成男女款对比图 `_out/equip_compare.png`。
- **外观修复三轮（2026-11-18，用户逐部位反馈后）**：
  ① 头盔掉脚底：槽位错了——`at=floor(部件id/1000)`，头盔 `PNG_HELMET=10`→槽位是 **10021**，
     不是 11001（at=11=EQUIP_OTHER=灰色脚底阴影）。已修。
  ② 护肩错位/重复（星月冥肩、朱红支配衬肩）：装备图本身是 2 帧图集（4136 58x29、4084 37x21），
     但同款 4 色只有组首带 `.json` 帧表（4081 有、4084/4088 没有）→ 整张图集被当一帧画，
     两片挤压、位置错。现缺表时借用同组同尺寸色号的帧表，按两个 layer 各画一片；已修。
  ③ 武器：换 model 后还需把 model 里的武器部件（at=8）换成装备具体图。**★武器图号=icon 本身**
     （0056.js 解码 /4 与 0055.js getWeaponIcon 编码 *4 互逆）；曾误用 /8 导致法杖变刀、
     轻弩/重弩共用一套图，现直接返回 icon，每件各用各的。已修。
  ③b 单帧肩甲兜底：组内确实没有 json 的真·单帧整图（如 4185）才 `single_use` 只画一次，
     图宽>34px 时等比缩小、位置取多片中点；4084/4136 这类能借到帧表的按原尺寸两片各画。
  ④ 背部/坐骑（2026-11-18 四轮，已落地）：原版不是硬贴部件，而是**换整幅 model**——
     坐骑 style = `1+((icon-14000-1)/4)`，model = `2000+100*(style-1)`（≥4000 +26000，女 +50，
     再加骑马武器偏移；双人 11/54 与无武器走 `700+style`/`900+style`）。骑马 model 的 files
     已含「坐骑片段 140xx + 角色部件 + 武器」，所以防具/武器替换照旧。例：白狼 14017（style 5）
     无武器男=705、带刀男=2413/女=2463。**坐骑只在世界图显示，战斗图原版不骑马**。
     背部 cloak model = `1100+backStyle`（icon 5001→1101），作为独立层画在角色后面。
     ★ 披风定位靠 **coatPt**：原版取该帧「衣服层」(frag/1000==6) 的 dx/dy 作为披风原点
     （model 100 帧0 = (-2,-35)），少了这步披风会掉到脚底；已由 `_frame_coat_point()` 实现。
     style 31 不显示；坐骑 36/42/43/48 藏披风；衣服 style 51 → cloak 32。
  ⑤ 武器特效层默认关闭（2026-11-18）：每把武器 model 都带 at=15 的 `15001`（原版绿色光效），
     原版只在武器 icon 带 flash 样式时才画；我们暂不解析 flash 样式，`draw_weapon_flash = false`
     直接跳过该层。武器贴图自带的青色光刃属于 `8001` 本身，不在此列。
  ⑥ 恶魔之翼 14169（2026-11-18，第二版）：根因不是「原版没表」，而是**素材导出时漏了
     1025 个部件帧表**（原版 305.json 里每个部件都有 json）。缺表只能把整张 224×212 图集
     当一帧 →「好几对翅膀」；第一版试过运行时借「同段同尺寸邻居的表」，结果误伤大量其他坐骑
     （同尺寸 ≠ 同布局），已回滚。现在用 `python tools/restore_fragment_tables.py` 按原版
     清单补齐：14169/14170~14172 = 7 帧（与天使之翼同表）、14229 = 16 帧、4185 = 2 帧，
     255 个被模型引用的错位图集一并修好。
- **已知边界**：战斗 model 的武器版少 2–4 帧，个别帧姿势跳回（有 fallback 不崩）；
  鞋/护手/首饰原版无外观编码，穿上不加外观；装备列表按部位最多显示 200 件（全库 2505）。
  普通防具没有整套 model（300 段仅 22 个全是武器偏移），只有 type12 时装走 15xxx/20xxx 整套。
  极少数坐骑 style 缺模型（如 42/43/47/49 无武器、11/36/48 部分女款），缺则回退无武器坐骑或基础造型。
- **地图行走小人接外观（2026-11-18）**：`WorldPlayer` 不再固定基础 model，而是走
  `Equipment.appearance(gd, 正常 model, equipped)` + `render_frame_equipped()`，
  武器姿势 / 换部件 / 披风 / 坐骑整幅全部跟随装备；`state_changed` 触发重建，换装即时生效。
- **未接线**：装备不进背包消耗、不接战斗数值、不做属性需求校验（按用户要求"暂时没有穿戴限制"）。

截图：`_out/equip_screen.png`（`WORLDOL_EQUIP=weapon:20300,clothes:10032,head:100664`）。

## 2. 素材工作流（这次的核心）

旧体系的问题：`client/assets/<hh>/<hash>.<ext>` 是 10154 个 hash 文件，必须查 `305.json`
才知道是什么；改图要覆盖 hash 文件；预览靠外挂 HTML 管理台，引擎里看不见。

现在：

```
res://assets/
  sprite_fragment/1005.png      碎片编号即文件名
  sprite_fragment/1005.json     该图集的子帧表
  sprite_model/300.json         Model 300 的逐帧组装表
  map_merged/…  png_bg/…  ui/…  其余 21 类，按类别分目录
  manifest.json                 分类 / 中文名索引
```

- **改图**：在 Godot 的文件系统面板里找到编号 PNG，用画图工具改完保存，编辑器立刻刷新；
  不需要重新导入、不需要 Node、不需要刷新 HTML。角色屏里改完直接看下一帧。
  已用验收脚本实测：改写 `10021.png` 后 Model300 帧 0 的非透明像素 1182 → 1262，
  逐字节还原后又与原图逐像素一致（见 §1.1）。
- **加素材**：丢进对应目录 → 在 `manifest.json` 补一条，或直接在 GDScript 里按路径引用。
- **看造型**：`SpriteComposer.render_frame(model_id, frame_no, scale)` 返回 `ImageTexture`，
  挂到任意 `Sprite2D` 即可；`frame_numbers(id)` 给出可播放的帧号。
- **调帧**：`sprite_model/<id>.json` 的 `frames[帧号]` 数组顺序就是遮挡层级，
  `sprite_fragment/<id>.json` 的 `offX/offY/sourceW/sourceH` 控制包围盒 —— 都是纯 JSON，
  Godot 编辑器里可直接看、可版本管理。

拼装规格是从原版引擎逆出来并已验证的，四条不能改：
① `frames[帧号]` 数组顺序 = 遮挡层级；② 子帧键不一定从 0 连续（`3001.json` 是 1~14），按键名取；
③ `offX/offY/sourceW/sourceH` 重建包围盒；④ `flip 3/5` 是 90/270 度旋转，
定位必须用**变换后**宽高居中（否则双手弓/大刀会整体偏移）。

> 导入器 `godot-import.mjs` 只在首次迁移时跑。跑完之后工程自包含，
> 不依赖任何 JS 工具链；要重跑也只是把改动过的原版素材再同步一次。

---

## 3. 数据管线（阶段 2 · 2026-11-16 已落地）

144.3 MB / 52 个源 JSON **不整包塞进工程、不一次性 parse**。
`tools/compile-game-data.mjs` 已把它们编译成按 id 分片的小文件（约 4.7 秒）：

| 项 | 值 |
|---|---|
| 产物 | `godot-next/data/compiled/<域>/<id>.json`，共 **5973 个分片 / 22.6 MB / 7937 条** |
| 索引 | `index.json`，只含域 → id 列表 / 名字 / 数量；启动时只读它 |
| 数据域 | items 2505、skills 695（783 条，含多等级）、monsters 404、missions 733、maps 63、ai 301、groups 371、areas 14、mapList 26、**worldMaps 294**、**npcs 63 组 / 1939 条**、petProfiles 504 |
| 权威规则 | 道具/地图/任务/怪物/编队/AI 以 `official-v305.json` 为本体；`career-skills` 只补 official 没有的 id；`local-*` 覆盖层按 id 深合并、优先级最高 |
| 冲突 | 两个权威源真冲突**抛错**；悬空覆盖记录到 `index.danglingOverrides` 而不阻断（源数据里 `skills/1379` 只有 `{position:2}`，无本体） |
| 未知字段 | 原样保留，不裁剪；技能多等级聚成同一 id 的数组 |
| 不编译 | `content-library.json`（仅面板）、`skill-progression.json` / `catalog-skills.json`（构建输入）—— 按 `SOURCES.md`，运行期不读 |

`GameData.gd` 提供 `get_entry(domain,id)` / `ids()` / `search()` / `name_of()` / `cache_size()`：
查询时才打开分片并缓存，搜索只查索引里的名字、不打开分片。源大文件没有复制进工程。

验收 `verify-data-compile.gd` **15 项全过，退出码 0**：四个域按 id 命中、
不存在 id 返回空、索引搜索命中「玫瑰剑」、重复查询命中缓存、
工程内无 `official-v305.json` / `content-library.json`、**100 次查询 13.5 毫秒**。
角色屏底部状态行已接入索引统计（道具 / 技能 / 怪物 / 宠物条数）。

---

## 4. 规则迁移清单（按可玩优先，不追求一次对齐）

旧 JS 的 18,857 行规则与 846 个测试用例全部不迁移。规格来源是
`analysis/modules/` 约 1613 个反编译模块 + 旧 `lib/*.mjs`（**只读，当规格书**）。

| 顺序 | 域 | GDScript 落点 | 规格来源 |
|---|---|---|---|
| 1 | 属性 / 战力 | `rules/Stats.gd` | `0056.js` 的 `getPowerValue`；注意阵法加的是**百分点** |
| 2 | 背包 / 装备 / 道具使用 | `rules/Inventory.gd` | `0032/0033.js`、`restoration.mjs` |
| 3 | 任务条件与奖励 | `rules/Quest.gd` | `official-v305.json`、`missionConditions` |
| 4 | 战斗回合 / 伤害 / 掉落 | `rules/Battle.gd` | `0054/0091.js`、`loot.mjs` |
| 5 | 阵法 / 宠物 / 军团 | `rules/Formation.gd` 等 | `formation-data.mjs`、`PetVO(0042)` 的坑 |
| 6 | 城市 / 商店 / 活动 | 按域补 | `content.mjs`、`official-*.json` |

已知会咬人的旧坑（写 GDScript 时直接照抄结论，别重踩）：
`PlayerVO` 的 `get()` 动态现算、`MonsterVO` 字段即总值；`PetVO.get()` 会覆盖
`this.formationSkill`；战斗内外判定要看 `battle.getPlayerByPos(vo.position)` 是否真有单位。

---

## 5. 阶段路线（每阶段都留一个能跑的东西）

| 阶段 | 交付 | 验收 |
|---|---|---|
| **0 · 素材落地** ✅ | 本轮工程骨架 | Godot headless 能拼出三种造型，主场景能启动 |
| **1 · 角色屏** ✅ | 造型播放器 + 属性面板（性别 / 姿势 / 动作 / 逐帧） | 已验收：33 项断言全过；改 PNG 后同帧像素变化、还原后逐像素一致；GUI 实拍 `_out/character_screen.png` |
| **2 · 数据编译** ✅ | 5616 分片 / 21.9 MB + `GameData` 懒加载 | 15 项验收全过；100 次查询 13.5 ms；只加载 136 KB 索引，源大文件不进工程；角色屏 44 项无回归 |
| **3 · 世界地图 + NPC** ✅ | 294 张地图、1939 个 NPC、角色可行走 / 切图 | 全部逐张加载无异常；方向键驱动行走；实拍 `_out/world_screen.png` |
| **4 · 战斗屏** | 一屏回合制战斗，用原版怪物与技能素材 | 能打完一场、掉落进背包 |
| **5 · 任务 / 商店** | 在世界屏上接任务、交付、进商店 | 能接任务、交付、换地图 |
| **6 · 单机壳** | 存档（单文件 + 版本迁移）、导出 exe | 双击即玩，无端口、无网络请求 |

---

## 6. 风险与不可逆点

| # | 说明 | 处理 |
|---|---|---|
| R1 | 本机 4.3 已 EOL，与 4.7.2 有 API 差异 | 正式开发前升级；当前只用最基础 API，升级成本低 |
| R2 | 10154 个 PNG 首次导入 Godot 会生成大量 `.import` | 一次性成本；`.gitignore` 已忽略 `.godot/` |
| R3 | 规则要按反编译模块重读，换引擎不减少这部分工作 | 按域切、每域先做可玩版本，不追求一次对齐 |
| R4 | 144 MB 数据若整包载入会卡 | 分片 + 懒加载，阶段 2 处理 |
| R5 | 旧 JS 工程冻结后，之前的补丁链 / 编辑器不再维护 | 它们仍产出 `data/*.json`，可继续当外部 devtools 用 |
| R6 | headless 用 dummy（空渲染）驱动，`get_viewport().get_texture()` 读不回图像，截不了 UI | 布局验收改用节点尺寸断言；要看整体效果用正常窗口模式 + `WORLDOL_CAPTURE=1` 存 PNG |
| R7 | `SpriteComposer` 直读 `res://` 原始 PNG；导出包默认可能只带转换后的纹理，不带原文件 | 阶段 5 在导出预设 Resources 里加 `include_filter="*.png,*.json"`，导出后跑一次 `selfcheck.gd` 确认三张帧仍能拼出；编辑器内使用不受影响 |
| R8 | 原版资源存在「清单 hash 路径与物理目录不一致」：`ad*` hash 实际放在 `assets/dirad/` | 导入器接入 `patch-dir-assets.mjs` 自动补漏；新增素材发现逻辑异常时先按此规律反查 `dir<hh>` 目录 |

数值面板当前读的是 20 角色基线快照，**不是**实时属性公式；实时公式排在 §4 规则迁移第 1 项，
本阶段刻意不混进角色屏，避免把「显示数据」和「重算规则」两件事一起做。

---

## 7. 常用命令

```bash
# 只跑一次：把原版素材同步进工程（之后不再需要 Node）
node godot-import.mjs          # 已自动接入 dir* 备用目录补漏

# 单独补漏（不覆盖已有素材）：清单里 hash 指向 dir<hh> 的 61 个逻辑资源
node patch-dir-assets.mjs

# headless 自检（本机 4.6.3）
"/d/Godot/Godot_v4.6.3-stable_win64_console.exe" \
  --headless --path godot-next --script res://tools/selfcheck.gd

# 资源导入（新增 PNG 后才需要；dir* 补漏图首次必须跑）
... --headless --path godot-next --import

# 数据编译：源文件只读 → 5973 个分片（约 4.7 秒）
node tools/compile-game-data.mjs

# 数据编译验收：15 项断言（懒加载 / 缓存 / 搜索 / 无大文件 / 查询耗时）
... --headless --path godot-next --script res://tools/verify-data-compile.gd

# 角色屏验收：44 项确定性断言（含改 PNG 生效 / 还原、男性躯干、存档版本兼容）
... --headless --path godot-next --script res://tools/verify_character_screen.gd

# 世界地图验收：294 图 / 1939 NPC / 障碍 / 行走 / 切图
... --headless --path godot-next --script res://tools/verify_world_map.gd

# 重建角色屏 / 世界屏控件树（改完 .tscn 布局不用跑；只有改控件结构才重跑）
... --headless --path godot-next --script res://tools/build_scene.gd
... --headless --path godot-next --script res://tools/build_world_scene.gd

# 主场景跑 30 帧（应无任何 GDScript 报错）
... --headless --path godot-next --quit-after 30

# 正常窗口模式截图：_out/character_screen.png / _out/world_screen.png
WORLDOL_CAPTURE=1 ... --path godot-next --quit-after 60
WORLDOL_CAPTURE=1 WORLDOL_MAP=4 ... --path godot-next res://scenes/WorldScreen.tscn --quit-after 90

# 正式打开：Godot 编辑器里 Import → godot-next/project.godot → F5
```

旧的 `世界OL现代化重写方案.md`（TS + PixiJS 绞杀式）已停用，
只保留其中的现状审计与素材规格章节作参考。

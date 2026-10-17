# 世界OL 单机版 — 项目笔记

## 仓库与命令
- 根 `<项目根>/FileRecv/源码/世界OL_单机源码_独立包_20260923/世界OL_源码/`，
  服务端/工具在 `世界online_原版单机/`；改动记录 `修复记录.txt`（CRLF 无 BOM）。
- 不入库：client/ analysis/ node_modules/ saves|logs|backups|runtime/ 安卓打包/app/www/
- `npm test`（pretest 先跑语法基线），判定**新增失败必须为 0**；`npm run check` 语法检查；
  known-failures 空；临时目录一律 `os.tmpdir()`。
- 测试可直接读 `analysis/modules/00XX.js`（不入库，缺失整文件 skip）：`vm.runInNewContext`(模块工厂)
  + 桩 require 拿真常量；`acorn + acorn-walk` 抽函数体配桩对象跑真逻辑
  （见 tests/game.test.mjs 的 nativeParser / tests/battle-power-rules.test.mjs）。
- 环境：`CODEBUDDY_SAFE_DELETE_ENABLED=0` 常设；**spawn 到 node.exe 恒 EBUSY**；
  `fs.cpSync` 大目录崩溃 → `copyTree()`；.ps1 需同进程 `Set-ExecutionPolicy -Scope Process Bypass`；
  vm 跨 realm 先 JSON 克隆；Git Bash /tmp = `<用户目录>\AppData\Local\Temp`。
- **项目目录内的删除会进 F 盘回收站**（`%TEMP%` 里直接消失）。沙箱里跑打包会把 Gradle 中间产物
  塞进回收站（一次 1.5–2 万条，攒到 4.2 万条后清空极慢）→ 工具 `安卓打包/清理回收站.bat`；
  用户自己双击打包不进回收站。

## 单一来源 / 数据契约
- 补丁链 `client-patch-chain.mjs`、动态全局量 `generated-globals.mjs`（都有两个投放口，改一处必崩）。
- `data/*.json` 抓包产物一字节不改；career-skills.json 是验收契约。改技能效果走
  `data/local-skill-overrides.json` + `lib/local-skill-overrides.mjs`（restoration.mjs ensure() 套用，
  覆盖后重算 powers 与 wireBase64）。支持 `perLevel`（优先于 set）+ 白名单 `OVERRIDABLE_FIELDS`。
- **装备技能与人技能共用 skill id**（513 个装备技能有 301 个与 career-skills 重叠）→ 一条规则两边生效。
  装备路径定义来自 `nativeEquipmentSkill(item)` 与叠加等级池（不在 skills 表）→
  `restoration.mjs` 的 `activeSkills()` 拼完 definitions 后要再套 `applyOverrideToDefinitions`，
  `learned()` 的 importedSkillDefinitions 也套一次。
- **怪物技能定义在 `official.skills`**（不在 restoration 的 skills 表），战斗包发
  `monsterWireBase64||wireBase64` → 覆盖生效要改两处：official-data ensure() 套整表 +
  `rebuildLevel()` 同时重算 monsterWireBase64（只改 wireBase64 怪物仍放旧效果）。

## 通用坑（反复踩）
- `x||1` **不能用来判断"是否为零"**：`0` 被默认值吃掉。典型事故
  `filter(i=>(i.quantity||1)!==0)` 恒真 → 背包留 quantity=0 幽灵道具。正确：`i.quantity!==0`。
- **查询类接口不许改角色**：快照/只读路径必须走纯读函数，否则"打开面板"就把存档写脏。
  永泽塔用 `towerCountsReadonly`，无限试炼用 `readTrialState`（trialState 只给写入路径）。
  守卫：`assert.deepEqual(p,before)`（tests/home-features.test.mjs、trial-challenge.test.mjs）。
- **itemPacket 宁可降级绝不抛错**：`enterWorld→…→bagPacket→itemPacket`，一件抛错整包发不出 → 黑屏。
  「下架」只改名单，定义留着。
- JSDoc 注释里别写 `*/` 字样（如 `power*/powerValue*`）→ 块注释提前关掉 → SyntaxError。

## 服务端
- `protocol-constants.mjs`（写 `P.<名>`）；本地裸号 90021/90022/32107/22106。
- `protocol-dispatch.mjs` INBOUND_CHAIN **22 段有序不重排**（第 63 版新增 solarChallenge）；
  拒绝回 false **且不许读字节**（读过要还原 r.pos）。
- `http-routes.mjs` 405 门位置承重；`lazy-data.mjs` **数组不能包代理**（数组型导出改函数）。
- 战斗 12501/12502：`context.battle` 被拒要搬 `rejectedBattle` **并清空**（否则 20+ 守卫锁死玩家）；
  报错点名哪一项；包尾 `locateTrailer()`；血蓝上限 `nativeVitalsCeiling()` 分级放宽
  （坑：nativeCharacterStats 对残缺角色静默返回 0）。
- **不在地图上的战斗组**（塔层、太阳棋盘、试炼）必须跳过 12501「请靠近战斗目标」距离校验，
  并强制走官方怪物表；下发世界数据前要确认组真存在（`worldData()` 收 towerExtraGroups +
  trialExtraGroups），残留标记会让整包写歪 → 客户端 `Error #1025`。
- **延迟注册顺序**：`official-data.mjs ensure()` 里建 officialGroups/officialMonsters Map，
  运行时再注册的进不了 Map → 必须注册在索引构建**之前**。
- `planItemRewards` 碰到无定义道具会**整包抛错** → 奖励表只引用有定义的道具；
  宝箱 1759/1760/1770 无定义，发放要跳过并记账。

## 客户端
- 主包 `client/js/ff/fff570bb….js` 4,557,839 → 补丁后 **4,565,461 字符**（链测试用字符数，别用字节数）。
- **补丁注入点分「语句 / 表达式」上下文**（第 51 版）：webpack 类成员常是
  `return __extends(t,e),t.prototype.a=…,t.prototype.b=…,t` 逗号链。往链里插分号 → return 提前结束 →
  IIFE 返回不是类 → 进战斗报「r.show is not a function」。安全做法：注入函数体开头（模块 54 `ticker()`）；
  守卫用 acorn 比对「不在 return 里的 prototype 赋值」数量（tests/battle-check-and-eggs.test.mjs）。
- **`World.toBattle` 的远程/本地开关**（第 66 版大坑）：三个条件
  `isLeader()&&isHasPlayerMember()` / `1==isNetBattleID(t)` / `isEscortStatus()` 任一为真就走
  **12503 远程战斗**，而服务端只接 12501 → 客户端 `getReceiveMsg()` 拿到 null 静默返回（"点了没反应"）。
  `isEscortStatus()` = `null!=this.escort`，escort 由服务端推 14508 时设上 → **棋盘一开就恒真**。
  修法（社区版同理）：三个条件都加 `&&null==e.getMonsterGroup(t)`（本地世界数据里有这组就别走远程）。
  本工程前两条早由 client-mission-patch / client-legion-patch 打过，漏的正是 isEscortStatus 那条
  → `lib/client-escort-battle-patch.mjs`。**排查客户端行为要去主包里搜协议常量名顺藤读码，别推断。**
- 图标 = bagIcon 十进制字符串作**全局数值子键**解析；item_icon0..7（0..9098）、bb_head（宠物头像
  500..548）；蛋图标 = headIcon。资源表 `305.json` 顶层 `res.resources`（78 sheet，subkeys 是逗号串）。
- **文本两套命名空间**：`GameText`(模块 10) 与 `GameText2`(模块 23)。`STR_ATTR_IGNORE_*`
  （无视反击/魔法反馈/格挡/洞察/状态抵抗/伤害减免）**只在 GameText2** → 取法
  `window.__worldReq(23).GameText2.…`。全库文本常量可用
  `/e\.([A-Z][A-Z_0-9]{2,40})="([^"]{0,40})"/g` 从主包抠出按值反查（共 2163 条）。
- 战斗查看面板（battleCheckFields v4）已去 isCheckAll 门并补 12 字段；只差「天生状态」图标区未做。
- 怪物血蓝条（battleMonsterBars v5）**用游戏自带的条**：改 `hideMsg()`，怪物
  （`vo.isMonster && !vo.isDead()`）保留 HP+MP，整段 try/catch。**不要再自绘**（第 50~52 版白折腾三版）。
  真因：`BattlePanel.paint → hideAllPlayerMsg` 每帧关掉三条，蓝条只在 `isRePlayBattle` 才开。
- **战斗数值规则**（模块 0075 processBattlePower，tests/battle-power-rules.test.mjs 有真代码沙箱）：
  · statusBit 与 power 一一对应；statusBit 为减益时，目标有 BUFFER_RESIST_DEBUFF(20) 或
    `isWilSuccess` → **整段 return**。给属性变化挂状态标签 = 押在减益免疫后面。
  · `POWER_HP_PERCENT=50`（百分比伤害，powerValue 负=扣血）：`powerValue×目标HPMAX/100` → 距离豁免 →
    按 `calTouch`（TOUGH 千分比，流血/衰弱减半，封顶 700‰）扣减 → 再减 IGNORE_TOUCH → 直接进血。
    **吃伤害减免但千分比、封顶 70%**，不走防御豁免/格挡/破甲。
  · POWER_*/BUFFER_* 常量在 analysis 模块 4 的 default（桩 require 跑工厂拿）。
  · 每回合血蓝回复在模块 251 `doRoundHpMp`：HEAL_RECOVERY(60)/MANA_RECOVERY(61) + 天生状态
    BUFFER_ADD_HP/ADD_MP（各 +0.5% 上限）；已改成怪物法力 ≤0 跳过回蓝（battleMonsterMana 补丁）。
- 判定常写死 ID 区间（发型 40100–40199 / 脸型 40200–40249）；
  `web/offline.js` 包了 updateIcon → 改 icon1 位域必须同步 `baseFaces`。
- 本地 NPC 由 content.mjs push 进 maps[].npcs（**地形之后**）；编号 0..127。
- 报错弹窗出口之一：`web/legion.js` 包了 `World.toBattle`，`catch(e){UI.alertMessage(e.message)}`
  → 报错文案是纯 JS message（不带 TypeError:）时先想这里。

## 单机版约定
- 编号：造型 40101+/40201+、宝石 800401–800405、本地道具 ≥900000、宠物蛋 30000000+、
  封印书 920000000+、技能书 930000000+（后两者 `base+技能号*128+等级`）。
- 919 只卖训练师教不到的满级技能书；遗忘 14003/14006；改名 15511；公告在 `web/offline.js` applyNotice。
- 宠物自制/换皮/画图整套机制**已移除**（第 49 版）；保留幻化、技能书、导师、恢复服务。
  幻化后场景跟随要走原生 `setPet(vo,true)`，判定同一只**按槽位**。

## 打包
- **统一跑 `安卓打包/一键打包.bat`**（双击即用；四步：环境自检 → `node standalone/build.mjs`
  → `构建APK.ps1` → 归档 `output/worldol-<时间戳>.apk`，留最近 5 个）。参数
  `release` / `fresh` / `noopen` / `nopause`。终端走**管道**调它 `$LASTEXITCODE` 会失真报 failed，
  以脚本自打印的「四步全部成功，退出 0」和 output/ 里的 APK 为准。
- **APK 里 `fs.existsSync` 对 `data/**` 恒为 false**（第 57 版大坑，症状"改了技能没反应"）：
  node:fs 是 VFS shim，existsSync 只查**已预载**内存表，而预载清单只有 6 个文件、不含 data/；
  data 运行时同步 XHR 现取。正确写法
  `try{fs.readFileSync(x,'utf8')}catch(e){if(e?.code==='ENOENT')…}`。
  守卫：tests/skill-editor.test.mjs 断言 lib 里除 store.mjs / http-routes.mjs 外不得出现 existsSync。
  `readText`/`readBytes` 都走**文本** XHR，别读二进制。
- **bat 必须 GBK(936) + CRLF**（cmd 按 ANSI 代码页解析，UTF-8 会乱码甚至拆坏整行命令）。
  用 Edit 工具改过必须转回：`[IO.File]::WriteAllText($p,$t,[Text.Encoding]::GetEncoding(936))`。
  bat 里写路径别用 `>` 箭头（会被当重定向）。ps1 固定 UTF-8 → bat 调用前 `chcp 65001`、后 `chcp 936`。
- **构建指纹必须覆盖 `data/**`**：data 不预载、URL 无版本号 → 只改资料指纹不变 → WebView 缓存不清。
  两道保险：build.mjs 的 hashTree(data) 计入指纹 + vfs URL 带 `?b=<指纹>`。
- 跑构建前同进程设 `CODEBUDDY_SAFE_DELETE_ENABLED=0`（`cap sync` 删 9999 文件会被保护拦，
  报 `[safe-delete] count:9999, threshold:50`，看着像 capacitor 坏了）。

## 技能编辑器（第 54 版）
- `世界online_原版单机/技能编辑器.html` 单文件、双击即用、不启服务；改完写回覆盖文件。
- 内嵌 `<script id="game-labels">`（221 效果 + 33 状态 + 5 张参数文案表）**不要手抄** →
  `node tools/build-skill-editor-data.mjs`（`--check` 校验，tests/skill-editor.test.mjs 比对）。
- HTML 内 CODEC 是 `skillBytes()` 的浏览器复刻（big-endian、short=uint16、string=3 字节长度 +
  每字符 2 字节）；**技能等级定义 wire 一律 item=false**（item=true 只用于物品内嵌那份，差一字节）。
- **技能说明 info ≠ 效果行**（第 56 版）：客户端 `getDesc()` 先按 power 实时渲染、再把 info 原样追加。
  只改 power 不改 info → 新旧混排像"没生效"。`dropStaleEffectLines()` 命中 EFFECT_FIELDS 且用户
  没显式覆盖 info 时自动清旧效果行（保留标题与提示行）；手写 133 条与装备 226 条结构不同，不动。
- `tools/skill-editor-selftest.mjs` 可选浏览器冒烟（不进 npm test）。Git Bash 里别用 heredoc 写脚本。

## 社区版移植（第 58 版起）
- 来源 APK `<用户目录>/Downloads/最新优化副本版本.apk`；**服务端 bundle 未混淆**（esbuild 留
  `// lib/xxx.mjs` 注释）→ `node tools/extract-community-modules.mjs <apk> <dir>` 切出 123 个模块。
- **客户端界面多半原版自带**（成就 11023-11025、称号 11026 等）→ 写 UI 前先查客户端有没有对应协议。
- 已移植：战斗属性缓存、成就系统、永泽塔兑换商店（12020/12021，shopId 23722）、永泽塔挑战
  （`lib/climb-tower.mjs`）、可重复任务链（`lib/replayable-chains.mjs`）、日常副本编队 9 个
  （`lib/dungeon-challenge-data.mjs`）、**英雄挑战赛/团队副本**（`lib/solar-challenge-*.mjs`，
  第 65 版修好任务侧闸门 + 接任务推棋盘）、**天空竞技场/无限试炼**（`lib/trial-*.mjs`）。
- ~~休眠坐骑 96 件~~ 第 64 版**已整体移除**（玩家反馈图标全共用野猪、鉴定面板空白；
  根因与可行的重做方案见 2026-10-17 日志，社区 APK 数据都还在）。
- ~~勇气勋章 A 方案~~ 第 61 版已撤回（lib/tower-points.mjs 及其测试已删），勋章回到塔层首通/扫荡。
- 合成商店（11503）用户明确**跳过**；副本奖励修复（169 个缺失道具定义）用户判定**不需要**，未做。
- 任务链的坑：official-v305 缺 3220 / 8700–8709 / 1823，玛雅链只推出 22 环（社区版写 71 环）；
  finale 不在节点集合 → 「通关」要同时接受「全节点完成」与「finale 命中」。
- **编队 wire**：`short(组) byte(类型) short(下一组) byte(flag) int32(系数)` + (flag&1?20:10) 个 short
  + [flag&2 ? 4 个 NPC short]，flag 与槽位数必须一致（16 怪 → flag 3）。
  怪物 wire = int32 id + 3 字节长度 + UTF-16**BE** 名字（写 utf16le 会乱码）。
- **永泽塔数据本工程一直都有**（`data/home-features-v1.json`，132 层 + 160 只塔怪 id 2700–3000 +
  每层 bodyBase64），社区版没补数据，只做接线：① 塔怪灌进 official.monsters；
  ② 编队 `23000+层号`，push 后**重建 officialGroups Map**；③ 30003 挑战/30005 扫荡；
  ④ 真实进度（逐层解锁，⚠️ 别写 `Number(x)||1`，0 会变 1）。塔怪技能与 AI 两边都没采集 → 只会普攻。
  `c2s_ClimbTowerSweep` 抓包 schema 是空的 → 必须 `r.int()`，走 protobuf 解出 0。
- 装备 wire：单源 `lib/character-import-codec.mjs` `equipmentBytes(e)`（= `writeEquipment(e,offsets)`）；
  `equipmentOffsets(e)` 返回 `{bytes,offsets}` 供鉴定/洗炼改字节，已对 2134 条官方 layout 逐字节验证。
- 坐骑：图标用**模板坐骑自己的 bagIcon**（社区 bagIcon 9416–9512 不在任何图集），96 件全部命中
  "template"；`lib/item-affixes.mjs` 走 `layoutFor(id)` 才认新坐骑的鉴定/词缀布局。

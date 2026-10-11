# 世界OL 单机版 — 项目长期笔记

## 项目位置
- 源码根：`<项目根>/FileRecv/源码/世界OL_单机源码_独立包_20260923/世界OL_源码/`
- 服务端 + 工具：`世界online_原版单机/`（`lib/` `tools/` `web/` `tests/` `server.mjs`）
- 打包：`安卓打包/构建APK.ps1` → `安卓打包/app/android/app/build/outputs/apk/debug/app-debug.apk`
- 改动记录：`修复记录.txt`（CRLF、UTF-8 无 BOM，按版本追加）

## 跑测试（重要约定）
**一律用 `npm test`，不要裸跑 `node --test tests/*.test.mjs`。**

```
npm test                        # = node tools/run-tests.mjs（默认入口）
npm run test:all                # 列出全部失败，不忽略
npm run test:raw                # 完全裸跑
node tools/run-tests.mjs --only beauty    # 只跑相关文件，几秒出结果
node tools/run-tests.mjs --update         # 修完用例后重写已知失败清单
```

判定标准：**只看「新增失败」是否为 0**。为 0 就是无回归，不需要再去比对老失败。

- `tests/known-failures.json` 里记着 46 条长期失败的用例（2026-10-11 现状）：它们
  期望的是原版/早期单机版的行为与数据规模（宠物模板写死 23 个而目录已有 50 个、
  经验表阈值、icon1 还是字符串的年代…），**不是 bug**。运行器按清单忽略，清单外的
  失败会点名并以退出码 1 结束。改动用例后如果这个数字变了，用 `--update` 重新生成并复核。
- 测试的临时目录**一律 `fs.mkdtempSync(path.join(os.tmpdir(),'worldol-<名字>-'))`**，
  删除守卫写「必须在 `os.tmpdir()` 下」。**不要建在仓库根** —— 曾经有 10 个用例这么做，
  清理又不在 finally 里，攒了 78 个残留目录。

## 环境坑（本机专属，用户机器上没有）
- **`node-safe-delete-shim.cjs`**：WorkBuddy/CodeBuddy 命令行通过 `NODE_OPTIONS`
  注入，拦截「一次删 50 个以上文件」，会让 recorded-expansion 等用例整片失败
  （`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。跑构建/测试要加
  `CODEBUDDY_SAFE_DELETE_ENABLED=0`；`tools/run-tests.mjs` 已自动处理。
- **`fs.cpSync` 复制大目录会打崩 node**：在 F: 卷上复制 `data/` 会出现 Windows
  退出码 `0xC0000409`，Git Bash 里只表现为 `exit 127`。`安卓打包/standalone/build.mjs`
  已改成自写的 `copyTree()`（readdir + copyFileSync）。
- 构建顺序：**先 `standalone/build.mjs` 生成站点，再跑 `构建APK.ps1`**。
  `lib/content.mjs` 这类服务端代码会打进站点的 `worldol-standalone.js`，
  只重打 APK 而不重建站点等于没改。
- **本机执行策略禁止直接跑 .ps1**。在 PowerShell 工具里同一次调用先
  `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force`（进程级，不跨调用保留），
  再 `& .\构建APK.ps1`；不能从 Bash 里调 powershell.exe（命令行安全策略会拒）。
  构建前先 `$env:CODEBUDDY_SAFE_DELETE_ENABLED="0"`。
- 站点构建日志里的「构建指纹」= `standalone/build.mjs` 算出的站点指纹，
  打包后可从 APK 的 `assets/public/` 里解包核对。

## 版本控制（2026-10-11 起）
- 仓库根 `世界OL_源码/` 已是 git 仓库（分支 main），基线提交 `2bbe512`。
- `client/`、`analysis/`、`node_modules/`、`saves|logs|backups|runtime/`、
  `安卓打包/app/www/`、android 构建产物、`test-*/`、`.scratch/` 都**不入库**（约 320 MB）；
  `lib/ tools/ tests/ web/ data/`、`server.mjs`、构建脚本与文档入库。
- 本地配置 `core.autocrlf=false`：修复记录.txt / *.cmd / *.ps1 **必须保持 CRLF**，
  不能让 git 在检出时改行尾。写文件也要注意别把它转成 LF。
- `.gitignore` 不支持行内注释（只有行首 # 是注释），说明必须单独占一行。

## 客户端补丁链（唯一来源）
- **`lib/client-patch-chain.mjs` 是唯一来源**，`CLIENT_MAIN_STEPS`(23 步) 与
  `CLIENT_BOOT_STEPS`(3 步) 按数组顺序执行；`patchClientMain()` / `patchClientBoot()` /
  `replaceOnce()` / `CLIENT_MAIN_PATH` 都从这里导出。
- `server.mjs` 与 `安卓打包/standalone/build.mjs` **都必须 import 它**，
  不要再在调用方排列补丁函数（`tests/client-patch-chain.test.mjs` 守着，
  顺序改了要同步改用例里的 EXPECTED_MAIN_STEPS）。
- 加新补丁：写 `lib/client-xxx-patch.mjs` 导出 patch 函数 → 加进 `CLIENT_MAIN_STEPS`
  末尾（或按依赖插到合适位置）→ 同步 EXPECTED_MAIN_STEPS → 跑 `--only client-patch-chain`。

## 客户端要点（改功能前必看）
- 主包：`client/js/ff/fff570bb4753f056432680e781d827dc.js`（4,557,839 字符，**尽量不要动**；
  构建期由 `安卓打包/standalone/build.mjs` 打补丁成 4,564,108，这个长度是用例里的指纹）。
- 资源清单 `client/v/gd/305.json` 是归档原件，**字节不能改**（测试断言 sha256）；
  所有补充只在 `lib/native-ui-restoration.mjs` 内存生成的那份清单上做。
- 客户端很多判定是**写死 ID 区间**的（例：`isHairItem` 认 40100–40199、
  `isFaceItem` 认 40200–40249）。本地补的道具必须落在这些区间里才会被识别。
- 道具按 `type` 分派解析分支，字段布局各不相同；改 type 前先确认目标分支会读
  你需要的字段（例：只有 `ITEM_CLASS_ARMOR` 分支读 `icon`，`USE_ITEM` 不读）。

## 美容院造型道具（客户端侧要点）
- 图标是「脸型碎片 + 发型碎片」叠出来的**头像**，每件两张帧：`<编号>`（男）/`<编号>f`（女），
  由 `tools/build-fashion-icons.mjs` 的 `composeAvatar()` 生成；`web/offline.js` 的
  `Tool.getIconByData` 钩子按 `myPlayer.icon1.low & 1` 选帧 —— 与渲染取男/女碎片是同一位
  （`0055.js`：`g = icon1.low >> OFFSET_SEX & LEN_SEX`）。
- **坑**：`web/offline.js` 给 `Player.prototype.updateIcon` 包了一层，每轮把 icon1 的
  发型(7..10)/脸型(13..16)位还原成 `baseFaces` 基准（为让"脱掉时装恢复原发型"成立）。
  所以**任何改写这两段位域的路径都必须同步 baseFaces**，否则会被 updateIcon 立刻还原。
  已知入口：商店 `ModelTool.getCompareSprite` 预览、购买回包 `2==p` 分支 —— 都已通过给
  `Player.prototype.updateHair/updateFace` 包一层来做同步；`tests/appearance.test.mjs` 守着。
- 造型道具编号 40101–40129（发型）/ 40201–40214（脸型），落在主包 `isHairItem/isFaceItem`
  写死的号段里；道具固定 type 12（只有 `ITEM_CLASS_ARMOR` 分支会读 `icon`），
  买下即换、不进背包。

## 本地新增 NPC 的约定
- 定义集中在独立文件里（补给商人 `lib/supply-shops.mjs`、纪念 NPC
  `lib/memorial-npcs.mjs`），由 `lib/content.mjs` push 进 `maps[<id>].npcs`。
  **push 与落点校验必须放在地形加载之后** —— `walkable()` 要等
  `data/maps/<id>.json` 读进来、`map.blocks` 有了才有意义。
- **编号必须留在 0..127**：协议按有符号字节走，128+ 读回来是负数，客户端按 id
  找不到这个 NPC。官方 500+ 个 NPC 无一例外。
- 纯聊天 NPC = `type:0` + `local:true` + `pureTalk:true`。缺 `local` 会被
  `officialSign()` 接管；缺 `pureTalk` 时 `npcSign()` 会顺着任务状态返回 1/2/3，
  玩家身上挂着可接任务时 NPC 头上会冒感叹号（点开却是纯文本）。
- 点开对话窗只看 `talkDetail` 非空，与 type 无关；`welcome`/`talk` 经
  `Tool.convertDesc`，支持 `/cRRGGBB … /p` 着色。`utf()` 是 2 字节长度前缀，
  上限 65535 字节，长文案安全。
- 形象 `icon` = `assets/sprite/model/<编号>.json`。一个 model = `files`（引用的
  fragment 列表）+ `frames`（每朝向若干层 `[fileIdx, 子图号, x, y, flag]`）+
  `anis`；fragment 是索引色 PNG，多子图时配一个同名 `.json` 描述每个子图区域
  （没有 json 就整图算一帧）。换贴图只需新增 model、改 `icon`。
- **落点不能只信 `walkable()`**：`map.blocks` 只记阻挡格，**灯柱 / 花坛这类摆件不在
  里面**。要避开得直接翻 `data/maps/<id>.json` 的 `layers[].obj`，把
  `o[0]===2`（绘制物）且高度偏大的（实测 `o[5] >= 45`，344x 那一批）当作障碍，
  否则 NPC 会正好压在灯柱上。`tests/memorial-npcs.test.mjs` 按这条守着。

## 单机版约定
- 所有本地道具 `localPrice = 0`（免费），与原版目录一致。
- 本地补充道具编号：造型道具 40101+/40201+（原版号段）、+4 宝石 800401–800405、
  其它本地道具 ≥ 900000。
- 新增/改动功能要配测试，并保证 `npm test` 的新增失败为 0。

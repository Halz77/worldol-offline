# 手动改BUG指南（世界OL 单机版）

> 这份文档写给「以后不开 AI 也能自己动手」的场合。
> 只需要记住一句话：**`lib/` 是唯一一份源码，电脑版和手机版都从它取，所以只改一遍。**
>
> 动手前的两个习惯：**要改的文件先复制一份**；**动存档之前先拷一份 `world.json`**。
> 最后更新：2026-10-25（第 92 版阵法系统之后）。改动细节以 `AGENTS.md` 与 `docs/memory/` 为准。

---

## 0. 三条铁律 + 一条纪律

1. **`lib/` 是唯一一份源码。** 电脑版（服务端运行时）和 APK（构建期）都从 `世界online_原版单机/lib/` 取逻辑和客户端补丁。改一遍，两边都生效——不要去找「APK 版那份」。
2. **不要直接改 `client/js/ff/fff570bb4753f056432680e781d827dc.js`。** 那是压缩成一行的产线包，APK 构建时会被重新平铺覆盖，改了也会没。客户端改动写成 `lib/client-*-patch.mjs`（字符串替换补丁）。
3. **新补丁只挂一处：`lib/client-patch-chain.mjs` 的 `CLIENT_MAIN_STEPS` 数组。** `server.mjs`（电脑版）和 `安卓打包/standalone/build.mjs`（APK）都 import 这一个模块，加进数组就是两边同步，顺序即数组顺序。调整顺序前先看 `tests/client-patch-chain.test.mjs`——顺序在那里被钉死了。
4. **纪律：补丁锚点不匹配要直接抛错。** 每个补丁都是 `if(source.split(from).length!==2)throw Error('… mismatch')`。找不到就炸是故意的——升级客户端产线包后会立刻看到明确报错，而不是悄悄不生效。

---

## 1. 目录地图（改哪里）

```text
世界OL_源码/
├── 世界online_原版单机/          ← 源码主目录（要改的都在这里）
│   ├── server.mjs               服务端入口 + 登录/选角等协议分发
│   ├── lib/                     ★ 游戏逻辑（160+ 模块，最常改的就是这里）
│   ├── lib/client-*-patch.mjs   ★ 客户端补丁（唯一合法改客户端的地方）
│   ├── lib/client-patch-chain.mjs 补丁链（新补丁挂这里）
│   ├── web/                     单机菜单与网页界面（33 个文件）
│   ├── data/                    抓包资料 + maps/ 地形 + 本地覆盖层（160MB）
│   ├── tools/                   检查、测试、数据生成工具（80 个）
│   ├── tests/                   回归测试（96 个文件）
│   ├── client/                  原版 H5 客户端（只读，别直接改）
│   ├── analysis/                反编译产物（查客户端行为的参考书）
│   └── saves/ default-save/ qa-v05-saves/   各套存档
└── 安卓打包/                     ← 打包用
    ├── 一键打包.bat              推荐入口（release/fresh/noopen/nopause）
    ├── standalone/build.mjs     构建站点（打补丁 + 打包 worldol-standalone.js）
    ├── app/www/                 站点产物（自动生成，别手改）
    ├── 构建APK.ps1              出 APK
    ├── output/                  一键打包的成品 APK（worldol-<时间戳>.apk）
    └── 说明.md                  打包细节
```

| 你想改什么 | 改哪个文件 |
| --- | --- |
| 怪物强度/掉率/经验等数值 | `lib/monster-balance.mjs`、`lib/loot.mjs`、`lib/player-experience.mjs` |
| 某功能不对（技能/商店/装备/宠物/副本） | `lib/` 下同名模块，看名字找 |
| 协议收发、登录、选角 | `server.mjs`（一长串 `if(type===xxx)`） |
| 入站协议顺序 | `lib/protocol-dispatch.mjs` 的 INBOUND_CHAIN（**22 段有序，不重排**） |
| HTTP 路由/静态文件白名单 | `lib/http-routes.mjs`（新增 `web/*.js|css` 必须进 `WEB_PATHS`） |
| **客户端**的界面、提示、计算 | `lib/client-*-patch.mjs` + 挂进 `client-patch-chain.mjs` |
| 单机菜单/面板/按钮 | `web/offline.js`（逻辑）+ `web/index.html`（结构） |
| 技能/装备数值 | `data/local-skill-overrides.json`、`data/local-item-overrides.json`（**不要改 `data/*.json` 抓包原表**） |
| 存档格式/账号逻辑 | `lib/store.mjs`（改前备份存档） |
| 商店分类/NPC | `lib/supply-shops.mjs`、`lib/content.mjs` |

拿不准改哪个：VS Code 里 `Ctrl+Shift+F` 全目录搜关键词（「掉率」「强化」「宠物」「阵法」），大概率能搜到 `lib/` 里那个模块。

---

## 2. 环境与日常启动

### 启动入口

| 双击 | 端口 | 存档目录 | 存档名 | 用途 |
| --- | --- | --- | --- | --- |
| `启动单机-新存档.cmd` | 8775 | `saves/` | `xia-v05-qa` | 日常玩 |
| `继续测试角色.cmd` | 8776 | `test-saves/` | `acceptance` | 测试角色 |
| `体验原版内容.cmd` | 8776 | `test-saves/` | `original-v04` | 体验原版 |
| `体验侠客新手.cmd` | 8776 | `test-saves/` | `xia-v05` | 新手流程 |
| `停止单机.cmd` | — | — | — | 停掉 8775 和 8776 |

启动后浏览器打开 `http://127.0.0.1:8775/?save=xia-v05-qa`。
旧 QA 快照（物攻等 3 个角色）用 `powershell -File .\start.ps1 -Port 8779`（存档 `qa-v05-saves/`），停止用 `.\stop.ps1 -Port 8779`。端口与存档目录的对应写在 `launcher-common.ps1` 开头。

要求：Node.js **22.x**（20+ 可用）。APK 打包另需 JDK 21 + Android SDK + Gradle（工具链在 `E:\apk_pack_tool`，环境变量由 `安卓打包/环境.ps1` 设置，见第 7 节）。

### 改完怎么让它生效

| 改的是 | 生效方式 |
| --- | --- |
| `lib/`、`server.mjs`、`lib/client-*-patch.mjs` | `停止单机.cmd` → 重新 `启动单机-新存档.cmd` |
| `web/` 下的界面 | 浏览器 **Ctrl+F5 硬刷新**（offline.js 是客户端启动时加载的，F5 可能不够） |
| `data/` 下的 JSON | 浏览器刷新 |
| 存档 | 重启服务端时自动读盘 |

### 出问题了看哪里

- **服务端日志**：`世界online_原版单机/logs/session.jsonl`（8779 等入口在 `logs/` 下各自子目录）。每行一条 JSON，`"kind":"receive"` 是客户端发来的协议，`"kind":"send"` 是服务端回的，`"kind":"restoration-rejected"` 是被拒的请求和原因。
- **服务端没起来**：看启动窗口的报错；`logs/` 下的 `server-*.stderr.log`。
- **浏览器**：F12 控制台。⚠ 游戏启动后会接管 `console`，之后的 `console.log` 看不到；调试信息写进页面上的「单机菜单 → 诊断记录」，或用 `alert()`。

---

## 3. 标准改 BUG 流程（六步）

1. **复现并定位协议。** 在电脑版里操作出问题的那一步，打开 `logs/session.jsonl` 看最后几行的 `"type":xxxxx`。
2. **定位代码。** 在 `server.mjs` 搜 `type===xxxxx` 找到入口；如果它转手调了 `lib/` 里的函数，顺 import 找过去就是真正要改的地方。查客户端行为去 `analysis/modules/` 反编译产物里搜（道具 0032、宠物 0042、协议表 0019、玩家属性 0056），**不要凭推断**。
3. **判断改哪层**（第 4 节）：服务端 `lib/`？客户端补丁？`web/`？还是数据覆盖层？
4. **自检**（第 5 节）：`npm run check` → `npm test`。判定标准是**同一批改动前后新增失败为 0**；已知既有失败只有 `loot.test.mjs` 一个，与多数改动无关。
5. **电脑版验证**：重启服务端 + 硬刷新，按第 2 节的日志核对行为。
6. **要出 APK 再打包**（第 6 节）。打包、起服务、上机跑游戏由你自己验证；AI 协作时这条也成立（见附录）。

### 不用浏览器的排查办法（推荐）

很多「服务端对不对」的问题不必开游戏，写个小脚本直接复现协议。模板（存到工作区，**不要放进源码目录**）：

```js
// check-xxx.mjs —— 直接问服务端模块，复现某个协议的完整路径
import {Reader} from '<源码>/世界online_原版单机/lib/codec.mjs';
import {handleRestoration} from '<源码>/世界online_原版单机/lib/restoration-service.mjs';

const role={id:1,name:'复现',level:97,inventory:[],coins:0};   // 或 normalizeRole(存档里的角色)
const sent=[];
handleRestoration(12004,new Reader(Buffer.from([0x03,0x9a])),{role},   // short(922) 打开商店
  {store:{save(){}},send:(t,w)=>sent.push({t,bytes:w.done()}),log(){}});
console.log(sent.map(s=>s.t+':'+s.bytes.length+' 字节'));
```

两个真实用法：
- **商店打不开**（2026-10-24 的 922 案例）：脚本证明服务端回包完全正常，问题在客户端闸门，少走一轮弯路。
- **数值不对**（阵法加成）：`nativeCharacterBattleStats(角色)` 用客户端原生公式复算战斗面板，和游戏里显示的数字逐分比对。

---

## 4. 五类改动的标准做法

### 4.1 服务端逻辑 / 数值（`lib/`）

例：改怪物强度，`lib/monster-balance.mjs`：

```js
export const monsterBalance = { 1985: { hp: 10, stats: 1 } };  // 血量×10，其余×1
```

`hp` 只乘血量，`stats` 乘其它属性。文件里有上下限保护，改太大会抛 `Monster … hpMax exceeds native int`，看到就是改过头了。

### 4.2 协议层（`server.mjs` / `lib/protocol-dispatch.mjs`）

- `server.mjs` 里登录前的协议（版本检查、登录、选区）在最前面；业务协议走 `createInboundDispatcher` 的分派链。
- **INBOUND_CHAIN 22 段有序，不重排**；某个 service 拒绝时要返回 `false` 且**不许读字节**（读过要还原 `r.pos`）。
- 新增业务协议：在对应 `lib/*-service.mjs` 的 operations 集合里加号，写好处理分支；要弹给玩家看的错误，把协议号加进 `server.mjs` 的 `ERROR_NOTIFY_TYPES`（否则失败了客户端静默无反应——这正是「点了没反应」类 BUG 的常见来源）。

### 4.3 客户端补丁（`lib/client-*-patch.mjs`）

**场景**：要改客户端的表现或计算（伤害公式、界面分支、协议走向）。

**第一步**，抄一个同类补丁的格式，例：`lib/client-formation-book-patch.mjs`（第 92 版，让阵法书走 14012 而不是人物技能书 14007）：

```js
const FROM='i.type==y["default"].ITEM_TYPE_SKILL_BOOK?(E["default"].doUseLearnSkillItem';
const TO='i.type==y["default"].ITEM_TYPE_SKILL_BOOK&&y["default"].POWER_FORMATION_BOOK!=i.power1?(E["default"].doUseLearnSkillItem';
export function patchFormationBooks(source){
  const hits=source.split(FROM).length-1;
  if(hits===1)return source.replace(FROM,TO);
  if(hits===0&&source.includes(TO))return source;   // 已打过：幂等
  throw Error('v305 formation book patch mismatch: '+hits);
}
```

**第二步**，找 `from` 字符串：去 `analysis/gd.decoded.js` 或 `analysis/modules/` 里搜关键词（提示文字、属性名、函数名），把周边一小段**唯一**的代码抄下来。注意主包是压缩产物，`return"…"` 与 `return "…"` 两种写法都可能出现，正则要都容忍。

**第三步**，挂载：把补丁函数加进 `lib/client-patch-chain.mjs` 的 `CLIENT_MAIN_STEPS` 数组末尾（或语义上的合适位置）。**只此一处**——`server.mjs` 和 `standalone/build.mjs` 都 import 它。

**第四步**，同步测试：`tests/client-patch-chain.test.mjs` 按名字钉死顺序、断言补丁后主包字符数（当前 4,568,770）和幂等。改了补丁内容要同步那里的期望值。

### 4.4 界面与白名单（`web/`）—— 最容易漏的一层

`web/offline.js` 是电脑版和 APK 共用的客户端补顶层。改它有**三张名单**要守：

| 名单 | 位置 | 规则 |
| --- | --- | --- |
| `WEB_PATHS` | `lib/http-routes.mjs` | 新增 `web/*.js` / `web/*.css` 必须加进去，否则电脑版 404 |
| `localShops` | `web/offline.js` | 新增商店号必须加进去（详见下方案例） |
| `removedButtons` | `web/offline.js` | 要隐藏单机菜单按钮必须进这个名单；删按钮时同步删每秒刷新名单里的 id |

其它注意：电脑版 CSP 是 `script-src 'self' 'unsafe-eval'`，**内联 `<script>` 会被拦掉**，页面逻辑放外部 JS 用相对路径。

### 4.5 数据（`data/` 只读 + 覆盖层）

- `data/*.json` 是抓包产物，**一字节不改**（`.gitattributes` 已标 `-text`，也不要跑 `git add --renormalize`）。
- 改技能/装备用覆盖层：`data/local-skill-overrides.json`（`lib/local-skill-overrides.mjs`，支持 perLevel）、`data/local-item-overrides.json`（`lib/item-overrides.mjs`，必须用 `equipmentBytes` 重写 `definitionBase64`）。
- 改完用双击即用的 `技能编辑器.html` / `装备编辑器.html` 校验；改了编辑器内嵌资料要重跑 `node tools/build-skill-editor-data.mjs` 和 `node tools/build-item-editor-data.mjs`（**两个都要跑**）。

---

## 5. 测试与自检

```bash
cd 世界online_原版单机
npm run check    # 语法检查（357 个文件）
npm test         # 回归测试（pretest 先跑语法基线；718 用例）
node --test tests/xxx.test.mjs   # 只跑某一个
```

- 判定标准：**同一批改动前后新增失败为 0**，不比较不同机器的通过绝对数。
- 已知既有失败：`loot.test.mjs`（本地覆盖把 747 圣诞衣服 grade 改成 4，超过该档 maxGrade 3）。
- 依赖 `analysis/` 的测试在缺少反编译产物时会自动跳过（30 个左右），正常。
- 仓库根目录的 `运行基础自检.cmd` 一条龙：环境 + 存档/覆盖 JSON + 语法 + 26 个核心用例。改完想快速体检就跑它。

**改完补丁/白名单/协议，顺手加或改测试**：本项目几乎所有坑都有对应用例（`tests/` 按功能命名），这是「下次不改坏」的唯一保障。

---

## 6. 出 APK

推荐入口（自动设好环境变量、自动清 `cap sync` 拦截）：

```bat
cd 安卓打包
一键打包.bat
```

参数：`release`（签名版）、`fresh`（全量重建，首次或改了 appId 时用）、`noopen`（完事不开目录）、`nopause`（不停窗）。之后增量构建不要加 `fresh`，快很多。

手动两条命令（等价）：

```powershell
cd 安卓打包\standalone
node build.mjs                                  # 1~2 秒：平铺 client、打补丁、打 standalone 包
cd ..
powershell -ExecutionPolicy Bypass -File .\构建APK.ps1      # 5~15 分钟
```

产物：

```text
安卓打包\app\android\app\build\outputs\apk\debug\app-debug.apk   # 原始产物
安卓打包\output\worldol-<时间戳>.apk                              # 一键打包的成品（只留最近 5 个）
```

- 装手机：`adb install -r "<apk路径>"`，或拷进手机点安装（允许未知来源）。
- **本地预览 APK 版效果**（不装手机）：`cd 安卓打包 && node 工具\静态服务器.mjs app\www 18800`，浏览器开 `http://127.0.0.1:18800/`。
- ⚠ **改了 `lib/`/`web/` 却忘了 `node build.mjs`，是「电脑版有效、APK 没变」的唯一原因**——`构建APK.ps1` 只把 `app/www` 打进 APK，不读源码。
- **APK 存档在 WebView 的 localStorage**（键前缀 `worldol-fs:`），和电脑版 `world.json` 格式完全一样，用游戏里的「存档」按钮导出/导入即可互道。覆盖安装不清 WebView 缓存（有构建指纹自愈），**绝不清 localStorage**。

---

## 7. 环境、编码与红线

**编码红线**（用编辑器改完务必确认）：

| 文件 | 要求 |
| --- | --- |
| `.bat` | **GBK(936) + CRLF**；路径里别用 `>` |
| `.ps1` | **UTF-8 with BOM** |
| `.java` / `.gradle` / `.properties` | **不能带 BOM**（否则编译报 `Unexpected character: '\uFEFF'`） |
| `data/**` | `-text`（二进制对待），不做行尾 normalize |

**打包工具链**：`E:\apk_pack_tool`（`jdk-21` / `android-sdk` / `gradle-home`），`JAVA_HOME`、`ANDROID_HOME`、`GRADLE_USER_HOME` 都指向这里；`环境.ps1` 由 `安装环境.ps1` 生成，改路径要连默认值一起改。

**命令环境**：优先 WSL/bash；PowerShell 只在 WSL 不适用时用（GBK 输出、bat/ps1 自检）。跑构建前同进程设 `CODEBUDDY_SAFE_DELETE_ENABLED=0`（`一键打包.bat` 已自带）。

**删除大目录**：超长路径用 `robocopy <空目录> <目标> /MIR` 清空后再 `rd /s /q`；Gradle 中间产物用 `安卓打包/清理回收站.bat`。

---

## 8. 常见坑速查

- `x||1` 不能判断「是否为零」：`quantity=0` 会被吃成 1，用 `i.quantity!==0`。
- `INITIAL_*` 是初值不是上限；背包扩展走 `BAG_EXPAND_STEP`，上限 `MAX_BAG_CAPACITY=600`。
- `itemPacket` 在进入世界的整包链上，**宁可降级也绝不抛错**，否则整包发不出、玩家黑屏。
- 奖励表不要引用无定义道具：`planItemRewards` 会整包抛错；发奖前先确认道具有定义。
- 道具 `byte` 字段在 wire 上是有符号字节（校验范围放 -128..255）。
- 怪物 wire 名字是「3 字节长度 + UTF-16BE」，不是 `Reader.utf()`。
- 12016 这类在客户端 `resultMsg` 名单里的协议，回包必须以状态字节开头。
- APK 里 `fs.existsSync` 对 `data/**` 恒为 false，用 `try{readFileSync}catch{ENOENT}`。
- 战斗 12501/12502：`context.battle` 被拒要搬 `rejectedBattle` 并清空。
- 查询/快照接口必须走纯读函数，**不许改角色**。

---

## 9. 实战案例：阵法书商店打不开（2026-10-24，第 92 版）

**症状**：补给商人里点「阵法书」分类，毫无反应，商店打不开；服务端日志里连 12004 请求都没有。

**排查**：
1. 写脚本直接复现 12004（第 3 节模板）：服务端对 922 回包 3741 字节、对 919 回 70509 字节，全部正常 → 问题不在服务端。
2. 客户端没发请求 → 去看点击流程。`web/offline.js` 里 `World.doBrowseShop` 被离线层包了一层：白名单 `localShops` 里的店号走 `ShopItem.openItemShop`，**不在名单里的掉回原版 `doBrowseShop`，而原版整条链被 `go.openPay` 挡着**（离线版 `payDisabled=true`）——静默无反应。
3. 根因：第 92 版在服务端 `lib/supply-shops.mjs` 加了分类 922，但**忘了把 922 加进客户端的 `localShops` 白名单**。

**修复**：`web/offline.js` 的 `localShops` 加 `922`；`tests/beauty-salon-shops.test.mjs` 的白名单用例升级为不变量——`supplyShops` 每个店号 + 921 合并店 + 901/902/51/52/55/920 都必须在名单里。全量测试 718 用例新增失败 0。

**这个案例教三件事**：
1. 「服务端明明正常」+「客户端毫无反应」= 先去查客户端侧的闸门（白名单、开关、openPay），别死磕服务端；
2. 写脚本复现协议比开游戏试错快一个数量级；
3. 每加一类「号」（商店号、协议号、路由号），就问自己一句：**还有哪份名单要同步？**

---

## 10. 存档与回退（大改之前必看）

### 三种存档粒度（按场景选）

| 场景 | 做法 | 命令 |
| --- | --- | --- |
| 每次动大手术前留个还原点 | 提交 + 打 tag | `git add -A && git commit -m "说明" && git tag -a vXX-说明 -m "说明"` |
| 要连续改很久（比如战斗逻辑） | **开分支**，main 保持稳定 | `git checkout -b exp/战斗大改` |
| 改失败想整个丢掉 | 切回 main | `git checkout main` |

### 建议的工作流（战斗逻辑大改这种量级）

```bat
:: ① 动手之前：确认工作区干净，给当前版本打一个稳定 tag
git status                          :: 应该没有输出
git tag -a v93-stable -m "第 93 版稳定版"
git push origin main --follow-tags  :: 顺带备份到 GitHub（异地，不怕硬盘坏）

:: ② 开实验分支，所有大改都在这上面做（main 永远是可玩的稳定版）
git checkout -b exp/battle-overhaul

:: ③ 中途随便提交，改坏了也不影响 main
git add -A
git commit -m "wip: 多段动画第一步"

:: ④ 改满意了：合回 main
git checkout main
git merge exp/battle-overhaul

:: ⑤ 改失败了：回到稳定版（实验分支留着备查，想删就 git branch -D exp/battle-overhaul）
git checkout main
```

### 已经存好的版本

| tag | 内容 | 验证状态 |
| --- | --- | --- |
| `v93-stable` | 第 93 版：技能自定义特效 + 自动技能触发概率 + 技能随机目标 + 阵法系统 | 全量 759 用例 728 过（唯一失败是既有的 loot.test.mjs） |

回到这一版：

```bat
git checkout v93-stable                 :: 只想看看（分离 HEAD），看完 git checkout main 回来
git checkout -b 回到稳定版 v93-stable    :: 想在这个版本上继续改
git diff v93-stable --stat              :: 只看「从那以后都改了什么」
```

### 注意事项

- **`client/`、`analysis/`、`node_modules/`、`saves/`、`logs/`、APK 产物不在 git 里**（`.gitignore` 排除了）。
  换机器时这几样要单独拷；APK 产物在 `安卓打包/output/`，重要版本建议另存一份。
- **`data/` 是在 git 里的**（214 个文件，含 official-v305.json 等大表），所以技能/物品覆盖层、
  新增的 `local-*.json` 都会一起存档，不用另外备份。
- 提交前跑一遍 `npm run check && npm test`；提交信息写清「第 N 版 + 改了什么」，以后查历史方便。

### 出错速查（改坏了先看这里）

| 情况 | 怎么办 |
| --- | --- |
| 改完游戏起不来 | 改回去（VS Code `Ctrl+Z` / `文件 → 放弃更改`），或换上动手前的备份 |
| 补丁报 `xxx patch mismatch` | 锚点没匹配上：抄错了，或产线包换了。搜那段特征字符串核对 |
| `node build.mjs` 报错 | 看第一行，通常是某个 `replaceOnce` 锚点不匹配 |
| APK 构建失败 | 看 `安卓打包/build.log` 最后 30 行；先查 `JAVA_HOME`/`ANDROID_HOME`/`GRADLE_USER_HOME` 和 JDK 21 |
| 存档坏了 | 导入之前的备份；电脑版看 `backups/`；`saves/world.json.bak` 是最近一次自动备份 |
| 测试挂了 | `git diff` 看自己改了什么；拿不准就 `git stash` 回到干净状态再单跑 |

仓库是 git（分支 `main`），`git status` / `git diff` 随时能看清改了什么。提交前跑一遍 `npm run check && npm test`。

---

## 11. 速查表

```bat
:: ── 电脑版 ─────────────────────────────────────
双击 启动单机-新存档.cmd                :: 8775，存档 saves/，账号 xia-v05-qa
双击 继续测试角色.cmd                    :: 8776，存档 test-saves/
双击 停止单机.cmd                        :: 停 8775 + 8776
世界online_原版单机\logs\session.jsonl   :: 协议日志

:: ── 自检 ──────────────────────────────────────
cd 世界online_原版单机
npm run check                            :: 语法
npm test                                 :: 回归（新增失败为 0 才算过）
cd .. && 运行基础自检.cmd                :: 一条龙体检

:: ── 出 APK ────────────────────────────────────
cd 安卓打包 && 一键打包.bat              :: 推荐；可加 release/fresh/noopen/nopause
cd 安卓打包\standalone && node build.mjs :: 手动第一步（必跑！）
powershell -ExecutionPolicy Bypass -File ..\构建APK.ps1
:: 产物：安卓打包\app\android\app\build\outputs\apk\debug\app-debug.apk

:: ── 本地预览 APK 版 ───────────────────────────
cd 安卓打包 && node 工具\静态服务器.mjs app\www 18800

:: ── 存档 ──────────────────────────────────────
:: 电脑版：世界online_原版单机\saves\world.json
:: 手机版：游戏内「存档」按钮导出/导入，格式相同可互导
```

**APK 专用调试**（WebView 里不好开控制台，留了全局变量）：

```js
window.__worldolBootTimings                                            // 启动各阶段耗时
window.__worldolStandalone.readText('/worldol/logs/session.jsonl')    // 服务端日志
window.__worldolStandalone.missList()                                  // 没找到的文件
```

---

## 附：与 AI 协作时的约定（如果以后又用回 AI）

- AI 只负责改并讲清「改了什么、结论是什么」；**打包、起服务、上机跑游戏由你验证**。
- 单测/语法检查 AI 可以做，但只报结论；要用 E2E、装包、远程调试等额外手段前，让 AI 先跟你说一声。
- 公开仓库前先清理本机绝对路径、账号/邮箱等个人信息（当前文件与提交历史都要查）。

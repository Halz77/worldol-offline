# 世界OL 单机版 · WorldOL Offline

> 基于原版 H5 客户端 **v305** 的离线单机服务端复刻。  
> 用 Node.js 重新实现二进制协议，电脑版在运行时给客户端打补丁，APK 在构建期打补丁。  
> **非官方项目，仅供学习、研究使用，严禁进行商用或不法行为！**

---

## 项目状态

| 项目 | 说明 |
| --- | --- |
| 当前源码版本 | `0.6.4` |
| 客户端基线 | 原版 H5 客户端 `v305` |
| 电脑版入口 | `http://127.0.0.1:8775/` |
| Android 方案 | Capacitor + WebView standalone |
| 开发状态 | 持续维护中，改动记录见 `修复记录.txt` |
| 客户端与反编译产物 | **不在本仓库**，需自行准备 `client/` 与 `analysis/` |

> 本仓库只包含服务端源码、网页界面、数据表、测试和工具。  
> 原版客户端 `client/` 与反编译产物 `analysis/` 因体积和版权原因没有上传。

---

## 功能概览

- 离线登录、选角、存档、读档、角色导入/导出
- 地图、NPC、任务、对话、商店、传送
- 战斗、技能、宠物、装备、强化、镶嵌、鉴定、附魔、赋灵
- 城市、日常任务、活动、挑战副本、永泽塔、无限试炼、问剑十一峰、棋盘等
- 英雄图鉴（仅收集显示，**不提供属性加成**）
- 单机菜单、离线公告、存档管理
- 技能编辑器、装备编辑器、伤害计算器
- 本地资料覆盖层：
  - `data/local-skill-overrides.json`
  - `data/local-item-overrides.json`
- 电脑版与 APK 共用同一份客户端补丁源码
- 自带语法检查和回归测试

---

## 目录结构

```text
世界OL_源码/
├─ 世界online_原版单机/        # 源码主目录
│  ├─ server.mjs               # 服务端入口 + 协议分发
│  ├─ lib/                     # 游戏逻辑、协议、补丁、服务
│  ├─ web/                     # 单机菜单与网页界面
│  ├─ data/                    # 抓包数据与本地覆盖层
│  ├─ tests/                   # 回归测试
│  ├─ tools/                   # 构建、检查、编辑器数据生成工具
│  ├─ client/                  # 原版 H5 客户端（不入库，需自行放入）
│  └─ analysis/                # 反编译产物（不入库，需自行放入）
├─ 安卓打包/                    # standalone 构建 + APK 打包
├─ docs/                       # 开发日志与对比报告
├─ 运行基础自检.cmd             # 环境 + 存档/覆盖 JSON + 语法 + 核心用例
├─ 修复记录.txt                 # 面向玩家的逐版改动
├─ AGENTS.md                   # 面向开发者的长期约定
└─ 手动改BUG指南.md             # 不开 AI 也能照着做的操作手册
```

以下内容不会进入 Git：

```text
client/
analysis/
node_modules/
saves/
logs/
backups/
runtime/
安卓打包/app/www/
安卓打包/output/
```

仓库中保留了两份小型存档快照，用于测试和首次启动：

```text
世界online_原版单机/default-save/world.json
世界online_原版单机/qa-v05-saves/world.json
```

---

## 快速开始

### 1. 环境要求

- Windows 10/11，或 Linux / WSL2
- Node.js **22.x**（建议），20+ 可用
- npm
- 原版 H5 客户端 v305 的 `client/` 与 `analysis/`
- 打包 APK 额外需要：JDK 21、Android SDK、Gradle

### 2. 获取代码

```bash
git clone git@github.com:Halz77/worldol-offline.git
cd worldol-offline
```

如果使用 HTTPS：

```bash
git clone https://github.com/Halz77/worldol-offline.git
```

### 3. 放入客户端与反编译产物

把下面两个目录放到：

```text
世界online_原版单机/client/
世界online_原版单机/analysis/
```

必须包含：

```text
client/v/gd/305.json
analysis/gd.decoded.js
analysis/modules/
```

否则服务端会提示找不到 v305 原版资源，或客户端补丁无法生效。

### 4. 安装依赖

```bash
cd 世界online_原版单机
npm install
```

### 5. Windows 启动

双击：

```text
世界online_原版单机\启动单机-新存档.cmd
```

浏览器打开：

```text
http://127.0.0.1:8775/?save=xia-v05-qa
```

停止服务：

```text
世界online_原版单机\停止单机.cmd
```

### 6. Linux / WSL 启动

确认 `client/`、`analysis/` 已经在 `世界online_原版单机/` 下，然后：

```bash
cd 世界online_原版单机
node server.mjs
```

可选环境变量：

```bash
WORLDOL_PORT=8775 \
WORLDOL_SAVES="$PWD/saves" \
WORLDOL_RESOURCES="$PWD/client" \
node server.mjs
```

---

## 启动入口

| 入口 | 端口 | 存档目录 | 用途 |
| --- | --- | --- | --- |
| `启动单机-新存档.cmd` | 8775 | `saves/` | 日常游戏 |
| `继续测试角色.cmd` | 8776 | `test-saves/` | 测试角色 |
| `体验原版内容.cmd` | 8776 | `test-saves/` | 体验原版内容 |
| `start.ps1 -Port 8779` | 8779 | `qa-v05-saves/` | 旧 QA 快照 |

停止统一使用：

```text
停止单机.cmd
```

---

## 基础自检

在仓库根目录双击：

```text
运行基础自检.cmd
```

会依次检查：

1. Node.js 运行环境
2. 存档与本地覆盖 JSON
3. 语法检查
4. 26 个核心回归用例

也可以在源码目录手动运行：

```bash
cd 世界online_原版单机
npm run check
npm test
```

`npm test` 会先跑语法基线，再跑主测试。  
部分依赖 `analysis/` 的测试在缺少反编译产物时会自动跳过。

---

## 构建 Android APK

> 需要先准备 `client/`、`analysis/` 和 Android 工具链。  
> 详细说明见 `安卓打包/说明.md`。

```powershell
cd 安卓打包\standalone
node build.mjs

cd ..
powershell -ExecutionPolicy Bypass -File .\构建APK.ps1 -Fresh
```

首次构建使用 `-Fresh`，之后增量构建可以去掉 `-Fresh`。  
产物位置：

```text
安卓打包/app/android/app/build/outputs/apk/debug/app-debug.apk
```

也可以使用：

```text
安卓打包/一键打包.bat
```

支持参数：`release`、`fresh`、`noopen`、`nopause`。

---

## 开发约定

### `lib/` 是唯一一份源码

电脑版和 APK 都从 `lib/` 取逻辑和客户端补丁，所以只改一遍。

### 不要直接修改客户端主包

不要直接改：

```text
client/js/ff/fff570bb4753f056432680e781d827dc.js
```

这是压缩产线包，APK 构建时会被覆盖。客户端改动写在：

```text
lib/client-*-patch.mjs
```

新增补丁必须同时挂到：

1. `server.mjs`（电脑版运行时）
2. `安卓打包/standalone/build.mjs`（APK 构建期）

两边顺序必须一致，锚点不匹配要直接抛错。

### 不要直接改抓包数据

`data/*.json` 是抓包产物，尽量保持原样。  
需要改技能/装备时使用本地覆盖层：

```text
data/local-skill-overrides.json
data/local-item-overrides.json
```

### 新增网页资源要进白名单

新增 `web/*.js` 或 `web/*.css` 时，要同步加入：

```text
lib/http-routes.mjs 的 WEB_PATHS
```

否则电脑版会 404。

更多约定见：

- `AGENTS.md`
- `docs/memory/INDEX.md`
- `手动改BUG指南.md`

---

## 常用编辑器与工具

| 工具 | 用途 |
| --- | --- |
| `技能编辑器.html` | 修改技能等级与效果（写 `local-skill-overrides.json`）、作用范围可设「敌/我随机 N 个」、自动技能可设触发概率（写 `local-auto-skill-chance.json`） |
| `阵法编辑器.html` | 给每个阵的 5 个阵位和宠物分别配加成（叠加/替换两种模式），写入 `data/local-formation-slots.json` |
| `装备编辑器.html` | 修改装备属性，写入 `data/local-item-overrides.json` |
| 技能面板「效」按钮 | 游戏内换技能特效（181 个候选 + 随机模式 + 收藏清单），配置按角色存 localStorage |
| 单机菜单 → 伤害计算器 | 导入存档，模拟技能与木桩伤害 |
| `tools/check-syntax.mjs` | 语法检查 |
| `tools/check-data.mjs` | 存档与覆盖 JSON 检查 |
| `tools/run-tests.mjs` | 测试运行器 |
| `tools/verify-skill-fx-release.mjs` | 出包守门：校验站点内特效功能四件套齐全（对旧包必须 FAIL） |

修改编辑器内嵌资料后，需要重新生成对应数据：

```bash
node tools/build-skill-editor-data.mjs
node tools/build-item-editor-data.mjs
```

---

## 常见问题

### 启动提示找不到 v305 原版资源

确认以下文件存在：

```text
世界online_原版单机/client/v/gd/305.json
```

或通过环境变量指定资源目录：

```bash
WORLDOL_RESOURCES=/path/to/client node server.mjs
```

### 页面黑屏或提示协议超时

优先检查：

1. `client/` 是否完整
2. `analysis/gd.decoded.js` 是否存在
3. 客户端补丁锚点是否匹配
4. 服务端日志 `logs/session.jsonl` 是否有报错

### `npm test` 有测试跳过

依赖 `analysis/modules/` 的测试在缺少反编译产物时会跳过。  
需要完整测试时，把 `analysis/` 放回源码目录。

### APK 构建失败

检查：

- `JAVA_HOME`
- `ANDROID_HOME`
- `GRADLE_USER_HOME`
- JDK 21 是否可用

具体见 `安卓打包/说明.md` 和 `安卓打包/环境.ps1`。

---

## 数据与版权说明

- 本仓库**不包含**原版客户端、客户端资源、反编译产物或商业服务端。
- `client/`、`analysis/` 需要使用者自行合法取得，并自行承担相关版权责任。
- 游戏名称、客户端、素材、商标归原权利人所有。
- 本项目与原作者、发行方、运营方无隶属关系。
- 本项目不提供官方服务器，不提供联网服务，不建议用于商业用途。
- 修改存档前请先备份；使用本项目造成的任何损失由使用者自行承担。

---

## 贡献

欢迎提交 Issue 和 Pull Request。

提交前建议：

```bash
cd 世界online_原版单机
npm run check
npm test
```

请不要提交：

- `client/`
- `analysis/`
- `node_modules/`
- `saves/`、`logs/`、`backups/`
- APK 构建产物
- 个人路径、账号、邮箱、Token

客户端改动请写成 `lib/client-*-patch.mjs`，不要直接改 `client/`。

---

## 相关文档

- `先看这里.md` — 压缩包/日常使用入口
- `修复记录.txt` — 面向玩家的逐版改动
- `手动改BUG指南.md` — 改 bug、跑电脑版、重新打包 APK
- `安卓打包/说明.md` — APK 构建细节
- `AGENTS.md` — 开发者长期约定
- `docs/memory/INDEX.md` — 开发日志索引

---

## 版权与许可

本仓库的原创代码目前**未声明开源许可证**；在添加 `LICENSE` 之前，默认保留所有权利。

原版客户端、游戏素材、商标及相关内容不适用本仓库代码，其版权归原权利人所有。

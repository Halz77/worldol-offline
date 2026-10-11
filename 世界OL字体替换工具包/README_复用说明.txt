================================================================
世界OL 原始战斗字体替换 —— 完整工具包（可直接复用于其它 APK）
================================================================

本包包含把战斗飘字（伤害/暴击/HP回复/MP回复）替换为原始像素数字
所需的一切素材与脚本。当前参数：NSC=2（大字）、暴击爆炸图位于数字
左侧并压住首位（重叠 30 个原始像素，对应你手动改的值）。

────────────────────────────────────────────────────────────
一、目录结构
────────────────────────────────────────────────────────────
字体图_原始/           donor 原图（四套数字 0-9 + 暴击爆炸 + 说明/坐标）
                       ├ 未暴击伤害/ HP回复/ MP回复/ 暴击伤害/  各 0-9.png
                       ├ 暴击爆炸效果-透明原图.png
                       ├ 资源来源与坐标.json  (每张图的 x/y/w/h 帧坐标)
                       └ 说明.txt
字体图_引擎hash版/      引擎寻址用的 41 张 png（已按 hash 前两位分目录）
                       client/assets/<hh>/<hash>.png  ← 直接合并进目标 APK
                       manifest_num.json  ← 逻辑名→16位hash 映射
渲染模块_module180.js    改好的战斗数字渲染模块（含位图拼接+文字兜底）
清单片段_num段.json      要并入资源清单 305.json 的 "num" 段（即上面的映射）
签名_testkey/           AOSP 公开测试签名（testkey.pk8 / .x509.pem）
                       用于让新包与原包签名一致、可覆盖安装
脚本/                   rebuild.py（整包重建） / slim.py（精简+改manifest）

────────────────────────────────────────────────────────────
二、复用到「另一个 APK」的标准流程
────────────────────────────────────────────────────────────
前提：目标 APK 也是 Node.js/Egret 混合包，战斗数字是 egret.TextField
      用 Arial 画的（结构同世界OL）。其它引擎/渲染方式需自行适配。

1. 取素材：直接用「字体图_引擎hash版/client/assets/」这 41 张 png，
   合并覆盖进目标 APK 的 client/assets/ （同名即覆盖，hash 不会冲突）。

2. 注入清单：把「清单片段_num段.json」里的 num 段，并入目标 APK 的
   assets/nodejs-project/client/v/gd/305.json 的 url.assets 下
   （用 MT/NP 管理器打开 305.json 文本，在 "assets":{"...现有段..."}
    里加一行 "num":{...} 即可；或用 脚本/rebuild.py 自动做）。

3. 替换渲染模块：找到目标 APK 里负责战斗数字的模块（世界OL 是
   assets/nodejs-project/client/js/ff/fff570bb4753f056432680e781d827dc.js
   内的 0180 模块），用本包「渲染模块_module180.js」替换对应逻辑。
   ⚠ 模块名/编号各游戏不同，需 grep 关键词定位：
      egret.TextField、fontFamily="Arial"、BATTLE_DMG、textWidth、
      strokeColor 等。替换后保持对外接口 text / textWidth / textHeight。

4. 签名：用「签名_testkey」里的 testkey 重新签名（见下方）。
   若目标 APK 原本不是 testkey 签的，换用目标 APK 自己的签名文件；
   或改用 MT 管理器「签名」用自己的默认密钥，再卸载旧版重装。

────────────────────────────────────────────────────────────
三、用本包脚本重建+签名（整包，适合电脑端）
────────────────────────────────────────────────────────────
依赖：Python3、Android build-tools（apksigner/zipalign）、JDK。
  1) 改 脚本/rebuild.py 顶部的 SRC 指向你的源 APK，NEWJS 指向本包
     渲染模块_module180.js，其余路径保持。
  2) python3 脚本/rebuild.py          → 生成 unaligned.apk
  3) zipalign -f -p 4 unaligned.apk aligned.apk
  4) apksigner sign --key 签名_testkey/testkey.pk8 \
        --cert 签名_testkey/testkey.x509.pem \
        --v1-signing-enabled false --v2-signing-enabled true \
        --v3-signing-enabled true --out signed.apk aligned.apk

────────────────────────────────────────────────────────────
四、调参速查（改 渲染模块_module180.js 顶部）
────────────────────────────────────────────────────────────
NSC           整体缩放（1=原图大小，2=大字版，想再大就 2.5）
NBASE="assets/num/"   字形图目录（默认 assets/num/，引擎 hash 寻址下
              实际落在 assets/nodejs-project/client/assets/<hh>/）
NMAP          数字类型→字形集（2000未暴击/2001HP/2002MP/2003暴击…）
NW            各数字宽度表（决定字间距，单位原始像素）
NH            各字形集高度（2000/2001/2002=13，2003暴击=18）
NBOW/NBOH     爆炸图宽/高（54/56）
爆炸定位行：  f.x=-NBOW*NSC+30*NSC   ← 把 30 调大=向右移、重叠更多
              f.y=(this._h-NBOH*NSC)/2 ← 上下居中；减个小数=上移
想整包直接给你改好，把目标值告诉我即可。

────────────────────────────────────────────────────────────
五、完整性
────────────────────────────────────────────────────────────
字体图_原始/ 与 字体图_引擎hash版/ 的 41 张图内容一致（hash 命名版
由原始图按 manifest_num.json 重命名得到，此前逐项 SHA256 校验通过）。

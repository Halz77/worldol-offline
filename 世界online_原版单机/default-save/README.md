# 随包默认存档

这里是打包进 APK 的**默认存档**，每次构建由
`安卓打包/standalone/build.mjs` 拷成站点里的 `initial-save.json`。

## 换一份默认存档

把新的存档覆盖到 `world.json` 即可，然后重新构建：

```
node 安卓打包/standalone/build.mjs
安卓打包/构建APK.ps1
```

存档可以从手机「单机菜单 → 导出存档」得到（导出到「下载」目录），
也可以用电脑上 8775 端口服务里的 `saves/world.json`。

## 注意

- 这里**不是** QA 存档。QA 那份在 `qa-v05-saves/world.json`，
  被 `tests/loot.test.mjs`、`tests/career-skills.test.mjs` 按角色 id=1001 断言引用，
  不能随便替换，否则既有用例会失败。
- 文件用紧凑 JSON（和服务端 `store.mjs` 写盘格式一致），改起来不好读。
  想看排版过的版本，随手 `python -m json.tool` 或直接让玩家在 App 里导出。
- 手机上有存档时这份不会被用到：`boot.js` 的 `seedInitialSave()` 只在
  localStorage 里没有存档时才播种。想让已装的人也换成这份，需要清应用数据。

/*
 * standalone 启动脚本（构建期拷成 client/standalone-boot.js）
 *
 * 流程：加载运行时 → 预载只读文件 → 合并模块表 → start() → 起 gd.js
 * 全程显示进度，避免手机上看不出是在干活还是卡死。
 */
(function () {
  'use strict';

  var state = { step: '初始化', loaded: 0, total: 0 };

  // 启动完成后就永不再弹这个浮动提示。
  // 否则收尾时 report('独立核心已就绪') 会把刚删掉的层又建出来，
  // 而它是 position:fixed + z-index:9999，会一直盖在游戏画面中间。
  var finished = false;

  function statusBox() {
    var box = document.getElementById('standalone-loading');
    if (!box) {
      if (finished) return null;
      box = document.createElement('div');
      box.id = 'standalone-loading';
      box.style.cssText = 'position:fixed;left:50%;top:44%;transform:translate(-50%,-50%);' +
        'font:14px/1.9 system-ui,"Microsoft YaHei",sans-serif;color:#ddd;text-align:center;z-index:9999;max-width:76vw;';
      document.body.appendChild(box);
    }
    return box;
  }

  function report(text) {
    state.step = text;
    var box = statusBox();
    if (box) box.textContent = text;
    var log = document.getElementById('offline-status');
    if (log) log.textContent = text;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var element = document.createElement('script');
      element.src = src;
      element.onload = function () { resolve(); };
      element.onerror = function () { reject(new Error('脚本加载失败：' + src)); };
      document.body.appendChild(element);
    });
  }

  async function preload() {
    var response = await fetch('standalone-files.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('standalone-files.json 不可用');
    var manifest = await response.json();
    var entries = manifest.entries || [];
    state.total = entries.length;

    var origin = location.origin;
    var BATCH = 8;
    for (var i = 0; i < entries.length; i += BATCH) {
      var slice = entries.slice(i, i + BATCH);
      await Promise.all(slice.map(async function (entry) {
        try {
          var url = origin + entry.url;
          var text = await fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : null; });
          if (text !== null) window.__worldolStandalone.putText(entry.vfs, text);
        } catch (error) { /* 单文件失败不影响整体 */ }
      }));
      state.loaded = Math.min(i + BATCH, entries.length);
      report('正在载入游戏数据 ' + state.loaded + ' / ' + entries.length);
    }
  }

  /**
   * 刷新被 WebView 缓存住的旧资源。
   *
   * 覆盖安装不会清 App 私有数据，WebView 的 HTTP 缓存也就留着上一版的内容。
   * 资源清单（/v/gd/305.json）和主包 js 的 URL 是客户端写死的、没法加版本号，
   * 命中旧缓存就会「补丁打进去了，界面还是老样子」。这里在发现构建指纹变了时，
   * 用 cache:'reload' 重新取一次并写回缓存，客户端随后拿到的就是新版。
   *
   * 只在指纹变化的这一次启动里做，日常启动不额外付代价。
   */
  // 两个常量由 build.mjs 在拷贝站点文件时替换；没替换（桌面端直接引用）就整体跳过。
  var BUILD_ID = '__WORLDOL_BUILD_ID__';
  var MAIN_JS = '__WORLDOL_MAIN_JS__';

  function placeholder(text) { return !text || text.charAt(0) === '_'; }

  async function primeChangedAssets() {
    if (placeholder(BUILD_ID) || placeholder(MAIN_JS)) return;
    var changed = true;
    try { changed = localStorage.getItem('worldol-build') !== BUILD_ID; } catch (error) { /* 读不到就当变了 */ }
    if (!changed) return;
    // 注意：不能清 localStorage —— 单机存档就在里面（key 前缀 worldol-fs:）。
    report('正在刷新客户端资源…');
    var targets = ['/v/gd/305.json', '/' + MAIN_JS];
    for (var i = 0; i < targets.length; i++) {
      try {
        var response = await fetch(targets[i], { cache: 'reload' });
        await response.text();
      } catch (error) { /* 这一条刷不动还有原生层兜底 */ }
    }
    try { localStorage.setItem('worldol-build', BUILD_ID); } catch (error) { /* 下次会再刷一次，无害 */ }
  }

  async function loadModules() {
    report('正在载入协议模块…');
    var response = await fetch('analysis/modules-bundle.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('modules-bundle.json 不可用');
    var map = await response.json();
    var ids = Object.keys(map);
    for (var i = 0; i < ids.length; i++) window.__worldolStandalone.putModule(ids[i], map[ids[i]]);
    report('协议模块 ' + ids.length + ' 个已就绪');
  }

  async function seedInitialSave() {
    // 首次运行：把随包附带的存档放进可写层。
    //
    // 顺序很关键：必须先把 localStorage 里的存档读回可写层。
    // restoreSaves() 原本只在 start() 里调，而 start() 在 seedInitialSave() 之后，
    // 于是这里的“有没有存档”永远问不出结果 —— exportSave() 恒为 null，
    // 随包存档每次启动都盖回去，表现为「每次进游戏都是新存档」。
    try { window.__worldolStandalone.restoreSaves(); } catch (error) { /* 忽略 */ }
    try {
      if (window.__worldolStandalone.exportSave()) return;   // 已有存档，不覆盖
      var response = await fetch('initial-save.json', { cache: 'no-store' });
      if (!response.ok) return;
      var text = await response.text();
      window.__worldolStandalone.importSave(text);
    } catch (error) { /* 没有初始存档就跳过 */ }
  }

  // —— 导出存档 ——

  // 手机原生侧（MainActivity 的 WorldolExport）把文本写成真实文件。
  // 返回 "OK|位置" 或 "ERR|原因"，桥不存在时返回 null。
  function saveViaNativeFile(name, text) {
    var bridge = window.WorldolExport;
    if (!bridge || typeof bridge.save !== 'function') return null;
    try { return String(bridge.save(name, text)); } catch (error) { return 'ERR|' + error; }
  }

  // 没有原生桥时（手机浏览器 / 电脑上直接开 www/index.html）走浏览器下载。
  // 文件落在浏览器的「下载」目录，这里把名字回给调用方，好让提示写清位置。
  function saveViaBrowserDownload(name, text) {
    if (typeof Blob !== 'function' || typeof URL === 'undefined' || !URL.createObjectURL) return null;
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    try { a.click(); } catch (error) {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
      return null;
    }
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
    return 'OK|浏览器的下载目录（文件管理器 / 下载）';
  }

  // 兜底：原生桥不可用时，把存档原文摆进弹窗让用户复制
  // （复制走系统剪贴板，不依赖下载能力）。
  var dumpStyleReady = false;
  function ensureDumpStyle() {
    if (dumpStyleReady || document.getElementById('save-dump-style')) return;
    var css = document.createElement('style');
    css.id = 'save-dump-style';
    css.textContent = [
      '#save-dump-overlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483003;background:#000c;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;touch-action:manipulation}',
      '#save-dump-card{box-sizing:border-box;width:min(560px,96vw);max-height:92vh;display:flex;flex-direction:column;background:#22262e;color:#e8eef6;border:1px solid #5a6b7d;border-radius:12px;padding:14px;font:14px/1.6 "Microsoft YaHei",system-ui,sans-serif;box-shadow:0 18px 60px #000c}',
      '#save-dump-card h3{margin:0 0 6px;font-size:16px}',
      '#save-dump-card .save-dump-info{margin:0 0 10px;color:#9fb6cc;font-size:12.5px}',
      '#save-dump-text{flex:1;min-height:160px;width:100%;box-sizing:border-box;background:#14171c;color:#cfe3f5;border:1px solid #3b4654;border-radius:8px;padding:8px;font:12px/1.5 Consolas,Menlo,monospace;white-space:pre;overflow:auto;-webkit-user-select:text;user-select:text}',
      '#save-dump-card .save-dump-hint{margin:8px 0 0;color:#8fb8d8;font-size:12px}',
      '#save-dump-card .save-dump-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}',
      '#save-dump-card .save-dump-row button{flex:1 1 110px;padding:11px 8px;border:0;border-radius:8px;background:#3a4654;color:#e8eef6;font:inherit;cursor:pointer}',
      '#save-dump-card .save-dump-copy{background:#2b6a45}'
    ].join('');
    document.head.appendChild(css);
    dumpStyleReady = true;
  }

  function openDumpDialog(name, text, say) {
    ensureDumpStyle();
    var old = document.getElementById('save-dump-overlay');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var overlay = document.createElement('div');
    overlay.id = 'save-dump-overlay';
    var card = document.createElement('div');
    card.id = 'save-dump-card';
    var title = document.createElement('h3');
    title.textContent = '导出存档（复制方式）';
    var info = document.createElement('p');
    info.className = 'save-dump-info';
    info.textContent = '文件名 ' + name + ' · ' + Math.ceil(text.length / 1024) + ' KB';
    var area = document.createElement('textarea');
    area.id = 'save-dump-text';
    area.readOnly = true;
    area.spellcheck = false;
    area.value = text;
    var hint = document.createElement('p');
    hint.className = 'save-dump-hint';
    hint.textContent = '点「复制全部」，粘贴到微信/QQ 的「文件传输助手」或存成 .json 即可。';

    var row = document.createElement('div');
    row.className = 'save-dump-row';
    var copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'save-dump-copy';
    copyButton.textContent = '复制全部';
    var selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.textContent = '全选';
    var closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '关闭';

    copyButton.onclick = function () {
      function legacy() {
        var flag = false;
        try {
          area.focus();
          area.setSelectionRange(0, text.length);
          flag = document.execCommand('copy');
        } catch (error) { flag = false; }
        hint.textContent = flag ? '已复制到剪贴板，去粘贴吧。'
          : '复制被系统拦住了：请点「全选」，再长按文本框选「复制」。';
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          hint.textContent = '已复制到剪贴板，去粘贴吧。';
        }, legacy);
      } else legacy();
    };

    selectButton.onclick = function () {
      try {
        area.focus();
        area.setSelectionRange(0, text.length);
        hint.textContent = '已全选，长按文本框选「复制」即可。';
      } catch (error) { /* 忽略 */ }
    };

    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    closeButton.onclick = close;
    overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });

    row.appendChild(copyButton);
    row.appendChild(selectButton);
    row.appendChild(closeButton);
    card.appendChild(title);
    card.appendChild(info);
    card.appendChild(area);
    card.appendChild(hint);
    card.appendChild(row);
    overlay.appendChild(card);
    (document.body || document.documentElement).appendChild(overlay);
  }

  // 兜底：VFS 的可写层会把 /saves/* 镜像到 localStorage（base64 编码的 UTF-8）。
  var LS_PREFIX = 'worldol-fs:';
  function decodeBase64Utf8(text) {
    var bin = atob(text);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  function saveTextFromLocalStorage() {
    try {
      var main = localStorage.getItem(LS_PREFIX + '/saves/world.json');
      if (main) return decodeBase64Utf8(main);
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf(LS_PREFIX + '/saves/') !== 0) continue;
        if (key.slice(-4) === '.tmp') continue;
        var value = localStorage.getItem(key);
        if (value) return decodeBase64Utf8(value);
      }
    } catch (error) { /* 忽略 */ }
    return null;
  }

  /**
   * 存档管理：导出 / 导入 world.json。
   *
   * 只挂在 standalone 上。PC 直接跑 server.mjs 时存档就是 saves/ 目录里的文件，
   * 拷来拷去不需要 UI。
   *
   * 导入是最要紧的那个：随包初始存档是构建时从 qa-v05-saves/world.json 拷进去的，
   * 而且只在「本机没有存档」时用一次。之后想换存档（比如把电脑上玩到一半的进度
   * 搬到手机），就得靠这里导入。
   */
  function installSaveManager() {
    var api = window.__worldolStandalone;
    if (!api || document.getElementById('wsm-export')) return;

    // 两个按钮直接并进「单机菜单」的按钮组，不再单独做悬浮入口。
    var actions = document.querySelector('#offline-panel .actions');
    if (!actions) return;

    var exportButton = document.createElement('button');
    exportButton.id = 'wsm-export';
    exportButton.type = 'button';
    exportButton.textContent = '导出存档';

    var importButton = document.createElement('button');
    importButton.id = 'wsm-import';
    importButton.type = 'button';
    importButton.textContent = '导入存档';

    actions.appendChild(exportButton);
    actions.appendChild(importButton);

    var note = document.createElement('p');
    note.id = 'wsm-note';
    note.style.cssText = 'color:#8fb8d8;font-size:12px;line-height:1.6';
    note.textContent = '导出会把存档写成手机上的文件（安卓 10+ 在「下载」目录）；导入会覆盖本机当前存档并自动重载。';
    actions.parentNode.insertBefore(note, actions.nextSibling);

    // 菜单里的小字容易看漏，导出的结果再单独弹一个浮层，确保看清文件到底存到哪了。
    var toast = document.createElement('div');
    toast.id = 'wsm-toast';
    toast.style.cssText = 'position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:2147483005;'
      + 'max-width:min(600px,92vw);box-sizing:border-box;padding:12px 16px;border-radius:10px;'
      + 'background:#22262e;color:#e8eef6;border:1px solid #5a6b7d;'
      + 'font:13.5px/1.65 "Microsoft YaHei",system-ui,sans-serif;'
      + 'box-shadow:0 12px 40px #000c;white-space:pre-wrap;word-break:break-all;display:none;text-align:left;';
    (document.body || document.documentElement).appendChild(toast);
    var toastTimer = 0;
    function showToast(text) {
      toast.textContent = text;
      toast.style.display = 'block';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toast.style.display = 'none'; }, 9000);
    }

    var picker = document.createElement('input');
    picker.id = 'wsm-file';
    picker.type = 'file';
    picker.accept = '.json,application/json';
    picker.style.display = 'none';
    document.body.appendChild(picker);

    function say(text) { note.textContent = text; showToast(text); }

    document.getElementById('wsm-export').onclick = function () {
      var text = api.exportSave();
      var source = '内存存档';
      if (!text) { text = saveTextFromLocalStorage(); source = 'localStorage 镜像'; }
      if (!text) { say('本机还没有存档。'); return; }
      var stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      var name = 'world-' + stamp + '.json';
      var size = Math.round(text.length / 1024) + ' KB';

      // 主路径：交给原生写成手机上的真实文件（长 JSON 不适合复制粘贴）。
      var result = saveViaNativeFile(name, text);
      if (result && result.indexOf('OK|') === 0) {
        say('已导出存档到 ' + result.slice(3) + '\n文件：' + name + '（' + size + '，来源：' + source + '）');
        return;
      }
      // 没有原生桥时（浏览器里跑），用浏览器下载，同样能拿到真实文件。
      var downloaded = saveViaBrowserDownload(name, text);
      if (downloaded && downloaded.indexOf('OK|') === 0) {
        say('已导出存档到 ' + downloaded.slice(3) + '\n文件：' + name + '（' + size + '，来源：' + source + '）');
        return;
      }
      say((result ? '保存文件失败（' + result.slice(4) + '），' : '当前环境不能直接写文件，')
        + '改用复制方式：文件不会自动落盘，需要自己粘贴保存。');
      setTimeout(function () { openDumpDialog(name, text, say); }, 0);
    };

    document.getElementById('wsm-import').onclick = function () { picker.click(); };

    picker.onchange = function () {
      var picked = picker.files && picker.files[0];
      if (!picked) return;
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result);
        var parsed;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          say('这不是有效的 JSON 文件。');
          picker.value = '';
          return;
        }
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.characters)) {
          say('这个文件不像世界OL 存档（缺少 characters 字段）。');
          picker.value = '';
          return;
        }
        try {
          api.importSave(text);
          say('已导入 ' + parsed.characters.length + ' 个角色，正在重新载入…');
          setTimeout(function () { location.reload(); }, 600);
        } catch (error) {
          say('导入失败：' + (error && error.message ? error.message : error));
          picker.value = '';
        }
      };
      reader.onerror = function () { say('读取文件失败。'); picker.value = ''; };
      reader.readAsText(picked);
    };
  }

  // 分段计时。手机上没法开控制台，结果挂到 window.__worldolBootTimings 和
  // 页面上的日志框里，方便现场看“到底卡在哪一段”。
  var timings = {};
  var bootStart = performance.now();
  function mark(name, from) {
    timings[name] = Math.round(performance.now() - from) + ' ms';
  }

  async function main() {
    report('正在加载独立运行核心…');
    var t = performance.now();
    await loadScript('worldol-standalone.js');
    if (!window.__worldolStandalone) throw new Error('运行核心未就绪');
    mark('运行核心', t);

    t = performance.now(); await primeChangedAssets(); mark('资源刷新', t);
    t = performance.now(); await preload();       mark('预载资源', t);
    t = performance.now(); await loadModules();   mark('协议模块', t);
    t = performance.now(); await seedInitialSave(); mark('初始存档', t);

    report('正在启动本地服务…');
    t = performance.now(); await window.__worldolStandalone.start(); mark('服务端启动', t);

    // 运行时就绪后才启动游戏客户端。
    // 必须在此刻才加载 /gd.js：早于 shim 安装就会用原生 WebSocket 去连正式服。
    report('正在启动游戏引擎…');
    t = performance.now(); await loadScript('gd.js'); mark('客户端脚本', t);

    timings['首屏合计'] = Math.round(performance.now() - bootStart) + ' ms';
    window.__worldolBootTimings = timings;

    // 先封掉浮动层（finished 置位后 report 不会再创建它），再清掉可能还存在的那个。
    finished = true;
    report('独立核心已就绪');
    var box = document.getElementById('standalone-loading');
    if (box && box.parentNode) box.parentNode.removeChild(box);

    installSaveManager();
  }

  main().catch(function (error) {
    console.error('[worldol-standalone] 启动失败', error);
    report('启动失败：' + (error && error.message ? error.message : error));
  });
})();

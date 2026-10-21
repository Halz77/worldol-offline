/*
 * standalone 打包构建
 *
 *   node build.mjs
 *
 * 做四件事：
 *   1. 构建期就把 server.mjs 的「客户端补丁链」应用掉，产出打过补丁的
 *      client/gd.js 与 client/js/ff/<main>.js（运行时没有 HTTP，不能再动态打补丁）
 *   2. 把 analysis/modules/*.js 合成一个 JSON（1613 个文件，逐个 fetch 太慢）
 *   3. 生成 standalone-files.json（需要预载进内存的只读文件清单）
 *   4. 用 esbuild 把 entry.mjs + server.mjs + lib/ 打成单文件 worldol-standalone.js
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// 客户端补丁链与 server.mjs 共用同一模块。顺序只在
// lib/client-patch-chain.mjs 里定义一次，这里不再重复排列补丁函数。
import { patchClientBoot, patchClientMain, replaceOnce, CLIENT_MAIN_PATH } from '../../世界online_原版单机/lib/client-patch-chain.mjs';
import { nativeResourceManifest } from '../../世界online_原版单机/lib/native-ui-restoration.mjs';

// 字体补丁在运行时用 fs 读同目录的这三个文件（见 client-battle-font-patch.mjs）。
// standalone 下 fs 走 VFS，缺文件就是 ENOENT 抛错，所以必须一起发布并预载。
const FONT_PATCH_FILES = [
  'client-battle-font-module180.orig.js',
  'client-battle-font-module180.js',
  'client-battle-font-manifest.json'
];

const here = path.dirname(fileURLToPath(import.meta.url));
const packRoot = path.resolve(here, '..');                       // 安卓打包
const gameRoot = path.resolve(packRoot, '..', '世界online_原版单机');
const outRoot = path.join(packRoot, 'app', 'www');     // 站点根 = 打包输出

const MAIN_PATH = CLIENT_MAIN_PATH;

function log(message) { console.log('[build] ' + message); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function write(target, content) {
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, content);
}

// --- 1. 构建期打客户端补丁 ------------------------------------------------
// 注意站点布局：Node 版把 client/ 的内容映射到站点根（/assets、/js、/v/gd…），
// 所以 standalone 的 www 根就是 client 的内容，web/*.js 也平铺在根上。
// replaceOnce() 由 client-patch-chain 提供，这里不再本地定义。

// 必须在 layoutSite() 之后调用：layoutSite 用 fs.cpSync 把 client/ 全量平铺到站点根，
// 会把这里写出的 gd.js 和打过补丁的主包一起覆盖回原始版本。
function buildPatchedClient() {
  // 1a. 引导脚本 gd.js（对应 server.mjs 里对 analysis/gd.decoded.js 的三处改写）
  // server.mjs L141: if(pathname==='/gd.js') return answer(res,200,mime['.js'],boot)
  // 也就是站点根的 /gd.js 必须是这份改写版，client/gd.js 只是它的压缩形式。
  const boot = patchClientBoot(fs.readFileSync(path.join(gameRoot, 'analysis/gd.decoded.js'), 'utf8'));
  write(path.join(outRoot, 'gd.js'), boot);

  // 1b. 主包：完整补丁链（与 server.mjs 共用 client-patch-chain.mjs）
  const original = fs.readFileSync(path.join(gameRoot, 'client', MAIN_PATH), 'utf8');
  const main = patchClientMain(original);
  write(path.join(outRoot, MAIN_PATH), main);
  log(`客户端补丁已应用：gd.js ${boot.length} 字节，主包 ${original.length} → ${main.length} 字节`);
}

/**
 * 字体补丁的配套文件（0180 模块原文/替换文 + 字形映射表）。
 *
 * server.mjs 在 standalone 里启动时会读主包（此时已经是打过补丁的版本，会直接跳过
 * 重打），但 patchBattleFont() 仍然要 fs.readFileSync 这三个文件。VFS 把
 * /worldol/lib/xxx 映射到站点 /lib/xxx，所以拷到站点根的 lib/ 下即可命中。
 */
function layoutFontPatchAssets() {
  const libSource = path.join(gameRoot, 'lib');
  for (const name of FONT_PATCH_FILES) {
    const from = path.join(libSource, name);
    if (!fs.existsSync(from)) throw new Error('字体补丁文件缺失：' + from);
    write(path.join(outRoot, 'lib', name), fs.readFileSync(from));
  }
  log(`字体补丁配套文件已就位（${FONT_PATCH_FILES.length} 个）`);
}

/**
 * 逐层复制目录。
 *
 * 为什么不用 fs.cpSync 一把梭：在个别卷（网络盘 / 加密盘 / 虚拟盘）上，cpSync 复制
 * data/ 这种「文件少但单个文件很大」的目录会直接把 node 进程打崩（Windows 上是
 * 0xC0000409，日志里只留下一句 exit 127，没有任何异常可捕获）。自己走一遍
 * readdir + copyFileSync 行为完全等价，而且在哪种卷上都稳。
 */
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}

/** 把 client/ 的内容平铺到站点根（跳过 index.html，那是 web/ 的入口） */
function layoutSite() {
  const source = path.join(gameRoot, 'client');
  let copied = 0;
  fs.cpSync(source, outRoot, {
    recursive: true,
    force: true,
    filter: (src) => {
      const base = path.basename(src);
      if (src === source) return true;
      if (path.dirname(src) === source && base === 'index.html') return false;
      copied++;
      return true;
    }
  });
  log(`client 内容已平铺到站点根（约 ${copied} 项）`);

  // web/ 的脚本也是从根路径加载的（/offline.js、/catalog.html…）
  const webSource = path.join(gameRoot, 'web');
  for (const entry of fs.readdirSync(webSource, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    fs.copyFileSync(path.join(webSource, entry.name), path.join(outRoot, entry.name));
  }
  log('web 目录已平铺到站点根');

  // 数值表：会由 boot.js 预载进 VFS
  copyTree(path.join(gameRoot, 'data'), path.join(outRoot, 'data'));
  log('data 目录已就位');

  // server.mjs 启动时会读 analysis/gd.decoded.js
  write(path.join(outRoot, 'analysis', 'gd.decoded.js'), fs.readFileSync(path.join(gameRoot, 'analysis', 'gd.decoded.js')));
  log('analysis/gd.decoded.js 已就位');
}

// --- 2. analysis/modules 合并 --------------------------------------------
function bundleModules() {
  const dir = path.join(gameRoot, 'analysis', 'modules');
  const map = {};
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    map[name.replace(/\.js$/, '')] = fs.readFileSync(path.join(dir, name), 'utf8');
  }
  const json = JSON.stringify(map);
  write(path.join(outRoot, 'analysis', 'modules-bundle.json'), json);
  log(`analysis/modules 已合并：${Object.keys(map).length} 个模块，${(json.length / 1048576).toFixed(1)} MB`);
}

// --- 3. 启动页与初始存档 --------------------------------------------------
function escapeRegExp(text) { return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); }

function buildStandalonePage() {
  let html = fs.readFileSync(path.join(gameRoot, 'web', 'index.html'), 'utf8');

  // 这几个脚本原本由 server.mjs 动态生成，standalone 下改成 entry.mjs 注入全局变量
  const generated = ['/equipment-composition-data.js', '/equipment-rules.js', '/pet-snapshot-data.js'];
  for (const src of generated) {
    html = html.replace(new RegExp('<script src="' + escapeRegExp(src) + '[^"]*"></script>', 'g'), '');
  }

  // 其余路径本来就是根相对（/offline.js、/gd.js），站点根现在就是 client 层，不用改写
  html = html.replace('<a href="/status" target="_blank">查看服务状态</a>', '');

  // entry-pledge.js 会无条件立刻挂上 /gd.js，那会让游戏早于独立运行时启动，
  // 结果就是用原生 WebSocket 去连正式服。改为由 standalone-boot.js 在就绪后再启动。
  html = html.replace('<script src="/entry-pledge.js"></script>', '');

  html = html.replace('</body>', '<script src="standalone-boot.js"></script></body>');
  html = html.replace('<title>世界 online · 原版单机</title>', '<title>世界 online · 原版单机（独立版）</title>');

  write(path.join(outRoot, 'index.html'), html);

  // 启动脚本本体
  fs.copyFileSync(path.join(here, 'boot.js'), path.join(outRoot, 'standalone-boot.js'));

  // 初始存档：首次运行播种到可写层（机型上已有存档时不会覆盖，见 boot.js 的 seedInitialSave）
  //
  // 优先用 default-save/world.json —— 这是给玩家随包的那份默认存档，可以随时换成
  // 手机里导出/通关进度；缺了才退回 QA 存档。两者必须分开：
  // qa-v05-saves/world.json 被 tests/loot.test.mjs 与 tests/career-skills.test.mjs
  // 按 id===1001 取角色做断言，改了会让既有用例挂掉。
  const seed = [path.join(gameRoot, 'default-save', 'world.json'),
                path.join(gameRoot, 'qa-v05-saves', 'world.json')].find(fs.existsSync);
  if (seed) {
    fs.copyFileSync(seed, path.join(outRoot, 'initial-save.json'));
    log(`初始存档已附上（${path.basename(path.dirname(seed))}）：${(fs.statSync(seed).size / 1024).toFixed(0)} KB`);
  } else {
    log('没有 default-save/world.json，也没有 qa-v05-saves/world.json，跳过初始存档');
  }

  // /v/gd/305.json：原版由 server.mjs 动态生成（恢复过的资源清单），这里构建期算好
  try {
    const manifestJson = nativeResourceManifest(gameRoot, path.join(gameRoot, 'client'));
    write(path.join(outRoot, 'v', 'gd', '305.json'), JSON.stringify(manifestJson));
    log('/v/gd/305.json 已构建期生成');
  } catch (error) {
    fs.copyFileSync(path.join(gameRoot, 'client', 'v', 'gd', '305.json'), path.join(outRoot, 'v', 'gd', '305.json'));
    log('动态清单生成失败，回退为直接复制原文件：' + error.message);
  }

  log('standalone.html 已生成为站点根 index.html');
}

// --- 4. 预载清单 ---------------------------------------------------------
function listFiles(root, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(root, entry.name), rel));
    else out.push('/' + rel);
  }
  return out;
}

function writeManifest() {
  // 每项：vfs = server.mjs 眼中的路径，url = 站点上实际能取到的地址
  //
  // 只登记「服务端启动就跑不掉」的几项。data/ 下 160 MB 的资料（道具图鉴、技能表、
  // 录制内容…）绝大多数是前端面板自己 fetch 的，服务端根本不读；全量预载会让启动
  // 凭空搬几百兆。剩下的交给 VFS 的按需同步加载（未命中就现场取一份并缓存）。
  const entries = [];
  entries.push({ vfs: '/worldol/client/v/gd/305.json', url: '/v/gd/305.json' });
  // 主包：站点里放的就是打过补丁的版本，VFS 也直接指向它。
  // server.mjs 读到后由 patchClientMain() 的「已打过补丁」判断跳过重打，
  // 不再需要额外留一份 .orig（省 4.5MB，也省掉每次启动重跑全链的 840ms）。
  entries.push({ vfs: '/worldol/client/' + MAIN_PATH, url: '/' + MAIN_PATH });
  entries.push({ vfs: '/worldol/analysis/gd.decoded.js', url: '/analysis/gd.decoded.js' });
  // 字体补丁：构建期已打进主包，运行时一般不会再触发；但 VFS 下 fs 缺文件就是
  // ENOENT 抛错，所以还是把这三个文件一起发布并预载，避免任何一条路径踩空。
  for (const name of FONT_PATCH_FILES) {
    entries.push({ vfs: '/worldol/lib/' + name, url: '/lib/' + name });
  }

  write(path.join(outRoot, 'standalone-files.json'), JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 1));

  const total = entries.reduce((sum, item) => {
    const file = path.join(outRoot, item.url.replace(/^\//, ''));
    return sum + (fs.existsSync(file) ? fs.statSync(file).size : 0);
  }, 0);
  log(`预载清单：${entries.length} 项，${(total / 1048576).toFixed(1)} MB`);
}

/**
 * 给 URL 加一次性版本号。
 *
 * 覆盖安装时 App 私有数据里的 WebView HTTP 缓存不会被清掉，站点文件的 URL
 * 又常年不变，于是客户端拿到的还是上一版的 index.html / gd.js / 主包。
 * 加版本号后 URL 每次构建都变，旧缓存自然用不上。
 */
function stampUrl(url, param) {
  return url.indexOf('?') >= 0 ? url + '&' + param : url + '?' + param;
}

// 参与构建指纹的文件：索引页、主包和资源清单这些一换就得失效的静态产物。
// modules-bundle.json 有 1.6 MB，但 sha256 只要几十毫秒，一并算进去更保险。
const BUILD_FINGERPRINT_FILES = [
  'index.html',
  'gd.js',
  'standalone-boot.js',
  'standalone-files.json',
  MAIN_PATH,
  'v/gd/305.json',
  // 第 90 版：伤害计算器的静态文件也进指纹（电脑版用，APK 里只多一个说明页）。
  'damage-calculator.html',
  'damage-calculator.js'
];

const NUL = String.fromCharCode(0);
const SEP = String.fromCharCode(1);

/**
 * 一棵目录树的内容哈希：按相对路径排序后逐文件喂进去。
 *
 * 只在这里用来给 data/** 记账 —— 理由见 applyBuildStamp 里「为什么要连 data 一起算」。
 * 大文件用流式读，不把整个 30 MB 的 buffer 摊在内存里。
 */
function hashTree(hash, dir, label) {
  const relatives = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) stack.push(full);
      else relatives.push([full, path.relative(dir, full).split(path.sep).join('/')]);
    }
  }
  relatives.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  for (const [full, rel] of relatives) {
    hash.update(label + NUL + rel + NUL + String(fs.statSync(full).size) + SEP);
    const fd = fs.openSync(full, 'r');
    try {
      for (;;) {
        const read = fs.readSync(fd, chunk, 0, chunk.length, null);
        if (!read) break;
        hash.update(chunk.subarray(0, read));
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  return relatives.length;
}

/**
 * 写 /build-version.json，并把版本号打进 index.html 与 standalone-boot.js。
 *
 * build-version.json 是给原生层用的：MainActivity 读它与上次记录的指纹比对，
 * 不同就在加载首页之前清掉 WebView 缓存目录（这一步清的是 305.json、主包这些
 * 客户端自己拼 URL、没法加版本号的资源）。
 */
function applyBuildStamp() {
  const hash = createHash('sha256');
  for (const rel of BUILD_FINGERPRINT_FILES) {
    const file = path.join(outRoot, rel);
    hash.update(rel);
    hash.update('\u0000');
    if (fs.existsSync(file)) hash.update(fs.readFileSync(file));
    hash.update('\u0001');
  }
  const bundle = path.join(outRoot, 'worldol-standalone.js');
  if (fs.existsSync(bundle)) hash.update('worldol-standalone.js\u0000').update(fs.readFileSync(bundle));
  const modules = path.join(outRoot, 'analysis', 'modules-bundle.json');
  if (fs.existsSync(modules)) hash.update('modules-bundle' + NUL).update(fs.readFileSync(modules));

  // 为什么要连 data/** 一起算指纹（这一步是「新版资料不生效」的根因）：
  //   上面的几项都是**代码或入口资源**，但 data/*.json（宠物目录、道具图鉴、商店清单…）
  //   既不预载、也不打包，是运行时由 VFS 用同步 XHR 现取的 —— URL 永远不带版本号。
  //   于是「只改 data/local-pets.json」的构建，算出来的指纹与上一版一模一样，
  //   覆盖安装后 WebView 的 HTTP 缓存直接命中旧资料：
  //   APK 里确实有新宠物，商店里就是不出现（分类名里的「N 种」也停在旧数字）。
  //   指纹变了 → __worldolBuild 变了 → VFS 的请求 URL 变了 → 旧缓存再也用不上。
  // 161 MB 全量 sha256 大约一秒，比出一个「装了等于没装」的包便宜太多。
  const dataDir = path.join(outRoot, 'data');
  let dataFiles = 0;
  if (fs.existsSync(dataDir)) {
    const started = Date.now();
    dataFiles = hashTree(hash, dataDir, 'data');
    log(`  data/** 共 ${dataFiles} 个文件已计入指纹（${Date.now() - started} ms）`);
  }

  const id = hash.digest('hex').slice(0, 12);
  const param = 't=' + id;
  write(path.join(outRoot, 'build-version.json'), JSON.stringify({ id, generatedAt: new Date().toISOString() }, null, 1));

  const htmlPath = path.join(outRoot, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  let counted = 0;
  html = html.replace(/(<script src=")([^"]+)(")/g, (all, head, url, tail) => {
    if (url.charAt(0) === 'h' && url.indexOf('://') > 0) return all;   // 外链保持原样
    counted++;
    return head + stampUrl(url, param) + tail;
  });
  write(htmlPath, html);

  const bootPath = path.join(outRoot, 'standalone-boot.js');
  let boot = fs.readFileSync(bootPath, 'utf8');
  boot = replaceOnce(boot, 'loadScript(\'worldol-standalone.js\')', 'loadScript(\'worldol-standalone.js?' + param + '\')');
  boot = replaceOnce(boot, 'loadScript(\'gd.js\')', 'loadScript(\'gd.js?' + param + '\')');
  boot = replaceOnce(boot, '__WORLDOL_BUILD_ID__', id);
  boot = replaceOnce(boot, '__WORLDOL_MAIN_JS__', MAIN_PATH);
  write(bootPath, boot);

  log(`构建指纹 ${id}：index.html ${counted} 个脚本、standalone-boot.js 已加版本号`);
}

// --- 4. esbuild 打包 -----------------------------------------------------
const NODE_ALIAS = {
  'node:fs': './shims/fs.mjs',
  'node:path': './shims/path.mjs',
  'node:url': './shims/url.mjs',
  'node:crypto': './shims/crypto.mjs',
  'node:vm': './shims/vm.mjs',
  'node:http': './shims/http.mjs',
  'node:os': './shims/os.mjs',
  ws: './shims/ws.mjs'
};

const aliasPlugin = {
  name: 'worldol-alias',
  setup(build) {
    build.onResolve({ filter: /^(node:|ws$|worldol-server$)/ }, (args) => {
      if (args.path === 'worldol-server') return { path: path.join(gameRoot, 'server.mjs') };
      const target = NODE_ALIAS[args.path];
      if (!target) return null;
      return { path: path.resolve(here, target) };
    });
  }
};

// import.meta.url -> file:///worldol/<相对游戏根目录的路径>
// 这样 server.mjs 推出的 root 就是 /worldol，lib/*.mjs 的 new URL('../data/x') 也能落到 /worldol/data/x
//
// 顺手做一个 Node -> 浏览器 的安全转换：
//   浏览器里 setTimeout 返回数字，没有 .unref()，而 server.mjs 会调它。
//   改成可选链调用（数字上取属性为 undefined，整句变成 no-op）。
const importMetaPlugin = {
  name: 'worldol-import-meta',
  setup(build) {
    build.onLoad({ filter: /\.mjs$/ }, async (args) => {
      if (!args.path.startsWith(gameRoot)) return null;
      let contents = await fs.promises.readFile(args.path, 'utf8');
      const before = contents;
      if (contents.includes('import.meta.url')) {
        const rel = path.relative(gameRoot, args.path).split(path.sep).join('/');
        contents = contents.replace(/import\.meta\.url/g, JSON.stringify('file:///worldol/' + rel));
      }
      if (contents.includes('.unref()')) {
        contents = contents.replace(/\.unref\(\)/g, '?.unref?.()');
      }
      if (contents === before) return null;
      return { contents, loader: 'js' };
    });
  }
};

async function bundle() {
  const result = await esbuild.build({
    entryPoints: [path.join(here, 'entry.mjs')],
    outfile: path.join(outRoot, 'worldol-standalone.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100'],
    charset: 'utf8',
    logLevel: 'info',
    legalComments: 'none',
    plugins: [aliasPlugin, importMetaPlugin],
    define: {
      'process.env.NODE_ENV': '"production"',
      'global': 'globalThis'
    }
  });
  if (result.errors.length) throw new Error('esbuild 打包失败');
  const out = path.join(outRoot, 'worldol-standalone.js');
  log(`已产出 ${path.relative(packRoot, out)}（${(fs.statSync(out).size / 1024).toFixed(0)} KB）`);
}

// --- main ---------------------------------------------------------------
async function main() {
  log(`游戏源码：${gameRoot}`);
  log(`站点根目录：${outRoot}`);
  // 每次重建，避免上一版的遗留文件混进来（尤其是以前的 www/nodejs 布局）
  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(outRoot, { recursive: true });
  // 顺序不能换：layoutSite 全量平铺 client/ 之后再打补丁，否则补丁产物被覆盖。
  layoutSite();
  buildPatchedClient();
  layoutFontPatchAssets();
  bundleModules();
  buildStandalonePage();
  writeManifest();
  await bundle();
  // 必须在最后：指纹要覆盖 bundle 产出的 worldol-standalone.js
  applyBuildStamp();
  log('全部完成');
}

main().catch((error) => {
  console.error('[build] 失败：', error);
  process.exitCode = 1;
});

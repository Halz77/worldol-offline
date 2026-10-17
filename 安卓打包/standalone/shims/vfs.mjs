/*
 * 虚拟文件系统（VFS）
 *
 * 思路：把「网站根目录」当成 Node 的 root。
 *   - 只读层：standalone.html 预载进来的文本文件，键是站点 URL（http://host/data/x.json）
 *   - 只读层（模块）：analysis/modules/****.js 由构建期合成一个 JSON 一次性载入
 *   - 可写层：内存 Map，存档额外镜像到 localStorage，保证刷新不丢
 *
 * server.mjs 里的 import.meta.url 在构建期被改写成 file:///worldol/<相对路径>，
 * 所以 Node 侧的路径一律形如 /worldol/data/official-v305.json。
 */

export const VROOT = '/worldol';

// 站点相对路径（/data/x.json） -> 文本内容
const readOnlyText = new Map();
// 站点相对路径 -> Uint8Array（二进制，按需 fetch 后缓存）
const readOnlyBinary = new Map();
// 可写层：站点相对路径 -> Uint8Array
const writable = new Map();

// 站点资源随 APK 一起发布，WebView 里就是同源。PC 预览时端口会变，所以取当前 origin。
let siteOrigin = (typeof location !== 'undefined' && location.origin) ? location.origin : 'http://localhost';

export function setSiteOrigin(origin) {
  siteOrigin = origin;
}

function toSitePath(path) {
  // VFS 里一律是 /worldol/... 形式，而站点 URL 的根是 client/ 的内容：
  //   /worldol/client/v/gd/305.json -> /v/gd/305.json
  //   /worldol/data/x.json          -> /data/x.json
  //   /worldol/web/offline.js       -> /offline.js
  let text = String(path).replace(/\\/g, '/');
  if (text === VROOT) return '/';
  if (text.startsWith(VROOT + '/client/')) text = text.slice(VROOT.length + '/client'.length);
  else if (text.startsWith(VROOT + '/')) text = text.slice(VROOT.length);
  if (!text.startsWith('/')) text = '/' + text;
  // 折叠 ./ 与 ../
  const parts = [];
  for (const segment of text.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') { parts.pop(); continue; }
    parts.push(segment);
  }
  return '/' + parts.join('/');
}

export function sitePathToUrl(sitePath) {
  return siteOrigin + encodeURI(sitePath.split('/').map((s) => s).join('/'));
}

// --- 预载 ---------------------------------------------------------------
export function putText(sitePath, text) {
  readOnlyText.set(toSitePath(sitePath), text);
}
export function putModule(id, text) {
  readOnlyText.set('/analysis/modules/' + id + '.js', text);
}

export function has(sitePath) {
  const p = toSitePath(sitePath);
  return writable.has(p) || readOnlyText.has(p) || readOnlyBinary.has(p);
}

// --- 按需加载 ---------------------------------------------------------
// 站点里 data/ 加起来 160 MB，但服务端启动只读其中一小部分，其余（道具图鉴、
// 技能表、录制内容…）是前端面板自己 fetch 的。启动时全量预载会白白转几百兆。
//
// 所以：未命中就现场用同步 XHR 取一份并缓存。Node 的 fs 是同步 API，
// server.mjs 又跑在同一个线程上，只能走同步 XHR。
const misses = new Set();

export function missList() {
  return [...misses].sort();
}
export function missCount() {
  return misses.size;
}

function syncFetchText(sitePath) {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', siteOrigin + sitePath + cacheStamp(sitePath), false);
    // 同步模式下 responseType 只能是 ''；overrideMimeType 保证 JSON 也按 utf-8 解
    xhr.overrideMimeType('text/plain; charset=utf-8');
    xhr.send(null);
    if (xhr.status === 200 && typeof xhr.responseText === 'string') return xhr.responseText;
    // file:// 或某些 WebView 下 status 为 0 但内容正常
    if (xhr.status === 0 && xhr.responseText) return xhr.responseText;
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * 按需抓取的 URL 上附带的构建指纹（由 standalone-boot.js 写进 globalThis）。
 *
 * 站点根的那几个入口（index.html / gd.js / 主包 / 305.json）都有版本号或会被
 * primeChangedAssets 强制刷新，但 data/*.json 是这里现取的：URL 恒定不变，
 * 覆盖安装后 WebView 的 HTTP 缓存会命中**上一版**的资料 —— 症状是
 * 「新加的宠物/道具在商店里看不到，分类名里的『N 种』也停在上一版数字」。
 * 加上指纹后，每次构建的 URL 都不同，旧缓存自然用不上。
 *
 * 拿不到指纹（桌面端直接引用 shim、或 boot 没替换占位符）就返回空串，行为不变。
 */
function cacheStamp(sitePath) {
  const id = (typeof globalThis !== 'undefined' && globalThis.__worldolBuild) ? String(globalThis.__worldolBuild) : '';
  if (!id) return '';
  return (sitePath.indexOf('?') >= 0 ? '&' : '?') + 'b=' + encodeURIComponent(id);
}

/** 未命中时从站点取文本；取不到返回 null（调用方按 ENOENT 处理） */
export function loadText(sitePath) {
  const p = toSitePath(sitePath);
  const text = syncFetchText(p);
  if (text === null) {
    if (misses.size < 4000) misses.add(p);
    return null;
  }
  readOnlyText.set(p, text);
  return text;
}

// --- 读 ---------------------------------------------------------------
export function readBytes(sitePath) {
  const p = toSitePath(sitePath);
  if (writable.has(p)) return writable.get(p);
  if (readOnlyBinary.has(p)) return readOnlyBinary.get(p);
  if (readOnlyText.has(p)) return new TextEncoder().encode(readOnlyText.get(p));
  const text = loadText(p);
  return text === null ? null : new TextEncoder().encode(text);
}

export function readText(sitePath) {
  const p = toSitePath(sitePath);
  if (writable.has(p)) return new TextDecoder('utf-8').decode(writable.get(p));
  if (readOnlyText.has(p)) return readOnlyText.get(p);
  if (readOnlyBinary.has(p)) return new TextDecoder('utf-8').decode(readOnlyBinary.get(p));
  return loadText(p);
}

// --- 写 ---------------------------------------------------------------
export function writeBytes(sitePath, bytes) {
  const p = toSitePath(sitePath);
  if (!(bytes instanceof Uint8Array)) bytes = new TextEncoder().encode(String(bytes));
  writable.set(p, bytes);
  persistIfSave(p, bytes);
}

export function remove(sitePath) {
  const p = toSitePath(sitePath);
  writable.delete(p);
}

export function listWritable() {
  return [...writable.keys()].sort();
}

// --- 存档持久化 --------------------------------------------------------
// 只有 /saves/ 下的东西需要跨刷新保留，其余（日志、control.json）留在内存即可。
const SAVE_PREFIX = '/saves/';
const LS_PREFIX = 'worldol-fs:';

function persistIfSave(sitePath, bytes) {
  if (!sitePath.startsWith(SAVE_PREFIX)) return;
  // SaveStore.save() 每次会写三个路径：world.json.tmp（中间态，写完就被 rename）、
  // world.json.bak（上一版备份）、world.json（当前）。只有 world.json 需要跨刷新保留。
  // 持久化 .tmp / .bak 既没意义，又会让「一次存档 = 两次全量 base64 + 两次
  // localStorage 同步写入」，在手机 WebView 上直接表现为进入/结束战斗时掉帧卡顿。
  if (sitePath.endsWith('.tmp') || sitePath.endsWith('.bak')) return;
  try {
    localStorage.setItem(LS_PREFIX + sitePath, bytesToBase64(bytes));
  } catch (error) {
    console.error('[worldol-vfs] 存档写入 localStorage 失败（空间不足？）', error);
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** 启动时把上次存在 localStorage 里的存档读回内存可写层 */
export function restoreSaves() {
  let restored = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(LS_PREFIX)) continue;
    if (key.endsWith('.tmp')) continue;
    try {
      writable.set(key.slice(LS_PREFIX.length), base64ToBytes(localStorage.getItem(key)));
      restored++;
    } catch { /* 忽略损坏项 */ }
  }
  return restored;
}

/** 导出存档（给「导出存档」按钮用）。盘上是紧凑 JSON，导出时重新排版方便人工查看。 */
export function exportSave(sitePath = '/saves/world.json') {
  const bytes = readBytes(sitePath);
  if (!bytes) return null;
  const text = new TextDecoder('utf-8').decode(bytes);
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** 导入存档（覆盖当前存档） */
export function importSave(text, sitePath = '/saves/world.json') {
  writeBytes(sitePath, new TextEncoder().encode(text));
  // 顺手清掉上一次保存留下的临时文件。SaveStore 只在写盘时用 .bak，读的时候
  // 不看它，删掉是安全的；不删的话 localStorage 里会一直堆着旧存档副本。
  for (const suffix of ['.bak', '.tmp']) {
    const stale = sitePath + suffix;
    writable.delete(stale);
    try { localStorage.removeItem(LS_PREFIX + stale); } catch { /* 忽略 */ }
  }
}

export { toSitePath };

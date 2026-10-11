/*
 * node:fs shim —— 接到 VFS 上
 *
 * server.mjs / lib/*.mjs 只用到同步 API，所以这里全部同步实现。
 * 写入目标（存档、日志、world.json.bak）落到内存可写层，存档额外镜像到 localStorage。
 */
import * as vfs from './vfs.mjs';
import { Buffer } from './buffer.mjs';

function toPathArgs(arg) {
  // 支持 URL 对象：new URL('../data/x.json', import.meta.url)
  if (arg && typeof arg === 'object' && typeof arg.href === 'string') {
    return decodeURIComponent(arg.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  }
  return String(arg);
}

class Stats {
  constructor(size, isDirectory) {
    this.size = size;
    this._dir = isDirectory;
  }
  isFile() { return !this._dir; }
  isDirectory() { return this._dir; }
  isSymbolicLink() { return false; }
  get mtimeMs() { return Date.now(); }
}

function readdir(path) {
  const sitePath = vfs.toSitePath(toPathArgs(path));
  const prefix = sitePath.endsWith('/') ? sitePath : sitePath + '/';
  const names = new Set();
  for (const key of vfs.listWritable()) {
    if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0]);
  }
  return [...names];
}

export default {
  readFileSync(path, options) {
    const target = toPathArgs(path);
    const text = vfs.readText(target);
    if (text === null) {
      const error = new Error(`ENOENT: no such file or directory, open '${target}'`);
      error.code = 'ENOENT';
      throw error;
    }
    const encoding = typeof options === 'string' ? options : options && options.encoding;
    // 不带编码时必须返回 Buffer：lib/world-travel.mjs 直接 JSON.parse(readFileSync(url))，
    // 而 JSON.parse 会对参数做 ToString——裸 Uint8Array 会变成 "123,34,..."。
    return encoding ? text : Buffer.from(text, 'utf8');
  },

  existsSync(path) {
    return vfs.has(toPathArgs(path));
  },

  statSync(path) {
    const target = toPathArgs(path);
    const bytes = vfs.readBytes(target);
    if (bytes) return new Stats(bytes.length, false);
    const sitePath = vfs.toSitePath(target);
    if (sitePath === '/') return new Stats(0, true);
    // 目录判定：有以它为前缀的子项就算目录
    const prefix = sitePath + '/';
    const children = readdir(target);
    if (children.length) return new Stats(0, true);
    if (vfs.has(sitePath)) return new Stats(0, false);
    throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${target}'`), { code: 'ENOENT' });
  },

  readdirSync(path) {
    return readdir(path);
  },

  mkdirSync() { /* VFS 不需要显式建目录 */ },

  writeFileSync(path, data) {
    vfs.writeBytes(toPathArgs(path), data instanceof Uint8Array ? data : new TextEncoder().encode(String(data)));
  },

  appendFileSync(path, data) {
    const target = toPathArgs(path);
    const previous = vfs.readBytes(target);
    const appended = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    const combined = new Uint8Array((previous ? previous.length : 0) + appended.length);
    if (previous) combined.set(previous, 0);
    combined.set(appended, previous ? previous.length : 0);
    vfs.writeBytes(target, combined);
  },

  copyFileSync(from, to) {
    const bytes = vfs.readBytes(toPathArgs(from));
    if (!bytes) throw Object.assign(new Error(`ENOENT: no such file '${from}'`), { code: 'ENOENT' });
    vfs.writeBytes(toPathArgs(to), bytes);
  },

  renameSync(from, to) {
    const source = toPathArgs(from);
    const bytes = vfs.readBytes(source);
    if (!bytes) throw Object.assign(new Error(`ENOENT: no such file '${from}'`), { code: 'ENOENT' });
    vfs.writeBytes(toPathArgs(to), bytes);
    vfs.remove(source);
  },

  unlinkSync(path) {
    vfs.remove(toPathArgs(path));
  },

  // 只有 HTTP 静态分发用得到；standalone 下没有 HTTP，永远不会被调用
  createReadStream() {
    throw new Error('createReadStream 在 standalone 模式下不可用');
  }
};

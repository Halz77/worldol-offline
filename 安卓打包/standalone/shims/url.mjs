/*
 * node:url shim
 *
 * 构建期会把 import.meta.url 改写成 file:///worldol/<相对路径>，
 * 所以 lib/*.mjs 里的 new URL('../data/x.json', import.meta.url) 会得到
 * file:///worldol/data/x.json，fileURLToPath 再把它变成 /worldol/data/x.json。
 *
 * fs shim 认识 /worldol/ 前缀，所以这个链路是通的。
 * 浏览器原生 URL 就能正确解析 file:/// 的 ..，不需要自己算。
 */

export function fileURLToPath(input) {
  const url = typeof input === 'string' ? new URL(input) : input;
  if (!url || url.protocol !== 'file:') {
    throw new TypeError('fileURLToPath 只支持 file:// URL，收到：' + (url && url.href));
  }
  return decodeURIComponent(url.pathname);
}

export function pathToFileURL(path) {
  return new URL('file://' + encodeURI(String(path)).replace(/#/g, '%23').replace(/\?/g, '%3F'));
}

export default { fileURLToPath, pathToFileURL, URL };

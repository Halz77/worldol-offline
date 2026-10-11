/*
 * node:path shim —— 纯 POSIX 实现
 * 我们的虚拟根是 /worldol，server.mjs 里所有路径都从它派生，所以用 POSIX 语义即可。
 */
function normalizeParts(parts) {
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  return out;
}

function normalizePath(input) {
  const text = String(input);
  if (text === '') return '.';
  const absolute = text.startsWith('/');
  const trailing = text.length > 1 && (text.endsWith('/') || text.endsWith('/.'))
    || text.endsWith('/..');
  const parts = normalizeParts(text.split('/'));
  let result = (absolute ? '/' : '') + parts.join('/');
  if (result === '') result = absolute ? '/' : '.';
  if (trailing && result !== '/') result += '/';
  return result;
}

function join(...segments) {
  const parts = [];
  for (const segment of segments) {
    if (segment === undefined || segment === null || segment === '') continue;
    parts.push(String(segment));
  }
  if (!parts.length) return '.';
  const joined = parts.join('/');
  const normalized = normalizePath(joined);
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function resolve(...segments) {
  let resolved = '';
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!segment) continue;
    resolved = String(segment) + '/' + resolved;
    if (String(segment).startsWith('/')) break;
  }
  if (!resolved.startsWith('/')) resolved = '/' + resolved;
  return normalizePath(resolved);
}

function dirname(input) {
  const text = String(input);
  const trimmed = text.endsWith('/') && text.length > 1 ? text.slice(0, -1) : text;
  const index = trimmed.lastIndexOf('/');
  if (index === -1) return '.';
  if (index === 0) return '/';
  return trimmed.slice(0, index);
}

function basename(input, ext) {
  const text = String(input);
  const trimmed = text.endsWith('/') && text.length > 1 ? text.slice(0, -1) : text;
  let name = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  if (ext && name.endsWith(ext)) name = name.slice(0, -ext.length);
  return name;
}

function extname(input) {
  const name = basename(input);
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index);
}

function relative(from, to) {
  const fromParts = normalizeParts(String(from).split('/'));
  const toParts = normalizeParts(String(to).split('/'));
  let shared = 0;
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) shared++;
  const ups = new Array(fromParts.length - shared).fill('..');
  return ups.concat(toParts.slice(shared)).join('/');
}

export default {
  sep: '/',
  delimiter: ':',
  join,
  resolve,
  normalize: normalizePath,
  dirname,
  basename,
  extname,
  relative,
  isAbsolute: (input) => String(input).startsWith('/'),
  parse(input) {
    const dir = dirname(input);
    const base = basename(input);
    const ext = extname(input);
    return {
      root: String(input).startsWith('/') ? '/' : '',
      dir: dir === '.' && !String(input).includes('/') ? '' : dir,
      base,
      ext,
      name: ext ? base.slice(0, -ext.length) : base
    };
  },
  format(parsed) {
    const dir = parsed.dir || parsed.root || '';
    const base = parsed.base || (parsed.name || '') + (parsed.ext || '');
    return dir ? join(dir, base) : base;
  }
};

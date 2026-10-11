/*
 * 极简静态服务器 —— 只用于本地验证 standalone 版能否启动
 * 用法：node 工具\静态服务器.mjs [根目录] [端口]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || path.join(here, '..', 'app', 'www', 'nodejs'));
const port = Number(process.argv[3] || 18800);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg', '.bin': 'application/octet-stream', '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  let file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // 目录请求再试一次 index.html
    const asDir = path.resolve(root, '.' + pathname, 'index.html');
    if (asDir.startsWith(root) && fs.existsSync(asDir) && fs.statSync(asDir).isFile()) {
      file = asDir;
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 ' + pathname);
      return;
    }
  }
  res.writeHead(200, {
    'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': fs.statSync(file).size,
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
  console.log(`静态服务器: http://127.0.0.1:${port}/   根目录: ${root}`);
});

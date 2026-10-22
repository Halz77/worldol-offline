#!/usr/bin/env node
/**
 * 官服网页版抓包器（Chrome / Edge DevTools Protocol）
 *
 * 目的：在没有 Electron 录制界面的机器上，仍然按本项目
 * `正式服录制工具/lib/archive.cjs` 的格式保存一份完整会话，
 * 方便 `tools/analyze-capture.mjs` / `tools/analyze-recordings.mjs` 直接分析。
 *
 * 用法：
 *   1) 用独立配置启动 Chrome/Edge：
 *      chrome.exe --remote-debugging-port=9222 --remote-allow-origins=* \
 *        --user-data-dir="%TEMP%\worldol-capture-profile" about:blank
 *   2) 在 `世界online_原版单机` 下运行：
 *      node tools/capture-official-web.mjs --port 9222 --url "官服网页地址"
 *   3) 正常玩；在终端输入 `m 说明` 写标记，输入 `q` 回车结束。
 *
 * 注意：原始抓包可能包含账号、Cookie、聊天和其他玩家信息，只能留在本机，
 * 不要提交到仓库，也不要公开上传。
 */
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import WebSocket from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const recorderRoot = path.resolve(root, '../正式服录制工具');
const {Archive} = require(path.join(recorderRoot, 'lib/archive.cjs'));

function arg(name, fallback = '') {
  const index = process.argv.indexOf('--' + name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const port = Number(arg('port', '9222'));
const url = arg('url', '');
const match = arg('match', '');
const label = arg('label', 'official-web');
const seconds = Number(arg('seconds', '0'));
const outRoot = path.resolve(arg('out', path.join(root, '../正式服录制数据')));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port 不合法');
if (!Number.isFinite(seconds) || seconds < 0) throw new Error('--seconds 不合法');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`无法读取 DevTools 目标列表：HTTP ${response.status}`);
  return response.json();
}

async function pickTarget() {
  const targets = await listTargets();
  const pages = targets.filter(target => target.type === 'page' && !String(target.url).startsWith('devtools://'));
  if (!pages.length) throw new Error('没有找到可抓包的页面。请先在 Chrome/Edge 打开 about:blank。');
  if (match) {
    const matched = pages.find(target => String(target.url).includes(match));
    if (!matched) throw new Error(`没有页面 URL 包含：${match}`);
    return matched;
  }
  return pages.find(target => target.url === 'about:blank') || pages[0];
}

let target;
try {
  target = await pickTarget();
} catch (error) {
  console.error('无法连接或选择抓包页面：' + error.message);
  console.error('请确认 Chrome/Edge 已用 --remote-debugging-port=' + port + ' 启动，并打开 about:blank。');
  process.exit(1);
}
const archive = new Archive(outRoot, {
  appVersion: 'unverified',
  label,
  source: 'official-web-cdp',
  targetUrl: target.url,
  browser: target.browser || '',
  note: 'Chrome/Edge DevTools Protocol capture; raw archive may contain credentials and chat.'
});
archive.record('recorder.marker', {text: 'capture-start', category: 'control'});

console.log('');
console.log('抓包目录：' + archive.dir);
console.log('目标页面：' + target.url);
console.log('采集开始。正常玩官服网页版，终端输入 `m 说明` 写标记，输入 `q` 回车结束。');

const socket = new WebSocket(target.webSocketDebuggerUrl, {maxPayload: 256 * 1024 * 1024});
const pendingCommands = new Map();
const pendingTasks = new Set();
const requests = new Map();
let nextId = 1;
let finished = false;
let stopResolve;
const stopped = new Promise(resolve => { stopResolve = resolve; });

function send(method, params = {}, sessionId = '') {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pendingCommands.set(id, {resolve, reject});
    const message = {id, method, params};
    if (sessionId) message.sessionId = sessionId;
    socket.send(JSON.stringify(message));
  });
}

function track(task) {
  const guarded = Promise.resolve(task).catch(error => {
    archive.gap('capture-command-failed', {message: error.message});
  });
  pendingTasks.add(guarded);
  guarded.finally(() => pendingTasks.delete(guarded));
  return guarded;
}

function targetLabel(sessionId) {
  return sessionId ? `main/${sessionId}` : 'main';
}

async function enable(sessionId = '') {
  const label = targetLabel(sessionId);
  try {
    await send('Network.enable', {
      maxTotalBufferSize: 512 * 1024 * 1024,
      maxResourceBufferSize: 128 * 1024 * 1024,
      maxPostDataSize: 128 * 1024 * 1024,
      enableDurableMessages: true
    }, sessionId);
  } catch (error) {
    archive.record('recorder.compatibility', {feature: 'durableMessages', message: error.message}, label);
    await send('Network.enable', {
      maxTotalBufferSize: 512 * 1024 * 1024,
      maxResourceBufferSize: 128 * 1024 * 1024,
      maxPostDataSize: 128 * 1024 * 1024
    }, sessionId);
  }
  await send('Network.setCacheDisabled', {cacheDisabled: true}, sessionId);
  try {
    await send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [
        {type: 'iframe'},
        {type: 'worker'},
        {type: 'shared_worker'},
        {type: 'service_worker'},
        {exclude: true}
      ]
    }, sessionId);
  } catch (error) {
    archive.gap('child-target-auto-attach-unavailable', {message: error.message}, label);
  }
  archive.record('recorder.targetReady', {}, label);
}

function requestKey(sessionId, requestId) {
  return `${sessionId}:${requestId}`;
}

function handleNetwork(method, params, sessionId) {
  const label = targetLabel(sessionId);
  const key = requestKey(sessionId, params.requestId);

  if (method === 'Network.webSocketFrameSent' || method === 'Network.webSocketFrameReceived') {
    archive.websocket(method, params, label);
    return;
  }

  archive.record(method, params, label);

  if (method === 'Network.requestWillBeSent') {
    requests.set(key, {
      requestId: params.requestId,
      sessionId,
      url: params.request.url,
      method: params.request.method,
      state: 'pending'
    });
    return;
  }

  if (method === 'Network.responseReceived') {
    const request = requests.get(key);
    if (request) {
      request.status = params.response.status;
      request.mimeType = params.response.mimeType;
    }
    return;
  }

  if (method === 'Network.loadingFinished') {
    const request = requests.get(key);
    if (!request) return;
    request.state = 'finished';
    if (request.method === 'HEAD' || [204, 205, 304].includes(request.status)) {
      archive.record('recorder.httpBodyAbsent', {
        requestId: params.requestId,
        url: request.url,
        reason: 'http-no-body',
        status: request.status
      }, label);
      return;
    }
    track(send('Network.getResponseBody', {requestId: params.requestId}, sessionId)
      .then(result => {
        archive.body(params.requestId, result.body, result.base64Encoded, label, {
          url: request.url,
          mimeType: request.mimeType,
          status: request.status
        });
      })
      .catch(error => {
        archive.gap('http-response-body-unavailable', {
          requestId: params.requestId,
          url: request.url,
          message: error.message
        }, label);
      }));
    return;
  }

  if (method === 'Network.loadingFailed') {
    const request = requests.get(key);
    if (request) request.state = 'failed';
  }
}

function handleEvent(method, params, sessionId) {
  if (method === 'Target.attachedToTarget') {
    archive.record(method, params, targetLabel(sessionId));
    track((async () => {
      try {
        await enable(params.sessionId);
      } catch (error) {
        archive.gap('child-target-enable-failed', {message: error.message}, targetLabel(params.sessionId));
      } finally {
        try {
          await send('Runtime.runIfWaitingForDebugger', {}, params.sessionId);
        } catch (error) {
          archive.gap('child-target-resume-failed', {message: error.message}, targetLabel(params.sessionId));
        }
      }
    })());
    return;
  }

  if (method === 'Target.detachedFromTarget') {
    archive.record(method, params, targetLabel(sessionId));
    return;
  }

  if (method.startsWith('Network.')) {
    handleNetwork(method, params, sessionId);
  }
}

async function finish(reason) {
  if (finished) return;
  finished = true;
  console.log('\n正在收尾，等待未完成的响应体…');
  const drained = await Promise.race([
    Promise.allSettled([...pendingTasks]).then(() => true),
    sleep(10000).then(() => false)
  ]);
  if (!drained) archive.gap('pending-body-reads-at-stop', {count: pendingTasks.size});
  try { await send('Network.disable'); } catch { /* 页面可能已关闭 */ }
  try {
    archive.finish(reason);
    console.log('抓包已保存：' + archive.dir);
  } catch (error) {
    console.error('保存抓包失败：' + error.message);
  }
  try { socket.close(); } catch { /* ignore */ }
  if (stopResolve) stopResolve();
}

socket.on('open', () => track((async () => {
  await enable();
  archive.record('recorder.marker', {text: 'network-enabled', category: 'control'});
  if (url) {
    await send('Page.enable');
    await send('Page.navigate', {url});
    archive.record('recorder.marker', {text: 'navigate: ' + url, category: 'control'});
  } else {
    console.log('未传 --url；请在当前 about:blank 页面手动打开官服网页。');
  }
  if (seconds > 0) {
    console.log(`将在 ${seconds} 秒后自动结束。`);
    setTimeout(() => finish('auto-stop'), seconds * 1000).unref();
  }
})()));

socket.on('message', raw => {
  let message;
  try { message = JSON.parse(raw.toString()); }
  catch (error) {
    archive.gap('invalid-cdp-message', {message: error.message});
    return;
  }
  if (message.id) {
    const command = pendingCommands.get(message.id);
    pendingCommands.delete(message.id);
    if (!command) return;
    if (message.error) command.reject(new Error(message.error.message || 'CDP command failed'));
    else command.resolve(message.result);
    return;
  }
  if (message.method) {
    try { handleEvent(message.method, message.params || {}, message.sessionId || ''); }
    catch (error) { archive.gap('capture-event-failed', {method: message.method, message: error.message}); }
  }
});

socket.on('error', error => {
  console.error('DevTools WebSocket 错误：' + error.message);
  finish('socket-error');
});

socket.on('close', () => finish('socket-closed'));

process.on('SIGINT', () => { finish('sigint'); });
process.on('SIGTERM', () => { finish('sigterm'); });

if (process.stdin.isTTY) {
  process.stdin.setEncoding('utf8');
  let buffer = '';
  process.stdin.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      if (text === 'q' || text === 'quit' || text === 'stop') {
        finish('user-stopped');
        return;
      }
      if (text.startsWith('m ')) {
        archive.record('recorder.marker', {text: text.slice(2), category: 'manual'});
        console.log('标记：' + text.slice(2));
        continue;
      }
      console.log('可用命令：m 说明 / q');
    }
  });
}

await stopped;
process.stdin.pause();

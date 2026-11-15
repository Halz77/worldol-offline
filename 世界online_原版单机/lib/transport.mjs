/**
 * 传输层 —— 把「帧怎么进来 / 怎么出去」与「游戏会话怎么处理帧」分开。
 *
 * 阶段 1 的目标形态：server.mjs 只负责造 transport 并喂帧，
 * lib/game-session.mjs 只认统一的 connection 接口，两边都不知道对方跑在哪种通道上。
 *
 *   ws      现网形态（默认）：真 HTTP + WebSocket，行为与改造前完全一致。
 *   memory  纯本地形态：不创建 net.Server、不监听端口，帧在同一个进程内往返。
 *           由 createRuntime().connect() 驱动，供自检 / 测试 / 后续 Electron 壳使用。
 *
 * connection 接口（两种实现完全一致）：
 *   url                 客户端请求路径
 *   send(bytes)         服务端 → 客户端
 *   onMessage(cb)       客户端 → 服务端，cb(Buffer)
 *   onClose(cb) / onError(cb)
 *   close(code, reason)
 *
 * transport 接口：
 *   mode, clients, onConnection(cb), connect(url), closeAll()
 *
 * 注意：`connect()` 只属于 memory 形态；ws 形态由浏览器主动连进来。
 */
import {WebSocketServer} from 'ws';

function wrapWebSocket(ws, url) {
  const connection = {
    url,
    send(bytes) { ws.send(bytes); },
    onMessage(cb) { ws.on('message', cb); },
    onClose(cb) { ws.on('close', cb); },
    onError(cb) { ws.on('error', cb); },
    close(code, reason) { ws.close(code, reason); }
  };
  return connection;
}

/** 默认形态：与改造前的 WebSocketServer 参数逐项对应。 */
export function createWebSocketTransport({server, port}) {
  const handlers = [];
  const clients = new Set();
  const wss = new WebSocketServer({
    server,
    maxPayload: 1024 * 1024,
    verifyClient: ({origin}) => !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`
  });
  wss.on('connection', (ws, request) => {
    const connection = wrapWebSocket(ws, request.url);
    clients.add(connection);
    ws.on('close', () => clients.delete(connection));
    for (const cb of handlers) cb(connection);
  });
  return {
    mode: 'ws',
    clients,
    onConnection(cb) { handlers.push(cb); },
    connect() { throw Error('ws 传输由客户端主动连接，请用 createRuntime({transport:"memory"}) 做进程内会话'); },
    closeAll() { for (const connection of clients) connection.close(1001, 'Local service stopped'); }
  };
}

/** 纯本地形态：一条连接就是一对内存端点，不碰任何 socket。 */
export function createMemoryTransport() {
  const handlers = [];
  const clients = new Set();
  return {
    mode: 'memory',
    clients,
    onConnection(cb) { handlers.push(cb); },
    connect(url = '/game') {
      const replies = [];
      let clientCb = null;
      const connection = {
        url,
        send(bytes) {
          const copy = Buffer.from(bytes);
          replies.push(copy);
          if (clientCb) clientCb(copy);
        },
        onMessage(cb) { connection._receive = cb; },
        onClose(cb) { connection._onClose = cb; },
        onError(cb) { connection._onError = cb; },
        close(code, reason) {
          clients.delete(connection);
          if (connection._onClose) connection._onClose(code, Buffer.from(String(reason || '')));
        },
        _receive() {},
        _onClose: null,
        _onError: null
      };
      clients.add(connection);
      for (const cb of handlers) cb(connection);
      return {
        connection,
        replies,
        /** 客户端 → 服务端 */
        send(bytes) { connection._receive(Buffer.from(bytes)); },
        /** 服务端 → 客户端的实时回调（replies 也会留一份完整记录） */
        onReply(cb) { clientCb = cb; },
        close() { connection.close(1000, 'client closed'); }
      };
    },
    closeAll() {
      for (const connection of [...clients]) connection.close(1001, 'Local service stopped');
    }
  };
}

export function createTransport({mode = 'ws', server = null, port = 0} = {}) {
  return mode === 'memory' ? createMemoryTransport() : createWebSocketTransport({server, port});
}

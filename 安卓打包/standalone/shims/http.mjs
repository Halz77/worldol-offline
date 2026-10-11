/*
 * node:http shim
 *
 * 没有真正的 HTTP 服务，但 server.mjs 的请求处理函数里藏着所有 /api/* 接口
 * （web/offline.js 等页面脚本要用它们）。所以这里把 handler 捕获下来，
 * 由 fetch 拦截器（entry.mjs）用假的 req/res 调用它。
 */
let capturedHandler = null;

const fakeServer = {
  listening: false,
  listen(_port, _host, callback) {
    this.listening = true;
    if (typeof callback === 'function') callback();
    return this;
  },
  close(callback) {
    this.listening = false;
    if (typeof callback === 'function') callback();
    return this;
  },
  on() { return this; },
  once() { return this; },
  setTimeout() { return this; },
  address() { return { address: '127.0.0.1', family: 'IPv4', port: 8775 }; }
};

export default {
  createServer(handler) {
    if (typeof handler === 'function') capturedHandler = handler;
    return Object.create(fakeServer);
  },
  Server: function Server() { return Object.create(fakeServer); },
  /** 供 fetch 拦截器调用 */
  getHandler() { return capturedHandler; }
};

// --- 构造给 handler 用的假 req / res -------------------------------------

/** 把一次 fetch 包装成 Node 的 IncomingMessage（支持 for await 读 body） */
export function createRequest(url, method, headers, bodyBytes) {
  return {
    url,
    method,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      // server.mjs 里是 `data += chunk`，所以这里要给字符串而不是字节数组
      if (bodyBytes && bodyBytes.length) yield new TextDecoder('utf-8').decode(bodyBytes);
    }
  };
}

/** 收集 handler 写出来的响应 */
export function createResponse() {
  const state = { status: 200, headers: {}, chunks: [], resolve: null };

  state.response = {
    statusCode: 200,
    setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return state.headers[String(name).toLowerCase()]; },
    writeHead(code, headers) {
      state.status = code;
      if (headers) for (const [name, value] of Object.entries(headers)) state.headers[String(name).toLowerCase()] = value;
      return state.response;
    },
    write(chunk) { if (chunk) state.chunks.push(toBytes(chunk)); return true; },
    end(chunk) {
      if (chunk) state.chunks.push(toBytes(chunk));
      if (state.resolve) state.resolve();
    },
    on() { return state.response; },
    once() { return state.response; }
  };

  state.done = new Promise((resolve) => { state.resolve = resolve; });
  return state;
}

function toBytes(chunk) {
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  return new TextEncoder().encode(String(chunk));
}

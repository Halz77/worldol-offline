/*
 * ws shim + FakeWebSocket
 *
 * server.mjs 里 `new WebSocketServer({server,...})` 建的是协议处理器，
 * 我们把它接进内存通道；客户端那边把 window.WebSocket 换成 FakeWebSocket，
 * 于是"游戏 <-> 服务端"的字节流完全在同一个页面里往返，没有任何网络。
 */
import { Buffer } from './buffer.mjs';

export class WebSocketServer {
  constructor(options = {}) {
    this.options = options;
    this.clients = new Set();
    this.handlers = new Map();
    // entry.mjs 的 FakeWebSocket 会从这里取实例
    globalThis.__worldolWss = this;
  }

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(handler);
    return this;
  }

  emit(event, ...args) {
    for (const handler of this.handlers.get(event) || []) handler(...args);
    return true;
  }
}

/** 服务端视角的"一条连接" */
function createServerSocket(deliverToClient) {
  const handlers = new Map();
  const socket = {
    readyState: 1,
    _receive(bytes) {
      // 注意：游戏启动后会接管 console，控制台看不到这里的日志，
      // 所以把字节流记到全局变量里，用 __worldolWsTrace 读。
      try {
        const trace = (globalThis.__worldolWsTrace = globalThis.__worldolWsTrace || []);
        if (trace.length < 40) {
          trace.push({
            dir: 'c2s',
            length: bytes.length,
            hex: Array.from(bytes.subarray(0, Math.min(40, bytes.length)))
              .map((b) => b.toString(16).padStart(2, '0')).join(' ')
          });
        }
      } catch { /* 忽略 */ }
      for (const handler of handlers.get('message') || []) {
        try { handler(Buffer.from(bytes)); } catch (error) { console.error('[worldol-ws] 处理消息出错', error); }
      }
    },
    _close(code, reason) {
      socket.readyState = 3;
      for (const handler of handlers.get('close') || []) handler(code, Buffer.from(String(reason || '')));
    },
    send(data) {
      const bytes = toBytes(data);
      deliverToClient(bytes);
    },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
      return socket;
    },
    close(code = 1000, reason = '') { socket._close(code, reason); },
    terminate() { socket._close(1006, 'terminated'); },
    ping() { }
  };
  return socket;
}

function toBytes(data) {
  if (data == null) return new Uint8Array(0);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return new Uint8Array(0);
}

function toArrayBuffer(bytes) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

export function installFakeWebSocket() {
  if (typeof window === 'undefined' || window.__worldolFakeWebSocketInstalled) return;
  window.__worldolFakeWebSocketInstalled = true;

  class FakeWebSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      console.log('[worldol-ws] 客户端创建 WebSocket：' + this.url);
      this.readyState = 0;           // CONNECTING
      this.binaryType = 'arraybuffer';
      this.bufferedAmount = 0;
      this.protocol = '';
      this.extensions = '';
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this._serverSocket = null;
      this._pending = [];
      this._waitTicks = 0;
      setTimeout(() => this._open(), 0);
    }

    _emit(type, event) {
      const handler = this['on' + type];
      if (typeof handler === 'function') {
        try { handler.call(this, event); } catch (error) { console.error('[worldol-ws] ' + type + ' 回调出错', error); }
      }
      try { this.dispatchEvent(event); } catch (error) { console.error('[worldol-ws] 派发 ' + type + ' 出错', error); }
    }

    _open() {
      if (this.readyState !== 0) return;
      const wss = globalThis.__worldolWss;
      if (!wss) {
        // 服务端模块还没初始化完，稍等重试
        if (++this._waitTicks > 400) {
          this._emit('error', new Event('error'));
          return;
        }
        setTimeout(() => this._open(), 25);
        return;
      }
      this._serverSocket = createServerSocket((bytes) => {
        if (this.readyState !== 1) return;
        const data = this.binaryType === 'arraybuffer' ? toArrayBuffer(bytes) : new Blob([bytes]);
        this._emit('message', new MessageEvent('message', { data }));
      });
      this.readyState = 1;           // OPEN
      try {
        console.log('[worldol-ws] 已接入内存通道：' + this.url);
        wss.emit('connection', this._serverSocket, { url: this.url });
      } catch (error) {
        console.error('[worldol-ws] 建立连接失败', error);
        this._emit('error', new Event('error'));
        return;
      }
      this._emit('open', new Event('open'));
      const queued = this._pending.splice(0);
      for (const item of queued) this.send(item);
    }

    send(data) {
      if (this.readyState === 0) { this._pending.push(data); return; }
      if (this.readyState !== 1) throw new Error('WebSocket is not open: readyState ' + this.readyState);
      if (data instanceof Blob) {
        data.arrayBuffer().then((buffer) => this._serverSocket._receive(new Uint8Array(buffer)));
        return;
      }
      this._serverSocket._receive(toBytes(data));
    }

    close(code = 1000, reason = '') {
      if (this.readyState === 3) return;
      const wasOpen = this.readyState === 1;
      this.readyState = 3;
      if (wasOpen && this._serverSocket) this._serverSocket._close(code, reason);
      this._emit('close', new CloseEvent('close', { code, reason, wasClean: wasOpen }));
    }
  }

  window.WebSocket = FakeWebSocket;
  return FakeWebSocket;
}

export default { WebSocketServer };

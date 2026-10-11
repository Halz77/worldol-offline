/*
 * fetch 拦截器
 *
 * web/*.js 里有一堆 fetch('/api/...') 调用，这些接口的实现全在 server.mjs 的
 * 请求处理函数里（已被 node:http shim 捕获）。这里把 /api/* 用假 req/res 喂给它，
 * 其余请求（图片、data/*.json、web/*.js）原样交给浏览器，由 WebView 直接从 APK 读。
 */
import httpShim, { createRequest, createResponse } from './http.mjs';

// 需要走内存 handler 的路径
const DYNAMIC_PREFIXES = ['/api/'];
const DYNAMIC_PATHS = new Set(['/status', '/v/gd/305.json']);

// 这些是构建期已经打好补丁的静态文件，绝不能再走 handler（否则会被二次打补丁）
const NEVER_INTERCEPT = new Set(['/gd.js']);

function mergeChunks(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return merged;
}

function collectHeaders(input, init) {
  const headers = {};
  const source = (init && init.headers) || (typeof input === 'object' && input.headers);
  if (!source) return headers;
  if (typeof source.forEach === 'function' && !Array.isArray(source)) {
    source.forEach((value, name) => { headers[String(name).toLowerCase()] = String(value); });
  } else if (Array.isArray(source)) {
    for (const [name, value] of source) headers[String(name).toLowerCase()] = String(value);
  } else {
    for (const [name, value] of Object.entries(source)) headers[String(name).toLowerCase()] = String(value);
  }
  return headers;
}

async function readBody(input, init) {
  try {
    const body = (init && init.body) !== undefined ? init.body : (typeof input === 'object' ? input.body : undefined);
    if (body === undefined || body === null) return null;
    if (typeof body === 'string') return new TextEncoder().encode(body);
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (typeof body.arrayBuffer === 'function') return new Uint8Array(await body.arrayBuffer());
    return new TextEncoder().encode(String(body));
  } catch {
    return null;
  }
}

export function installFetchInterceptor() {
  if (typeof window === 'undefined' || window.__worldolFetchInstalled) return;
  window.__worldolFetchInstalled = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    let url;
    try {
      url = new URL(typeof input === 'string' ? input : input.url, location.href);
    } catch {
      return nativeFetch(input, init);
    }

    const sameOrigin = url.origin === location.origin;
    const isDynamic = sameOrigin
      && !NEVER_INTERCEPT.has(url.pathname)
      && (DYNAMIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) || DYNAMIC_PATHS.has(url.pathname));

    if (!isDynamic) return nativeFetch(input, init);

    const handler = httpShim.getHandler();
    if (typeof handler !== 'function') return nativeFetch(input, init);

    const method = ((init && init.method) || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const headers = collectHeaders(input, init);
    const body = await readBody(input, init);

    const request = createRequest(url.pathname + url.search, method, headers, body);
    const state = createResponse();

    try {
      await handler(request, state.response);
      await state.done;
    } catch (error) {
      console.error('[worldol-standalone] 内存接口处理失败：' + url.pathname, error);
      return new Response('{"error":"' + String(error && error.message || error).replace(/"/g, "'") + '"}', {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }

    // content-length 由 Response 自己算，不能透传，否则长度对不上会报错
    const responseHeaders = {};
    for (const [name, value] of Object.entries(state.headers)) {
      if (name === 'content-length' || name === 'content-encoding') continue;
      responseHeaders[name] = value;
    }

    const payload = state.chunks.length ? mergeChunks(state.chunks) : null;
    return new Response(payload, { status: state.status, headers: responseHeaders });
  };

  console.log('[worldol-standalone] fetch 拦截器已装载');
}

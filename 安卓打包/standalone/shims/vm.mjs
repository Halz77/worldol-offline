/*
 * node:vm shim
 *
 * tools/capture-decoders.mjs 用 vm.Script + runInNewContext 来执行
 * 从客户端模块里抠出来的字节读取函数。这些代码是纯函数，不碰 DOM，
 * 所以用 new Function + 具名参数就能等价替代（参数即"新的上下文"）。
 */
class Script {
  constructor(code) {
    this.code = String(code);
    this.cachedFactory = null;
    this.cachedNames = null;
  }

  _factory(names) {
    if (this.cachedFactory && this.cachedNames === names.join(',')) return this.cachedFactory;
    this.cachedNames = names.join(',');
    this.cachedFactory = new Function(...names, '"use strict"; return (' + this.code + ');');
    return this.cachedFactory;
  }

  runInNewContext(context = {}, _options = {}) {
    const names = Object.keys(context || {}).filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name));
    const values = names.map((name) => context[name]);
    return this._factory(names)(...values);
  }

  runInThisContext() {
    return (0, eval)('(' + this.code + ')');
  }

  runInContext(context) {
    return this.runInNewContext(context);
  }
}

export function createContext(sandbox = {}) { return sandbox; }

export function runInNewContext(code, context = {}, options = {}) {
  return new Script(code).runInNewContext(context, options);
}

export function runInThisContext(code) {
  return new Script(code).runInThisContext();
}

export default { Script, createContext, runInNewContext, runInThisContext };

/*
 * node:os shim —— server.mjs / lib 目前没用到，留个空壳防止意外 import 报错
 */
export default {
  tmpdir: () => '/worldol/tmp',
  platform: () => 'browser',
  arch: () => 'wasm32',
  cpus: () => [],
  homedir: () => '/worldol',
  type: () => 'Browser',
  release: () => 'standalone',
  EOL: '\n'
};

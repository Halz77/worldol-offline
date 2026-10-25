/*
 * standalone 打包入口
 *
 * 顺序很重要：先恢复存档、再把 window.WebSocket 换成内存通道，
 * 最后才加载 server.mjs —— 因为 server.mjs 顶层就会建存档、读数值表、注册连接回调。
 *
 * 静态 import 会被提前提升到本文件顶部执行，所以这里必须用动态 import。
 * 用 esbuild 打 IIFE（不开 splitting）时，动态 import 会被内联，不会产生额外请求。
 */
import { putText, putModule, restoreSaves, exportSave, importSave, readText, listWritable, missList } from './shims/vfs.mjs';
import { installFakeWebSocket } from './shims/ws.mjs';
import { installFetchInterceptor } from './shims/intercept.mjs';

// 注意：不要在这里静态 import game 侧的任何模块！
// globals.mjs 会链式 import lib/*.mjs，那些模块在初始化时就要读 data/*.json，
// 而静态 import 会被提升到预载之前执行，必然 ENOENT。必须动态 import。

export const VERSION = 'standalone-1';

/** server.mjs 会读 process.env / process.pid / process.exitCode，这里给个浏览器替身 */
function installProcess() {
  if (globalThis.process && globalThis.process.versions && globalThis.process.versions.node) return;
  globalThis.process = {
    env: {
      WORLDOL_RESOURCES: '/worldol/client',
      WORLDOL_SAVES: '/worldol/saves',
      WORLDOL_LOGS: '/worldol/logs',
      WORLDOL_PORT: '8775',
      NODE_ENV: 'production'
    },
    pid: 1,
    exitCode: 0,
    platform: 'browser',
    arch: 'wasm32',
    version: 'v18.0.0-standalone',
    versions: { node: '18.0.0-standalone' },
    cwd: () => '/worldol',
    nextTick: (fn, ...args) => setTimeout(() => fn(...args), 0),
    exit: () => { console.warn('[worldol-standalone] 忽略了 process.exit()'); },
    on: () => { }
  };
}

/**
 * 那些原本由 server.mjs 动态生成的 <script src="/xxx.js">：
 * standalone 下没有 HTTP，改成在这里直接把全局变量铺好。
 * 必须在 server.mjs 之后——它们依赖 data/*.json 已经读完。
 */
async function installGeneratedGlobals() {
  const { equipmentRules, starLimit, compositionData, petSnapshotDirectory, autoSkillChance, formationSlots } = await import('./globals.mjs');
  globalThis.worldolEquipmentRules = equipmentRules;
  globalThis.worldolStarLimit = starLimit;
  globalThis.worldolCompositionData = compositionData;
  globalThis.worldolAutoSkillChance = autoSkillChance;
  globalThis.worldolFormationSlots = formationSlots;
  const raw = readText('/saves/world.json');
  const characters = raw ? (JSON.parse(raw).characters || []) : [];
  globalThis.offlinePetSnapshotProfiles = petSnapshotDirectory(characters);
}

async function start() {
  installProcess();
  const restored = restoreSaves();
  if (restored) console.log(`[worldol-standalone] 从 localStorage 恢复了 ${restored} 个存档文件`);
  installFakeWebSocket();
  installFetchInterceptor();
  console.log('[worldol-standalone] 内存通道已就绪，开始加载服务端…');
  await import('worldol-server');
  console.log('[worldol-standalone] 服务端加载完成');
  await installGeneratedGlobals();
  globalThis.__worldolReady = true;
  return true;
}

globalThis.__worldolStandalone = {
  VERSION, start, putText, putModule, restoreSaves, exportSave, importSave,
  // 调试用：直接读 VFS（例如 /worldol/logs/session.jsonl）
  readText, listWritable, missList, hasWss: () => !!globalThis.__worldolWss
};

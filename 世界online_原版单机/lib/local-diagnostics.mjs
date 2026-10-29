/**
 * 自检面板配置（第 97 版，2026-10-25）。
 *
 * 起因：三个客户端补丁（自动技能概率 / 随机目标 / 阵位加成）都在「客户端主包末尾追加执行」，
 * 挂没挂上、配置有没有到客户端，玩家在 APK 里完全看不到，只能靠猜。
 * 这里给一个极简开关：data/local-diagnostics.json → window.worldolDiagnostics。
 *
 * 投放：电脑版 /worldol-diag.js（lib/http-routes.mjs），APK 走 standalone/globals.mjs。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'local-diagnostics.json');
let cache;

/** 读配置（读不到 ⇒ overlay 关闭，绝不因为自检面板影响游戏）。 */
export function diagnosticSettings() {
  if (cache) return cache;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { raw = {}; }
  cache = {
    revision: typeof raw.revision === 'string' ? raw.revision : 'diagnostics-20261025-v1',
    overlay: raw.overlay !== false,
    logToConsole: raw.logToConsole !== false,
    // 战斗信息面板里那行长诊断（第 105 版默认关）：排查时打开，平时开着会横向出框。
    battleDiag: raw.battleDiag === true
  };
  return cache;
}

/** 下发给客户端的对象（window.worldolDiagnostics）。 */
export function diagnosticGlobals() {
  return {...diagnosticSettings()};
}

/** 一句话摘要（/api 路由或日志用）。 */
export function diagnosticSummary() {
  const s = diagnosticSettings();
  return {revision: s.revision, overlay: s.overlay, logToConsole: s.logToConsole, battleDiag: s.battleDiag};
}

/** 测试/热重载：清缓存。 */
export function resetDiagnostics() { cache = undefined; }

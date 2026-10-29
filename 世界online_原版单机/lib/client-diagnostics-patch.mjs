/**
 * 客户端补丁：战斗改造自检面板（第 97 版，2026-10-25）。
 *
 * 用途：把三个补丁的**挂载状态 + 计数**直接画在游戏画面上，用于排查
 * 「改了配置但游戏里没感觉」这类问题（玩家在 APK 里看不到控制台）。
 *
 * 显示内容（每行一个补丁）：
 *   概率  —— 自动技能触发概率：是否挂载、配置了几项、掷骰/命中/跳过次数
 *   随机  —— 随机目标：是否挂载、AI 光标是否也挂上、作用范围标签是否补上、调用/返回/空池
 *   阵位  —— 阵法阵位加成：角色/宠物/Cal 版本是否挂载、应用次数、配置阵数
 * 任何一项显示「未挂载」就说明补丁链没跑到（或 attach 没找到类）。
 *
 * 开关：data/local-diagnostics.json（overlay / logToConsole）。
 * ★ 本函数体会被 toString() 塞进客户端主包执行 ⇒ 必须完全自包含。
 */
export function installDiagnostics(req, host) {
  host = host || globalThis;
  if (host.__worldolDiagnosticsPatch) return host.__worldolDiagnosticsPatch;

  const cfg = host.worldolDiagnostics || {};
  const useOverlay = cfg.overlay !== false;
  const useConsole = cfg.logToConsole !== false;
  const state = { el: null, body: null, expanded: true, lastLine: '' };
  let timer = null;
  let consoleAt = 0;

  function mark(ok) { return ok ? '✓' : '✗'; }

  function autoLine() {
    const api = host.__worldolAutoSkillChancePatch;
    if (!api) return '概率  ✗ 未挂载（补丁链没跑到）';
    const s = api.status || {};
    return '概率  ' + mark(s.hooked) + ' 已挂, 配置 ' + (s.configuredSkills || 0) + ' 项'
      + ', 掷骰 ' + (s.rolls || 0) + ' (中' + (s.passed || 0) + '/跳' + (s.skipped || 0) + ')'
      + (s.configLoaded ? '' : ' ← 客户端没拿到配置!');
  }

  function randomLine() {
    const api = host.__worldolRandomTargetPatch;
    if (!api) return '随机  ✗ 未挂载（补丁链没跑到）';
    const s = api.status || {};
    return '随机  ' + mark(s.hooked) + ' 已挂, 光标' + mark(s.cursorHooked) + ' 标签' + mark(s.labelHooked)
      + ', 调用 ' + (s.randomCalls || 0) + '/回' + (s.returned || 0) + '/空' + (s.empty || 0)
      + ', 光标' + (s.cursorCalls || 0);
  }

  function formationLine() {
    const api = host.__worldolFormationSlotPatch;
    if (!api) return '阵位  ✗ 未挂载（补丁链没跑到）';
    const s = api.status || {};
    // 第 106 版总开关：配置里 enabled:false 时整块不生效，这里要一眼看得出来
    if (s.disabled) return '阵位  ⏸ 总开关关闭（local-formation-slots.json → enabled:false）';
    return '阵位  角色' + mark(s.roleHooked) + ' Get' + mark(s.getHooked) + ' Cal' + mark(s.calHooked)
      + ' Base' + mark(s.baseHooked) + ' 宠物' + mark(s.petHooked)
      + ', 应用 ' + (s.rolePatches || 0) + '/' + (s.petPatches || 0) + ' 回退 ' + (s.fallbacks || 0)
      + ', get ' + (s.getCalls || 0) + ' 宠调 ' + (s.petCalls || 0)
      + ', 配置阵 ' + (s.configured || 0) + ' 个';
  }

  function build() {
    // 标题带补丁版本号，方便确认玩家跑的是哪一版（v3 = 第 98 版「模块缓存形状」修正）
    let rev = '';
    try {
      const api = host.__worldolRandomTargetPatch;
      rev = api && api.revision ? String(api.revision).split('-v').pop() : '';
    } catch (_) { rev = ''; }
    return '世界OL 自检' + (rev ? ' v' + rev : '') + '（点我收起）\n' + autoLine() + '\n' + randomLine() + '\n' + formationLine()
      + '\n配置: 概率' + (host.worldolAutoSkillChance ? '✓' : '✗')
      + ' 阵位' + (host.worldolFormationSlots ? '✓' : '✗');
  }

  function apply() {
    const text = build();
    if (text === state.lastLine) return text;
    state.lastLine = text;
    if (state.el) {
      const title = text.split('\n')[0].replace('收起', '展开');
      state.el.textContent = state.expanded ? text : title;
    }
    if (useConsole) {
      const now = Date.now();
      if (now - consoleAt > 5000) {
        consoleAt = now;
        try { console.log('[worldol自检]\n' + text); } catch (_) {}
      }
    }
    return text;
  }

  function mount() {
    if (!useOverlay) return true;
    if (state.el) return true;
    const doc = host.document;
    if (!doc || !doc.body) return false;
    const div = doc.createElement('div');
    div.id = 'worldol-diag-panel';
    div.style.cssText = [
      'position:fixed', 'left:6px', 'top:6px', 'z-index:2147483647',
      'max-width:78vw', 'padding:6px 8px', 'border-radius:6px',
      'background:rgba(0,0,0,.62)', 'color:#ffe9a8',
      'font:11px/1.5 Consolas,Menlo,monospace', 'white-space:pre',
      'pointer-events:auto', 'cursor:pointer', 'letter-spacing:0'
    ].join(';');
    div.addEventListener('click', function () {
      state.expanded = !state.expanded;
      state.lastLine = '';
      apply();
    });
    doc.body.appendChild(div);
    state.el = div;
    return true;
  }

  function tick() {
    if (!mount()) return;
    apply();
  }

  tick();
  timer = setInterval(tick, 1000);

  const api = {
    revision: 'diagnostics-patch-20261025-v1',
    get text() { return build(); },
    get mounted() { return !!state.el; },
    refresh: tick,
    toggle: function () { if (state.el) state.el.style.display = state.el.style.display === 'none' ? '' : 'none'; },
    stop: function () { if (timer) { clearInterval(timer); timer = null; } }
  };
  host.__worldolDiagnosticsPatch = api;
  host.__worldolDiag = function () { return api.text; };
  return api;
}

/** 补丁链入口：追加 install 函数到主包末尾。 */
export function patchDiagnostics(source) {
  if (source.includes('__worldolDiagnosticsPatch')) throw Error('Diagnostics patch already installed');
  if (!source.includes('getSelectArea=function'))
    throw Error('diagnostics patch mismatch: getSelectArea=function');
  return source + '\n;(' + installDiagnostics.toString() + ')(window.__worldReq,window);\n';
}

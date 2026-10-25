/**
 * 客户端补丁：技能随机目标（第 93 版，2026-10-25）。
 *
 * 需求：技能的作用范围可以设成「敌方随机 N 个」「我方随机 N 个」，N 自己填。
 *
 * 为什么用 area 号段编码而不是另开配置文件：
 *   1. `area` 本来就是技能 wire 字段里的一项，覆盖层 OVERRIDABLE_FIELDS 允许改，
 *      技能编辑器改一个下拉就落到技能定义上 —— 不需要额外的下发链路；
 *   2. 目标是「数量可调」，一个字节足够：area 值直接编码数量，编辑器把它换算成
 *      中文选项（敌随机 1—10 / 我随机 1—10），玩家看到的仍是「作用范围」一项。
 *
 * 号段约定（原版 0—38 已占用，见 analysis/modules/0004.js 与技能编辑器的 skillAreas 表）：
 *   40—49 = 敌方随机 N（N = area - 39，即 40=随机1个 … 49=随机10个）
 *   50—59 = 我方随机 N（N = area - 49）
 *   39 留空作为缓冲，60+ 未使用。
 *
 * 实现：包装 Battle.prototype.getSelectArea(actorPos, targetPos, area)
 *   - 命中号段时，先用**原版自己的「全体」分支**（19 敌全体 / 29 我全体）算出候选池
 *     —— 不自己判敌我侧（战场位置是 34 格：左 20 右 14，自己算容易错边）；
 *   - 过滤出真存活单位（原版全体列表含空位，社区版 centerFrontTarget 踩过这个坑）；
 *   - 洗牌取 N；不足 N 个时返回实际数量；一个都没有时返回 null（原版语义=目标无效）。
 */
export const randomTargetRevision = 'random-target-patch-20261025-v1';

/** area 号段：40—49 敌随机、50—59 我随机。 */
export const RANDOM_TARGET_MIN = 40;
export const RANDOM_TARGET_MAX = 59;
export const AREA_ENEMY_ALL = 19;
export const AREA_ME_ALL = 29;

/** 把 area 解析成 {side:'enemy'|'me', count}；不是随机段返回 null。纯函数，单测直接用。 */
export function decodeRandomArea(area) {
  if (!Number.isInteger(area)) return null;
  if (area < RANDOM_TARGET_MIN || area > RANDOM_TARGET_MAX) return null;
  const enemy = area < 50;
  return { side: enemy ? 'enemy' : 'me', count: enemy ? area - 39 : area - 49 };
}

/** 安装随机目标层。req = window.__worldReq，host = window。 */
export function installRandomTarget(req, host) {
  host = host || globalThis;
  if (host.__worldolRandomTargetPatch) return host.__worldolRandomTargetPatch;
  const counters = { randomCalls: 0, returned: 0, empty: 0, passthrough: 0 };
  let hooked = false;
  let timer = null;

  // 按特征找战斗类：同时具备 getSelectArea + getPlayerByPos（不硬编码模块号）。
  function findBattleProto() {
    const cache = req.c;
    if (!cache) return null;
    for (const key in cache) {
      let mod;
      try { mod = cache[key]; } catch (_) { continue; }
      // 真环境导出类（方法在 prototype 上）；少数模块导出单例实例，两种都认。
      const proto = (mod && mod.prototype) || (mod && mod.default && (mod.default.prototype || mod.default)) || null;
      if (proto && typeof proto.getSelectArea === 'function' && typeof proto.getPlayerByPos === 'function')
        return proto;
    }
    return null;
  }

  function attach() {
    if (hooked) return true;
    const proto = findBattleProto();
    if (!proto) return false;
    if (Object.prototype.hasOwnProperty.call(proto, '__worldolRandomTarget')) { hooked = true; return true; }
    const original = proto.getSelectArea;

    proto.getSelectArea = function (actorPos, targetPos, area) {
      const spec = decodeRandomArea(area);
      if (!spec) { counters.passthrough++; return original.apply(this, arguments); }
      counters.randomCalls++;
      let pool = null;
      try {
        // 借原版「全体」分支算候选（该分支内部已按敌我侧过滤，但**含空位**）
        pool = original.call(this, actorPos, targetPos, spec.side === 'enemy' ? AREA_ENEMY_ALL : AREA_ME_ALL);
      } catch (_) { pool = null; }
      if (!pool || !pool.length) { counters.empty++; return null; }
      const alive = [];
      for (let i = 0; i < pool.length; i++) {
        const pos = pool[i];
        let unit = null;
        try { unit = this.getPlayerByPos(pos); } catch (_) { unit = null; }
        if (!unit || !unit.battleSprite) continue;                 // 空位 / 还没上场的单位
        try {
          if (typeof this.isValidBattlePlayer === 'function' && !this.isValidBattlePlayer(unit)) continue; // 已阵亡
        } catch (_) { continue; }
        alive.push(pos);
      }
      if (!alive.length) { counters.empty++; return null; }
      // Fisher-Yates 洗牌（用 Math.random，和原版 AI 的随机同源）
      for (let i = alive.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = alive[i]; alive[i] = alive[j]; alive[j] = t;
      }
      const picked = alive.slice(0, Math.min(spec.count, alive.length));
      counters.returned++;
      return picked;                                                // 不足 N 个时返回实际数量
    };
    proto.__worldolRandomTarget = true;
    hooked = true;
    return true;
  }

  if (!attach()) timer = setInterval(() => { if (attach()) { clearInterval(timer); timer = null; } }, 800);

  const api = {
    revision: 'random-target-patch-20261025-v1',
    get status() { return { hooked, randomCalls: counters.randomCalls, returned: counters.returned, empty: counters.empty, passthrough: counters.passthrough }; },
    /** 测试钩子：把候选池按规则挑 N 个（不依赖战斗实例，纯逻辑复用）。 */
    pick: (pool, count) => {
      const alive = pool.slice();
      for (let i = alive.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = alive[i]; alive[i] = alive[j]; alive[j] = t;
      }
      return alive.slice(0, Math.min(count, alive.length));
    },
    probeAttach: () => attach(),
    stop: () => { if (timer) { clearInterval(timer); timer = null; } }
  };
  host.__worldolRandomTargetPatch = api;
  return api;
}

/** 补丁链入口：追加 install 函数到主包末尾。 */
export function patchRandomTarget(source) {
  if (source.includes('__worldolRandomTargetPatch')) throw Error('Random target patch already installed');
  if (!source.includes('getSelectArea=function'))
    throw Error('random target patch mismatch: getSelectArea=function');
  return source + '\n;(' + installRandomTarget.toString() + ')(window.__worldReq,window);\n';
}

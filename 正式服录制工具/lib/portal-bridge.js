(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else if (!root.__worldolPortalBridge) root.__worldolPortalBridge = factory(root);
})(globalThis, function createPortalBridge(root, options) {
  'use strict';
  options = options || {};
  const revision = 'v305-portals-1';
  let enabled = true, controller = null, lastList = null, serial = 0, error = '';
  const hooks = [], keys = new WeakMap(), rendered = new WeakMap(), initializing = new WeakSet();
  function targets(npc) {
    if (!npc || ![3, 5, 8].includes(npc.npcType) || !Array.isArray(npc.jumpMapID)) return [];
    return npc.jumpMapID.flatMap((mapId, i) => {
      const x = npc.jumpMapGx?.[i], y = npc.jumpMapGy?.[i];
      return Number.isInteger(mapId) && mapId > 0 && Number.isInteger(x) && x >= 0 && x <= 127 &&
        Number.isInteger(y) && y >= 0 && y <= 127 ? [{ index: i, mapId, x, y }] : [];
    });
  }
  function current(npc) { return controller?._proxy?.model?.npcList?.includes(npc) && targets(npc).length > 0; }
  function validController(m) {
    return m && Array.isArray(m._proxy?.model?.npcList) && m._scene?.ctrl &&
      typeof m._scene.ctrl.getNpcById === 'function' && typeof m.onMoveToNpc === 'function';
  }
  // The map's native Egret touch listener owns SceneMdr. No webpack globals,
  // downloaded-script rewriting, packet edits, or authentication access needed.
  function discover() {
    const queue = [root.go?.gameStage], seen = new Set();
    for (let i = 0; i < queue.length && i < 5000; i++) {
      const view = queue[i];
      if (!view || seen.has(view)) continue;
      seen.add(view);
      for (const bucket of [1, 2]) {
        const handlers = view.$EventDispatcher?.[bucket]?.touchTap;
        if (Array.isArray(handlers)) for (const handler of handlers) if (validController(handler.thisObject)) return handler.thisObject;
      }
      if (Array.isArray(view.$children)) queue.push(...view.$children);
      if (view._sceneLayer) queue.push(view._sceneLayer);
    }
    return null;
  }
  function wrap(owner, name, replacement) {
    if (hooks.some(h => h.owner === owner && h.name === name)) return;
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    if (!descriptor || typeof descriptor.value !== 'function' || !descriptor.writable) return;
    const value = replacement(descriptor.value);
    Object.defineProperty(owner, name, { ...descriptor, value });
    hooks.push({ owner, name, descriptor, value });
  }
  function install(npc) {
    const prototype = Object.getPrototypeOf(npc);
    wrap(prototype, 'init', original => function (...args) {
      initializing.add(this);
      try { return original.apply(this, args); } finally { initializing.delete(this); }
    });
    for (const name of ['isVisible', 'isEnable']) {
      wrap(prototype, name, original => function (...args) {
        return enabled && !initializing.has(this) && current(this) ? true : original.apply(this, args);
      });
    }
    // A multifunction NPC can also contain real portal menu entries. Add only
    // those entries; retain its original battle, shop and task menu checks.
    wrap(npc.constructor, 'addPowerNPCChoice', original => function (player, target, labels, choices) {
      const result = original.apply(this, arguments);
      if (enabled && current(target) && target.npcType === 5 && Array.isArray(labels) && Array.isArray(choices)) {
        for (const t of targets(target)) {
          if (target.menuJumpMap?.[t.index] && !choices.some(c => c[0] === 2 && c[1] === 0 && c[2] === t.index)) {
            labels.push([target.menuJumpMap[t.index]]); choices.push([2, 0, t.index]);
          }
        }
      }
      return result;
    });
  }
  function refreshMiniMap() {
    const queue = [root.go?.gameStage], seen = new Set();
    for (let i = 0; i < queue.length && i < 5000; i++) {
      const view = queue[i]; if (!view || seen.has(view)) continue; seen.add(view);
      const mdr = view.__mdr__;
      if (view.grp_npc && mdr && typeof mdr.updateNpc === 'function') mdr.updateNpc();
      if (Array.isArray(view.$children)) queue.push(...view.$children);
    }
  }
  function tick() {
    try {
      if (String(root.go?.res_version || '') !== '305') { controller = null; return; }
      if (!validController(controller)) controller = discover();
      if (!controller) return;
      const list = controller._proxy.model.npcList;
      let changed = list !== lastList; lastList = list;
      for (const npc of list) {
        if (!targets(npc).length) continue;
        install(npc);
        if (!keys.has(npc)) keys.set(npc, String(++serial));
        const view = controller._scene.ctrl.getNpcById(npc.id);
        const signature = `${enabled}:${npc.isVisible()}:${npc.isEnable()}`;
        if (view && (rendered.get(view)?.npc !== npc || rendered.get(view)?.signature !== signature)) {
          view.updateVo(); rendered.set(view, { npc, signature }); changed = true;
        }
      }
      if (changed) refreshMiniMap();
      error = '';
    } catch (e) { error = e.message || String(e); }
  }
  function status() {
    const supported = String(root.go?.res_version || '') === '305';
    const ready = supported && validController(controller) && !!controller._proxy.isMapReady;
    const portals = ready ? controller._proxy.model.npcList.filter(n => targets(n).length).map(n => ({
      key: keys.get(n), id: n.id, name: n.name || n.topic || '传送门', x: n.sourceGx ?? n.x, y: n.sourceGy ?? n.y,
      targets: targets(n), visible: n.isVisible(), clickable: n.isEnable(),
      originalVisible: !!(n.status & 1), originalEnabled: !!(n.status & 2)
    })) : [];
    return { revision, enabled, ready, supported, mapId: ready ? controller._proxy.mapId : null, portals, error };
  }
  function setEnabled(value) {
    if (typeof value !== 'boolean') throw Error('传送门开关参数无效。');
    enabled = value; tick(); refreshMiniMap(); return status();
  }
  function locate(key, mapId) {
    tick(); const state = status();
    if (!state.ready || !enabled || state.mapId !== mapId) throw Error('地图已变化，请重新选择当前入口。');
    if (root.__worldolCatalogBridge?.status()?.busy) throw Error('请先暂停采集，再点击传送门。');
    const npc = controller._proxy.model.npcList.find(n => keys.get(n) === key && current(n));
    if (!npc) throw Error('当前地图没有这个传送门。');
    const player = controller._mainPlayer?.vo;
    if (!controller._scene.isInitMap || !player?.isCanMove() || player.isAutoMoving) throw Error('请在可移动的地图中点击入口。');
    controller.onMoveToNpc({ body: npc.id });
    return { mapId, npcId: npc.id, name: npc.name, action: 'native-move-to-portal' };
  }
  const timer = options.poll === false ? null : root.setInterval(tick, 500);
  function dispose() {
    enabled = false; tick(); if (timer !== null) root.clearInterval(timer);
    for (const h of hooks) if (h.owner[h.name] === h.value) Object.defineProperty(h.owner, h.name, h.descriptor);
    hooks.length = 0;
  }
  tick();
  return Object.freeze({ status, setEnabled, locate, tick, dispose });
});

(() => {
  'use strict';
  // The canvas rectangle and DOM touch coordinates are both CSS pixels.
  // Android density and the renderer's backing-store scale must not enter
  // this conversion a second time.
  window.installOfflineViewport = function (engine) {
    const proto = engine?.web?.WebTouchHandler?.prototype;
    if (!proto || proto.offlineViewportRevision) return;
    const original = proto.getLocation;
    proto.offlineViewportRevision = 'canvas-bounds-touch-v1';
    proto.getLocation = function (event) {
      const rect = this.canvas.getBoundingClientRect();
      const stage = this.touch?.stage;
      const width = stage?.stageWidth, height = stage?.stageHeight;
      const x = Number.isFinite(event.clientX) ? event.clientX : event.pageX - (window.pageXOffset || 0);
      const y = Number.isFinite(event.clientY) ? event.clientY : event.pageY - (window.pageYOffset || 0);
      if (!(rect.width > 0 && rect.height > 0 && width > 0 && height > 0) || !Number.isFinite(x + y))
        return original.call(this, event);
      // Mouse events need the same identifier as Egret's original handler.
      if (event.identifier === undefined) event.identifier = 0;
      const u = (x - rect.left) / rect.width, v = (y - rect.top) / rect.height;
      let sx = u, sy = v;
      if (this.rotation === 90) { sx = v; sy = 1 - u; }
      else if (this.rotation === -90) { sx = 1 - v; sy = u; }
      return engine.$TempPoint.setTo(Math.round(sx * width), Math.round(sy * height));
    };

    let pending = false;
    function refresh() {
      pending = false;
      if (document.hidden) return;
      const context = engine.sys?.canvasHitTestBuffer?.context;
      const calculate = window.runEgretOptions?.calculateCanvasScaleFactor;
      if (context && calculate) {
        const scale = calculate(context);
        if (Number.isFinite(scale) && scale > 0) engine.sys.DisplayList.$canvasScaleFactor = scale;
      }
      for (const container of document.querySelectorAll('.egret-player'))
        container['egret-player']?.updateScreenSize();
    }
    function queue() {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(refresh);
    }
    window.worldolRefreshViewport = queue;
    for (const type of ['resize', 'orientationchange', 'pageshow', 'focus']) window.addEventListener(type, queue);
    for (const type of ['resize', 'scroll']) window.visualViewport?.addEventListener(type, queue);
    document.addEventListener('visibilitychange', queue);
    // The keyboard may finish its animation after focusout. Recheck once
    // after that transition as well as on actual visual viewport changes.
    document.addEventListener('focusout', () => { queue(); window.setTimeout(queue, 250); });
    if (window.ResizeObserver) {
      const observer = new window.ResizeObserver(queue);
      for (const container of document.querySelectorAll('.egret-player')) observer.observe(container);
    }
    queue();
  };
})();

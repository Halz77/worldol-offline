const NO_BODY = new Set([204, 205, 304]);
const MAX_BODY = 128 * 1024 * 1024;
const TOTAL_BUFFER = 512 * 1024 * 1024;

class Capture {
  constructor(webContents, archive, target = 'main') {
    this.wc = webContents; this.dbg = webContents.debugger; this.archive = archive; this.target = target;
    this.pending = new Set(); this.requests = new Map(); this.sockets = new Map(); this.sessions = new Set(['']);
    this.stopped = false; this.stopping = false;
    this.onMessage = (_event, method, params, sessionId = '') => {
      if (this.stopped) return;
      try { this.receive(method, params, sessionId); }
      catch (e) { archive.fail(e); }
    };
    this.onDetach = (_event, reason) => {
      if (!this.stopping && !this.stopped) archive.gap('debugger-detached', { reason }, this.target);
    };
  }
  label(sessionId) { return sessionId ? `${this.target}/${sessionId}` : this.target; }
  key(id, sessionId) { return `${sessionId}:${id}`; }
  lookup(requestId, sessionId) {
    const key = this.key(requestId, sessionId);
    if (this.requests.has(key)) return this.requests.get(key);
    // Chromium transfers an initial document/worker request from its parent to a new target.
    const matches = [...this.requests.entries()].filter(([, r]) => r.requestId === requestId && r.state === 'pending');
    if (matches.length === 1) {
      const [oldKey, request] = matches[0];
      this.requests.delete(oldKey); this.requests.set(key, request);
      this.archive.record('recorder.requestTargetChanged', { requestId,
        from: this.label(request.sessionId), to: this.label(sessionId) }, this.label(sessionId));
      request.sessionId = sessionId;
      return request;
    }
    return undefined;
  }
  track(promise) {
    const task = Promise.resolve(promise).catch(e => {
      if (!this.stopped) this.archive.gap('capture-command-failed', { message: e.message }, this.target);
    });
    this.pending.add(task); task.finally(() => this.pending.delete(task)); return task;
  }
  async command(method, params = {}, sessionId = '') {
    return this.dbg.sendCommand(method, params, sessionId || undefined);
  }
  async enable(sessionId = '') {
    const target = this.label(sessionId);
    try {
      await this.command('Network.enable', { maxTotalBufferSize: TOTAL_BUFFER,
        maxResourceBufferSize: MAX_BODY, maxPostDataSize: MAX_BODY, enableDurableMessages: true }, sessionId);
    } catch (e) {
      this.archive.record('recorder.compatibility', { feature: 'durableMessages', message: e.message }, target);
      await this.command('Network.enable', { maxTotalBufferSize: TOTAL_BUFFER,
        maxResourceBufferSize: MAX_BODY, maxPostDataSize: MAX_BODY }, sessionId);
    }
    // Reloads fetch resources again; responses are still the server's unmodified responses.
    await this.command('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    try {
      await this.command('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true,
        flatten: true, filter: [{ type: 'iframe' }, { type: 'worker' }, { type: 'shared_worker' },
          { type: 'service_worker' }, { exclude: true }] }, sessionId);
    } catch (e) { this.archive.gap('child-target-auto-attach-unavailable', { message: e.message }, target); }
    this.archive.record('recorder.targetReady', { maxResourceBufferSize: MAX_BODY }, target);
  }
  async start() {
    this.dbg.on('message', this.onMessage); this.dbg.on('detach', this.onDetach);
    this.dbg.attach('1.3');
    await this.enable();
  }
  receive(method, params, sessionId) {
    const target = this.label(sessionId);
    if (method === 'Target.attachedToTarget') {
      this.sessions.add(params.sessionId);
      this.archive.record(method, params, target);
      this.track((async () => {
        try { await this.enable(params.sessionId); }
        catch (e) { this.archive.gap('child-target-enable-failed', { message: e.message }, this.label(params.sessionId)); }
        finally {
          try { await this.command('Runtime.runIfWaitingForDebugger', {}, params.sessionId); }
          catch (e) { this.archive.gap('child-target-resume-failed', { message: e.message }, this.label(params.sessionId)); }
        }
      })());
      return;
    }
    if (method === 'Target.detachedFromTarget') {
      this.sessions.delete(params.sessionId);
      this.archive.record(method, params, target);
      return;
    }
    if (!method.startsWith('Network.')) return;
    const key = this.key(params.requestId, sessionId);
    if (method === 'Network.webSocketFrameSent' || method === 'Network.webSocketFrameReceived') {
      this.archive.websocket(method, params, target); return;
    }
    this.archive.record(method, params, target);
    if (method === 'Network.requestWillBeSent') {
      const previous = this.requests.get(key);
      const hop = previous ? previous.hop + 1 : 0;
      if (params.redirectResponse) this.archive.record('recorder.httpBodyAbsent', {
        requestId: params.requestId, hop: hop - 1, reason: 'redirect-body-not-exposed-by-browser',
        status: params.redirectResponse.status, url: params.redirectResponse.url }, target);
      const request = { url: params.request.url, method: params.request.method, hop,
        requestId: params.requestId, sessionId, state: 'pending', type: params.type };
      this.requests.set(key, request);
      if (params.request.hasPostData && params.request.postData === undefined) {
        this.track(this.command('Network.getRequestPostData', { requestId: params.requestId }, sessionId)
          .then(data => this.archive.record('recorder.requestPostData', { requestId: params.requestId, hop, ...data }, target))
          .catch(e => this.archive.gap('request-post-data-unavailable', { requestId: params.requestId, hop, message: e.message }, target)));
      }
    }
    if (method === 'Network.responseReceived') {
      const r = this.lookup(params.requestId, sessionId);
      if (r) { r.status = params.response.status; r.mimeType = params.response.mimeType; }
    }
    if (method === 'Network.loadingFinished') {
      const request = this.lookup(params.requestId, sessionId);
      if (request) request.state = 'finished';
      if (request?.method === 'HEAD' || NO_BODY.has(request?.status)) {
        this.archive.record('recorder.httpBodyAbsent', { requestId: params.requestId,
          hop: request.hop, reason: 'http-no-body', status: request.status }, target);
      } else {
        this.track(this.command('Network.getResponseBody', { requestId: params.requestId }, sessionId)
          .then(data => this.archive.body(params.requestId, data.body, data.base64Encoded, target,
            { hop: request?.hop ?? 0, url: request?.url, mimeType: request?.mimeType, status: request?.status }))
          .catch(e => this.archive.gap('http-response-body-unavailable', {
            requestId: params.requestId, hop: request?.hop ?? 0, url: request?.url, message: e.message }, target)));
      }
    }
    if (method === 'Network.loadingFailed') {
      const r = this.lookup(params.requestId, sessionId); if (r) r.state = 'failed';
      this.archive.emit('network-failure', { url: r?.url, error: params.errorText });
    }
    if (method === 'Network.webSocketCreated') this.sockets.set(key, { ...params, sessionId, open: true });
    if (method === 'Network.webSocketFrameError') {
      this.archive.emit('network-failure', { url: this.sockets.get(key)?.url,
        error: params.errorMessage, transport: 'websocket' });
    }
    if (method === 'Network.webSocketClosed') {
      const s = this.sockets.get(key); if (s) s.open = false;
    }
    if (method.startsWith('Network.webTransport') && method.endsWith('Created'))
      this.archive.gap('webtransport-payload-not-supported', { url: params.url }, target);
  }
  async stop(reason = 'user-stopped') {
    if (this.stopped) return;
    this.stopping = true;
    this.archive.record('recorder.captureCutoff', { reason }, this.target);
    this.stopped = true;
    let timer;
    const drained = await Promise.race([
      Promise.allSettled([...this.pending]).then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), 10000); })
    ]);
    clearTimeout(timer);
    if (!drained) this.archive.gap('pending-body-reads-at-stop', { count: this.pending.size }, this.target);
    // Body commands issued before the cutoff must finish before Network.disable clears browser buffers.
    for (const sessionId of [...this.sessions].reverse()) {
      try { await this.command('Network.disable', {}, sessionId); } catch { /* closed target */ }
    }
    for (const request of this.requests.values()) {
      if (request.state === 'pending') this.archive.gap('request-incomplete-at-capture-end', {
        requestId: request.requestId, url: request.url, reason }, this.label(request.sessionId));
    }
    this.archive.record('recorder.targetStopped', { reason, openSockets: [...this.sockets.values()].filter(s => s.open).length }, this.target);
    try { if (this.dbg.isAttached()) this.dbg.detach(); } catch { /* destroyed */ }
    this.dbg.removeListener('message', this.onMessage); this.dbg.removeListener('detach', this.onDetach);
  }
}
module.exports = { Capture };

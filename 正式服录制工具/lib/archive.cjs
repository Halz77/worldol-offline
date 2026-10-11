const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

function atomicJson(file, value) {
  const temp = `${file}.tmp`;
  const fd = fs.openSync(temp, 'w');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}

class Archive extends EventEmitter {
  constructor(root, metadata = {}, { rotateBytes = 32 * 1024 * 1024 } = {}) {
    super();
    this.id = new Date().toISOString().replace(/[:.]/g, '-') + '_' + crypto.randomBytes(3).toString('hex');
    this.dir = path.join(root, this.id);
    fs.mkdirSync(path.join(this.dir, 'blobs'), { recursive: true });
    fs.mkdirSync(path.join(this.dir, 'events'), { recursive: true });
    this.rotateBytes = rotateBytes;
    this.seq = 0; this.part = 0; this.partBytes = 0; this.closed = false; this.fatal = null;
    this.blobs = new Set();
    this.failedConnections = new Set();
    this.stats = { events: 0, requests: 0, responses: 0, bodies: 0, bodyBytes: 0,
      wsSent: 0, wsReceived: 0, wsBytes: 0, uniqueBlobBytes: 0, gaps: 0, networkFailures: 0, markers: 0 };
    this.metadata = { schema: 'worldol.capture.v1', id: this.id, startedAt: new Date().toISOString(),
      privacy: 'Raw local archive may contain credentials, role information and chat. Do not share raw files.',
      representation: 'Chromium-decoded HTTP bodies and WebSocket application messages; not a TCP/TLS pcap.',
      ...metadata };
    this.rotate();
    atomicJson(path.join(this.dir, 'session.json'), this.metadata);
    this.record('recorder.sessionStarted', { id: this.id });
    this.checkpoint();
    this.timer = setInterval(() => { try { this.checkpoint(); } catch (e) { this.fail(e); } }, 1000);
    this.timer.unref();
  }
  rotate() {
    if (this.fd != null) { fs.fsyncSync(this.fd); fs.closeSync(this.fd); }
    this.part++;
    this.fd = fs.openSync(path.join(this.dir, 'events', String(this.part).padStart(6, '0') + '.ndjson'), 'ax');
    this.partBytes = 0;
  }
  record(method, params = {}, target = 'main') {
    if (this.closed || this.fatal) return null;
    try {
      const row = { seq: ++this.seq, receivedAt: new Date().toISOString(), target, method, params };
      const line = JSON.stringify(row) + '\n';
      if (this.partBytes >= this.rotateBytes) this.rotate();
      fs.writeSync(this.fd, line, null, 'utf8');
      this.partBytes += Buffer.byteLength(line);
      this.stats.events++;
      if (method === 'Network.requestWillBeSent') this.stats.requests++;
      if (method === 'Network.responseReceived') this.stats.responses++;
      if (method === 'Network.loadingFailed' || method === 'Network.webSocketFrameError') {
        const key = `${target}:${params.requestId ?? row.seq}`;
        if (!this.failedConnections.has(key)) { this.failedConnections.add(key); this.stats.networkFailures++; }
      }
      if (method === 'recorder.gap') this.stats.gaps++;
      if (method === 'recorder.marker') this.stats.markers++;
      return row.seq;
    } catch (e) { this.fail(e); throw e; }
  }
  blob(bytes, representation) {
    if (this.closed || this.fatal) throw new Error('Archive is not writable');
    try {
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const relative = `blobs/${sha256.slice(0, 2)}/${sha256}.bin`;
      if (!this.blobs.has(sha256)) {
        const destination = path.join(this.dir, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const fd = fs.openSync(destination, 'wx');
        try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        this.blobs.add(sha256);
        this.stats.uniqueBlobBytes += bytes.length;
      }
      return { file: relative, sha256, bytes: bytes.length, representation };
    } catch (e) { this.fail(e); throw e; }
  }
  body(requestId, body, base64Encoded, target, info = {}) {
    if (this.closed || this.fatal) return;
    const bytes = Buffer.from(body, base64Encoded ? 'base64' : 'utf8');
    const ref = this.blob(bytes, base64Encoded ? 'chromium-body-binary' : 'chromium-body-text-utf8');
    this.stats.bodies++; this.stats.bodyBytes += bytes.length;
    this.record('recorder.httpBody', { requestId, base64Encoded, ...info, body: ref }, target);
  }
  websocket(method, params, target) {
    const frame = params.response;
    const bytes = Buffer.from(frame.payloadData, frame.opcode === 1 ? 'utf8' : 'base64');
    const ref = this.blob(bytes, frame.opcode === 1 ? 'websocket-text-utf8' : 'websocket-binary');
    const { payloadData, ...rest } = frame;
    if (method === 'Network.webSocketFrameSent') this.stats.wsSent++; else this.stats.wsReceived++;
    this.stats.wsBytes += bytes.length;
    const seq = this.record(method, { ...params, response: { ...rest, payload: ref } }, target);
    // Notify the optional public-definition indexer only after the exact frame is saved.
    if (seq != null) this.emit('packet-saved', { method, bytes, seq, ref, target,
      requestId: params.requestId, opcode: frame.opcode, at: new Date().toISOString() });
  }
  gap(reason, details = {}, target) { this.record('recorder.gap', { reason, ...details }, target); }
  snapshot() {
    return { ...this.metadata, status: this.fatal ? 'error' : this.closed ? 'saved' : 'recording',
      lastEvent: this.seq, journalParts: this.part, updatedAt: new Date().toISOString(),
      stats: { ...this.stats }, error: this.fatal, folder: this.dir };
  }
  checkpoint() {
    if (this.closed || this.fatal) return;
    fs.fsyncSync(this.fd);
    atomicJson(path.join(this.dir, 'status.json'), this.snapshot());
  }
  fail(e) {
    if (this.fatal) return;
    this.fatal = String(e.message || e);
    clearInterval(this.timer);
    this.emit('fatal', this.fatal);
  }
  finish(reason = 'user-stopped') {
    if (this.closed) return this.snapshot();
    clearInterval(this.timer);
    this.record('recorder.sessionEnded', { reason });
    this.metadata.endedAt = new Date().toISOString();
    this.metadata.endReason = reason;
    this.closed = true;
    if (this.fd != null) { fs.fsyncSync(this.fd); fs.closeSync(this.fd); this.fd = null; }
    atomicJson(path.join(this.dir, 'status.json'), this.snapshot());
    atomicJson(path.join(this.dir, 'session.json'), this.metadata);
    return this.snapshot();
  }
}
module.exports = { Archive, atomicJson };

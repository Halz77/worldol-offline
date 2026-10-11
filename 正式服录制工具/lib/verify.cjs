const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function verify(folder) {
  const files = fs.readdirSync(path.join(folder, 'events')).filter(name => /^\d+\.ndjson$/.test(name)).sort();
  let expected = 1, wsSent = 0, wsReceived = 0, bodies = 0, ended = false;
  const errors = [], refs = new Map(), gaps = [], failures = [], markers = [], hosts = new Set(), failedConnections = new Set();
  for (const name of files) {
    const text = fs.readFileSync(path.join(folder, 'events', name), 'utf8');
    if (text && !text.endsWith('\n')) errors.push(`${name}: incomplete last line`);
    for (const line of text.split('\n').filter(Boolean)) {
      let row; try { row = JSON.parse(line); } catch { errors.push(`${name}: invalid JSON`); continue; }
      if (row.seq !== expected) errors.push(`sequence expected ${expected}, found ${row.seq}`);
      expected = row.seq + 1;
      if (row.method === 'recorder.httpBody') { bodies++; refs.set(row.params.body.file, row.params.body); }
      if (row.method === 'Network.webSocketFrameSent') wsSent++;
      if (row.method === 'Network.webSocketFrameReceived') wsReceived++;
      if (row.params.response?.payload) refs.set(row.params.response.payload.file, row.params.response.payload);
      if (row.method === 'recorder.gap') gaps.push({ seq: row.seq, reason: row.params.reason });
      if (row.method === 'Network.loadingFailed' || row.method === 'Network.webSocketFrameError') {
        const key = `${row.target}:${row.params.requestId ?? row.seq}`;
        if (!failedConnections.has(key)) {
          failedConnections.add(key);
          failures.push({ seq: row.seq, transport: row.method === 'Network.webSocketFrameError' ? 'websocket' : 'http',
            error: row.params.errorText || row.params.errorMessage });
        }
      }
      if (row.method === 'recorder.marker') {
        markers.push({ seq: row.seq, text: row.params.text, category: row.params.category });
        if (row.params.screenshot) refs.set(row.params.screenshot.file, row.params.screenshot);
      }
      if (row.method === 'recorder.sessionEnded') ended = true;
      if (row.params.request?.url || row.params.url) {
        try { hosts.add(new URL(row.params.request?.url || row.params.url).host); } catch { /* non-network URL */ }
      }
    }
  }
  let verifiedBytes = 0;
  for (const ref of refs.values()) {
    if (!/^blobs\/[a-f0-9]{2}\/[a-f0-9]{64}\.bin$/.test(ref.file) && !/^details\/screenshots\/\d+-[a-f0-9]{6}\.png$/.test(ref.file)) { errors.push('Invalid archive reference path'); continue; }
    try {
      const bytes = fs.readFileSync(path.join(folder, ref.file));
      if (bytes.length !== ref.bytes) errors.push(`${ref.file}: length mismatch`);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== ref.sha256) errors.push(`${ref.file}: SHA256 mismatch`);
      verifiedBytes += bytes.length;
    } catch (e) { errors.push(`${ref.file}: ${e.code}`); }
  }
  return { schema: 'worldol.capture.audit.v1', checkedAt: new Date().toISOString(),
    events: expected - 1, wsSent, wsReceived, bodies, uniqueBlobs: refs.size, verifiedBytes,
    cleanEnd: ended, integrityPassed: errors.length === 0, errors, captureGaps: gaps,
    networkFailures: failures, markers, hosts: [...hosts].sort() };
}
module.exports = { verify };

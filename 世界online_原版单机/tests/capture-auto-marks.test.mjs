import assert from 'node:assert/strict';
import test from 'node:test';
import {createAutoMarkerState, inspectFrame} from '../tools/capture-auto-marks.mjs';

function frame(type, payload = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(4 + payload.length);
  bytes.writeUInt16BE(bytes.length, 0);
  bytes.writeUInt16BE(type, 2);
  payload.copy(bytes, 4);
  return bytes;
}

function scene(payload) {
  return Buffer.concat([Buffer.from([0]), payload]);
}

function int(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(value, 0);
  return bytes;
}

function short(value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value, 0);
  return bytes;
}

function utf16be(text) {
  const content = Buffer.from(text, 'utf16le');
  content.swap16();
  const length = Buffer.alloc(3);
  length.writeUIntBE(text.length, 0, 3);
  return Buffer.concat([length, content]);
}

function inspect(state, type, payload, method = 'Network.webSocketFrameReceived', connection = 'main:1') {
  return inspectFrame(state, {method, bytes: frame(type, payload), connection});
}

test('地图切换只标记一次，分配地图读 mapId', () => {
  const state = createAutoMarkerState();
  const normal = scene(Buffer.concat([int(37), short(0)]));
  const first = inspect(state, 10503, normal);
  assert.equal(first.kind, 'map');
  assert.equal(first.mapId, 37);
  assert.match(first.text, /进入地图 37/);
  assert.equal(inspect(state, 10503, normal), null, '同一张地图不重复标记');

  const allocated = scene(Buffer.concat([int(12345), short(88)]));
  const second = inspect(state, 10510, allocated);
  assert.equal(second.mapId, 88);
});

test('地图 2 跳过 31 字节前缀，10523 跳过可选 6 字节', () => {
  const state = createAutoMarkerState();
  const type2 = Buffer.concat([Buffer.alloc(1), Buffer.alloc(31), int(42), short(0)]);
  assert.equal(inspect(state, 2, type2).mapId, 42);

  const type10523 = Buffer.concat([
    Buffer.from([0, 1]),
    Buffer.alloc(6),
    int(20000),
    short(99)
  ]);
  const mark = inspect(state, 10523, type10523, 'Network.webSocketFrameReceived', 'main:2');
  assert.equal(mark.mapId, 99);
});

test('地图列表里的名字会写进地图标记', () => {
  const state = createAutoMarkerState();
  const mapList = Buffer.concat([
    Buffer.from([0, 1]),
    short(37),
    utf16be('风雪之城'),
    utf16be(''),
    Buffer.from([0, 0])
  ]);
  assert.equal(inspect(state, 10522, mapList), null);
  const mark = inspect(state, 10506, scene(Buffer.concat([int(37), short(0)])), 'Network.webSocketFrameReceived', 'main:3');
  assert.equal(mark.text, '自动：进入地图 37（风雪之城）');
});

test('战斗开始与结束读取 group id', () => {
  const state = createAutoMarkerState();
  const start = inspect(state, 12501, short(1234), 'Network.webSocketFrameSent');
  assert.equal(start.kind, 'battle-start');
  assert.equal(start.groupId, 1234);

  const settle = inspect(state, 12502, Buffer.concat([Buffer.alloc(18), short(1234)]), 'Network.webSocketFrameSent');
  assert.equal(settle.kind, 'battle-end');
  assert.equal(settle.groupId, 1234);
});

test('接任务与交任务读取任务号、NPC 和选项', () => {
  const state = createAutoMarkerState();
  const accept = inspect(state, 14502, Buffer.concat([short(50), short(1001)]), 'Network.webSocketFrameSent');
  assert.equal(accept.kind, 'task-accept');
  assert.equal(accept.missionId, 1001);
  assert.equal(accept.npcId, 50);

  const deliver = inspect(state, 14503, Buffer.concat([short(50), short(1001), int(7)]), 'Network.webSocketFrameSent');
  assert.equal(deliver.kind, 'task-deliver');
  assert.equal(deliver.selectedItem, 7);
});

test('坏帧与不认识的协议安静返回 null', () => {
  const state = createAutoMarkerState();
  assert.equal(inspectFrame(state, {method: 'Network.webSocketFrameReceived', bytes: Buffer.from([1, 2])}), null);
  assert.equal(inspect(state, 16051, Buffer.from([0])), null);
  assert.equal(inspect(state, 10503, Buffer.from([0, 1])), null, '场景字段不完整');
});

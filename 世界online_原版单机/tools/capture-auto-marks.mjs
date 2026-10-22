/**
 * 官服抓包自动标记。
 *
 * 只读 WebSocket 帧头（前 4 字节：总长度 + 协议号）和少量公开字段，
 * 在以下时机生成 `recorder.marker`：
 *   - 进入/切换地图（2 / 10503 / 10506 / 10510 / 10523）
 *   - 战斗开始（发送 12501，读 group id）
 *   - 战斗结束（发送 12502，读 group id）
 *   - 接任务（发送 14502） / 交任务（发送 14503）
 *
 * 标记只用于定位，不改变原始帧；解析失败时安静返回 null。
 */

const PROTOCOL_BATTLE_ENTER = 12501;
const PROTOCOL_BATTLE_SETTLE = 12502;
const PROTOCOL_TASK_ACCEPT = 14502;
const PROTOCOL_TASK_DELIVER = 14503;
const PROTOCOL_MAP_LIST = 10522;
const SCENE_PROTOCOLS = new Set([2, 10503, 10506, 10510, 10523]);

class FrameReader {
  constructor(bytes) { this.b = bytes; this.pos = 0; }
  need(n) {
    if (this.pos + n > this.b.length) throw new Error('frame payload truncated');
  }
  u8() { this.need(1); return this.b[this.pos++]; }
  u16() { this.need(2); const value = this.b.readUInt16BE(this.pos); this.pos += 2; return value; }
  i32() { this.need(4); const value = this.b.readInt32BE(this.pos); this.pos += 4; return value; }
  u24() { this.need(3); const value = this.b.readUIntBE(this.pos, 3); this.pos += 3; return value; }
  skip(n) { this.need(n); this.pos += n; }
  utf16be() {
    const length = this.u24();
    this.need(length * 2);
    const bytes = Buffer.from(this.b.subarray(this.pos, this.pos + length * 2));
    this.pos += length * 2;
    bytes.swap16();
    return bytes.toString('utf16le');
  }
}

/** 与客户端 0004 模块一致的分配地图号范围：城市 10000—19999、国家 20000—29999、镜像 30000—31999。 */
function isAllocatedMap(id) {
  return id >= 10000 && id <= 31999;
}

function readSceneMapId(payload, type) {
  const r = new FrameReader(payload);
  if (r.u8() >= 128) return null; // getByte() 是有符号字节，负数表示服务端错误
  if (type === 2) r.skip(4 + 5 + 9 + 5 + 3 + 5);
  if (type === 10523 && r.u8() === 1) r.skip(2 + 4);
  const instanceId = r.i32();
  return isAllocatedMap(instanceId) ? r.u16() : instanceId;
}

function readMapNames(payload, names) {
  const r = new FrameReader(payload);
  if (r.u8() >= 128) return;
  const count = r.u8();
  for (let index = 0; index < count; index += 1) {
    const id = r.u16();
    const name = r.utf16be();
    r.utf16be(); // info
    r.u8();      // state
    r.u8();      // isNeedItem
    names.set(id, name);
  }
}

function readBattleGroup(payload, type) {
  const r = new FrameReader(payload);
  if (type === PROTOCOL_BATTLE_ENTER) return r.u16();
  r.skip(18);
  return r.u16();
}

function readTask(payload, withItem) {
  const r = new FrameReader(payload);
  const npcId = r.u16();
  const missionId = r.u16();
  const selectedItem = withItem ? r.i32() : null;
  return { npcId, missionId, selectedItem };
}

export function createAutoMarkerState() {
  return { connections: new Map(), mapNames: new Map() };
}

function connectionState(state, key) {
  let value = state.connections.get(key);
  if (!value) {
    value = { mapId: null };
    state.connections.set(key, value);
  }
  return value;
}

/**
 * 检查一帧 WebSocket 二进制消息。
 * @param {{connections: Map, mapNames: Map}} state createAutoMarkerState() 的返回值
 * @param {{method: string, bytes: Buffer, connection: string}} frame
 * @returns {{text: string, kind: string, protocol: number, [key: string]: any}|null}
 */
export function inspectFrame(state, { method, bytes, connection = 'default' }) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return null;
  if (bytes.readUInt16BE(0) !== bytes.length) return null;
  const type = bytes.readUInt16BE(2);
  const payload = bytes.subarray(4);
  const sent = method === 'Network.webSocketFrameSent';
  const current = connectionState(state, connection);

  try {
    if (!sent && type === PROTOCOL_MAP_LIST) {
      readMapNames(payload, state.mapNames);
      return null;
    }

    if (!sent && SCENE_PROTOCOLS.has(type)) {
      const mapId = readSceneMapId(payload, type);
      if (mapId == null || mapId === current.mapId) return null;
      current.mapId = mapId;
      const name = state.mapNames.get(mapId);
      return {
        text: `自动：进入地图 ${mapId}${name ? `（${name}）` : ''}`,
        kind: 'map',
        protocol: type,
        mapId,
        mapName: name || ''
      };
    }

    if (!sent && type === PROTOCOL_BATTLE_ENTER) return null;
    if (sent && type === PROTOCOL_BATTLE_ENTER) {
      const groupId = readBattleGroup(payload, type);
      return {
        text: `自动：战斗开始 group=${groupId}`,
        kind: 'battle-start',
        protocol: type,
        groupId
      };
    }
    if (sent && type === PROTOCOL_BATTLE_SETTLE) {
      const groupId = readBattleGroup(payload, type);
      return {
        text: `自动：战斗结束 group=${groupId}`,
        kind: 'battle-end',
        protocol: type,
        groupId
      };
    }
    if (sent && type === PROTOCOL_TASK_ACCEPT) {
      const task = readTask(payload, false);
      return {
        text: `自动：接任务 mission=${task.missionId} npc=${task.npcId}`,
        kind: 'task-accept',
        protocol: type,
        ...task
      };
    }
    if (sent && type === PROTOCOL_TASK_DELIVER) {
      const task = readTask(payload, true);
      return {
        text: `自动：交任务 mission=${task.missionId} npc=${task.npcId}`,
        kind: 'task-deliver',
        protocol: type,
        ...task
      };
    }
  } catch {
    // 帧不完整或不是预期布局：宁可不标记，也不要打断抓包。
    return null;
  }
  return null;
}

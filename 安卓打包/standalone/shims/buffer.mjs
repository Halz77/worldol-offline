/*
 * Buffer shim —— 浏览器版，只实现本项目实际用到的子集
 *
 * 用到的构造：Buffer.from(string[,enc]) / Buffer.from(typedArray) /
 *            Buffer.alloc(n) / Buffer.concat([...])
 * 用到的实例：length、下标读写、subarray/slice、swap16/swap32、toString(utf8|utf16le|base64)、
 *            readInt8/readUInt8、readInt16BE/readUInt16BE、readInt32BE/readUInt32BE、
 *            readBigInt64BE/readBigUInt64BE、readUIntBE、writeUInt8/writeInt8、
 *            writeUInt16BE/writeInt16BE、writeUInt32BE/writeInt32BE、writeBigInt64BE、writeUIntBE、
 *            copy、equals、indexOf、fill
 *
 * 注意：Buffer 是 Uint8Array 的子类，但本 shim 用「包装 + 代理属性」实现，
 * 因为 readBigInt64BE 等需要 DataView，而 Uint8Array 的 byteOffset 会让 DataView 变复杂。
 * 这里让每个 Buffer 自己持有一个独立的 ArrayBuffer，byteOffset 恒为 0。
 */

const textDecoderUtf8 = new TextDecoder('utf-8');
const textEncoderUtf8 = new TextEncoder();

function utf8ToBytes(text) {
  return textEncoderUtf8.encode(text);
}

function bytesToUtf8(bytes) {
  return textDecoderUtf8.decode(bytes);
}

function utf16leToBytes(text) {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[i * 2] = code & 0xff;
    out[i * 2 + 1] = code >> 8;
  }
  return out;
}

function bytesToUtf16le(bytes) {
  let text = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    text += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  }
  return text;
}

function base64ToBytes(text) {
  const binary = atob(String(text).replace(/[\r\n\s]/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

class BufferShim extends Uint8Array {
  // ---- 静态构造 ----------------------------------------------------------
  static from(value, encoding) {
    if (typeof value === 'string') {
      const bytes = encoding === 'base64' ? base64ToBytes(value)
        : encoding === 'utf16le' || encoding === 'ucs2' ? utf16leToBytes(value)
          : encoding === 'hex' ? hexToBytes(value)
            : utf8ToBytes(value);
      return new BufferShim(bytes);
    }
    if (value instanceof ArrayBuffer) return new BufferShim(new Uint8Array(value));
    if (ArrayBuffer.isView(value)) return new BufferShim(value); // 复制，和 Node 一致
    if (Array.isArray(value)) return new BufferShim(new Uint8Array(value));
    throw new TypeError('Buffer.from: 不支持的类型 ' + typeof value);
  }

  static alloc(size, fillValue) {
    const out = new BufferShim(new Uint8Array(size));
    if (fillValue !== undefined) out.fill(fillValue);
    return out;
  }

  static allocUnsafe(size) {
    return new BufferShim(new Uint8Array(size));
  }

  static concat(list, totalLength) {
    const parts = list.map((item) => (item instanceof Uint8Array ? item : BufferShim.from(item)));
    const length = totalLength === undefined
      ? parts.reduce((sum, part) => sum + part.length, 0)
      : totalLength;
    const out = new BufferShim(new Uint8Array(length));
    let offset = 0;
    for (const part of parts) {
      if (offset >= length) break;
      const slice = part.subarray(0, Math.min(part.length, length - offset));
      out.set(slice, offset);
      offset += slice.length;
    }
    return out;
  }

  static isBuffer(value) {
    return value instanceof BufferShim;
  }

  static byteLength(value, encoding) {
    if (typeof value !== 'string') return value.byteLength;
    if (encoding === 'utf16le' || encoding === 'ucs2') return value.length * 2;
    if (encoding === 'base64') return base64ToBytes(value).length;
    return utf8ToBytes(value).length;
  }

  constructor(bytes, byteOffset, length) {
    // bytes: Uint8Array | number | ArrayBuffer。
    // 注意：Uint8Array 子类在 subarray/slice 时会用 species 构造出
    // (buffer, byteOffset, length) 形式，这里必须分开处理，否则会拿到整个 buffer。
    if (typeof bytes === 'number') {
      super(new Uint8Array(bytes));
    } else if (bytes instanceof ArrayBuffer) {
      if (byteOffset === undefined) super(new Uint8Array(bytes.slice(0)));
      else super(new Uint8Array(bytes.slice(byteOffset, byteOffset + (length === undefined ? bytes.byteLength - byteOffset : length))));
    } else if (bytes instanceof Uint8Array) {
      // 重要：拷贝，不是共享视图，保证 byteOffset === 0
      super(new Uint8Array(bytes));
    } else {
      super(bytes);
    }
    this._view = new DataView(this.buffer, 0, this.byteLength);
    this._syncView(this.byteLength);
  }

  /**
   * Uint8Array 的底层 buffer 可能被复用来承载新数据（例如 swap16 就地修改），
   * 这里统一把 DataView 重新对齐到当前长度。
   */
  _syncView(length) {
    if (!this._view || this._view.byteLength !== length || this._view.buffer !== this.buffer) {
      this._view = new DataView(this.buffer, 0, length);
    }
  }

  // ---- 视图 --------------------------------------------------------------
  subarray(start, end) {
    const [from, to] = this._range(start, end);
    const out = BufferShim.alloc(to - from);
    for (let i = from; i < to; i++) out[i - from] = this[i];
    return out;
  }

  slice(start, end) {
    return this.subarray(start, end);
  }

  _range(start, end) {
    const length = this.length;
    let from = start === undefined ? 0 : Math.trunc(start);
    let to = end === undefined ? length : Math.trunc(end);
    if (from < 0) from = Math.max(length + from, 0);
    if (to < 0) to = Math.max(length + to, 0);
    from = Math.min(from, length);
    to = Math.min(to, length);
    if (to < from) to = from;
    return [from, to];
  }

  swap16() {
    const out = new BufferShim(this);
    for (let i = 0; i + 1 < out.length; i += 2) {
      const a = out[i]; out[i] = out[i + 1]; out[i + 1] = a;
    }
    return out;
  }

  swap32() {
    const out = new BufferShim(this);
    for (let i = 0; i + 3 < out.length; i += 4) {
      const a = out[i], b = out[i + 1];
      out[i] = out[i + 3]; out[i + 1] = out[i + 2]; out[i + 2] = b; out[i + 3] = a;
    }
    return out;
  }

  // ---- 读取 --------------------------------------------------------------
  readInt8(offset) { return this._view.getInt8(offset); }
  readUInt8(offset) { return this._view.getUint8(offset); }
  readInt16BE(offset) { return this._view.getInt16(offset, false); }
  readUInt16BE(offset) { return this._view.getUint16(offset, false); }
  readInt16LE(offset) { return this._view.getInt16(offset, true); }
  readUInt16LE(offset) { return this._view.getUint16(offset, true); }
  readInt32BE(offset) { return this._view.getInt32(offset, false); }
  readUInt32BE(offset) { return this._view.getUint32(offset, false); }
  readInt32LE(offset) { return this._view.getInt32(offset, true); }
  readUInt32LE(offset) { return this._view.getUint32(offset, true); }
  readBigInt64BE(offset) { return this._view.getBigInt64(offset, false); }
  readBigUInt64BE(offset) { return this._view.getBigUint64(offset, false); }
  readBigInt64LE(offset) { return this._view.getBigInt64(offset, true); }
  readUIntBE(offset, byteLength) {
    let value = 0;
    for (let i = 0; i < byteLength; i++) value = value * 256 + this[offset + i];
    return value;
  }

  // ---- 写入 --------------------------------------------------------------
  writeUInt8(value, offset) { this._view.setUint8(offset, value & 0xff); return offset + 1; }
  writeInt8(value, offset) { this._view.setInt8(offset, value & 0xff); return offset + 1; }
  writeUInt16BE(value, offset) { this._view.setUint16(offset, value & 0xffff, false); return offset + 2; }
  writeInt16BE(value, offset) { this._view.setInt16(offset, value & 0xffff, false); return offset + 2; }
  writeUInt32BE(value, offset) { this._view.setUint32(offset, value >>> 0, false); return offset + 4; }
  writeInt32BE(value, offset) { this._view.setInt32(offset, value | 0, false); return offset + 4; }
  writeBigInt64BE(value, offset) { this._view.setBigInt64(offset, BigInt(value), false); return offset + 8; }
  writeBigUInt64BE(value, offset) { this._view.setBigUint64(offset, BigInt(value), false); return offset + 8; }
  writeUIntBE(value, offset, byteLength) {
    let rest = Number(value);
    for (let i = byteLength - 1; i >= 0; i--) { this[offset + i] = rest & 0xff; rest = Math.floor(rest / 256); }
    return offset + byteLength;
  }

  write(text, offset = 0, length, encoding) {
    if (typeof text !== 'string') return 0;
    const bytes = encoding === 'utf16le' || encoding === 'ucs2' ? utf16leToBytes(text) : utf8ToBytes(text);
    const count = Math.min(length === undefined ? bytes.length : length, this.length - offset, bytes.length);
    this.set(bytes.subarray(0, count), offset);
    return count;
  }

  // ---- 转换 --------------------------------------------------------------
  toString(encoding, start, end) {
    const view = this.subarray(start || 0, end === undefined ? this.length : end);
    if (encoding === 'utf16le' || encoding === 'ucs2') return bytesToUtf16le(view);
    if (encoding === 'base64') return bytesToBase64(view);
    if (encoding === 'hex') return bytesToHex(view);
    return bytesToUtf8(view);
  }

  copy(target, targetStart = 0, sourceStart = 0, sourceEnd = this.length) {
    const part = this.subarray(sourceStart, sourceEnd);
    target.set(part, targetStart);
    return part.length;
  }

  equals(other) {
    if (!other || other.length !== this.length) return false;
    for (let i = 0; i < this.length; i++) if (this[i] !== other[i]) return false;
    return true;
  }

  indexOf(value, byteOffset = 0) {
    const needle = typeof value === 'string' ? utf8ToBytes(value) : value;
    outer: for (let i = byteOffset; i + needle.length <= this.length; i++) {
      for (let j = 0; j < needle.length; j++) if (this[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }

  fill(value, start = 0, end = this.length) {
    if (typeof value === 'string') value = value.charCodeAt(0);
    for (let i = start; i < end; i++) this[i] = value & 0xff;
    return this;
  }
}

function hexToBytes(text) {
  const clean = String(text);
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += bytes[i].toString(16).padStart(2, '0');
  return text;
}

export const Buffer = BufferShim;
export default BufferShim;

// 让 lib/*.mjs 里裸用的 Buffer 也能找到（bundle 后没有 Node 全局）
if (typeof window !== 'undefined' && !window.Buffer) window.Buffer = BufferShim;

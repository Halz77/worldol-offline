// v305 Message payloads use big-endian numbers and length-prefixed UTF-16.
export class Writer {
  constructor() { this.parts = []; }
  raw(value) { this.parts.push(Buffer.from(value)); return this; }
  byte(n) { const b=Buffer.alloc(1); b.writeUInt8(Number(n)&255); return this.raw(b); }
  bool(n) { return this.byte(n?1:0); }
  short(n) { const b=Buffer.alloc(2); b.writeUInt16BE(Number(n)&65535); return this.raw(b); }
  int(n) { const b=Buffer.alloc(4); b.writeInt32BE(Number(n)|0); return this.raw(b); }
  long(n) { const b=Buffer.alloc(8); b.writeBigInt64BE(BigInt.asIntN(64,BigInt(n))); return this.raw(b); }
  length(n) { if(n<0 || n>0xffffff) throw Error('Invalid length'); const b=Buffer.alloc(3); b.writeUIntBE(n,0,3); return this.raw(b); }
  string(value='') { const s=String(value); this.length(s.length); const b=Buffer.alloc(s.length*2); for(let i=0;i<s.length;i++)b.writeUInt16BE(s.charCodeAt(i),i*2); return this.raw(b); }
  utf(value='') { const b=Buffer.from(String(value),'utf8'); if(b.length>65535)throw Error('UTF string too long'); return this.short(b.length).raw(b); }
  bytes(value) { const b=value instanceof Writer?value.done():Buffer.from(value); return this.length(b.length).raw(b); }
  done() { return Buffer.concat(this.parts); }
}
export class Reader {
  constructor(b) { this.b=Buffer.from(b); this.pos=0; }
  take(n) { if(n<0 || this.pos+n>this.b.length)throw Error(`Truncated packet at ${this.pos}, need ${n}, length ${this.b.length}`); const p=this.pos; this.pos+=n; return p; }
  byte() { return this.b.readInt8(this.take(1)); }
  bool() { return this.byte()!==0; }
  short() { return this.b.readInt16BE(this.take(2)); }
  int() { return this.b.readInt32BE(this.take(4)); }
  long() { return this.b.readBigInt64BE(this.take(8)); }
  length() { return this.b.readUIntBE(this.take(3),3); }
  string() { const n=this.length(); const p=this.take(n*2); return this.b.subarray(p,p+n*2).swap16().toString('utf16le'); }
  utf() { const n=this.b.readUInt16BE(this.take(2)); const p=this.take(n); return this.b.subarray(p,p+n).toString('utf8'); }
  bytes() { const n=this.length(); const p=this.take(n); return this.b.subarray(p,p+n); }
}
// Local-only framing; the original Message IDs and payloads are preserved.
export function frame(type,body=Buffer.alloc(0)) { return new Writer().int(type).raw(body instanceof Writer?body.done():body).done(); }
export function unframe(data) { const r=new Reader(data); return {type:r.int(),body:r.b.subarray(4)}; }

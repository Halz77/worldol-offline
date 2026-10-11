#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""精简重建：仅保留 arm64-v8a；extractNativeLibs 翻转为 true；注入字体补丁。"""
import json, os, struct, zipfile

SRC = '/workspace/fontmod/src/世界OL单机.apk'
OUT = '/workspace/fontmod/build/slim_unaligned.apk'
NEWJS = '/workspace/fontmod/build/module180.js'
ASSET_DIR = '/workspace/fontmod/build/assets'
NUMMAP = json.load(open('/workspace/fontmod/patch/manifest_num.json'))

BUNDLE = 'assets/nodejs-project/client/js/ff/fff570bb4753f056432680e781d827dc.js'
ANALYSIS = 'assets/nodejs-project/analysis/modules/0180.js'
MANIFEST = 'assets/nodejs-project/client/v/gd/305.json'
DROP = {'META-INF/ANDROID.RSA', 'META-INF/ANDROID.SF', 'META-INF/MANIFEST.MF',
        'META-INF/ANDROID.DSA', 'META-INF/ANDROID.EC'}
SKIP_PREFIX = ('lib/x86_64/', 'lib/armeabi-v7a/')

src = zipfile.ZipFile(SRC)

# ---------- 1. 翻转 AndroidManifest.xml 的 extractNativeLibs ----------
mfdata = bytearray(src.read('AndroidManifest.xml'))

def string_pool_index(data, target):
    """解析 binary XML 的字符串池，返回 target 字符串的索引。"""
    # XML 头: type(2)=0x0003 headerSize(2)=8 size(4) -> 第一个 chunk 在偏移 8
    sp = 8
    ctype, chsz, csize, count, styleCnt, flags, strStart, styleStart = struct.unpack_from('<HHIIIIII', data, sp)
    utf8 = bool(flags & 0x100)
    base = sp + strStart
    for idx in range(count):
        off = base + struct.unpack_from('<I', data, sp + chsz + idx * 4)[0]
        if utf8:
            # u16len, u8len, bytes
            n = data[off]; p = off + 1
            if n & 0x80:
                n = ((n & 0x7f) << 8) | data[off + 1]; p = off + 2
            s = bytes(data[p:p + n])
        else:
            n = struct.unpack_from('<H', data, off)[0]; p = off + 2
            if n & 0x8000:
                n = ((n & 0x7fff) << 16) | struct.unpack_from('<H', data, off + 2)[0]; p = off + 4
            s = bytes(data[p:p + n * 2]).decode('utf-16-le', 'ignore').encode('utf-8')
        if s == target:
            return idx
    return None

def flip_attr(data, sp):
    """把 extractNativeLibs 属性值 false -> true（INT_BOOLEAN 0 -> 0xFFFFFFFF）。"""
    idx = string_pool_index(data, b'extractNativeLibs')
    assert idx is not None, '字符串池中未找到 extractNativeLibs'
    needle = struct.pack('<I', idx)
    hits = 0
    pos = 0
    while True:
        pos = data.find(needle, pos)
        if pos < 0:
            break
        # Attribute 结构: ns(4) name(4) rawValue(4) [size(2) res0(1) dataType(1)] data(4)
        dataType = data[pos + 15]
        val = struct.unpack_from('<I', data, pos + 16)[0]
        if dataType == 0x12 and val in (0, 0xFFFFFFFF):
            struct.pack_into('<I', data, pos + 16, 0xFFFFFFFF)
            hits += 1
            print('  命中 @%d dataType=0x%02x %s -> true' % (pos, dataType, 'false' if val == 0 else 'true'))
        pos += 4
    return hits

print('翻转 extractNativeLibs:')
n = flip_attr(mfdata, None)
assert n >= 1, '未找到 extractNativeLibs 属性'
print('  共翻转 %d 处' % n)

# ---------- 2. 补丁客户端脚本 ----------
newjs = open(NEWJS, encoding='utf-8').read().strip()
oldjs = src.read(BUNDLE).decode('utf-8')
oldmod = src.read(ANALYSIS).decode('utf-8').strip()
assert oldmod in oldjs
patched = oldjs.replace(oldmod, newjs)
print('bundle 打补丁完成: %d -> %d 字符' % (len(oldjs), len(patched)))

# ---------- 3. 资源清单 ----------
mj = json.loads(src.read(MANIFEST).decode('utf-8'))
mj['url']['assets']['num'] = NUMMAP
newmf = json.dumps(mj, ensure_ascii=False, separators=(',', ':'))
print('清单新增 num 映射 %d 条' % len(NUMMAP))

repl = {BUNDLE: patched.encode('utf-8'), ANALYSIS: newjs.encode('utf-8'),
        MANIFEST: newmf.encode('utf-8'),
        'AndroidManifest.xml': bytes(mfdata)}

if os.path.exists(OUT):
    os.remove(OUT)
out = zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, allowZip64=True, compresslevel=6)
added = set()
infos = src.infolist()
skipped = 0
for idx, i in enumerate(infos):
    fn = i.filename
    if fn in DROP or fn.startswith(SKIP_PREFIX):
        if fn.startswith(SKIP_PREFIX):
            skipped += 1
        continue
    data = repl.get(fn) or src.read(i)
    zi = zipfile.ZipInfo(fn, date_time=i.date_time)
    zi.compress_type = i.compress_type
    zi.external_attr = i.external_attr
    zi.internal_attr = i.internal_attr
    zi.create_system = i.create_system
    if i.comment:
        zi.comment = i.comment
    out.writestr(zi, data)
    added.add(fn)
for name, h in NUMMAP.items():
    path = 'assets/nodejs-project/client/assets/%s/%s.png' % (h[:2], h)
    assert path not in added, path
    zi = zipfile.ZipInfo(path, date_time=(1981, 1, 1, 1, 1, 1))
    zi.compress_type = zipfile.ZIP_STORED
    zi.external_attr = 0o644 << 16
    zi.create_system = 0
    out.writestr(zi, open(os.path.join(ASSET_DIR, h + '.png'), 'rb').read())
out.close()
print('跳过 %d 个非 arm64 库文件' % skipped)
print('完成:', OUT, os.path.getsize(OUT))

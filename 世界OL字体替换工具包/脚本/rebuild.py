#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""重建 APK：注入字体资源 + 打补丁后的客户端脚本，并更新资源清单。"""
import json, os, shutil, sys, zipfile

SRC = '/workspace/fontmod/src/世界OL单机.apk'
OUT = '/workspace/fontmod/build/unaligned.apk'
NEWJS = '/workspace/fontmod/build/module180.js'
ASSET_DIR = '/workspace/fontmod/build/assets'
NUMMAP = json.load(open('/workspace/fontmod/patch/manifest_num.json'))

BUNDLE = 'assets/nodejs-project/client/js/ff/fff570bb4753f056432680e781d827dc.js'
ANALYSIS = 'assets/nodejs-project/analysis/modules/0180.js'
MANIFEST = 'assets/nodejs-project/client/v/gd/305.json'
DROP = {'META-INF/ANDROID.RSA', 'META-INF/ANDROID.SF', 'META-INF/MANIFEST.MF',
        'META-INF/ANDROID.DSA', 'META-INF/ANDROID.EC'}

src = zipfile.ZipFile(SRC)
zi_map = {i.filename: i for i in src.infolist()}

# ---------- 1. 打补丁后的客户端脚本 ----------
newjs = open(NEWJS, encoding='utf-8').read().strip()
oldjs = src.read(BUNDLE).decode('utf-8')
oldmod = src.read(ANALYSIS).decode('utf-8').strip()
assert oldmod in oldjs, '原模块文本未在 bundle 中找到'
patched = oldjs.replace(oldmod, newjs)
assert patched != oldjs
print('bundle 打补丁完成: %d -> %d 字节' % (len(oldjs), len(patched)))
# 校验补丁后 JS 语法（用 node --check 由外部脚本完成）

# ---------- 2. 资源清单 ----------
mf = json.loads(src.read(MANIFEST).decode('utf-8'))
assert 'num' not in mf['url']['assets'], 'num 段已存在'
mf['url']['assets']['num'] = NUMMAP
newmf = json.dumps(mf, ensure_ascii=False, separators=(',', ':'))
print('清单新增 num 映射 %d 条' % len(NUMMAP))

# ---------- 3. 写出新 APK ----------
repl = {BUNDLE: patched.encode('utf-8'), ANALYSIS: newjs.encode('utf-8'), MANIFEST: newmf.encode('utf-8')}
added = set()
if os.path.exists(OUT):
    os.remove(OUT)
out = zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, allowZip64=True, compresslevel=6)

infos = src.infolist()
for idx, i in enumerate(infos):
    if i.filename in DROP:
        continue
    if i.filename in repl:
        data = repl[i.filename]
    else:
        data = src.read(i)
    zi = zipfile.ZipInfo(i.filename, date_time=i.date_time)
    zi.compress_type = i.compress_type
    zi.external_attr = i.external_attr
    zi.internal_attr = i.internal_attr
    zi.create_system = i.create_system
    if i.comment:
        zi.comment = i.comment
    out.writestr(zi, data)
    added.add(i.filename)
    if idx % 2000 == 0:
        print('  %d/%d' % (idx, len(infos)), flush=True)

# 新字体资源（与既有 client/assets/*.png 一致，使用 STORED）
for name, h in NUMMAP.items():
    path = 'assets/nodejs-project/client/assets/%s/%s.png' % (h[:2], h)
    assert path not in added, path
    zi = zipfile.ZipInfo(path, date_time=(1981, 1, 1, 1, 1, 1))
    zi.compress_type = zipfile.ZIP_STORED
    zi.external_attr = 0o644 << 16
    zi.create_system = 0
    out.writestr(zi, open(os.path.join(ASSET_DIR, h + '.png'), 'rb').read())
print('写入字体资源 %d 个' % len(NUMMAP))

out.close()
print('完成:', OUT, os.path.getsize(OUT))

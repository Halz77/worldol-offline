#!/usr/bin/env python3
"""补齐 assets/sprite_fragment 下缺失的帧表（*.json）。

★ 背景：素材初次导出时漏掉了 1025 个部件图的 json 帧表（原版每个部件都有）。
  缺表时 SpriteComposer 只能把整张图集当一帧画：
    - 坐骑 14169 恶魔之翼（224x212、7 帧）被画成好几对翅膀；
    - 14229 等 255 个被 model 引用的图集全部错位。
  原版 305.json 里有权威映射：`url.assets.sprite.fragment/<id>.json -> hash`，
  对应文件在 `client/assets/<hash前2位>/<hash>.json`。

用法（在 godot-next 目录下）：
    python tools/restore_fragment_tables.py --dry
    python tools/restore_fragment_tables.py

只补「godot-next 已有同名 PNG、但没有 json」的项；原版也没有的会列出来。
数据源默认是仓库里的原版客户端，可用 --client 指定。
"""
import argparse
import io
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
REPO = os.path.dirname(PROJECT)
DEFAULT_CLIENT = os.path.join(REPO, "世界online_原版单机", "client")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", default=DEFAULT_CLIENT)
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    manifest = os.path.join(args.client, "v", "gd", "305.json")
    if not os.path.isfile(manifest):
        print("找不到原版清单:", manifest)
        return 1
    table = json.load(io.open(manifest, encoding="utf-8"))
    table = table["url"]["assets"]["sprite"]["fragment"]

    frag_dir = os.path.join(PROJECT, "assets", "sprite_fragment")
    copied = 0
    skipped_no_png = 0
    missing_source = []
    for name, digest in table.items():
        if not name.endswith(".json"):
            continue
        frag_id = name[:-5]
        dst = os.path.join(frag_dir, name)
        if os.path.exists(dst):
            continue
        if not os.path.exists(os.path.join(frag_dir, frag_id + ".png")):
            skipped_no_png += 1
            continue
        src = os.path.join(args.client, "assets", digest[:2], digest + ".json")
        if not os.path.isfile(src):
            missing_source.append(name)
            continue
        if not args.dry:
            shutil.copyfile(src, dst)
        copied += 1

    print("补帧表:", copied, "(dry)" if args.dry else "")
    print("跳过：没有同名 PNG 的", skipped_no_png)
    if missing_source:
        print("原版也缺源文件:", len(missing_source), missing_source[:10])
    return 0


if __name__ == "__main__":
    sys.exit(main())

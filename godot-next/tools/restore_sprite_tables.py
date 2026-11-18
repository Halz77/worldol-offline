#!/usr/bin/env python3
"""补齐 assets/sprite_fragment 与 assets/sprite_model 下缺失的 json。

★ 背景：素材初次导出时漏了 1025 个部件图帧表 + 417 个 model 表。
  缺部件帧表 → 整张图集被当一帧画（恶魔之翼 14169 变成好几对翅膀）；
  缺 model 表   → Equipment 查不到坐骑 model，直接保持基础造型（恶魔之翼装备后没变化，
                  因为无武器姿势的 743/943 缺失；摩托 758 在，所以摩托正常）。
  原版 305.json 有权威映射：
    `url.assets.sprite.fragment/<id>.json -> hash`
    `url.assets.sprite.model/<id>.json    -> hash`
  对应文件在 `client/assets/<hash前2位>/<hash>.json`。

用法（在 godot-next 目录下）：
    python tools/restore_sprite_tables.py --dry
    python tools/restore_sprite_tables.py

部件只补「已有同名 PNG、但没有 json」的项（没有 PNG 的表补了也用不上）；
model 只要缺 json 就补。原版也没有的会列出来。
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

KINDS = ("fragment", "model")


def restore_kind(client: str, manifest_kind: dict, kind: str, dry: bool) -> None:
    dst_dir = os.path.join(PROJECT, "assets", "sprite_" + kind)
    copied = 0
    skipped_no_png = 0
    missing_source = []
    for name, digest in manifest_kind.items():
        if not name.endswith(".json"):
            continue
        dst = os.path.join(dst_dir, name)
        if os.path.exists(dst):
            continue
        if kind == "fragment" and not os.path.exists(
                os.path.join(dst_dir, name[:-5] + ".png")):
            skipped_no_png += 1
            continue
        src = os.path.join(client, "assets", digest[:2], digest + ".json")
        if not os.path.isfile(src):
            missing_source.append(name)
            continue
        if not dry:
            shutil.copyfile(src, dst)
        copied += 1
    print("%-8s 补 %d%s" % (kind, copied, "（dry）" if dry else ""))
    if skipped_no_png:
        print("         跳过：没有同名 PNG 的", skipped_no_png)
    if missing_source:
        print("         原版也缺源文件:", len(missing_source), missing_source[:10])


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
    sprite = table["url"]["assets"]["sprite"]
    for kind in KINDS:
        restore_kind(args.client, sprite.get(kind, {}), kind, args.dry)
    return 0


if __name__ == "__main__":
    sys.exit(main())

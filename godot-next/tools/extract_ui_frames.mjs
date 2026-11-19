#!/usr/bin/env node
/**
 * 从原版客户端资源表里抽出「UI 图标的子区域表」，落成本工程的 sidecar JSON + 合并索引。
 *
 * 为什么要它：assets/ui/*.png 是多张图集（一张 2001×255 的图上摆几十个不同尺寸的图标），
 * 光有 PNG 没法知道「第 30 号图标在图上的哪一块」。原版把这些矩形存在
 * client/assets/5f/5ff45c2399542794.json（一个 JSON 数组，每项是 stringify 过的资源表）里，
 * 这里把它们抽出来，游戏侧就不用依赖原版目录。
 *
 * 产物：
 *   godot-next/assets/ui/<atlas>.json   与该 PNG 同名的帧表（name → {x,y,w,h,offX,offY,sourceW,sourceH}）
 *   godot-next/data/compiled/itemIcons.json   合并索引：图标号 → {atlas, x, y, w, h}
 *
 * 用法：node tools/extract_ui_frames.mjs [原版资源表路径]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_TABLE =
  'F:/QQ-data/1286973586/FileRecv/源码/世界OL_单机源码_独立包_20260923/世界OL_源码/' +
  '世界online_原版单机/client/assets/5f/5ff45c2399542794.json';
const TABLE = process.argv[2] || process.env.WORLDOL_UI_TABLE || DEFAULT_TABLE;
const UI_DIR = path.join(ROOT, 'assets', 'ui');
const ICON_INDEX = path.join(ROOT, 'data', 'compiled', 'itemIcons.json');

/** 只抽图标相关图集；以后要接背包/战斗界面，把更多名字加进来即可。 */
const WANTED = /^resource\/ui\/(item_icon\d*|item_mount|item_pet)\.json$/;

if (!fs.existsSync(TABLE)) {
  console.error('[icons] 找不到原版资源表：' + TABLE);
  process.exit(1);
}

const entries = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
const tables = new Map();
for (const raw of entries) {
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    continue;
  }
  const key = record?.key;
  if (!key || !WANTED.test(key)) continue;
  const name = path.basename(key, '.json');
  const frames = record?.value?.frames;
  if (!frames) continue;
  tables.set(name, frames);
}

if (tables.size === 0) {
  console.error('[icons] 资源表里没找到任何 item_icon 系列图集');
  process.exit(1);
}

const merged = {};
const summary = [];
for (const [name, frames] of [...tables.entries()].sort()) {
  const png = path.join(UI_DIR, name + '.png');
  if (!fs.existsSync(png)) {
    console.warn('[icons] 缺少图片，跳过：' + png);
    continue;
  }
  fs.writeFileSync(path.join(UI_DIR, name + '.json'), JSON.stringify({ frames }, null, '\t'));
  let n = 0;
  for (const [id, f] of Object.entries(frames)) {
    if (!/^\d+$/.test(id)) continue;
    merged[id] = { atlas: name, x: f.x, y: f.y, w: f.w, h: f.h };
    n++;
  }
  summary.push(name + '=' + n);
}

fs.writeFileSync(
  ICON_INDEX,
  JSON.stringify(
    { generated: new Date().toISOString(), source: path.basename(TABLE), icons: merged },
    null,
    0,
  ),
);

const ids = Object.keys(merged).map(Number);
console.log('[icons] 图集：' + summary.join('  '));
console.log('[icons] 合并索引 ' + ids.length + ' 个图标（号段 ' + Math.min(...ids) + '–' + Math.max(...ids) + '）→ ' + ICON_INDEX);

#!/usr/bin/env node
/**
 * 生成 怪物编辑器.html 的内嵌数据（第 95 版）。
 *
 * 编辑器是纯静态页（双击就能用），所以数据得预先塞进三个 <script type="application/json"> 块：
 *   #monster-data  怪物属性表（属性编辑用）
 *   #ai-data       怪物 AI（每只怪 1—N 轮：技能1/技能2/目标类型/台词）
 *   #skill-data    技能索引 [id, level, 名称, 类型]，给技能选择器与名称回显
 *
 * 数据源只有 data/official-v305.json（不再是手抄）：
 *   node tools/build-monster-editor-data.mjs
 * 只改这三个块，其它内容（样式/脚本/手写说明）原样保留。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data', 'official-v305.json');
const PAGE = path.join(ROOT, '怪物编辑器.html');

/** 怪物属性字段（顺序与 Monster 抓包字节一致；编辑器 UI 只认这些键）。 */
const MONSTER_FIELDS = [
  'id', 'name', 'level', 'monstertype', 'icon1', 'hpMax', 'mpMax', 'speed',
  'atkType', 'atkMin', 'atkMax', 'atk_time',
  'dodge', 'atk_str', 'atk_str_nearby', 'atk_str_range', 'atk_agi', 'atk_agi_nearby', 'atk_agi_range', 'atk_magic',
  'def_str', 'def_str_nearby', 'def_str_range', 'def_agi', 'def_agi_nearby', 'def_agi_range', 'def_magic',
  'hitrate', 'hitMagic', 'critical', 'ignoreCritical', 'criticalDmg',
  'ignore_back', 'ignore_magic_back', 'ignore_block', 'ignore_insight', 'ignore_touch', 'ignore_wil',
  'wil', 'tough', 'block', 'brkArmor', 'insight', 'def_field', 'back', 'magic_back',
  'life_absorption', 'mana_absorption', 'magic_penetration', 'bornStatus', 'newReflection'
];

const official = JSON.parse(fs.readFileSync(DATA, 'utf8'));

const monsters = (official.monsters || []).map(m => {
  const row = {};
  for (const key of MONSTER_FIELDS) row[key] = m[key];
  // bornStatus 是 Long，抓包里已经是字符串；统一成字符串，编辑器按位算时会 Number 一下
  row.bornStatus = String(m.bornStatus ?? '0');
  return row;
});

const ai = {};
for (const row of official.ai || []) {
  const rounds = [];
  const count = Array.isArray(row.conType) ? row.conType.length : 0;
  for (let i = 0; i < count; i++) {
    const s1 = row.skill1?.[i] || {id: 0, level: 0};
    const s2 = row.skill2?.[i] || {id: 0, level: 0};
    rounds.push([
      row.conType[i] | 0,
      row.conValue?.[i] | 0,
      row.msg?.[i] ?? '',
      s1.id | 0, s1.level | 0,
      s2.id | 0, s2.level | 0,
      row.targetType?.[i] | 0
    ]);
  }
  if (rounds.length) ai[String(row.id)] = rounds;
}

const skills = (official.skills || [])
  .map(s => [s.id | 0, s.level | 0, String(s.name || ''), s.type | 0])
  .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

const blocks = {
  'monster-data': JSON.stringify(monsters),
  'ai-data': JSON.stringify(ai),
  'skill-data': JSON.stringify(skills)
};

let html = fs.readFileSync(PAGE, 'utf8');
let touched = 0;
for (const [id, text] of Object.entries(blocks)) {
  const re = new RegExp(`(<script id="${id}" type="application/json">)([\\s\\S]*?)(</script>)`);
  if (re.test(html)) {
    html = html.replace(re, (_, head, __, tail) => head + text + tail);
    touched++;
  } else {
    // 第一次：插在 monster-data 之后
    const anchor = /(<script id="monster-data" type="application\/json">[\s\S]*?<\/script>)/;
    if (!anchor.test(html)) throw Error('找不到 #monster-data 锚点，编辑器结构变了？');
    html = html.replace(anchor, (m) => `${m}\n<script id="${id}" type="application/json">${text}</script>`);
    touched++;
  }
}
fs.writeFileSync(PAGE, html);

const size = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(0) + 'KB';
console.log(`怪物 ${monsters.length} 只 / AI ${Object.keys(ai).length} 条 / 技能 ${skills.length} 条 → 写入 ${path.basename(PAGE)}（${touched} 块）`);
for (const [id, text] of Object.entries(blocks)) console.log(`  #${id}: ${size(text)}`);

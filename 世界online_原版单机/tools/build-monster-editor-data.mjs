#!/usr/bin/env node
/**
 * 生成 怪物编辑器.html 的内嵌数据（第 97 版）。
 *
 * ★ 数据源不是 data/official-v305.json，而是**运行时**的 official（lib/official-data.mjs）。
 *   原因：抓包文件里只有 404 只怪，而 ensure() 会补进录制扩展、守卫挑战、问剑十一峰、
 *   十殿阎罗、本地编队克隆等一大批怪 —— 运行时是 900 多只。编辑器只读抓包文件的话，
 *   这些 BOSS 全都不在列表里（玩家反馈过）。
 *
 * 编辑器是纯静态页（双击就能用），所以数据得预先塞进三个 <script type="application/json"> 块：
 *   #monster-data  怪物属性表（属性编辑用）
 *   #ai-data       怪物 AI（每只怪 1—N 轮：条件/技能1/技能2/目标）
 *   #skill-data    技能索引 [id, level, 名称, 类型]，给技能选择器与名称回显
 *
 * 用法：node tools/build-monster-editor-data.mjs
 * 只改这三个块，其它内容（样式/脚本/手写说明）原样保留。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {official} from '../lib/official-data.mjs';
import {aiRounds, aiFromWire} from '../lib/ai-wire.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

// 运行时数据（会跑完 ensure() 的全部补丁：录制扩展 / 守卫挑战 / 问剑十一峰 / 本地编队…）
const runtimeMonsters = official.monsters;
const runtimeAi = official.ai;
const runtimeSkills = official.skills;

const monsters = runtimeMonsters
  .filter(m => m && Number(m.id) > 0)
  .sort((a, b) => Number(a.id) - Number(b.id))
  .map(m => {
    const row = {};
    for (const key of MONSTER_FIELDS) row[key] = m[key] === undefined ? 0 : m[key];
    row.name = String(m.name ?? '');
    // bornStatus 是 Long：抓包里是字符串，统一成字符串（编辑器按位算时再 Number）
    row.bornStatus = String(m.bornStatus ?? '0');
    return row;
  });

// AI：优先用「被覆盖前的原始字节」（local-monster-ai-overrides 会留 __originalWire），
// 否则直接用行里的字段。这样编辑器里的「原版」永远是原版，不会把自己上次的修改当成基值。
const ai = {};
for (const row of runtimeAi) {
  const id = Number(row && row.id);
  if (!Number.isInteger(id) || id <= 0) continue;
  const base = row.__originalWire ? aiFromWire(Buffer.from(row.__originalWire, 'base64')) : null;
  const rounds = base ? base.rounds : aiRounds(row);
  if (!rounds.length) continue;
  ai[String(id)] = rounds.map(r => [
    r.conType | 0,
    r.conValue | 0,
    r.msg ?? '',
    r.skill1.id | 0, r.skill1.level | 0,
    r.skill2.id | 0, r.skill2.level | 0,
    r.targetType | 0
  ]);
}

const skills = runtimeSkills
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
console.log('页面大小：' + (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0) + 'KB');

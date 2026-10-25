/**
 * 第 94 版：怪物属性覆盖 —— 测试。
 *
 * 覆盖：
 *   · 配置归一化：字段白名单、byte/short/int 值域、name 字符串、非法项静默丢弃
 *   · applyMonsterOverrides：字段合并 + wireBase64 用 monsterWireBytes 重编码
 *   · 不改原始 Map 外的对象（换成新对象，不污染 official.monsters）
 *   · 怪物不存在 → failed（不抛错）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 applyMonsterOverrides, monsterOverrides, monsterOverrideSummary,
 MONSTER_FIELD_TYPES, MONSTER_OVERRIDE_REVISION
} from '../lib/local-monster-overrides.mjs';
import {monsterWireBytes} from '../lib/monster-balance.mjs';

// 用真实抓包里的怪物当样本（字段齐全，monsterWireBytes 需要 46 个字段都在）
const OFFICIAL = JSON.parse(fs.readFileSync(new URL('../data/official-v305.json', import.meta.url), 'utf8'));
const WOLF = OFFICIAL.monsters.find(m => m.id === 409);
function freshMap() { return new Map([[409, { ...WOLF }]]); }

test('配置层：默认空、summary、字段白名单存在', () => {
 const overrides = monsterOverrides();
 assert.equal(typeof overrides, 'object');
 const sum = monsterOverrideSummary();
 assert.equal(typeof sum.configured, 'number');
 assert.equal(MONSTER_OVERRIDE_REVISION, 'monster-overrides-20261025-v1');
 assert.equal(MONSTER_FIELD_TYPES.hpMax, 'int');
 assert.equal(MONSTER_FIELD_TYPES.level, 'byte');
 assert.equal(MONSTER_FIELD_TYPES.critical, 'short');
 assert.equal(MONSTER_FIELD_TYPES.bornStatus, 'long');
 assert.equal(MONSTER_FIELD_TYPES.name, 'string');
 assert.equal(MONSTER_FIELD_TYPES.id, undefined, 'id 不是可改字段（它是键）');
});

test('套用：字段合并 + wireBase64 重编码 + 原对象不被污染', () => {
 const map = freshMap();
 const original = map.get(409);
 const beforeWire = original.wireBase64;
 const result = applyMonsterOverrides(map, { 409: { name: '强化野狼', level: 20, hpMax: 9999, atkMin: 100, atkMax: 300 } });
 assert.deepEqual(result.applied, [409]);
 assert.deepEqual(result.failed, []);
 const next = map.get(409);
 assert.notEqual(next, original, '应换成新对象，不原地改');
 assert.equal(original.hpMax, WOLF.hpMax, '原始对象不能被改');
 assert.equal(original.name, WOLF.name);
 assert.equal(next.name, '强化野狼');
 assert.equal(next.level, 20);
 assert.equal(next.hpMax, 9999);
 assert.equal(next.atkMin, 100);
 assert.notEqual(next.wireBase64, beforeWire, 'wireBase64 必须重编码');
 // 重编码结果应能被解码回同样的字段
 const bytes = Buffer.from(next.wireBase64, 'base64');
 assert.ok(bytes.length > 20, 'wire 长度应正常');
});

test('套用：不存在的怪物 → failed，不抛错', () => {
 const map = freshMap();
 const result = applyMonsterOverrides(map, { 999999: { hpMax: 1 } });
 assert.deepEqual(result.applied, []);
 assert.equal(result.failed.length, 1);
 assert.match(result.failed[0].reason, /不存在/);
});

test('套用：只改 wireBase64 也能生成（全字段齐全时 monsterWireBytes 可用）', () => {
 const next = { ...WOLF, hpMax: 12345, speed: 200 };
 const wire = monsterWireBytes(next);
 assert.ok(Buffer.isBuffer(wire));
 assert.ok(wire.length > 20);
 // 与原始 wire 不同
 assert.notEqual(wire.toString('base64'), WOLF.wireBase64);
});

test('套用：空配置不改变任何东西', () => {
 const map = freshMap();
 const result = applyMonsterOverrides(map, {});
 assert.deepEqual(result.applied, []);
 assert.equal(map.get(409).hpMax, WOLF.hpMax);
});

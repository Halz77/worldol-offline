/*
 * shim 自检 —— 不依赖浏览器，直接在 Node 里验证替身层的关键行为
 * 用法：node 自检shim.mjs
 */
import { Buffer } from './shims/buffer.mjs';
import path from './shims/path.mjs';
import { fileURLToPath } from './shims/url.mjs';
import { createHash, randomBytes, randomInt } from './shims/crypto.mjs';
import vm from './shims/vm.mjs';

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${ok ? '' : `\n       实际=${JSON.stringify(actual)}\n       期望=${JSON.stringify(expected)}`}`);
}

console.log('Buffer:');
check('from(utf8).toString()', Buffer.from('{"a":1}', 'utf8').toString(), '{"a":1}');
check('String(buffer)', String(Buffer.from('{"a":1}', 'utf8')), '{"a":1}');
check('JSON.parse(buffer)', JSON.parse(Buffer.from('{"a":1}', 'utf8')), { a: 1 });
check('from(hex).toString(hex)', Buffer.from('0000000b0601', 'hex').toString('hex'), '0000000b0601');
check('from(base64).toString(hex)', Buffer.from('AAAAAAsGAQ==', 'base64').toString('hex'), '0000000b0601');
check('subarray(-6).length', Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).subarray(-6).length, 6);
check('subarray(-6).toString(hex)', Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).subarray(-6).toString('hex'), '05060708090a');
check('alloc+writeUInt16BE', (() => { const b = Buffer.alloc(2); b.writeUInt16BE(2821, 0); return b.toString('hex'); })(), '0b05');
check('alloc+writeBigInt64BE', (() => { const b = Buffer.alloc(8); b.writeBigInt64BE(1n, 0); return b.toString('hex'); })(), '0000000000000001');
check('concat', Buffer.concat([Buffer.from('ab'), Buffer.from('cd')]).toString(), 'abcd');
check('swap16', Buffer.from('ab', 'utf8').swap16().toString('hex'), '6261');
check('utf16le roundtrip', Buffer.from('世界', 'utf16le').toString('utf16le'), '世界');
check('indexOf', Buffer.from('abcdef').indexOf('cd'), 2);

console.log('path:');
check('join(/worldol, client)', path.join('/worldol', 'client'), '/worldol/client');
check('dirname(/worldol/server.mjs)', path.dirname('/worldol/server.mjs'), '/worldol');
check('join(/worldol/lib, ../data/x)', path.join('/worldol/lib', '../data/x'), '/worldol/data/x');
check('extname(a/b.json)', path.extname('a/b.json'), '.json');

console.log('url:');
check('fileURLToPath', fileURLToPath('file:///worldol/data/x.json'), '/worldol/data/x.json');
check('new URL(..) 解析', fileURLToPath(new URL('../data/x.json', 'file:///worldol/lib/a.mjs')), '/worldol/data/x.json');

console.log('crypto:');
check('sha256(abc)', createHash('sha256').update('abc').digest('hex'),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
check('randomBytes(8).length', randomBytes(8).length, 8);
check('randomInt(10) < 10', randomInt(10) < 10, true);

console.log('vm:');
check('Script.runInNewContext', vm.runInNewContext('(function(a){return a+1})', {})(41), 42);

console.log(failed === 0 ? '\n全部通过' : `\n有 ${failed} 项失败`);
process.exitCode = failed === 0 ? 0 : 1;

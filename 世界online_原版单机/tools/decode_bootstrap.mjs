import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {parse} from 'acorn';
import {simple} from 'acorn-walk';
import * as prettier from 'prettier';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'../H5客户端_v305_20260920/files/resgood/gd.js');
const source=fs.readFileSync(file,'utf8');let decoder;
simple(parse(source,{ecmaVersion:'latest'}),{VariableDeclarator(n){if(n.id.name==='u'&&n.init?.type==='CallExpression'&&n.init.callee.type==='FunctionExpression'&&source.slice(n.init.start,n.init.end).includes('1747021870'))decoder=n.init;}});
if(!decoder)throw Error('Decoder not found');
// Only the reviewed pure string permutation expression is evaluated, not gd.js.
const strings=new vm.Script('('+source.slice(decoder.start,decoder.end)+')').runInNewContext({}, {timeout:1000});
if(!Array.isArray(strings)||!strings.every(x=>typeof x==='string'))throw Error('Unexpected string table');
const decoded=source.replace(/\bu\[(\d+)\]/g,(raw,index)=>strings[index]===undefined?raw:JSON.stringify(strings[index]));
fs.writeFileSync(path.join(root,'analysis/gd.decoded.js'),await prettier.format(decoded,{parser:'babel'}));
fs.writeFileSync(path.join(root,'analysis/gd-strings.json'),JSON.stringify(strings,null,2));
console.log('Decoded strings:',strings.length);

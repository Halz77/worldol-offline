import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import * as prettier from 'prettier';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'client/js/fe/fe1c2239d66f05e144a55389328c85ef.js'),'utf8');
const ast=parse(source,{ecmaVersion:'latest'});
const init=ast.body[0].expression.argument.callee.body.body[0].declarations.find(n=>n.id.name==='c').init;
// Only the inspected constant string permutation runs, never the client bundle.
const strings=new vm.Script('('+source.slice(init.start,init.end)+')').runInNewContext({}, {timeout:1000});
if(!Array.isArray(strings)||!strings.every(s=>typeof s==='string'))throw Error('Invalid table');
const decoded=source.replace(/\bc\[(\d+)\]/g,(raw,id)=>strings[id]===undefined?raw:JSON.stringify(strings[id]));
fs.writeFileSync(path.join(root,'analysis/protobuf.decoded.js'),await prettier.format(decoded,{parser:'babel'}));
fs.writeFileSync(path.join(root,'analysis/protobuf-strings.json'),JSON.stringify(strings,null,2));
console.log(`Decoded ${strings.length} strings; original bundle unchanged.`);

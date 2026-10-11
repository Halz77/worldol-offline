import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {simple} from 'acorn-walk';
import * as prettier from 'prettier';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const raw=path.join(root,'../H5客户端_v305_20260920/files/resgood/js/ff/fff570bb4753f056432680e781d827dc.js');
const source=fs.readFileSync(raw,'utf8');
const ast=parse(source,{ecmaVersion:'latest'});let modules=[];
simple(ast,{ArrayExpression(node){if(node.elements.length>modules.length&&node.elements.every(x=>x?.type==='FunctionExpression'))modules=node.elements;}});
const directory=path.join(root,'analysis/modules');fs.mkdirSync(directory,{recursive:true});
const terms=['window["Launcher"]','window.Launcher','window.go','window.gg','window.gs','createLocalBattle=function','new WebSocket','CG_LOGIN_ACTOR','CG_LOGIN_LOGIN','CG_LOGIN_SELECTACTOR','onLogin','loadV=function','sdkLogin','writeUTF','getReceiveMsg=function','CG_LOGIN_GETACTORLIST'];
const summary=[];
for(const [id,node] of modules.entries()){
  const text=source.slice(node.start,node.end);fs.writeFileSync(path.join(directory,String(id).padStart(4,'0')+'.js'),text);
  const deps=[...new Set([...text.matchAll(/\bi\((\d+)\)/g)].map(m=>+m[1]))];
  const matches=terms.filter(term=>text.includes(term));
  const methods=[...text.matchAll(/(?:\.prototype)?\.([\w$]+)=function/g)].map(m=>m[1]);
  summary.push({id,start:node.start,bytes:node.end-node.start,deps,terms:matches,methods});
  if(matches.length)console.log(JSON.stringify({id,bytes:node.end-node.start,matches,methods:methods.slice(0,18)}));
}
fs.writeFileSync(path.join(root,'analysis/module-index.json'),JSON.stringify(summary,null,2));
console.log('MODULES',modules.length);
for(const id of [0,4,5,29,...summary.filter(m=>m.terms.some(t=>['loadV=function','new WebSocket','CG_LOGIN_LOGIN','window.Launcher','sdkLogin'].includes(t))).map(m=>m.id)]){
  const file=path.join(directory,String(id).padStart(4,'0')+'.js');if(!fs.existsSync(file))continue;
  const formatted=await prettier.format('('+fs.readFileSync(file,'utf8')+')',{parser:'babel'});
  fs.writeFileSync(file,formatted);
}

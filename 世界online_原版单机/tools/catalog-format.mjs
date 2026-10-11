import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'acorn';
import {simple} from 'acorn-walk';
import {decoders} from './capture-decoders.mjs';

// Only the reviewed text formatter runs, with no browser, network or game state.
export function powerFormatter(root){
 const d=decoders(root),e={...d.constants};
 simple(parse(fs.readFileSync(path.join(root,'analysis/modules/0004.js'),'utf8'),{ecmaVersion:'latest'}),{AssignmentExpression(n){
  if(n.left.type==='MemberExpression'&&n.left.property.name==='bufferText'&&n.right.type==='ArrayExpression')e.bufferText=n.right.elements.map(x=>x.value);
 }});
 if(!e.bufferText?.length)throw Error('Native status names missing');
 e.getBufferString=d.native(4,'getBufferString',{e});
 class Text {constructor(){this.values=[];}append(value){this.values.push(value);return this;}toString(){return this.values.join('');}}
 const format=d.native(4,'getPowerDesc',{e,r:{default:Text},s:{Tool:{getPointValue:(n,places)=>String(n/10**places)}}});
 return (id,value,skill=null)=>{const text=format(id,value,skill);return text&&!text.startsWith('未知power_')?text:`属性 ${id}：${value}`;};
}

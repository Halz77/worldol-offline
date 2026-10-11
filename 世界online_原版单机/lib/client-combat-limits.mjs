import {parse} from 'acorn';
import {simple} from 'acorn-walk';

export const combatLimitsRevision='unlimited-status-5m-physical-10m-magic-v1';
export const characterAttackLimits=Object.freeze({physical:5000000,magic:10000000});

// Apply the same reviewed native calculation to the browser and server scoring.
// v305 model types 3 and 10 are characters and legion characters. Pets inherit
// these methods too, so retain their existing bounds (and all unrelated stats).
export function patchCharacterAttackMethod(source){
 const seen=new Set();
 const patched=source.replace(/\bcase\s+_\.ModelConst\.(ATK_STR|ATK_AGI|ATK_MAGIC|ATK_STR_NEARBY|ATK_STR_RANGE|ATK_AGI_NEARBY|ATK_AGI_RANGE)\s*:([\s\S]*?)(?=\bcase\s+|\bdefault\s*:)/g,(block,key)=>{
  if(seen.has(key))throw Error('v305 character attack patch duplicate: '+key);
  seen.add(key);
  const cap=key==='ATK_MAGIC'?characterAttackLimits.magic:characterAttackLimits.physical;
  // Magic has a separate 2m preview bound; do not leave that clamp in place.
  const pattern=key==='ATK_MAGIC'
   ? /y\["default"\]\.isPreviewBeta\s*\?\s*2e6\s*:\s*_\.ModelConst\.MAX_OTHER_ATTRIBUTE/g
   : /_\.ModelConst\.MAX_OTHER_ATTRIBUTE/g;
  let count=0;
  const result=block.replace(pattern,(old,offset)=>{
   if(block.slice(0,offset).trimEnd().endsWith('-'))return old;
   count++;
   return '(3===this.type||10===this.type?'+cap+':('+old+'))';
  });
  if(count!==1)throw Error('v305 character attack patch mismatch: '+key);
  return result;
 });
 if(seen.size!==7)throw Error('v305 character attack cases missing');
 return patched;
}

function replaceOnce(source,from,to){
 if(source.split(from).length!==2)throw Error('v305 combat limits patch mismatch: '+from);
 return source.replace(from,to);
}

export function patchCombatLimits(source){
 let modules=[];
 simple(parse(source,{ecmaVersion:'latest'}),{ArrayExpression(node){
  if(node.elements.length>modules.length&&node.elements.every(n=>n?.type==='FunctionExpression'))modules=node.elements;
 }});
 if(!modules[56])throw Error('v305 character module missing');
 const edits=[];
 simple(modules[56],{AssignmentExpression(node){
  if(node.left.type!=='MemberExpression'||node.right.type!=='FunctionExpression')return;
  const name=node.left.computed?node.left.property.value:node.left.property.name;
  if(!['get','addValue'].includes(name))return;
  edits.push({start:node.right.start,end:node.right.end,code:patchCharacterAttackMethod(source.slice(node.right.start,node.right.end))});
 }});
 if(edits.length!==2)throw Error('v305 character attack methods missing');
 for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.code+source.slice(edit.end);
 // Infinity removes quantity eviction, while checkBufferSize still reconciles
 // mutually exclusive resurrection states. Duration, dispel and immunity remain.
 source=replaceOnce(source,'e.BUFF_MAX_SIZE=3','e.BUFF_MAX_SIZE=Infinity');
 // Native status icons already iterate every status, but the eighth icon's x
 // incorrectly continued across the screen instead of starting the next row.
 source=replaceOnce(source,'s.x=i*I,s.y=(i/m|0)*S','s.x=i%m*I,s.y=(i/m|0)*S');
 source=replaceOnce(source,'t.height=s.y+S,t.width=s.x+I','t.height=s.y+S,t.width=Math.min(n,m)*I');
 return source;
}

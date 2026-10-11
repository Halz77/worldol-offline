import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as prettier from 'prettier';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const arg of process.argv.slice(2)){
  const file=/^\d+$/.test(arg)?path.join(root,'analysis/modules',arg.padStart(4,'0')+'.js'):path.resolve(arg);
  const source=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,await prettier.format(source.startsWith('function(')?'('+source+')':source,{parser:'babel'}));
  console.log(file);
}

import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resetTaskDays} from '../lib/task-reset.mjs';
import {expandSavedBags} from '../lib/bag-capacity.mjs';

const [beforePath,afterPath,day]=process.argv.slice(2);
if(!beforePath||!afterPath||!/^\d{4}-\d{2}-\d{2}$/.test(day||''))throw Error('Expected before-save, after-save and Shanghai reset date.');
const expected=JSON.parse(fs.readFileSync(beforePath,'utf8')),actual=JSON.parse(fs.readFileSync(afterPath,'utf8'));
const bagExpansions=expandSavedBags(expected);
const changes=resetTaskDays({data:expected,save(){}},Date.parse(day+'T12:00:00+08:00'));
assert.deepEqual(actual,expected,'Startup changed fields beyond bag expansion and daily task reset; the backup has been retained.');
console.log(JSON.stringify({validated:true,changes,bagExpansions}));

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedAccount = 'xia-v05-qa';
let failed = 0;

function readJson(label, relative, options = {}) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    console.log(`[${label}] ${relative}: 未找到（跳过）`);
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(`[${label}] ${relative}`);
    return data;
  } catch (error) {
    failed++;
    console.error(`[${label}] ${relative}: 解析失败 - ${error.message}`);
    return null;
  }
}

const current = readJson('存档', 'saves\\world.json');
if (current) {
  const accounts = Array.isArray(current.accounts) ? current.accounts : [];
  const characters = Array.isArray(current.characters) ? current.characters : [];
  console.log(`       账号 ${accounts.length} 个：${accounts.map(a => a.name || ('#' + a.id)).join('、') || '（无）'}`);
  console.log(`       角色 ${characters.length} 个`);
  if (current.schema !== 1) console.log('       [警告] schema 不是 1');
  if (accounts.some(a => a.name === expectedAccount)) {
    console.log(`       [ OK ] 启动器账号 ${expectedAccount} 存在`);
  } else {
    console.log(`       [警告] 启动器使用账号 ${expectedAccount}，但存档里没有这个账号`);
  }
}

const bundled = readJson('随包存档', 'default-save\\world.json');
if (bundled) {
  const accounts = Array.isArray(bundled.accounts) ? bundled.accounts : [];
  const characters = Array.isArray(bundled.characters) ? bundled.characters : [];
  console.log(`       账号 ${accounts.length} 个：${accounts.map(a => a.name || ('#' + a.id)).join('、') || '（无）'}`);
  console.log(`       角色 ${characters.length} 个`);
  if (bundled.schema !== 1) console.log('       [警告] schema 不是 1');
}

const items = readJson('装备覆盖', 'data\\local-item-overrides.json');
if (items) console.log(`       覆盖 ${Object.keys(items.items || {}).length} 件装备`);

const skills = readJson('技能覆盖', 'data\\local-skill-overrides.json');
if (skills) console.log(`       覆盖 ${Object.keys(skills.skills || {}).length} 个技能`);

if (failed) process.exitCode = 1;

#!/usr/bin/env node
/**
 * 世界OL 单机存档编辑器
 *
 * 纯 Node、零依赖，吃任意一份 world.json（比如从手机导出的那份），
 * 用来做「复制角色 / 复制宠物到出战栏」这类批量改动，省得每次手翻 JSON。
 *
 * 用法：
 *   node tools/edit-world-save.mjs list  <存档.json>
 *   node tools/edit-world-save.mjs pets  <存档.json> <角色名>
 *   node tools/edit-world-save.mjs setpet <存档.json> <宠物来源角色> <目标角色...> [--drop-old]
 *   node tools/edit-world-save.mjs clone <存档.json> <骨架角色> <新角色名>
 *          [--job=侠客] [--level=97] [--keep-bag] [--pet-from=物理] [--drop-old]
 *
 * 常用组合（复制一个角色，并带上某个角色的出战宠物）：
 *   node tools/edit-world-save.mjs clone world.json 魔攻 空手2 --job=侠客 --level=97 --pet-from=物理
 *
 * 通用选项：
 *   --dry-run      只打印将要做什么，不写盘
 *   --drop-old     目标出战栏原有宠物直接丢掉（默认是挪到背包空位，不丢东西）
 *   --no-backup    不生成备份
 *
 * 存档格式要点（与 lib/pet-state.mjs 一致）：
 *   - 出战宠物 = inventory 里 slot === 1 且带 pet 的那一项
 *   - 背包格从 slot 30 起算，宠物道具有 itemId 24
 *   - 宠物 uid = String(角色id * 10000 + nextPetIndex 序号)，必须互不相同
 */

import fs from 'node:fs';
import path from 'node:path';

// 与 lib/restoration.mjs 的导师表一致：侠客1/修真2/战士3/法师4/贤者5/武圣6/枪王10/锤师11/岚舞12
const JOBS = {侠客: 1, 修真: 2, 战士: 3, 法师: 4, 贤者: 5, 武圣: 6, 枪王: 10, 锤师: 11, 岚舞: 12};
const JOB_NAMES = Object.fromEntries(Object.entries(JOBS).map(([name, id]) => [id, name]));
const PET_ITEM_ID = 24;
const DEPLOY_SLOT = 1;
const BAG_BASE = 30;
const MAX_ROLES_PER_ACCOUNT = 6;

const die = (message) => {
  console.error('✗ ' + message);
  process.exit(1);
};
const jobName = (id) => JOB_NAMES[id] || `未知(${id})`;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const USAGE = `世界OL 单机存档编辑器

  list   <存档>                          列出账号 / 角色 / 出战宠物
  pets   <存档> <角色名>                 列出某个角色背包里的所有宠物
  setpet <存档> <来源角色> <目标角色...>  把来源角色的出战宠物复制到目标的出战栏
  clone  <存档> <骨架角色> <新角色名>     以某个角色为模板新建角色

clone 选项：
  --job=<侠客|1>      新角色职业，默认跟骨架一致
  --level=<1-97>      新角色等级，默认跟骨架一致
  --keep-bag          连背包一起复制（默认背包清空，只留出战宠物）
  --pet-from=<角色>   顺便把这个角色的出战宠物装到新角色出战栏

通用选项：--dry-run  --drop-old  --no-backup`;

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      flags[key] = value === undefined ? true : value;
    } else {
      positional.push(arg);
    }
  }
  return {flags, positional};
}

function loadSave(file) {
  if (!file) die('需要指定存档文件。\n\n' + USAGE);
  if (!fs.existsSync(file)) die(`找不到存档文件：${file}`);
  const text = fs.readFileSync(file, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    die(`不是合法 JSON：${error.message}`);
  }
  if (data.schema !== 1 || !Array.isArray(data.characters) || !Array.isArray(data.accounts)) {
    die('无法识别的存档：需要 schema:1 且有 characters / accounts 数组。');
  }
  for (const role of data.characters) {
    if (!Array.isArray(role.inventory)) role.inventory = [];
  }
  return {data, text, pretty: /^\{\s*\n/.test(text)};
}

/** 写盘前的结构自检：宁可报错，也不要写出一个进游戏就崩的存档 */
function validate(data) {
  const problems = [];
  const names = new Set();
  for (const role of data.characters) {
    if (names.has(role.name)) problems.push(`角色名重复：${role.name}`);
    names.add(role.name);

    const slots = role.inventory.map((item) => item.slot);
    if (slots.length !== new Set(slots).size) problems.push(`${role.name}：背包格子有重复`);

    const inDeploy = role.inventory.filter((item) => item.slot === DEPLOY_SLOT);
    if (inDeploy.length > 1) problems.push(`${role.name}：有 ${inDeploy.length} 个 slot=1 的格子`);

    const inBag = pets(role).filter((item) => item.slot !== DEPLOY_SLOT && item.slot < BAG_BASE);
    if (inBag.length) problems.push(`${role.name}：宠物占了非法格子 ${inBag.map((i) => i.slot).join(',')}`);

    const uids = pets(role).map((item) => String(item.pet.uid));
    if (uids.length !== new Set(uids).size) problems.push(`${role.name}：宠物 uid 有重复`);
  }
  if (problems.length) die('自检未通过，未写盘：\n  - ' + problems.join('\n  - '));
}

function writeSave(file, data, pretty, {flags}) {
  validate(data);
  const out = pretty ? JSON.stringify(data, null, 2) + '\n' : JSON.stringify(data);
  if (flags['dry-run']) {
    console.log('\n（--dry-run：没有写盘）');
    return;
  }
  if (!flags['no-backup']) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    let backup = `${file}.bak-${stamp}`;
    for (let n = 2; fs.existsSync(backup); n++) backup = `${file}.bak-${stamp}-${n}`;
    fs.copyFileSync(file, backup);
    console.log(`\n备份：${backup}`);
  }
  fs.writeFileSync(file, out, 'utf8');
  console.log(`已写入：${file}（${out.length} 字节）`);
}

const findRole = (data, name) => data.characters.find((c) => c.name === name);
function requireRole(data, name) {
  const role = findRole(data, name);
  if (!role) {
    die(`找不到角色「${name}」。现有角色：${data.characters.map((c) => c.name).join('、') || '(空)'}`);
  }
  return role;
}

/** 出战宠物 = inventory 里 slot===1 且有 pet 的那一项（lib/pet-state.mjs 的 activePet） */
const deployedItem = (role) => role.inventory.find((item) => item.slot === DEPLOY_SLOT && item.pet);
const pets = (role) => role.inventory.filter((item) => item.pet);

function freeSlot(role) {
  const used = new Set(role.inventory.map((item) => item.slot));
  const capacity = BAG_BASE + (role.bagLimit || 60);
  for (let slot = BAG_BASE; slot < capacity; slot++) {
    if (!used.has(slot)) return slot;
  }
  return undefined;
}

/** 分配一个不与现有宠物冲突的 uid，并推进 nextPetIndex */
function allocateUid(role) {
  const used = new Set(pets(role).map((item) => String(item.pet.uid)));
  let index = role.nextPetIndex || 0;
  let uid;
  do {
    index += 1;
    uid = String(role.id * 10000 + index);
  } while (used.has(uid));
  role.nextPetIndex = index;
  return uid;
}

/** 把 sourceRole 的出战宠物复制到 targetRole 的出战栏 */
function copyDeployedPet(sourceRole, targetRole, {dropOld}) {
  const source = deployedItem(sourceRole);
  if (!source) {
    die(`角色「${sourceRole.name}」没有出战宠物（inventory 里没有 slot=1 的宠物）。`);
  }
  const pet = structuredClone(source.pet);
  pet.uid = allocateUid(targetRole);

  const old = targetRole.inventory.find((item) => item.slot === DEPLOY_SLOT);
  let movedTo = null;
  let dropped = null;
  if (old) {
    if (dropOld) {
      targetRole.inventory = targetRole.inventory.filter((item) => item !== old);
      dropped = old.pet?.name || `itemId=${old.itemId}`;
    } else {
      const slot = freeSlot(targetRole);
      if (slot === undefined) {
        die(`角色「${targetRole.name}」背包没有空位，无法先安置原出战宠物（加 --drop-old 可直接替换）。`);
      }
      old.slot = slot;
      movedTo = slot;
    }
  }
  targetRole.inventory.push({itemId: PET_ITEM_ID, slot: DEPLOY_SLOT, quantity: 1, pet});
  return {pet, old: dropped || (old ? old.pet?.name || `itemId=${old.itemId}` : null), movedTo};
}

function cloneRole(data, skeleton, name, {job, level, keepBag}) {
  const trimmed = String(name).trim();
  if (!trimmed || trimmed.length > 16) die('角色名须为 1–16 字。');
  if (data.characters.some((c) => c.name === trimmed)) die(`角色名「${trimmed}」已存在。`);

  const accountId = skeleton.accountId;
  const siblings = data.characters.filter((c) => c.accountId === accountId);
  if (siblings.length >= MAX_ROLES_PER_ACCOUNT) {
    die(`账号 #${accountId} 已有 ${siblings.length} 个角色，上限 ${MAX_ROLES_PER_ACCOUNT}。`);
  }

  const usedIds = new Set(data.characters.map((c) => c.id));
  let id = Math.max(data.nextRole || 1001, ...data.characters.map((c) => c.id + 1));
  while (usedIds.has(id)) id += 1;
  data.nextRole = id + 1;

  const role = structuredClone(skeleton);
  role.id = id;
  role.accountId = accountId;
  role.name = trimmed;
  role.job = job ?? skeleton.job;
  role.level = level ?? skeleton.level;
  role.createdAt = new Date().toISOString();
  if (!keepBag) role.inventory = [];
  delete role.legion; // 让 legionState 重新归一化，避免继承别人的军团编队
  role.nextPetIndex = 0;
  data.characters.push(role);

  const account = data.accounts.find((a) => a.id === accountId);
  if (account) account.lastRoleId = id;
  return role;
}

function cmdList(data, text) {
  console.log(`存档：schema=${data.schema} nextRole=${data.nextRole} 体积=${kb(text.length)}`);
  for (const account of data.accounts) {
    const roles = data.characters.filter((c) => c.accountId === account.id);
    console.log(`\n账号 #${account.id} ${account.name}（${roles.length}/${MAX_ROLES_PER_ACCOUNT} 个角色）`);
    for (const role of roles) {
      const item = deployedItem(role);
      const pet = item
        ? `${item.pet.name} lv${item.pet.level} uid=${item.pet.uid}`
        : '（无出战宠物）';
      console.log(
        `  ${role.name.padEnd(6, '　')} id=${role.id} ${jobName(role.job)} lv${role.level}` +
          ` 背包=${role.inventory.length} 宠物=${pets(role).length}  →  ${pet}`,
      );
    }
  }
}

function cmdPets(data, name) {
  const role = requireRole(data, name);
  const list = pets(role);
  console.log(`角色「${role.name}」共 ${list.length} 只宠物（背包 ${role.inventory.length} 格）：\n`);
  console.log('  背包序号  格子  等级  uid        技能  装备  出战  名称');
  for (const item of list) {
    const index = role.inventory.indexOf(item);
    console.log(
      `  ${String(index).padStart(6)}  ${String(item.slot).padStart(4)}  ${String(item.pet.level).padStart(4)}` +
        `  ${String(item.pet.uid).padEnd(10)}  ${String(item.pet.skills?.length ?? 0).padStart(4)}` +
        `  ${String(item.pet.equipment?.length ?? 0).padStart(4)}  ${item.slot === DEPLOY_SLOT ? ' ✓ ' : '   '}` +
        `   ${item.pet.name}`,
    );
  }
  if (!list.length) console.log('  （没有宠物）');
}

function cmdSetpet(data, sourceName, targets, flags) {
  const source = requireRole(data, sourceName);
  if (!targets.length) die('setpet 需要至少一个目标角色名。');
  console.log(`来源：${source.name} 的出战宠物\n`);
  for (const targetName of targets) {
    const target = requireRole(data, targetName);
    if (target === source) {
      console.log(`[${target.name}] 跳过：目标和来源是同一个角色。`);
      continue;
    }
    const {pet, old, movedTo} = copyDeployedPet(source, target, {dropOld: !!flags['drop-old']});
    const note = old
      ? `原出战宠物(${old}) ${flags['drop-old'] ? '已丢弃' : `挪到背包第 ${movedTo} 格`}`
      : '原本没有出战宠物';
    console.log(`[${target.name}] 装上 ${pet.name} lv${pet.level} uid=${pet.uid}；${note}`);
  }
}

function cmdClone(data, skeletonName, newName, flags) {
  const skeleton = requireRole(data, skeletonName);

  let job;
  if (flags.job !== undefined) {
    const raw = String(flags.job);
    job = JOBS[raw] ?? Number(raw);
    if (!Number.isInteger(job) || job <= 0) {
      die(`无法识别的职业「${raw}」。可用：${Object.keys(JOBS).join('、')}，或直接给数字。`);
    }
  }
  let level;
  if (flags.level !== undefined) {
    level = Number(flags.level);
    if (!Number.isInteger(level) || level < 1 || level > 97) die('--level 需要是 1–97 的整数。');
  }

  const role = cloneRole(data, skeleton, newName, {job, level, keepBag: !!flags['keep-bag']});
  console.log(`新建角色：${role.name} id=${role.id} ${jobName(role.job)} lv${role.level}` +
    `（骨架 ${skeleton.name}${flags['keep-bag'] ? '，连背包一起复制' : '，背包清空'}）`);

  if (flags['pet-from']) {
    const petSource = requireRole(data, String(flags['pet-from']));
    const {pet, old, movedTo} = copyDeployedPet(petSource, role, {dropOld: !!flags['drop-old']});
    const note = old
      ? `；原有出战宠物(${old}) ${flags['drop-old'] ? '已丢弃' : `挪到背包第 ${movedTo} 格`}`
      : '';
    console.log(`  装上 ${petSource.name} 的 ${pet.name} lv${pet.level} uid=${pet.uid}${note}`);
  }
}

function main() {
  const {flags, positional} = parseArgs(process.argv.slice(2));
  const [command, file, ...rest] = positional;
  if (!command || command === 'help' || flags.help) {
    console.log(USAGE);
    return;
  }
  if (!['list', 'pets', 'setpet', 'clone'].includes(command)) die(`未知命令「${command}」。\n\n${USAGE}`);

  const {data, text, pretty} = loadSave(file);

  if (command === 'list') {
    cmdList(data, text);
    return;
  }
  if (command === 'pets') {
    cmdPets(data, rest[0]);
    return;
  }
  if (command === 'setpet') {
    cmdSetpet(data, rest[0], rest.slice(1), flags);
    writeSave(file, data, pretty, {flags});
    return;
  }
  if (command === 'clone') {
    cmdClone(data, rest[0], rest[1], flags);
    writeSave(file, data, pretty, {flags});
    return;
  }
}

main();

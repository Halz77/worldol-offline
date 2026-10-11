import fs from 'node:fs';
import path from 'node:path';
import {normalizeRole} from './content.mjs';
import {initializeNewbie} from './progression.mjs';
import {bindLegionRoster} from './legion-state.mjs';
import {expandSavedBags} from './bag-capacity.mjs';
export class SaveStore {
  constructor(dir) {
    this.dir=dir; fs.mkdirSync(dir,{recursive:true}); this.file=path.join(dir,'world.json');
    this.data=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{schema:1,nextAccount:1,nextRole:1001,accounts:[],characters:[]};
    if(this.data.schema!==1 || !Array.isArray(this.data.characters))throw Error('Unsupported or corrupt save; original file has been retained.');
    // Persist the capacity migration before other in-memory normalization.
    // save() keeps the previous file in world.json.bak and replaces atomically.
    if(expandSavedBags(this.data).length)this.save();
    // Additive migration. Keep IDs, appearances, old positions and all unknown fields.
    this.data.characters.forEach(normalizeRole);
    bindLegionRoster(this.data.characters);
  }
  save() {
    // 紧凑序列化：存档越大差别越明显。1.15 MB 的存档用 null,2 排版会膨胀到 2.7 MB，
    // 紧凑写法只要 0.49 MB，序列化本身也快一倍。standalone 下存档还要再过一遍
    // base64 才能进 localStorage，体积直接等于耗时。盘上不好读，但「导出存档」
    // 按钮会重新排版（见 standalone/shims/vfs.mjs 的 exportSave）。
    const temp=this.file+'.tmp';
    fs.writeFileSync(temp,JSON.stringify(this.data)+'\n','utf8');
    if(fs.existsSync(this.file))fs.copyFileSync(this.file,this.file+'.bak');
    fs.renameSync(temp,this.file);
  }
  account(name) {
    if(typeof name!=='string' || !/^[\p{L}\p{N}_-]{1,32}$/u.test(name))throw Error('本地存档名称只能包含文字、数字、下划线，最多 32 字。');
    let account=this.data.accounts.find(a=>a.name===name);
    if(!account){account={id:this.data.nextAccount++,name,lastRoleId:0}; this.data.accounts.push(account); this.save();}
    return account;
  }
  roles(account) { return this.data.characters.filter(c=>c.accountId===account.id); }
  create(account,input) {
    if(this.roles(account).length>=6)throw Error('每个本地存档最多保留 6 个角色。');
    const name=input.name.trim();
    if(!name || name.length>16)throw Error('角色名须为 1–16 字。');
    if(this.roles(account).some(c=>c.name===name))throw Error('这个角色名已存在。');
    const role={...input,name,id:this.data.nextRole++,accountId:account.id,level:1,vipLevel2:0,mapId:1,x:19,y:15,mapName:'单机探索区',status:0,createdAt:new Date().toISOString(),settings: 0x8000};
    initializeNewbie(role);normalizeRole(role); this.data.characters.push(role);bindLegionRoster(this.data.characters); account.lastRoleId=role.id; this.save(); return role;
  }
}

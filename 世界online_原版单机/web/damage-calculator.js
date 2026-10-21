(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = {
    port: localStorage.getItem('wolCalcPort') || (location.protocol === 'file:' ? '8775' : (location.port || '8775')),
    token: null,
    source: '',
    characters: [],
    profile: null,
    result: null,
    selectedId: 0,
    lastJson: null,
    busy: false
  };
  const ATK_NAMES = ['近身劈砍','远程劈砍','近身穿刺','远程穿刺','魔法攻击','诅咒攻击','祝福'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '0';
  const pct = (value, cap = 100) => {
    const n = Math.max(0, Number(value) || 0);
    if (n > cap) return `${cap}%+`;
    return `${Math.round(n * 10) / 10}%`;
  };
  const rawPct = value => `${Math.round((Number(value) || 0) * 10) / 10}%`;
  const powerText = p => `${p.name} ${p.value > 0 ? '+' : ''}${p.value}${p.percent ? '%' : ''}`;

  function apiBase() {
    if (location.protocol === 'file:') return `http://127.0.0.1:${state.port || '8775'}`;
    return '';
  }
  async function api(path, options = {}) {
    const url = apiBase() + path;
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new Error(`连不上服务端（${url}）。请先双击「启动单机-新存档.cmd」，或把端口改成 8776。原始错误：${error.message}`);
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`服务端返回的不是 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`); }
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    return data;
  }

  function banner(message, kind = '') {
    const el = $('banner');
    el.className = 'banner show ' + kind;
    el.textContent = message || '';
  }
  function warn(message) {
    const el = $('warnings');
    if (!message) { el.className = 'banner warn'; el.textContent = ''; return; }
    el.className = 'banner warn show';
    el.textContent = message;
  }
  function setBusy(busy, message = '') {
    state.busy = busy;
    $('useCurrent').disabled = busy;
    $('reloadCurrent').disabled = busy;
    $('run').disabled = busy;
    $('runStatus').textContent = message;
  }

  async function loadCurrent() {
    if (state.busy) return;
    setBusy(true, '正在读取当前服务端存档…');
    banner('正在读取当前服务端存档…');
    try {
      const data = await api('/api/damage-calculator/current');
      loadSession(data, 'current');
      banner(`已读取当前服务端存档：${data.characters.length} 个角色。`, 'ok');
    } catch (error) {
      banner(error.message, 'err');
    } finally {
      setBusy(false, '');
    }
  }

  async function loadFile(file) {
    if (!file || state.busy) return;
    setBusy(true, '正在解析存档…');
    banner('正在解析存档…');
    try {
      const text = await file.text();
      let save;
      try { save = JSON.parse(text); } catch { throw new Error('文件不是合法 JSON'); }
      const data = await api('/api/damage-calculator/load', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({save})
      });
      loadSession(data, 'import');
      banner(`已导入 ${file.name}：${data.characters.length} 个角色。`, 'ok');
    } catch (error) {
      banner(error.message, 'err');
    } finally {
      setBusy(false, '');
    }
  }

  function loadSession(data, source) {
    state.token = data.token;
    state.source = source || data.source || '';
    state.characters = Array.isArray(data.characters) ? data.characters : [];
    state.result = null;
    $('loaded').classList.remove('hidden');
    $('results').classList.add('hidden');
    $('sessionBadge').textContent = `${source === 'current' ? '当前服务端存档' : '导入存档'} · ${state.characters.length} 人`;
    warn(Array.isArray(data.warnings) && data.warnings.length ? data.warnings.join('；') : '');
    const select = $('characterSelect');
    select.innerHTML = state.characters.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · Lv${esc(p.level)} · ID ${esc(p.id)}</option>`).join('');
    const preferred = localStorage.getItem('wolCalcCharacterId');
    const match = state.characters.find(p => p.id === preferred);
    select.value = match ? match.id : (state.characters[0]?.id || '');
    bindCharacter();
  }

  function bindCharacter() {
    const id = $('characterSelect').value;
    state.profile = state.characters.find(p => p.id === id) || null;
    if (!state.profile) return;
    localStorage.setItem('wolCalcCharacterId', state.profile.id);
    renderStats();
    renderSkills();
    resetTarget();
    $('results').classList.add('hidden');
    state.result = null;
    state.selectedId = 0;
  }

  function statCard(key, label, value, cls = '') {
    return `<div class="stat"><div class="k">${esc(label)}</div><div class="v ${cls}" title="${esc(value)}">${esc(value)}</div></div>`;
  }
  function renderStats() {
    const p = state.profile, s = p.stats;
    const weapon = (s.LEFT_WEAPON_TYPE > 0 ? '左' : '') + (s.RIGHT_WEAPON_TYPE > 0 ? (s.LEFT_WEAPON_TYPE > 0 ? '+右' : '右') : '') || '空手';
    $('stats').innerHTML = [
      statCard('HPMAX','生命上限',fmt(s.HPMAX)),
      statCard('MPMAX','法力上限',fmt(s.MPMAX)),
      statCard('SPEED','出手速度',fmt(s.SPEED)),
      statCard('ATK_TYPE','攻击类型',ATK_NAMES[s.ATK_TYPE] || ('类型 '+s.ATK_TYPE)),
      statCard('ATK_MIN','武器伤害',`${fmt(s.ATK_MIN)} ~ ${fmt(s.ATK_MAX)}`,'gold'),
      statCard('ATK_TIME','总攻次',`${fmt(s.ATK_TIME)}（左 ${fmt(s.LEFT_ATK_TIME)} / 右 ${fmt(s.RIGHT_ATK_TIME)}）`,'green'),
      statCard('ATK_STR_NEARBY','劈砍攻击',fmt(s.ATK_STR_NEARBY)),
      statCard('ATK_AGI_NEARBY','穿刺攻击',fmt(s.ATK_AGI_NEARBY)),
      statCard('ATK_MAGIC','魔法攻击',fmt(s.ATK_MAGIC),'gold'),
      statCard('HIT_RATE','物理命中',fmt(s.HIT_RATE)),
      statCard('HIT_MAGIC','魔法命中',fmt(s.HIT_MAGIC)),
      statCard('CRITICAL','致命点',fmt(s.CRITICAL),'gold'),
      statCard('BRK_ARMOR','破甲',fmt(s.BRK_ARMOR)),
      statCard('MAGIC_PENETRATION','魔法穿透',fmt(s.MAGIC_PENETRATION)),
      statCard('TOUGH','伤害减免',fmt(s.TOUGH)),
      statCard('IGNORE_TOUCH','无视减伤',fmt(s.IGNORE_TOUCH)),
      statCard('BLOCK','格挡',fmt(s.BLOCK)),
      statCard('DODGE','闪避',fmt(s.DODGE)),
      statCard('DEF_STR_NEARBY','劈砍防御',fmt(s.DEF_STR_NEARBY)),
      statCard('DEF_AGI_NEARBY','穿刺防御',fmt(s.DEF_AGI_NEARBY)),
      statCard('DEF_MAGIC','魔法防御',fmt(s.DEF_MAGIC)),
      statCard('DEF_FIELD','法力护盾',fmt(s.DEF_FIELD)),
      statCard('LIFE_ABSORPTION','生命吸收',fmt(s.LIFE_ABSORPTION)),
      statCard('MANA_ABSORPTION','法力吸收',fmt(s.MANA_ABSORPTION)),
      statCard('KEEPOUT_ATK_TIME','免伤护盾',fmt(s.KEEPOUT_ATK_TIME)),
      statCard('EQUIP_WEAPON_TYPE','武器',weapon)
    ].join('');
  }

  function skillOptions(type, selected) {
    const list = state.profile.skills.filter(s => s.type === type);
    const seen = new Set();
    let html = '<option value="0">（空）</option>';
    for (const s of list) {
      seen.add(String(s.id));
      html += `<option value="${esc(s.id)}" ${String(s.id) === String(selected) ? 'selected' : ''}>${esc(s.name)} · Lv${esc(s.level)} · ${esc(s.id)}</option>`;
    }
    if (selected && !seen.has(String(selected))) {
      const fallback = state.profile.skills.find(s => String(s.id) === String(selected));
      if (fallback) html += `<option value="${esc(fallback.id)}" selected>${esc(fallback.name)} · Lv${esc(fallback.level)} · ${esc(fallback.id)}</option>`;
    }
    return html;
  }

  function renderSkills() {
    const p = state.profile;
    const auto = [...p.autoSkillIds];
    while (auto.length < 5) auto.push(0);
    $('autoSlots').innerHTML = auto.slice(0, 5).map((selected, index) => `
      <div class="auto-slot"><span class="n">${index + 1}</span><select class="auto-slot-select" data-index="${index}">${skillOptions(2, selected)}</select></div>
    `).join('');
    $('autoSlots').querySelectorAll('select').forEach(select => select.addEventListener('change', renderSkillInfo));
    const active = p.initiativeSkillId || 0;
    $('activeSkill').innerHTML = '<option value="0">普通攻击</option>' + skillOptions(3, active).replace('<option value="0">（空）</option>', '');
    $('activeSkill').onchange = renderSkillInfo;
    renderSkillInfo();
  }

  function findSkill(id) {
    return state.profile?.skills.find(s => String(s.id) === String(id)) || null;
  }
  function renderSkillInfo() {
    const activeId = $('activeSkill').value;
    const autoIds = [...document.querySelectorAll('.auto-slot-select')].map(s => s.value).filter(v => v && v !== '0');
    const cards = [];
    const active = activeId === '0' ? null : findSkill(activeId);
    if (active) cards.push(skillCard(active, '主动'));
    else cards.push(`<div class="skill-card"><div class="head"><span class="name">普通攻击</span><span class="meta">按面板 ATK_TYPE 结算，攻次 = 总攻次</span></div></div>`);
    for (const id of [...new Set(autoIds)]) {
      const skill = findSkill(id);
      if (skill) cards.push(skillCard(skill, '自动'));
    }
    $('skillInfo').innerHTML = cards.join('');
  }
  function skillCard(skill, role) {
    const powers = (skill.powers || []).map(p => `<span class="power ${p.value < 0 ? 'neg' : (p.value > 0 ? 'pos' : '')}" title="${esc(p.code)}">${esc(powerText(p))}</span>`).join('');
    return `<div class="skill-card">
      <div class="head"><span class="name">${esc(skill.name)}</span><span class="meta">${esc(role)} · Lv${esc(skill.level)} · ${esc(skill.typeName)} · ${esc(skill.atkTypeName)} · 攻次 ${esc(skill.atk_time)}</span></div>
      ${skill.info ? `<div class="desc">${esc(skill.info)}</div>` : ''}
      ${powers ? `<div class="powers">${powers}</div>` : ''}
    </div>`;
  }

  function resetTarget() {
    const p = state.profile;
    $('tLevel').value = p.level;
    for (const id of ['tDefStrNearby','tDefStrRange','tDefAgiNearby','tDefAgiRange','tDefMagic','tDodge','tBlock','tTough','tDefField','tMp','tIgnoreCrit']) $(id).value = 0;
    $('tWeak').checked = false;
    $('tBlood').checked = false;
  }

  function collectConfig() {
    const autoSkillIds = [...document.querySelectorAll('.auto-slot-select')].map(s => Number(s.value) || 0).filter(Boolean);
    return {
      autoSkillIds,
      activeSkillId: Number($('activeSkill').value) || 0,
      target: {
        level: Number($('tLevel').value) || state.profile.level,
        defStrNearby: Number($('tDefStrNearby').value) || 0,
        defStrRange: Number($('tDefStrRange').value) || 0,
        defAgiNearby: Number($('tDefAgiNearby').value) || 0,
        defAgiRange: Number($('tDefAgiRange').value) || 0,
        defMagic: Number($('tDefMagic').value) || 0,
        dodge: Number($('tDodge').value) || 0,
        block: Number($('tBlock').value) || 0,
        tough: Number($('tTough').value) || 0,
        defField: Number($('tDefField').value) || 0,
        mp: Number($('tMp').value) || 0,
        ignoreCritical: Number($('tIgnoreCrit').value) || 0,
        weak: $('tWeak').checked,
        blood: $('tBlood').checked
      },
      mods: {
        atkStrPercent: Number($('modAtkStrPct').value) || 0,
        atkAgiPercent: Number($('modAtkAgiPct').value) || 0,
        atkMagicPercent: Number($('modAtkMagicPct').value) || 0,
        atkTime: Number($('modAtkTime').value) || 0,
        hitRate: Number($('modHit').value) || 0,
        hitMagic: Number($('modHitMagic').value) || 0,
        critical: Number($('modCrit').value) || 0,
        brkArmor: Number($('modBrk').value) || 0,
        magicPenetration: Number($('modPen').value) || 0
      },
      applyAutoBuffs: $('autoBuff').checked,
      trials: Number($('trials').value) || 1000,
      rounds: Number($('rounds').value) || 10,
      seed: Number($('seed').value) || 1
    };
  }

  async function runSimulation() {
    if (state.busy || !state.profile || !state.token) return;
    const config = collectConfig();
    setBusy(true, '正在模拟…');
    banner('正在模拟木桩…');
    try {
      const data = await api('/api/damage-calculator/simulate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({token: state.token, characterId: state.profile.id, config})
      });
      state.result = data;
      state.lastJson = {character: state.profile, config, result: data};
      const first = (data.skills || []).reduce((best, skill) => !best || (skill.damage || 0) > (best.damage || 0) ? skill : best, null);
      state.selectedId = first?.id ?? 0;
      renderResults();
      $('exportJson').disabled = false;
      $('copyJson').disabled = false;
      banner('模拟完成。', 'ok');
    } catch (error) {
      banner(error.message, 'err');
    } finally {
      setBusy(false, '');
    }
  }

  function renderResults() {
    const r = state.result;
    if (!r) return;
    $('results').classList.remove('hidden');
    const rot = r.rotation || {};
    const best = (r.skills || []).slice().sort((a,b) => b.damage - a.damage)[0];
    $('summary').innerHTML = [
      card('循环平均总伤害', fmt(rot.damage), true),
      card('循环平均每回合', fmt(rot.avgPerRound), true),
      card('循环最低 / 最高', `${fmt(rot.minBattle)} / ${fmt(rot.maxBattle)}`, false),
      card('单技能最高', best ? `${esc(best.name)} · ${fmt(best.damage)}` : '—', false)
    ].join('');
    const tbody = document.querySelector('#resultTable tbody');
    tbody.innerHTML = (r.skills || []).map(skill => `
      <tr data-id="${esc(skill.id)}" class="${String(skill.id) === String(state.selectedId) ? 'selected' : ''}">
        <td><b>${esc(skill.name)}</b></td>
        <td><span class="tag">${esc(skill.typeName)}</span></td>
        <td class="num">${fmt(skill.totalHits)}</td>
        <td class="num">${pct(skill.hitRate)}</td>
        <td class="num">${pct(skill.critRate)}</td>
        <td class="num">${pct(skill.blockRate, 70)}</td>
        <td class="num dmg ${skill.damage ? '' : 'zero'}">${fmt(skill.damage)}</td>
        <td class="num">${fmt(skill.minCast)}</td>
        <td class="num">${fmt(skill.maxCast)}</td>
        <td class="num">${fmt(skill.avgHit)}</td>
        <td class="num">${fmt(skill.avgAttackPoints)}</td>
        <td class="num">${rawPct(skill.reduction)}</td>
      </tr>
    `).join('');
    tbody.querySelectorAll('tr').forEach(row => row.addEventListener('click', () => {
      state.selectedId = Number(row.dataset.id) || 0;
      tbody.querySelectorAll('tr').forEach(x => x.classList.toggle('selected', x === row));
      renderDetail();
    }));
    renderRotation(rot, r);
    renderDetail();
    renderSample(r.sample || []);
  }

  function card(label, value, gold) {
    return `<div class="card"><div class="k">${esc(label)}</div><div class="v ${gold ? '' : 'small'}">${esc(value)}</div></div>`;
  }

  function renderRotation(rot, data) {
    const list = rot.perSkill || [];
    const max = Math.max(1, ...list.map(x => x.damage));
    $('rotation').innerHTML = `
      <div class="kv"><span class="k">循环回合</span><span class="v">${fmt(rot.rounds)}</span></div>
      <div class="kv"><span class="k">循环模拟次数</span><span class="v">${fmt(rot.trials)}</span></div>
      <div class="kv"><span class="k">平均总伤害</span><span class="v">${fmt(rot.damage)}</span></div>
      <div class="kv"><span class="k">平均每回合</span><span class="v">${fmt(rot.avgPerRound)}</span></div>
      <div class="kv"><span class="k">最低 / 最高</span><span class="v">${fmt(rot.minBattle)} / ${fmt(rot.maxBattle)}</span></div>
      <div class="per-skill" style="margin-top:10px">${list.map(item => `
        <div class="line"><span>${esc(item.name)}</span><span class="mono">${fmt(item.damage)}</span></div>
        <div class="bar"><i style="width:${Math.max(1, Math.round(item.damage / max * 100))}%"></i></div>
      `).join('') || '<span class="muted small">没有可统计的出手。</span>'}</div>
      <div class="hint" style="margin-top:8px">循环 = 每回合先放一个自动技能（按槽位轮换），再放主动技能/普通攻击。${data?.applyAutoBuffs ? '自动技能的正向攻击增益已计入；' : '自动技能增益未计入；'}目标减益/回复/护盾仍未折算。</div>
    `;
  }

  function renderDetail() {
    const r = state.result;
    const skill = r?.skills?.find(s => String(s.id) === String(state.selectedId));
    if (!skill) { $('detail').innerHTML = ''; return; }
    const statRows = [
      ['技能类型', skill.typeName || '—'],
      ['攻击类型', skill.attackTypeName || '—'],
      ['总攻次', fmt(skill.totalHits)],
      ['命中率（原始）', rawPct(skill.hitRate)],
      ['致命率（原始）', rawPct(skill.critRate)],
      ['格挡率（原始）', rawPct(skill.blockRate)],
      ['平均攻击点数', fmt(skill.avgAttackPoints)],
      ['防御减伤', rawPct(skill.reduction)],
      ['平均总伤害', fmt(skill.damage)],
      ['平均单次命中', fmt(skill.avgHit)],
      ['单次最低 / 最高', `${fmt(skill.minHit)} / ${fmt(skill.maxHit)}`],
      ['命中/暴击/格挡次数', `${fmt(skill.landed)} / ${fmt(skill.crits)} / ${fmt(skill.blocked)}`]
    ];
    const autoApplied = r.autoBuffs?.applied || [];
    const autoSkipped = r.autoBuffs?.skipped || [];
    const autoText = autoApplied.length
      ? autoApplied.map(item => `${item.skill} · ${item.name} +${item.value}${item.percent ? '%' : ''}`).join('；')
      : (r.applyAutoBuffs ? '已开启，但选中的自动技能没有可识别的正向攻击效果。' : '未开启（自动技能只参与出手，不折算增益）。');
    const skippedText = autoSkipped.length
      ? ` 未自动计入 ${autoSkipped.length} 项：${autoSkipped.slice(0, 6).map(item => `${item.skill} · ${item.name} +${item.value}${item.percent ? '%' : ''}`).join('；')}${autoSkipped.length > 6 ? '…' : ''}。`
      : '';
    $('detail').innerHTML = `
      <div class="panel" style="background:#101720">
        <h3 style="margin-top:0">${esc(skill.name)} · 公式明细</h3>
        <div class="kv">${statRows.map(([k,v]) => `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>`).join('')}</div>
        <div class="note">攻击点数 ≈ 对应攻击力 ÷ 总攻次 + 当前手武器伤害 + 技能附带伤害 ÷ 总攻次；防御减伤按目标防御、破甲/法穿、角色等级计算；再乘 95%~105% 随机、暴击 ×1.5、强韧/护盾减免。</div>
      </div>
      <div class="panel" style="background:#101720">
        <h3 style="margin-top:0">这次模拟用的目标</h3>
        <div class="kv">
          <span class="k">等级</span><span class="v">${fmt(r.target.level)}</span>
          <span class="k">劈砍防御（近/远）</span><span class="v">${fmt(r.target.defStrNearby)} / ${fmt(r.target.defStrRange)}</span>
          <span class="k">穿刺防御（近/远）</span><span class="v">${fmt(r.target.defAgiNearby)} / ${fmt(r.target.defAgiRange)}</span>
          <span class="k">魔法防御</span><span class="v">${fmt(r.target.defMagic)}</span>
          <span class="k">闪避 / 格挡</span><span class="v">${fmt(r.target.dodge)} / ${fmt(r.target.block)}</span>
          <span class="k">伤害减免 / 护盾</span><span class="v">${fmt(r.target.tough)} / ${fmt(r.target.defField)}</span>
          <span class="k">衰弱 / 流血</span><span class="v">${r.target.weak ? '是' : '否'} / ${r.target.blood ? '是' : '否'}</span>
        </div>
      </div>
      <div class="note" style="grid-column:1/-1">自动技能增益：${esc(autoText)}${esc(skippedText)}</div>
    `;
  }

  function renderSample(sample) {
    const tbody = document.querySelector('#sampleTable tbody');
    tbody.innerHTML = sample.map((hit, index) => `
      <tr>
        <td>${index + 1}</td><td>${esc(hit.skill)}</td><td>${fmt(hit.index)}</td><td>${esc(hit.hand)}</td>
        <td>${hit.hit ? '✓' : '—'}</td><td>${hit.crit ? '✓' : '—'}</td><td>${hit.blocked ? '✓' : '—'}</td>
        <td class="num dmg">${fmt(hit.damage)}</td><td class="num">${fmt(hit.attackPoints)}</td><td class="num">${rawPct(hit.reduction)}</td>
      </tr>
    `).join('') || '<tr><td colspan="10" class="muted">没有命中记录（技能可能是纯增益/治疗）。</td></tr>';
  }

  function downloadJson() {
    if (!state.lastJson) return;
    const text = JSON.stringify(state.lastJson, null, 2);
    const blob = new Blob([text], {type: 'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `worldol-damage-${state.profile?.name || 'result'}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function copyJson() {
    if (!state.lastJson) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(state.lastJson, null, 2));
      banner('结果已复制到剪贴板。', 'ok');
    } catch {
      banner('浏览器不允许写剪贴板，请用「导出结果 JSON」。', 'warn');
    }
  }

  // ── events ──
  $('useCurrent').addEventListener('click', loadCurrent);
  $('reconnect').addEventListener('click', loadCurrent);
  $('reloadCurrent').addEventListener('click', loadCurrent);
  $('usePort').addEventListener('click', () => {
    const value = ($('port').value || '').trim();
    if (!/^\d{2,5}$/.test(value)) { banner('端口要填数字，例如 8775 / 8776。', 'err'); return; }
    state.port = value;
    localStorage.setItem('wolCalcPort', value);
    loadCurrent();
  });
  $('saveFile').addEventListener('change', event => loadFile(event.target.files?.[0]));
  $('characterSelect').addEventListener('change', bindCharacter);
  $('zeroDummy').addEventListener('click', resetTarget);
  $('run').addEventListener('click', runSimulation);
  $('exportJson').addEventListener('click', downloadJson);
  $('copyJson').addEventListener('click', copyJson);

  $('port').value = state.port;
  if (location.protocol !== 'file:') {
    $('port').disabled = true;
    $('usePort').disabled = true;
  }
  // 页面打开就先尝试当前存档；失败时只提示，不阻塞手动导入。
  loadCurrent();
})();

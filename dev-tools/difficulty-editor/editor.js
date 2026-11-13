/* Challenge difficulty editor. Local development only; served by dev-tools/local-server/server.cjs. */
(() => {
  'use strict';
  const R = window.MinefieldChallenge, L = R.LIMITS, TYPES = R.types;
  const $ = id => document.getElementById(id);
  const clone = o => JSON.parse(JSON.stringify(o));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const channel = new BroadcastChannel('minefield-difficulty-lab');
  const STORE = 'minefieldLab.attempts.v1';
  let saved = null, draft = null, baseline = null, selected = 1, popup = null, live = null, pushTimer = 0;

  const decimals = step => (String(step).split('.')[1] || '').length;
  const snap = (v, step) => Number((Math.round(v / step) * step).toFixed(decimals(step)));
  const clamp = (v, {min, max}) => Math.min(max, Math.max(min, v));
  const familyPeak = w => Math.max(1, w.largeFragments, w.largeFragments * w.mediumFragments);
  const hits = w => 1 + w.largeFragments + w.largeFragments * w.mediumFragments;
  const pad2 = n => String(n).padStart(2, '0');
  const fmt = (v, d = 2) => Number.isFinite(v) ? Number(v.toFixed(d)).toString() : '—';
  const wave = n => draft.waves[n - 1];

  // Every control maps 1:1 to an engine parameter used by game.js.
  const FIELDS = [
    {group: 'Enemies', key: 'count', label: 'Large mines', limit: L.count, unit: 'mines',
      hint: w => `Peak live ≤ ${w.count * familyPeak(w)} of ${draft.maxActiveMines} cap · ${w.count * hits(w)} hits to clear`},
    {key: 'speed', label: 'Nominal speed', limit: L.speed, unit: 'u/s',
      hint: w => `Large ${w.speed} · medium ${w.speed + w.fragmentSpeed} · small ${w.speed + 2 * w.fragmentSpeed} u/s, before variation (ship max 350)`},
    {key: 'speedMin', label: 'Speed variation · min', limit: L.speedMin, unit: '×', get: w => w.speedVariation[0], set: (w, v) => { w.speedVariation[0] = v; },
      hint: w => `Each mine moves at nominal × random ${fmt(w.speedVariation[0])}–${fmt(w.speedVariation[1])}`},
    {key: 'speedMax', label: 'Speed variation · max', limit: L.speedMax, unit: '×', get: w => w.speedVariation[1], set: (w, v) => { w.speedVariation[1] = v; }},
    {group: 'Movement', key: 'turn', label: 'Steering', limit: L.turn, unit: 'rad/s',
      hint: w => `${Math.round(w.turn * 180 / Math.PI)}°/s · Curve turns steadily; Surge/Weave oscillate up to this rate. Drift ignores it.`},
    {key: 'pulse', label: 'Aggression (speed pulse)', limit: {min: L.pulse.min * 100, max: L.pulse.max * 100, step: 1}, unit: '±%', scale: 100,
      hint: w => `Surge/Weave speed swings ${fmt(1 - w.pulse)}–${fmt(1 + w.pulse)}× nominal`},
    {group: 'Fragmentation', key: 'largeFragments', label: 'Large splits into', limit: L.largeFragments, unit: 'medium',
      hint: w => `${w.count} large → ${w.count * w.largeFragments} medium → ${w.count * w.largeFragments * w.mediumFragments} small`},
    {key: 'mediumFragments', label: 'Medium splits into', limit: L.mediumFragments, unit: 'small'},
    {key: 'fragmentSpeed', label: 'Fragment speed boost', limit: L.fragmentSpeed, unit: 'u/s', hint: () => 'Added per size step below large'}
  ];
  const fieldByKey = Object.fromEntries(FIELDS.map(f => [f.key, f]));
  const getValue = (f, w) => (f.get ? f.get(w) : w[f.key]);
  const display = (f, v) => f.scale ? Math.round(v * f.scale) : v;
  function setValue(f, w, v) {
    if (f.key === 'count') return setCount(w, v);
    if (f.set) f.set(w, v); else w[f.key] = v;
  }
  // Count changes add/remove Drift first so the aggressive mix only changes when you ask.
  function setCount(w, count) {
    w.count = count;
    let diff = count - TYPES.reduce((sum, t) => sum + w.behaviors[t], 0);
    if (diff > 0) w.behaviors.drift += diff;
    for (const type of TYPES) { if (diff >= 0) break; const take = Math.min(w.behaviors[type], -diff); w.behaviors[type] -= take; diff += take; }
  }

  // ---------- Toasts, validation, dirty state ----------
  function toast(kind, text, list = []) {
    const t = $('toast'); t.hidden = false; t.className = `toast ${kind}`; t.textContent = text;
    if (list.length) { const ul = document.createElement('ul'); for (const e of list) ul.append(Object.assign(document.createElement('li'), {textContent: e})); t.append(ul); }
    clearTimeout(toast.timer); if (kind === 'ok') toast.timer = setTimeout(() => { t.hidden = true; }, 6000);
  }
  const validation = () => R.validate(draft);
  const dirty = () => !same(draft, saved);

  function refreshStatus() {
    const {ok, errors} = validation();
    $('dirty').hidden = !dirty(); $('save-btn').disabled = !ok || !dirty();
    const box = $('errors'); box.hidden = ok; box.replaceChildren();
    if (!ok) {
      box.append(Object.assign(document.createElement('strong'), {textContent: 'Not saveable — fix these first. The test game keeps the last valid settings.'}));
      const ul = document.createElement('ul'); for (const e of errors) ul.append(Object.assign(document.createElement('li'), {textContent: e})); box.append(ul);
    }
    document.querySelectorAll('#wave-grid button').forEach((b, i) => {
      b.classList.toggle('changed', !same(draft.waves[i], saved.waves[i]));
      b.classList.toggle('invalid', errors.some(e => e.startsWith(`Wave ${i + 1}:`)));
    });
    return ok;
  }

  // Validated drafts go straight to the running test game (no save or deploy needed).
  function pushRules() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { if (validation().ok) channel.postMessage({type: 'rules', config: draft}); }, 60);
  }
  function changed() { refreshFields(); renderMix(); renderOverview(); renderMetrics(); refreshStatus(); pushRules(); }

  // ---------- Wave controls ----------
  function renderWaveGrid() {
    const grid = $('wave-grid'); grid.replaceChildren();
    for (let n = 1; n <= 13; n++) {
      const b = document.createElement('button'); b.textContent = n; b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(n === selected)); b.setAttribute('aria-label', `Wave ${n}`);
      b.addEventListener('click', () => selectWave(n)); grid.append(b);
    }
  }
  function selectWave(n) {
    selected = n; $('test-wave').value = String(n); sendOptions();
    document.querySelectorAll('#wave-grid button').forEach((b, i) => b.setAttribute('aria-selected', String(i + 1 === n)));
    buildFields(); renderMix(); renderOverview(); renderMetrics(); refreshStatus();
  }

  function buildFields() {
    const host = $('wave-fields'); host.replaceChildren();
    for (const f of FIELDS) {
      if (f.group) host.append(Object.assign(document.createElement('h3'), {textContent: `${f.group} · wave ${selected}`}));
      const row = document.createElement('div'); row.className = 'field'; row.dataset.key = f.key;
      const id = `f-${f.key}`, step = f.limit.step;
      row.innerHTML = `<label for="${id}">${f.label}</label>
        <span class="value"><input type="number" id="${id}-n" min="${f.limit.min}" max="${f.limit.max}" step="${step}" aria-label="${f.label} value"><span class="unit">${f.unit}</span></span>
        <input type="range" id="${id}" min="${f.limit.min}" max="${f.limit.max}" step="${step}">
        <p class="hint"></p>`;
      const range = row.querySelector('input[type=range]'), number = row.querySelector('input[type=number]');
      const apply = (raw, fromSlider) => {
        let v = Number(raw); if (!Number.isFinite(v)) return;
        // Sliders clamp; typed values only snap, so out-of-range entries surface as validation errors.
        v = fromSlider ? snap(clamp(v, f.limit), step) : snap(v, step);
        setValue(f, wave(selected), f.scale ? Number((v / f.scale).toFixed(4)) : v); changed();
      };
      range.addEventListener('input', () => apply(range.value, true));
      number.addEventListener('change', () => apply(number.value, false));
      host.append(row);
    }
    refreshFields();
  }
  function refreshFields() {
    const w = wave(selected), s = saved.waves[selected - 1];
    for (const f of FIELDS) {
      const row = document.querySelector(`.field[data-key="${f.key}"]`); if (!row) continue;
      const v = display(f, getValue(f, w)), was = display(f, getValue(f, s));
      const range = row.querySelector('input[type=range]'), number = row.querySelector('input[type=number]');
      if (document.activeElement !== number) number.value = v;
      range.value = v; range.style.setProperty('--fill', `${100 * (clamp(v, f.limit) - f.limit.min) / (f.limit.max - f.limit.min)}%`);
      row.classList.toggle('changed', v !== was);
      const hint = (f.hint ? f.hint(w) : '') + (v !== was ? ` · saved: ${was}` : '');
      row.querySelector('.hint').textContent = hint;
    }
  }

  function renderMix() {
    const w = wave(selected), host = $('mix'); host.replaceChildren(); $('mix-bar').replaceChildren();
    for (const type of TYPES) {
      const n = w.behaviors[type];
      $('mix-bar').append(Object.assign(document.createElement('span'), {className: `swatch-${type}`, style: `width:${100 * n / Math.max(1, w.count)}%`, title: `${type} ${n}`}));
      const cell = document.createElement('div'), label = type === 'weave' ? 'WEAVE' : type.toUpperCase();
      cell.innerHTML = `<b><span class="swatch-${type}" style="display:inline-block;width:8px;height:8px;margin-right:6px"></span>${label}</b><output>${n}</output>`;
      if (type === 'drift') cell.append(Object.assign(document.createElement('small'), {textContent: 'fills the remainder'}));
      else {
        const step = document.createElement('div'); step.className = 'step';
        const minus = Object.assign(document.createElement('button'), {textContent: '−', disabled: n === 0}); minus.setAttribute('aria-label', `Fewer ${type}`);
        const plus = Object.assign(document.createElement('button'), {textContent: '+', disabled: w.behaviors.drift === 0, title: w.behaviors.drift === 0 ? 'Add a large mine or reduce another type first' : ''}); plus.setAttribute('aria-label', `More ${type}`);
        minus.addEventListener('click', () => { w.behaviors[type]--; w.behaviors.drift++; changed(); });
        plus.addEventListener('click', () => { w.behaviors[type]++; w.behaviors.drift--; changed(); });
        step.append(minus, plus); cell.append(step);
      }
      host.append(cell);
    }
  }

  // ---------- Range adjustments ----------
  function buildRangeTool() {
    for (const id of ['range-from', 'range-to', 'test-wave']) {
      const sel = $(id); for (let n = 1; n <= 13; n++) sel.append(new Option(`Wave ${n}`, n));
    }
    $('range-from').value = '1'; $('range-to').value = '13';
    for (const f of FIELDS) $('range-key').append(new Option(`${f.label} (${f.unit})`, f.key));
    $('range-key').append(new Option('All wave settings', 'all'));
    const hint = () => {
      const op = $('range-op').value, key = $('range-key').value, f = fieldByKey[key];
      $('range-amount-label').hidden = !['scale', 'add'].includes(op);
      $('range-hint').textContent = key === 'all' && op !== 'copy' ? 'All wave settings can only be copied.'
        : op === 'scale' ? 'e.g. 10 = +10%, −15 = −15%. Results snap to each control\'s step and limits.'
        : op === 'add' ? `Amount in ${f.unit}.` : op === 'ramp' ? 'Keeps the two end waves and spaces the waves between them evenly.'
        : `Copies wave ${selected}'s value to every wave in the range.`;
    };
    for (const id of ['range-op', 'range-key']) $(id).addEventListener('change', hint);
    hint();
    $('range-apply').addEventListener('click', applyRange);
  }
  function applyRange() {
    let from = Number($('range-from').value), to = Number($('range-to').value);
    if (from > to) [from, to] = [to, from];
    const key = $('range-key').value, op = $('range-op').value, amount = Number($('range-amount').value);
    if (key === 'all') {
      if (op !== 'copy') return toast('bad', 'All wave settings can only be copied.');
      for (let n = from; n <= to; n++) if (n !== selected) draft.waves[n - 1] = clone(wave(selected));
      changed(); return toast('ok', `Copied wave ${selected}'s settings to waves ${from}–${to}. Not saved yet.`);
    }
    if (['scale', 'add'].includes(op) && !Number.isFinite(amount)) return toast('bad', 'Enter a numeric amount.');
    const f = fieldByKey[key], first = display(f, getValue(f, wave(from))), last = display(f, getValue(f, wave(to))), source = display(f, getValue(f, wave(selected)));
    for (let n = from; n <= to; n++) {
      const w = wave(n), current = display(f, getValue(f, w));
      let v = op === 'scale' ? current * (1 + amount / 100) : op === 'add' ? current + amount
        : op === 'ramp' ? (to === from ? first : first + (last - first) * (n - from) / (to - from)) : source;
      v = snap(clamp(v, f.limit), f.limit.step);
      if (key === 'count') v = Math.min(v, Math.floor(draft.maxActiveMines / familyPeak(w)));
      setValue(f, w, f.scale ? Number((v / f.scale).toFixed(4)) : v);
    }
    changed(); toast('ok', `Adjusted ${f.label.toLowerCase()} for waves ${from}–${to}. Not saved yet.`);
  }

  // ---------- Campaign ----------
  function buildCampaign() {
    const host = $('campaign'); host.replaceChildren();
    const slider = (key, label, unit, hint) => {
      const limit = L[key], row = document.createElement('div'); row.className = 'field';
      row.innerHTML = `<label>${label}</label><span class="value"><output></output><span class="unit">${unit}</span></span>
        <input type="range" min="${limit.min}" max="${limit.max}" step="${limit.step}" aria-label="${label}"><p class="hint">${hint}</p>`;
      const range = row.querySelector('input'), out = row.querySelector('output');
      const sync = () => { range.value = draft[key]; out.textContent = draft[key]; row.classList.toggle('changed', draft[key] !== saved[key]); range.style.setProperty('--fill', `${100 * (draft[key] - limit.min) / (limit.max - limit.min)}%`); };
      range.addEventListener('input', () => { draft[key] = Number(range.value); sync(); changed(); });
      sync(); host.append(row);
    };
    slider('startingLives', 'Starting ships', 'ships', 'Ships at the start of a full campaign.');
    slider('maxActiveMines', 'Max active mines', 'mines', `Hard engine cap is ${R.HARD_CAP}. Each wave's worst-case peak must fit.`);
    const bonus = document.createElement('div'); bonus.className = 'field';
    bonus.innerHTML = '<label>Bonus ship after clearing wave</label><div class="bonus" style="grid-column:1/-1"></div>';
    for (let n = 1; n <= 12; n++) {
      const label = document.createElement('label'), box = Object.assign(document.createElement('input'), {type: 'checkbox', checked: draft.bonusLifeWaves.includes(n)});
      box.addEventListener('change', () => { draft.bonusLifeWaves = box.checked ? [...draft.bonusLifeWaves, n].sort((a, b) => a - b) : draft.bonusLifeWaves.filter(x => x !== n); changed(); });
      label.append(box, String(n)); bonus.querySelector('.bonus').append(label);
    }
    host.append(bonus);
    const version = document.createElement('div'); version.className = 'field';
    version.innerHTML = `<label for="version">Record version</label><span class="value"><input id="version" type="text" maxlength="40" size="16" spellcheck="false"></span>
      <p class="hint">Players' Challenge records are stored per version (minefield.challenge.&lt;version&gt;). Change it when a rebalance makes old scores incomparable.</p>`;
    const input = version.querySelector('input'); input.value = draft.version;
    input.addEventListener('input', () => { draft.version = input.value.trim(); changed(); });
    host.append(version);
  }

  // ---------- Test session ----------
  function testOptions() {
    const seedOn = $('seed-on').checked, lives = $('test-lives').value;
    return {wave: Number($('test-wave').value), seed: seedOn ? Math.max(0, Math.floor(Number($('seed').value) || 0)) : null,
      lives: lives ? Number(lives) : null, stopAfterClear: $('stop-after').checked, autoRestart: $('auto-restart').checked};
  }
  function sendOptions() { channel.postMessage({type: 'options', options: testOptions()}); }
  function gameWindow() { return popup && !popup.closed ? popup : $('game-frame').contentWindow; }
  function startTest() {
    if (!validation().ok) toast('bad', 'Current edits are invalid, so the test uses the last valid settings.', validation().errors.slice(0, 5));
    else channel.postMessage({type: 'rules', config: draft});
    channel.postMessage({type: 'start', options: testOptions()});
    const target = gameWindow(); target?.focus(); target?.document?.getElementById('game')?.focus();
  }
  function bindTester() {
    $('test-wave').value = String(selected);
    for (const id of ['test-wave', 'seed', 'test-lives', 'stop-after', 'auto-restart']) $(id).addEventListener('change', sendOptions);
    $('seed-on').addEventListener('change', () => { $('seed').disabled = !$('seed-on').checked; sendOptions(); });
    $('test-wave').addEventListener('change', () => { if (Number($('test-wave').value) !== selected) selectWave(Number($('test-wave').value)); });
    $('test-btn').addEventListener('click', startTest);
    $('popout-btn').addEventListener('click', () => {
      popup = window.open('/game/', 'minefield-test', 'width=1100,height=880');
      if (!popup) return toast('bad', 'The browser blocked the pop-out window. Allow pop-ups for this local page.');
      $('game-frame').src = 'about:blank'; $('popped').hidden = false;
      const watch = setInterval(() => { if (popup.closed) { clearInterval(watch); dock(); } }, 800);
    });
    $('dock-btn').addEventListener('click', () => { popup?.close(); dock(); });
  }
  function dock() { popup = null; $('popped').hidden = true; if ($('game-frame').src.endsWith('about:blank')) $('game-frame').src = '/game/'; }

  channel.addEventListener('message', ({data}) => {
    if (data.type === 'ready') { if (validation().ok && draft) channel.postMessage({type: 'rules', config: draft}); sendOptions(); }
    else if (data.type === 'attempt') { addAttempt(data.attempt); }
    else if (data.type === 'live') { live = data.attempt; renderLive(); }
    else if (data.type === 'error') toast('bad', `Test game rejected settings: ${data.message}`);
  });

  // ---------- Metrics ----------
  function loadAttempts() { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch (_) { return []; } }
  function storeAttempts(list) { try { localStorage.setItem(STORE, JSON.stringify(list.slice(-1000))); } catch (_) {} }
  function addAttempt(a) {
    const list = loadAttempts(); if (a.id && list.some(x => x.id === a.id)) return;
    list.push(a); storeAttempts(list); renderMetrics(); renderOverview();
  }
  // Must match the harness: hash of the validated per-wave profile the game actually used.
  function signature(n) {
    try {
      const text = JSON.stringify(R.create(draft).wave(n));
      let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
      return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
    } catch (_) { return null; }
  }
  function attemptsFor(n) {
    const sig = $('current-only').checked ? signature(n) : null;
    return loadAttempts().filter(a => a.wave === n && (!sig || a.settings === sig));
  }
  function renderLive() {
    $('live').textContent = live ? `LIVE · wave ${live.wave} · ${live.destroyed} destroyed · ${live.liveMines} on field · peak ${live.peak} · deaths ${live.deaths}` : '';
  }
  function renderMetrics() {
    const list = attemptsFor(selected), cleared = list.filter(a => a.outcome === 'cleared');
    const avg = (xs, d = 1) => xs.length ? fmt(xs.reduce((a, b) => a + b, 0) / xs.length, d) : '—';
    $('metrics-scope').textContent = `wave ${selected}${$('current-only').checked ? ` · settings ${signature(selected) ?? 'invalid'}` : ' · all settings'}`;
    const stats = [
      ['Attempts', list.length], ['Clears', list.length ? `${cleared.length} (${Math.round(100 * cleared.length / list.length)}%)` : '—'],
      ['Avg clear time', cleared.length ? `${avg(cleared.map(a => a.duration))}s` : '—'], ['Best clear', cleared.length ? `${fmt(Math.min(...cleared.map(a => a.duration)), 1)}s` : '—'],
      ['Avg lives lost', avg(list.map(a => a.livesLost))], ['Player deaths', list.reduce((s, a) => s + a.deaths, 0)],
      ['Avg destroyed', avg(list.map(a => a.destroyed))], ['Peak enemies', list.length ? Math.max(...list.map(a => a.peak)) : '—']
    ];
    $('summary').replaceChildren(...stats.map(([k, v]) => { const d = document.createElement('div'); d.innerHTML = `<dt>${k}</dt><dd>${v}</dd>`; return d; }));
    const body = $('attempts').tBodies[0]; body.replaceChildren();
    list.slice(-20).reverse().forEach((a, i) => {
      const tr = body.insertRow();
      for (const [v, cls] of [[list.length - i], [a.outcome, `outcome-${a.outcome}`], [`${fmt(a.duration, 1)}s`], [a.livesLost], [a.deaths], [a.destroyed], [a.peak], [a.seed ?? 'random'], [a.settings]]) {
        const td = tr.insertCell(); td.textContent = v; if (cls) td.className = cls;
      }
    });
    if (!list.length) { const td = body.insertRow().insertCell(); td.colSpan = 9; td.textContent = 'No test runs yet for this wave. Press ▶ Test wave.'; td.style.textAlign = 'left'; }
  }
  function bindMetrics() {
    $('current-only').addEventListener('change', () => { renderMetrics(); renderOverview(); });
    $('clear-btn').addEventListener('click', () => {
      if (!confirm(`Delete all recorded test runs for wave ${selected}?`)) return;
      storeAttempts(loadAttempts().filter(a => a.wave !== selected)); renderMetrics(); renderOverview();
    });
    $('export-btn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({exportedAt: new Date().toISOString(), config: draft, attempts: loadAttempts()}, null, 2)], {type: 'application/json'});
      const a = Object.assign(document.createElement('a'), {href: URL.createObjectURL(blob), download: `minefield-difficulty-tests-${Date.now()}.json`});
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  function renderOverview() {
    const body = $('overview').tBodies[0]; body.replaceChildren();
    draft.waves.forEach((w, i) => {
      const s = saved.waves[i], n = i + 1, list = attemptsFor(n), tr = body.insertRow();
      tr.className = n === selected ? 'selected' : ''; tr.addEventListener('click', () => selectWave(n));
      const cells = [
        [pad2(n)], [w.count, w.count !== s.count], [w.speed, w.speed !== s.speed], [fmt(w.turn), w.turn !== s.turn], [`±${Math.round(w.pulse * 100)}%`, w.pulse !== s.pulse],
        [TYPES.map(t => w.behaviors[t]).join(' / '), !same(w.behaviors, s.behaviors)], [`${w.largeFragments}·${w.mediumFragments}`, w.largeFragments !== s.largeFragments || w.mediumFragments !== s.mediumFragments],
        [w.count * familyPeak(w)], [list.length ? `${list.filter(a => a.outcome === 'cleared').length}/${list.length}` : '—']
      ];
      for (const [v, diff] of cells) { const td = tr.insertCell(); td.textContent = v; if (diff) td.className = 'changed'; }
    });
  }

  // ---------- Load / save / restore ----------
  async function fetchConfig() {
    const res = await fetch('/api/config', {cache: 'no-store'});
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    return res.json();
  }
  function adopt(data, keepDraft = false) {
    saved = data.config; baseline = data.baseline; $('file-name').textContent = data.file;
    if (!keepDraft) draft = clone(saved);
    buildFields(); buildCampaign(); renderMix(); renderOverview(); renderMetrics(); refreshStatus(); pushRules();
  }
  async function save() {
    if (!refreshStatus()) return toast('bad', 'Fix the listed problems before saving.', validation().errors);
    $('save-btn').disabled = true;
    try {
      const res = await fetch('/api/config', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({config: draft})});
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) return toast('bad', body.error || `Save failed (HTTP ${res.status}). challenge-config.js was not changed.`, body.errors || []);
      adopt(body);
      toast('ok', `✓ Saved to ${body.file} at ${new Date(body.savedAt).toLocaleTimeString()}. Previous version backed up to ${body.backup}.`);
    } catch (error) {
      toast('bad', `Could not reach the local server — is "npm run dev" still running? (${error.message}) Nothing was saved.`);
    } finally { refreshStatus(); }
  }
  async function restore() {
    if (dirty() && !confirm('Discard unsaved edits and reload challenge-config.js from disk?')) return;
    try { adopt(await fetchConfig()); toast('ok', 'Restored the saved values from challenge-config.js.'); }
    catch (error) { toast('bad', `Could not reload from the local server: ${error.message}`); }
  }
  function resetBaseline() {
    if (!confirm('Load the baseline (balanced-v2) values into the editor? Nothing is written until you click Save changes.')) return;
    draft = clone(baseline); buildFields(); buildCampaign(); changed();
    toast('ok', dirty() ? 'Baseline loaded into the editor — not saved yet. Click Save changes to write it.' : 'The saved file already matches the baseline.');
  }

  $('save-btn').addEventListener('click', save);
  $('restore-btn').addEventListener('click', restore);
  $('baseline-btn').addEventListener('click', resetBaseline);
  document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!$('save-btn').disabled) save(); } });
  window.addEventListener('beforeunload', e => { if (draft && dirty()) { e.preventDefault(); e.returnValue = ''; } });

  renderWaveGrid(); buildRangeTool(); bindTester(); bindMetrics();
  fetchConfig().then(data => { adopt(data); channel.postMessage({type: 'hello'}); })
    .catch(error => toast('bad', `Could not load the configuration from the local server: ${error.message}. Start it with "npm run dev".`));
})();

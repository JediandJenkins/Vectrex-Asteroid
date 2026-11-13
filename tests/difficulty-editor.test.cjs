'use strict';
// Difficulty configuration, local editor server, and production build separation.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {createEngine, seededRandom} = require('./helpers/engine.cjs');
const rules = require('../challenge.js');
const configFile = require('../dev-tools/local-server/config-file.cjs');
const {build, stripDevCode, RUNTIME_FILES} = require('../dev-tools/build.cjs');

const root = path.resolve(__dirname, '..');
const current = () => configFile.readConfig();
const clone = o => JSON.parse(JSON.stringify(o));
const configSource = config => configFile.serialize(config);
const errorsFor = mutate => { const c = clone(current()); mutate(c); return rules.validate(c).errors; };

test('saved configuration equals the approved baseline and the balanced-v2 schedule (no value changes)', () => {
  assert.deepEqual(current(), configFile.readBaseline());
  assert.equal(rules.version, 'balanced-v2');
  for (let w = 1; w <= 13; w++) {
    const p = rules.wave(w);
    assert.equal(p.pulse, .22); assert.equal(p.fragmentSpeed, 26); assert.equal(p.speedMin, .85); assert.equal(p.speedMax, 1.2);
  }
  assert.equal(rules.startingLives, 3); assert.equal(rules.maxMines, 72);
  assert.deepEqual([1, 4, 7, 10].map(rules.introduced), [[], ['CURVING MINES'], ['SURGING MINES'], ['WEAVING MINES']]);
});

test('config file serialization round-trips and is loadable by both Node and the browser wrapper', () => {
  const text = configFile.serialize(current());
  assert.deepEqual(configFile.parse(text), current());
  const sandbox = {}; require('node:vm').runInNewContext(text, sandbox);
  assert.deepEqual(clone(sandbox.MinefieldChallengeConfig), current());
});

test('invalid settings are rejected with readable reasons', () => {
  const cases = [
    [c => { c.waves[0].count = 13; c.waves[0].behaviors.drift = 13; }, /Wave 1: up to 78 mines could be live at once; the limit is 72/],
    [c => { c.waves[4].behaviors.surge = 1; }, /Wave 5: Drift \+ Curve \+ Surge \+ Weave must equal 4/],
    [c => { c.waves[2].count = 3.5; }, /Wave 3: count must be a whole number/],
    [c => { c.waves[12].speed = 500; }, /Wave 13: speed 500 is outside 10–200/],
    [c => { c.waves[12].speed = 'fast'; }, /Wave 13: speed must be a number/],
    [c => { c.waves[6].turn = NaN; }, /Wave 7: turn must be a number/],
    [c => { c.waves[1].speedVariation = [1, .9]; }, /Wave 2: speedMax 0.9 is outside 1–1.6/],
    [c => { c.waves[1].speedVariation = [.9]; }, /Wave 2: speedVariation must be \[minimum, maximum\]/],
    [c => { c.waves[10].speed = 200; c.waves[10].fragmentSpeed = 80; c.waves[10].speedVariation = [1, 1.6]; c.waves[10].pulse = .5; }, /Wave 11: fastest mine would reach/],
    [c => { c.waves[0].largeFragments = 5; }, /Wave 1: largeFragments 5 is outside 0–4/],
    [c => { c.waves[0].lasers = true; }, /Wave 1: unknown setting "lasers"/],
    [c => { c.waves[0].behaviors.spiral = 0; }, /Wave 1: unknown behavior "spiral"/],
    [c => { c.waves.pop(); }, /exactly 13 waves/],
    [c => { c.maxActiveMines = 100; }, /maxActiveMines 100 is outside 8–72/],
    [c => { c.startingLives = 0; }, /startingLives 0 is outside 1–9/],
    [c => { c.bonusLifeWaves = [4, 4]; }, /bonusLifeWaves must be distinct/],
    [c => { c.bonusLifeWaves = [13]; }, /bonusLifeWaves must be distinct waves 1–12/],
    [c => { c.version = '../../etc'; }, /version must be/],
    [c => { c.schema = 2; }, /schema must be 1/],
    [c => { c.extra = 1; }, /Unknown setting "extra"/]
  ];
  for (const [mutate, pattern] of cases) {
    const errors = errorsFor(mutate);
    assert(errors.some(e => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(errors)}`);
    const c = clone(current()); mutate(c); assert.throws(() => rules.create(c), /Invalid Challenge configuration/);
  }
  for (const bad of [null, [], 'x', 42]) assert.equal(rules.validate(bad).ok, false);
});

test('a lower active-mine limit is enforced against every wave budget', () => {
  const c = clone(current()); c.maxActiveMines = 40;
  const errors = rules.validate(c).errors;
  // 7 or 8 large × 6 descendants exceed 40; 6 × 6 = 36 fits.
  assert.deepEqual(errors.map(e => e.split(':')[0]), ['Wave 11', 'Wave 12', 'Wave 13']);
});

test('each of the 13 waves can be adjusted independently', () => {
  const base = rules.create(current());
  for (let w = 1; w <= 13; w++) {
    const c = clone(current()), target = c.waves[w - 1];
    target.speed += 7; target.turn = .9; target.pulse = .35; target.fragmentSpeed = 30; target.speedVariation = [.9, 1.1];
    target.behaviors.drift -= 1; target.behaviors.weave += 1;
    const edited = rules.create(c);
    for (let other = 1; other <= 13; other++) {
      if (other === w) {
        assert.equal(edited.wave(w).speed, base.wave(w).speed + 7); assert.equal(edited.wave(w).turn, .9);
        assert.equal(edited.quotas(w).weave, base.quotas(w).weave + 1);
      } else assert.deepEqual(edited.wave(other), base.wave(other));
    }
  }
});

function clearAll(e, wave, seed, assertEach) {
  e.setup('challenge', wave, seed); const random = seededRandom(seed); let peak = e.q.raw().mines.length, kills = 0;
  while (e.q.raw().mines.length) {
    const mines = e.q.raw().mines, before = mines.length;
    // seed 0: worst case (always split the largest first); others: random order.
    const i = seed === 0 ? mines.findIndex(m => m.size === Math.max(...mines.map(x => x.size))) : Math.floor(random() * before);
    const parent = mines[i]; e.q.destroy(i); kills++;
    const after = e.q.raw().mines; peak = Math.max(peak, after.length);
    assertEach?.(parent, before, after);
  }
  return {peak, kills};
}

test('72-active-mine limit: a maximal valid wave reaches exactly 72 and never clips a fragment', () => {
  const c = clone(current());
  c.waves[12] = {...c.waves[12], count: 12, behaviors: {drift: 3, curve: 3, surge: 3, weave: 3}};
  assert.equal(rules.validate(c).ok, true);
  const r = rules.create(c), e = createEngine({configSource: configSource(c)});
  for (let seed = 0; seed < 12; seed++) {
    const {peak, kills} = clearAll(e, 13, seed, (parent, before, after) => {
      assert.equal(after.length, before - 1 + r.fragments(13, parent.size), 'no requested fragment may be dropped');
      assert(after.length <= 72);
    });
    assert(peak <= 72); assert.equal(kills, 12 * 10);
    if (seed === 0) assert.equal(peak, 72);
  }
});

test('the shared 72 cap still guards the engine if fragments are requested beyond it', () => {
  const e = createEngine(); e.setup('challenge', 13);
  const filler = Array.from({length: 71}, (_, i) => e.q.mine(1, 10 + i, 10, 0, 'drift'));
  e.q.set({mines: [...filler, e.q.mine(3, 400, 300, 0, 'drift')]});
  e.q.destroy(71); assert.equal(e.q.raw().mines.length, 72);
  e.q.set({mines: [...filler.slice(0, 70), e.q.mine(2, 400, 300, 0, 'curve')]}); e.q.destroy(70);
  assert.equal(e.q.raw().mines.length, 72);
});

test('fragment spawning follows edited split counts, speeds, variation and inherited behavior', () => {
  const c = clone(current());
  Object.assign(c.waves[5], {count: 4, largeFragments: 4, mediumFragments: 3, fragmentSpeed: 40, speed: 50, speedVariation: [1, 1], behaviors: {drift: 1, curve: 1, surge: 1, weave: 1}});
  const e = createEngine({configSource: configSource(c)});
  for (let seed = 0; seed < 6; seed++) {
    const {peak, kills} = clearAll(e, 6, seed, (parent, before, after) => {
      const n = parent.size === 3 ? 4 : parent.size === 2 ? 3 : 0;
      assert.equal(after.length, before - 1 + n);
      for (const child of after.slice(after.length - n)) {
        assert.equal(child.size, parent.size - 1); assert.equal(child.behavior, parent.behavior);
        assert.equal(child.baseSpeed, 50 + (3 - child.size) * 40); // variation fixed at 1×
      }
    });
    assert.equal(kills, 4 * (1 + 4 + 12));
    if (seed === 0) assert.equal(peak, 48);
  }
  // Large mines that do not split leave nothing behind.
  const none = clone(current()); Object.assign(none.waves[0], {largeFragments: 0});
  const e2 = createEngine({configSource: configSource(none)}); e2.setup('challenge', 1); e2.q.destroy(0);
  assert.equal(e2.q.raw().mines.length, 2);
});

test('edited lives, bonus waves, pulse and banners reach the engine', () => {
  const c = clone(current()); c.startingLives = 5; c.bonusLifeWaves = [2]; c.waves[1].behaviors = {drift: 2, curve: 0, surge: 1, weave: 0};
  const e = createEngine({configSource: configSource(c)}); e.setup('challenge');
  assert.equal(e.state().lives, 5);
  e.q.set({mines: [], waveDelay: 0}); e.q.update(1 / 120); assert.equal(e.state().lives, 5); // after wave 1: no bonus
  e.q.update(2.31); assert.equal(e.state().wave, 2);
  assert.equal(e.elements.get('announcement').textContent, 'WAVE 02\nSURGING MINES');
  e.q.set({mines: [], waveDelay: 0}); e.q.update(1 / 120); assert.equal(e.state().lives, 6);
});

test('Classic and Impossible are unaffected by any Challenge configuration', () => {
  const extreme = clone(current());
  for (const w of extreme.waves) Object.assign(w, {speed: 150, turn: 1.4, pulse: .4, fragmentSpeed: 10, speedVariation: [1, 1]});
  extreme.startingLives = 9; extreme.maxActiveMines = 48;
  for (const source of [undefined, configSource(extreme)]) {
    const e = createEngine({configSource: source});
    for (const type of ['classic', 'impossible']) for (const wave of [1, 5, 13, 40]) {
      e.setup(type, wave, 7); const s = e.state(), imp = type === 'impossible';
      assert.equal(s.lives, imp ? 1 : 3); assert.equal(s.maxMines, 72);
      assert.equal(s.difficulty.speed, (imp ? 88 : 30) + Math.min(wave - 1, imp ? Infinity : 30) * (imp ? 16 : 5));
      for (const m of s.mines) {
        assert(m.baseSpeed >= s.difficulty.speed * .85 && m.baseSpeed <= s.difficulty.speed * 1.2);
        assert.equal(m.behavior === 'drift', !imp);
      }
      e.q.set({mines: [e.q.mine(3, 100, 100, 0)]}); e.q.destroy(0);
      for (const m of e.q.raw().mines) assert(m.baseSpeed >= (s.difficulty.speed + (imp ? 34 : 26)) * .85 && m.baseSpeed <= (s.difficulty.speed + (imp ? 34 : 26)) * 1.2);
    }
  }
  // Identical seeds produce byte-identical Classic/Impossible fields with either config.
  const a = createEngine(), b = createEngine({configSource: configSource(extreme)});
  for (const type of ['classic', 'impossible']) { a.setup(type, 3, 99); b.setup(type, 3, 99); assert.deepEqual(a.state().mines, b.state().mines); }
});

test('test runs cannot touch records, preferences, or high scores', () => {
  const events = [];
  const hooks = {beforeStart: () => ({wave: 9, lives: 2}), waveCleared: () => true, emit: (name, data) => events.push([name, data]), attach() {}};
  const saved = {'minefield.challenge.balanced-v2': JSON.stringify({version: 'balanced-v2', score: 10, completed: false, bestTime: null}), 'minefield.records': '{"classic":{"score":5,"wave":1}}'};
  const e = createEngine({saved, devHooks: hooks}), before = new Map(e.storage);
  e.setup('challenge');
  assert.equal(e.state().wave, 9); assert.equal(e.state().lives, 2); assert.equal(e.state().completedWaves, 8);
  while (e.q.raw().mines.length) e.q.destroy(0);
  e.q.update(1 / 120);
  assert.equal(e.state().mode, 'gameover'); // stop-after-clear halts instead of advancing
  assert(e.state().score > 10);
  assert.equal(e.state().records.challenge.score, 10, 'in-memory record unchanged');
  assert.deepEqual(new Map(e.storage), before, 'nothing written to storage');
  assert.deepEqual([...new Set(events.map(([n]) => n))], ['waveStart', 'destroy', 'halted']);
  assert.equal(events.filter(([n]) => n === 'destroy').length, rules.wave(9).count * 10);
  e.setup('classic'); e.q.destroy(0); e.q.save(); assert.deepEqual(new Map(e.storage), before);
});

test('production game.js (dev code stripped) still records normally and plays identically', () => {
  const stripped = stripDevCode(fs.readFileSync(path.join(root, 'game.js'), 'utf8'));
  assert(!/devHooks|MinefieldDevHooks|@dev-only/.test(stripped));
  const prod = createEngine({gameSource: stripped}), dev = createEngine();
  for (const type of ['classic', 'challenge', 'impossible']) { prod.setup(type, 4, 11); dev.setup(type, 4, 11); assert.deepEqual(prod.state().mines, dev.state().mines); }
  prod.setup('challenge'); while (prod.q.raw().mines.length) prod.q.destroy(0);
  assert(JSON.parse(prod.storage.get('minefield.challenge.balanced-v2')).score > 0);
  assert.throws(() => stripDevCode('// @dev-only-start\nx'), /Unclosed/);
});

test('production build contains only runtime files, validated config, and no dev tooling', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'minefield-dist-'));
  try {
    build({out, quiet: true});
    assert.deepEqual(fs.readdirSync(out).sort(), [...RUNTIME_FILES].sort());
    for (const f of RUNTIME_FILES) {
      const text = fs.readFileSync(path.join(out, f), 'utf8');
      for (const word of ['MinefieldDevHooks', 'devHooks', '@dev-only', 'test-harness', '/api/', 'BroadcastChannel', 'dev-tools/']) assert(!text.includes(word), `${f} contains ${word}`);
    }
    assert.equal(fs.readFileSync(path.join(out, 'challenge-config.js'), 'utf8'), fs.readFileSync(path.join(root, 'challenge-config.js'), 'utf8'));
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert(html.indexOf('challenge-config.js') < html.indexOf('challenge.js"') && html.indexOf('challenge.js"') < html.indexOf('game.js'));
    assert(!/functions|_worker|_redirects/.test(fs.readdirSync(out).join(' ')), 'pure static output: no Pages Functions or workers');
    // The exported game boots from dist/ alone.
    const e = createEngine({gameSource: fs.readFileSync(path.join(out, 'game.js'), 'utf8'), rulesSource: fs.readFileSync(path.join(out, 'challenge.js'), 'utf8'), configSource: fs.readFileSync(path.join(out, 'challenge-config.js'), 'utf8')});
    e.setup('challenge', 13); assert.equal(e.state().mines.length, 8);
  } finally { fs.rmSync(out, {recursive: true, force: true}); }
});

// ---------- Local server, run against a throwaway copy of the project ----------
function copyProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minefield-dev-'));
  for (const f of [...RUNTIME_FILES, 'package.json']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  fs.cpSync(path.join(root, 'dev-tools'), path.join(dir, 'dev-tools'), {recursive: true, filter: src => !src.includes(`${path.sep}backups`)});
  return dir;
}
function startServer(dir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(dir, 'dev-tools/local-server/server.cjs'), '--no-open'], {env: {...process.env, PORT: String(46000 + Math.floor(Math.random() * 2000)), NO_OPEN: '1'}});
    let out = '';
    child.stdout.on('data', d => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\/editor\//); if (m) resolve({child, port: Number(m[1])}); });
    child.stderr.on('data', d => { out += d; });
    child.on('exit', code => reject(new Error(`server exited ${code}: ${out}`)));
  });
}
const stop = child => new Promise(r => { child.removeAllListeners('exit'); child.on('exit', r); child.kill(); });

test('local server: saves atomically with backup, persists across restarts, rejects invalid or foreign writes', async () => {
  const dir = copyProject(), configPath = path.join(dir, 'challenge-config.js');
  let server = await startServer(dir);
  const base = () => `http://127.0.0.1:${server.port}`;
  try {
    const original = fs.readFileSync(configPath, 'utf8');
    const got = await (await fetch(`${base()}/api/config`)).json();
    assert.deepEqual(got.config, current()); assert.deepEqual(got.baseline, configFile.readBaseline()); assert.equal(got.file, 'challenge-config.js');

    const post = (config, headers = {}) => fetch(`${base()}/api/config`, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify({config})});
    // Invalid settings: rejected, file untouched, no backup.
    const bad = clone(got.config); bad.waves[12].count = 20; bad.waves[12].behaviors.drift = 15;
    let res = await post(bad); let body = await res.json();
    assert.equal(res.status, 422); assert.equal(body.ok, false); assert(body.errors.some(e => /Wave 13: up to 120 mines/.test(e)));
    assert.equal(fs.readFileSync(configPath, 'utf8'), original); assert(!fs.existsSync(path.join(dir, 'dev-tools/backups')));

    // Cross-site and DNS-rebinding style requests are refused.
    res = await post(got.config, {Origin: 'https://evil.example'}); assert.equal(res.status, 403);
    res = await new Promise(resolve => {
      const req = require('node:http').request({host: '127.0.0.1', port: server.port, path: '/api/config', headers: {Host: 'evil.example'}}, resolve); req.end();
    }); assert.equal(res.statusCode, 403);
    res = await fetch(`${base()}/api/config`, {method: 'POST', headers: {'Content-Type': 'text/plain'}, body: '{}'}); assert.equal(res.status, 415);
    res = await fetch(`${base()}/api/config`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: 'x'.repeat(70000)}); assert.equal(res.status, 413);
    // No arbitrary files: only allowlisted paths are served, nothing else can be written.
    for (const p of ['/game/package.json', '/game/../package.json', '/game/%2e%2e/package.json', '/editor/../../challenge-config.js', '/api/../package.json', '/dev-tools/build.cjs'])
      assert.equal((await fetch(`${base()}${p}`)).status, 404, p);
    assert.equal((await fetch(`${base()}/api/config?file=../../x`, {method: 'PUT'})).status, 405);

    // Valid save: every wave edited independently, then persisted.
    const edited = clone(got.config);
    edited.waves.forEach((w, i) => { w.speed = 40 + i; w.turn = Number((.2 + i * .05).toFixed(2)); });
    res = await post(edited); body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body)); assert.equal(body.ok, true); assert.deepEqual(body.config, edited);
    assert.match(body.backup, /^dev-tools\/backups\/challenge-config\..+\.js$/);
    assert.equal(fs.readFileSync(path.join(dir, body.backup), 'utf8'), original, 'backup holds the previous file');
    assert.deepEqual(configFile.parse(fs.readFileSync(configPath, 'utf8')), edited);
    assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), [], 'no temp files left behind');

    await stop(server.child); server = await startServer(dir);
    assert.deepEqual((await (await fetch(`${base()}/api/config`)).json()).config, edited, 'persists after restart');
    // The test game is served with the saved file and the injected harness; the plain index.html is not modified.
    const page = await (await fetch(`${base()}/game/`)).text();
    assert(page.includes('/editor/test-harness.js')); assert(!fs.readFileSync(path.join(dir, 'index.html'), 'utf8').includes('harness'));
    assert.equal(await (await fetch(`${base()}/game/challenge-config.js`)).text(), fs.readFileSync(configPath, 'utf8'));

    // Restore baseline through the same API.
    res = await post(got.baseline); assert.equal(res.status, 200);
    assert.equal(fs.readFileSync(configPath, 'utf8'), original);
    assert.equal(fs.readdirSync(path.join(dir, 'dev-tools/backups')).length, 2);

    // Bound to loopback only: other interfaces refuse the connection.
    const lan = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
    if (lan) await assert.rejects(new Promise((resolve, reject) => { const s = net.connect(server.port, lan.address, () => { s.destroy(); resolve(); }); s.on('error', reject); }));
  } finally { await stop(server.child); fs.rmSync(dir, {recursive: true, force: true}); }
});

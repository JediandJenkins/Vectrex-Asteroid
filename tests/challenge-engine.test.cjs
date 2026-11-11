'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createEngine, seededRandom} = require('./helpers/engine.cjs');
const rules = require('../challenge.js');

test('actual engine spawns exact quotas, safe positions, and randomized headings/speeds/phases for all waves', () => {
  const e = createEngine();
  for (let wave = 1; wave <= 13; wave++) for (let seed = 1; seed <= 8; seed++) {
    e.setup('challenge', wave, seed); const s = e.state(), p = rules.wave(wave);
    assert.equal(s.mines.length, p.count);
    assert.deepEqual(Object.fromEntries(['drift','curve','surge','weave'].map(t => [t, s.mines.filter(m => m.behavior === t).length])), rules.quotas(wave));
    for (const m of s.mines) {
      assert(m.baseSpeed >= p.speed * .85 && m.baseSpeed <= p.speed * 1.2);
      const dx = Math.min(Math.abs(m.x - s.ship.x), s.width - Math.abs(m.x - s.ship.x));
      const dy = Math.min(Math.abs(m.y - s.ship.y), s.height - Math.abs(m.y - s.ship.y));
      assert(Math.hypot(dx, dy) >= 200);
    }
    assert.equal(s.ship.shield, 3);
    assert(new Set(s.mines.map(m => m.heading)).size > 1);
    assert(new Set(s.mines.map(m => m.phase)).size > 1);
  }
});
test('actual engine preserves every fragment under breadth-first and seeded random destruction orders', () => {
  const e = createEngine();
  for (let wave = 1; wave <= 13; wave++) for (let seed = 0; seed < 17; seed++) {
    e.setup('challenge', wave, seed); const random = seededRandom(seed); let kills = 0, peak = 0;
    while (e.q.raw().mines.length) {
      const mines = e.q.raw().mines, before = mines.length;
      const i = seed === 0 ? mines.findIndex(m => m.size === Math.max(...mines.map(m => m.size))) : Math.floor(random() * before);
      const parent = mines[i], fragments = rules.fragments(wave, parent.size); e.q.destroy(i); kills++;
      const after = e.q.raw().mines; assert.equal(after.length, before - 1 + fragments);
      if (fragments) for (const child of after.slice(-fragments)) {
        assert.equal(child.size, parent.size - 1); assert.equal(child.behavior, parent.behavior);
        const nominal = rules.wave(wave).speed + (3 - child.size) * 26;
        assert(child.baseSpeed >= nominal * .85 && child.baseSpeed <= nominal * 1.2);
      }
      peak = Math.max(peak, after.length); assert(peak <= 48);
    }
    assert.equal(kills, rules.wave(wave).count * 10);
    if (seed === 0) assert.equal(peak, rules.wave(wave).count * 6);
  }
});
test('actual campaign completes only after all 13 waves; rewards, final warning, and victory persist separately', () => {
  const legacy = {score: 99999, completed: true, bestTime: 100};
  const hard = {version: 'hard-v1', score: 65000, completed: true, bestTime: 200};
  const shared = {classic: {score: 1234, wave: 7}, challenge: legacy, impossible: {score: 4321, wave: 2, survival: 123}};
  const saved = {'minefield.records': JSON.stringify(shared), 'minefield.challenge.hard-v1': JSON.stringify(hard), 'minefield.glowLevel': 'intense', 'minefield.muted': 'true', 'minefield.bindings': '{"preserved":true}'};
  const e = createEngine({saved}); assert.equal(e.state().records.challenge.score, 0); e.setup('challenge');
  for (let wave = 1; wave <= 13; wave++) {
    assert.equal(e.state().wave, wave);
    while (e.q.raw().mines.length > 1) e.q.destroy(0);
    // The last object can still split; victory must wait for every descendant too.
    assert.equal(e.state().mode, 'playing');
    while (e.q.raw().mines.length) e.q.destroy(0);
    assert.equal(e.state().mode, 'playing'); e.q.update(1 / 120);
    assert.equal(e.state().lives, wave < 4 ? 3 : wave < 8 ? 4 : 5);
    if (wave === 12) {
      assert.equal(e.elements.get('announcement').textContent, 'FINAL MINEFIELD');
      assert.deepEqual(Array.from(e.q.tones.at(-1)), [880,220,.6,.18,'square']);
      e.q.pause(); e.q.pause(); assert.equal(e.elements.get('announcement').textContent, 'FINAL MINEFIELD');
      e.q.update(1); assert.equal(e.state().wave, 12); e.q.update(1.31);
    } else if (wave < 13) e.q.update(2.31);
  }
  const s = e.state(); assert.equal(s.mode, 'victory'); assert.equal(s.completedWaves, 13);
  assert.equal(s.score, 52360); assert.equal(s.lives, 5); assert.equal(e.elements.get('menu-title').textContent, 'MINEFIELD CLEARED');
  assert(s.records.challenge.completed); assert(s.records.challenge.bestTime > 0);
  assert.deepEqual(JSON.parse(e.storage.get('minefield.challenge.hard-v1')), hard);
  assert.deepEqual(JSON.parse(e.storage.get('minefield.records')), shared);
  assert.equal(e.storage.get('minefield.bindings'), saved['minefield.bindings']);
  const reloaded = createEngine({saved: Object.fromEntries(e.storage)}).state();
  assert.deepEqual(reloaded.records.challenge, s.records.challenge); assert.equal(reloaded.glowLevel, 'intense'); assert.equal(reloaded.muted, true);
});
test('same seed reproduces real engine mines exactly', () => {
  const e = createEngine(); e.setup('challenge', 13, 123); const mines = e.state().mines;
  e.setup('challenge', 13, 123); assert.deepEqual(e.state().mines, mines);
});
test('Classic and Impossible formulas, starting lives, split counts, and rewards remain unchanged', () => {
  const e = createEngine();
  for (const type of ['classic','impossible']) for (const wave of [1,4,8,13,100]) {
    e.setup(type, wave); const s = e.state(), imp = type === 'impossible';
    assert.equal(s.lives, imp ? 1 : 3);
    assert.equal(s.difficulty.count, Math.min(imp ? 18 : 13, (imp ? 10 : 4) + Math.floor((wave - 1) * (imp ? 1.25 : .75))));
    assert.equal(s.difficulty.speed, (imp ? 88 : 30) + Math.min(wave - 1, imp ? Infinity : 30) * (imp ? 16 : 5));
    assert.equal(s.difficulty.turn, imp ? .65 + Math.log2(wave + 1) * .15 : .38);
    e.q.set({mines: [e.q.mine(3, 100, 100, 0)]}); e.q.destroy(0); assert.equal(e.q.raw().mines.length, imp ? 3 : 2);
    e.q.set({mines: [], waveDelay: 0}); e.q.update(.01); assert.equal(e.state().lives, imp ? 1 : 3 + (wave % 4 === 0 ? 1 : 0));
  }
});
test('swept bullets still split mines and an unshielded collision still removes a ship', () => {
  const e = createEngine(); e.setup('challenge', 13);
  e.q.set({ship: {x: 500, y: 400, shield: 100}, mines: [{...e.q.mine(3, 100, 100, 0, 'drift'), vx: 0, vy: 0}], bullets: [{x: 80, y: 100, vx: 540, vy: 0, life: 1}]});
  e.q.update(1/120); assert.equal(e.state().score, 20); assert.equal(e.q.raw().mines.length, 3);
  e.q.set({ship: {x: 500, y: 400, shield: 0}, mines: [{...e.q.mine(1, 500, 400, 0, 'drift'), vx: 0, vy: 0}], bullets: []});
  e.q.update(1/120); assert.equal(e.state().lives, 2); assert.equal(e.q.raw().ship.alive, false);
});
test('Challenge finale stays below Impossible opening in density, speed, steering and aggressive families', () => {
  const e = createEngine(); e.setup('impossible', 1); const impossible = e.state();
  const finale = rules.wave(13), mix = rules.quotas(13);
  assert(finale.count < impossible.mines.length);
  assert(finale.turn < impossible.difficulty.turn);
  assert(mix.surge + mix.weave < finale.count / 2);
  for (let stage = 0; stage <= 2; stage++) assert(finale.speed + stage * 26 < impossible.difficulty.speed + stage * 34);
  assert.equal(finale.count * finale.largeFragments * finale.mediumFragments, 48);
  for (let wave = 2; wave <= 13; wave++) {
    const previous = rules.wave(wave - 1), next = rules.wave(wave);
    assert(next.count >= previous.count && next.count <= previous.count + 1);
    assert(next.speed > previous.speed && next.speed <= previous.speed * 1.101);
    assert.equal(next.largeFragments, previous.largeFragments); assert.equal(next.mediumFragments, previous.mediumFragments);
  }
});

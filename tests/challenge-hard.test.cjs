'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../challenge.js');
const counts = [4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 12];
const speeds = [36, 42, 50, 60, 72, 86, 102, 120, 138, 154, 168, 180, 190];
const turns = [.38, .38, .38, .45, .45, .45, .55, .55, .55, .65, .70, .75, .80];
// Approved largest-remainder quotas, ordered Drift / Curve / Surge / Weave.
const quotas = [[4, 0, 0, 0], [4, 0, 0, 0], [5, 0, 0, 0], [2, 4, 0, 0], [2, 4, 0, 0], [3, 4, 0, 0], [2, 2, 4, 0], [2, 2, 4, 0], [2, 3, 4, 0], [1, 2, 5, 2], [1, 2, 5, 2], [1, 2, 6, 2], [1, 2, 6, 3]];
for (let w = 1; w <= 13; w++) {
  test(`wave ${w}: exact count, speed, turn, quotas, and split rules`, () => {
    const p = rules.wave(w);
    assert.equal(p.count, counts[w - 1]); assert.equal(p.speed, speeds[w - 1]); assert.equal(p.turn, turns[w - 1]);
    assert.deepEqual(Object.values(rules.quotas(w)), quotas[w - 1]);
    assert.equal(rules.fragments(w, 3), w >= 9 ? 3 : 2); assert.equal(rules.fragments(w, 2), 2); assert.equal(rules.fragments(w, 1), 0);
    for (const random of [() => 0, () => .999999, Math.random]) {
      const actual = {drift: 0, curve: 0, surge: 0, weave: 0};
      for (const type of rules.initialBehaviors(w, random)) actual[type]++;
      assert.deepEqual(Object.values(actual), quotas[w - 1]);
    }
  });
  test(`wave ${w}: all fragment families fit without truncation`, () => {
    const enemies = Array(counts[w - 1]).fill(3); let killed = 0, points = 0, peak = enemies.length;
    // Worst-case density: split all larger mines before shooting any small ones.
    while (enemies.length) {
      const size = Math.max(...enemies); enemies.splice(enemies.indexOf(size), 1); killed++; points += [0, 100, 50, 20][size];
      const wanted = rules.fragments(w, size), available = rules.maxMines - enemies.length;
      assert(wanted <= available, 'no approved fragment may be silently dropped');
      enemies.push(...Array(wanted).fill(size - 1)); peak = Math.max(peak, enemies.length);
      assert(enemies.length <= 72);
    }
    const branches = w >= 9 ? 3 : 2;
    assert.equal(peak, counts[w - 1] * branches * 2);
    assert.equal(killed, counts[w - 1] * (1 + branches + branches * 2));
    assert.equal(points, counts[w - 1] * (20 + branches * 50 + branches * 2 * 100));
  });
}
test('bonus ships only follow waves 4 and 8, with five total life opportunities', () => {
  assert.deepEqual(Array.from({length: 13}, (_, i) => i + 1).filter(rules.awardsLife), [4, 8]);
  assert.equal(3 + Array.from({length: 13}, (_, i) => rules.awardsLife(i + 1)).filter(Boolean).length, 5);
});
test('wave 13 tie priority favors Weave; its full tree is 12 large, 36 medium, 72 small', () => {
  assert.deepEqual(rules.quotas(13), {drift: 1, curve: 2, surge: 6, weave: 3});
  assert.equal(12 * rules.fragments(13, 3), 36); assert.equal(36 * rules.fragments(13, 2), 72);
});
test('random assignment does not make type totals random', () => {
  assert.notDeepEqual(rules.initialBehaviors(13, () => 0), rules.initialBehaviors(13, () => .999999));
});
test('record identity is versioned and the campaign ends at 13 profiles', () => {
  assert.equal(rules.version, 'hard-v1'); assert.equal(rules.recordKey, 'minefield.challenge.hard-v1');
  assert.throws(() => rules.wave(0), RangeError); assert.throws(() => rules.wave(14), RangeError);
});

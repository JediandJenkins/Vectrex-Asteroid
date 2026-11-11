'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../challenge.js');
const counts = [3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 7, 7, 8];
const speeds = [30, 32, 34, 37, 40, 44, 48, 52, 56, 60, 64, 68, 72];
const turns = [.28, .28, .28, .30, .32, .34, .36, .38, .40, .42, .44, .47, .50];
// Explicit compositions keep aggressive families limited as density gradually increases.
const quotas = [[3,0,0,0], [3,0,0,0], [4,0,0,0], [3,1,0,0], [2,2,0,0], [3,2,0,0], [2,2,1,0], [3,2,1,0], [2,2,2,0], [2,2,1,1], [3,2,1,1], [2,2,2,1], [3,2,2,1]];
for (let w = 1; w <= 13; w++) {
  test(`wave ${w}: exact count, speed, turn, quotas, and split rules`, () => {
    const p = rules.wave(w);
    assert.equal(p.count, counts[w - 1]); assert.equal(p.speed, speeds[w - 1]); assert.equal(p.turn, turns[w - 1]);
    assert.deepEqual(Object.values(rules.quotas(w)), quotas[w - 1]);
    assert.equal(rules.fragments(w, 3), 3); assert.equal(rules.fragments(w, 2), 2); assert.equal(rules.fragments(w, 1), 0);
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
    const branches = 3;
    assert.equal(peak, counts[w - 1] * branches * 2);
    assert.equal(killed, counts[w - 1] * (1 + branches + branches * 2));
    assert.equal(points, counts[w - 1] * (20 + branches * 50 + branches * 2 * 100));
  });
}
test('bonus ships only follow waves 4 and 8, with five total life opportunities', () => {
  assert.deepEqual(Array.from({length: 13}, (_, i) => i + 1).filter(rules.awardsLife), [4, 8]);
  assert.equal(3 + Array.from({length: 13}, (_, i) => rules.awardsLife(i + 1)).filter(Boolean).length, 5);
});
test('wave 13 is eight families with only three Surge/Weave families and 48 small mines', () => {
  assert.deepEqual(rules.quotas(13), {drift: 3, curve: 2, surge: 2, weave: 1});
  assert.equal(8 * rules.fragments(13, 3), 24); assert.equal(24 * rules.fragments(13, 2), 48);
});
test('random assignment does not make type totals random', () => {
  assert.notDeepEqual(rules.initialBehaviors(13, () => 0), rules.initialBehaviors(13, () => .999999));
});
test('record identity is versioned and the campaign ends at 13 profiles', () => {
  assert.equal(rules.version, 'balanced-v2'); assert.equal(rules.recordKey, 'minefield.challenge.balanced-v2');
  assert.throws(() => rules.wave(0), RangeError); assert.throws(() => rules.wave(14), RangeError);
});

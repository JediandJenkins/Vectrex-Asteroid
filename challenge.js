/* Approved Challenge Hard balance. Pure rules are also testable with Node, without browser dependencies. */
(function (root, factory) {
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.MinefieldChallenge = rules;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const version = 'hard-v1', maxMines = 72;
  const types = ['drift', 'curve', 'surge', 'weave'];
  const schedule = [[4, 36], [4, 42], [5, 50], [6, 60], [6, 72], [7, 86], [8, 102], [8, 120], [9, 138], [10, 154], [10, 168], [11, 180], [12, 190]];
  const profiles = schedule.map(([count, speed], i) => {
    const w = i + 1;
    const weights = w <= 3 ? [100, 0, 0, 0] : w <= 6 ? [40, 60, 0, 0] : w <= 9 ? [20, 30, 50, 0] : [10, 20, 50, 20];
    const profile = {count, speed, turn: w <= 3 ? .38 : w <= 6 ? .45 : w <= 9 ? .55 : [.65, .70, .75, .80][w - 10], largeFragments: w >= 9 ? 3 : 2, mediumFragments: 2, weights: Object.freeze(weights)};
    // Every original large mine has a bounded leaf count. This proves the live cap cannot clip
    // Challenge descendants, even when all larger mines are split before any small ones are shot.
    if (count * profile.largeFragments * profile.mediumFragments > maxMines) throw new Error('Challenge fragment budget exceeds the active-mine cap');
    return Object.freeze(profile);
  });
  function wave(number) {
    if (!Number.isInteger(number) || number < 1 || number > profiles.length) throw new RangeError('Challenge wave must be 1–13');
    return profiles[number - 1];
  }
  function quotas(number) {
    const p = wave(number);
    // Integer remainder arithmetic preserves exact ties. Higher type index wins: Weave > Surge > Curve > Drift.
    const shares = p.weights.map((weight, index) => ({index, count: Math.floor(p.count * weight / 100), remainder: p.count * weight % 100}));
    const remaining = p.count - shares.reduce((sum, share) => sum + share.count, 0);
    [...shares].sort((a, b) => b.remainder - a.remainder || b.index - a.index).slice(0, remaining).forEach(share => shares[share.index].count++);
    return Object.fromEntries(shares.map(share => [types[share.index], share.count]));
  }
  function initialBehaviors(number, random = Math.random) {
    const counts = quotas(number), result = types.flatMap(type => Array(counts[type]).fill(type));
    // Counts are deterministic; spatial assignment remains randomized along with headings, speeds and phases.
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  }
  function fragments(number, size) { const p = wave(number); return size === 3 ? p.largeFragments : size === 2 ? p.mediumFragments : 0; }
  return Object.freeze({version, recordKey: `minefield.challenge.${version}`, maxMines, wave, quotas, initialBehaviors, fragments, awardsLife: completedWave => completedWave === 4 || completedWave === 8});
});

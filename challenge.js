/* Challenge campaign balance. Pure rules also run in dependency-free Node tests. */
(function (root, factory) {
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.MinefieldChallenge = rules;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const version = 'balanced-v2', maxMines = 72;
  const types = ['drift', 'curve', 'surge', 'weave'];
  // Large count, nominal speed, turn coefficient, then exact Drift / Curve / Surge / Weave quotas.
  // Keep splitting consistent from the first wave; fewer opening families offset the third medium.
  const schedule = [
    [3, 30, .28, 3, 0, 0, 0],
    [3, 32, .28, 3, 0, 0, 0],
    [4, 34, .28, 4, 0, 0, 0],
    [4, 37, .30, 3, 1, 0, 0],
    [4, 40, .32, 2, 2, 0, 0],
    [5, 44, .34, 3, 2, 0, 0],
    [5, 48, .36, 2, 2, 1, 0],
    [6, 52, .38, 3, 2, 1, 0],
    [6, 56, .40, 2, 2, 2, 0],
    [6, 60, .42, 2, 2, 1, 1],
    [7, 64, .44, 3, 2, 1, 1],
    [7, 68, .47, 2, 2, 2, 1],
    [8, 72, .50, 3, 2, 2, 1]
  ];
  const profiles = schedule.map(([count, speed, turn, ...counts]) => {
    if (counts.reduce((sum, n) => sum + n, 0) !== count) throw new Error('Challenge behavior quotas must match its mine count');
    const profile = {count, speed, turn, largeFragments: 3, mediumFragments: 2, behaviors: Object.freeze(Object.fromEntries(types.map((type, i) => [type, counts[i]])))};
    // Every descendant has a bounded leaf budget; no destruction order can exceed this limit.
    if (count * profile.largeFragments * profile.mediumFragments > maxMines) throw new Error('Challenge fragment budget exceeds the active-mine cap');
    return Object.freeze(profile);
  });
  function wave(number) {
    if (!Number.isInteger(number) || number < 1 || number > profiles.length) throw new RangeError('Challenge wave must be 1–13');
    return profiles[number - 1];
  }
  function quotas(number) { return {...wave(number).behaviors}; }
  function initialBehaviors(number, random = Math.random) {
    const counts = quotas(number), result = types.flatMap(type => Array(counts[type]).fill(type));
    // Counts are deterministic; assignment, headings, speed multipliers, and phases stay randomized.
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  }
  function fragments(number, size) { const p = wave(number); return size === 3 ? p.largeFragments : size === 2 ? p.mediumFragments : 0; }
  return Object.freeze({version, recordKey: `minefield.challenge.${version}`, maxMines, wave, quotas, initialBehaviors, fragments, awardsLife: completedWave => completedWave === 4 || completedWave === 8});
});

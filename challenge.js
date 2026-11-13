/* Challenge campaign rules. Values live in challenge-config.js; this module validates them and
 * exposes pure rules that also run in dependency-free Node tests and the local difficulty editor. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const rules = factory(isNode ? () => require('./challenge-config.js') : () => root.MinefieldChallengeConfig);
  if (isNode) module.exports = rules;
  else root.MinefieldChallenge = rules;
})(typeof globalThis !== 'undefined' ? globalThis : this, loadConfig => {
  'use strict';
  const WAVES = 13, HARD_CAP = 72;
  const types = Object.freeze(['drift', 'curve', 'surge', 'weave']);
  const introductions = {curve: 'CURVING MINES', surge: 'SURGING MINES', weave: 'WEAVING MINES'};
  // Ranges are engine units: world units/sec on the 900x620 field, radians/sec, and split counts.
  // The ship tops out at 350 u/s and shots travel 540 u/s; limits keep every setting playable.
  const LIMITS = Object.freeze({
    count: {min: 1, max: 24, step: 1, unit: 'large mines'},
    speed: {min: 10, max: 200, step: 1, unit: 'u/s'},
    turn: {min: 0, max: 1.5, step: .01, unit: 'rad/s'},
    pulse: {min: 0, max: .5, step: .01, unit: '± speed'},
    speedMin: {min: .5, max: 1, step: .01, unit: '×'},
    speedMax: {min: 1, max: 1.6, step: .01, unit: '×'},
    fragmentSpeed: {min: 0, max: 80, step: 1, unit: 'u/s per split'},
    largeFragments: {min: 0, max: 4, step: 1, unit: 'medium'},
    mediumFragments: {min: 0, max: 4, step: 1, unit: 'small'},
    startingLives: {min: 1, max: 9, step: 1, unit: 'ships'},
    maxActiveMines: {min: 8, max: HARD_CAP, step: 1, unit: 'mines'},
    fastestMine: {max: 360, unit: 'u/s'}
  });
  const WAVE_KEYS = ['count', 'speed', 'turn', 'pulse', 'speedVariation', 'fragmentSpeed', 'largeFragments', 'mediumFragments', 'behaviors'];
  const TOP_KEYS = ['schema', 'version', 'startingLives', 'bonusLifeWaves', 'maxActiveMines', 'waves'];
  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const extraKeys = (o, allowed) => Object.keys(o).filter(k => !allowed.includes(k));
  // Live objects one large mine can become at once: itself, its mediums, or their smalls.
  const familyPeak = w => Math.max(1, w.largeFragments, w.largeFragments * w.mediumFragments);

  function validate(config) {
    const errors = [];
    const num = (value, key, where, integer = false) => {
      const limit = LIMITS[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) return errors.push(`${where}: ${key} must be a number`), false;
      if (integer && !Number.isInteger(value)) return errors.push(`${where}: ${key} must be a whole number`), false;
      if (value < limit.min || value > limit.max) return errors.push(`${where}: ${key} ${value} is outside ${limit.min}–${limit.max} ${limit.unit}`), false;
      return true;
    };
    if (!isObject(config)) return {ok: false, errors: ['Configuration must be an object']};
    for (const key of extraKeys(config, TOP_KEYS)) errors.push(`Unknown setting "${key}"`);
    if (config.schema !== 1) errors.push('schema must be 1');
    if (typeof config.version !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,39}$/.test(config.version)) errors.push('version must be 1–40 lowercase letters, digits, dots or dashes');
    num(config.startingLives, 'startingLives', 'Campaign', true);
    const capOk = num(config.maxActiveMines, 'maxActiveMines', 'Campaign', true);
    if (!Array.isArray(config.bonusLifeWaves) || config.bonusLifeWaves.some(w => !Number.isInteger(w) || w < 1 || w > WAVES - 1) || new Set(config.bonusLifeWaves).size !== config.bonusLifeWaves.length) {
      errors.push(`bonusLifeWaves must be distinct waves 1–${WAVES - 1}`);
    }
    if (!Array.isArray(config.waves) || config.waves.length !== WAVES) {
      errors.push(`waves must list exactly ${WAVES} waves`);
      return {ok: false, errors};
    }
    config.waves.forEach((w, i) => {
      const where = `Wave ${i + 1}`;
      if (!isObject(w)) return errors.push(`${where}: must be an object`);
      for (const key of extraKeys(w, WAVE_KEYS)) errors.push(`${where}: unknown setting "${key}"`);
      const countOk = num(w.count, 'count', where, true);
      num(w.speed, 'speed', where); num(w.turn, 'turn', where); num(w.pulse, 'pulse', where);
      const fragOk = num(w.fragmentSpeed, 'fragmentSpeed', where) & num(w.largeFragments, 'largeFragments', where, true) & num(w.mediumFragments, 'mediumFragments', where, true);
      const v = w.speedVariation;
      if (!Array.isArray(v) || v.length !== 2) errors.push(`${where}: speedVariation must be [minimum, maximum]`);
      else if (num(v[0], 'speedMin', where) & num(v[1], 'speedMax', where) && v[0] > v[1]) errors.push(`${where}: speed variation minimum exceeds maximum`);
      if (!isObject(w.behaviors)) errors.push(`${where}: behaviors must list ${types.join('/')} counts`);
      else {
        for (const key of extraKeys(w.behaviors, types)) errors.push(`${where}: unknown behavior "${key}"`);
        const quotas = types.map(t => w.behaviors[t]);
        if (quotas.some(n => !Number.isInteger(n) || n < 0)) errors.push(`${where}: behavior counts must be whole numbers ≥ 0`);
        else if (countOk && quotas.reduce((a, b) => a + b, 0) !== w.count) errors.push(`${where}: Drift + Curve + Surge + Weave must equal ${w.count} large mines`);
      }
      if (countOk && fragOk && capOk) {
        const peak = w.count * familyPeak(w);
        // No destruction order can exceed this, so the shared cap never silently drops a fragment.
        if (peak > config.maxActiveMines) errors.push(`${where}: up to ${peak} mines could be live at once; the limit is ${config.maxActiveMines}`);
      }
      if (fragOk && Array.isArray(v) && Number.isFinite(w.speed) && Number.isFinite(v[1]) && Number.isFinite(w.pulse)) {
        const stages = w.largeFragments ? w.mediumFragments ? 2 : 1 : 0;
        const fastest = (w.speed + stages * w.fragmentSpeed) * v[1] * (1 + w.pulse);
        if (fastest > LIMITS.fastestMine.max) errors.push(`${where}: fastest mine would reach ${Math.round(fastest)} u/s (limit ${LIMITS.fastestMine.max}; the ship tops out at 350)`);
      }
    });
    return {ok: errors.length === 0, errors};
  }

  function create(config) {
    const result = validate(config);
    if (!result.ok) throw new Error(`Invalid Challenge configuration:\n- ${result.errors.join('\n- ')}`);
    const profiles = config.waves.map(w => Object.freeze({
      count: w.count, speed: w.speed, turn: w.turn, pulse: w.pulse, fragmentSpeed: w.fragmentSpeed,
      speedMin: w.speedVariation[0], speedMax: w.speedVariation[1],
      largeFragments: w.largeFragments, mediumFragments: w.mediumFragments, peak: w.count * familyPeak(w),
      behaviors: Object.freeze(Object.fromEntries(types.map(t => [t, w.behaviors[t]])))
    }));
    const bonusWaves = new Set(config.bonusLifeWaves);
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
    // Banner text for behaviors appearing for the first time in the campaign.
    function introduced(number) {
      return types.filter(t => introductions[t] && wave(number).behaviors[t] > 0 && profiles.slice(0, number - 1).every(p => !p.behaviors[t])).map(t => introductions[t]);
    }
    return Object.freeze({version: config.version, recordKey: `minefield.challenge.${config.version}`, maxMines: config.maxActiveMines,
      startingLives: config.startingLives, waves: WAVES, wave, quotas, initialBehaviors, fragments, introduced,
      awardsLife: completedWave => bonusWaves.has(completedWave)});
  }

  return Object.freeze({...create(loadConfig()), create, validate, LIMITS, types, HARD_CAP});
});

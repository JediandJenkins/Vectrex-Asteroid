'use strict';
// Reads and writes challenge-config.js, the single production source of Challenge difficulty.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(ROOT, 'challenge-config.js');
const BASELINE_PATH = path.join(ROOT, 'dev-tools/difficulty-editor/baseline-config.json');
const BACKUP_DIR = path.join(ROOT, 'dev-tools/backups');
const RULES_PATH = path.join(ROOT, 'challenge.js');

const HEADER = `/* Challenge Mode difficulty configuration (loaded by challenge.js, validated before use).
 * Edit with the local difficulty editor: run \`npm run dev\`. Units: speed and fragmentSpeed in world
 * units/sec on the 900x620 field; turn in radians/sec; pulse is the Surge/Weave speed swing (0.22 = ±22%);
 * speedVariation is the random [min, max] multiplier per mine; fragments are pieces per split. */`;

// Fresh rules every call: the server must never validate against a stale require() cache.
function loadRules() {
  const sandbox = {module: {exports: {}}};
  // challenge.js loads its default config at startup; supply the current file so it can boot.
  const source = fs.readFileSync(RULES_PATH, 'utf8').replace("require('./challenge-config.js')", '__config');
  sandbox.__config = readConfig();
  vm.runInNewContext(source, sandbox, {filename: RULES_PATH});
  return sandbox.module.exports;
}

// Evaluate only this file's own UMD wrapper in an empty sandbox; no file system or process access.
function parse(source) {
  const sandbox = {module: {exports: {}}};
  vm.runInNewContext(source, sandbox, {filename: CONFIG_PATH, timeout: 250});
  return JSON.parse(JSON.stringify(sandbox.module.exports));
}

function readConfig() { return parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
function readBaseline() { return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')); }

function serialize(config) {
  // Canonical key order and one line per wave keep git diffs readable.
  const wave = w => JSON.stringify({count: w.count, speed: w.speed, turn: w.turn, pulse: w.pulse, speedVariation: w.speedVariation,
    fragmentSpeed: w.fragmentSpeed, largeFragments: w.largeFragments, mediumFragments: w.mediumFragments,
    behaviors: {drift: w.behaviors.drift, curve: w.behaviors.curve, surge: w.behaviors.surge, weave: w.behaviors.weave}});
  const body = [
    `  "schema": ${JSON.stringify(config.schema)},`,
    `  "version": ${JSON.stringify(config.version)},`,
    `  "startingLives": ${JSON.stringify(config.startingLives)},`,
    `  "bonusLifeWaves": ${JSON.stringify(config.bonusLifeWaves)},`,
    `  "maxActiveMines": ${JSON.stringify(config.maxActiveMines)},`,
    '  "waves": [',
    config.waves.map((w, i) => `    ${wave(w)}${i < config.waves.length - 1 ? ',' : ''}`).join('\n'),
    '  ]'
  ].join('\n');
  return `${HEADER}
(function (root, config) {
  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.MinefieldChallengeConfig = config;
})(typeof globalThis !== 'undefined' ? globalThis : this, {
${body}
});
`;
}

// Validate, back up the current file, then replace atomically (write temp file, fsync, rename).
function writeConfig(config, rules = loadRules()) {
  const result = rules.validate(config);
  if (!result.ok) { const error = new Error('Configuration rejected'); error.validation = result.errors; throw error; }
  const text = serialize(config);
  const reparsed = parse(text);
  if (JSON.stringify(reparsed) !== JSON.stringify(parse(serialize(reparsed)))) throw new Error('Serialized configuration did not round-trip');
  if (!rules.validate(reparsed).ok) throw new Error('Serialized configuration failed validation');
  fs.mkdirSync(BACKUP_DIR, {recursive: true});
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(BACKUP_DIR, `challenge-config.${stamp}.js`);
  fs.copyFileSync(CONFIG_PATH, backup);
  const temp = path.join(path.dirname(CONFIG_PATH), `.challenge-config.${process.pid}.${Date.now()}.tmp`);
  try {
    const fd = fs.openSync(temp, 'wx', 0o644);
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, CONFIG_PATH);
  } catch (error) { fs.rmSync(temp, {force: true}); throw error; }
  return {backup: path.relative(ROOT, backup), config: reparsed};
}

module.exports = {ROOT, CONFIG_PATH, BASELINE_PATH, BACKUP_DIR, loadRules, parse, serialize, readConfig, readBaseline, writeConfig};

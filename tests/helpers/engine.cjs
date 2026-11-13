'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
function seededRandom(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// Run the actual game engine without rendering, audio, RAF, or a browser. Controls/UI have
// separate real-browser checks; this harness only substitutes their environment and clock.
function createEngine({seed = 1, saved = {}, gameSource, rulesSource, configSource, devHooks} = {}) {
  const storage = new Map(Object.entries(saved)), elements = new Map();
  const noop = () => {};
  const draw = new Proxy({createRadialGradient: () => ({addColorStop: noop})}, {get: (o, key) => o[key] || noop});
  const element = () => ({textContent: '', style: {}, dataset: {}, classList: {toggle: noop}, getContext: () => draw, getBoundingClientRect: () => ({width: 900, height: 620}), setAttribute: noop, addEventListener: noop, focus: noop});
  const document = {hidden: false, body: element(), querySelectorAll: () => [], createElement: element, getElementById: id => {if (!elements.has(id)) elements.set(id, element()); return elements.get(id);}};
  const input = {left: 0, right: 0, thrust: false, fire: false};
  const math = Object.create(Math); math.random = seededRandom(seed);
  const window = {devicePixelRatio: 1};
  const sandbox = vm.createContext({window, document, Math: math, navigator: {hardwareConcurrency: 8},
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value))},
    requestAnimationFrame: noop, matchMedia: () => ({matches: false}), ResizeObserver: class {observe() {}},
    Path2D: class {moveTo() {} lineTo() {} closePath() {}},
    createArcadeControls: () => ({state: input, reset: () => Object.assign(input, {left: 0, right: 0, thrust: false, fire: false}), syncMode: noop, renderBindings: noop}),
    createArcadeInterface: () => ({fullscreenState: 'windowed'})});
  if (devHooks) sandbox.MinefieldDevHooks = devHooks; // globalThis inside the sandbox, like window in a browser
  // Same load order as index.html: the configuration, then the rules that validate it.
  vm.runInContext(configSource || fs.readFileSync(path.join(root, 'challenge-config.js'), 'utf8'), sandbox);
  vm.runInContext(rulesSource || fs.readFileSync(path.join(root, 'challenge.js'), 'utf8'), sandbox);
  const source = gameSource || fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const tail = '  mainMenu(); glowUI(); hud(); muteUI(); resize(); requestAnimationFrame(frame);';
  if (!source.includes(tail)) throw new Error('Game bootstrap changed; update the engine test hook');
  const hook = `window.__test = {start, spawnWave, destroy, update, pause, difficulty, mine, save, hud,
    raw: () => ({ship, mines, input, particles}),
    set: p => {if ('gameType' in p) gameType=p.gameType; if ('wave' in p) wave=p.wave; if ('completedWaves' in p) completedWaves=p.completedWaves; if ('mines' in p) mines=p.mines; if ('bullets' in p) bullets=p.bullets; if ('waveDelay' in p) waveDelay=p.waveDelay; if ('ship' in p) ship={...ship,...p.ship};},
    tones: []};
    const originalTone=tone; tone=(...args)=>{window.__test.tones.push(args);originalTone(...args)};\n`;
  vm.runInContext(source.replace(tail, hook + tail), sandbox);
  const q = window.__test;
  return {q, input, storage, elements, state: () => JSON.parse(window.render_game_to_text()),
    setup(type, wave = 1, nextSeed = seed) {
      math.random = seededRandom(nextSeed); q.set({gameType: type}); q.start();
      if (wave !== 1) {q.set({wave, completedWaves: wave - 1, mines: [], waveDelay: 0}); q.spawnWave();}
    }};
}
module.exports = {createEngine, seededRandom};

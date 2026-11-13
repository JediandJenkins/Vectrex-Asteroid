/* Local test harness. Injected ONLY by the dev server into /game/ (never part of index.html or dist/).
 * Defining MinefieldDevHooks puts game.js into isolated test mode: no records or preferences are saved. */
(() => {
  'use strict';
  const channel = new BroadcastChannel('minefield-difficulty-lab');
  const nativeRandom = Math.random;
  let api = null, rules = window.MinefieldChallenge, attempt = null, pendingStart = null, lastResult = null;
  let options = {wave: 1, seed: null, lives: null, stopAfterClear: true, autoRestart: false};

  // mulberry32: small, fast, and identical across browsers for repeatable spawns.
  function seeded(seed) {
    let a = seed >>> 0;
    return () => { a = a + 0x6D2B79F5 >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function signature(wave) {
    // Short FNV-1a hash of one wave's settings so attempts can be grouped by the exact values tested.
    const text = JSON.stringify(rules.wave(wave));
    let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
  }
  const campaignLives = wave => rules.startingLives + Array.from({length: wave - 1}, (_, i) => i + 1).filter(rules.awardsLife).length;
  const post = message => channel.postMessage(message);
  const snapshot = () => attempt && {...attempt, liveMines: api?.getState().mines ?? 0};

  function closeAttempt(outcome, elapsed) {
    if (!attempt) return;
    const done = {...attempt, outcome, duration: Math.max(0, (elapsed ?? api.getState().elapsed) - attempt.startElapsed), endedAt: new Date().toISOString()};
    attempt = null; lastResult = done;
    if (done.duration > .5 || outcome !== 'abandoned') post({type: 'attempt', attempt: done});
    post({type: 'live', attempt: null});
  }

  window.MinefieldDevHooks = {
    attach(handle) { api = handle; post({type: 'ready'}); if (pendingStart) { const s = pendingStart; pendingStart = null; startTest(s); } },
    beforeStart() {
      closeAttempt('abandoned');
      Math.random = options.seed === null ? nativeRandom : seeded(options.seed);
      const wave = Math.min(13, Math.max(1, options.wave));
      return {wave, lives: options.lives ?? campaignLives(wave)};
    },
    waveCleared({gameType, wave, elapsed}) {
      if (gameType !== 'challenge') return false;
      closeAttempt('cleared', elapsed);
      return options.stopAfterClear;
    },
    emit(name, data) {
      if (data.gameType && data.gameType !== 'challenge') return;
      if (name === 'waveStart') {
        attempt = {id: `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`, wave: data.wave, seed: options.seed, settings: signature(data.wave), startLives: data.lives, startElapsed: data.elapsed,
          deaths: 0, livesLost: 0, destroyed: 0, peak: data.mines, startedAt: new Date().toISOString()};
        banner();
      } else if (!attempt) return;
      else if (name === 'destroy') { attempt.destroyed++; attempt.peak = Math.max(attempt.peak, data.mines); }
      else if (name === 'shipLost') {
        attempt.deaths++; attempt.livesLost = attempt.startLives - data.lives;
        if (data.lives <= 0) closeAttempt('failed', data.elapsed);
      } else if (name === 'halted') relabelMenu(data.wave);
      post({type: 'live', attempt: snapshot()});
    }
  };

  function startTest(next) {
    options = {...options, ...next};
    if (!api) { pendingStart = next; return; }
    const card = document.querySelector('[data-mode="challenge"]');
    if (api.getState().mode === 'start' && card) card.click(); // keeps the menu's mode selection in sync
    api.startChallenge();
    banner();
  }

  function relabelMenu(wave) {
    const last = lastResult?.wave === wave ? lastResult : null;
    document.getElementById('menu-kicker').textContent = `TEST RUN · RECORDS OFF`;
    document.getElementById('menu-title').textContent = `WAVE ${String(wave).padStart(2, '0')} CLEARED`;
    document.getElementById('menu-description').textContent = last ? `TIME ${last.duration.toFixed(1)}s · DEATHS ${last.deaths} · DESTROYED ${last.destroyed} · PEAK ${last.peak}` : '';
    document.getElementById('start-btn').innerHTML = 'RESTART WAVE <span>↻</span>';
    document.getElementById('start-hint').textContent = 'PRESS ENTER TO RETRY THIS WAVE';
  }

  function applyRules(config) {
    try {
      rules = window.MinefieldChallenge.create(config);
      api?.setRules(rules);
      post({type: 'rules-applied'});
      if (options.autoRestart && api && ['playing', 'paused', 'gameover'].includes(api.getState().mode) && api.getState().gameType === 'challenge') startTest({});
    } catch (error) { post({type: 'error', message: error.message}); }
  }

  channel.addEventListener('message', ({data}) => {
    if (data.type === 'rules') applyRules(data.config);
    else if (data.type === 'options') options = {...options, ...data.options};
    else if (data.type === 'start') startTest(data.options || {});
    else if (data.type === 'hello' && api) post({type: 'ready'});
  });

  let bar;
  function banner() {
    if (!bar) {
      bar = document.createElement('div');
      bar.setAttribute('role', 'status');
      bar.style.cssText = 'position:fixed;left:50%;bottom:6px;transform:translateX(-50%);z-index:9999;padding:4px 12px;border:1px solid #22edff;color:#bff9ff;background:#000c;font:11px/1.4 "Courier New",monospace;letter-spacing:2px;pointer-events:none;box-shadow:0 0 10px #22edff55';
      document.addEventListener('DOMContentLoaded', () => document.body.append(bar));
      if (document.body) document.body.append(bar);
    }
    const wave = attempt?.wave ?? options.wave;
    bar.textContent = `TEST MODE · RECORDS OFF · WAVE ${String(wave).padStart(2, '0')} · ${options.seed === null ? 'RANDOM' : 'SEED ' + options.seed}`;
  }
  banner();
})();

(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d'), arena = $('arena');
  const haloCanvas = document.createElement('canvas'), haloCtx = haloCanvas.getContext('2d');
  // Cached light spill: the reference's broad royal-blue phosphor bloom, not just a cyan outline.
  const bloomSprite = document.createElement('canvas'); bloomSprite.width = bloomSprite.height = 96;
  const bloomCtx = bloomSprite.getContext('2d'), bloomGradient = bloomCtx.createRadialGradient(48, 48, 0, 48, 48, 48);
  for (const [stop, color] of [[0, 'rgba(10,170,255,.55)'], [.25, 'rgba(0,85,255,.42)'], [.5, 'rgba(0,30,255,.24)'], [.75, 'rgba(0,12,230,.08)'], [1, 'rgba(0,10,200,0)']]) bloomGradient.addColorStop(stop, color);
  bloomCtx.fillStyle = bloomGradient; bloomCtx.fillRect(0, 0, 96, 96);
  let bloomSources = [];
  const TAU = Math.PI * 2, STEP = 1 / 120, HALO_SCALE = .25;
  let W = 900, H = 620, scale = 1, mode = 'start', score = 0, best = 0, wave = 1, lives = 3;
  let ship, mines = [], bullets = [], particles = [], elapsed = 0, waveDelay = 0, respawn = 0, bannerTime = 0;
  // One engine, with explicit per-mode budgets and progression rules.
  const MODES = {
    classic: {name: 'CLASSIC', lives: 3, extraEvery: 4, waves: null, count: 4, countStep: .75, countCap: 13, speed: 30, speedStep: 5, speedWaves: 30, fragmentSpeed: 26, fragments: 2, maxMines: 72},
    challenge: {name: 'CHALLENGE', lives: 3, extraEvery: 4, waves: 13, count: 4, countStep: .65, countCap: 12, speed: 32, speedStep: 4, speedWaves: Infinity, fragmentSpeed: 26, fragments: 2, maxMines: 72},
    impossible: {name: 'IMPOSSIBLE', lives: 1, extraEvery: 0, waves: null, count: 10, countStep: 1.25, countCap: 18, speed: 88, speedStep: 16, speedWaves: Infinity, fragmentSpeed: 34, fragments: 3, maxMines: 72}
  };
  let gameType = 'classic', completedWaves = 0, glow = true, glowLevel = 'classic', victoryTime = 0, framePaths = null, vectorAlpha = 1, vectorMatrix = null;
  let pixelRatio = 1, mobileGlow = false, shieldLabel = '';
  const records = {classic: {score: 0, wave: 0}, challenge: {score: 0, bestTime: null, completed: false}, impossible: {score: 0, wave: 0, survival: 0}};
  const config = () => MODES[gameType];
  let accumulator = 0, previous = 0, muted = false, audio, master, thrustGain, thrustOsc;
  let display;
  const controls = createArcadeControls({getMode: () => mode, pause, audioInit, toggleSound, toggleFullscreen: () => display?.toggleFullscreen(), isFullscreenActive: () => display?.fullscreenActive || false, isOverlayOpen: () => $('help-dialog').open, isViewTransition: () => display?.transitioning || false});
  const input = controls.state;
  display = createArcadeInterface({getMode: () => mode, pause, resetInput: () => controls.resetForView(), refreshBindings: () => controls.renderBindings(), resize});
  const rand = (a, b) => a + Math.random() * (b - a);
  const wrap = (v, n) => ((v % n) + n) % n;
  const delta = (a, b, n) => wrap(a - b + n / 2, n) - n / 2;
  const distance = (a, b) => Math.hypot(delta(a.x, b.x, W), delta(a.y, b.y, H));
  const pad = n => String(n).padStart(6, '0');
  const nonnegative = n => Number.isFinite(n) && n >= 0 ? n : 0;
  const formatTime = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  try {
    const saved = JSON.parse(localStorage.getItem('minefield.records'));
    for (const name of Object.keys(records)) if (saved?.[name]) {
      const record = records[name], source = saved[name];
      record.score = Math.floor(nonnegative(source.score));
      if ('wave' in record) record.wave = Math.floor(nonnegative(source.wave));
      if ('survival' in record) record.survival = nonnegative(source.survival);
      if ('completed' in record) { record.completed = source.completed === true; record.bestTime = source.bestTime > 0 && Number.isFinite(source.bestTime) ? source.bestTime : null; }
    }
  } catch (_) {}
  try { records.classic.score = Math.max(records.classic.score, nonnegative(Number(localStorage.getItem('minefield.best')))); muted = localStorage.getItem('minefield.muted') === 'true'; const savedGlow = localStorage.getItem('minefield.glowLevel'); glowLevel = ['off', 'classic', 'intense'].includes(savedGlow) ? savedGlow : localStorage.getItem('minefield.glow') === 'false' ? 'off' : 'classic'; glow = glowLevel !== 'off'; if (savedGlow !== glowLevel) localStorage.setItem('minefield.glowLevel', glowLevel); } catch (_) {}
  best = records.classic.score;
  function save() { try { localStorage.setItem('minefield.records', JSON.stringify(records)); localStorage.setItem('minefield.best', String(records.classic.score)); localStorage.setItem('minefield.muted', String(muted)); localStorage.setItem('minefield.glow', String(glow)); localStorage.setItem('minefield.glowLevel', glowLevel); } catch (_) {} }
  function updateRecords(completed = false) {
    const record = records[gameType]; record.score = Math.max(record.score, score);
    if (gameType === 'classic') record.wave = Math.max(record.wave, wave);
    if (gameType === 'impossible') { record.wave = Math.max(record.wave, completedWaves); record.survival = Math.max(record.survival, elapsed); }
    if (gameType === 'challenge' && completed) { record.completed = true; record.bestTime = record.bestTime === null ? elapsed : Math.min(record.bestTime, elapsed); }
    best = record.score; save();
  }
  function renderRecords() {
    $('record-classic').textContent = `BEST ${pad(records.classic.score)} · WAVE ${records.classic.wave}`;
    $('record-challenge').textContent = `BEST ${pad(records.challenge.score)} · ${records.challenge.completed ? 'CLEARED · BEST TIME ' + formatTime(records.challenge.bestTime || 0) : 'NOT YET CLEARED'}`;
    $('record-impossible').textContent = `BEST ${pad(records.impossible.score)} · CLEARED ${records.impossible.wave} · LONGEST ${formatTime(records.impossible.survival)}`;
  }
  const GLOW_PROFILES = {
    classic: {bloom: .28, radius: .72, hot: 1, blueWidth: 6, blueAlpha: .15, cyanWidth: 2.3, cyanAlpha: .36, rim: 1.25, rimAlpha: .5, blur: 3},
    intense: {bloom: 1, radius: 1, hot: 1.2, blueWidth: 10, blueAlpha: .27, cyanWidth: 3.2, cyanAlpha: .68, rim: 1.55, rimAlpha: .85, blur: 5}
  };
  function glowUI() {
    glow = glowLevel !== 'off'; document.body.classList.toggle('glow-off', !glow); document.body.classList.toggle('glow-intense', glowLevel === 'intense');
    for (const button of document.querySelectorAll('[data-glow]')) button.setAttribute('aria-pressed', String(button.dataset.glow === glowLevel));
  }
  function audioInit() {
    try {
      if (!audio) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        audio = new Audio(); master = audio.createGain(); master.gain.value = muted ? 0 : .28; master.connect(audio.destination);
        thrustOsc = audio.createOscillator(); thrustOsc.type = 'sawtooth'; thrustOsc.frequency.value = 47;
        thrustGain = audio.createGain(); thrustGain.gain.value = 0; thrustOsc.connect(thrustGain); thrustGain.connect(master); thrustOsc.start();
      }
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    } catch (_) { /* Sound is optional if a browser denies audio access. */ }
  }
  function tone(start, end, duration, volume = .2, type = 'square') {
    if (!audio || muted || audio.state !== 'running') return;
    const oscillator = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
    oscillator.type = type; oscillator.frequency.setValueAtTime(start, now); oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, end), now + duration);
    gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    oscillator.connect(gain); gain.connect(master); oscillator.start(); oscillator.stop(now + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  function rumble(size) {
    if (!audio || muted || audio.state !== 'running') return;
    const length = .14 + size * .07, buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * length), audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
    source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = 350 + size * 110; gain.gain.value = .55;
    source.connect(filter); filter.connect(gain); gain.connect(master); source.start();
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  function toggleSound() { audioInit(); muted = !muted; if (master && audio) master.gain.setTargetAtTime(muted ? 0 : .28, audio.currentTime, .015); muteUI(); save(); }
  function muteUI() { $('settings-sound').textContent = muted ? 'Off' : 'On'; $('settings-sound').setAttribute('aria-pressed', String(!muted)); $('sound-label').textContent = muted ? 'OFF' : 'ON'; $('mute-btn').setAttribute('aria-pressed', String(muted)); $('mute-btn').setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound'); }
  function hud() {
    $('score').textContent = pad(score); $('best').textContent = pad(best); $('wave').textContent = String(wave).padStart(2, '0') + (gameType === 'challenge' ? '/13' : '');
    $('lives').textContent = lives > 5 ? `△ ×${lives}` : '△ '.repeat(lives).trim() || '—'; $('lives').setAttribute('aria-label', `${lives} ships remaining`);
  }
  function active(action) { return Boolean(input[action]); }
  function clearInput() { controls.reset(); if (thrustGain && audio) thrustGain.gain.setTargetAtTime(0, audio.currentTime, .02); }
  function announce(text, seconds = 2) { $('announcement').textContent = text; bannerTime = seconds; }
  function newShip(invulnerability = 3) {
    // Choose the safest of a small set of spawn positions, with a shield as a fallback.
    const candidates = [{x: W / 2, y: H / 2}];
    for (let i = 0; i < 16; i++) candidates.push({x: rand(W * .15, W * .85), y: rand(H * .15, H * .85)});
    const safety = p => mines.length ? Math.min(...mines.map(m => distance(p, m) - m.r)) : Infinity;
    let p = candidates[0]; if (safety(p) < 140) p = candidates.reduce((a, b) => safety(a) > safety(b) ? a : b);
    ship = {...p, vx: 0, vy: 0, angle: -Math.PI / 2, shield: invulnerability, cooldown: 0, alive: true};
  }
  function difficulty() {
    const c = config();
    return {count: Math.min(c.countCap, c.count + Math.floor((wave - 1) * c.countStep)), speed: c.speed + Math.min(wave - 1, c.speedWaves) * c.speedStep,
      turn: gameType === 'impossible' ? .65 + Math.log2(wave + 1) * .15 : .38};
  }
  function mine(size, x, y, heading, inheritedBehavior) {
    const c = config(), d = difficulty(), r = [0, 12, 23, 39][size], angle = heading ?? rand(0, TAU);
    const speed = (d.speed + (3 - size) * c.fragmentSpeed) * rand(.85, 1.2), shape = [];
    for (let i = 0; i < 12; i++) shape.push((i % 2 ? rand(.48, .66) : rand(.82, 1)) * r);
    let behavior = inheritedBehavior || 'drift';
    if (!inheritedBehavior && gameType === 'challenge') {
      if (wave >= 4 && Math.random() < .45) behavior = 'curve';
      if (wave >= 8 && Math.random() < .4) behavior = 'surge';
    }
    if (!inheritedBehavior && gameType === 'impossible') behavior = Math.random() < .55 ? 'weave' : 'surge';
    return {vertices: shape.map((r, i) => [Math.cos(i / 12 * TAU) * r, Math.sin(i / 12 * TAU) * r]), x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, baseSpeed: speed, heading: angle, phase: rand(0, TAU), behavior, size, r, angle: rand(0, TAU), spin: rand(-.6, .6), shape};
  }
  function spawnWave() {
    const d = difficulty();
    // Rejection sampling with a safest-point fallback; shield also covers incoming trajectories.
    for (let i = 0; i < d.count; i++) {
      let p = {x: rand(0, W), y: rand(0, H)}, safest = p;
      for (let attempt = 0; attempt < 64 && distance(p, ship) < 200; attempt++) {
        if (distance(p, ship) > distance(safest, ship)) safest = p;
        p = {x: rand(0, W), y: rand(0, H)};
      }
      if (distance(p, ship) < 200) p = distance(safest, ship) >= 200 ? safest : {x: wrap(ship.x + W / 2, W), y: wrap(ship.y + H / 2, H)};
      const m = mine(3, p.x, p.y);
      // Guarantee each campaign introduction appears, rather than depending on a random roll.
      if (gameType === 'challenge' && i === 0 && wave >= 4) m.behavior = wave >= 8 ? 'surge' : 'curve';
      mines.push(m);
    }
    const variant = gameType === 'challenge' && wave === 4 ? '\nDRIFTING MINES' : gameType === 'challenge' && wave === 8 ? '\nSURGING MINES' : '';
    announce(`WAVE ${String(wave).padStart(2, '0')}${variant}`, 2.2); tone(170, 340, .25, .15, 'triangle');
    if (ship.alive) ship.shield = Math.max(ship.shield, 2);
    $('status').textContent = `${config().name} / FLIGHT ACTIVE`; updateRecords();
  }
  function start() {
    if (mode !== 'start') updateRecords();
    audioInit(); clearInput(); score = 0; wave = 1; lives = config().lives; completedWaves = 0; mines = []; bullets = []; particles = []; elapsed = 0; waveDelay = 0; respawn = 0; victoryTime = 0;
    newShip(); mode = 'playing'; spawnWave(); $('overlay').hidden = true; $('pause-btn').disabled = false; $('pause-btn').innerHTML = 'Ⅱ <span>PAUSE</span>'; $('pause-btn').setAttribute('aria-label', 'Pause game'); controls.syncMode(); $('game').focus({preventScroll: true}); hud();
  }
  function mainMenu() {
    if (mode !== 'start') updateRecords();
    mode = 'start'; clearInput(); mines = []; bullets = []; particles = []; ship = null; score = 0; wave = 1; lives = config().lives; elapsed = 0; completedWaves = 0;
    $('overlay').hidden = false; $('overlay').className = 'overlay home-overlay'; $('menu').className = 'menu home';
    $('menu-kicker').textContent = 'A TRIBUTE TO THE VECTOR AGE'; $('menu-title').innerHTML = 'MINE<span>FIELD</span>';
    $('menu-description').textContent = 'SELECT YOUR FLIGHT'; $('mode-selection').hidden = false; $('menu-facts').hidden = true;
    $('start-btn').innerHTML = 'START GAME <span>↗</span>'; $('main-menu-btn').hidden = true; $('help-btn').hidden = false; $('start-hint').textContent = 'PRESS ENTER OR TAP TO BEGIN';
    $('pause-btn').disabled = true; $('status').textContent = `${config().name} / SYSTEM READY`; $('announcement').textContent = ''; $('shield-notice').textContent = '';
    best = records[gameType].score; renderRecords(); hud(); $('overlay').scrollTop = 0;
  }
  function showMenu(kind) {
    const won = kind === 'victory', paused = kind === 'paused';
    $('overlay').hidden = false; $('overlay').className = `overlay ${won ? 'victory-overlay' : ''}`;
    $('menu').className = `menu compact ${won ? 'victory-menu' : !paused && gameType === 'impossible' ? 'impossible-result' : ''}`;
    $('mode-selection').hidden = true; $('menu-facts').hidden = true;
    $('menu-kicker').textContent = paused ? `${config().name} / FLIGHT ON HOLD` : won ? 'ALL 13 MINEFIELDS CLEARED' : `${config().name} / SIGNAL LOST`;
    $('menu-title').textContent = paused ? 'PAUSED' : won ? 'MINEFIELD CLEARED' : 'GAME OVER';
    $('menu-description').innerHTML = paused ? 'Take a breath. The field can wait.' : `FINAL SCORE ${pad(score)}<br>${won ? `SHIPS REMAINING ${lives}<br>COMPLETION TIME ${formatTime(elapsed)}` : `WAVE ${String(wave).padStart(2, '0')} · BEST ${pad(best)}<br>TIME ${formatTime(elapsed)}`}`;
    $('start-btn').innerHTML = paused ? 'RESUME <span>↗</span>' : won ? 'REPLAY CHALLENGE <span>↗</span>' : 'PLAY AGAIN <span>↗</span>';
    $('main-menu-btn').hidden = false; $('help-btn').hidden = !paused; $('start-hint').textContent = paused ? 'TAP TO RESUME' : 'PRESS ENTER OR TAP TO REPLAY';
    $('status').textContent = paused ? `${config().name} / FLIGHT PAUSED` : won ? 'CAMPAIGN COMPLETE' : `${config().name} / RUN ENDED`;
    $('announcement').textContent = ''; $('shield-notice').textContent = ''; controls.renderBindings();
    $('overlay').scrollTop = 0; if (!paused) $('start-btn').focus({preventScroll: true});
  }
  function finishWave() {
    completedWaves++; updateRecords();
    const bonus = config().extraEvery && completedWaves % config().extraEvery === 0;
    if (bonus) { lives++; tone(400, 900, .3, .15, 'triangle'); hud(); }
    if (config().waves && completedWaves >= config().waves) {
      mode = 'victory'; clearInput(); updateRecords(true); victoryTime = 0; showMenu('victory'); $('pause-btn').disabled = true; tone(440, 880, .7, .18, 'triangle'); return;
    }
    waveDelay = 2.3; announce(bonus ? 'FIELD CLEAR\nEXTRA SHIP +1' : 'FIELD CLEAR', 2);
  }
  function pause() {
    if (mode === 'playing') { mode = 'paused'; clearInput(); showMenu('paused'); $('pause-btn').innerHTML = '▷ <span>RESUME</span>'; $('pause-btn').setAttribute('aria-label', 'Resume game'); }
    else if (mode === 'paused') { clearInput(); mode = 'playing'; $('overlay').hidden = true; $('pause-btn').innerHTML = 'Ⅱ <span>PAUSE</span>'; $('pause-btn').setAttribute('aria-label', 'Pause game'); $('status').textContent = `${config().name} / FLIGHT ACTIVE`; if (bannerTime > 0) $('announcement').textContent = `WAVE ${String(wave).padStart(2, '0')}`; $('game').focus({preventScroll: true}); }
    controls.syncMode();
  }
  function burst(x, y, count, power) {
    for (let i = 0; i < count; i++) { const angle = rand(0, TAU), speed = rand(20, power); particles.push({x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: rand(.25, .8), max: .8, angle, length: rand(2, 9)}); }
    const limit = mobileGlow ? 180 : 300;
    if (particles.length > limit) particles.splice(0, particles.length - limit);
  }
  function destroy(index) {
    const m = mines[index]; mines.splice(index, 1); score += [0, 100, 50, 20][m.size];
    if (score > best) updateRecords();
    burst(m.x, m.y, 8 + m.size * 3, 70 + m.size * 20); rumble(m.size);
    if (m.size > 1) {
      const heading = Math.atan2(m.vy, m.vx), count = Math.min(config().fragments, config().maxMines - mines.length);
      for (let i = 0; i < count; i++) {
        const spread = (i - (count - 1) / 2) * .95;
        mines.push(mine(m.size - 1, wrap(m.x + Math.cos(heading + spread) * 8, W), wrap(m.y + Math.sin(heading + spread) * 8, H), heading + spread, m.behavior));
      }
    }
    hud();
  }
  function hitShip() {
    ship.alive = false; lives--; respawn = 1.1; burst(ship.x, ship.y, 36, 210); rumble(5); tone(180, 25, .6, .2, 'sawtooth'); hud();
    if (!lives) { mode = 'gameover'; clearInput(); updateRecords(); showMenu('gameover'); $('pause-btn').disabled = true; }
  }
  // Swept segment-circle collision, using nearest toroidal images. Prevents fast shots tunneling through small mines.
  function bulletHits(b, m, dx, dy) {
    const mx = delta(m.x, b.x, W), my = delta(m.y, b.y, H), length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, (mx * dx + my * dy) / length2)) : 0;
    return Math.hypot(mx - dx * t, my - dy * t) < m.r * .83 + 2;
  }
  function update(dt) {
    if (mode === 'victory') { if (!controls.settingsOpen && !document.hidden) victoryTime += dt; return; }
    if (mode !== 'playing') return;
    elapsed += dt;
    if (bannerTime > 0) { bannerTime -= dt; if (bannerTime <= 0) $('announcement').textContent = ''; }
    for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.x = wrap(p.x + p.vx * dt, W); p.y = wrap(p.y + p.vy * dt, H); p.life -= dt; if (p.life <= 0) particles.splice(i, 1); }
    const turn = difficulty().turn;
    for (const m of mines) {
      if (m.behavior !== 'drift') {
        m.phase += dt * (m.behavior === 'weave' ? 1.4 : .85);
        m.heading += dt * turn * (m.behavior === 'curve' ? 1 : Math.sin(m.phase));
        const speed = m.baseSpeed * (m.behavior === 'surge' || m.behavior === 'weave' ? 1 + .22 * Math.sin(m.phase * 1.3) : 1);
        m.vx = Math.cos(m.heading) * speed; m.vy = Math.sin(m.heading) * speed;
      }
      m.x = wrap(m.x + m.vx * dt, W); m.y = wrap(m.y + m.vy * dt, H); m.angle += m.spin * dt;
    }
    if (ship.alive) {
      ship.shield = Math.max(0, ship.shield - dt); ship.cooldown = Math.max(0, ship.cooldown - dt);
      ship.angle += (input.right - input.left) * 4.25 * dt;
      if (active('thrust')) { ship.vx += Math.cos(ship.angle) * 240 * dt; ship.vy += Math.sin(ship.angle) * 240 * dt; }
      const speed = Math.hypot(ship.vx, ship.vy); if (speed > 350) { ship.vx *= 350 / speed; ship.vy *= 350 / speed; }
      ship.vx *= Math.exp(-.13 * dt); ship.vy *= Math.exp(-.13 * dt);
      ship.x = wrap(ship.x + ship.vx * dt, W); ship.y = wrap(ship.y + ship.vy * dt, H);
      if (active('fire') && ship.cooldown <= 0) {
        const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
        bullets.push({x: wrap(ship.x + c * 17, W), y: wrap(ship.y + s * 17, H), vx: c * 540 + ship.vx, vy: s * 540 + ship.vy, life: .95});
        ship.cooldown = .16; tone(1100, 170, .085, .12, 'triangle');
      }
    } else { respawn -= dt; if (respawn <= 0) newShip(); }
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i], dx = b.vx * dt, dy = b.vy * dt; b.life -= dt;
      let hit = -1;
      if (b.life > 0) for (let j = 0; j < mines.length; j++) if (bulletHits(b, mines[j], dx, dy)) { hit = j; break; }
      if (hit !== -1) { destroy(hit); bullets.splice(i, 1); }
      else if (b.life <= 0) bullets.splice(i, 1);
      else { b.x = wrap(b.x + dx, W); b.y = wrap(b.y + dy, H); }
    }
    if (ship.alive && ship.shield <= 0 && mines.some(m => distance(ship, m) < m.r * .8 + 9)) hitShip();
    if (mode !== 'playing') return;
    if (!mines.length) {
      if (!waveDelay) finishWave();
      else { waveDelay -= dt; if (waveDelay <= 0) { waveDelay = 0; wave++; hud(); spawnWave(); } }
    }
  }
  // Batch transformed points directly, avoiding per-object Canvas state changes and DOMMatrix reads.
  function path(points, close = false) {
    const target = framePaths[Math.min(3, Math.floor(vectorAlpha * 4))], m = vectorMatrix;
    points.forEach(([x, y], i) => { const px = x * m.a + y * m.c + m.e, py = x * m.b + y * m.d + m.f; if (i) target.lineTo(px, py); else target.moveTo(px, py); });
    if (close) target.closePath();
  }
  function rotateVector(angle) {
    const c = Math.cos(angle), s = Math.sin(angle), m = vectorMatrix;
    vectorMatrix = {a: m.a * c + m.c * s, b: m.b * c + m.d * s, c: m.c * c - m.a * s, d: m.d * c - m.b * s, e: m.e, f: m.f};
  }
  function copies(e, radius, draw) {
    const xs = [e.x], ys = [e.y]; if (e.x < radius) xs.push(e.x + W); if (e.x > W - radius) xs.push(e.x - W); if (e.y < radius) ys.push(e.y + H); if (e.y > H - radius) ys.push(e.y - H);
    const previousMatrix = vectorMatrix;
    for (const x of xs) for (const y of ys) { vectorMatrix = {a: scale, b: 0, c: 0, d: scale, e: x * scale, f: y * scale}; draw(); }
    vectorMatrix = previousMatrix;
  }
  function collectBloom(e, radius, intensity, hot = false) {
    if (!glow) return;
    const profile = GLOW_PROFILES[glowLevel]; radius *= profile.radius; intensity = Math.min(1, intensity * profile.bloom * (hot ? profile.hot : 1));
    copies(e, radius * pixelRatio / scale, () => bloomSources.push({x: vectorMatrix.e / pixelRatio, y: vectorMatrix.f / pixelRatio, radius, intensity}));
  }
  function drawMine(m, opacity = 1) {
    collectBloom(m, m.r * scale / pixelRatio + 48, opacity * .9);
    vectorAlpha = opacity;
    copies(m, m.r + 8, () => {
      rotateVector(m.angle); path(m.vertices, true);
      if (m.size > 1) { const r = m.r * .17; path([[-r, 0], [0, -r], [r, 0], [0, r]], true); }
      if (m.behavior === 'curve' || m.behavior === 'weave') path([[-m.r * .35, 0], [0, -m.r * .35], [m.r * .35, 0]]);
      if (m.behavior === 'surge') path([[0, -m.r * .45], [0, m.r * .45]]);
    }); vectorAlpha = 1;
  }
  function drawShip() {
    if (!ship.alive) return;
    collectBloom(ship, 16 * scale / pixelRatio + 40, 1);
    copies(ship, 28, () => {
      if (ship.shield > 0) {
        vectorAlpha = .4 + .15 * Math.sin(elapsed * 10);
        const ring = []; for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; ring.push([Math.cos(a) * 25, Math.sin(a) * 25]); }
        for (let i = 0; i < 16; i += 2) path([ring[i], ring[(i + 1) % 16]]);
        vectorAlpha = 1;
      }
      rotateVector(ship.angle);
      if (active('thrust') && mode === 'playing') { vectorAlpha = .9; path([[-10, -5], [-20 - Math.sin(elapsed * 60) * 6, 0], [-10, 5]]); vectorAlpha = 1; }
      path([[16, 0], [-11, -10], [-7, 0], [-11, 10]], true);
    });
  }
  const attractMines = [mine(3, 95, 100), mine(2, 700, 120), mine(3, 760, 450), mine(2, 110, 490), mine(1, 530, 80)];
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    bloomSources = [];
    framePaths = Array.from({length: 4}, () => new Path2D());
    vectorMatrix = {a: scale, b: 0, c: 0, d: scale, e: 0, f: 0}; vectorAlpha = 1; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.globalAlpha = 1;
    if (mode === 'start') {
      for (const m of attractMines) { const e = {...m, x: m.x / 900 * W, y: m.y / 620 * H}; drawMine(e, .45); }
    } else {
      for (const m of mines) drawMine(m);
      for (const b of bullets) { collectBloom(b, 22, .65, true); copies(b, 8, () => { const n = Math.hypot(b.vx, b.vy); path([[0, 0], [-b.vx / n * 6, -b.vy / n * 6]]); }); }
      // Sample only the broad particle light spill at high counts; every particle still has its vector and line halo.
      const lightStride = Math.max(1, Math.ceil(particles.length / 40));
      particles.forEach((p, i) => { const fade = Math.max(0, p.life / p.max); if (i % lightStride === 0) collectBloom(p, 28, Math.min(1, .35 * fade * lightStride), true); vectorAlpha = fade; copies(p, 12, () => path([[0, 0], [Math.cos(p.angle) * p.length, Math.sin(p.angle) * p.length]])); });
      vectorAlpha = 1; drawShip();
      if (mode === 'victory') drawVictory();
    }
    flushVectors();
    if (thrustGain && audio) thrustGain.gain.setTargetAtTime(mode === 'playing' && ship.alive && active('thrust') ? .13 : 0, audio.currentTime, .035);
  }
  function drawVictory() {
    const motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : victoryTime;
    for (let i = 0; i < 3; i++) {
      const radius = 65 + (motion * 35 + i * 75) % 245; vectorAlpha = .55 * (1 - radius / 380);
      const points = []; for (let j = 0; j < 24; j++) { const a = j / 24 * TAU + motion * .08; points.push([W / 2 + Math.cos(a) * radius, H / 2 + Math.sin(a) * radius]); }
      path(points, true);
    }
    vectorAlpha = 1;
  }
  function flushVectors() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const stroke = (target, color, width, blur, alpha) => {
      target.strokeStyle = color; target.lineWidth = width; target.shadowColor = color; target.shadowBlur = blur;
      for (let i = 0; i < 4; i++) { target.globalAlpha = alpha * (i + 1) / 4; target.stroke(framePaths[i]); }
    };
    if (glow) {
      const profile = GLOW_PROFILES[glowLevel];
      // Only emitted light is composited at quarter CSS resolution. Geometry remains sharp at full canvas DPR.
      // Cached radial spill plus additive stroke bands make overlapping explosions bloom like phosphor.
      haloCtx.setTransform(1, 0, 0, 1, 0, 0); haloCtx.clearRect(0, 0, haloCanvas.width, haloCanvas.height);
      haloCtx.globalCompositeOperation = 'lighter'; haloCtx.shadowBlur = 0;
      haloCtx.setTransform(HALO_SCALE, 0, 0, HALO_SCALE, 0, 0);
      for (const light of bloomSources) {
        haloCtx.globalAlpha = light.intensity;
        haloCtx.drawImage(bloomSprite, light.x - light.radius, light.y - light.radius, light.radius * 2, light.radius * 2);
      }
      haloCtx.setTransform(HALO_SCALE / pixelRatio, 0, 0, HALO_SCALE / pixelRatio, 0, 0); haloCtx.lineCap = 'round'; haloCtx.lineJoin = 'round';
      stroke(haloCtx, '#087bff', pixelRatio * profile.blueWidth, HALO_SCALE * profile.blur, profile.blueAlpha);
      stroke(haloCtx, '#22edff', pixelRatio * profile.cyanWidth, HALO_SCALE, profile.cyanAlpha);
      ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.drawImage(haloCanvas, 0, 0, canvas.width, canvas.height);
      stroke(ctx, '#4cf5ff', Math.max(pixelRatio * profile.rim, scale * profile.rim), 0, profile.rimAlpha);
    }
    stroke(ctx, '#edfaff', Math.max(pixelRatio * .95, scale * 1.25), 0, 1);
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    const label = mode === 'playing' && ship.alive && ship.shield > 0 ? `SPAWN SHIELD ${ship.shield.toFixed(1)}s` : '';
    if (label !== shieldLabel) { shieldLabel = label; $('shield-notice').textContent = label; }
  }
  function resize() {
    const rect = arena.getBoundingClientRect(), oldW = W, oldH = H;
    const logicalScale = Math.min(rect.width / 900, rect.height / 620);
    if (logicalScale <= 0) return;
    W = rect.width / logicalScale; H = rect.height / logicalScale;
    for (const e of [...mines, ...bullets, ...particles, ...(ship ? [ship] : [])]) { e.x *= W / oldW; e.y *= H / oldH; }
    mobileGlow = rect.width < 600 || matchMedia('(any-pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4;
    const dpr = Math.min(window.devicePixelRatio || 1, mobileGlow ? 2 : 3); pixelRatio = dpr; canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); scale = logicalScale * dpr; haloCanvas.width = Math.ceil(canvas.width / dpr * HALO_SCALE); haloCanvas.height = Math.ceil(canvas.height / dpr * HALO_SCALE); render();
  }
  function frame(time) {
    const dt = previous ? Math.min((time - previous) / 1000, .05) : 0; previous = time;
    accumulator += dt; while (accumulator >= STEP) { update(STEP); accumulator -= STEP; }
    render(); requestAnimationFrame(frame);
  }
  $('start-btn').addEventListener('click', () => { audioInit(); if (mode === 'paused') pause(); else start(); });
  $('restart-btn').addEventListener('click', start);
  $('pause-btn').addEventListener('click', () => { audioInit(); pause(); });
  $('mute-btn').addEventListener('click', toggleSound);
  $('main-menu-btn').addEventListener('click', mainMenu);
  for (const button of document.querySelectorAll('[data-glow]')) button.addEventListener('click', () => { glowLevel = button.dataset.glow; glowUI(); save(); render(); });
  for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => {
    if (mode !== 'start') return; gameType = button.dataset.mode;
    for (const card of document.querySelectorAll('[data-mode]')) { const selected = card === button; card.classList.toggle('selected', selected); card.setAttribute('aria-pressed', String(selected)); }
    best = records[gameType].score; lives = config().lives; $('status').textContent = `${config().name} / SYSTEM READY`; hud();
  });
  new ResizeObserver(resize).observe(arena);
  window.render_game_to_text = () => JSON.stringify({mode, gameType, completedWaves, elapsed, glow, glowLevel, fullscreen: display.fullscreenState, helpOpen: $('help-dialog').open, records, difficulty: difficulty(), maxMines: config().maxMines, coordinates: 'origin top-left; x right; y down; angles radians, 0 right; toroidal wrapping', width: W, height: H, score, best, wave, lives, ship, mines: mines.map(({shape, vertices, ...m}) => m), bullets, particles: particles.length, waveDelay, respawn, inputs: ['left', 'right', 'thrust', 'fire'].filter(active), input: {...input}, settingsOpen: controls.settingsOpen, muted});
  window.advanceTime = ms => { const n = Math.max(1, Math.round(ms / (STEP * 1000))); for (let i = 0; i < n; i++) update(STEP); render(); };
  mainMenu(); glowUI(); hud(); muteUI(); resize(); requestAnimationFrame(frame);
})();

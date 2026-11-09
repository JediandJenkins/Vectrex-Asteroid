/* Input sources are combined here. The simulation reads only the shared state. */
'use strict';
window.createArcadeControls = ({ getMode, pause, audioInit, toggleSound, toggleFullscreen, isFullscreenActive, isOverlayOpen, isViewTransition }) => {
  const $ = id => document.getElementById(id);
  const actions = {left: 'Rotate Left', right: 'Rotate Right', thrust: 'Thrust', fire: 'Fire', pause: 'Pause'};
  const defaults = {left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], thrust: ['ArrowUp', 'KeyW'], fire: ['Space', 'KeyJ'], pause: ['KeyP', 'Escape']};
  const copyDefaults = () => Object.fromEntries(Object.entries(defaults).map(([action, codes]) => [action, [...codes]]));
  const validCode = code => typeof code === 'string' && /^(Key[A-Z]|Digit[0-9]|Arrow(Left|Right|Up|Down)|Space|Enter|Escape|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Minus|Equal|Bracket(Left|Right)|Backslash|Semicolon|Quote|Backquote|Comma|Period|Slash|Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter))$/.test(code);
  let bindings = copyDefaults(), visibility = 'auto', capture = null, joystickPointer = null;
  const heldCodes = new Set(), firePointers = new Set(), fireKeys = new Set();
  const stick = {x: 0, y: 0};
  const state = {left: 0, right: 0, thrust: false, fire: false};
  const dialog = $('settings-dialog'), joystick = $('joystick'), fireButton = $('fire-btn');
  const touchMedia = matchMedia('(any-pointer: coarse)');
  const bindingButtons = [];
  let touchVisible = false;
  const keyNames = {ArrowLeft: '← Left', ArrowRight: '→ Right', ArrowUp: '↑ Up', ArrowDown: '↓ Down', Space: 'Space', Escape: 'Escape', Backquote: '`', Minus: '−', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/'};
  const keyName = code => keyNames[code] || code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
  const actionFor = code => Object.keys(actions).find(action => bindings[action].includes(code));
  try {
    const saved = JSON.parse(localStorage.getItem('minefield.bindings'));
    if (saved) {
      const codes = [];
      const valid = Object.keys(actions).every(action => Array.isArray(saved[action]) && saved[action].length === 2 && saved[action].every(code => { codes.push(code); return validCode(code); }));
      if (valid && new Set(codes).size === 10) bindings = Object.fromEntries(Object.keys(actions).map(action => [action, [...saved[action]]]));
    }
    const preference = localStorage.getItem('minefield.mobileControls');
    if (['auto', 'show', 'hide'].includes(preference)) visibility = preference;
  } catch (_) { /* Defaults remain usable when storage is unavailable or invalid. */ }
  function savePreferences() {
    try { localStorage.setItem('minefield.bindings', JSON.stringify(bindings)); localStorage.setItem('minefield.mobileControls', visibility); } catch (_) {}
  }
  function sync() {
    const pressed = action => bindings[action].some(code => heldCodes.has(code));
    const horizontal = Math.abs(stick.x) <= .12 ? 0 : Math.sign(stick.x) * (Math.abs(stick.x) - .12) / .88;
    state.left = Math.max(pressed('left') ? 1 : 0, -horizontal, 0);
    state.right = Math.max(pressed('right') ? 1 : 0, horizontal, 0);
    state.thrust = pressed('thrust') || stick.y < -.35;
    state.fire = pressed('fire') || firePointers.size > 0 || fireKeys.size > 0;
    fireButton.classList.toggle('held', state.fire);
    joystick.classList.toggle('held', joystickPointer !== null);
    const travel = Math.max(1, (joystick.clientWidth - $('stick-knob').offsetWidth) / 2 - 3);
    joystick.style.setProperty('--stick-x', `${stick.x * travel}px`);
    joystick.style.setProperty('--stick-y', `${stick.y * travel}px`);
  }
  function reset() {
    heldCodes.clear(); fireKeys.clear(); stick.x = 0; stick.y = 0;
    const stickId = joystickPointer, fireIds = [...firePointers];
    joystickPointer = null; firePointers.clear();
    if (stickId !== null && joystick.hasPointerCapture(stickId)) joystick.releasePointerCapture(stickId);
    for (const id of fireIds) if (fireButton.hasPointerCapture(id)) fireButton.releasePointerCapture(id);
    sync(); syncMode();
  }
  function syncMode() { document.body.classList.toggle('in-flight', getMode() === 'playing'); }
  function renderBindings() {
    for (const button of bindingButtons) {
      const {action, slot} = button.dataset, listening = capture?.action === action && capture.slot === Number(slot);
      button.textContent = listening ? 'Press key…' : keyName(bindings[action][slot]);
      button.classList.toggle('listening', listening);
      button.setAttribute('aria-label', `${actions[action]}, ${Number(slot) === 0 ? 'primary' : 'secondary'}: ${keyName(bindings[action][slot])}. ${listening ? 'Press a key; Escape cancels.' : 'Change binding.'}`);
    }
    for (const hint of document.querySelectorAll('[data-hint]')) hint.textContent = bindings[hint.dataset.hint].map(keyName).join(' / ');
    if (getMode() === 'paused') $('start-hint').textContent = `${bindings.pause.map(keyName).join(' / ')} OR TAP TO RESUME`;
  }
  function cancelCapture(message = 'Binding unchanged.') { capture = null; $('binding-message').textContent = message; $('binding-message').classList.remove('conflict'); renderBindings(); }
  for (const [action, label] of Object.entries(actions)) {
    const row = document.createElement('div'); row.className = 'binding-row';
    const name = document.createElement('span'); name.textContent = label; row.append(name);
    for (let slot = 0; slot < 2; slot++) {
      const button = document.createElement('button'); button.className = 'key-binding'; button.dataset.action = action; button.dataset.slot = slot;
      button.addEventListener('click', () => { reset(); capture = {action, slot}; $('binding-message').classList.remove('conflict'); $('binding-message').textContent = `Press a key for ${label}. Escape cancels.`; renderBindings(); });
      bindingButtons.push(button); row.append(button);
    }
    $('binding-list').append(row);
  }
  function updateVisibility() {
    reset();
    touchVisible = visibility === 'show' || visibility === 'auto' && (touchMedia.matches || navigator.maxTouchPoints > 0);
    document.body.classList.toggle('touch-visible', touchVisible);
    $('mobile-controls').setAttribute('aria-hidden', String(!touchVisible));
    $('mobile-visibility').value = visibility;
  }
  function openSettings() {
    audioInit(); if (getMode() === 'playing') pause(); reset(); cancelCapture('Each key can be assigned to one binding.');
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0; $('settings-close').focus({preventScroll: true});
  }
  function closeSettings() { cancelCapture(); reset(); dialog.close(); }
  $('settings-btn').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', closeSettings);
  $('settings-done').addEventListener('click', closeSettings);
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (capture) cancelCapture(); else closeSettings(); });
  dialog.addEventListener('close', () => { cancelCapture(); reset(); });
  $('restore-bindings').addEventListener('click', () => { reset(); bindings = copyDefaults(); savePreferences(); cancelCapture('Default bindings restored.'); });
  $('settings-sound').addEventListener('click', toggleSound);
  $('mobile-visibility').addEventListener('change', event => { visibility = event.target.value; updateVisibility(); savePreferences(); });
  touchMedia.addEventListener('change', updateVisibility);
  // Capture runs before native button activation so Enter and Space can be rebound safely.
  window.addEventListener('keydown', event => {
    if (event.code === 'Escape' && isFullscreenActive()) {
      event.preventDefault(); if (capture) cancelCapture('Key capture canceled.'); if (!event.repeat) toggleFullscreen(); return;
    }
    if (dialog.open) {
      if (!capture) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.code === 'Escape') { cancelCapture(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey || !validCode(event.code)) { $('binding-message').textContent = 'Choose a single key without Ctrl, Alt, or Command.'; return; }
      const owner = actionFor(event.code);
      if (owner && (owner !== capture.action || bindings[owner][capture.slot] !== event.code)) {
        $('binding-message').textContent = `${keyName(event.code)} is already assigned to ${actions[owner]}. Choose another key, or Escape to cancel.`;
        $('binding-message').classList.add('conflict'); return;
      }
      const {action, slot} = capture; bindings[action][slot] = event.code; savePreferences(); cancelCapture(`${actions[action]} ${slot === 0 ? 'primary' : 'secondary'} set to ${keyName(event.code)}.`);
      return;
    }
    if (isOverlayOpen()) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const action = actionFor(event.code), playing = getMode() === 'playing';
    // A focused fire button retains its normal keyboard button behavior.
    if (event.target === fireButton && ['Space', 'Enter'].includes(event.code) && playing) {
      event.preventDefault(); if (!event.repeat) { audioInit(); fireKeys.add(event.code); sync(); } return;
    }
    if (action && (playing || getMode() === 'paused' && action === 'pause')) {
      event.preventDefault();
      if (event.repeat) return; // Ignore repeats after a reset until the key is released and pressed again.
      audioInit();
      if (action === 'pause') { reset(); pause(); renderBindings(); return; }
      heldCodes.add(event.code); sync(); return;
    }
    if (playing && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.code)) event.preventDefault();
    if (event.repeat) return;
    // Unbound utility shortcuts remain available, but never override customized bindings.
    if (!action && event.code === 'KeyM') { event.preventDefault(); toggleSound(); }
    if (!action && event.code === 'KeyF') { event.preventDefault(); toggleFullscreen(); }
    if (event.code === 'Enter' && getMode() !== 'playing' && !event.target.closest('button, a, select, input')) {
      event.preventDefault(); $('start-btn').click();
    }
  }, true);
  window.addEventListener('keyup', event => {
    heldCodes.delete(event.code); fireKeys.delete(event.code); sync();
    if (!dialog.open && getMode() === 'playing' && actionFor(event.code)) event.preventDefault();
  });
  function moveStick(event) {
    if (event.pointerId !== joystickPointer) return;
    event.preventDefault();
    const rect = joystick.getBoundingClientRect(), radius = Math.max(1, (rect.width - $('stick-knob').offsetWidth) / 2 - 3);
    let x = (event.clientX - rect.left - rect.width / 2) / radius, y = (event.clientY - rect.top - rect.height / 2) / radius;
    const length = Math.hypot(x, y); if (length > 1) { x /= length; y /= length; }
    if (length < .12) { x = 0; y = 0; }
    stick.x = x; stick.y = y; sync();
  }
  joystick.addEventListener('pointerdown', event => {
    event.preventDefault(); if (getMode() !== 'playing' || dialog.open || isOverlayOpen() || !touchVisible || joystickPointer !== null || event.button !== 0) return;
    audioInit(); joystickPointer = event.pointerId; joystick.setPointerCapture(event.pointerId); moveStick(event);
  });
  joystick.addEventListener('pointermove', moveStick);
  function releaseStick(event) { if (event.pointerId !== joystickPointer) return; joystickPointer = null; stick.x = 0; stick.y = 0; sync(); }
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) joystick.addEventListener(name, releaseStick);
  fireButton.addEventListener('pointerdown', event => {
    event.preventDefault(); if (getMode() !== 'playing' || dialog.open || isOverlayOpen() || !touchVisible || event.button !== 0) return;
    audioInit(); firePointers.add(event.pointerId); fireButton.setPointerCapture(event.pointerId); sync();
  });
  function releaseFire(event) { firePointers.delete(event.pointerId); sync(); }
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) fireButton.addEventListener(name, releaseFire);
  fireButton.addEventListener('blur', () => { fireKeys.clear(); sync(); });
  for (const element of [joystick, fireButton]) element.addEventListener('contextmenu', event => event.preventDefault());
  function backgroundReset() { reset(); if (capture) cancelCapture('Capture canceled because the window lost focus.'); if (getMode() === 'playing' && (document.hidden || !isViewTransition())) pause(); }
  window.addEventListener('blur', backgroundReset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) backgroundReset(); });
  // Old pointer coordinates are invalid after rotation, resize, or a visibility change.
  window.addEventListener('resize', reset);
  updateVisibility(); renderBindings();
  return {state, reset, resetForView: () => { reset(); if (capture) cancelCapture('Key capture canceled because the view changed.'); }, syncMode, renderBindings, get settingsOpen() { return dialog.open; }};
};

/* View-only controls: native fullscreen where possible, an honest layout fallback otherwise. */
'use strict';
window.createArcadeInterface = ({getMode, pause, resetInput, refreshBindings, resize}) => {
  const $ = id => document.getElementById(id);
  const root = document.documentElement, help = $('help-dialog');
  let fallback = false, transitioning = false, resumeAfterHelp = false;
  const nativeElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const active = () => Boolean(nativeElement()) || fallback;
  const state = () => nativeElement() ? 'native' : fallback ? 'immersive' : 'windowed';
  function syncFullscreen() {
    if (nativeElement()) fallback = false;
    document.body.classList.toggle('screen-expanded', active());
    document.body.classList.toggle('fullscreen-fallback', fallback);
    const label = fallback ? 'Exit immersive layout' : nativeElement() ? 'Exit fullscreen' : 'Enter fullscreen';
    $('fullscreen-btn').setAttribute('aria-label', label); $('fullscreen-btn').setAttribute('aria-pressed', String(active()));
    $('fullscreen-btn').title = `${label} (F when unassigned)`;
    $('fullscreen-label').textContent = active() ? fallback ? 'EXIT VIEW' : 'EXIT FULLSCREEN' : 'FULLSCREEN';
    $('fullscreen-icon').setAttribute('d', active() ? 'M3 9h6V3m12 6h-6V3M9 21v-6H3m12 6v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6');
    $('fullscreen-notice').hidden = !fallback;
    $('fullscreen-notice').textContent = fallback ? 'Immersive layout · Browser controls remain visible.' : '';
    requestAnimationFrame(resize);
  }
  async function toggleFullscreen() {
    if (transitioning) return;
    transitioning = true; resetInput();
    try {
      if (nativeElement()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      } else if (fallback) fallback = false;
      else {
        const request = root.requestFullscreen || root.webkitRequestFullscreen;
        const enabled = root.requestFullscreen ? document.fullscreenEnabled !== false : document.webkitFullscreenEnabled !== false;
        if (request && enabled) {
          try { await request.call(root); } catch (_) { fallback = true; }
          // Some prefixed APIs return before their fullscreen-change event.
          if (!nativeElement() && !fallback) {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            if (!nativeElement()) fallback = true;
          }
        } else fallback = true;
      }
    } catch (_) { if (!nativeElement()) fallback = true; }
    finally {
      syncFullscreen();
      requestAnimationFrame(() => {
        transitioning = false;
        if (getMode() === 'playing' && !help.open && !$('settings-dialog').open) {
          if (!document.hidden && document.hasFocus()) $('game').focus({preventScroll: true});
          else pause();
        }
      });
    }
  }
  $('fullscreen-btn').addEventListener('click', toggleFullscreen);
  for (const event of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(event, () => { resetInput(); syncFullscreen(); });
  function openHelp() {
    if (help.open) return;
    resumeAfterHelp = getMode() === 'playing';
    if (resumeAfterHelp) pause();
    resetInput(); refreshBindings(); help.showModal(); help.scrollTop = 0; $('help-close').focus({preventScroll: true});
  }
  function closeHelp() { help.close(); }
  $('help-btn').addEventListener('click', openHelp);
  $('help-close').addEventListener('click', closeHelp);
  $('help-back').addEventListener('click', closeHelp);
  help.addEventListener('keydown', event => {
    if (event.code !== 'Tab') return;
    const first = $('help-close'), last = $('help-back');
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  help.addEventListener('cancel', event => { event.preventDefault(); closeHelp(); });
  help.addEventListener('close', () => { resetInput(); const resume = resumeAfterHelp; resumeAfterHelp = false; if (resume && getMode() === 'paused' && !document.hidden && document.hasFocus()) pause(); });
  syncFullscreen();
  return {toggleFullscreen, openHelp, get fullscreenActive() { return active(); }, get fullscreenState() { return state(); }, get transitioning() { return transitioning; }};
};

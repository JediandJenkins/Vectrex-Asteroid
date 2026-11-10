'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../game.js'), 'utf8');
// Exercise the game's real initializer with controllable browser audio lifecycle states.
const initializer = source.slice(source.indexOf('  function audioInit()'), source.indexOf('  function tone('));
function harness({state = 'running', muted = false, prefixed = false, unavailable = false, rejectResume = false} = {}) {
  const contexts = [];
  class Context {
    constructor() { this.state = state; this.destination = {}; this.resumes = 0; this.nodes = []; contexts.push(this); }
    createGain() { const node = {gain: {value: 1}, connect() {}}; this.nodes.push(node); return node; }
    createOscillator() { const node = {frequency: {value: 0}, starts: 0, connect() {}, start() { this.starts++; }}; this.nodes.push(node); return node; }
    resume() { this.resumes++; if (rejectResume) return Promise.reject(new Error('Audio blocked')); this.state = 'running'; return Promise.resolve(); }
  }
  const window = unavailable ? {} : prefixed ? {webkitAudioContext: Context} : {AudioContext: Context};
  const sandbox = vm.createContext({window});
  vm.runInContext(`let audio, master, thrustGain, thrustOsc, muted = ${muted};\n${initializer}\nglobalThis.qa = {init: audioInit, get: () => ({audio, master, thrustGain, thrustOsc})};`, sandbox);
  return {contexts, qa: sandbox.qa};
}
test('audio is created only on interaction; repeated inputs reuse its graph', () => {
  const {qa, contexts} = harness(); assert.equal(contexts.length, 0);
  qa.init(); qa.init(); assert.equal(contexts.length, 1);
  assert.equal(qa.get().master.gain.value, .28); assert.equal(qa.get().thrustGain.gain.value, 0);
  assert.equal(qa.get().thrustOsc.starts, 1); assert.equal(contexts[0].resumes, 0);
});
for (const state of ['suspended', 'interrupted']) test(`interaction recovers a ${state} context`, () => {
  const {qa, contexts} = harness(); qa.init(); contexts[0].state = state; qa.init();
  assert.equal(contexts.length, 1); assert.equal(contexts[0].resumes, 1); assert.equal(contexts[0].state, 'running');
});
test('a closed context is replaced with a fresh connected graph', () => {
  const {qa, contexts} = harness(); qa.init(); const previous = qa.get(); previous.audio.state = 'closed'; qa.init();
  assert.equal(contexts.length, 2); assert.notEqual(qa.get().audio, previous.audio); assert.notEqual(qa.get().master, previous.master);
  assert.equal(qa.get().master.gain.value, .28); assert.equal(qa.get().thrustOsc.starts, 1);
});
test('recovery preserves mute and zero thrust gain', () => {
  const {qa, contexts} = harness({muted: true}); qa.init(); contexts[0].state = 'closed'; qa.init();
  assert.equal(qa.get().master.gain.value, 0); assert.equal(qa.get().thrustGain.gain.value, 0);
});
test('prefixed AudioContext remains supported', () => {
  const {qa, contexts} = harness({prefixed: true, state: 'suspended'}); qa.init(); assert.equal(contexts[0].state, 'running');
});
test('unavailable audio does not break play', () => {
  const {qa, contexts} = harness({unavailable: true}); assert.doesNotThrow(() => qa.init()); assert.equal(contexts.length, 0);
});
test('a rejected resume is caught and another interaction can retry', async () => {
  const {qa, contexts} = harness({state: 'interrupted', rejectResume: true}); qa.init(); await new Promise(resolve => setImmediate(resolve)); qa.init();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(contexts[0].resumes, 2);
});

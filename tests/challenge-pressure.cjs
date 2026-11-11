'use strict';
// Repeatable pressure probes through the real engine. No aiming, dodging, firing, damage,
// or human skill is modeled. These are controlled density snapshots, NOT difficulty proof.
// Run: node tests/challenge-pressure.cjs > pressure.json
const {createEngine} = require('./helpers/engine.cjs');
const e = createEngine(), rows = [];
const seeds = 12, seconds = 30, step = 1 / 120, warmup = 3;
for (const type of ['challenge', 'impossible']) for (const stage of [3, 2, 1]) for (const pilot of ['stationary', 'straight-thrust', 'turn-thrust']) {
  let entries = 0, exposedSteps = 0, count = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    e.setup(type, type === 'challenge' ? 13 : 1, seed);
    while (e.q.raw().mines.some(m => m.size > stage)) e.q.destroy(e.q.raw().mines.findIndex(m => m.size > stage));
    const {ship, mines, particles} = e.q.raw(); count = mines.length; particles.length = 0;
    ship.shield = Infinity; ship.angle = 0;
    Object.assign(e.input, {left: 0, right: pilot === 'turn-thrust' ? .16 : 0, thrust: pilot !== 'stationary', fire: false});
    const previous = new Set();
    for (let frame = 0; frame < seconds / step; frame++) {
      e.q.update(step); let exposed = false;
      mines.forEach((m, i) => {
        const dx = Math.abs(ship.x - m.x), dy = Math.abs(ship.y - m.y);
        const inside = Math.hypot(Math.min(dx, 900 - dx), Math.min(dy, 620 - dy)) < m.r * .8 + 9;
        if (inside) {
          exposed = true;
          if (!previous.has(i) && frame >= warmup / step) entries++;
          previous.add(i);
        } else previous.delete(i);
      });
      if (exposed && frame >= warmup / step) exposedSteps++;
    }
  }
  rows.push({mode: type, wave: type === 'challenge' ? 13 : 1, stage: {3:'large',2:'medium',1:'small'}[stage], pilot, liveMines: count,
    meanOverlapEntries: +(entries / seeds).toFixed(3), exposedTimePercent: +(100 * exposedSteps / (seeds * (seconds - warmup) / step)).toFixed(3)});
}
console.log(JSON.stringify({method: 'Actual 120Hz engine; 900x620 arena; seeds 1–12; 30s per trial; first 3s excluded; stage snapshots formed via real splitting; identical fixed inputs; shield prevents deaths; no firing or dodging. Overlap entries are separate enemy contacts, not lost lives. This does not establish human win rates or subjective difficulty.', seeds, seconds, rows}, null, 2));

'use strict';
// npm run build — writes a clean static site to dist/ for SitePush / Cloudflare Pages.
// Only the allowlisted runtime files are copied; dev-only code in game.js is stripped and verified gone.
const fs = require('node:fs');
const path = require('node:path');
const {ROOT, loadRules, readConfig} = require('./local-server/config-file.cjs');

const OUT = path.join(ROOT, 'dist');
const RUNTIME_FILES = ['index.html', 'style.css', 'controls.js', 'interface.js', 'challenge-config.js', 'challenge.js', 'game.js'];
const FORBIDDEN = ['@dev-only', 'MinefieldDevHooks', 'devHooks', 'dev-tools', '/api/', 'test-harness'];

function stripDevCode(source) {
  const lines = source.split('\n'), kept = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.includes('@dev-only-start')) { if (inBlock) throw new Error('Nested @dev-only-start'); inBlock = true; continue; }
    if (line.includes('@dev-only-end')) { if (!inBlock) throw new Error('Unmatched @dev-only-end'); inBlock = false; continue; }
    if (!inBlock && !line.includes('// @dev-only')) kept.push(line);
  }
  if (inBlock) throw new Error('Unclosed @dev-only-start block');
  return kept.join('\n');
}

function build({out = OUT, quiet = false} = {}) {
  const log = quiet ? () => {} : console.log;
  const rules = loadRules(), config = readConfig(), result = rules.validate(config);
  if (!result.ok) throw new Error(`challenge-config.js is invalid; nothing was built:\n- ${result.errors.join('\n- ')}`);
  // Safety: only ever delete the project's own dist folder.
  if (path.resolve(out) === path.join(ROOT, 'dist')) fs.rmSync(out, {recursive: true, force: true});
  else if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`Refusing to build into non-empty ${out}`);
  fs.mkdirSync(out, {recursive: true});
  for (const file of RUNTIME_FILES) {
    let text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (file === 'game.js') text = stripDevCode(text);
    for (const word of FORBIDDEN) if (text.includes(word)) throw new Error(`${file} still contains dev-only text "${word}"`);
    fs.writeFileSync(path.join(out, file), text);
  }
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  for (const file of RUNTIME_FILES.filter(f => f.endsWith('.js'))) if (!html.includes(`src="${file}"`)) throw new Error(`index.html does not load ${file}`);
  const files = fs.readdirSync(out).sort();
  if (JSON.stringify(files) !== JSON.stringify([...RUNTIME_FILES].sort())) throw new Error(`Unexpected files in output: ${files.join(', ')}`);
  const bytes = files.reduce((sum, f) => sum + fs.statSync(path.join(out, f)).size, 0);
  log(`\n  ✓ Production build ready: ${path.relative(ROOT, out) || '.'}/  (${files.length} files, ${(bytes / 1024).toFixed(1)} KB)`);
  log(`    Challenge config "${config.version}" validated · dev tooling excluded`);
  for (const f of files) log(`      ${f}`);
  log(`\n  In SitePush, select this folder:\n    ${out}\n`);
  return {out, files};
}

if (require.main === module) {
  try { build(); } catch (error) { console.error(`\n  ✗ Build failed: ${error.message}\n`); process.exit(1); }
}
module.exports = {build, stripDevCode, RUNTIME_FILES, FORBIDDEN};

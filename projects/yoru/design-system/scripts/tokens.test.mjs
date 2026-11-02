import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const tokens = JSON.parse(readFileSync(new URL('tokens.json', root), 'utf8'));
function value(path) {
  const raw = path.split('.').reduce((node, key) => node[key], tokens).$value;
  return raw.startsWith('{') ? value(raw.slice(1, -1)) : raw;
}
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(channel => {
    const n = parseInt(channel, 16) / 255;
    return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
  });
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
test('semantic text and filled feedback pairings meet normal-text contrast in both themes', () => {
  const pairs = [
    ['foreground', 'background'], ['mutedForeground', 'background'],
    ['cardForeground', 'card'], ['popoverForeground', 'popover'],
    ['primaryForeground', 'primary'], ['secondaryForeground', 'secondary'],
    ['destructiveForeground', 'destructive'], ['successForeground', 'success'],
    ['warningForeground', 'warning'], ['success', 'background'], ['warning', 'background'],
  ];
  for (const mode of ['light', 'dark']) for (const [fg, bg] of pairs) {
    const a = luminance(value(`color.${mode}.${fg}`));
    const b = luminance(value(`color.${mode}.${bg}`));
    const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    assert.ok(ratio >= 4.5, `${mode} ${fg}/${bg}: ${ratio.toFixed(2)}:1`);
  }
});
test('the CLI regenerates the checked-in theme and portable tokens on this platform', () => {
  const paths = ['src/index.css', 'src/generated/tokens.tsx'];
  const before = paths.map(path => readFileSync(new URL(path, root), 'utf8'));
  const result = execFileSync(process.execPath, [fileURLToPath(new URL('scripts/build-tokens.mjs', root))], { encoding: 'utf8' });
  assert.match(result, /Generated src\/index.css/);
  paths.forEach((path, i) => assert.equal(readFileSync(new URL(path, root), 'utf8'), before[i], path));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = [
  'ui/index.html',
  'ui/app.mjs',
  'ui/bridge.mjs',
  'ui/style.css',
  'settings/index.html',
  'settings/settings.mjs'
];
const contents = new Map(await Promise.all(files.map(async file => [file, await readFile(file, 'utf8')])));
const markup = contents.get('ui/index.html') + '\n' + contents.get('settings/index.html');
const scripts = contents.get('ui/app.mjs') + '\n' + contents.get('ui/bridge.mjs') + '\n' + contents.get('settings/settings.mjs');
const styles = contents.get('ui/style.css');

test('HTML and CSS reference only local static resources', () => {
  for (const match of markup.matchAll(/<(?:script|link|img)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)) {
    assert.doesNotMatch(match[1], /^(?:[a-z]+:)?\/\//i);
  }
  assert.doesNotMatch(markup, /<iframe\b/i);
  assert.doesNotMatch(styles, /@import\b|url\(\s*["']?(?:https?:)?\/\//i);
  assert.doesNotMatch(markup, /https?:\/\//i);
});

test('pages use no network primitives or remote SDK imports', () => {
  assert.doesNotMatch(scripts, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|import\s*\(|from\s+["']https?:/i);
  assert.doesNotMatch(scripts, /createPluginClient/);
  assert.match(scripts, /window\.commercePlugin|globalThis\.commercePlugin/);
});

test('localStorage only stores the selected chat id', () => {
  const settingsStorage = contents.get('settings/settings.mjs').match(/localStorage|sessionStorage/g) || [];
  assert.equal(settingsStorage.length, 0);
  const appStorage = contents.get('ui/app.mjs').match(/localStorage\.(?:getItem|setItem|removeItem)\(([^)]*)\)/g) || [];
  assert.ok(appStorage.length >= 3);
  for (const call of appStorage) assert.match(call, /SELECTED_CHAT_KEY/);
  assert.doesNotMatch(contents.get('ui/app.mjs'), /localStorage\.(?:setItem|getItem)\(["'][^"']*(?:chat|message|approval|path)/i);
});

test('approval details and secret inputs never appear in page markup', () => {
  assert.doesNotMatch(markup, /type=["']password["']|<input[^>]+(?:id|name)=["'][^"']*(?:key|secret)/i);
  assert.doesNotMatch(markup, /确认调用|拒绝调用|插件调用参数/);
  assert.match(contents.get('ui/app.mjs'), /等待桌面确认/);
  assert.doesNotMatch(contents.get('ui/app.mjs') + contents.get('settings/settings.mjs'), /pluginTitle|approval\.args/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = [
  'settings/index.html',
  'settings/settings.mjs',
  'settings/bridge.mjs',
  'settings/style.css'
];
const contents = new Map(await Promise.all(files.map(async file => [file, await readFile(file, 'utf8')])));
const markup = contents.get('settings/index.html');
const scripts = contents.get('settings/settings.mjs') + '\n' + contents.get('settings/bridge.mjs');
const styles = contents.get('settings/style.css');

test('HTML and CSS reference only local static resources', () => {
  for (const match of markup.matchAll(/<(?:script|link|img)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)) {
    assert.doesNotMatch(match[1], /^(?:[a-z]+:)?\/\//i);
  }
  assert.doesNotMatch(markup, /<iframe\b/i);
  assert.doesNotMatch(styles, /@import\b|url\(\s*["']?(?:https?:)?\/\//i);
  assert.doesNotMatch(markup, /https?:\/\//i);
  assert.doesNotMatch(markup + scripts + styles, /(?:\.\.\/ui\/|ui\/index\.html|ui\/style\.css|ui\/bridge\.mjs)/);
});

test('pages use no network primitives or remote SDK imports', () => {
  assert.doesNotMatch(scripts, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|import\s*\(|from\s+["']https?:/i);
  assert.doesNotMatch(scripts, /createPluginClient/);
  assert.match(scripts, /window\.commercePlugin|globalThis\.commercePlugin/);
});

test('settings page uses no browser storage', () => {
  assert.doesNotMatch(scripts, /localStorage|sessionStorage/);
});

test('page contains no secret inputs or chat, event and approval surfaces', () => {
  assert.doesNotMatch(markup, /type=["']password["']|<input[^>]+(?:id|name)=["'][^"']*(?:key|secret)/i);
  assert.doesNotMatch(markup + scripts, /firstParty\.assistant\.chat|onAI|assistant-delta|等待桌面确认|approval|确认调用|拒绝调用|插件调用参数/i);
  assert.doesNotMatch(markup, /AI 对话|消息|发送/);
});

test('stylesheet keeps no chat, history, tool or message styles', () => {
  assert.doesNotMatch(styles, /\.(?:chat-|history-|tool-|message-|composer|modal|approval-|activity|transcript|empty-state|notice|suggestions|connection-dot|running-dot)/);
});

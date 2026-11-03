import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { validateManifest, EXPECTED_API } from '../scripts/manifest.mjs';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const [chatMarkup, settingsMarkup, chatApp, settingsApp, bridge] = await Promise.all([
  readFile('ui/index.html', 'utf8'),
  readFile('settings/index.html', 'utf8'),
  readFile('ui/app.mjs', 'utf8'),
  readFile('settings/settings.mjs', 'utf8'),
  readFile('ui/bridge.mjs', 'utf8')
]);

test('manifest is a UI-only API 1.10 plugin with the required pages', () => {
  const manifest = validateManifest(pkg);
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.id, 'official.ai-assistant');
  assert.equal(manifest.title, 'AI 助手');
  assert.equal(manifest.api, '^1.10.0');
  assert.equal(EXPECTED_API, '^1.10.0');
  assert.equal(manifest.ui, 'ui/index.html');
  assert.deepEqual(manifest.settings, { title: 'AI 设置', entry: 'settings/index.html' });
  assert.deepEqual(manifest.permissions, {});
  assert.equal(manifest.backend, undefined);
  assert.equal(manifest.permissions.network, undefined);
});

test('all runtime files are local and present', async () => {
  for (const file of [
    'ui/index.html',
    'ui/app.mjs',
    'ui/bridge.mjs',
    'ui/style.css',
    'settings/index.html',
    'settings/settings.mjs',
    'LICENSE',
    'README.md'
  ]) {
    await access(file);
  }
  assert.match(chatMarkup, /<title>AI 助手<\/title>/);
  assert.match(settingsMarkup, /<title>AI 设置 - AI 助手<\/title>/);
  assert.match(chatMarkup, /href="\.\.\/settings\/index\.html"/);
  assert.match(settingsMarkup, /href="\.\.\/ui\/index\.html"/);
});

test('pages contain no secret input fields or direct key submission', () => {
  const pages = chatMarkup + settingsMarkup + chatApp + settingsApp + bridge;
  assert.doesNotMatch(pages, /type=["']password["']/i);
  assert.doesNotMatch(pages, /\b(?:apiKey|secretKey|accessKey)\b/);
  assert.doesNotMatch(settingsMarkup, /<input[^>]+(?:id|name)=["'][^"']*(?:key|secret)/i);
  assert.match(bridge, /beginTextSetup: address => invoke\(BRIDGE_METHODS\.settings\.beginTextSetup, \{ address \}/);
  assert.match(bridge, /beginImageKeySetup: provider => invoke\(BRIDGE_METHODS\.settings\.beginImageKeySetup, \{ provider \}/);
});

test('approval UI is not rendered in the plugin', () => {
  assert.match(chatApp, /等待桌面确认/);
  assert.doesNotMatch(chatApp, /approval\.args|approvals\.map|pluginTitle/);
  assert.doesNotMatch(chatMarkup, /确认调用|拒绝调用|插件调用参数/);
});

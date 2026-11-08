import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { validateManifest, EXPECTED_API } from '../scripts/manifest.mjs';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const [settingsMarkup, settingsApp, bridge] = await Promise.all([
  readFile('settings/index.html', 'utf8'),
  readFile('settings/settings.mjs', 'utf8'),
  readFile('settings/bridge.mjs', 'utf8')
]);

test('manifest is a settings-only API 1.10 plugin that points ui at the settings entry', () => {
  const manifest = validateManifest(pkg);
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.id, 'official.ai-assistant');
  assert.equal(manifest.title, 'AI 助手');
  assert.equal(manifest.api, '^1.10.0');
  assert.equal(EXPECTED_API, '^1.10.0');
  assert.equal(manifest.ui, 'settings/index.html');
  assert.deepEqual(manifest.settings, { title: 'AI 设置', entry: 'settings/index.html' });
  assert.equal(manifest.ui, manifest.settings.entry);
  assert.deepEqual(manifest.permissions, {});
  assert.equal(manifest.backend, undefined);
  assert.equal(manifest.assistant, undefined);
  assert.equal(manifest.permissions.network, undefined);
  assert.equal(manifest.permissions.ai, undefined);
  assert.equal(manifest.version, '0.2.0');
});

test('all runtime files are local and present', async () => {
  for (const file of [
    'settings/index.html',
    'settings/settings.mjs',
    'settings/bridge.mjs',
    'settings/style.css',
    'LICENSE',
    'README.md'
  ]) {
    await access(file);
  }
  assert.match(settingsMarkup, /<title>AI 设置 - AI 助手<\/title>/);
  assert.match(settingsMarkup, /<h1>AI 设置<\/h1>/);
  assert.match(settingsMarkup, /href="\.\/style\.css"/);
  assert.match(settingsMarkup, /src="\.\/settings\.mjs"/);
});

test('manifest validator rejects a separate chat UI or assistant permissions', () => {
  const separateUi = structuredClone(pkg);
  separateUi.commerce.ui = 'ui/index.html';
  assert.throws(() => validateManifest(separateUi), /AI 设置页/);

  const assistantPermission = structuredClone(pkg);
  assistantPermission.commerce.permissions.ai = ['assistant'];
  assert.throws(() => validateManifest(assistantPermission), /AI 权限/);
});

test('pages contain no secret input fields or direct key submission', () => {
  const pages = settingsMarkup + settingsApp + bridge;
  assert.doesNotMatch(pages, /type=["']password["']/i);
  assert.doesNotMatch(pages, /\b(?:apiKey|secretKey|accessKey)\b/);
  assert.doesNotMatch(settingsMarkup, /<input[^>]+(?:id|name)=["'][^"']*(?:key|secret)/i);
  assert.match(bridge, /beginTextSetup: address => invoke\(BRIDGE_METHODS\.settings\.beginTextSetup, \{ address \}/);
  assert.match(bridge, /beginImageKeySetup: provider => invoke\(BRIDGE_METHODS\.settings\.beginImageKeySetup, \{ provider \}/);
});

test('chat and approval surfaces are absent from the plugin', () => {
  const pages = settingsMarkup + settingsApp + bridge;
  assert.doesNotMatch(pages, /firstParty\.assistant\.chat|onAI|assistant-delta|approvals?|等待桌面确认/);
  assert.doesNotMatch(settingsMarkup, /AI 对话|返回对话|历史对话|新建对话|消息|发送/);
  assert.doesNotMatch(settingsApp, /\.chat\.|chatId|observeSession|sanitizeAssistantEvent/);
});

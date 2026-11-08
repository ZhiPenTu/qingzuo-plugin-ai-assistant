import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BRIDGE_METHODS,
  actionableError,
  createAssistantBridge
} from '../settings/bridge.mjs';

function fixtureHost() {
  const calls = [];
  return {
    calls,
    invoke: async (method, args = {}) => {
      calls.push({ method, args });
      if (method === BRIDGE_METHODS.settings.models) return [];
      if (method === BRIDGE_METHODS.settings.imageModels) return { models: [], error: null };
      if (method === BRIDGE_METHODS.settings.testModel) return { ok: true, latencyMs: 12, response: 'OK' };
      if (method === BRIDGE_METHODS.settings.imageStatus) return {};
      return {};
    }
  };
}

test('settings bridge uses only the fixed first-party settings methods without key fields', async () => {
  const host = fixtureHost();
  const bridge = createAssistantBridge(host);
  await bridge.settings.status();
  await bridge.settings.models();
  await bridge.settings.testModel('text-model');
  await bridge.settings.beginTextSetup('https://api.example.com/v1');
  await bridge.settings.beginImageKeySetup('google');
  await bridge.settings.clearImageKey('google');
  await bridge.settings.imageStatus();
  await bridge.settings.imageModels();

  assert.deepEqual(host.calls.map(call => call.method), [
    'firstParty.assistant.settings.status',
    'firstParty.assistant.settings.models',
    'firstParty.assistant.settings.testModel',
    'firstParty.assistant.settings.beginTextSetup',
    'firstParty.assistant.settings.beginImageKeySetup',
    'firstParty.assistant.settings.clearImageKey',
    'firstParty.assistant.settings.imageStatus',
    'firstParty.assistant.settings.imageModels'
  ]);

  const serialized = JSON.stringify(host.calls);
  assert.doesNotMatch(serialized, /apiKey|secretKey|accessKey|credential|HIDDEN/);
  assert.deepEqual(host.calls.find(call => call.method.endsWith('beginTextSetup')).args, { address: 'https://api.example.com/v1' });
  assert.deepEqual(host.calls.find(call => call.method.endsWith('beginImageKeySetup')).args, { provider: 'google' });
  assert.deepEqual(host.calls.find(call => call.method.endsWith('clearImageKey')).args, { provider: 'google' });
  assert.deepEqual(host.calls.find(call => call.method.endsWith('testModel')).args, { model: 'text-model' });
});

test('bridge exposes no chat, event or approval surface', async () => {
  const bridge = createAssistantBridge(fixtureHost());
  assert.deepEqual(Object.keys(bridge), ['settings']);
  assert.equal(bridge.chat, undefined);
  assert.equal(bridge.subscribeAI, undefined);
  const source = await readFile('settings/bridge.mjs', 'utf8');
  assert.doesNotMatch(source, /firstParty\.assistant\.chat|onAI|assistant-delta|approval/i);
});

test('missing host bridge produces an actionable settings message', () => {
  assert.throws(() => createAssistantBridge(null), /请在轻作桌面中打开 AI 设置/);
});

test('raw host errors are converted to actionable settings copy', () => {
  assert.equal(actionableError(new Error('401 invalid key /Users/alice/secret')), '访问密钥无效，请到 AI 设置重新输入。');
  assert.equal(actionableError(new Error('429 too many requests')), '请求过于频繁或额度不足，请稍后再试。');
  assert.equal(actionableError(new Error('第一方能力未授权。')), '请从插件市场安装 AI 助手后再打开 AI 设置。');
  assert.equal(actionableError(new Error('请配置代理访问密钥。')), '请填写有效的访问密钥后重试。');
  assert.equal(actionableError(new Error('无法保存访问密钥，请检查应用数据目录权限后重试。')), '无法保存访问密钥，请检查应用数据目录权限后重试。');
  assert.equal(actionableError(new Error('服务没有返回任何可用模型，请检查账户权限或服务地址。')), '服务没有返回可用模型，请检查服务地址或账户权限。');
  assert.equal(actionableError(new Error('模型未通过文本补全测试，可能不支持当前补全接口。')), '模型未通过文本补全测试，可能不支持当前补全接口。');
  assert.equal(actionableError(new Error('EACCES /tmp/private')), '设置操作未完成，请稍后重试。');
  assert.doesNotMatch(actionableError(new Error('EACCES /tmp/private')), /tmp|private/i);
});

test('bridge errors are already user-facing and the page does not map them twice', async () => {
  const bridge = createAssistantBridge({ invoke: async () => { throw new Error('第一方能力未授权。'); } });
  const reason = await bridge.settings.status().catch(error => error);
  assert.equal(reason.actionable, true);
  assert.equal(reason.message, '请从插件市场安装 AI 助手后再打开 AI 设置。');
});

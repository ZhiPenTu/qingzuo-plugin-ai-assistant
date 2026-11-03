import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIDGE_METHODS,
  actionableError,
  createAssistantBridge,
  observeSession,
  sanitizeAssistantEvent
} from '../ui/bridge.mjs';

const session = {
  id: 'chat-1',
  title: '测试对话',
  model: 'text-model',
  state: 'running',
  partial: '部分',
  approvals: [{ id: 'approval-1', pluginTitle: '插件', title: '调用', args: { secret: 'HIDDEN' } }],
  history: [
    { role: 'user', text: '你好' },
    { role: 'tool', text: '完成', tool: 'call_plugin', pluginId: 'local.demo', args: { path: '/tmp/HIDDEN', apiKey: 'HIDDEN' } }
  ]
};

function fixtureHost() {
  const calls = [];
  const listeners = new Set();
  const host = {
    calls,
    invoke: async (method, args = {}) => {
      calls.push({ method, args });
      if (method === BRIDGE_METHODS.chat.status) return structuredClone(session);
      if (method === BRIDGE_METHODS.chat.create || method === BRIDGE_METHODS.chat.send || method === BRIDGE_METHODS.chat.cancel) return structuredClone(session);
      if (method === BRIDGE_METHODS.chat.list || method === BRIDGE_METHODS.chat.tools) return [];
      if (method === BRIDGE_METHODS.settings.models) return [];
      if (method === BRIDGE_METHODS.settings.imageModels) return { models: [], error: null };
      if (method === BRIDGE_METHODS.settings.testModel) return { ok: true, latencyMs: 12, response: 'OK' };
      return {};
    },
    onAI(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    emit(value) {
      for (const listener of listeners) listener(value);
    }
  };
  return host;
}

test('all host bridge methods use the fixed first-party names and no key fields', async () => {
  const host = fixtureHost();
  const bridge = createAssistantBridge(host);
  await bridge.chat.list();
  await bridge.chat.status('chat-1');
  await bridge.chat.tools();
  await bridge.chat.create('text-model');
  await bridge.chat.send('chat-1', '你好', 'text-model');
  await bridge.chat.cancel('chat-1');
  await bridge.chat.delete('chat-1');
  await bridge.settings.status();
  await bridge.settings.models();
  await bridge.settings.testModel('text-model');
  await bridge.settings.beginTextSetup('https://api.example.com/v1');
  await bridge.settings.beginImageKeySetup('google');
  await bridge.settings.clearImageKey('google');
  await bridge.settings.imageStatus();
  await bridge.settings.imageModels();

  assert.deepEqual(host.calls.map(call => call.method), [
    'firstParty.assistant.chat.list',
    'firstParty.assistant.chat.status',
    'firstParty.assistant.chat.tools',
    'firstParty.assistant.chat.create',
    'firstParty.assistant.chat.send',
    'firstParty.assistant.chat.cancel',
    'firstParty.assistant.chat.delete',
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
  assert.deepEqual(host.calls.find(call => call.method.endsWith('testModel')).args, { model: 'text-model' });
});

test('missing host bridge produces an actionable message', () => {
  assert.throws(() => createAssistantBridge(null), /请在轻作桌面中打开 AI 助手/);
});

test('assistant session strips approvals, args, paths and unknown fields', () => {
  const observed = observeSession({
    ...session,
    extra: 'discard',
    history: [...session.history, { role: 'assistant', text: '好', approvals: [{ id: 'x' }], args: { path: '/tmp/secret' } }]
  });
  assert.ok(observed);
  assert.equal(observed.waitingForApproval, true);
  assert.equal('approvals' in observed.session, false);
  assert.equal('extra' in observed.session, false);
  assert.equal(observed.session.history.length, 3);
  for (const message of observed.session.history) {
    assert.equal('args' in message, false);
    assert.equal('approvals' in message, false);
  }
  assert.doesNotMatch(JSON.stringify(observed.session), /approval-1|HIDDEN|\/tmp\/secret/);
});

test('onAI only forwards sanitized delta and session events', () => {
  const host = fixtureHost();
  const bridge = createAssistantBridge(host);
  const events = [];
  bridge.subscribeAI(event => events.push(event));
  host.emit({ type: 'approvals', chatId: 'chat-1', approvals: [{ args: { path: '/tmp/HIDDEN' } }] });
  host.emit({ type: 'navigate', chatId: 'chat-1', pluginId: 'local.demo' });
  host.emit({ type: 'assistant-delta', chatId: 'chat-1', text: '新内容', partial: '完整内容', approvals: [{ args: { secret: 'HIDDEN' } }] });
  host.emit({ type: 'assistant', chatId: 'chat-1', session, approvals: [{ args: { secret: 'HIDDEN' } }] });
  host.emit({ type: 'assistant', chatId: '', session });

  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { type: 'assistant-delta', chatId: 'chat-1', text: '新内容', partial: '完整内容' });
  assert.equal(events[1].type, 'assistant');
  assert.equal('approvals' in events[1].session, false);
  assert.doesNotMatch(JSON.stringify(events), /HIDDEN|\/tmp\/secret|approval-1/);
});

test('sanitizeAssistantEvent ignores approval and navigate event types', () => {
  assert.equal(sanitizeAssistantEvent({ type: 'approvals', chatId: 'chat-1', approvals: [] }), null);
  assert.equal(sanitizeAssistantEvent({ type: 'navigate', chatId: 'chat-1', pluginId: 'local.demo' }), null);
});

test('raw host errors are converted to actionable public copy', () => {
  assert.equal(actionableError(new Error('401 invalid key /Users/alice/secret'), 'settings'), '访问密钥无效，请到 AI 设置重新输入。');
  assert.equal(actionableError(new Error('429 too many requests'), 'chat'), '请求过于频繁或额度不足，请稍后再试。');
  assert.equal(actionableError(new Error('EACCES /tmp/private'), 'chat'), '对话操作未完成，请稍后重试。');
  assert.doesNotMatch(actionableError(new Error('EACCES /tmp/private'), 'chat'), /tmp|private/i);
});

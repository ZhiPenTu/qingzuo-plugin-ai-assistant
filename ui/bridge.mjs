export const BRIDGE_METHODS = Object.freeze({
  chat: Object.freeze({
    list: 'firstParty.assistant.chat.list',
    status: 'firstParty.assistant.chat.status',
    tools: 'firstParty.assistant.chat.tools',
    create: 'firstParty.assistant.chat.create',
    send: 'firstParty.assistant.chat.send',
    cancel: 'firstParty.assistant.chat.cancel',
    delete: 'firstParty.assistant.chat.delete'
  }),
  settings: Object.freeze({
    status: 'firstParty.assistant.settings.status',
    models: 'firstParty.assistant.settings.models',
    testModel: 'firstParty.assistant.settings.testModel',
    beginTextSetup: 'firstParty.assistant.settings.beginTextSetup',
    beginImageKeySetup: 'firstParty.assistant.settings.beginImageKeySetup',
    clearImageKey: 'firstParty.assistant.settings.clearImageKey',
    imageStatus: 'firstParty.assistant.settings.imageStatus',
    imageModels: 'firstParty.assistant.settings.imageModels'
  })
});

const EVENT_TYPES = new Set(['assistant-delta', 'assistant']);

function safeText(value) {
  return typeof value === 'string' ? value : '';
}

function safeOptionalText(value) {
  return typeof value === 'string' ? value : undefined;
}

function normalizeMessage(value) {
  if (!value || typeof value !== 'object') return null;
  const role = ['user', 'assistant', 'tool'].includes(value.role) ? value.role : 'assistant';
  const message = {
    role,
    text: safeText(value.text)
  };
  if (typeof value.id === 'string' && value.id) message.id = value.id;
  if (typeof value.tool === 'string' && value.tool) message.tool = value.tool;
  if (typeof value.pluginId === 'string' && value.pluginId) message.pluginId = value.pluginId;
  if (typeof value.state === 'string' && value.state) message.state = value.state;
  return message;
}

export function actionableError(reason, context = '操作') {
  const raw = String(reason instanceof Error ? reason.message : reason ?? '').toLowerCase();
  if (/请在轻作|桌面中打开|commerceplugin/.test(raw)) return '请在轻作桌面中打开 AI 助手。';
  if (/401|invalid.*key|密钥无效|访问密钥无效|unauthorized/.test(raw)) return '访问密钥无效，请到 AI 设置重新输入。';
  if (/403|forbidden|没有.*权限|权限不足/.test(raw)) return '当前账户没有这项权限，请检查服务账户后重试。';
  if (/404|服务地址|endpoint/.test(raw)) return '服务地址不可用，请到 AI 设置检查连接地址。';
  if (/429|rate.?limit|额度|too many requests/.test(raw)) return '请求过于频繁或额度不足，请稍后再试。';
  if (/超时|timeout|timed out/.test(raw)) return '连接超时，请检查网络后重试。';
  if (/未配置|not configured|no model|没有.*模型|尚未启用/.test(raw)) return 'AI 服务尚未就绪，请到 AI 设置完成连接。';
  if (/不存在|未找到|not found|missing chat/.test(raw)) return '这条对话已不存在，请新建一条对话。';
  if (/取消|cancel/.test(raw)) return '操作已取消。';
  if (/未授权|not allow|permission|denied|unsupported|不支持/.test(raw)) return '当前桌面版本暂不支持这项操作，请更新轻作后重试。';
  if (/网络|network|连接失败|econn|enotfound|eai_again|failed to fetch/.test(raw)) return '无法连接 AI 服务，请检查网络后重试。';
  return context === 'settings' ? '设置操作未完成，请稍后重试。' : context === 'chat' ? '对话操作未完成，请稍后重试。' : '操作未完成，请稍后重试。';
}

export function observeSession(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id) return null;
  const history = Array.isArray(value.history) ? value.history.map(normalizeMessage).filter(Boolean).slice(0, 2000) : [];
  const waitingForApproval = (Array.isArray(value.approvals) && value.approvals.length > 0) || value.waitingForApproval === true;
  const session = {
    id: value.id,
    title: safeText(value.title),
    model: safeText(value.model),
    state: value.state === 'running' ? 'running' : 'idle',
    partial: safeText(value.partial),
    history
  };
  return {
    session,
    waitingForApproval,
    error: typeof value.error === 'string' && value.error ? actionableError(value.error, 'chat') : ''
  };
}

export function sanitizeSession(value) {
  return observeSession(value)?.session ?? null;
}

export function sanitizeAssistantEvent(value) {
  if (!value || typeof value !== 'object' || !EVENT_TYPES.has(value.type)) return null;
  if (typeof value.chatId !== 'string' || !value.chatId) return null;
  if (value.type === 'assistant-delta') {
    const event = { type: 'assistant-delta', chatId: value.chatId, text: safeText(value.text) };
    const partial = safeOptionalText(value.partial);
    if (partial !== undefined) event.partial = partial;
    return event;
  }
  const observed = observeSession(value.session);
  if (!observed) return null;
  return {
    type: 'assistant',
    chatId: value.chatId,
    session: observed.session,
    waitingForApproval: observed.waitingForApproval,
    error: observed.error
  };
}

export function createAssistantBridge(host = globalThis.commercePlugin) {
  if (!host || typeof host.invoke !== 'function') {
    throw new Error('请在轻作桌面中打开 AI 助手。');
  }
  async function invoke(method, args, context) {
    try {
      return await host.invoke(method, args ?? {});
    } catch (reason) {
      throw new Error(actionableError(reason, context));
    }
  }
  return Object.freeze({
    chat: Object.freeze({
      list: () => invoke(BRIDGE_METHODS.chat.list, {}, 'chat'),
      status: id => invoke(BRIDGE_METHODS.chat.status, { id }, 'chat'),
      tools: () => invoke(BRIDGE_METHODS.chat.tools, {}, 'chat'),
      create: model => invoke(BRIDGE_METHODS.chat.create, { model }, 'chat'),
      send: (id, text, model) => invoke(BRIDGE_METHODS.chat.send, { id, text, model }, 'chat'),
      cancel: id => invoke(BRIDGE_METHODS.chat.cancel, { id }, 'chat'),
      delete: id => invoke(BRIDGE_METHODS.chat.delete, { id }, 'chat')
    }),
    settings: Object.freeze({
      status: () => invoke(BRIDGE_METHODS.settings.status, {}, 'settings'),
      models: () => invoke(BRIDGE_METHODS.settings.models, {}, 'settings'),
      testModel: model => invoke(BRIDGE_METHODS.settings.testModel, { model }, 'settings'),
      beginTextSetup: address => invoke(BRIDGE_METHODS.settings.beginTextSetup, { address }, 'settings'),
      beginImageKeySetup: provider => invoke(BRIDGE_METHODS.settings.beginImageKeySetup, { provider }, 'settings'),
      clearImageKey: provider => invoke(BRIDGE_METHODS.settings.clearImageKey, { provider }, 'settings'),
      imageStatus: () => invoke(BRIDGE_METHODS.settings.imageStatus, {}, 'settings'),
      imageModels: () => invoke(BRIDGE_METHODS.settings.imageModels, {}, 'settings')
    }),
    subscribeAI(callback) {
      if (typeof host.onAI !== 'function') return () => {};
      return host.onAI(value => {
        const event = sanitizeAssistantEvent(value);
        if (event) callback(event);
      });
    }
  });
}

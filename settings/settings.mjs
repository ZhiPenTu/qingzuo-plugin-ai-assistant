import {
  actionableError,
  createAssistantBridge
} from '../ui/bridge.mjs';

const $ = id => document.getElementById(id);
const PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', description: '适合日常对话与工具调用', address: 'https://api.deepseek.com', badge: 'D' },
  { id: 'openai', name: 'OpenAI', description: '能力全面，适合复杂任务', address: 'https://api.openai.com', badge: 'O' },
  { id: 'siliconflow', name: '硅基流动', description: '一个密钥使用多种开源模型', address: 'https://api.siliconflow.cn/v1', badge: 'S' },
  { id: 'custom', name: '自定义服务', description: '连接其他 OpenAI 兼容服务', address: '', badge: '+' }
];
const IMAGE_PROVIDERS = [
  { id: 'google', name: 'Google 官方' },
  { id: 'openai', name: 'OpenAI 官方' }
];

const state = {
  bridge: null,
  status: null,
  models: [],
  imageStatus: null,
  imageModels: [],
  providerId: 'deepseek',
  address: PROVIDERS[0].address,
  editing: true,
  loading: true,
  modelsLoading: false,
  imageModelsLoading: false,
  busyAction: '',
  testingModel: '',
  modelTests: {},
  fatalError: '',
  feedback: null
};

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#icon-' + name);
  svg.append(use);
  return svg;
}

function statusReady(status) {
  if (!status) return false;
  if (typeof status.ready === 'boolean') return status.ready;
  return Boolean(status.model && Array.isArray(status.verified) && status.verified.includes(status.model));
}

function normalizeAddress(value) {
  const trimmed = String(value || '').trim();
  try {
    const url = new URL(trimmed);
    url.search = '';
    url.hash = '';
    return url.href.replace(/\/+$/, '').replace(/\/v1$/i, '');
  } catch {
    return trimmed.replace(/\/+$/, '').replace(/\/v1$/i, '');
  }
}

function providerForAddress(address) {
  const target = normalizeAddress(address);
  return PROVIDERS.find(provider => provider.address && normalizeAddress(provider.address) === target) || null;
}

function providerName() {
  return PROVIDERS.find(provider => provider.id === state.providerId)?.name || '自定义服务';
}

function isChatModel(model) {
  const signature = `${model?.id ?? ''} ${model?.title ?? ''} ${model?.type ?? ''}`.toLowerCase();
  return !/(?:^|[/_. -])(?:embedding|embed|rerank|reranker|bge|whisper|transcri(?:be|ption)|speech|audio|tts|video|sora|veo|kling|imagen|dall-e|stable-diffusion|flux)(?:$|[/_. -])|gpt[-_ ]?image|nano[-_ ]?banana|image[-_ ]?generat/i.test(signature);
}

function normalizeStatus(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    mode: typeof value.mode === 'string' ? value.mode : '',
    address: typeof value.address === 'string' ? value.address : '',
    running: value.running === true,
    model: typeof value.model === 'string' ? value.model : '',
    verified: Array.isArray(value.verified) ? value.verified.filter(item => typeof item === 'string') : [],
    ready: typeof value.ready === 'boolean' ? value.ready : undefined,
    error: typeof value.error === 'string' && value.error ? actionableError(value.error, 'settings') : ''
  };
}

function normalizeModels(value) {
  const source = Array.isArray(value) ? value : Array.isArray(value?.models) ? value.models : [];
  return source
    .filter(model => model && typeof model.id === 'string' && model.id)
    .map(model => ({
      id: model.id,
      title: typeof model.title === 'string' ? model.title : '',
      type: typeof model.type === 'string' ? model.type : ''
    }));
}

function normalizeImageStatus(value) {
  if (!value || typeof value !== 'object' || (!value.google && !value.openai && !value.proxy)) return null;
  const providerState = provider => {
    const item = value[provider];
    if (!item || typeof item !== 'object') return { configured: false, source: 'none' };
    return {
      configured: item.configured === true,
      source: ['dedicated', 'inherited', 'legacy', 'none'].includes(item.source) ? item.source : item.configured ? 'dedicated' : 'none'
    };
  };
  return {
    google: providerState('google'),
    openai: providerState('openai'),
    proxy: { configured: value.proxy?.configured === true }
  };
}

function normalizeImageModels(value) {
  const source = Array.isArray(value) ? value : Array.isArray(value?.models) ? value.models : [];
  return source
    .filter(model => model && typeof model.id === 'string' && model.id)
    .map(model => ({
      id: model.id,
      title: typeof model.title === 'string' ? model.title : '',
      provider: ['google', 'openai', 'compatible'].includes(model.provider) ? model.provider : 'compatible',
      source: model.source === 'official' ? 'official' : 'proxy'
    }));
}

function unwrap(value, key) {
  if (value?.ok === false) throw new Error(value.message || '设置未完成，请稍后重试。');
  if (value && typeof value === 'object' && value[key] && typeof value[key] === 'object') return value[key];
  if (value && typeof value === 'object' && value.status && typeof value.status === 'object') return value.status;
  return value;
}

function imageStateLabel(value) {
  if (!value) return '读取中';
  if (value.source === 'inherited') return '沿用上方连接';
  return value.configured ? '已配置' : '未配置';
}

function feedback(message, tone = 'info') {
  state.feedback = message ? { message, tone } : null;
  renderFeedback();
}

function renderFeedback() {
  const list = $('settings-feedback');
  const items = [];
  if (state.feedback) {
    const box = element('div', 'settings-feedback ' + state.feedback.tone);
    box.append(icon(state.feedback.tone === 'error' ? 'alert' : 'check'), element('p', '', state.feedback.message));
    items.push(box);
  }
  if (state.status?.error) {
    const box = element('div', 'settings-feedback error');
    box.append(icon('alert'), element('p', '', state.status.error));
    items.push(box);
  }
  list.replaceChildren(...items);
}

function renderProviders() {
  const grid = $('provider-grid');
  grid.replaceChildren();
  for (const provider of PROVIDERS) {
    const button = element('button', 'provider-card');
    button.type = 'button';
    button.setAttribute('aria-pressed', state.providerId === provider.id ? 'true' : 'false');
    button.disabled = Boolean(state.busyAction);
    const badge = element('span', 'provider-badge provider-' + provider.id, provider.badge);
    const copy = element('span', 'provider-copy');
    copy.append(element('strong', '', provider.name), element('small', '', provider.description));
    button.append(badge, copy);
    if (state.providerId === provider.id) button.append(icon('check'));
    button.addEventListener('click', () => {
      state.providerId = provider.id;
      if (provider.address) state.address = provider.address;
      else if (!state.address) state.address = '';
      feedback('');
      render();
      $('address-input').focus();
    });
    grid.append(button);
  }
}

function renderReady() {
  const ready = statusReady(state.status);
  $('ready-card').hidden = !ready || state.editing;
  $('ready-title').textContent = `AI 助手已连接 ${providerName()}`;
  const count = state.models.filter(isChatModel).length;
  $('ready-description').textContent = state.modelsLoading
    ? '正在读取可用模型。'
    : count
      ? `已读取 ${state.models.length} 个模型，其中 ${count} 个可用于文本对话。`
      : '服务没有返回可用的文本模型，请检查服务账户权限。';
}

function renderSetup() {
  const ready = statusReady(state.status);
  $('setup-card').hidden = ready && !state.editing;
  $('address-input').value = state.address;
  $('address-input').disabled = Boolean(state.busyAction);
  $('begin-text-setup').disabled = Boolean(state.busyAction) || !state.address.trim();
  $('begin-text-setup').querySelector('span').textContent = state.busyAction === 'text' ? '等待桌面输入…' : '使用桌面安全输入';
}

function testLabel(test) {
  if (!test) return '';
  if (test.state === 'testing') return '正在测试…';
  if (test.state === 'success') return `连接正常 · ${test.latencyMs} ms`;
  return test.message;
}

function renderModels() {
  const ready = statusReady(state.status);
  $('models-card').hidden = !ready;
  $('models-loading').hidden = !state.modelsLoading;
  $('models-empty').hidden = state.modelsLoading || state.models.length > 0;
  $('model-count').textContent = String(state.models.length);
  $('refresh-models').disabled = state.modelsLoading || !ready;
  const list = $('model-list');
  list.replaceChildren();
  for (const model of state.models) {
    const row = element('div', 'catalog-row');
    row.setAttribute('role', 'listitem');
    const copy = element('div', 'catalog-copy');
    const heading = element('div', 'catalog-title');
    heading.append(element('strong', '', model.title && model.title !== model.id ? model.title : model.id));
    heading.append(element('span', 'model-kind ' + (isChatModel(model) ? '' : 'muted'), isChatModel(model) ? '文本' : '非文本'));
    copy.append(heading);
    if (model.title && model.title !== model.id) copy.append(element('code', '', model.id));
    const actions = element('div', 'catalog-actions');
    const test = state.modelTests[model.id];
    if (test) {
      const result = element('span', 'model-test-result ' + test.state);
      result.textContent = testLabel(test);
      if (test.response) result.title = test.response;
      actions.append(result);
    }
    if (isChatModel(model)) {
      const button = element('button', 'button button-outline', state.testingModel === model.id ? '测试中…' : '测试');
      button.type = 'button';
      button.disabled = Boolean(state.testingModel);
      button.setAttribute('aria-label', '测试模型 ' + model.id);
      button.addEventListener('click', () => void testModel(model.id));
      actions.append(button);
    }
    row.append(copy, actions);
    list.append(row);
  }
}

function imageAction(provider) {
  const value = state.imageStatus?.[provider.id];
  const row = element('div', 'image-action-row');
  const copy = element('div', 'image-action-copy');
  copy.append(element('strong', '', provider.name + '访问密钥'));
  copy.append(element('small', '', value?.source === 'inherited' ? '当前沿用上方连接。' : value?.configured ? '已保存，可重新输入替换。' : '尚未配置。'));
  const actions = element('div', 'catalog-actions');
  const setup = element('button', 'button button-outline', state.busyAction === provider.id ? '等待桌面输入…' : value?.configured ? '重新输入' : '使用桌面安全输入');
  setup.type = 'button';
  setup.disabled = Boolean(state.busyAction);
  setup.addEventListener('click', () => void beginImageSetup(provider.id));
  actions.append(setup);
  if (value?.source === 'dedicated' || value?.source === 'legacy') {
    const clear = element('button', 'button button-ghost danger-quiet', '清除');
    clear.type = 'button';
    clear.disabled = Boolean(state.busyAction);
    clear.addEventListener('click', () => void clearImageKey(provider.id));
    actions.append(clear);
  }
  row.append(copy, actions);
  return row;
}

function renderImage() {
  for (const provider of IMAGE_PROVIDERS) {
    const node = $('image-status-' + provider.id);
    const value = state.imageStatus?.[provider.id];
    node.textContent = imageStateLabel(value);
    node.className = 'status-chip' + (value?.configured ? ' configured' : '');
  }
  const proxy = $('image-status-proxy');
  proxy.textContent = !state.imageStatus ? '读取中' : state.imageStatus.proxy.configured ? '已配置' : '未配置';
  proxy.className = 'status-chip' + (state.imageStatus?.proxy.configured ? ' configured' : '');
  $('image-actions').replaceChildren(...IMAGE_PROVIDERS.map(imageAction));
  $('image-models-loading').hidden = !state.imageModelsLoading;
  $('image-models-empty').hidden = state.imageModelsLoading || state.imageModels.length > 0;
  $('image-model-count').textContent = String(state.imageModels.length);
  $('refresh-image').disabled = state.imageModelsLoading || Boolean(state.busyAction);
  const list = $('image-model-list');
  list.replaceChildren();
  for (const model of state.imageModels) {
    const row = element('div', 'catalog-row image-model-row');
    row.setAttribute('role', 'listitem');
    const copy = element('div', 'catalog-copy');
    const heading = element('div', 'catalog-title');
    const provider = model.provider === 'google' ? 'Google' : model.provider === 'openai' ? 'OpenAI' : '兼容服务';
    heading.append(element('strong', '', model.title && model.title !== model.id ? model.title : model.id), element('span', 'model-kind', provider));
    copy.append(heading);
    if (model.title && model.title !== model.id) copy.append(element('code', '', model.id));
    row.append(copy, element('span', 'catalog-source', model.source === 'official' ? '官方服务' : '兼容服务'));
    list.append(row);
  }
}

function render() {
  $('settings-loading').hidden = !state.loading;
  $('settings-error').hidden = !state.fatalError;
  $('settings-error-message').textContent = state.fatalError;
  $('settings-content').setAttribute('aria-busy', state.loading ? 'true' : 'false');
  renderFeedback();
  renderProviders();
  renderReady();
  renderSetup();
  renderModels();
  renderImage();
}

function hydrateStatus(value) {
  const status = normalizeStatus(value);
  if (!status) return false;
  state.status = status;
  const known = providerForAddress(status.address);
  state.providerId = known?.id || (status.address ? 'custom' : 'deepseek');
  state.address = known?.address || status.address || (state.providerId === 'custom' ? '' : PROVIDERS[0].address);
  state.editing = !statusReady(status);
  return statusReady(status);
}

async function loadModels({ quiet = false } = {}) {
  if (!state.bridge || !statusReady(state.status)) {
    state.models = [];
    render();
    return;
  }
  state.modelsLoading = true;
  if (!quiet) state.modelTests = {};
  render();
  try {
    state.models = normalizeModels(await state.bridge.settings.models()).filter(isChatModel);
  } catch (reason) {
    state.models = [];
    feedback(actionableError(reason, 'settings'), 'error');
  } finally {
    state.modelsLoading = false;
    render();
  }
}

async function loadStatus() {
  if (!state.bridge) return false;
  const value = await state.bridge.settings.status();
  const ready = hydrateStatus(value);
  if (ready) await loadModels({ quiet: true });
  else state.models = [];
  return ready;
}

async function loadImageStatus() {
  if (!state.bridge) return;
  state.imageStatus = normalizeImageStatus(await state.bridge.settings.imageStatus());
  renderImage();
}

async function loadImageModels() {
  if (!state.bridge) return;
  state.imageModelsLoading = true;
  renderImage();
  try {
    const value = await state.bridge.settings.imageModels();
    state.imageModels = normalizeImageModels(value);
    if (value?.error) feedback('暂时无法读取图片模型，请检查服务配置后重试。', 'error');
  } catch (reason) {
    state.imageModels = [];
    feedback(actionableError(reason, 'settings'), 'error');
  } finally {
    state.imageModelsLoading = false;
    renderImage();
  }
}

async function loadAll() {
  state.loading = true;
  state.fatalError = '';
  state.feedback = null;
  render();
  if (!state.bridge) {
    state.loading = false;
    state.fatalError = '请在轻作桌面中打开 AI 设置。';
    render();
    return;
  }
  const statusResult = await Promise.allSettled([loadStatus()]);
  if (statusResult[0].status === 'rejected') {
    state.fatalError = actionableError(statusResult[0].reason, 'settings');
    state.loading = false;
    render();
    return;
  }
  await Promise.allSettled([loadImageStatus(), loadImageModels()]);
  state.loading = false;
  render();
}

async function beginTextSetup() {
  if (!state.bridge || state.busyAction) return;
  state.busyAction = 'text';
  feedback('');
  render();
  try {
    const value = unwrap(await state.bridge.settings.beginTextSetup(state.address.trim()), 'status');
    const ready = hydrateStatus(value);
    if (ready) {
      state.editing = false;
      await loadModels();
      feedback('AI 服务已连接。', 'success');
    } else {
      state.editing = true;
      feedback('连接尚未完成，请检查服务地址后重试。', 'info');
    }
  } catch (reason) {
    feedback(actionableError(reason, 'settings'), 'error');
  } finally {
    state.busyAction = '';
    render();
  }
}

async function beginImageSetup(provider) {
  if (!state.bridge || state.busyAction) return;
  state.busyAction = provider;
  feedback('');
  render();
  try {
    const result = await state.bridge.settings.beginImageKeySetup(provider);
    const value = unwrap(result, 'imageStatus');
    state.imageStatus = normalizeImageStatus(value) || state.imageStatus;
    await loadImageModels();
    feedback('图像服务设置已更新。', 'success');
  } catch (reason) {
    feedback(actionableError(reason, 'settings'), 'error');
  } finally {
    state.busyAction = '';
    render();
  }
}

async function clearImageKey(provider) {
  if (!state.bridge || state.busyAction) return;
  if (!window.confirm('清除这个图像服务的已保存配置？')) return;
  state.busyAction = provider;
  feedback('');
  render();
  try {
    const result = await state.bridge.settings.clearImageKey(provider);
    const value = unwrap(result, 'imageStatus');
    state.imageStatus = normalizeImageStatus(value) || state.imageStatus;
    await loadImageStatus();
    await loadImageModels();
    feedback('图像服务配置已清除。', 'success');
  } catch (reason) {
    feedback(actionableError(reason, 'settings'), 'error');
  } finally {
    state.busyAction = '';
    render();
  }
}

async function testModel(model) {
  if (!state.bridge || state.testingModel) return;
  state.testingModel = model;
  state.modelTests[model] = { state: 'testing' };
  renderModels();
  try {
    const result = await state.bridge.settings.testModel(model);
    if (result?.ok === false) {
      state.modelTests[model] = {
        state: 'error',
        message: actionableError(result.message, 'settings')
      };
    } else {
      state.modelTests[model] = {
        state: 'success',
        latencyMs: Number.isFinite(result?.latencyMs) ? result.latencyMs : 0,
        response: typeof result?.response === 'string' ? result.response.slice(0, 200) : ''
      };
    }
  } catch (reason) {
    state.modelTests[model] = { state: 'error', message: actionableError(reason, 'settings') };
  } finally {
    state.testingModel = '';
    renderModels();
  }
}

try {
  state.bridge = createAssistantBridge();
} catch {
  state.loading = false;
  state.fatalError = '请在轻作桌面中打开 AI 设置。';
  render();
}

$('refresh-page').addEventListener('click', () => void loadAll());
$('retry-load').addEventListener('click', () => void loadAll());
$('change-service').addEventListener('click', () => {
  state.editing = true;
  feedback('');
  render();
});
$('refresh-models').addEventListener('click', () => void loadModels());
$('refresh-image').addEventListener('click', () => {
  void Promise.allSettled([loadImageStatus(), loadImageModels()]);
});
$('begin-text-setup').addEventListener('click', () => void beginTextSetup());
$('address-input').addEventListener('input', event => {
  state.address = event.target.value;
  $('begin-text-setup').disabled = Boolean(state.busyAction) || !state.address.trim();
});

if (state.bridge) void loadAll();

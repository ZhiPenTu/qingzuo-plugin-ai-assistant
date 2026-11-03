import {
  actionableError,
  createAssistantBridge,
  observeSession
} from './bridge.mjs';

const $ = id => document.getElementById(id);
const SELECTED_CHAT_KEY = 'qingzuo.ai-assistant.selected-chat.v1';
const SETTINGS_URL = '../settings/index.html';
const state = {
  bridge: null,
  chats: [],
  plugins: [],
  models: [],
  model: '',
  connected: false,
  ready: false,
  loading: true,
  busy: false,
  session: null,
  stream: '',
  waitingForApproval: false,
  actionError: '',
  sessionError: '',
  fatalError: '',
  follow: true,
  pollTimer: 0
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

function readSelectedChat() {
  try {
    return localStorage.getItem(SELECTED_CHAT_KEY) || '';
  } catch {
    return '';
  }
}

function rememberChat(id) {
  try {
    if (id) localStorage.setItem(SELECTED_CHAT_KEY, id);
    else localStorage.removeItem(SELECTED_CHAT_KEY);
  } catch {
    // The selected conversation is a convenience, not essential state.
  }
}

function isChatModel(model) {
  const signature = `${model?.id ?? ''} ${model?.title ?? ''} ${model?.type ?? ''}`.toLowerCase();
  return !/(?:^|[/_. -])(?:embedding|embed|rerank|reranker|bge|whisper|transcri(?:be|ption)|speech|audio|tts|video|sora|veo|kling|imagen|dall-e|stable-diffusion|flux)(?:$|[/_. -])|gpt[-_ ]?image|nano[-_ ]?banana|image[-_ ]?generat/i.test(signature);
}

function statusReady(status) {
  if (!status || typeof status !== 'object') return false;
  if (typeof status.ready === 'boolean') return status.ready;
  return Boolean(status.model && Array.isArray(status.verified) && status.verified.includes(status.model));
}

function normalizeChats(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item.id === 'string' && item.id)
    .map(item => ({
      id: item.id,
      title: typeof item.title === 'string' && item.title.trim() ? item.title : '未命名对话',
      state: item.state === 'running' ? 'running' : 'idle',
      updated: Number.isFinite(item.updated) ? item.updated : 0
    }));
}

function normalizePlugins(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(plugin => plugin && typeof plugin.id === 'string' && typeof plugin.title === 'string')
    .map(plugin => ({
      id: plugin.id,
      title: plugin.title,
      description: typeof plugin.description === 'string' ? plugin.description : '',
      tools: Array.isArray(plugin.tools)
        ? plugin.tools
          .filter(tool => tool && typeof tool.name === 'string')
          .map(tool => ({ name: tool.name, title: typeof tool.title === 'string' && tool.title ? tool.title : tool.name }))
        : []
    }));
}

function normalizeModels(value) {
  const source = Array.isArray(value) ? value : Array.isArray(value?.models) ? value.models : [];
  return source
    .filter(model => model && typeof model.id === 'string' && model.id)
    .map(model => ({
      id: model.id,
      title: typeof model.title === 'string' ? model.title : '',
      type: typeof model.type === 'string' ? model.type : ''
    }))
    .filter(isChatModel);
}

function clearPolling() {
  if (state.pollTimer) window.clearInterval(state.pollTimer);
  state.pollTimer = 0;
}

function syncPolling() {
  clearPolling();
  if (!state.session || state.session.state !== 'running') return;
  state.pollTimer = window.setInterval(async () => {
    const id = state.session?.id;
    if (!id || !state.bridge) return;
    try {
      const raw = await state.bridge.chat.status(id);
      if (state.session?.id !== id) return;
      const observed = observeSession(raw);
      if (observed) applySession(observed);
      if (observed?.session.state !== 'running') clearPolling();
    } catch {
      // A transient polling failure must not replace the visible conversation.
    }
  }, 3000);
}

function applySession(observed, { updateModel = true } = {}) {
  state.session = observed.session;
  state.stream = observed.session.partial || '';
  state.waitingForApproval = observed.waitingForApproval;
  state.sessionError = observed.error || '';
  rememberChat(observed.session.id);
  if (updateModel && observed.session.model && state.models.some(model => model.id === observed.session.model)) {
    state.model = observed.session.model;
  }
  render();
  syncPolling();
}

function closeDialog(id) {
  const dialog = $(id);
  if (dialog?.open) dialog.close();
}

function openDialog(id) {
  const dialog = $(id);
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function renderConnection() {
  const dot = $('connection-dot');
  dot.className = 'connection-dot' + (state.ready ? ' connected' : state.connected ? ' connected-muted' : '');
  dot.setAttribute('aria-label', state.ready ? '助手已就绪' : state.connected ? '没有可用模型' : '助手待配置');
}

function renderModels() {
  const select = $('model-select');
  select.replaceChildren();
  if (!state.models.length) {
    const option = element('option', '', state.loading ? '正在读取模型…' : state.connected ? '没有可用模型' : '请先连接 AI 服务');
    option.value = '';
    select.append(option);
  } else {
    for (const model of state.models) {
      const option = element('option', '', model.title && model.title !== model.id ? `${model.title} · ${model.id}` : model.id);
      option.value = model.id;
      select.append(option);
    }
    select.value = state.models.some(model => model.id === state.model) ? state.model : state.models[0].id;
    if (select.value !== state.model) state.model = select.value;
  }
  select.disabled = state.busy || state.session?.state === 'running' || state.loading || state.models.length === 0;
}

function historyEntry(chat, compact) {
  const button = element('button', 'history-item' + (state.session?.id === chat.id ? ' is-active' : ''));
  button.type = 'button';
  button.disabled = state.busy;
  button.setAttribute('aria-current', state.session?.id === chat.id ? 'true' : 'false');
  button.setAttribute('aria-label', chat.state === 'running' ? chat.title + '（处理中）' : chat.title);
  button.append(icon('message'), element('span', 'history-title', chat.title));
  if (chat.state === 'running') {
    const status = element('span', 'running-dot');
    status.setAttribute('aria-hidden', 'true');
    button.append(status);
  }
  button.addEventListener('click', () => {
    closeDialog('history-dialog');
    void selectChat(chat.id);
  });
  if (compact) button.classList.add('compact');
  return button;
}

function renderHistory() {
  $('sidebar-count').textContent = String(state.chats.length);
  $('sidebar-history').replaceChildren(...state.chats.map(chat => historyEntry(chat, false)));
  $('history-dialog-list').replaceChildren(...state.chats.map(chat => historyEntry(chat, true)));
  $('sidebar-empty').hidden = state.chats.length > 0 || state.loading;
  $('history-dialog-empty').hidden = state.chats.length > 0 || state.loading;
  $('sidebar-new').disabled = state.busy || !state.model;
  $('history-dialog-new').disabled = state.busy || !state.model;
  $('delete-chat').disabled = state.busy || !state.session || state.session.state === 'running';
}

function appendInline(container, text) {
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) container.append(document.createTextNode(text.slice(cursor, match.index)));
    if (match[1] !== undefined) {
      const code = element('code', 'inline-code', match[1]);
      container.append(code);
    } else {
      container.append(element('strong', '', match[2]));
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) container.append(document.createTextNode(text.slice(cursor)));
}

function renderRichText(container, text) {
  const chunks = String(text || '').split('```');
  chunks.forEach((chunk, index) => {
    if (index % 2 === 1) {
      const lines = chunk.replace(/^\n/, '').split('\n');
      if (/^[a-z0-9_+-]+$/i.test(lines[0] || '') && lines.length > 1) lines.shift();
      const pre = element('pre', 'code-block');
      pre.append(element('code', '', lines.join('\n')));
      container.append(pre);
      return;
    }
    const paragraphs = chunk.split(/\n{2,}/).filter(part => part.trim());
    for (const paragraph of paragraphs) {
      if (paragraph.split('\n').every(line => line.startsWith('- '))) {
        const list = element('ul');
        for (const line of paragraph.split('\n')) {
          const item = element('li');
          appendInline(item, line.slice(2));
          list.append(item);
        }
        container.append(list);
      } else {
        const p = element('p');
        const lines = paragraph.split('\n');
        lines.forEach((line, lineIndex) => {
          if (lineIndex) p.append(document.createElement('br'));
          appendInline(p, line);
        });
        container.append(p);
      }
    }
  });
}

function messageArticle(message) {
  const article = element('article', 'message message-' + message.role);
  const label = element('span', 'message-label', message.role === 'user' ? '你' : 'AI');
  const body = element('div', 'message-body');
  if (message.role === 'assistant') renderRichText(body, message.text);
  else {
    const p = element('p');
    appendInline(p, message.text);
    body.append(p);
  }
  article.append(label, body);
  return article;
}

function toolRecord(message) {
  const plugin = state.plugins.find(item => item.id === message.pluginId);
  const title = message.tool === 'list_plugins' ? '发现已启用插件' : plugin?.title || '工具调用';
  const stateLabel = message.state === 'running'
    ? '执行中'
    : message.state === 'succeeded'
      ? '已完成'
      : message.state === 'interrupted'
        ? '中断，结果未知'
        : '未完成';
  const section = element('section', 'tool-record');
  const heading = element('div', 'tool-record-heading');
  heading.append(icon(message.state === 'succeeded' ? 'check' : message.state === 'running' ? 'tools' : 'alert'), element('strong', '', title), element('span', '', stateLabel));
  section.append(heading);
  if (message.text) {
    const details = element('details');
    details.append(element('summary', '', '查看调用结果'));
    details.append(element('pre', 'tool-output', message.text));
    section.append(details);
  }
  return section;
}

function waitingCard() {
  const section = element('section', 'approval-waiting');
  section.setAttribute('aria-label', '等待桌面确认');
  section.append(element('strong', '', '等待桌面确认'));
  section.append(element('p', '', '请在桌面完成确认，随后对话会继续。'));
  return section;
}

function activityCard() {
  const activity = element('div', 'activity', '正在处理…');
  activity.setAttribute('role', 'status');
  const dots = element('span', 'activity-dots');
  dots.setAttribute('aria-hidden', 'true');
  dots.append(element('i'), element('i'), element('i'));
  activity.prepend(dots);
  return activity;
}

function renderTranscript() {
  const content = $('transcript-content');
  content.replaceChildren();
  const messages = state.session?.history || [];
  const hasContent = messages.length > 0 || Boolean(state.stream) || state.waitingForApproval;
  $('empty-state').hidden = hasContent;
  content.hidden = !hasContent;
  for (const message of messages) {
    if (message.role === 'tool') content.append(toolRecord(message));
    else content.append(messageArticle(message));
  }
  if (state.stream) {
    const streaming = { role: 'assistant', text: state.stream };
    const article = messageArticle(streaming);
    article.classList.add('is-streaming');
    content.append(article);
  }
  if (state.waitingForApproval) content.append(waitingCard());
  else if (state.session?.state === 'running') content.append(activityCard());

  if (state.follow) requestAnimationFrame(() => $('transcript-end').scrollIntoView({ block: 'end' }));
}

function notice(message, tone = 'info', action = null) {
  const box = element('div', 'notice notice-' + tone);
  box.append(icon(tone === 'error' ? 'alert' : 'sparkles'), element('p', '', message));
  if (action) {
    const link = element('a', 'notice-action', action.label);
    link.href = action.href;
    box.append(link);
  }
  return box;
}

function renderNotices() {
  const notices = $('notices');
  const items = [];
  if (state.fatalError) items.push(notice(state.fatalError, 'error'));
  if (!state.loading && !state.fatalError) {
    if (!state.connected) items.push(notice('AI 助手尚未启用。连接服务后即可开始对话。', 'info', { label: '继续设置', href: SETTINGS_URL }));
    else if (!state.models.length) items.push(notice('没有可用的文本模型，请检查服务账户权限或更换服务。', 'info', { label: '检查 AI 设置', href: SETTINGS_URL }));
  }
  if (state.sessionError) items.push(notice(state.sessionError, 'error', { label: '检查 AI 设置', href: SETTINGS_URL }));
  if (state.actionError) items.push(notice(state.actionError, 'error', { label: '打开 AI 设置', href: SETTINGS_URL }));
  notices.replaceChildren(...items);
}

function renderComposer() {
  const running = state.session?.state === 'running';
  const canSend = !state.busy && state.ready && !running && Boolean(state.model) && Boolean($('message').value.trim());
  $('send-button').disabled = !canSend;
  $('send-button').hidden = running;
  $('cancel-button').hidden = !running;
  $('cancel-button').disabled = state.busy;
  $('message').disabled = state.busy;
}

function renderTools() {
  const list = $('tools-list');
  list.replaceChildren();
  for (const plugin of state.plugins) {
    const card = element('section', 'tool-plugin');
    const heading = element('div', 'tool-plugin-heading');
    heading.append(icon('tools'), element('h3', '', plugin.title));
    card.append(heading);
    if (plugin.description) card.append(element('p', '', plugin.description));
    const tools = element('ul');
    for (const tool of plugin.tools) tools.append(element('li', '', tool.title));
    card.append(tools);
    list.append(card);
  }
  $('tools-empty').hidden = state.plugins.length > 0;
}

function render() {
  renderConnection();
  renderModels();
  renderHistory();
  renderTranscript();
  renderNotices();
  renderComposer();
  renderTools();
  $('chat-title').textContent = state.session?.title || 'AI 对话';
  $('empty-tools-label').textContent = `查看可调用工具（${state.plugins.length}）`;
}

async function refreshChats() {
  if (!state.bridge) return;
  state.chats = normalizeChats(await state.bridge.chat.list());
  if (state.session && !state.chats.some(chat => chat.id === state.session.id)) {
    state.session = null;
    state.stream = '';
    state.waitingForApproval = false;
    rememberChat('');
  }
  renderHistory();
  syncPolling();
}

async function loadChat(id) {
  if (!state.bridge || !id) return;
  const observed = observeSession(await state.bridge.chat.status(id));
  if (!observed) throw new Error('这条对话不存在，请新建一条对话。');
  state.follow = true;
  state.actionError = '';
  applySession(observed);
}

async function selectChat(id) {
  await run(async () => {
    await loadChat(id);
  });
}

async function run(work) {
  if (state.busy) return;
  state.busy = true;
  state.actionError = '';
  render();
  try {
    await work();
  } catch (reason) {
    state.actionError = actionableError(reason, 'chat');
  } finally {
    state.busy = false;
    render();
  }
}

async function createChat() {
  if (!state.bridge || !state.model) return;
  await run(async () => {
    const observed = observeSession(await state.bridge.chat.create(state.model));
    if (!observed) throw new Error('无法创建对话，请稍后重试。');
    state.follow = true;
    state.session = observed.session;
    state.stream = observed.session.partial || '';
    state.waitingForApproval = observed.waitingForApproval;
    state.sessionError = observed.error || '';
    rememberChat(observed.session.id);
    $('message').value = '';
    closeDialog('history-dialog');
    await refreshChats();
    syncPolling();
    render();
    $('message').focus();
  });
}

async function sendMessage() {
  const draft = $('message').value.trim();
  if (!state.bridge || !draft || !state.ready || !state.model || state.session?.state === 'running') return;
  await run(async () => {
    let id = state.session?.id;
    if (!id) {
      const created = observeSession(await state.bridge.chat.create(state.model));
      if (!created) throw new Error('无法创建对话，请稍后重试。');
      id = created.session.id;
      state.session = created.session;
      state.stream = '';
      state.waitingForApproval = created.waitingForApproval;
      rememberChat(id);
    }
    state.follow = true;
    state.stream = '';
    state.waitingForApproval = false;
    const observed = observeSession(await state.bridge.chat.send(id, draft, state.model));
    if (observed) applySession(observed, { updateModel: false });
    else await loadChat(id);
    $('message').value = '';
    await refreshChats();
    render();
  });
}

async function cancelGeneration() {
  if (!state.bridge || !state.session?.id) return;
  await run(async () => {
    const observed = observeSession(await state.bridge.chat.cancel(state.session.id));
    if (observed) applySession(observed);
    else await loadChat(state.session.id);
    state.stream = '';
    await refreshChats();
    render();
  });
}

async function deleteChat() {
  if (!state.bridge || !state.session?.id || state.session.state === 'running') return;
  if (!window.confirm('删除这条对话记录？删除后无法在列表中找回。')) return;
  await run(async () => {
    await state.bridge.chat.delete(state.session.id);
    clearPolling();
    state.session = null;
    state.stream = '';
    state.waitingForApproval = false;
    state.sessionError = '';
    rememberChat('');
    await refreshChats();
    const next = state.chats[0]?.id;
    if (next) await loadChat(next);
    render();
  });
}

async function initialize() {
  try {
    state.bridge = createAssistantBridge();
  } catch {
    state.fatalError = '请在轻作桌面中打开 AI 助手。';
    state.loading = false;
    render();
    return;
  }

  const [chatsResult, toolsResult, statusResult] = await Promise.allSettled([
    state.bridge.chat.list(),
    state.bridge.chat.tools(),
    state.bridge.settings.status()
  ]);
  if (chatsResult.status === 'fulfilled') state.chats = normalizeChats(chatsResult.value);
  else state.actionError = actionableError(chatsResult.reason, 'chat');
  if (toolsResult.status === 'fulfilled') state.plugins = normalizePlugins(toolsResult.value);
  if (statusResult.status === 'fulfilled') state.connected = statusReady(statusResult.value);

  if (state.connected) {
    try {
      state.models = normalizeModels(await state.bridge.settings.models());
      state.model = state.models[0]?.id || '';
    } catch (reason) {
      state.actionError = actionableError(reason, 'settings');
    }
  }
  state.loading = false;
  state.ready = state.connected && state.models.length > 0;

  const remembered = readSelectedChat();
  const initialId = state.chats.find(chat => chat.id === remembered)?.id || state.chats[0]?.id;
  if (initialId) {
    try {
      await loadChat(initialId);
    } catch (reason) {
      state.actionError = actionableError(reason, 'chat');
    }
  }
  render();

  state.bridge.subscribeAI(event => {
    if (event.type === 'assistant-delta') {
      if (event.chatId !== state.session?.id) return;
      state.stream = event.partial ?? state.stream + event.text;
      renderTranscript();
      renderComposer();
      return;
    }
    if (event.type === 'assistant') {
      if (event.chatId !== state.session?.id) {
        void refreshChats().catch(() => {});
        return;
      }
      applySession({
        session: event.session,
        waitingForApproval: event.waitingForApproval,
        error: event.error
      });
      void refreshChats().catch(() => {});
    }
  });
}

$('sidebar-new').addEventListener('click', () => void createChat());
$('new-chat').addEventListener('click', () => void createChat());
$('history-dialog-new').addEventListener('click', () => void createChat());
$('delete-chat').addEventListener('click', () => void deleteChat());
$('open-history').addEventListener('click', () => openDialog('history-dialog'));
$('history-close').addEventListener('click', () => closeDialog('history-dialog'));
$('open-tools').addEventListener('click', () => openDialog('tools-dialog'));
$('empty-tools').addEventListener('click', () => openDialog('tools-dialog'));
$('tools-close').addEventListener('click', () => closeDialog('tools-dialog'));
$('model-select').addEventListener('change', event => {
  state.model = event.target.value;
  renderComposer();
});
$('composer-form').addEventListener('submit', event => {
  event.preventDefault();
  void sendMessage();
});
$('message').addEventListener('input', renderComposer);
$('message').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void sendMessage();
  }
});
$('cancel-button').addEventListener('click', () => void cancelGeneration());
$('transcript').addEventListener('scroll', () => {
  const transcript = $('transcript');
  state.follow = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
});
for (const button of document.querySelectorAll('[data-suggestion]')) {
  button.addEventListener('click', () => {
    $('message').value = button.dataset.suggestion;
    $('message').focus();
    renderComposer();
  });
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
}

void initialize();

export const BRIDGE_METHODS = Object.freeze({
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

export function actionableError(reason) {
  const raw = String(reason instanceof Error ? reason.message : reason ?? '').toLowerCase();
  if (/请在轻作|桌面中打开|commerceplugin/.test(raw)) return '请在轻作桌面中打开 AI 设置。';
  if (/401|invalid.*key|密钥无效|访问密钥无效|unauthorized/.test(raw)) return '访问密钥无效，请到 AI 设置重新输入。';
  if (/403|forbidden|没有.*权限|权限不足/.test(raw)) return '当前账户没有这项权限，请检查服务账户后重试。';
  if (/404|服务地址|endpoint/.test(raw)) return '服务地址不可用，请到 AI 设置检查连接地址。';
  if (/429|rate.?limit|额度|too many requests/.test(raw)) return '请求过于频繁或额度不足，请稍后再试。';
  if (/超时|timeout|timed out/.test(raw)) return '连接超时，请检查网络后重试。';
  if (/未配置|not configured|no model|没有.*模型|尚未启用/.test(raw)) return 'AI 服务尚未就绪，请到 AI 设置完成连接。';
  if (/取消|cancel/.test(raw)) return '操作已取消。';
  if (/未授权/.test(raw)) return '请从插件市场安装 AI 助手后再打开 AI 设置。';
  if (/not allow|permission|denied|unsupported|不支持/.test(raw)) return '当前桌面版本暂不支持这项操作，请更新轻作后重试。';
  if (/网络|network|连接失败|econn|enotfound|eai_again|failed to fetch/.test(raw)) return '无法连接 AI 服务，请检查网络后重试。';
  return '设置操作未完成，请稍后重试。';
}

export function createAssistantBridge(host = globalThis.commercePlugin) {
  if (!host || typeof host.invoke !== 'function') {
    throw new Error('请在轻作桌面中打开 AI 设置。');
  }
  async function invoke(method, args) {
    try {
      return await host.invoke(method, args ?? {});
    } catch (reason) {
      throw new Error(actionableError(reason));
    }
  }
  return Object.freeze({
    settings: Object.freeze({
      status: () => invoke(BRIDGE_METHODS.settings.status, {}),
      models: () => invoke(BRIDGE_METHODS.settings.models, {}),
      testModel: model => invoke(BRIDGE_METHODS.settings.testModel, { model }),
      beginTextSetup: address => invoke(BRIDGE_METHODS.settings.beginTextSetup, { address }),
      beginImageKeySetup: provider => invoke(BRIDGE_METHODS.settings.beginImageKeySetup, { provider }),
      clearImageKey: provider => invoke(BRIDGE_METHODS.settings.clearImageKey, { provider }),
      imageStatus: () => invoke(BRIDGE_METHODS.settings.imageStatus, {}),
      imageModels: () => invoke(BRIDGE_METHODS.settings.imageModels, {})
    })
  });
}

# AI 助手

轻作 `official.ai-assistant` 独立 UI 插件。它复用桌面宿主的共享 AI 服务，提供对话页和设置页，不包含后端进程、网络权限或服务商密钥输入框。

## 页面

- `ui/index.html`：历史会话、模型选择、新建/删除/发送/取消、工具列表和等待桌面确认状态。
- `settings/index.html`：文本服务连接状态、模型目录与测试、共享图像服务状态和模型目录。

设置页通过宿主内部桥触发原生密钥输入：

- `firstParty.assistant.settings.beginTextSetup({ address })`
- `firstParty.assistant.settings.beginImageKeySetup({ provider })`

插件页面不接收、不渲染也不保存服务商密钥。页面只保存最近选中的对话 ID，不存聊天密钥、文件路径或审批参数。

## 开发与验证

要求 Node 24。

```sh
npm ci --ignore-scripts
npm test
npm run pack
QINGZUO_HOST_EXECUTABLE=/path/to/Qingzuo npm run test:host
```

`npm run test:host` 在未设置 `QINGZUO_HOST_EXECUTABLE` 时跳过。设置后会用临时用户目录安装本地 `.ecplugin`，验证插件页面和设置页可以打开。

## 打包

`npm run pack` 生成同一份静态构建的 macOS arm64 与 Windows x64 制品：

- `release/official.ai-assistant-0.1.0-darwin-arm64.ecplugin`
- `release/official.ai-assistant-0.1.0-win32-x64.ecplugin`
- `release/catalog-darwin-arm64.json`
- `release/catalog-win32-x64.json`

发布片段只包含插件身份、展示信息、API 范围与对应平台制品，不包含信任层、来源、权限或统计字段。插件包只包含运行时所需的 `package.json`、`LICENSE`、`README.md`、`ui/` 与 `settings/`；不包含测试、脚本、`node_modules` 或构建缓存。

## 桥契约

页面直接使用 `window.commercePlugin.invoke`，事件使用 `window.commercePlugin.onAI`。完整方法名和维护约束见 `AGENTS.md`。

`onAI` 只处理：

- `{ type: 'assistant-delta', chatId, text, partial? }`
- `{ type: 'assistant', chatId, session }`

会话进入插件前会移除 `approvals` 与 `args`；其他事件类型直接忽略。若宿主状态表明有待确认调用，页面只显示“等待桌面确认”。

# AGENTS.md

本仓库是轻作 `official.ai-assistant` 独立 UI 插件。仓库只维护 AI 设置页、桥适配、测试与打包脚本；桌面宿主、Plugin SDK 和市场目录在其他仓库维护。

## 边界

- `settings/` 是唯一页面，包含页面、桥适配和样式；`tests/` 是 Node 测试和可选宿主冒烟；`scripts/` 只负责清单校验与制品打包。
- `package.json` 的 `commerce.ui` 与 `commerce.settings.entry` 必须都指向 `settings/index.html`，设置页标题保持「AI 设置」。
- 不得恢复对话页，不得引用 `firstParty.assistant.chat.*`、`onAI`、`assistant` 事件或审批字段。
- 不得添加 `backend/`、服务进程、网络权限、AI 权限、凭据权限、外部脚本、CDN、远程字体或运行时下载。
- 不得把业务插件代码移回 `qingzuo-desktop`。

## 宿主桥

只允许使用以下内部桥方法，不依赖公开 `createPluginClient` 新增能力：

```text
firstParty.assistant.settings.status
firstParty.assistant.settings.models
firstParty.assistant.settings.testModel
firstParty.assistant.settings.beginTextSetup
firstParty.assistant.settings.beginImageKeySetup
firstParty.assistant.settings.clearImageKey
firstParty.assistant.settings.imageStatus
firstParty.assistant.settings.imageModels
```

`beginTextSetup` 只提交 `{ address }`，`beginImageKeySetup` 与 `clearImageKey` 只提交 `{ provider }`，`testModel` 只提交 `{ model }`。访问密钥必须由桌面原生输入处理；插件页面不得出现密钥字段、提交 `apiKey` 或从任意接口读取明文密钥。

## 隐私与存储

- 页面不使用 `localStorage` 或 `sessionStorage`。
- 不保存服务地址对应的密钥、文件路径或服务商凭据。
- 所有 `invoke` 异常都要映射为用户可操作文案；不要把原始异常、路径或凭据带到页面。

## 验证

```sh
npm test
npm run pack
QINGZUO_HOST_EXECUTABLE=/path/to/Qingzuo npm run test:host
```

`npm test` 覆盖 manifest、设置桥方法、离线资源、密钥字段约束和 ecplugin 内容。`test:host` 缺少宿主可执行文件时必须跳过，不得自动下载宿主。

## 提交与发布

- 不自动创建 Release，不修改市场目录。
- 提交信息使用 `feat:` / `fix:` / `test:` / `docs:` / `chore:`。
- `release/`、`output/`、`node_modules/` 不入库。
- manifest 的 API 范围为 `^1.10.0`；当前宿主 SDK 为 1.13.0，工具链里的旧 SDK 只能作为类型或打包占位，不能借此降低 manifest 版本要求。

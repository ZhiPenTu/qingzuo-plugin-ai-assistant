import path from 'node:path';

export const EXPECTED_API = '^1.10.0';

function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.includes('\0') || path.posix.isAbsolute(value)) {
    throw new Error('插件路径无效。');
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) {
    throw new Error('插件路径无效。');
  }
  return value;
}

export function validateManifest(pkg) {
  const manifest = pkg?.commerce;
  if (!manifest || manifest.manifestVersion !== 1) throw new Error('插件清单版本无效。');
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(manifest.id || '') || manifest.id.startsWith('system.') || manifest.id.length > 96) {
    throw new Error('插件标识无效。');
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg?.version || '')) throw new Error('插件版本无效。');
  if (manifest.api !== EXPECTED_API) throw new Error('插件 API 必须为 ' + EXPECTED_API + '。');
  if (typeof manifest.title !== 'string' || !manifest.title.trim() || manifest.title.length > 80) throw new Error('插件名称无效。');
  if (typeof manifest.description !== 'string' || !manifest.description.trim() || manifest.description.length > 2000) throw new Error('插件说明无效。');
  safeRelative(manifest.ui);
  if (!manifest.settings || typeof manifest.settings.title !== 'string' || !manifest.settings.title.trim()) throw new Error('插件设置入口无效。');
  safeRelative(manifest.settings.entry);
  if (manifest.backend) throw new Error('此插件不得声明后端。');
  if (!manifest.permissions || typeof manifest.permissions !== 'object' || Array.isArray(manifest.permissions)) throw new Error('插件权限无效。');
  if (manifest.permissions.network !== undefined) throw new Error('此插件不得申请网络权限。');
  return { ...manifest, version: pkg.version };
}

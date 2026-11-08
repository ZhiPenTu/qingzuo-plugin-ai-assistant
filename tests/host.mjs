import { access, readFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const executable = process.env.QINGZUO_HOST_EXECUTABLE;
if (!executable) {
  console.log('SKIP: 未设置 QINGZUO_HOST_EXECUTABLE。');
  process.exit(0);
}

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const artifact = path.resolve('release', `${pkg.commerce.id}-${pkg.version}-${process.platform}-${process.arch}.ecplugin`);
try {
  await access(artifact);
} catch {
  const packed = spawnSync(process.execPath, ['scripts/pack-plugin.mjs'], { stdio: 'inherit' });
  if (packed.status !== 0) throw new Error('无法生成宿主测试制品。');
}
await access(executable);

const { _electron: electron, expect } = await import('@playwright/test');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'qingzuo-ai-assistant-host-'));
let application;
try {
  application = await electron.launch({
    executablePath: path.resolve(executable),
    args: ['--user-data-dir=' + path.join(temporary, 'profile')],
    timeout: 60000
  });
  const page = await application.firstWindow();
  await expect.poll(async () => (await page.evaluate(() => window.commerceDesktop.invoke('status'))).kernel.ready, { timeout: 60000 }).toBe(true);
  await application.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, artifact);
  await page.evaluate(() => window.commerceDesktop.invoke('plugins.import'));

  const installedTab = page.getByRole('tab', { name: '已安装', exact: true });
  if (await installedTab.count()) await installedTab.click();
  else await page.getByRole('button', { name: '工具中心', exact: true }).click();
  const card = page.locator('[data-slot="card"]').filter({ hasText: 'AI 助手' });
  await expect(card.getByRole('heading', { name: 'AI 助手', exact: true })).toBeVisible({ timeout: 30000 });
  await card.getByRole('button', { name: /^打开/ }).click();
  await expect.poll(() => application.context().pages().some(candidate => candidate.url().startsWith('commerce-plugin://official.ai-assistant/')), { timeout: 60000 }).toBe(true);
  const plugin = application.context().pages().find(candidate => candidate.url().startsWith('commerce-plugin://official.ai-assistant/'));
  await expect.poll(() => plugin.url(), { timeout: 30000 }).toMatch(/\/settings\/index\.html$/);
  await expect(plugin.getByRole('heading', { name: 'AI 设置', exact: true })).toBeVisible();
  await expect(plugin.getByRole('button', { name: '使用桌面安全输入', exact: true }).first()).toBeVisible();
  await expect(plugin.getByLabel('消息', { exact: true })).toHaveCount(0);
  console.log('宿主冒烟通过：插件可安装，并直接打开 AI 设置页。');
} finally {
  await application?.close().catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}

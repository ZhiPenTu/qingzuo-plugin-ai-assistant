import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { packPlugin } from '../scripts/pack-plugin.mjs';
import { validateManifest } from '../scripts/manifest.mjs';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));

test('pack emits identical dual-platform artifacts and minimal release fragments', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qingzuo-ai-assistant-pack-'));
  try {
    const result = await packPlugin({ outputDirectory: directory });
    assert.equal(result.id, 'official.ai-assistant');
    assert.equal(result.version, pkg.version);
    assert.equal(result.artifacts.length, 2);
    assert.deepEqual(result.artifacts.map(item => item.platform), ['darwin-arm64', 'win32-x64']);
    assert.equal(result.artifacts[0].sha256, result.artifacts[1].sha256);
    assert.deepEqual(result.artifacts.map(item => item.fragmentName), ['catalog-darwin-arm64.json', 'catalog-win32-x64.json']);

    const first = await readFile(result.artifacts[0].filename);
    const second = await readFile(result.artifacts[1].filename);
    assert.deepEqual(first, second);
    assert.equal(createHash('sha256').update(first).digest('hex'), result.sha256);

    const zip = new AdmZip(first);
    const names = zip.getEntries().map(entry => entry.entryName).sort();
    for (const required of [
      'package.json',
      'LICENSE',
      'README.md',
      'settings/index.html',
      'settings/settings.mjs',
      'settings/bridge.mjs',
      'settings/style.css'
    ]) assert.ok(names.includes(required), `missing ${required}`);
    assert.ok(names.every(name => !name.startsWith('ui/')), 'chat page files must not be packed');
    for (const name of names) {
      assert.doesNotMatch(name, /^(?:tests|scripts|node_modules|release|vendor)\//);
      assert.doesNotMatch(name, /\.tgz$|\.log$/);
    }

    const packageJson = JSON.parse(zip.readAsText('package.json'));
    const manifest = validateManifest(packageJson);
    assert.equal(manifest.api, '^1.10.0');
    assert.equal(manifest.id, 'official.ai-assistant');
    assert.equal(manifest.ui, 'settings/index.html');
    assert.deepEqual(manifest.settings, { title: 'AI 设置', entry: 'settings/index.html' });
    assert.deepEqual(manifest.permissions, {});

    for (const item of result.artifacts) {
      const fragment = JSON.parse(await readFile(item.fragment, 'utf8'));
      assert.equal(fragment.schemaVersion, 1);
      assert.equal(fragment.plugins.length, 1);
      const release = fragment.plugins[0];
      assert.deepEqual(Object.keys(release).sort(), [
        'api',
        'artifacts',
        'category',
        'description',
        'icon',
        'id',
        'releaseNotes',
        'title',
        'version',
      ]);
      assert.equal(release.icon, manifest.icon);
      assert.equal(release.id, 'official.ai-assistant');
      assert.equal(release.version, '0.2.0');
      assert.equal(release.api, '^1.10.0');
      assert.equal(release.artifacts[item.platform].size, item.size);
      assert.equal(release.artifacts[item.platform].sha256, item.sha256);
      const escapedVersion = pkg.version.replaceAll('.', '\\.');
      assert.match(release.artifacts[item.platform].url, new RegExp(`/releases/download/v${escapedVersion}/official\\.ai-assistant-${escapedVersion}-`));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

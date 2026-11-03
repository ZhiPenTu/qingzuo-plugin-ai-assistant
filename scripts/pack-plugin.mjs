import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { validateManifest } from './manifest.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const INCLUDED_DIRECTORIES = ['ui', 'settings'];
const PLATFORMS = ['darwin-arm64', 'win32-x64'];
const REPOSITORY = 'https://github.com/ZhiPenTu/qingzuo-plugin-ai-assistant';

async function collect(directory, prefix) {
  const files = new Map();
  for (const name of (await readdir(directory)).sort()) {
    const filename = path.join(directory, name);
    const relative = prefix + '/' + name;
    const info = await lstat(filename);
    if (info.isSymbolicLink()) throw new Error('插件包不能包含符号链接：' + relative);
    if (info.isDirectory()) {
      for (const [key, value] of await collect(filename, relative)) files.set(key, value);
      continue;
    }
    if (!info.isFile()) throw new Error('插件包包含不支持的文件类型：' + relative);
    files.set(relative, await readFile(filename));
  }
  return files;
}

export async function packPlugin({ root = ROOT, outputDirectory = path.join(root, 'release') } = {}) {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const manifest = validateManifest(pkg);
  const files = new Map();
  const runtimePackage = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    type: 'module',
    commerce: pkg.commerce
  };
  files.set('package.json', Buffer.from(JSON.stringify(runtimePackage, null, 2) + '\n'));
  files.set('LICENSE', await readFile(path.join(root, 'LICENSE')));
  files.set('README.md', await readFile(path.join(root, 'README.md')));
  for (const directory of INCLUDED_DIRECTORIES) {
    for (const [relative, bytes] of await collect(path.join(root, directory), directory)) files.set(relative, bytes);
  }
  if (!files.has(manifest.settings.entry)) throw new Error('插件包缺少设置页。');
  if (!files.has(manifest.ui)) throw new Error('插件包缺少对话页。');

  const zip = new AdmZip();
  for (const [relative, bytes] of [...files].sort(([left], [right]) => left.localeCompare(right))) zip.addFile(relative, bytes);
  const bytes = zip.toBuffer();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await mkdir(outputDirectory, { recursive: true });
  const artifacts = [];
  for (const platform of PLATFORMS) {
    const name = manifest.id + '-' + manifest.version + '-' + platform + '.ecplugin';
    const filename = path.join(outputDirectory, name);
    await writeFile(filename, bytes);
    const fragmentName = 'catalog-' + platform + '.json';
    const fragment = path.join(outputDirectory, fragmentName);
    await writeFile(fragment, JSON.stringify({
      schemaVersion: 1,
      plugins: [{
        id: manifest.id,
        version: manifest.version,
        title: manifest.title,
        description: manifest.description,
        ...(manifest.category !== undefined ? { category: manifest.category } : {}),
        api: manifest.api,
        ...(manifest.releaseNotes !== undefined ? { releaseNotes: manifest.releaseNotes } : {}),
        ...(manifest.icon !== undefined ? { icon: manifest.icon } : {}),
        artifacts: {
          [platform]: {
            url: REPOSITORY + '/releases/download/v' + manifest.version + '/' + name,
            size: bytes.length,
            sha256,
          },
        },
      }],
    }, null, 2) + '\n');
    artifacts.push({ platform, filename, name, fragment, fragmentName, size: bytes.length, sha256 });
  }
  return {
    id: manifest.id,
    version: manifest.version,
    sha256,
    files: [...files.keys()].sort(),
    artifacts
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const result = await packPlugin();
  console.log(JSON.stringify({
    id: result.id,
    version: result.version,
    sha256: result.sha256,
    files: result.files,
    artifacts: result.artifacts.map(item => path.relative(ROOT, item.filename)),
    fragments: result.artifacts.map(item => path.relative(ROOT, item.fragment))
  }, null, 2));
}

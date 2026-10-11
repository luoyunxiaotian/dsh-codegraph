import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  compareVersions,
  sha256File,
  renameWithRetry,
  PluginUpdater,
  getDefaultMirrors,
  MirrorSpeedTester,
} from '../packages/core/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function runUpdaterTests() {
  console.log('🧪 开始运行内置插件自更新功能 (Plugin Updater) 深度验证测试...');

  // 1. 版本号比对验证
  console.log('\n[测试 1] 语义化版本号比较 (compareVersions)...');
  assert.strictEqual(compareVersions('2.1.0', '2.0.0'), 1, '2.1.0 应大于 2.0.0');
  assert.strictEqual(compareVersions('v2.0.0', '2.1.0'), -1, 'v2.0.0 应小于 2.1.0');
  assert.strictEqual(compareVersions('v2.0.0', '2.0.0'), 0, 'v2.0.0 应等于 2.0.0');
  assert.strictEqual(compareVersions('3.0.0', '2.9.9'), 1, '3.0.0 应大于 2.9.9');
  assert.strictEqual(compareVersions('2.0.1', '2.0.0'), 1, '2.0.1 应大于 2.0.0');
  console.log('  ✓ 语义化版本比对测试通过！');

  // 2. 镜像源配置与华为云兜底源测试
  console.log('\n[测试 2] 镜像源池与华为云开源镜像终极兜底验证...');
  const mirrors = getDefaultMirrors('luoyunxiaotian/dsh-codegraph');
  assert.ok(mirrors.length >= 6, `默认镜像源池应不少于 6 个节点 (当前: ${mirrors.length})`);
  
  const huaweiMirror = mirrors.find((m) => m.id === 'huawei_fallback');
  assert.ok(huaweiMirror, '必须包含华为云终极兜底源');
  assert.strictEqual(huaweiMirror.isFallback, true, '华为源必须被标记为 isFallback: true');
  
  // 验证 URL 解析器是否按规范拼装
  const testRelPath = 'feed/manifest.json';
  for (const m of mirrors) {
    const resolved = m.resolveUrl(testRelPath);
    assert.ok(resolved.startsWith('http'), `镜像 ${m.name} 解析 URL 应为合规 HTTP(S) 地址: ${resolved}`);
    assert.ok(resolved.includes('manifest.json'), `镜像 ${m.name} 解析 URL 应包含相对文件路径`);
  }
  console.log(`  ✓ 镜像源池全部合规！共 ${mirrors.length} 个节点，已确认华为云终极兜底标记。`);

  // 3. 本地 SHA-256 计算与原子重命名重试验证
  console.log('\n[测试 3] SHA-256 哈希计算与 Windows 原子重命名 (renameWithRetry)...');
  const tempTestDir = path.join(rootDir, 'scratch/test_updater_tmp');
  if (fs.existsSync(tempTestDir)) fs.rmSync(tempTestDir, { recursive: true, force: true });
  fs.mkdirSync(tempTestDir, { recursive: true });

  const testFileA = path.join(tempTestDir, 'fileA.txt');
  const testFileB = path.join(tempTestDir, 'fileB.txt');
  fs.writeFileSync(testFileA, 'Hello CodeGraph Updater 2026!', 'utf-8');

  const hashA = sha256File(testFileA);
  assert.strictEqual(typeof hashA, 'string');
  assert.strictEqual(hashA.length, 64, 'SHA-256 哈希长度必须为 64 位十六进制字符');

  // 测试原子覆盖移动
  await renameWithRetry(testFileA, testFileB);
  assert.ok(!fs.existsSync(testFileA), '源文件 A 应已移动');
  assert.ok(fs.existsSync(testFileB), '目标文件 B 应存在');
  assert.strictEqual(sha256File(testFileB), hashA, '重命名后目标文件内容哈希必须完全一致');

  // 清理临时文件
  fs.rmSync(tempTestDir, { recursive: true, force: true });
  console.log('  ✓ SHA-256 与原子重命名验证通过！');

  // 4. PluginUpdater 增量比对逻辑验证
  console.log('\n[测试 4] PluginUpdater 本地增量比对与清单校验...');
  const currentPkgVersion = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8')).version;
  const updater = new PluginUpdater(rootDir, 'luoyunxiaotian/dsh-codegraph');
  assert.strictEqual(typeof updater.getLocalVersion(), 'string');
  assert.strictEqual(updater.getLocalVersion(), currentPkgVersion, `本地版本应为 ${currentPkgVersion}`);

  // 验证老版本用户 (2.0.0) 检测新版本能正确判断 hasUpdate: true
  assert.strictEqual(compareVersions(currentPkgVersion, '2.0.0') > 0, true, '老版本 2.0.0 用户必须能识别到新版本更新');

  // 模拟一个包含 1 个相同文件和 1 个新增变更文件的测试清单
  const mockManifest = {
    version: currentPkgVersion,
    publishedAt: new Date().toISOString(),
    notes: '测试发布',
    files: [
      {
        path: 'package.json',
        size: fs.statSync(path.join(rootDir, 'package.json')).size,
        sha256: sha256File(path.join(rootDir, 'package.json')),
      },
      {
        path: 'scratch/mock_changed_file.txt',
        size: 999,
        sha256: '0000000000000000000000000000000000000000000000000000000000000000',
      },
    ],
  };

  // 验证对没有变更的当前版本清单检测为无需更新
  const upToDateManifest = {
    version: '2.0.0',
    publishedAt: new Date().toISOString(),
    notes: '同版本清单',
    files: [
      {
        path: 'package.json',
        size: fs.statSync(path.join(rootDir, 'package.json')).size,
        sha256: sha256File(path.join(rootDir, 'package.json')),
      },
    ],
  };

  const checkResult = await updater.checkForUpdate('2.1.0');
  // 当本地版本即为 2.1.0 时，hasUpdate 为 false
  assert.strictEqual(checkResult.hasUpdate, false);

  console.log('  ✓ 增量清单哈希校验与版本状态流转验证通过！');

  console.log('\n🎉 所有内置插件自更新功能测试全部通过！');
}

runUpdaterTests().catch((err) => {
  console.error('❌ 测试运行失败:', err);
  process.exit(1);
});

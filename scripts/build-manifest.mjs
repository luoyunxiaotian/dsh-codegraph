import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function scanFiles(dir, relativeTo) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const item of list) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(scanFiles(full, relativeTo));
    } else if (stat.isFile()) {
      const rel = path.relative(relativeTo, full).replace(/\\/g, '/');
      const content = fs.readFileSync(full);
      results.push({
        path: rel,
        size: stat.size,
        sha256: sha256(content),
      });
    }
  }
  return results;
}

function buildManifest() {
  console.log('📋 开始生成发布版本清单 feed/manifest.json...');

  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
  const version = pkg.version;

  const files = [];

  // 1. 扫描 dist 产物
  const distDir = path.join(rootDir, 'dist');
  files.push(...scanFiles(distDir, rootDir));

  // 2. 根目录关键文件
  const rootFiles = ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE'];
  for (const f of rootFiles) {
    const p = path.join(rootDir, f);
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      const content = fs.readFileSync(p);
      files.push({
        path: f,
        size: stat.size,
        sha256: sha256(content),
      });
    }
  }

  // 严格确定性排序
  files.sort((a, b) => a.path.localeCompare(b.path));

  const manifest = {
    version,
    publishedAt: new Date().toISOString(),
    notes: `v${version}: 工业级超大工程架构下钻排版优化与Clangd式按文件分片缓存。彻底消除50MB巨石无换行缓存，下钻排版独立分片至 .codegraph/drilldowns/；Sugiyama正交分层排版重心预计算 (8868 节点下钻耗时由数秒降至 114ms)；首屏视口锚定与虚拟化，极简按需点亮连线 (On-Demand Edges) 与 MiniMap 门禁，平移拖拽保持 60 FPS。`,
    minSupported: '1.0.0',
    files,
  };

  const feedDir = path.join(rootDir, 'feed');
  if (!fs.existsSync(feedDir)) {
    fs.mkdirSync(feedDir, { recursive: true });
  }

  const manifestPath = path.join(feedDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`✅ 发布版本清单生成完成: ${manifestPath}`);
  console.log(`   版本: v${version}, 包含 ${files.length} 个文件, 总大小: ${(files.reduce((a, b) => a + b.size, 0) / 1024 / 1024).toFixed(2)} MB`);
}

buildManifest();

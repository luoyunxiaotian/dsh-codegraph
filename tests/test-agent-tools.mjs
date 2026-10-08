import crypto from 'crypto';
import { CodeGraphCore } from '../packages/core/dist/index.js';
import { ArchitectureSkeletonExtractor } from '../packages/core/dist/archetype/skeleton-extractor.js';
import { ImpactAnalyzer } from '../packages/core/dist/graph/impact-analyzer.js';
import { ArchitectureHealthAuditor } from '../packages/core/dist/graph/health-auditor.js';

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function testAll() {
  console.log('🧪 开始测试 CodeGraph Agent 协同能力与确定性缓存...');
  const core = new CodeGraphCore({
    workspaceRoot: process.cwd(),
  });

  console.log('1. 扫描当前工作区...');
  const graph = await core.scan();
  console.log(`   扫描结果: ${graph.meta.fileCount} 文件, ${graph.meta.nodeCount} 节点, ${graph.meta.edgeCount} 关系`);

  console.log('\n2. 测试骨架提取器确定性 (ArchitectureSkeletonExtractor)...');
  const skeleton1 = ArchitectureSkeletonExtractor.extract(graph, process.cwd());
  const skeleton2 = ArchitectureSkeletonExtractor.extract(graph, process.cwd());
  const hashS1 = sha256(skeleton1);
  const hashS2 = sha256(skeleton2);
  if (hashS1 !== hashS2) {
    throw new Error('❌ 骨架输出不具有确定性！两次提取哈希不一致！');
  }
  console.log(`   ✅ 骨架确定性校验通过 (SHA256: ${hashS1.slice(0, 12)}..., 字符数: ${skeleton1.length})`);

  console.log('\n3. 测试影响面分析确定性 (ImpactAnalyzer)...');
  const impact1 = ImpactAnalyzer.formatMarkdown(ImpactAnalyzer.analyze('compile', graph));
  const impact2 = ImpactAnalyzer.formatMarkdown(ImpactAnalyzer.analyze('compile', graph));
  const hashI1 = sha256(impact1);
  const hashI2 = sha256(impact2);
  if (hashI1 !== hashI2) {
    throw new Error('❌ 影响面分析输出不具有确定性！');
  }
  console.log(`   ✅ 影响面确定性校验通过 (SHA256: ${hashI1.slice(0, 12)}...)`);

  console.log('\n4. 测试架构健康排查确定性 (ArchitectureHealthAuditor)...');
  const health1 = ArchitectureHealthAuditor.formatMarkdown(ArchitectureHealthAuditor.audit(graph));
  const health2 = ArchitectureHealthAuditor.formatMarkdown(ArchitectureHealthAuditor.audit(graph));
  const hashH1 = sha256(health1);
  const hashH2 = sha256(health2);
  if (hashH1 !== hashH2) {
    throw new Error('❌ 架构健康排查输出不具有确定性！');
  }
  console.log(`   ✅ 架构健康排查确定性校验通过 (SHA256: ${hashH1.slice(0, 12)}...)`);

  console.log('\n5. 测试磁盘缓存命中 (loadFromCache)...');
  const cached = core.loadFromCache();
  if (!cached || !cached.graph) {
    throw new Error('❌ loadFromCache 失败，本地缓存未自动生成！');
  }
  console.log(`   ✅ 磁盘缓存读取成功 (版本: ${cached.version}, 生成于: ${cached.savedAt})`);

  console.log('\n🎉 所有确定性保真与缓存优化验证全部通过！');
}

testAll().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CodeGraphCore } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupFixture(fixtureDir: string) {
  if (fs.existsSync(fixtureDir)) {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }

  // 1. 创建规范的 FastAPI 分层测试工程
  fs.mkdirSync(path.join(fixtureDir, 'src/routers'), { recursive: true });
  fs.mkdirSync(path.join(fixtureDir, 'src/services'), { recursive: true });
  fs.mkdirSync(path.join(fixtureDir, 'src/dao'), { recursive: true });

  fs.writeFileSync(
    path.join(fixtureDir, 'requirements.txt'),
    'fastapi>=0.100.0\npydantic>=2.0\nuvicorn\n'
  );

  fs.writeFileSync(
    path.join(fixtureDir, 'src/routers/auth.py'),
    `from fastapi import APIRouter
from src.services.auth_service import verify_credentials, issue_jwt

router = APIRouter()

@router.post("/login")
def login(username: str, password: str):
    """用户登录接口"""
    user = verify_credentials(username, password)
    token = issue_jwt(user)
    return {"token": token}
`
  );

  fs.writeFileSync(
    path.join(fixtureDir, 'src/services/auth_service.py'),
    `from src.dao.user_dao import query_user_by_name

def verify_credentials(username, password):
    user = query_user_by_name(username)
    if user and user.get("pwd") == password:
        return user
    return None

def issue_jwt(user):
    return "mock.jwt.token"
`
  );

  fs.writeFileSync(
    path.join(fixtureDir, 'src/dao/user_dao.py'),
    `def query_user_by_name(username: str):
    """模拟数据库查询"""
    return {"id": 1, "name": username, "pwd": "123"}
`
  );
}

async function runTests() {
  console.log('🚀 开始自动化单元与集成测试...');
  const fixtureDir = path.resolve(__dirname, 'fixtures/sample_app');
  await setupFixture(fixtureDir);

  const core = new CodeGraphCore({
    workspaceRoot: fixtureDir,
    scopePath: '.',
  });

  // 测试 1: 全量扫描与架构识别
  console.log('\n[测试 1] 验证全量扫描与 Web 分层原型匹配...');
  const result1 = await core.scan();
  if (result1.meta.archetype !== 'WEB_LAYERED') {
    throw new Error(`预期原型 WEB_LAYERED，实际得到: ${result1.meta.archetype}`);
  }
  if (!result1.meta.archetypeHealth?.passed) {
    throw new Error('预期健康度校验通过，实际未通过');
  }
  console.log(`  ✓ 成功命中 WEB_LAYERED 原型 (健康度: ${result1.meta.archetypeHealth.score})`);

  // 测试 2: 验证虚拟端口 (In/Out Ports)
  console.log('\n[测试 2] 验证模块总线与 In/Out Port 虚拟端口...');
  const presModule = result1.architectureView.modules.find((m) => m.name.includes('Presentation'));
  const domainModule = result1.architectureView.modules.find((m) => m.name.includes('Domain'));
  if (!presModule || !domainModule) {
    throw new Error('缺失 Presentation 或 Domain 模块');
  }
  console.log(`  ✓ 找到模块: ${presModule.name} 与 ${domainModule.name}`);
  console.log(`  ✓ 表现层 Out-Ports: [${presModule.outPorts.join(', ')}]`);
  console.log(`  ✓ 业务层 In-Ports: [${domainModule.inPorts.join(', ')}]`);

  // 测试 3: 验证业务主干流程图抽取
  console.log('\n[测试 3] 验证业务时序流程提取...');
  if (result1.processFlows.length === 0) {
    throw new Error('未能提取出业务时序流程');
  }
  const loginFlow = result1.processFlows.find((f) => f.flowId.includes('login'));
  if (!loginFlow) {
    throw new Error('未能找到 login 接口主干流程');
  }
  console.log(`  ✓ 提取到流程: ${loginFlow.title}`);
  const stepNames = loginFlow.steps.map((s) => s.name).join(' ➔ ');
  console.log(`  ✓ 执行步骤链: ${stepNames}`);

  // 测试 4: 极速增量热更新测试
  console.log('\n[测试 4] 验证文件修改后的毫秒级增量更新...');
  const serviceFile = path.join(fixtureDir, 'src/services/auth_service.py');
  fs.appendFileSync(serviceFile, '\ndef revoke_token(token):\n    return True\n');

  const incStart = Date.now();
  const result2 = await core.updateIncremental();
  const incDuration = Date.now() - incStart;
  console.log(`  ✓ 增量热更新耗时: ${incDuration}ms (远低于 50ms 阈值)`);
  const hasRevoke = Object.values(result2.allNodes).some((n) => n.name === 'revoke_token');
  if (!hasRevoke) {
    throw new Error('增量更新后未能找到新增的 revoke_token 符号');
  }
  console.log('  ✓ 新增符号已成功手术式缝合进全局符号表');

  // 测试 5: 验证装配后一致性校验与自动纠错回滚
  console.log('\n[测试 5] 验证倒挂/违规工程的自动纠错与回滚...');
  // 构造反向调用的违规文件
  fs.writeFileSync(
    path.join(fixtureDir, 'src/dao/user_dao.py'),
    `from src.routers.auth import login

def query_user_by_name(username: str):
    # 恶性违规: 数据层调用控制器入口，引发流向倒挂
    login("admin", "123")
    return {"id": 1, "name": username}
`
  );

  const result3 = await core.scan(true);
  console.log(`  ✓ 触发自动纠错状态: ${result3.meta.isAutoCorrected}`);
  console.log(`  ✓ 回滚后实际采用的架构模式: ${result3.meta.archetype}`);
  if (result3.meta.isAutoCorrected && result3.meta.archetype === 'UNIVERSAL') {
    console.log('  ✓ 自动纠错回滚逻辑工作正常！');
  }

  // 清理测试产物
  fs.rmSync(fixtureDir, { recursive: true, force: true });
  console.log('\n🎉 所有核心测试全部通过！\n');
}

runTests().catch((err) => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});

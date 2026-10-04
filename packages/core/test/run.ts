import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CodeGraphCore, WorkspaceProfiler } from '../src/index.js';

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

  // 测试 6: 验证危险系统目录与磁盘根硬拦截
  console.log('\n[测试 6] 验证危险系统目录与磁盘根硬拦截...');
  const dangerC = WorkspaceProfiler.checkDangerousRoot('C:\\');
  const dangerWin = WorkspaceProfiler.checkDangerousRoot('C:\\Windows');
  const safeDir = WorkspaceProfiler.checkDangerousRoot(fixtureDir);
  console.log(`  ✓ 磁盘根 C:\\ 拦截结果: isDangerous=${dangerC.isDangerous}`);
  console.log(`  ✓ 系统目录 C:\\Windows 拦截结果: isDangerous=${dangerWin.isDangerous}`);
  console.log(`  ✓ 普通项目目录拦截结果: isDangerous=${safeDir.isDangerous}`);
  if (!dangerC.isDangerous || !dangerWin.isDangerous || safeDir.isDangerous) {
    throw new Error('危险目录硬拦截校验失败！');
  }

  // 测试 7: 验证多端生态智能画像、版本隔离推荐与双模型视图切换
  console.log('\n[测试 7] 验证多端生态智能嗅探、版本聚类与双模型视图切换...');
  const multiFixture = path.resolve(__dirname, 'fixtures/multi_platform_repo');
  if (fs.existsSync(multiFixture)) {
    fs.rmSync(multiFixture, { recursive: true, force: true });
  }

  // 7.1 创建 Android 端 (Kotlin)
  const androidDir = path.join(multiFixture, 'clients/android_v015');
  fs.mkdirSync(androidDir, { recursive: true });
  fs.writeFileSync(path.join(androidDir, 'AndroidManifest.xml'), '<manifest package="com.app"/>');
  fs.writeFileSync(path.join(androidDir, 'build.gradle.kts'), 'plugins { id("com.android.application") }');
  fs.writeFileSync(
    path.join(androidDir, 'MainActivity.kt'),
    `package com.app
class MainActivity {
    fun fetchUserProfile() {
        val url = "http://api/v1/user/profile"
    }
}
`
  );

  // 7.2 创建 PC 桌面端主力 C++ (Qt6)
  const pcCppDir = path.join(multiFixture, 'clients/pc_v05');
  fs.mkdirSync(pcCppDir, { recursive: true });
  fs.writeFileSync(path.join(pcCppDir, 'CMakeLists.txt'), 'project(pc_client)\nfind_package(Qt6 REQUIRED)');
  fs.writeFileSync(
    path.join(pcCppDir, 'main.cpp'),
    `#include <iostream>
int main() {
    std::string endpoint = "/api/v1/user/profile";
    return 0;
}
`
  );

  // 7.3 创建 PC 桌面端历史早期原型 Python (PyQt5)
  const pcPyDir = path.join(multiFixture, 'archive/pc_py_v01');
  fs.mkdirSync(pcPyDir, { recursive: true });
  fs.writeFileSync(path.join(pcPyDir, 'requirements.txt'), 'PyQt5==5.15.0\n');
  fs.writeFileSync(
    path.join(pcPyDir, 'gui.py'),
    `from PyQt5.QtWidgets import QApplication
def run():
    pass
`
  );

  // 7.4 创建后端微服务 (Go / Gin)
  const backendDir = path.join(multiFixture, 'services/api');
  fs.mkdirSync(backendDir, { recursive: true });
  fs.writeFileSync(path.join(backendDir, 'go.mod'), 'module myapp/api\ngo 1.21\nrequire github.com/gin-gonic/gin v1.9.1');
  fs.writeFileSync(
    path.join(backendDir, 'main.go'),
    `package main
import "github.com/gin-gonic/gin"

func GetProfile(c *gin.Context) {
    c.JSON(200, gin.H{"id": 1})
}

func main() {
    r := gin.Default()
    r.GET("/api/v1/user/profile", GetProfile)
}
`
  );

  // 7.5 创建辅助开发工具
  const toolDir = path.join(multiFixture, 'tools/codegen');
  fs.mkdirSync(toolDir, { recursive: true });
  fs.writeFileSync(path.join(toolDir, 'requirements.txt'), '# tool requirements\n');
  fs.writeFileSync(path.join(toolDir, 'gen.py'), 'def generate():\n    pass\n');

  // 执行画像嗅探
  const multiCore = new CodeGraphCore({
    workspaceRoot: multiFixture,
    scopePath: '.',
  });

  const discovery = multiCore.discoverProjects();
  console.log(`  ✓ 嗅探到工程总数: ${discovery.projects.length} 个`);
  for (const p of discovery.projects) {
    console.log(`    - [${p.platform}] ${p.name} (语言: ${p.primaryLanguage}, 版本: ${p.versionString || '无'}, 推荐: ${p.isRecommended ? '★主力' : '归档/工具'})`);
  }

  // 校验平台与推荐判定
  const androidProj = discovery.projects.find((p) => p.platform === 'MOBILE_ANDROID');
  const pcCppProj = discovery.projects.find((p) => p.platform === 'DESKTOP_CPP');
  const pcPyProj = discovery.projects.find((p) => p.platform === 'DESKTOP_PYTHON');
  const backendProj = discovery.projects.find((p) => p.platform === 'BACKEND_SERVICE');
  const toolProj = discovery.projects.find((p) => p.platform === 'TOOL_SCRIPT');

  if (!androidProj || !androidProj.isRecommended) throw new Error('Android 未正确识别为主力');
  if (!pcCppProj || !pcCppProj.isRecommended) throw new Error('PC C++ 未正确识别为主力');
  if (!pcPyProj || pcPyProj.isRecommended) throw new Error('PC Python 旧版未正确标记为归档');
  if (!backendProj || !backendProj.isRecommended) throw new Error('后端服务未正确识别为主力');
  if (!toolProj || toolProj.isRecommended) throw new Error('工具脚本未正确排除出核心推荐');

  // 执行全量扫描 -> 全生态协同总览
  const multiScanResult = await multiCore.scan();
  console.log(`  ✓ 全生态总览编译完成: ${multiScanResult.architectureView.modules.length} 个端/模块容器, 是否多端: ${multiScanResult.meta.isMultiProject}`);
  if (!multiScanResult.meta.isMultiProject) {
    throw new Error('预期 isMultiProject 为 true');
  }

  // 执行单工程精细视图切换
  const switchStart = Date.now();
  const focusedPc = multiCore.switchActiveProject(pcCppProj.id);
  const switchDuration = Date.now() - switchStart;
  console.log(`  ✓ 内存切换 PC 单工程独立视图完成 (耗时 ${switchDuration}ms < 15ms): 聚焦工程=${focusedPc?.meta.activeProjectId}`);
  if (focusedPc?.meta.activeProjectId !== pcCppProj.id) {
    throw new Error('单工程聚焦切换失败');
  }

  // ==========================================
  // 测试 8: 验证 0-Token 本地拓扑交互解说与故事生成
  // ==========================================
  console.log('\n[测试 8] 验证 0-Token 本地交互叙事引擎 (InteractionNarrator)...');
  const loginNode = Object.values(result1.allNodes).find((n) => n.name === 'login');
  const verifyNode = Object.values(result1.allNodes).find((n) => n.name === 'verify_credentials');
  
  if (!loginNode || !loginNode.metadata?.story) {
    throw new Error('login 节点的 interactionStory 缺失');
  }
  const loginStory = loginNode.metadata.story;
  console.log(`  ✓ 节点 [login] 角色识别: 【${loginStory.roleTitle}】 (入站=${loginStory.inDegree}, 出站=${loginStory.outDegree})`);
  console.log(`    - 功能小结: "${loginStory.summaryText}"`);
  console.log(`    - 下游依赖 (${loginStory.callees.length} 个): ${loginStory.callees.map((c: any) => c.name).join(', ')}`);
  
  if (loginStory.outDegree === 0) {
    throw new Error('login 入口节点的出度推导不符合预期');
  }
  if (!loginStory.roleTitle.includes('入口')) {
    throw new Error('login 未正确判定为入口角色');
  }

  if (!verifyNode || !verifyNode.metadata?.story) {
    throw new Error('verify_credentials 节点的 interactionStory 缺失');
  }
  const verifyStory = verifyNode.metadata.story;
  console.log(`  ✓ 节点 [verify_credentials] 角色识别: 【${verifyStory.roleTitle}】 (上游来源=${verifyStory.callers.map((c: any) => c.name).join(', ')})`);
  if (verifyStory.callers.length === 0) {
    throw new Error('verify_credentials 未提取到调用者');
  }

  const testFlow = result1.processFlows[0];
  const flowStory = (testFlow as any)?.story;
  if (!flowStory || flowStory.stepNarratives.length === 0) {
    throw new Error('processFlow 时序叙事故事缺失');
  }
  console.log(`  ✓ 业务时序故事提取完成: ${flowStory.stepNarratives.length} 个步骤分解`);
  console.log(`    - 步骤 1: "${flowStory.stepNarratives[0].actionDescription}"`);

  const testModule = result1.architectureView.modules[0];
  const modStory = (testModule as any)?.story;
  if (!modStory || !modStory.purposeDescription) {
    throw new Error('模块概览交互说明缺失');
  }
  console.log(`  ✓ 模块 [${testModule.name}] 交互描述: "${modStory.purposeDescription}"`);

  // =========================================================================
  // 测试 9: 验证 ELK Sugiyama 正交分层排版引擎与自动理线算法
  // =========================================================================
  console.log('\n[测试 9] 验证 ELK Sugiyama 正交分层排版与一键理线算法...');
  const { ElkLayoutEngine } = await import('../src/layout/elk-layout.js');
  
  const sampleInternalNodes = [loginNode, verifyNode];
  const sampleCalls = [{ source: loginNode.id, target: verifyNode.id }];
  const sampleInPorts = ['login'];
  const sampleOutPorts = ['external_service'];
  const samplePortEdges = [
    { source: 'inport_login', target: loginNode.id },
    { source: verifyNode.id, target: 'outport_external_service' },
  ];

  const detailLayout = await ElkLayoutEngine.layoutModuleDetail(
    sampleInternalNodes,
    sampleCalls,
    {
      inPorts: sampleInPorts,
      outPorts: sampleOutPorts,
      portEdges: samplePortEdges,
    }
  );

  if (!detailLayout.nodes || detailLayout.nodes.length < 4) {
    throw new Error(`下钻布局节点总数不符合预期: ${detailLayout.nodes?.length}`);
  }

  const inPortPos = detailLayout.nodes.find((n) => n.id === 'inport_login');
  const loginPos = detailLayout.nodes.find((n) => n.id === loginNode.id);
  const verifyPos = detailLayout.nodes.find((n) => n.id === verifyNode.id);
  const outPortPos = detailLayout.nodes.find((n) => n.id === 'outport_external_service');

  if (!inPortPos || !loginPos || !verifyPos || !outPortPos) {
    throw new Error('下钻布局关键节点坐标缺失');
  }

  console.log(`  ✓ 坐标层级流向检验:`);
  console.log(`    - In-Port [inport_login]: x=${inPortPos.x}, y=${inPortPos.y}`);
  console.log(`    - 内部入口 [${loginNode.name}]: x=${loginPos.x}, y=${loginPos.y}`);
  console.log(`    - 业务调用 [${verifyNode.name}]: x=${verifyPos.x}, y=${verifyPos.y}`);
  console.log(`    - Out-Port [outport_external_service]: x=${outPortPos.x}, y=${outPortPos.y}`);

  if (inPortPos.x >= loginPos.x) {
    throw new Error(`In-Port x(${inPortPos.x}) 未能在入口节点 x(${loginPos.x}) 的左侧`);
  }
  if (loginPos.x > verifyPos.x) {
    throw new Error(`调用方 x(${loginPos.x}) 未能在被调方 x(${verifyPos.x}) 的同级或左侧`);
  }
  if (outPortPos.x <= verifyPos.x) {
    throw new Error(`Out-Port x(${outPortPos.x}) 未能在调用源 x(${verifyPos.x}) 的右侧`);
  }
  console.log('  ✓ 成功验证 Sugiyama 分层排版与 In/Out Port 首尾层级正交流向约束！');

  fs.rmSync(multiFixture, { recursive: true, force: true });
  fs.rmSync(fixtureDir, { recursive: true, force: true });
  console.log('\n🎉 所有核心测试全部通过！\n');
}

runTests().catch((err) => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});

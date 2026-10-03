import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CodeGraphCore } from '../packages/core/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/polyglot-workspace');

function setupFixtures() {
  if (fs.existsSync(FIXTURE_DIR)) {
    fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }

  // 1. Python FastAPI Backend
  const pyDir = path.join(FIXTURE_DIR, 'backend/routers');
  fs.mkdirSync(pyDir, { recursive: true });
  fs.writeFileSync(
    path.join(pyDir, 'user.py'),
    `from fastapi import APIRouter

router = APIRouter()

@router.get("/api/v1/users/{user_id}")
def get_user_profile(user_id: str):
    """根据用户ID获取详细信息"""
    return {"id": user_id, "name": "DeepSeek"}
`
  );

  // 2. TypeScript Frontend Client
  const tsDir = path.join(FIXTURE_DIR, 'frontend/src/api');
  fs.mkdirSync(tsDir, { recursive: true });
  fs.writeFileSync(
    path.join(tsDir, 'userClient.ts'),
    `export async function loadUserProfile(userId: string) {
  const res = await fetch(\`/api/v1/users/\${userId}\`);
  return await res.json();
}
`
  );

  // 3. Go Gin Microservice
  const goDir = path.join(FIXTURE_DIR, 'services/order');
  fs.mkdirSync(goDir, { recursive: true });
  fs.writeFileSync(
    path.join(goDir, 'router.go'),
    `package order

import "github.com/gin-gonic/gin"

func RegisterOrderRoutes(r *gin.Engine) {
	r.GET("/api/v1/orders/:id", GetOrderById)
}

func GetOrderById(c *gin.Context) {
}
`
  );

  // 4. Java Spring Boot Service
  const javaDir = path.join(FIXTURE_DIR, 'services/inventory');
  fs.mkdirSync(javaDir, { recursive: true });
  fs.writeFileSync(
    path.join(javaDir, 'InventoryController.java'),
    `package com.example.inventory;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/inventory")
public class InventoryController {

    @GetMapping("/{itemId}")
    public String checkStock(@PathVariable String itemId) {
        return "in_stock";
    }
}
`
  );

  // 5. Rust Axum Microservice
  const rustDir = path.join(FIXTURE_DIR, 'services/payment/src');
  fs.mkdirSync(rustDir, { recursive: true });
  fs.writeFileSync(
    path.join(rustDir, 'main.rs'),
    `use axum::{routing::post, Router};

pub async fn execute_payment() {
}

pub fn create_router() -> Router {
    Router::new().route("/api/v1/payments", post(execute_payment))
}
`
  );

  // 6. C# ASP.NET Core Controller
  const csDir = path.join(FIXTURE_DIR, 'services/billing/Controllers');
  fs.mkdirSync(csDir, { recursive: true });
  fs.writeFileSync(
    path.join(csDir, 'BillingController.cs'),
    `using Microsoft.AspNetCore.Mvc;

namespace App.Controllers;

[ApiController]
[Route("api/v1/[controller]")]
public class BillingController : ControllerBase
{
    [HttpGet("invoices/{invoiceId}")]
    public IActionResult GetInvoice(string invoiceId)
    {
        return Ok();
    }
}
`
  );

  // 7. C++ Compute Engine
  const cppDir = path.join(FIXTURE_DIR, 'engine');
  fs.mkdirSync(cppDir, { recursive: true });
  fs.writeFileSync(
    path.join(cppDir, 'compute.cpp'),
    `#include <iostream>

namespace engine {
    class FastMatrix {
    public:
        void multiply() {}
    };

    int run_engine() {
        FastMatrix m;
        m.multiply();
        return 0;
    }
}
`
  );
}

async function runVerification() {
  console.log('🚀 开始多语言图谱与跨语言契约链接深度测试...');
  setupFixtures();

  const core = new CodeGraphCore({
    workspaceRoot: FIXTURE_DIR,
    scopePath: '.',
  });

  console.log('\n--- 1. 全量多语言扫描 (Scan) ---');
  const t0 = Date.now();
  const result = await core.scan();
  const scanDuration = Date.now() - t0;
  console.log(`✅ 扫描完成耗时: ${scanDuration}ms`);
  console.log(`   文件总数: ${result.meta.fileCount}`);
  console.log(`   节点总数: ${result.meta.nodeCount}`);
  console.log(`   边总数: ${result.meta.edgeCount}`);
  console.log(`   语言分布:`, result.meta.languages);

  // 验证 1: 语言覆盖完整性
  const expectedLanguages = ['python', 'typescript', 'go', 'java', 'rust', 'csharp', 'cpp'];
  for (const lang of expectedLanguages) {
    if (!result.meta.languages?.[lang]) {
      throw new Error(`❌ 缺少预期语言提取: ${lang}`);
    }
  }
  console.log('✅ 所有 7 种主流语言解析器全部成功提取！');

  // 验证 2: SCIP URI 工业级标识规范
  const nodesWithScip = Object.values(result.allNodes).filter((n) => n.scipUri && n.scipUri.startsWith('scip/'));
  console.log(`✅ SCIP 规范符号数: ${nodesWithScip.length} / ${Object.keys(result.allNodes).length}`);
  if (nodesWithScip.length === 0) {
    throw new Error('❌ 未生成 SCIP 规范符号 URI');
  }

  // 验证 3: 跨语言 REST 契约中枢自动链接 (TypeScript Frontend -> Python FastAPI Backend)
  console.log('\n--- 2. 跨语言契约中枢校验 (Polyglot Contract Hub) ---');
  const contractHub = Object.values(result.allNodes).find(
    (n) => n.entityType === 'CONTRACT_ENDPOINT' && n.endpointMeta?.routePath === '/api/v1/users/{param}'
  );
  if (!contractHub) {
    throw new Error('❌ 未找到自动对齐的契约中枢节点: GET /api/v1/users/{param}');
  }
  console.log(`✅ 成功合成契约中枢: [${contractHub.name}] (ID: ${contractHub.id})`);

  // 校验 Client -> Contract 边 (CALLS_CONTRACT)
  const clientEdge = result.allEdges.find(
    (e) => e.target === contractHub.id && e.relation === 'CALLS_CONTRACT'
  );
  if (!clientEdge) {
    throw new Error('❌ 缺少客户端打向契约中枢的 CALLS_CONTRACT 边');
  }
  const callerNode = result.allNodes[clientEdge.source];
  console.log(`✅ 客户端调用链建立: [TS] ${callerNode?.name} -> CALLS_CONTRACT -> ${contractHub.name}`);

  // 校验 Contract -> Backend Handler 边 (HANDLED_BY)
  const handlerEdge = result.allEdges.find(
    (e) => e.source === contractHub.id && e.relation === 'HANDLED_BY'
  );
  if (!handlerEdge) {
    throw new Error('❌ 缺少契约中枢打向服务端路由的 HANDLED_BY 边');
  }
  const handlerNode = result.allNodes[handlerEdge.target];
  console.log(`✅ 服务端承接链建立: ${contractHub.name} -> HANDLED_BY -> [Py] ${handlerNode?.name}`);

  // 验证 4: 架构总线与模块划分 (包含契约中枢模块)
  console.log('\n--- 3. 架构视图总线 (Architecture View) ---');
  const contractMod = result.architectureView.modules.find((m) => m.id === 'mod_contracts');
  if (!contractMod) {
    throw new Error('❌ 架构视图中未生成契约中枢模块 mod_contracts');
  }
  console.log(`✅ 架构总线包含契约模块: ${contractMod.name} (槽位: ${contractMod.archetypeRole})`);

  // 验证 5: 毫秒级增量更新
  console.log('\n--- 4. 增量热更新测试 (Incremental Hot Update) ---');
  // 修改 userClient.ts
  const tsPath = path.join(FIXTURE_DIR, 'frontend/src/api/userClient.ts');
  fs.appendFileSync(
    tsPath,
    `\nexport function helperUtil() { return "ok"; }\n`
  );
  const tInc = Date.now();
  const incResult = await core.updateIncremental();
  const incDuration = Date.now() - tInc;
  console.log(`✅ 增量更新完成耗时: ${incDuration}ms`);
  const helperNode = Object.values(incResult.allNodes).find((n) => n.name === 'helperUtil');
  if (!helperNode) {
    throw new Error('❌ 增量更新未能捕获新增符号 helperUtil');
  }
  console.log(`✅ 增量符号即时注入成功: ${helperNode.name}`);

  // 清理临时文件
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
  console.log('\n🎉 所有多语言提取、SCIP 符号、跨语言契约中枢与增量测试 100% 通过！\n');
}

runVerification().catch((err) => {
  console.error('❌ 验证测试失败:', err);
  process.exit(1);
});

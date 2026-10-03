/**
 * 统一抽象语义图 (UASG) 与图谱数据模型定义
 */

export type EntityType = 
  | 'MODULE' 
  | 'FILE' 
  | 'CLASS' 
  | 'INTERFACE' 
  | 'FUNCTION' 
  | 'METHOD' 
  | 'ENDPOINT';

export type SemanticRole = 
  | 'ENTRY'       // 外部入口 (Web路由/CLI/事件)
  | 'SERVICE'     // 业务领域/服务逻辑
  | 'REPOSITORY'  // 数据访问/持久化
  | 'MODEL'       // 数据模型/DTO
  | 'INFRA'       // 基础设施/第三方存储/中间件
  | 'UTIL'        // 通用辅助工具
  | 'UNKNOWN';

export type RelationType = 
  | 'CONTAINS'    // 层次包含 (Module -> File -> Class -> Function)
  | 'CALLS'       // 函数调用
  | 'IMPORTS'     // 模块/文件导入
  | 'EXTENDS'     // 类继承
  | 'IMPLEMENTS'  // 接口实现
  | 'READS_WRITES'// 读写共享状态
  | 'FLOWS_TO';   // 业务时序指向

export interface SourceLocation {
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
}

export interface CodeNode {
  id: string;                      // 唯一ID (如: src_api_auth_py_login)
  name: string;                    // 符号短名 (如: login)
  qualifiedName: string;           // 完整路径限定名 (如: src.api.auth.login)
  entityType: EntityType;
  semanticRole: SemanticRole;
  filePath: string;                // 相对工作区路径
  loc: SourceLocation;
  signature?: string;              // 函数或类签名 (如: def login(dto: LoginDTO))
  docstring?: string;              // 提取的文档注释
  metadata?: Record<string, any>;  // 额外元数据 (如 HTTP 方法, 路由路径)
}

export interface CodeEdge {
  id: string;
  source: string;                  // Node ID
  target: string;                  // Node ID
  relation: RelationType;
  sourceLine?: number;
  confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
  weight?: number;                 // 调用频次或关联强度
  isMainline?: boolean;            // 是否属于业务主干流
}

export interface ModuleContainer {
  id: string;
  name: string;
  files: string[];
  inPorts: string[];               // 外部打入本模块的虚拟入口端口
  outPorts: string[];              // 本模块向外调用的虚拟出口端口
  archetypeRole?: string;          // 在预置架构中的槽位 (如 Presentation, Domain, Data)
}

export interface ModuleBus {
  id: string;
  sourceModule: string;
  targetModule: string;
  callCount: number;
  symbols: Array<{ sourceSymbol: string; targetSymbol: string; line: number }>;
}

export interface ProcessFlowStep {
  id: string;
  nodeId: string;
  name: string;
  stepType: 'ENTRY' | 'STEP' | 'DECISION' | 'STORE' | 'OUTPUT';
  module: string;
  filePath: string;
  line: number;
  condition?: string;
}

export interface ProcessFlow {
  flowId: string;
  entryPointNodeId: string;
  title: string;
  steps: ProcessFlowStep[];
  edges: Array<{ source: string; target: string; condition?: string }>;
}

export type ArchetypeType = 
  | 'WEB_LAYERED'       // Web 三层/分层架构 (FastAPI, Flask, Django)
  | 'WORKER_PIPELINE'   // 任务队列/事件管道 (Celery, Kafka, Redis)
  | 'CLI_PIPELINE'      // 命令行/数据流水线 (Click, Typer)
  | 'LIBRARY_SDK'       // 核心库与 SDK 模式
  | 'UNIVERSAL';        // 通用自适应拓扑 (兜底)

export interface ArchetypeMatchResult {
  archetype: ArchetypeType;
  confidence: number;
  matchedRules: string[];
  slots?: Record<string, string[]>; // 层级/槽位名 -> 匹配到的文件列表
}

export interface ArchetypeHealthResult {
  passed: boolean;
  score: number;                   // 综合健康度得分 H (0 ~ 1.0)
  slotFillRatio: number;           // S_fill
  flowConcordanceRatio: number;    // S_flow
  symbolCoverageRatio: number;     // S_coverage
  reasons: string[];
}

export interface FullGraphResult {
  meta: {
    projectName: string;
    scopePath: string;
    generatedAt: string;
    archetype: ArchetypeType;
    archetypeHealth?: ArchetypeHealthResult;
    isAutoCorrected: boolean;
    fileCount: number;
    nodeCount: number;
    edgeCount: number;
  };
  architectureView: {
    modules: ModuleContainer[];
    buses: ModuleBus[];
  };
  processFlows: ProcessFlow[];
  allNodes: Record<string, CodeNode>;
  allEdges: CodeEdge[];
}

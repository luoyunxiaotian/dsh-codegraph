import _Graph from 'graphology';
const Graph = ((_Graph as any).default || _Graph) as any;
import _louvain from 'graphology-communities-louvain';
const louvain = ((_louvain as any).default || _louvain) as (graph: any) => Record<string, number>;
import {
  CodeNode,
  CodeEdge,
  FullGraphResult,
  ModuleContainer,
  ModuleBus,
  ProcessFlow,
  ProcessFlowStep,
  ArchetypeType,
  DetectedProjectProfile,
  ProjectPlatform,
} from '../types/index.js';
import { ArchetypeEngine } from '../archetype/detector.js';

export interface CompileOptions {
  projects?: DetectedProjectProfile[];
  activeProjectId?: string;
}

export class DualModelCompiler {
  /**
   * 编译全局图谱：支持快通道装配、装配一致性健康校验与自动纠错回滚及多端生态分层
   */
  public static compile(
    projectName: string,
    scopePath: string,
    fileList: string[],
    nodes: CodeNode[],
    edges: CodeEdge[],
    initialArchetype: ArchetypeType = 'UNIVERSAL',
    options?: CompileOptions
  ): FullGraphResult {
    let currentArchetype = initialArchetype;
    let isAutoCorrected = false;

    let targetNodes = nodes;
    let targetEdges = edges;
    let targetFileList = fileList;

    const activeProjectId = options?.activeProjectId;
    const isSingleProjectView = Boolean(activeProjectId && activeProjectId !== 'all');

    if (isSingleProjectView) {
      // 过滤出该子工程的专属节点及与其有交互的契约节点
      const projNodeIds = new Set(
        nodes.filter((n) => n.projectId === activeProjectId).map((n) => n.id)
      );

      const contractNodeIds = new Set<string>();
      for (const e of edges) {
        if (projNodeIds.has(e.source)) {
          const tgt = nodes.find((n) => n.id === e.target);
          if (tgt && tgt.semanticRole === 'CONTRACT') {
            contractNodeIds.add(tgt.id);
          }
        }
        if (projNodeIds.has(e.target)) {
          const src = nodes.find((n) => n.id === e.source);
          if (src && src.semanticRole === 'CONTRACT') {
            contractNodeIds.add(src.id);
          }
        }
      }

      const allowedNodeIds = new Set([...projNodeIds, ...contractNodeIds]);
      targetNodes = nodes.filter((n) => allowedNodeIds.has(n.id));
      targetEdges = edges.filter(
        (e) => allowedNodeIds.has(e.source) && allowedNodeIds.has(e.target)
      );

      const targetFileSet = new Set(targetNodes.map((n) => n.filePath));
      targetFileList = fileList.filter((f) => targetFileSet.has(f));
    }

    // 1. 如果初判为特定原型，先分配槽位语义角色
    if (currentArchetype !== 'UNIVERSAL') {
      this.assignArchetypeRoles(targetNodes);
    }

    // 2. 执行装配后一致性审计闸门 (Verify Gate)
    const health = ArchetypeEngine.verifyPostAssemblyHealth(currentArchetype, targetNodes, targetEdges);
    if (!health.passed) {
      // 触发自动纠错与无缝降级回退！
      currentArchetype = 'UNIVERSAL';
      isAutoCorrected = true;
    }

    // 3. 构建模型 1：宏观架构总线视图
    const architectureView = this.buildArchitectureView(
      targetFileList,
      targetNodes,
      targetEdges,
      currentArchetype,
      options?.projects,
      activeProjectId
    );

    // 4. 构建模型 2：入口时序业务流程视图
    const processFlows = this.buildProcessFlows(targetNodes, targetEdges);

    const allNodesMap: Record<string, CodeNode> = {};
    const languages: Record<string, number> = {};
    for (const n of targetNodes) {
      allNodesMap[n.id] = n;
      if (n.language && n.language !== 'contract') {
        languages[n.language] = (languages[n.language] || 0) + 1;
      }
    }

    const isMultiProject = Boolean(options?.projects && options.projects.length > 1);

    return {
      meta: {
        projectName,
        scopePath,
        generatedAt: new Date().toISOString(),
        archetype: currentArchetype,
        archetypeHealth: health,
        isAutoCorrected,
        fileCount: targetFileList.length,
        nodeCount: targetNodes.length,
        edgeCount: targetEdges.length,
        languages,
        projects: options?.projects,
        activeProjectId: isSingleProjectView ? activeProjectId : undefined,
        isMultiProject,
      },
      architectureView,
      processFlows,
      allNodes: allNodesMap,
      allEdges: targetEdges,
    };
  }

  /**
   * 根据原型规则为节点打上语义角色标签
   */
  private static assignArchetypeRoles(nodes: CodeNode[]): void {
    for (const n of nodes) {
      const lowerPath = n.filePath.toLowerCase();
      if (/(router|controller|api|view|endpoint)/.test(lowerPath) || n.entityType === 'ENDPOINT') {
        n.semanticRole = 'ENTRY';
      } else if (/(service|usecase|biz|domain|handler)/.test(lowerPath)) {
        n.semanticRole = 'SERVICE';
      } else if (/(dao|repo|repository|crud|store|db)/.test(lowerPath)) {
        n.semanticRole = 'REPOSITORY';
      } else if (/(model|schema|dto|entity)/.test(lowerPath)) {
        n.semanticRole = 'MODEL';
      } else if (/(util|helper|common|tool)/.test(lowerPath)) {
        n.semanticRole = 'UTIL';
      }
    }
  }

  /**
   * 构建模型 1：模块容器、依赖总线与虚拟端口 (支持多端生态聚合与单工程精细视图)
   */
  private static buildArchitectureView(
    fileList: string[],
    nodes: CodeNode[],
    edges: CodeEdge[],
    archetype: ArchetypeType,
    projects?: DetectedProjectProfile[],
    activeProjectId?: string
  ): { modules: ModuleContainer[]; buses: ModuleBus[] } {
    const modules: ModuleContainer[] = [];
    const fileToModuleMap = new Map<string, string>(); // filePath -> moduleId

    const isMultiProjectOverview = Boolean(
      projects && projects.length > 1 && (!activeProjectId || activeProjectId === 'all')
    );

    const activeProfile = activeProjectId ? projects?.find((p) => p.id === activeProjectId) : undefined;

    if (isMultiProjectOverview && projects) {
      // 方案 C: 全端生态多工程协同视图 (按端/工程划分清晰隔离容器)
      for (const proj of projects) {
        const projFiles = fileList.filter((f) => {
          if (proj.relPath === '.') return true;
          return f === proj.relPath || f.startsWith(proj.relPath + '/');
        });

        if (projFiles.length === 0) continue;

        if (projFiles.length <= 12) {
          const modId = `mod_proj_${proj.id}`;
          for (const f of projFiles) {
            fileToModuleMap.set(f, modId);
          }
          modules.push({
            id: modId,
            name: `${proj.name}${proj.versionString ? ` (${proj.versionString})` : ''}`,
            files: projFiles,
            inPorts: [],
            outPorts: [],
            archetypeRole: proj.recommendReason || 'Subproject',
            projectId: proj.id,
            projectPlatform: proj.platform,
          });
        } else {
          // 子工程规模较大时，按其内部一级子目录划分模块
          const subGroups = new Map<string, string[]>();
          for (const f of projFiles) {
            const relToProj = proj.relPath === '.' ? f : f.slice(proj.relPath.length + 1);
            const segs = relToProj.split('/');
            const subName = segs.length > 1 ? segs[0] : 'core';
            const list = subGroups.get(subName) || [];
            list.push(f);
            subGroups.set(subName, list);
          }

          for (const [subName, sFiles] of subGroups.entries()) {
            const modId = `mod_${proj.id}_${subName}`;
            for (const f of sFiles) {
              fileToModuleMap.set(f, modId);
            }
            modules.push({
              id: modId,
              name: `[${proj.name}] ${subName}`,
              files: sFiles,
              inPorts: [],
              outPorts: [],
              archetypeRole: proj.recommendReason || 'Subproject',
              projectId: proj.id,
              projectPlatform: proj.platform,
            });
          }
        }
      }

      // 检查是否有未被子工程捕获的根目录零散文件
      const unmapped = fileList.filter((f) => !fileToModuleMap.has(f) && !f.startsWith('contracts/'));
      if (unmapped.length > 0) {
        const modId = 'mod_root_shared';
        for (const f of unmapped) {
          fileToModuleMap.set(f, modId);
        }
        modules.push({
          id: modId,
          name: 'Root Shared Files',
          files: unmapped,
          inPorts: [],
          outPorts: [],
          archetypeRole: 'Shared',
        });
      }
    } else if (archetype === 'UNIVERSAL') {
      const g = new Graph({ type: 'undirected' });
      for (const f of fileList) {
        g.addNode(f);
      }

      // 统计文件间调用作为边的权重
      const nodeToFileMap = new Map<string, string>();
      for (const n of nodes) {
        nodeToFileMap.set(n.id, n.filePath);
      }

      for (const e of edges) {
        if (e.relation === 'CALLS' || e.relation === 'IMPORTS' || e.relation === 'EXTENDS' || e.relation === 'IMPLEMENTS') {
          const srcFile = nodeToFileMap.get(e.source);
          const tgtFile = nodeToFileMap.get(e.target);
          if (srcFile && tgtFile && srcFile !== tgtFile && g.hasNode(srcFile) && g.hasNode(tgtFile)) {
            const relWeight = e.relation === 'EXTENDS' ? 3 : e.relation === 'CALLS' ? 2 : 1;
            if (g.hasEdge(srcFile, tgtFile)) {
              const prevW = g.getEdgeAttribute(srcFile, tgtFile, 'weight') || 1;
              g.setEdgeAttribute(srcFile, tgtFile, 'weight', prevW + relWeight);
            } else {
              g.addEdge(srcFile, tgtFile, { weight: relWeight });
            }
          }
        }
      }

      const communities = louvain(g) as Record<string, number>;
      const communityGroups = new Map<number, string[]>();
      for (const [file, commId] of Object.entries(communities)) {
        const numId = Number(commId);
        const list = communityGroups.get(numId) || [];
        list.push(file);
        communityGroups.set(numId, list);
      }

      for (const [commId, files] of communityGroups.entries()) {
        const modId = `mod_community_${commId}`;
        for (const f of files) {
          fileToModuleMap.set(f, modId);
        }
        modules.push({
          id: modId,
          name: this.generateModuleName(files),
          files,
          inPorts: [],
          outPorts: [],
          archetypeRole: 'Community',
          projectId: activeProjectId,
          projectPlatform: activeProfile?.platform,
        });
      }
    } else {
      // 方案 B: 依据原型槽位快速分组 (如 Presentation, Domain, Data, Utils)
      const slotFiles: Record<string, string[]> = {
        'Presentation Layer (API)': [],
        'Domain Layer (Services)': [],
        'Data Layer (Models & DB)': [],
        'Common & Utils': [],
      };

      for (const f of fileList) {
        const lower = f.toLowerCase();
        if (/(router|controller|api|endpoint)/.test(lower)) {
          slotFiles['Presentation Layer (API)'].push(f);
          fileToModuleMap.set(f, 'mod_presentation');
        } else if (/(service|usecase|domain|handler|biz)/.test(lower)) {
          slotFiles['Domain Layer (Services)'].push(f);
          fileToModuleMap.set(f, 'mod_domain');
        } else if (/(model|schema|dao|repo|entity|db)/.test(lower)) {
          slotFiles['Data Layer (Models & DB)'].push(f);
          fileToModuleMap.set(f, 'mod_data');
        } else {
          slotFiles['Common & Utils'].push(f);
          fileToModuleMap.set(f, 'mod_utils');
        }
      }

      for (const [slotName, files] of Object.entries(slotFiles)) {
        if (files.length > 0) {
          const modId = fileToModuleMap.get(files[0]) || `mod_${slotName}`;
          modules.push({
            id: modId,
            name: slotName,
            files,
            inPorts: [],
            outPorts: [],
            archetypeRole: slotName,
            projectId: activeProjectId,
            projectPlatform: activeProfile?.platform,
          });
        }
      }
    }

    // 统计跨语言契约中枢模块 (Contract Hub Module)
    const hasContractNodes = nodes.some((n) => n.semanticRole === 'CONTRACT');
    if (hasContractNodes) {
      fileToModuleMap.set('contracts/rest-api', 'mod_contracts');
      fileToModuleMap.set('contracts/topics', 'mod_contracts');
      modules.push({
        id: 'mod_contracts',
        name: 'API Contracts & Hubs',
        files: ['contracts/rest-api', 'contracts/topics'],
        inPorts: [],
        outPorts: [],
        archetypeRole: 'Contract Hub',
      });
    }

    // 统计跨模块调用总线 (Buses) 与虚拟端口 (In/Out Ports)
    const nodeToFile = new Map<string, string>();
    const nodeNameMap = new Map<string, string>();
    for (const n of nodes) {
      nodeToFile.set(n.id, n.filePath);
      nodeNameMap.set(n.id, n.name);
    }

    const busMap = new Map<string, ModuleBus>();
    const moduleObjMap = new Map<string, ModuleContainer>();
    for (const m of modules) {
      moduleObjMap.set(m.id, m);
    }

    for (const e of edges) {
      if (
        e.relation === 'CALLS' ||
        e.relation === 'IMPORTS' ||
        e.relation === 'EXTENDS' ||
        e.relation === 'IMPLEMENTS' ||
        e.relation === 'CALLS_CONTRACT' ||
        e.relation === 'HANDLED_BY' ||
        e.relation === 'PUBLISHES' ||
        e.relation === 'SUBSCRIBES'
      ) {
        const srcFile = nodeToFile.get(e.source);
        const tgtFile = nodeToFile.get(e.target);
        if (!srcFile || !tgtFile) continue;

        const srcModId = fileToModuleMap.get(srcFile);
        const tgtModId = fileToModuleMap.get(tgtFile);

        // 如果调用/依赖跨越了模块边界
        if (srcModId && tgtModId && srcModId !== tgtModId) {
          const busKey = `${srcModId}-->${tgtModId}`;
          let bus = busMap.get(busKey);
          if (!bus) {
            bus = {
              id: `bus_${srcModId}_${tgtModId}`,
              sourceModule: srcModId,
              targetModule: tgtModId,
              callCount: 0,
              symbols: [],
            };
            busMap.set(busKey, bus);
          }

          const srcSymName = nodeNameMap.get(e.source) || e.source;
          const tgtSymName = nodeNameMap.get(e.target) || e.target;
          bus.callCount++;
          bus.symbols.push({
            sourceSymbol: srcSymName,
            targetSymbol: tgtSymName,
            line: e.sourceLine || 0,
          });

          // 记录源模块的 Out-Port 与目标模块的 In-Port
          const srcMod = moduleObjMap.get(srcModId);
          if (srcMod && !srcMod.outPorts.includes(tgtSymName)) {
            srcMod.outPorts.push(tgtSymName);
          }
          const tgtMod = moduleObjMap.get(tgtModId);
          if (tgtMod && !tgtMod.inPorts.includes(tgtSymName)) {
            tgtMod.inPorts.push(tgtSymName);
          }
        }
      }
    }

    return {
      modules,
      buses: Array.from(busMap.values()),
    };
  }

  /**
   * 构建模型 2：提取基于入口的业务时序流程 (Execution Flows)
   */
  private static buildProcessFlows(nodes: CodeNode[], edges: CodeEdge[]): ProcessFlow[] {
    const processFlows: ProcessFlow[] = [];

    // 邻接表: caller -> callee list
    const adj = new Map<string, string[]>();
    const inDegreeMap = new Map<string, number>();

    for (const e of edges) {
      if (
        e.relation === 'CALLS' ||
        e.relation === 'CALLS_CONTRACT' ||
        e.relation === 'HANDLED_BY' ||
        e.relation === 'PUBLISHES' ||
        e.relation === 'SUBSCRIBES'
      ) {
        const list = adj.get(e.source) || [];
        list.push(e.target);
        adj.set(e.source, list);

        inDegreeMap.set(e.target, (inDegreeMap.get(e.target) || 0) + 1);
      }
    }

    const nodeMap = new Map<string, CodeNode>();
    for (const n of nodes) {
      nodeMap.set(n.id, n);
    }

    // 1. 第一优先级候选入口：标记为 ENTRY / ENDPOINT 的函数或方法，或标准入口名称
    const isExplicitEntry = (n: CodeNode) => {
      if (n.entityType !== 'FUNCTION' && n.entityType !== 'METHOD' && n.entityType !== 'ENDPOINT') {
        return false;
      }
      return (
        n.semanticRole === 'ENTRY' ||
        n.entityType === 'ENDPOINT' ||
        /(main|cli|run|start|entrypoint|execute|dispatch|pipeline|solve|bootstrap|handler)/i.test(n.name)
      );
    };

    let entryCandidates = nodes.filter(isExplicitEntry);

    // 2. 第二优先级候选入口：高调用出度 (Fan-out) 业务编排函数
    const eligibleFunctions = nodes.filter(
      (n) => n.entityType === 'FUNCTION' || n.entityType === 'METHOD'
    );

    // 根据 (出度 - 入度/2) 排序，出度高、入度低的函数最可能是顶层业务编排入口
    const scoredFunctions = eligibleFunctions
      .map((n) => {
        const outDeg = (adj.get(n.id) || []).length;
        const inDeg = inDegreeMap.get(n.id) || 0;
        return { node: n, outDeg, score: outDeg * 2 - inDeg };
      })
      .filter((item) => item.outDeg > 0)
      .sort((a, b) => b.score - a.score);

    for (const item of scoredFunctions) {
      if (entryCandidates.length >= 12) break;
      if (!entryCandidates.some((c) => c.id === item.node.id)) {
        entryCandidates.push(item.node);
      }
    }

    // 高频噪音辅助函数黑名单过滤
    const noiseNames = new Set([
      'logger', 'print', 'info', 'debug', 'error', 'format', 'get', 'dumps', 'loads',
      'str', 'int', 'len', 'isinstance', 'hasattr', 'getattr', 'setattr'
    ]);

    // 3. 构建时序步骤
    for (const entry of entryCandidates.slice(0, 15)) {
      const steps: ProcessFlowStep[] = [];
      const flowEdges: Array<{ source: string; target: string; condition?: string }> = [];

      const visited = new Set<string>();
      let stepCounter = 1;

      const queue: Array<{ nodeId: string; parentStepId?: string }> = [{ nodeId: entry.id }];
      visited.add(entry.id);

      const entryStepId = `step_1`;
      steps.push({
        id: entryStepId,
        nodeId: entry.id,
        name: entry.name,
        stepType: 'ENTRY',
        module: entry.filePath.split('/')[0] || 'app',
        filePath: entry.filePath,
        line: entry.loc.startLine,
      });

      const nodeStepMap = new Map<string, string>();
      nodeStepMap.set(entry.id, entryStepId);

      while (queue.length > 0) {
        const { nodeId, parentStepId } = queue.shift()!;
        const callees = adj.get(nodeId) || [];

        for (const calleeId of callees) {
          const calleeNode = nodeMap.get(calleeId);
          if (!calleeNode) continue;

          // 噪音降噪过滤
          if (noiseNames.has(calleeNode.name.toLowerCase())) continue;

          if (!visited.has(calleeId)) {
            visited.add(calleeId);
            stepCounter++;
            const stepId = `step_${stepCounter}`;

            const isStore =
              calleeNode.semanticRole === 'REPOSITORY' ||
              /(dao|repo|store|db|model|entity|crud|sql|redis|cache)/i.test(
                calleeNode.filePath + calleeNode.name
              );
            const isDecision = /(check|verify|validate|auth|is_|has_|filter|guard)/i.test(
              calleeNode.name
            );
            const isOutput = /(response|send|render|export|format|return|emit|publish|notify)/i.test(
              calleeNode.name
            );

            const stepType = isStore
              ? 'STORE'
              : isDecision
              ? 'DECISION'
              : isOutput
              ? 'OUTPUT'
              : 'STEP';

            steps.push({
              id: stepId,
              nodeId: calleeNode.id,
              name: calleeNode.name,
              stepType,
              module: calleeNode.filePath.split('/')[0] || 'app',
              filePath: calleeNode.filePath,
              line: calleeNode.loc.startLine,
            });
            nodeStepMap.set(calleeId, stepId);

            const currParent = parentStepId || nodeStepMap.get(nodeId);
            if (currParent) {
              flowEdges.push({ source: currParent, target: stepId });
            }

            if (steps.length < 12) {
              queue.push({ nodeId: calleeId, parentStepId: stepId });
            }
          }
        }
      }

      if (steps.length > 1) {
        processFlows.push({
          flowId: `flow_${entry.name}`,
          entryPointNodeId: entry.id,
          title: `流程: ${entry.name}`,
          steps,
          edges: flowEdges,
        });
      }
    }

    // 4. 兜底保障：若依然无流程 (如静态库/声明式代码/仅有跨文件引用)，基于核心调用与导入依赖链合成执行主链路
    if (processFlows.length === 0) {
      const interactionEdges = edges.filter(
        (e) => e.relation === 'CALLS' || e.relation === 'IMPORTS' || e.relation === 'EXTENDS'
      );

      if (interactionEdges.length > 0) {
        const synthSteps: ProcessFlowStep[] = [];
        const synthEdges: Array<{ source: string; target: string; condition?: string }> = [];
        const addedNodeIds = new Set<string>();

        for (let i = 0; i < Math.min(interactionEdges.length, 6); i++) {
          const e = interactionEdges[i];
          const srcNode = nodeMap.get(e.source);
          const tgtNode = nodeMap.get(e.target);
          if (!srcNode || !tgtNode) continue;

          if (!addedNodeIds.has(srcNode.id)) {
            addedNodeIds.add(srcNode.id);
            synthSteps.push({
              id: `step_${synthSteps.length + 1}`,
              nodeId: srcNode.id,
              name: srcNode.name,
              stepType: synthSteps.length === 0 ? 'ENTRY' : 'STEP',
              module: srcNode.filePath.split('/')[0] || 'core',
              filePath: srcNode.filePath,
              line: srcNode.loc.startLine,
            });
          }

          if (!addedNodeIds.has(tgtNode.id)) {
            addedNodeIds.add(tgtNode.id);
            const isStore = /(repo|dao|db|model|entity|store)/i.test(tgtNode.filePath + tgtNode.name);
            synthSteps.push({
              id: `step_${synthSteps.length + 1}`,
              nodeId: tgtNode.id,
              name: tgtNode.name,
              stepType: isStore ? 'STORE' : 'STEP',
              module: tgtNode.filePath.split('/')[0] || 'core',
              filePath: tgtNode.filePath,
              line: tgtNode.loc.startLine,
            });
          }

          const sStep = synthSteps.find((s) => s.nodeId === srcNode.id);
          const tStep = synthSteps.find((s) => s.nodeId === tgtNode.id);
          if (sStep && tStep && sStep.id !== tStep.id) {
            if (!synthEdges.some((edge) => edge.source === sStep.id && edge.target === tStep.id)) {
              synthEdges.push({ source: sStep.id, target: tStep.id });
            }
          }
        }

        if (synthSteps.length >= 2) {
          processFlows.push({
            flowId: `flow_system_mainline`,
            entryPointNodeId: synthSteps[0].nodeId,
            title: `流程: 核心调用依赖主链路`,
            steps: synthSteps,
            edges: synthEdges,
          });
        }
      }
    }

    return processFlows;
  }

  private static generateModuleName(files: string[]): string {
    const dirMap = new Map<string, number>();
    for (const f of files) {
      const parts = f.split(/[/\\]/);
      const dir = parts.length > 1 ? parts[0] : 'root';
      dirMap.set(dir, (dirMap.get(dir) || 0) + 1);
    }
    let topDir = 'Module';
    let max = 0;
    for (const [d, count] of dirMap.entries()) {
      if (count > max) {
        max = count;
        topDir = d;
      }
    }
    return topDir.charAt(0).toUpperCase() + topDir.slice(1) + ' Community';
  }
}

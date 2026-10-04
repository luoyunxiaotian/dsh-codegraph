import {
  CodeNode,
  CodeEdge,
  ProcessFlow,
  ModuleContainer,
  ModuleBus,
  FullGraphResult,
  NodeInteractionStory,
  InteractionCaller,
  InteractionCallee,
  InteractionContract,
  FlowInteractionStory,
  ModuleInteractionStory,
  RelationType,
} from '../types/index.js';

/**
 * 本地 0-Token 架构交互叙事引擎 (Local Topological Narrative Engine)
 * 基于 AST 语义角色、拓扑出入度、原生代码注释与模板化规则自然语言生成 (Rule-based NLG)，
 * 为架构模块、时序步骤与符号卡片提供通俗易懂的交互解释与角色说明。
 */
export class InteractionNarrator {
  /**
   * 清洗并提取原生代码注释中的首句/核心摘要 (Python docstring, JSDoc, C# XML 等)
   */
  public static cleanDocstring(raw?: string): string | undefined {
    if (!raw) return undefined;
    let text = raw.trim();

    // 剥离 C# XML <summary> ... </summary>
    text = text.replace(/<\/?summary>/gi, '');
    text = text.replace(/<\/?param[^>]*>/gi, '');
    text = text.replace(/<\/?returns[^>]*>/gi, '');
    text = text.replace(/^\/\/\/\s*/gm, '');

    // 剥离 JSDoc / C-style /** ... */
    text = text.replace(/^\/\*\*|\*\/$/g, '');
    text = text.replace(/^\s*\*\s?/gm, '');
    text = text.replace(/@param.*$/gm, '');
    text = text.replace(/@return.*$/gm, '');

    // 剥离 Python """ ... """ 或 ''' ... '''
    text = text.replace(/^["']{3}|["']{3}$/g, '');

    // 压缩多余空白换行
    text = text.split('\n').map((l) => l.trim()).filter(Boolean).join(' ');

    if (!text) return undefined;

    // 截取前 1~2 句完整语义 (遇到句号、分号或换行符号)
    const match = text.match(/^(.*?[。！？.!?])/);
    const summary = match ? match[1].trim() : text.slice(0, 120).trim();
    return summary.length > 0 ? summary : undefined;
  }

  /**
   * 基于命名语义与架构角色生成兜底的中文功能说明
   */
  public static generateHeuristicSummary(node: CodeNode): string {
    const name = node.name;
    const lowerName = name.toLowerCase();

    if (node.entityType === 'CONTRACT_ENDPOINT' || node.endpointMeta) {
      const m = (node.endpointMeta?.httpMethod || 'GET').toUpperCase();
      const p = node.endpointMeta?.routePath || name;
      return `对外暴露规范的 ${m} ${p} RESTful HTTP 接口契约。`;
    }
    if (node.entityType === 'CONTRACT_TOPIC' || node.topicMeta) {
      return `作为事件消息主题中枢，承载【${node.topicMeta?.topicName || name}】的异步发布与消费广播。`;
    }
    if (node.entityType === 'CONTRACT_RPC' || node.rpcMeta) {
      return `定义跨语言 RPC 服务方法【${node.rpcMeta?.serviceName || ''}/${node.rpcMeta?.methodName || name}】。`;
    }

    if (node.semanticRole === 'ENTRY') {
      if (/(login|auth|token|jwt)/i.test(lowerName)) {
        return '作为用户身份认证入口，接收登录或鉴权请求并开启安全会话。';
      }
      return `作为外部交互入口，接收上游请求并调度后续领域业务逻辑。`;
    }

    if (node.semanticRole === 'REPOSITORY') {
      return `负责【${name}】底层数据的持久化读取、写入与数据模型映射。`;
    }

    if (/(verify|validate|check|auth|guard)/i.test(lowerName)) {
      return `执行业务前置校验与合规断言，确保入参有效与状态安全。`;
    }
    if (/(create|insert|add|save)/i.test(lowerName)) {
      return `执行实体新建与持久化入库操作。`;
    }
    if (/(query|get|find|fetch|search|select)/i.test(lowerName)) {
      return `负责查询与检索业务目标数据。`;
    }
    if (/(update|modify|edit|patch)/i.test(lowerName)) {
      return `负责根据业务上下文变更与同步实体状态。`;
    }
    if (/(delete|remove|clear)/i.test(lowerName)) {
      return `负责清理或物理/逻辑删除指定业务实体。`;
    }

    if (node.entityType === 'CLASS') {
      return `定义【${name}】领域模型或组件类，封装相关状态与业务行为。`;
    }

    return `实现【${name}】核心逻辑计算与状态处理。`;
  }

  /**
   * 翻译边关系为通俗人类易懂的交互词汇
   */
  public static formatRelationText(relation: RelationType, isIncoming: boolean): string {
    if (isIncoming) {
      switch (relation) {
        case 'CALLS_CONTRACT':
          return '前端/客户端发起网络请求打入';
        case 'HANDLED_BY':
          return '契约中枢委托给此函数承接实现';
        case 'SUBSCRIBES':
          return '从异步消息主题订阅并接收事件';
        case 'CALLS':
          return '上游组件同步方法调用';
        case 'EXTENDS':
          return '作为基类被子类继承';
        case 'IMPLEMENTS':
          return '作为抽象规范被下级实现';
        case 'IMPORTS':
          return '被外部模块作为依赖导入';
        case 'READS_WRITES':
          return '被上游业务读写';
        default:
          return '被上游组件依赖关联';
      }
    } else {
      switch (relation) {
        case 'CALLS_CONTRACT':
          return '向网络契约中枢发起远程请求';
        case 'PUBLISHES':
          return '向消息总线广播事件消息';
        case 'READS_WRITES':
          return '访问并更新底层持久化状态';
        case 'CALLS':
          return '调度调用下游业务处理逻辑';
        case 'EXTENDS':
          return '继承父类核心能力与状态';
        case 'IMPLEMENTS':
          return '实现目标接口标准契约';
        case 'IMPORTS':
          return '引用导入外部模块支持包';
        default:
          return '依赖下游关联对象';
      }
    }
  }

  /**
   * 为单个符号节点生成交互透视故事 (NodeInteractionStory)
   */
  public static generateNodeStory(
    node: CodeNode,
    allNodesMap: Map<string, CodeNode> | Record<string, CodeNode>,
    edges: CodeEdge[]
  ): NodeInteractionStory {
    const getNode = (id: string): CodeNode | undefined => {
      if (allNodesMap instanceof Map) return allNodesMap.get(id);
      return (allNodesMap as Record<string, CodeNode>)[id];
    };

    // 1. 过滤统计入站与出站边
    const incomingEdges = edges.filter((e) => e.target === node.id);
    const outgoingEdges = edges.filter((e) => e.source === node.id);

    const inDegree = incomingEdges.length;
    const outDegree = outgoingEdges.length;

    // 2. 提取入站调用者列表
    const callers: InteractionCaller[] = [];
    for (const e of incomingEdges) {
      const srcNode = getNode(e.source);
      if (srcNode) {
        callers.push({
          nodeId: srcNode.id,
          name: srcNode.name,
          filePath: srcNode.filePath,
          line: e.sourceLine || srcNode.loc.startLine,
          relation: e.relation,
          relationText: this.formatRelationText(e.relation, true),
        });
      }
    }

    // 3. 提取出站依赖者列表
    const callees: InteractionCallee[] = [];
    for (const e of outgoingEdges) {
      const tgtNode = getNode(e.target);
      if (tgtNode) {
        callees.push({
          nodeId: tgtNode.id,
          name: tgtNode.name,
          filePath: tgtNode.filePath,
          line: e.sourceLine || tgtNode.loc.startLine,
          relation: e.relation,
          relationText: this.formatRelationText(e.relation, false),
        });
      }
    }

    // 4. 提取关联的跨端契约
    const contracts: InteractionContract[] = [];
    for (const caller of callers) {
      const src = getNode(caller.nodeId);
      if (src && (src.semanticRole === 'CONTRACT' || src.entityType.startsWith('CONTRACT_'))) {
        contracts.push({
          contractId: src.id,
          name: src.name,
          type: src.entityType === 'CONTRACT_TOPIC' ? 'TOPIC' : src.entityType === 'CONTRACT_RPC' ? 'RPC' : 'REST',
          direction: 'INBOUND',
          description: `承接外部客户端对契约【${src.name}】的具体执行`,
        });
      }
    }
    for (const callee of callees) {
      const tgt = getNode(callee.nodeId);
      if (tgt && (tgt.semanticRole === 'CONTRACT' || tgt.entityType.startsWith('CONTRACT_'))) {
        contracts.push({
          contractId: tgt.id,
          name: tgt.name,
          type: tgt.entityType === 'CONTRACT_TOPIC' ? 'TOPIC' : tgt.entityType === 'CONTRACT_RPC' ? 'RPC' : 'REST',
          direction: 'OUTBOUND',
          description: `作为调用客户端打向契约【${tgt.name}】`,
        });
      }
    }

    // 5. 推导角色定位与职责描述
    let roleTitle = '业务服务组件 (Service)';
    let roleDescription = '承接上游业务指令，执行领域计算并向下依赖数据或辅助服务。';

    if (node.semanticRole === 'CONTRACT' || node.entityType.startsWith('CONTRACT_')) {
      roleTitle = '跨语言契约中枢 (Contract Hub)';
      roleDescription = '作为多端通信的架构中枢，将前端请求、移动端与后端微服务路由或消息总线进行规范对齐。';
    } else if (node.semanticRole === 'ENTRY' || (inDegree === 0 && outDegree > 0)) {
      roleTitle = '外部驱动入口 (Entry Source)';
      roleDescription = '处于系统调用链路的最上游触发点，接收来自外部请求、定时事件或路由，调度下游业务处理。';
    } else if (node.semanticRole === 'REPOSITORY' || (inDegree > 0 && outDegree === 0)) {
      roleTitle = '底层持久化终端 (Data Sink)';
      roleDescription = '处于业务流的最末端，专注与数据库、缓存或存储介质直接打交道，负责状态持久落地。';
    } else if (inDegree >= 2 && outDegree >= 2) {
      roleTitle = '核心业务枢纽 (Core Hub)';
      roleDescription = '处于系统交互的关键十字路口，被多个上游调用，同时协调多个下游子系统，属于重要业务调度中枢。';
    } else if (inDegree === 0 && outDegree === 0) {
      roleTitle = '独立辅助单元 (Isolated Util)';
      roleDescription = '功能相对自包含的工具方法或常量模型，不与主业务流程强绑定，可随时独立复用。';
    }

    // 6. 整合原生注释与功能小结
    const cleaned = this.cleanDocstring(node.docstring);
    const summaryText = cleaned || this.generateHeuristicSummary(node);

    // 7. 生成架构演进与改动影响建议
    let architectureAdvice: string | undefined;
    if (inDegree >= 3) {
      architectureAdvice = `⚠️ 高敏感核心组件：当前被 ${inDegree} 个上游逻辑直接依赖。任何函数签名修改或返回值调整均可能造成多处编译或运行时破坏，建议改动前重点排查关联调用方。`;
    } else if (outDegree >= 3) {
      architectureAdvice = `ℹ️ 高依赖度组件：单节点向外调用了 ${outDegree} 个下游组件。需关注链路上的异常捕获容错，避免任一下游超时引发雪崩。`;
    } else if (inDegree >= 2 && outDegree >= 2) {
      architectureAdvice = `🔥 承上启下枢纽：作为业务总控，建议保持该函数代码精简，专注于工作流编排，避免堆砌过多底层实现细节。`;
    } else if (inDegree <= 1 && outDegree <= 1) {
      architectureAdvice = `✓ 低耦合局部节点：上下游关系简洁单一，重构或局部优化的影响面极易收敛。`;
    }

    return {
      roleTitle,
      roleDescription,
      summaryText,
      inDegree,
      outDegree,
      callers,
      callees,
      contracts,
      architectureAdvice,
    };
  }

  /**
   * 为时序执行流程 (ProcessFlow) 生成叙事故事 (FlowInteractionStory)
   */
  public static generateFlowStory(flow: ProcessFlow): FlowInteractionStory {
    const total = flow.steps.length;
    const narrativeText = `本业务流程共包含 ${total} 个协同步骤，以【${flow.title}】为起点，形成了完整的时序流转闭环。`;

    const stepNarratives = flow.steps.map((step, idx) => {
      const stepIndex = idx + 1;
      let actionDescription = '';

      switch (step.stepType) {
        case 'ENTRY':
          actionDescription = `第 ${stepIndex} 步【初始接入】：外部事件或网络请求进入系统，由 \`${step.name}()\` 负责接收并开启链路上下文。`;
          break;
        case 'DECISION':
          actionDescription = `第 ${stepIndex} 步【拦截判定】：调用 \`${step.name}()\` 进行关键参数校验或业务守卫判定，未通过时将熔断中断链路。`;
          break;
        case 'STORE':
          actionDescription = `第 ${stepIndex} 步【数据持久】：调度底层 \`${step.name}()\` 执行数据库交互或状态落地更新。`;
          break;
        case 'OUTPUT':
          actionDescription = `第 ${stepIndex} 步【终态响应】：执行 \`${step.name}()\` 封装执行结果，向客户端生成响应或广播外部通知。`;
          break;
        default:
          actionDescription = `第 ${stepIndex} 步【业务计算】：内部调用 \`${step.name}()\` 处理具体领域规则计算或中继流转。`;
          break;
      }

      return {
        stepIndex,
        name: step.name,
        stepType: step.stepType,
        actionDescription,
      };
    });

    return {
      flowId: flow.flowId,
      title: flow.title,
      narrativeText,
      stepNarratives,
    };
  }

  /**
   * 为宏观模块生成交互概览叙事 (ModuleInteractionStory)
   */
  public static generateModuleStory(
    mod: ModuleContainer,
    allModules: ModuleContainer[],
    buses: ModuleBus[]
  ): ModuleInteractionStory {
    const modMap = new Map<string, ModuleContainer>();
    for (const m of allModules) modMap.set(m.id, m);

    const inboundModuleNames: string[] = [];
    const outboundModuleNames: string[] = [];

    for (const bus of buses) {
      if (bus.targetModule === mod.id) {
        const src = modMap.get(bus.sourceModule);
        if (src && !inboundModuleNames.includes(src.name)) {
          inboundModuleNames.push(src.name);
        }
      }
      if (bus.sourceModule === mod.id) {
        const tgt = modMap.get(bus.targetModule);
        if (tgt && !outboundModuleNames.includes(tgt.name)) {
          outboundModuleNames.push(tgt.name);
        }
      }
    }

    const inCount = mod.inPorts.length;
    const outCount = mod.outPorts.length;
    const fileCount = mod.files.length;

    let roleTitle = mod.archetypeRole || '业务功能模块';
    let purposeDescription = `聚合了 ${fileCount} 个源码文件。`;

    if (inCount > 0 && outCount > 0) {
      purposeDescription += ` 对外暴露 ${inCount} 个入口接口，同时向外协同依赖 ${outCount} 个出口端口。`;
    } else if (inCount > 0) {
      purposeDescription += ` 对外提供 ${inCount} 个核心能力入口，属于底层自给自足的服务汇聚层。`;
    } else if (outCount > 0) {
      purposeDescription += ` 作为主动发起方，向下调度 ${outCount} 个外部依赖，负责前置驱动。`;
    } else {
      purposeDescription += ` 模块内部高度自闭环，与外部无直接强耦合交互。`;
    }

    return {
      moduleId: mod.id,
      name: mod.name,
      roleTitle,
      purposeDescription,
      inboundModuleNames,
      outboundModuleNames,
    };
  }

  /**
   * 全量为编译后的图谱注入交互透视故事
   */
  public static enrichGraphResult(result: FullGraphResult): FullGraphResult {
    const allNodesMap = result.allNodes;
    const edges = result.allEdges;

    // 1. 注入节点故事
    for (const node of Object.values(allNodesMap)) {
      if (!node.metadata) {
        node.metadata = {};
      }
      node.metadata.story = this.generateNodeStory(node, allNodesMap, edges);
    }

    // 2. 注入时序流故事
    for (const flow of result.processFlows) {
      const flowStory = this.generateFlowStory(flow);
      (flow as any).story = flowStory;
    }

    // 3. 注入宏观模块故事
    for (const mod of result.architectureView.modules) {
      const modStory = this.generateModuleStory(
        mod,
        result.architectureView.modules,
        result.architectureView.buses
      );
      (mod as any).story = modStory;
    }

    return result;
  }
}

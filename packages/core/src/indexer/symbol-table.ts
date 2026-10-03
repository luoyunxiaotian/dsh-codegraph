import path from 'path';
import { CodeNode, CodeEdge, ExtractedFileResult } from '../types/index.js';
import { formatNodeId } from '../parser/scip-utils.js';
import { ContractLinker } from '../graph/contract-linker.js';

export class SymbolTable {
  // 所有节点字典: nodeId -> CodeNode
  private nodes: Map<string, CodeNode> = new Map();
  // 所有确定关系边字典: edgeId -> CodeEdge
  private edges: Map<string, CodeEdge> = new Map();

  // 契约节点与边追踪集合 (用于幂等刷新)
  private contractNodeIds: Set<string> = new Set();
  private contractEdgeIds: Set<string> = new Set();

  // 按文件分组的节点索引: filePath -> Set<nodeId>
  private fileNodeIndex: Map<string, Set<string>> = new Map();
  // 按文件分组的未解决调用: filePath -> ExtractedFileResult
  private fileExtractionCache: Map<string, ExtractedFileResult> = new Map();

  // 符号短名与限定名索引
  private qualifiedIndex: Map<string, string> = new Map(); // qualifiedName -> nodeId
  private fileLocalSymbols: Map<string, Map<string, string>> = new Map(); // filePath -> (name -> nodeId)

  /**
   * 注册单个文件的语法解析结果
   */
  public registerFileExtraction(result: ExtractedFileResult): void {
    // 1. 先清理该文件可能存在的旧索引 (若增量更新)
    this.invalidateFile(result.filePath);

    this.fileExtractionCache.set(result.filePath, result);
    const nodeSet = new Set<string>();
    const localMap = new Map<string, string>();

    // 2. 载入所有节点
    for (const node of result.nodes) {
      this.nodes.set(node.id, node);
      nodeSet.add(node.id);
      this.qualifiedIndex.set(node.qualifiedName, node.id);
      localMap.set(node.name, node.id);
    }

    // 3. 载入文件内部已确定的边 (如 CONTAINS 关系)
    for (const edge of result.edges) {
      this.edges.set(edge.id, edge);
    }

    this.fileNodeIndex.set(result.filePath, nodeSet);
    this.fileLocalSymbols.set(result.filePath, localMap);
  }

  /**
   * 局部手术式剔除单个文件的旧符号与相关边
   */
  public invalidateFile(filePath: string): void {
    const existingNodeIds = this.fileNodeIndex.get(filePath);
    if (existingNodeIds) {
      // 移除节点与限定名索引
      for (const nodeId of existingNodeIds) {
        const node = this.nodes.get(nodeId);
        if (node) {
          this.qualifiedIndex.delete(node.qualifiedName);
        }
        this.nodes.delete(nodeId);
      }
    }

    // 移除以该文件节点为起点或终点的边
    const edgeIdsToDelete: string[] = [];
    for (const [edgeId, edge] of this.edges.entries()) {
      if (
        (existingNodeIds && (existingNodeIds.has(edge.source) || existingNodeIds.has(edge.target)))
      ) {
        edgeIdsToDelete.push(edgeId);
      }
    }
    for (const edgeId of edgeIdsToDelete) {
      this.edges.delete(edgeId);
    }

    this.fileNodeIndex.delete(filePath);
    this.fileLocalSymbols.delete(filePath);
    this.fileExtractionCache.delete(filePath);
  }

  /**
   * 全局跨文件调用与依赖关系解析 (Symbol Linking & Architecture Dependency)
   */
  public resolveCrossFileReferences(): void {
    // 0. 清除旧契约节点与边 (保障幂等更新)
    for (const cid of this.contractNodeIds) {
      this.nodes.delete(cid);
    }
    this.contractNodeIds.clear();

    for (const eid of this.contractEdgeIds) {
      this.edges.delete(eid);
    }
    this.contractEdgeIds.clear();

    // 1. 建立跨文件导入依赖边 (IMPORTS)
    for (const [filePath, extracted] of this.fileExtractionCache.entries()) {
      const fileNodeId = formatNodeId(filePath, 'file');

      for (const imp of extracted.imports) {
        let targetFilePath = this.resolveModuleToFilePath(filePath, imp.modulePath);

        // 如果未直接解析出文件，检查 importedNames 是否为子模块文件
        if (!targetFilePath && imp.importedNames.length > 0) {
          for (const item of imp.importedNames) {
            targetFilePath = this.resolveModuleToFilePath(filePath, imp.modulePath, item.name);
            if (targetFilePath) break;
          }
        }

        if (targetFilePath && targetFilePath !== filePath) {
          const targetFileNodeId = formatNodeId(targetFilePath, 'file');
          const edgeId = `imports_${fileNodeId}_${targetFileNodeId}`;
          if (!this.edges.has(edgeId)) {
            this.edges.set(edgeId, {
              id: edgeId,
              source: fileNodeId,
              target: targetFileNodeId,
              relation: 'IMPORTS',
              confidence: 'EXTRACTED',
              sourceLine: imp.line,
              weight: 1,
            });
          }

          // 导入具体符号的依赖边
          for (const item of imp.importedNames) {
            if (item.name === '*') continue;
            const targetSymbolId = formatNodeId(targetFilePath, item.name);
            if (this.nodes.has(targetSymbolId)) {
              const symEdgeId = `imports_sym_${fileNodeId}_${targetSymbolId}`;
              if (!this.edges.has(symEdgeId)) {
                this.edges.set(symEdgeId, {
                  id: symEdgeId,
                  source: fileNodeId,
                  target: targetSymbolId,
                  relation: 'IMPORTS',
                  confidence: 'EXTRACTED',
                  sourceLine: imp.line,
                  weight: 1,
                });
              }
            }
          }
        }
      }
    }

    // 2. 解析类继承关系 (EXTENDS)
    for (const [filePath, extracted] of this.fileExtractionCache.entries()) {
      const localSymbols = this.fileLocalSymbols.get(filePath) || new Map();
      const imports = extracted.imports;

      for (const inh of extracted.unresolvedInheritance || []) {
        const superName = inh.superclassName.trim();
        let targetSuperId: string | undefined;

        // 2.1 本地同文件类继承
        if (localSymbols.has(superName)) {
          targetSuperId = localSymbols.get(superName);
        }

        // 2.2 通过 import 导入的基类
        if (!targetSuperId) {
          for (const imp of imports) {
            const matched = imp.importedNames.find(
              (n) => (n.alias && n.alias === superName) || n.name === superName
            );
            if (matched) {
              const targetFilePath = this.resolveModuleToFilePath(filePath, imp.modulePath, matched.name);
              if (targetFilePath) {
                const possibleId = formatNodeId(targetFilePath, matched.name);
                if (this.nodes.has(possibleId)) {
                  targetSuperId = possibleId;
                  break;
                }
              }
            }
          }
        }

        // 2.3 module.BaseClass 形式
        if (!targetSuperId && superName.includes('.')) {
          const parts = superName.split('.');
          const modPrefix = parts[0];
          const classPart = parts.slice(1).join('.');
          for (const imp of imports) {
            if (
              imp.importedNames.some((n) => n.name === modPrefix || n.alias === modPrefix) ||
              imp.modulePath.endsWith(modPrefix)
            ) {
              const targetFilePath = this.resolveModuleToFilePath(filePath, imp.modulePath);
              if (targetFilePath) {
                const possibleId = formatNodeId(targetFilePath, classPart);
                if (this.nodes.has(possibleId)) {
                  targetSuperId = possibleId;
                  break;
                }
              }
            }
          }
        }

        // 2.4 全局同名基类兜底 (如 BaseModel, BaseService 等通用基类)
        if (!targetSuperId) {
          const cleanName = superName.split('.').pop() || superName;
          const candidates = Array.from(this.nodes.values()).filter(
            (n) => n.entityType === 'CLASS' && n.name.toLowerCase() === cleanName.toLowerCase()
          );
          if (candidates.length === 1) {
            targetSuperId = candidates[0].id;
          }
        }

        if (targetSuperId && targetSuperId !== inh.classNodeId) {
          const edgeId = `extends_${inh.classNodeId}_${targetSuperId}`;
          if (!this.edges.has(edgeId)) {
            this.edges.set(edgeId, {
              id: edgeId,
              source: inh.classNodeId,
              target: targetSuperId,
              relation: 'EXTENDS',
              confidence: 'EXTRACTED',
              sourceLine: inh.line,
              weight: 2,
            });
          }
        }
      }
    }

    // 3. 解析函数与方法调用 (CALLS)
    for (const [filePath, extracted] of this.fileExtractionCache.entries()) {
      const localSymbols = this.fileLocalSymbols.get(filePath) || new Map();
      const imports = extracted.imports;

      for (const call of extracted.unresolvedCalls) {
        const calleeExpr = call.calleeExpression.trim();
        let targetNodeId: string | undefined;

        // 3.1 尝试匹配文件本地符号 (如调用同文件内部函数)
        if (localSymbols.has(calleeExpr)) {
          targetNodeId = localSymbols.get(calleeExpr);
        }

        // 3.2 支持 self.method() 或 cls.method(): 当前类或同文件内部方法
        if (!targetNodeId && (calleeExpr.startsWith('self.') || calleeExpr.startsWith('cls.'))) {
          const methodName = calleeExpr.split('.').slice(1).join('.');
          const callerNode = this.nodes.get(call.callerNodeId);
          if (callerNode) {
            const classPrefix = callerNode.qualifiedName.split('.').slice(0, -1).join('.');
            const candNode = Array.from(this.nodes.values()).find(
              (n) => n.filePath === filePath && n.name === methodName && n.qualifiedName.startsWith(classPrefix)
            );
            if (candNode) {
              targetNodeId = candNode.id;
            } else if (localSymbols.has(methodName)) {
              targetNodeId = localSymbols.get(methodName);
            }
          }
        }

        // 3.3 若本地无匹配，检查是否通过 from x import y 导入
        if (!targetNodeId) {
          for (const imp of imports) {
            if (imp.isFromImport) {
              const matchedName = imp.importedNames.find(
                (n) => (n.alias && n.alias === calleeExpr) || n.name === calleeExpr
              );
              if (matchedName) {
                const targetFilePath = this.resolveModuleToFilePath(filePath, imp.modulePath, matchedName.name);
                if (targetFilePath) {
                  const possibleId = formatNodeId(targetFilePath, matchedName.name);
                  if (this.nodes.has(possibleId)) {
                    targetNodeId = possibleId;
                    break;
                  }
                }
              }
            }
          }
        }

        // 3.4 检查是否通过 module.func() 形式调用 (如 auth_service.verify_token())
        if (!targetNodeId && calleeExpr.includes('.')) {
          const parts = calleeExpr.split('.');
          const modPrefix = parts[0];
          const funcPart = parts.slice(1).join('.');

          // 匹配普通 import
          for (const imp of imports) {
            const matchedModule = imp.importedNames.find(
              (n) => (n.alias && n.alias === modPrefix) || n.name === modPrefix || imp.modulePath.endsWith(modPrefix)
            );
            if (matchedModule) {
              const targetFilePath = this.resolveModuleToFilePath(filePath, imp.modulePath);
              if (targetFilePath) {
                const possibleId = formatNodeId(targetFilePath, funcPart);
                if (this.nodes.has(possibleId)) {
                  targetNodeId = possibleId;
                  break;
                }
              }
            }
          }
        }

        // 3.5 启发式推断: instance.method() 或 import * 调用的跨文件匹配
        if (!targetNodeId) {
          const targetFunc = calleeExpr.includes('.') ? calleeExpr.split('.').pop()! : calleeExpr;
          const importedFiles = new Set<string>();
          for (const imp of imports) {
            const tf = this.resolveModuleToFilePath(filePath, imp.modulePath);
            if (tf) importedFiles.add(tf);
          }

          let matchedCandidates: CodeNode[] = [];
          for (const impFile of importedFiles) {
            const nodeIds = this.fileNodeIndex.get(impFile) || new Set();
            for (const nid of nodeIds) {
              const n = this.nodes.get(nid);
              if (
                n &&
                n.name === targetFunc &&
                (n.entityType === 'FUNCTION' || n.entityType === 'METHOD' || n.entityType === 'CLASS')
              ) {
                matchedCandidates.push(n);
              }
            }
          }

          if (matchedCandidates.length === 1) {
            targetNodeId = matchedCandidates[0].id;
          } else if (matchedCandidates.length === 0) {
            // 全局唯一函数推断
            const globalCandidates = Array.from(this.nodes.values()).filter(
              (n) => n.name === targetFunc && (n.entityType === 'FUNCTION' || n.entityType === 'METHOD')
            );
            if (globalCandidates.length === 1) {
              targetNodeId = globalCandidates[0].id;
            }
          }
        }

        // 3.6 若解析成功，建立 CALLS 边
        if (targetNodeId && targetNodeId !== call.callerNodeId) {
          const edgeId = `calls_${call.callerNodeId}_${targetNodeId}_${call.line}`;
          if (!this.edges.has(edgeId)) {
            this.edges.set(edgeId, {
              id: edgeId,
              source: call.callerNodeId,
              target: targetNodeId,
              relation: 'CALLS',
              confidence: 'EXTRACTED',
              sourceLine: call.line,
              weight: 1,
            });
          }
        }
      }
    }

    // 4. 执行跨语言契约中枢链接 (Polyglot Contract Hub Linker)
    const contractResult = ContractLinker.linkContracts(this.nodes, this.fileExtractionCache.values());
    for (const cNode of contractResult.contractNodes) {
      this.nodes.set(cNode.id, cNode);
      this.contractNodeIds.add(cNode.id);
    }
    for (const cEdge of contractResult.contractEdges) {
      this.edges.set(cEdge.id, cEdge);
      this.contractEdgeIds.add(cEdge.id);
    }
  }

  /**
   * 辅助方法：将多语言导入模块路径解析为工作区实际文件相对路径
   */
  public resolveModuleToFilePath(
    sourceFilePath: string,
    modulePath: string,
    importedName?: string
  ): string | undefined {
    const normSource = sourceFilePath.replace(/\\/g, '/');
    const sourceDir = path.posix.dirname(normSource);
    const sourceExt = path.posix.extname(normSource).toLowerCase();

    const exts = sourceExt === '.py'
      ? ['.py']
      : ['.ts', '.tsx', '.js', '.jsx', '.go', '.java', '.rs', '.cpp', '.c', '.h', '.hpp', '.cs', '.py'];

    // 1. 处理相对导入 (以 . 开头)
    if (modulePath.startsWith('.')) {
      const match = modulePath.match(/^(\.+)(.*)$/);
      if (match) {
        const dots = match[1].length;
        const subPath = match[2];

        let targetDir = sourceDir;
        for (let i = 1; i < dots; i++) {
          targetDir = path.posix.dirname(targetDir);
        }

        const candidates: string[] = [];
        if (subPath) {
          const rel = subPath.replace(/\./g, '/').replace(/^\//, '');
          for (const ext of exts) {
            candidates.push(path.posix.join(targetDir, `${rel}${ext}`));
            candidates.push(path.posix.join(targetDir, rel, `index${ext}`));
            candidates.push(path.posix.join(targetDir, rel, `__init__${ext}`));
            candidates.push(path.posix.join(targetDir, rel, `mod${ext}`));
          }
        }
        if (importedName && importedName !== '*') {
          const nameRel = importedName.replace(/\./g, '/');
          if (subPath) {
            const rel = subPath.replace(/\./g, '/').replace(/^\//, '');
            for (const ext of exts) {
              candidates.push(path.posix.join(targetDir, rel, `${nameRel}${ext}`));
            }
          } else {
            for (const ext of exts) {
              candidates.push(path.posix.join(targetDir, `${nameRel}${ext}`));
            }
          }
        }

        for (const cand of candidates) {
          const matched = this.matchRegisteredFile(cand);
          if (matched) return matched;
        }
      }
    }

    // 2. 处理绝对或顶层别名导入 (如 @/components, src.services.user, app.models)
    if (modulePath) {
      let cleanMod = modulePath;
      if (cleanMod.startsWith('@/') || cleanMod.startsWith('~/')) {
        cleanMod = cleanMod.slice(2);
      }
      const relPath = cleanMod.replace(/\./g, '/');
      const candidates: string[] = [];
      for (const ext of exts) {
        candidates.push(`${relPath}${ext}`);
        candidates.push(`${relPath}/index${ext}`);
        candidates.push(`${relPath}/__init__${ext}`);
        candidates.push(`${relPath}/mod${ext}`);
      }
      if (importedName && importedName !== '*') {
        for (const ext of exts) {
          candidates.push(`${relPath}/${importedName}${ext}`);
        }
      }

      for (const cand of candidates) {
        const matched = this.matchRegisteredFile(cand);
        if (matched) return matched;
      }
    }

    return undefined;
  }

  private matchRegisteredFile(candidatePath: string): string | undefined {
    const cleanCand = candidatePath.replace(/\\/g, '/').replace(/^\.\//, '');
    for (const registeredPath of this.fileExtractionCache.keys()) {
      const normReg = registeredPath.replace(/\\/g, '/').replace(/^\.\//, '');
      if (
        normReg === cleanCand ||
        normReg.endsWith('/' + cleanCand) ||
        normReg.endsWith(cleanCand)
      ) {
        return registeredPath;
      }
    }
    return undefined;
  }

  public getAllNodes(): CodeNode[] {
    return Array.from(this.nodes.values());
  }

  public getNode(id: string): CodeNode | undefined {
    return this.nodes.get(id);
  }

  public getAllEdges(): CodeEdge[] {
    return Array.from(this.edges.values());
  }

  public getNodeCount(): number {
    return this.nodes.size;
  }

  public getEdgeCount(): number {
    return this.edges.size;
  }

  public dumpExtractions(): Record<string, ExtractedFileResult> {
    const res: Record<string, ExtractedFileResult> = {};
    for (const [k, v] of this.fileExtractionCache.entries()) {
      res[k] = v;
    }
    return res;
  }

  public loadExtractions(extractions: Record<string, ExtractedFileResult>): void {
    for (const ext of Object.values(extractions)) {
      this.registerFileExtraction(ext);
    }
    this.resolveCrossFileReferences();
  }
}

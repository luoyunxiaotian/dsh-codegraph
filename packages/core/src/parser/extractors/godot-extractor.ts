import {
  CodeNode,
  CodeEdge,
  LanguageExtractor,
  ExtractedFileResult,
  FileImportInfo,
  UnresolvedCall,
  UnresolvedInheritance,
} from '../../types/index.js';
import {
  formatNodeId,
  formatQualifiedName,
  formatScipUri,
  normalizeRoutePattern,
} from '../scip-utils.js';

export class GodotExtractor implements LanguageExtractor {
  public readonly language = 'godot';
  public readonly fileExtensions = ['.gd', '.tscn'];
  public readonly wasmGrammarName = 'none';

  public extractFile(
    _tree: any,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    const ext = filePath.toLowerCase().split('.').pop();
    if (ext === 'tscn') {
      return extractGodotSceneFile(filePath, sourceCode);
    }
    return extractGodotScriptFile(filePath, sourceCode);
  }
}

/**
 * 深度解析 Godot GDScript 脚本 (.gd)
 * 提取 Class、继承、Signal 信号事件、生命周期回调与方法、Preload 资源引用及调用链
 */
export function extractGodotScriptFile(
  filePath: string,
  sourceCode: string
): ExtractedFileResult {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const imports: FileImportInfo[] = [];
  const unresolvedCalls: UnresolvedCall[] = [];
  const unresolvedInheritance: UnresolvedInheritance[] = [];

  const lines = sourceCode.split('\n');
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const baseName = fileName.replace(/\.gd$/i, '');

  // 1. 创建文件节点
  const fileNodeId = formatNodeId(filePath, 'file');
  const fileNode: CodeNode = {
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'godot',
    scipUri: formatScipUri('godot', filePath, '', fileName, 'def'),
    loc: { startLine: 1, endLine: lines.length },
  };
  nodes.push(fileNode);

  // 2. 确定 Class 节点 (通过 class_name 或基于文件名推导)
  let explicitClassName: string | undefined;
  let superClassName: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // class_name Player or class_name Player, "res://icon.svg"
    const classMatch = line.match(/^class_name\s+([a-zA-Z0-9_]+)/);
    if (classMatch) {
      explicitClassName = classMatch[1];
    }
    // extends CharacterBody2D or extends "res://scripts/base.gd"
    const extendsMatch = line.match(/^extends\s+(["']?[a-zA-Z0-9_./:]+["']?)/);
    if (extendsMatch) {
      superClassName = extendsMatch[1].replace(/["']/g, '');
    }
  }

  const className = explicitClassName || (baseName.charAt(0).toUpperCase() + baseName.slice(1));
  const classNodeId = formatNodeId(filePath, className);

  const classNode: CodeNode = {
    id: classNodeId,
    name: className,
    qualifiedName: formatQualifiedName(filePath, className),
    entityType: 'CLASS',
    semanticRole: 'SERVICE',
    filePath,
    language: 'godot',
    scipUri: formatScipUri('godot', filePath, '', className, 'class'),
    loc: { startLine: 1, endLine: lines.length },
  };
  nodes.push(classNode);

  edges.push({
    id: `contains_${fileNodeId}_${classNodeId}`,
    source: fileNodeId,
    target: classNodeId,
    relation: 'CONTAINS',
    confidence: 'EXTRACTED',
  });

  // 处理基类继承
  if (superClassName) {
    unresolvedInheritance.push({
      classNodeId,
      superclassName: superClassName,
      line: 1,
    });
  }

  let currentMethodNode: CodeNode | undefined;

  // 3. 逐行解析 Signal、Function/Method、Preload、Calls
  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const line = lines[idx];
    const trimmed = line.trim();

    // 跳过空行和纯注释
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 3.1 提取 preload / load 依赖: preload("res://...") 或 load("...")
    const preloadMatches = trimmed.matchAll(/(?:preload|load)\s*\(\s*["']([^"']+)["']\s*\)/g);
    for (const match of preloadMatches) {
      const resPath = match[1];
      const cleanTarget = resPath.replace(/^res:\/\//, '');
      const targetName = cleanTarget.split('/').pop() || cleanTarget;

      imports.push({
        modulePath: cleanTarget,
        importedNames: [{ name: targetName }],
        line: lineNum,
      });

      const caller = currentMethodNode || classNode;
      edges.push({
        id: `import_${caller.id}_${cleanTarget}`,
        source: caller.id,
        target: cleanTarget,
        relation: 'IMPORTS',
        confidence: 'EXTRACTED',
        sourceLine: lineNum,
      });
    }

    // 3.2 提取 signal 信号声明: signal health_changed(new_health) 或 signal died
    const signalMatch = trimmed.match(/^signal\s+([a-zA-Z0-9_]+)(?:\(([^)]*)\))?/);
    if (signalMatch) {
      const sigName = signalMatch[1];
      const sigParams = signalMatch[2] || '';
      const sigNodeId = formatNodeId(filePath, `signal_${sigName}`);

      const sigNode: CodeNode = {
        id: sigNodeId,
        name: sigName,
        qualifiedName: formatQualifiedName(filePath, `signal.${sigName}`),
        entityType: 'ENDPOINT',
        semanticRole: 'ENTRY',
        filePath,
        language: 'godot',
        signature: `signal ${sigName}(${sigParams})`,
        scipUri: formatScipUri('godot', filePath, className, sigName, 'def'),
        topicMeta: {
          topicName: sigName,
          isPublisher: true,
        },
        loc: { startLine: lineNum, endLine: lineNum },
      };
      nodes.push(sigNode);

      edges.push({
        id: `contains_${classNodeId}_${sigNodeId}`,
        source: classNodeId,
        target: sigNodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });
      continue;
    }

    // 3.3 提取 func 函数/方法声明: func _ready() -> void: 或 func attack(dmg):
    const funcMatch = trimmed.match(/^func\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)(?:\s*->\s*([a-zA-Z0-9_]+))?\s*:/);
    if (funcMatch) {
      const fnName = funcMatch[1];
      const fnParams = funcMatch[2] || '';
      const fnReturn = funcMatch[3] || '';
      const fnNodeId = formatNodeId(filePath, `${className}_${fnName}`);

      // Godot 核心引擎生命周期回调自动判定为 ENTRY 入口角色
      const isLifecycle = /^_?(ready|enter_tree|exit_tree|process|physics_process|input|unhandled_input|draw|gui_input)$/i.test(fnName);
      const role: 'ENTRY' | 'SERVICE' = isLifecycle ? 'ENTRY' : 'SERVICE';

      currentMethodNode = {
        id: fnNodeId,
        name: fnName,
        qualifiedName: formatQualifiedName(filePath, `${className}.${fnName}`),
        entityType: 'METHOD',
        semanticRole: role,
        filePath,
        language: 'godot',
        signature: `func ${fnName}(${fnParams})${fnReturn ? ' -> ' + fnReturn : ''}:`,
        scipUri: formatScipUri('godot', filePath, className, fnName, 'method'),
        loc: { startLine: lineNum, endLine: lineNum },
      };
      nodes.push(currentMethodNode);

      edges.push({
        id: `contains_${classNodeId}_${fnNodeId}`,
        source: classNodeId,
        target: fnNodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });
      continue;
    }

    // 3.4 在方法体内提取方法调用与信号触发
    if (currentMethodNode) {
      // 信号触发: health_changed.emit(new_health) 或 emit_signal("health_changed", ...)
      const emitMatch = trimmed.match(/([a-zA-Z0-9_]+)\.emit\(/);
      if (emitMatch) {
        const sigName = emitMatch[1];
        unresolvedCalls.push({
          callerNodeId: currentMethodNode.id,
          calleeExpression: sigName,
          line: lineNum,
          topicMeta: {
            topicName: sigName,
            isPublish: true,
          },
        });
      }
      const emitSignalMatch = trimmed.match(/emit_signal\(\s*["']([a-zA-Z0-9_]+)["']/);
      if (emitSignalMatch) {
        const sigName = emitSignalMatch[1];
        unresolvedCalls.push({
          callerNodeId: currentMethodNode.id,
          calleeExpression: sigName,
          line: lineNum,
          topicMeta: {
            topicName: sigName,
            isPublish: true,
          },
        });
      }

      // REST / HTTP 请求侦测 (如 $HTTPRequest.request("http://...") 或 http.request(...))
      const httpMatch = trimmed.match(/\.request\(\s*["'](https?:\/\/[^"']+|\/[^"']+)["']/);
      if (httpMatch) {
        const route = normalizeRoutePattern(httpMatch[1]);
        const epId = formatNodeId(filePath, `${currentMethodNode.name}_call_get_${route}`);
        nodes.push({
          id: epId,
          name: `GET ${route}`,
          qualifiedName: formatQualifiedName(filePath, `GET ${route}`),
          entityType: 'ENDPOINT',
          semanticRole: 'CONTRACT',
          filePath,
          language: 'godot',
          endpointMeta: {
            httpMethod: 'GET',
            routePath: route,
            isClientCall: true,
          },
          loc: { startLine: lineNum, endLine: lineNum },
        });

        edges.push({
          id: `client_call_${currentMethodNode.id}_${epId}`,
          source: currentMethodNode.id,
          target: epId,
          relation: 'CALLS_CONTRACT',
          confidence: 'EXTRACTED',
          sourceLine: lineNum,
        });

        unresolvedCalls.push({
          callerNodeId: currentMethodNode.id,
          calleeExpression: `request`,
          line: lineNum,
          apiCallMeta: { httpMethod: 'GET', routePattern: route },
        });
      }

      // 常规方法调用: xxx() 或 obj.method()
      const callMatches = trimmed.matchAll(/\b([a-zA-Z0-9_]+)\s*\(/g);
      for (const cm of callMatches) {
        const callee = cm[1];
        if (!['func', 'if', 'elif', 'while', 'for', 'return', 'preload', 'load', 'print'].includes(callee)) {
          unresolvedCalls.push({
            callerNodeId: currentMethodNode.id,
            calleeExpression: callee,
            line: lineNum,
          });
        }
      }
    }
  }

  return {
    filePath,
    language: 'godot',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}

/**
 * 深度解析 Godot 场景文件 (.tscn)
 * 提取场景架构根节点、ext_resource 资源依赖、挂载脚本与子场景嵌套
 */
export function extractGodotSceneFile(
  filePath: string,
  sourceCode: string
): ExtractedFileResult {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const imports: FileImportInfo[] = [];
  const unresolvedCalls: UnresolvedCall[] = [];
  const unresolvedInheritance: UnresolvedInheritance[] = [];

  const lines = sourceCode.split('\n');
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const sceneName = fileName.replace(/\.tscn$/i, '');

  // 1. 创建文件节点
  const fileNodeId = formatNodeId(filePath, 'file');
  const fileNode: CodeNode = {
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'godot',
    scipUri: formatScipUri('godot', filePath, '', fileName, 'def'),
    loc: { startLine: 1, endLine: lines.length },
  };
  nodes.push(fileNode);

  // 2. 外部资源字典: id -> { type, path }
  const extResources = new Map<string, { type: string; path: string }>();

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const line = lines[idx].trim();

    // [ext_resource type="Script" path="res://scripts/player.gd" id="1_xxx"]
    if (line.startsWith('[ext_resource')) {
      const typeMatch = line.match(/type\s*=\s*["']([^"']+)["']/);
      const pathMatch = line.match(/path\s*=\s*["']([^"']+)["']/);
      const idMatch = line.match(/id\s*=\s*["']([^"']+)["']/);

      if (pathMatch && idMatch) {
        const resType = typeMatch ? typeMatch[1] : 'Resource';
        const rawPath = pathMatch[1];
        const resId = idMatch[1];
        const cleanPath = rawPath.replace(/^res:\/\//, '');

        extResources.set(resId, { type: resType, path: cleanPath });

        const targetName = cleanPath.split('/').pop() || cleanPath;
        imports.push({
          modulePath: cleanPath,
          importedNames: [{ name: targetName }],
          line: lineNum,
        });
      }
    }
  }

  // 3. 提取场景根节点
  let rootSceneNode: CodeNode | undefined;

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const line = lines[idx].trim();

    // [node name="Player" type="CharacterBody2D"] 或 [node name="Player" type="CharacterBody2D" parent="."]
    if (line.startsWith('[node')) {
      const nameMatch = line.match(/name\s*=\s*["']([^"']+)["']/);
      const typeMatch = line.match(/type\s*=\s*["']([^"']+)["']/);
      const parentMatch = line.match(/parent\s*=\s*["']([^"']+)["']/);
      const nodeName = nameMatch ? nameMatch[1] : sceneName;
      const nodeType = typeMatch ? typeMatch[1] : 'Node';

      // 首个节点或无 parent 字段的节点作为主场景节点
      if (!rootSceneNode && (!parentMatch || parentMatch[1] === '.')) {
        const rootId = formatNodeId(filePath, nodeName);
        rootSceneNode = {
          id: rootId,
          name: `${nodeName} (${nodeType})`,
          qualifiedName: formatQualifiedName(filePath, nodeName),
          entityType: 'CLASS',
          semanticRole: 'SERVICE',
          filePath,
          language: 'godot',
          scipUri: formatScipUri('godot', filePath, '', nodeName, 'class'),
          metadata: {
            godotNodeType: nodeType,
            isSceneRoot: true,
          },
          loc: { startLine: lineNum, endLine: lineNum },
        };
        nodes.push(rootSceneNode);

        edges.push({
          id: `contains_${fileNodeId}_${rootId}`,
          source: fileNodeId,
          target: rootId,
          relation: 'CONTAINS',
          confidence: 'EXTRACTED',
        });
      }
    }
  }

  // 兜底根节点
  if (!rootSceneNode) {
    const rootId = formatNodeId(filePath, sceneName);
    rootSceneNode = {
      id: rootId,
      name: sceneName,
      qualifiedName: formatQualifiedName(filePath, sceneName),
      entityType: 'CLASS',
      semanticRole: 'SERVICE',
      filePath,
      language: 'godot',
      scipUri: formatScipUri('godot', filePath, '', sceneName, 'class'),
      loc: { startLine: 1, endLine: lines.length },
    };
    nodes.push(rootSceneNode);

    edges.push({
      id: `contains_${fileNodeId}_${rootId}`,
      source: fileNodeId,
      target: rootId,
      relation: 'CONTAINS',
      confidence: 'EXTRACTED',
    });
  }

  // 4. 解析挂载脚本与嵌入场景实例
  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const line = lines[idx].trim();

    // script = ExtResource("1_xxx")
    const scriptMatch = line.match(/script\s*=\s*ExtResource\(\s*["']([^"']+)["']\s*\)/);
    if (scriptMatch) {
      const resId = scriptMatch[1];
      const res = extResources.get(resId);
      if (res) {
        // 挂载脚本：场景 EXTENDS / IMPORTS 对应脚本
        edges.push({
          id: `extends_${rootSceneNode.id}_${res.path}`,
          source: rootSceneNode.id,
          target: res.path,
          relation: 'EXTENDS',
          confidence: 'EXTRACTED',
          sourceLine: lineNum,
        });
      }
    }

    // instance = ExtResource("2_yyy")
    const instanceMatch = line.match(/instance\s*=\s*ExtResource\(\s*["']([^"']+)["']\s*\)/);
    if (instanceMatch) {
      const resId = instanceMatch[1];
      const res = extResources.get(resId);
      if (res) {
        // 嵌入子场景：场景 CONTAINS 对应子场景
        edges.push({
          id: `contains_${rootSceneNode.id}_${res.path}`,
          source: rootSceneNode.id,
          target: res.path,
          relation: 'CONTAINS',
          confidence: 'EXTRACTED',
          sourceLine: lineNum,
        });
      }
    }
  }

  return {
    filePath,
    language: 'godot',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}

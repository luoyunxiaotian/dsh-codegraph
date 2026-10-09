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
  formatContractEndpointId,
  normalizeRoutePattern,
} from '../scip-utils.js';

export class OpenApiExtractor implements LanguageExtractor {
  public readonly language = 'openapi';
  public readonly fileExtensions = [
    '.openapi.json',
    '.swagger.json',
    '.openapi.yaml',
    '.openapi.yml',
    '.swagger.yaml',
    '.swagger.yml',
  ];
  public readonly wasmGrammarName = 'none';

  public extractFile(
    _tree: any,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractOpenApiFile(filePath, sourceCode);
  }
}

/**
 * 极简健壮的 OpenAPI YAML 解析器 (无需重型外部依赖)
 */
function parseSimpleYaml(yamlStr: string): any {
  const lines = yamlStr.split('\n');
  const root: Record<string, any> = {};
  const stack: Array<{ indent: number; obj: any; key: string | null }> = [
    { indent: -1, obj: root, key: null },
  ];

  for (const rawLine of lines) {
    const commentIdx = rawLine.indexOf('#');
    const line = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;
    if (!line.trim()) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const current = stack[stack.length - 1].obj;

    // 列表项: - value 或 - key: value
    if (trimmed.startsWith('- ')) {
      const valStr = trimmed.slice(2).trim();
      const parentContext = stack[stack.length - 1];
      if (parentContext.key && !Array.isArray(parentContext.obj[parentContext.key])) {
        parentContext.obj[parentContext.key] = [];
      }
      const targetArr = Array.isArray(current)
        ? current
        : parentContext.key
        ? parentContext.obj[parentContext.key]
        : null;

      if (valStr.includes(':')) {
        const colonIdx = valStr.indexOf(':');
        const k = valStr.slice(0, colonIdx).trim().replace(/^["']|["']$/g, '');
        const v = valStr.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
        const itemObj = { [k]: v };
        if (targetArr) targetArr.push(itemObj);
        stack.push({ indent, obj: itemObj, key: k });
      } else {
        if (targetArr) targetArr.push(valStr.replace(/^["']|["']$/g, ''));
      }
      continue;
    }

    // 键值对: key: value 或 key:
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim().replace(/^["']|["']$/g, '');
      const value = trimmed.slice(colonIdx + 1).trim();

      if (!value) {
        const newObj: Record<string, any> = {};
        if (Array.isArray(current)) {
          current.push({ [key]: newObj });
        } else {
          current[key] = newObj;
        }
        stack.push({ indent, obj: newObj, key });
      } else {
        const cleanVal = value.replace(/^["']|["']$/g, '');
        if (Array.isArray(current)) {
          current.push({ [key]: cleanVal });
        } else {
          current[key] = cleanVal;
        }
      }
    }
  }

  return root;
}

/**
 * 深度解析 OpenAPI / Swagger 规范契约文件
 * 提取 API 契约中枢 (CONTRACT_ENDPOINT)、RESTful 路由、入参/出参 Schema 数据模型
 */
export function extractOpenApiFile(
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

  // 1. 创建文件节点
  const fileNodeId = formatNodeId(filePath, 'file');
  const fileNode: CodeNode = {
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'openapi',
    scipUri: formatScipUri('openapi', filePath, '', fileName, 'def'),
    loc: { startLine: 1, endLine: lines.length },
  };
  nodes.push(fileNode);

  let spec: any = {};
  try {
    const trimmedCode = sourceCode.trim();
    if (trimmedCode.startsWith('{') || trimmedCode.startsWith('[')) {
      spec = JSON.parse(sourceCode);
    } else {
      spec = parseSimpleYaml(sourceCode);
    }
  } catch (err) {
    console.warn(`[OpenApiExtractor] 解析 OpenAPI 规范失败: ${filePath}`, err);
    return {
      filePath,
      language: 'openapi',
      nodes,
      edges,
      imports,
      unresolvedCalls,
      unresolvedInheritance,
    };
  }

  // 2. 创建 API Spec 模块中枢容器
  const title = (spec.info && typeof spec.info.title === 'string')
    ? spec.info.title
    : fileName.replace(/\.(json|yaml|yml)$/i, '');
  const version = spec.info?.version ? ` (v${spec.info.version})` : '';

  const specNodeId = formatNodeId(filePath, 'spec');
  const specNode: CodeNode = {
    id: specNodeId,
    name: `${title}${version}`,
    qualifiedName: formatQualifiedName(filePath, 'spec'),
    entityType: 'MODULE',
    semanticRole: 'CONTRACT',
    filePath,
    language: 'openapi',
    scipUri: formatScipUri('openapi', filePath, '', 'spec', 'class'),
    metadata: {
      title,
      version: spec.info?.version,
      openapiVersion: spec.openapi || spec.swagger,
    },
    loc: { startLine: 1, endLine: lines.length },
  };
  nodes.push(specNode);

  edges.push({
    id: `contains_${fileNodeId}_${specNodeId}`,
    source: fileNodeId,
    target: specNodeId,
    relation: 'CONTAINS',
    confidence: 'EXTRACTED',
  });

  // 3. 提取 paths 下的 REST API 契约端点
  const paths = spec.paths || {};
  const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

  for (const [routePath, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const [method, opItem] of Object.entries(pathItem)) {
      if (!httpMethods.includes(method.toLowerCase())) continue;
      const op = opItem as Record<string, any>;

      const upperMethod = method.toUpperCase();
      const normRoute = normalizeRoutePattern(routePath);
      const contractId = formatContractEndpointId(upperMethod, normRoute);

      const endpointNode: CodeNode = {
        id: contractId,
        name: `${upperMethod} ${normRoute}`,
        qualifiedName: `contract.rest.${method.toLowerCase()}.${normRoute}`,
        entityType: 'CONTRACT_ENDPOINT',
        semanticRole: 'CONTRACT',
        filePath,
        language: 'openapi',
        scipUri: `scip/openapi/contract/${upperMethod}${normRoute}`,
        docstring: typeof op.summary === 'string' ? op.summary : (typeof op.description === 'string' ? op.description : undefined),
        endpointMeta: {
          httpMethod: upperMethod,
          routePath: normRoute,
          isClientCall: false,
        },
        metadata: {
          operationId: op.operationId,
          tags: op.tags,
        },
        loc: { startLine: 1, endLine: lines.length },
      };
      nodes.push(endpointNode);

      // Spec 模块容器包含该 REST 契约端点
      edges.push({
        id: `contains_${specNodeId}_${contractId}`,
        source: specNodeId,
        target: contractId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });
    }
  }

  // 4. 提取 Schemas / Definitions 数据模型
  const schemas = (spec.components && spec.components.schemas) || spec.definitions || {};
  for (const [schemaName, schemaObj] of Object.entries(schemas)) {
    if (!schemaObj || typeof schemaObj !== 'object') continue;

    const schemaNodeId = formatNodeId(filePath, schemaName);
    const schemaNode: CodeNode = {
      id: schemaNodeId,
      name: schemaName,
      qualifiedName: formatQualifiedName(filePath, schemaName),
      entityType: 'CLASS',
      semanticRole: 'MODEL',
      filePath,
      language: 'openapi',
      scipUri: formatScipUri('openapi', filePath, '', schemaName, 'class'),
      loc: { startLine: 1, endLine: lines.length },
    };
    nodes.push(schemaNode);

    edges.push({
      id: `contains_${specNodeId}_${schemaNodeId}`,
      source: specNodeId,
      target: schemaNodeId,
      relation: 'CONTAINS',
      confidence: 'EXTRACTED',
    });
  }

  return {
    filePath,
    language: 'openapi',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}

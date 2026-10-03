/**
 * 工业级 SCIP (Sourcegraph Code Intelligence Protocol) 规范符号与统一节点 ID 格式化工具
 */

export function sanitizeIdentifier(str: string): string {
  return str.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * 根据相对文件路径与实体名称生成安全、唯一的节点 ID
 */
export function formatNodeId(filePath: string, entityName: string, suffix: string = ''): string {
  const cleanPath = filePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toLowerCase();
  const cleanEntity = entityName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  const s = suffix ? `_${sanitizeIdentifier(suffix).toLowerCase()}` : '';
  return `${cleanPath}_${cleanEntity}${s}`;
}

/**
 * 根据相对文件路径与实体名称生成语言限定名 (Qualified Name)
 */
export function formatQualifiedName(filePath: string, entityName: string): string {
  const cleanPath = filePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\.[^/.]+$/, '')
    .replace(/\//g, '.');
  return `${cleanPath}.${entityName}`;
}

/**
 * 生成符合 SCIP 规范的全球唯一符号 URI
 * 格式: scip/<language>/<package>/<filePath>#<descriptor>
 * 例如:
 *  scip/python/local/app/routers/auth.py#UserRouter#post_login().
 *  scip/typescript/local/src/api/user.ts#getUser().
 *  scip/go/local/internal/service/user.go#UserService#Get().
 */
export function formatScipUri(
  language: string,
  filePath: string,
  scope: string,
  symbolName: string,
  kind: 'def' | 'method' | 'class' | 'interface' | 'var' = 'def'
): string {
  const cleanPath = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const scopePart = scope ? `${scope}#` : '';
  let descriptor = symbolName;
  if (kind === 'method' || kind === 'def') {
    descriptor = `${symbolName}().`;
  } else if (kind === 'class' || kind === 'interface') {
    descriptor = `${symbolName}#`;
  }
  return `scip/${language}/local/${cleanPath}#${scopePart}${descriptor}`;
}

/**
 * 规范化 HTTP REST API 路由模式路径
 * 将不同语言/框架的动态参数统一定义为 {param} 格式
 * 例如:
 *   /api/v1/users/:id        -> /api/v1/users/{param}
 *   /api/v1/users/{user_id}  -> /api/v1/users/{param}
 *   /api/v1/users/<int:id>   -> /api/v1/users/{param}
 *   /api/v1/users/${id}      -> /api/v1/users/{param}
 */
export function normalizeRoutePattern(routePath: string): string {
  if (!routePath) return '/';
  let norm = routePath.trim();
  if (!norm.startsWith('/')) norm = '/' + norm;
  
  // 移除尾部斜杠 (根路由除外)
  if (norm.length > 1 && norm.endsWith('/')) {
    norm = norm.slice(0, -1);
  }

  // 1. FastAPI / Django / Spring: {id}, {user_id} -> {param}
  norm = norm.replace(/\{[a-zA-Z0-9_]+\}/g, '{param}');

  // 2. Express / Gin: :id, :user_id -> {param}
  norm = norm.replace(/:[a-zA-Z0-9_]+/g, '{param}');

  // 3. Flask / Django: <int:id>, <str:name>, <id> -> {param}
  norm = norm.replace(/<([a-zA-Z0-9_]+:)?[a-zA-Z0-9_]+>/g, '{param}');

  // 4. 前端模板字符串: ${id}, ${userId} -> {param}
  norm = norm.replace(/\$\{[^}]+\}/g, '{param}');

  return norm.toLowerCase();
}

/**
 * 契约中枢 Node ID 构造器
 */
export function formatContractEndpointId(method: string, normalizedRoute: string): string {
  const cleanMethod = (method || 'GET').toUpperCase();
  const cleanRoute = normalizedRoute.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  return `contract_rest_${cleanMethod.toLowerCase()}_${cleanRoute}`;
}

export function formatContractRpcId(serviceName: string, methodName: string): string {
  return `contract_rpc_${sanitizeIdentifier(serviceName).toLowerCase()}_${sanitizeIdentifier(methodName).toLowerCase()}`;
}

export function formatContractTopicId(topicName: string): string {
  return `contract_topic_${sanitizeIdentifier(topicName).toLowerCase()}`;
}

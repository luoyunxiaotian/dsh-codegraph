import Parser from 'web-tree-sitter';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 语言支持列表及对应的 wasm 文件名映射
const WASM_FILE_MAP: Record<string, string> = {
  python: 'tree-sitter-python.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  go: 'tree-sitter-go.wasm',
  java: 'tree-sitter-java.wasm',
  c: 'tree-sitter-c.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  c_sharp: 'tree-sitter-c_sharp.wasm',
};

let isInitialized = false;
const loadedLanguages: Map<string, Parser.Language> = new Map();

/**
 * 递归定位 tree-sitter-wasms 资源目录
 */
function resolveWasmPath(filename: string): string {
  // 备选路径搜索列表
  const candidateDirs = [
    // 0. 打包分发目录 (插件自身内置 wasm)
    path.resolve(__dirname, 'wasm'),
    path.resolve(__dirname, '../wasm'),
    // 1. 本地 node_modules
    path.resolve(process.cwd(), 'node_modules/tree-sitter-wasms/out'),
    path.resolve(process.cwd(), 'packages/core/node_modules/tree-sitter-wasms/out'),
    // 2. 当前模块相对路径
    path.resolve(__dirname, '../../node_modules/tree-sitter-wasms/out'),
    path.resolve(__dirname, '../../../node_modules/tree-sitter-wasms/out'),
    // 3. 上层全局 pnpm store
    path.resolve(process.cwd(), '../../node_modules/tree-sitter-wasms/out'),
  ];

  for (const dir of candidateDirs) {
    const fullPath = path.join(dir, filename);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  // 若搜索失败，尝试使用 require.resolve
  try {
    const pkgPath = require.resolve('tree-sitter-wasms/package.json');
    const fullPath = path.join(path.dirname(pkgPath), 'out', filename);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  } catch {}

  throw new Error(`找不到语法 wasm 文件: ${filename}，请确认已安装 tree-sitter-wasms`);
}

/**
 * 初始化 WebTreeSitter 运行时并载入指定语言
 */
export async function getParserForLanguage(language: string = 'python'): Promise<Parser> {
  if (!isInitialized) {
    await Parser.init();
    isInitialized = true;
  }

  const langKey = language.toLowerCase();
  const wasmFileName = WASM_FILE_MAP[langKey];
  if (!wasmFileName) {
    throw new Error(`暂不支持的语言类型: ${language}`);
  }

  let lang = loadedLanguages.get(langKey);
  if (!lang) {
    const wasmPath = resolveWasmPath(wasmFileName);
    lang = await Parser.Language.load(wasmPath);
    loadedLanguages.set(langKey, lang);
  }

  const parser = new Parser();
  parser.setLanguage(lang);
  return parser;
}

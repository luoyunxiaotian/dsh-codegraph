import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function bundlePlugin() {
  console.log('📦 开始打包 DeepSeek Harness 代码图谱插件 (dsh-codegraph)...');

  const distDir = path.join(rootDir, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // 1. 构建 Host 端插件 (Node 运行环境，包含本地 AST 拓扑引擎与静态服务)
  console.log('  -> 构建 Host 端插件 dist/index.js...');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'packages/harness-adapter/src/index.ts')],
    outfile: path.join(distDir, 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: [
      'cordis',
      '@deepseek-ai/cordis',
      'tree-sitter-wasms',
    ],
    banner: {
      js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    },
    sourcemap: false,
  });

  // 2. 构建 Client 端插件 (Web 浏览器/React 运行环境 - 注册「代码图谱」会话视窗)
  console.log('  -> 构建 Client 端插件 dist/client.js...');
  const clientBanner = `const registerCodeGraph = (require) => {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
`;
  const clientFooter = `
  return module.exports;
};
if (typeof window !== "undefined" && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === "function") {
  window.__ModuleLoader__.load({ id: "dsh-codegraph", factory: registerCodeGraph });
  window.__ModuleLoader__.load({ id: "@codegraph/harness-adapter", factory: registerCodeGraph });
}
`;

  await esbuild.build({
    entryPoints: [path.join(rootDir, 'packages/harness-adapter/src/client.ts')],
    outfile: path.join(distDir, 'client.js'),
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    external: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/cordis',
    ],
    banner: { js: clientBanner },
    footer: { js: clientFooter },
    sourcemap: false,
  });

  // 3. 复制 Webview 编译产物到 dist/webview
  console.log('  -> 同步前端可视化静态资源到 dist/webview...');
  const webviewSrcDir = path.join(rootDir, 'packages/webview/dist');
  const webviewDestDir = path.join(distDir, 'webview');
  if (fs.existsSync(webviewSrcDir)) {
    fs.cpSync(webviewSrcDir, webviewDestDir, { recursive: true });
  } else {
    console.warn('  ⚠️ 提示: packages/webview/dist 未生成，建议先运行 pnpm -r run build');
  }

  // 4. 复制常用语言 Tree-Sitter WASM 语法包到 dist/wasm
  console.log('  -> 同步 Tree-Sitter WASM 语法包到 dist/wasm...');
  const wasmDestDir = path.join(distDir, 'wasm');
  if (!fs.existsSync(wasmDestDir)) {
    fs.mkdirSync(wasmDestDir, { recursive: true });
  }

  // 寻找 tree-sitter-wasms 的 out 目录
  const candidateWasmDirs = [
    path.join(rootDir, 'node_modules/tree-sitter-wasms/out'),
    path.join(rootDir, 'packages/core/node_modules/tree-sitter-wasms/out'),
  ];
  let foundWasmDir = candidateWasmDirs.find((d) => fs.existsSync(d));

  if (!foundWasmDir) {
    // 递归寻找 .pnpm 下的 tree-sitter-wasms
    const pnpmDir = path.join(rootDir, 'node_modules/.pnpm');
    if (fs.existsSync(pnpmDir)) {
      const entries = fs.readdirSync(pnpmDir);
      for (const entry of entries) {
        if (entry.startsWith('tree-sitter-wasms@')) {
          const testPath = path.join(pnpmDir, entry, 'node_modules/tree-sitter-wasms/out');
          if (fs.existsSync(testPath)) {
            foundWasmDir = testPath;
            break;
          }
        }
      }
    }
  }

  if (foundWasmDir) {
    fs.cpSync(foundWasmDir, wasmDestDir, { recursive: true });
    console.log(`     已复制 WASM 语法包 (${fs.readdirSync(wasmDestDir).length} 个语法文件)`);
  }

  // 寻找 web-tree-sitter 的 tree-sitter.wasm
  const candidateTreeSitterWasm = [
    path.join(rootDir, 'node_modules/web-tree-sitter/tree-sitter.wasm'),
    path.join(rootDir, 'packages/core/node_modules/web-tree-sitter/tree-sitter.wasm'),
  ];
  let foundTreeSitterWasm = candidateTreeSitterWasm.find((f) => fs.existsSync(f));
  if (!foundTreeSitterWasm) {
    const pnpmDir = path.join(rootDir, 'node_modules/.pnpm');
    if (fs.existsSync(pnpmDir)) {
      const entries = fs.readdirSync(pnpmDir);
      for (const entry of entries) {
        if (entry.startsWith('web-tree-sitter@')) {
          const testPath = path.join(pnpmDir, entry, 'node_modules/web-tree-sitter/tree-sitter.wasm');
          if (fs.existsSync(testPath)) {
            foundTreeSitterWasm = testPath;
            break;
          }
        }
      }
    }
  }

  if (foundTreeSitterWasm) {
    fs.copyFileSync(foundTreeSitterWasm, path.join(distDir, 'tree-sitter.wasm'));
    fs.copyFileSync(foundTreeSitterWasm, path.join(wasmDestDir, 'tree-sitter.wasm'));
  }

  console.log('✅ DeepSeek Harness 插件打包完成！输出路径: dist/');
}

bundlePlugin().catch((err) => {
  console.error('❌ 打包失败:', err);
  process.exit(1);
});

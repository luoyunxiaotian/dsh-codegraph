import esbuild from 'esbuild';
import fs from 'fs';

if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist', { recursive: true });
}

async function run() {
  console.log('Building @codegraph/harness-adapter...');

  // 1. 构建 Host 端插件 (Node 运行环境)
  await esbuild.build({
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.js',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['@codegraph/core', 'cordis', 'path', 'fs', 'url', 'http'],
    sourcemap: true,
  });

  // 2. 构建 Client 端插件 (Web 浏览器/React 运行环境 - DSH ModuleLoader CJS Factory 格式)
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
    entryPoints: ['src/client.ts'],
    outfile: 'dist/client.js',
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/cordis'],
    banner: { js: clientBanner },
    footer: { js: clientFooter },
    sourcemap: true,
  });

  console.log('✅ @codegraph/harness-adapter 编译完成！');
}

run().catch((err) => {
  console.error('编译失败:', err);
  process.exit(1);
});

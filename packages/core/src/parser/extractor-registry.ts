import path from 'path';
import { LanguageExtractor } from '../types/index.js';
import { PythonExtractor } from './extractors/python-extractor.js';
import { TypeScriptExtractor } from './extractors/typescript-extractor.js';
import { GoExtractor } from './extractors/go-extractor.js';
import { JavaExtractor } from './extractors/java-extractor.js';
import { RustExtractor } from './extractors/rust-extractor.js';
import { CppExtractor } from './extractors/cpp-extractor.js';
import { CSharpExtractor } from './extractors/csharp-extractor.js';
import { VueExtractor } from './extractors/vue-extractor.js';
import { KotlinExtractor } from './extractors/kotlin-extractor.js';
import { SwiftExtractor } from './extractors/swift-extractor.js';
import { LuaExtractor } from './extractors/lua-extractor.js';
import { UnityAsmdefExtractor } from './extractors/unity-asmdef-extractor.js';
import { GodotExtractor } from './extractors/godot-extractor.js';
import { ProtoExtractor } from './extractors/proto-extractor.js';
import { OpenApiExtractor } from './extractors/openapi-extractor.js';
import { SqlExtractor } from './extractors/sql-extractor.js';
import { DartExtractor } from './extractors/dart-extractor.js';
import { PhpExtractor } from './extractors/php-extractor.js';
import { RubyExtractor } from './extractors/ruby-extractor.js';

export class ExtractorRegistry {
  private static protoExtractor = new ProtoExtractor();
  private static openApiExtractor = new OpenApiExtractor();
  private static sqlExtractor = new SqlExtractor();

  private static extractors: LanguageExtractor[] = [
    new PythonExtractor(),
    new TypeScriptExtractor(),
    new GoExtractor(),
    new JavaExtractor(),
    new RustExtractor(),
    new CppExtractor(),
    new CSharpExtractor(),
    new VueExtractor(),
    new KotlinExtractor(),
    new SwiftExtractor(),
    new LuaExtractor(),
    new UnityAsmdefExtractor(),
    new GodotExtractor(),
    ExtractorRegistry.protoExtractor,
    ExtractorRegistry.openApiExtractor,
    ExtractorRegistry.sqlExtractor,
    new DartExtractor(),
    new PhpExtractor(),
    new RubyExtractor(),
  ];

  private static extMap: Map<string, LanguageExtractor> = new Map();

  static {
    for (const extractor of this.extractors) {
      for (const ext of extractor.fileExtensions) {
        this.extMap.set(ext.toLowerCase(), extractor);
      }
    }
  }

  /**
   * 根据文件路径查找适用的提取器
   */
  public static getExtractorForFile(filePath: string): LanguageExtractor | undefined {
    const baseName = path.basename(filePath).toLowerCase();
    // 优先匹配 OpenAPI / Swagger 规范契约文件
    if (
      /^(openapi|swagger)\.(json|yaml|yml)$/i.test(baseName) ||
      baseName.endsWith('.openapi.json') ||
      baseName.endsWith('.swagger.json') ||
      baseName.endsWith('.openapi.yaml') ||
      baseName.endsWith('.openapi.yml') ||
      baseName.endsWith('.swagger.yaml') ||
      baseName.endsWith('.swagger.yml') ||
      ((baseName.includes('openapi') || baseName.includes('swagger')) && /\.(json|yaml|yml)$/i.test(baseName))
    ) {
      return this.openApiExtractor;
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.proto') return this.protoExtractor;
    if (ext === '.sql') return this.sqlExtractor;

    return this.extMap.get(ext);
  }

  /**
   * 获取文件对应的 Tree-Sitter Wasm 语法模块名
   */
  public static getWasmGrammarForFile(filePath: string): string | undefined {
    const baseName = path.basename(filePath).toLowerCase();
    if (
      /^(openapi|swagger)\.(json|yaml|yml)$/i.test(baseName) ||
      baseName.includes('openapi') ||
      baseName.includes('swagger')
    ) {
      return 'none';
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.tsx') return 'tsx';
    if (ext === '.jsx' || ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'javascript';
    if (ext === '.c' || ext === '.h') return 'c';
    if (ext === '.cpp' || ext === '.cc' || ext === '.cxx' || ext === '.hpp' || ext === '.hxx') return 'cpp';
    if (ext === '.cs') return 'c_sharp';
    if (ext === '.rs') return 'rust';
    if (ext === '.go') return 'go';
    if (ext === '.java') return 'java';
    if (ext === '.py') return 'python';
    if (ext === '.ts') return 'typescript';
    if (ext === '.vue') return 'vue';
    if (ext === '.kt' || ext === '.kts') return 'kotlin';
    if (ext === '.swift') return 'swift';
    if (ext === '.lua') return 'lua';
    if (ext === '.dart') return 'dart';
    if (ext === '.php') return 'php';
    if (ext === '.rb') return 'ruby';
    if (ext === '.asmdef' || ext === '.asmref') return 'none';
    if (ext === '.gd' || ext === '.tscn') return 'none';
    if (ext === '.proto') return 'none';
    if (ext === '.sql') return 'none';

    const extractor = this.getExtractorForFile(filePath);
    return extractor ? extractor.wasmGrammarName : undefined;
  }

  /**
   * 获取所有支持的文件后缀列表 (包含点号)
   */
  public static getAllSupportedExtensions(): string[] {
    const exts = Array.from(this.extMap.keys());
    if (!exts.includes('.proto')) exts.push('.proto');
    if (!exts.includes('.sql')) exts.push('.sql');
    return exts;
  }

  /**
   * 获取 fast-glob 扫描模式串
   */
  public static getGlobPatterns(): string[] {
    const cleanExts = Array.from(this.extMap.keys())
      .filter((e) => !e.includes('.' + e.slice(1) + '.')) // 过滤多段后缀如 .openapi.json
      .map((e) => e.replace(/^\./, ''));
    
    // 确保核心后缀均包含
    if (!cleanExts.includes('proto')) cleanExts.push('proto');
    if (!cleanExts.includes('sql')) cleanExts.push('sql');

    return [
      `**/*.{${cleanExts.join(',')}}`,
      `**/*openapi*.{json,yaml,yml}`,
      `**/*swagger*.{json,yaml,yml}`,
    ];
  }

  /**
   * 获取当前支持的所有语言名称
   */
  public static getSupportedLanguages(): string[] {
    return this.extractors.map((e) => e.language);
  }
}

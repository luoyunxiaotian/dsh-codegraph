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

export class ExtractorRegistry {
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
    const ext = path.extname(filePath).toLowerCase();
    return this.extMap.get(ext);
  }

  /**
   * 获取文件对应的 Tree-Sitter Wasm 语法模块名
   */
  public static getWasmGrammarForFile(filePath: string): string | undefined {
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
    if (ext === '.asmdef' || ext === '.asmref') return 'none';
    if (ext === '.gd' || ext === '.tscn') return 'none';

    const extractor = this.extMap.get(ext);
    return extractor ? extractor.wasmGrammarName : undefined;
  }

  /**
   * 获取所有支持的文件后缀列表 (包含点号)
   */
  public static getAllSupportedExtensions(): string[] {
    return Array.from(this.extMap.keys());
  }

  /**
   * 获取 fast-glob 扫描模式串
   */
  public static getGlobPatterns(): string[] {
    const cleanExts = Array.from(this.extMap.keys()).map((e) => e.replace(/^\./, ''));
    return [`**/*.{${cleanExts.join(',')}}`];
  }

  /**
   * 获取当前支持的所有语言名称
   */
  public static getSupportedLanguages(): string[] {
    return this.extractors.map((e) => e.language);
  }
}

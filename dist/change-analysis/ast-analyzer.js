import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { hashParts, readJsonCache, writeJsonCache, writePipelineLog } from '../infrastructure/model-log.js';
/**
 * @description 分析单个 TS/JS 文件的符号信息。
 * @param {string} filePath 文件路径。
 * @param {string} patchContent 文件补丁。
 * @return {Promise<FileSemanticSnapshot>} 语义快照。
 */
export async function analyzeFileSemantics(filePath, patchContent) {
    const dependencyChanges = extractDependencyChanges(patchContent);
    if (!/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i.test(filePath)) {
        return {
            symbols: [],
            exportedSymbols: [],
            dependencyChanges
        };
    }
    try {
        const content = await readFile(filePath, 'utf8');
        const cacheKey = hashParts('semantic-v1', filePath, content, patchContent);
        const cached = await readJsonCache('semantics', cacheKey);
        if (cached) {
            await writePipelineLog('semantic.cache', {
                filePath,
                hit: true,
                symbols: cached.symbols.length,
                exportedSymbols: cached.exportedSymbols.length,
                dependencyChanges: cached.dependencyChanges.length
            });
            return cached;
        }
        const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
        const declaredSymbols = collectTopLevelSymbols(sourceFile);
        const exportedSymbols = collectExportedSymbols(sourceFile);
        const patchIdentifiers = extractPatchIdentifiers(patchContent);
        const matchedSymbols = declaredSymbols.filter((item) => patchIdentifiers.has(item));
        const fallbackSymbols = exportedSymbols.length > 0 ? exportedSymbols : declaredSymbols;
        const snapshot = {
            symbols: (matchedSymbols.length > 0 ? matchedSymbols : fallbackSymbols).slice(0, 4),
            exportedSymbols: exportedSymbols.slice(0, 4),
            dependencyChanges
        };
        await writeJsonCache('semantics', cacheKey, snapshot);
        await writePipelineLog('semantic.cache', {
            filePath,
            hit: false,
            symbols: snapshot.symbols.length,
            exportedSymbols: snapshot.exportedSymbols.length,
            dependencyChanges: snapshot.dependencyChanges.length
        });
        return snapshot;
    }
    catch {
        return {
            symbols: [],
            exportedSymbols: [],
            dependencyChanges
        };
    }
}
/**
 * @description 收集顶层声明符号。
 * @param {ts.SourceFile} sourceFile 源文件。
 * @return {string[]} 顶层符号列表。
 */
function collectTopLevelSymbols(sourceFile) {
    const symbols = [];
    sourceFile.forEachChild((node) => {
        if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
            if (node.name?.text) {
                symbols.push(node.name.text);
            }
            return;
        }
        if (ts.isVariableStatement(node)) {
            node.declarationList.declarations.forEach((declaration) => {
                if (ts.isIdentifier(declaration.name)) {
                    symbols.push(declaration.name.text);
                }
            });
        }
    });
    return Array.from(new Set(symbols));
}
/**
 * @description 收集导出符号。
 * @param {ts.SourceFile} sourceFile 源文件。
 * @return {string[]} 导出符号列表。
 */
function collectExportedSymbols(sourceFile) {
    const exported = [];
    sourceFile.forEachChild((node) => {
        const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
        const isExported = Boolean(modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword));
        if (!isExported) {
            return;
        }
        if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) && node.name?.text) {
            exported.push(node.name.text);
            return;
        }
        if (ts.isVariableStatement(node)) {
            node.declarationList.declarations.forEach((declaration) => {
                if (ts.isIdentifier(declaration.name)) {
                    exported.push(declaration.name.text);
                }
            });
        }
    });
    return Array.from(new Set(exported));
}
/**
 * @description 从补丁中提取标识符。
 * @param {string} patchContent 文件补丁。
 * @return {Set<string>} 标识符集合。
 */
function extractPatchIdentifiers(patchContent) {
    const identifiers = new Set();
    const matches = patchContent.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) || [];
    matches.forEach((item) => {
        identifiers.add(item);
    });
    return identifiers;
}
/**
 * @description 提取依赖相关变化。
 * @param {string} patchContent 文件补丁。
 * @return {string[]} 依赖变化列表。
 */
function extractDependencyChanges(patchContent) {
    const changes = new Set();
    patchContent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^[+-]\s*(import|export)\b/.test(line) || /^[+-].*from\s+['"].+['"]/.test(line))
        .forEach((line) => {
        const moduleName = line.match(/from\s+['"]([^'"]+)['"]/)?.[1] || line.match(/import\s+['"]([^'"]+)['"]/)?.[1];
        if (moduleName) {
            changes.add(moduleName);
        }
    });
    return Array.from(changes).slice(0, 4);
}

import { analyzeFileSemantics } from './ast-analyzer.js';
import { getFileRole } from './file-classifier.js';
/**
 * @description 构建结构化变更 IR。
 * @param {object} input 输入参数。
 * @param {SummarySource} input.source 变更来源。
 * @param {SummaryStrategy} input.strategy 摘要策略。
 * @param {ChangedFile[]} input.files 文件列表。
 * @param {FilePatch[]} input.patches 分文件补丁。
 * @return {Promise<ChangeIR>} 结构化 IR。
 */
export async function buildChangeIR(input) {
    const patchMap = new Map(input.patches.map((item) => [item.path, item.content]));
    const changes = await Promise.all(input.files.map(async (file) => {
        const patchContent = patchMap.get(file.path) || '';
        const semantics = await analyzeFileSemantics(file.path, patchContent);
        const role = getFileRole(file.path);
        return {
            file: file.path,
            role,
            status: file.status,
            added: file.added || 0,
            removed: file.removed || 0,
            total: file.total || 0,
            symbols: semantics.symbols,
            dependencyChanges: semantics.dependencyChanges,
            summary: buildFileChangeSummary(file, role, semantics.symbols, semantics.dependencyChanges)
        };
    }));
    const tests = changes.filter((item) => item.role === 'test').map((item) => item.file);
    return {
        overview: {
            source: input.source,
            filesChanged: input.files.length,
            addedLines: input.files.reduce((total, item) => total + (item.added || 0), 0),
            deletedLines: input.files.reduce((total, item) => total + (item.removed || 0), 0),
            strategy: input.strategy
        },
        changes,
        tests,
        risks: buildRiskHints(changes, tests.length > 0)
    };
}
/**
 * @description 构建文件级变更摘要。
 * @param {ChangedFile} file 文件信息。
 * @param {string} role 文件角色。
 * @param {string[]} symbols 变更符号。
 * @param {string[]} dependencyChanges 依赖变化。
 * @return {string} 文件摘要。
 */
function buildFileChangeSummary(file, role, symbols, dependencyChanges) {
    const action = inferAction(file.status);
    const symbolPart = symbols.length > 0 ? ` around ${symbols.join(', ')}` : '';
    const dependencyPart = dependencyChanges.length > 0 ? ` with dependency changes: ${dependencyChanges.join(', ')}` : '';
    return `${action} ${role} file${symbolPart}${dependencyPart}`.trim();
}
/**
 * @description 推断动作描述。
 * @param {string} status 文件状态。
 * @return {string} 动作描述。
 */
function inferAction(status) {
    if (status.startsWith('A')) {
        return 'added';
    }
    if (status.startsWith('D')) {
        return 'removed';
    }
    if (status.startsWith('R')) {
        return 'renamed';
    }
    return 'updated';
}
/**
 * @description 构建风险提示。
 * @param {ChangeIR['changes']} changes 文件级变更列表。
 * @param {boolean} hasTests 是否包含测试文件。
 * @return {string[]} 风险提示列表。
 */
function buildRiskHints(changes, hasTests) {
    const risks = new Set();
    if (changes.some((item) => item.role === 'config' || item.dependencyChanges.length > 0)) {
        risks.add('Configuration or dependency related changes may affect runtime behavior.');
    }
    if (changes.some((item) => item.role === 'type')) {
        risks.add('Type or contract changes should be reviewed for compatibility impact.');
    }
    if (changes.some((item) => item.total >= 80)) {
        risks.add('Large file-level changes may hide behavior regressions across multiple code paths.');
    }
    if (!hasTests && changes.some((item) => item.role === 'script')) {
        risks.add('Implementation changed without matching test file updates in the current workspace.');
    }
    return Array.from(risks).slice(0, 4);
}

import {analyzeFileSemantics} from './ast-analyzer.js';
import {getFileRole} from './file-classifier.js';
import {detectRelocatedFiles} from './patch-utils.js';
import type {ChangeIR, ChangeIRFile, ChangeKind, ChangedFile, FilePatch, SummarySource, SummaryStrategy} from './types.js';

/**
 * @description 构建结构化变更 IR。
 * @param {object} input 输入参数。
 * @param {SummarySource} input.source 变更来源。
 * @param {SummaryStrategy} input.strategy 摘要策略。
 * @param {ChangedFile[]} input.files 文件列表。
 * @param {FilePatch[]} input.patches 分文件补丁。
 * @return {Promise<ChangeIR>} 结构化 IR。
 */
export async function buildChangeIR(input: {
  source: SummarySource;
  strategy: SummaryStrategy;
  files: ChangedFile[];
  patches: FilePatch[];
}): Promise<ChangeIR> {
  const patchMap = new Map(input.patches.map((item) => [item.path, item.content]));
  const relocationDetection = detectRelocatedFiles(input.files, input.patches);
  const changes = await Promise.all(
    input.files.map(async (file) => {
      const patchContent = patchMap.get(file.path) || '';
      const semantics = await analyzeFileSemantics(file.path, patchContent);
      const role = getFileRole(file.path);
      const oldFile = relocationDetection.movedFromByFile.get(file.path) || file.oldPath;
      const hasPathOnlyMove = relocationDetection.pureRelocationFiles.has(file.path);
      const evidence = {
        hasCodeLogicChange: file.total > 0 && !hasPathOnlyMove,
        hasExportShapeChange: semantics.exportedSymbols.length > 0 && file.total > 0 && !hasPathOnlyMove,
        hasDependencyChange: semantics.dependencyChanges.length > 0,
        hasPathOnlyMove
      };
      const changeKinds = inferChangeKinds({
        file,
        role,
        oldFile,
        evidence
      });

      return {
        file: file.path,
        oldFile,
        role,
        status: file.status,
        added: file.added || 0,
        removed: file.removed || 0,
        total: file.total || 0,
        symbols: semantics.symbols,
        exportedSymbols: semantics.exportedSymbols,
        dependencyChanges: semantics.dependencyChanges,
        changeKinds,
        evidence,
        summary: buildFileChangeSummary(file, role, semantics.symbols, semantics.dependencyChanges, changeKinds, oldFile)
      };
    })
  );

  const tests = changes.filter((item) => item.role === 'test').map((item) => item.file);
  const primaryIntent = inferPrimaryIntent(changes);
  const hasPureRelocations = changes.some((item) => item.evidence.hasPathOnlyMove);

  return {
    overview: {
      source: input.source,
      filesChanged: input.files.length,
      addedLines: input.files.reduce((total, item) => total + (item.added || 0), 0),
      deletedLines: input.files.reduce((total, item) => total + (item.removed || 0), 0),
      strategy: input.strategy,
      primaryIntent,
      hasPureRelocations
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
function buildFileChangeSummary(file: ChangedFile, role: string, symbols: string[], dependencyChanges: string[], changeKinds: ChangeKind[], oldFile?: string): string {
  if (changeKinds.includes('relocation') && oldFile) {
    const relocationLabel = changeKinds.includes('structure') ? 'relocated file into a new module boundary' : 'relocated file';
    return `${relocationLabel} from ${oldFile} to ${file.path}`.trim();
  }

  const action = inferAction(file.status);
  const symbolPart = symbols.length > 0 ? ` around ${symbols.join(', ')}` : '';
  const dependencyPart = dependencyChanges.length > 0 ? ` with dependency changes: ${dependencyChanges.join(', ')}` : '';
  return `${action} ${role} file${symbolPart}${dependencyPart}`.trim();
}

/**
 * @description 推断文件级语义类别。
 * @param {{ file: ChangedFile; role: string; oldFile?: string; evidence: ChangeIRFile['evidence'] }} input 输入参数。
 * @return {ChangeKind[]} 语义类别列表。
 */
function inferChangeKinds(input: { file: ChangedFile; role: string; oldFile?: string; evidence: ChangeIRFile['evidence'] }): ChangeKind[] {
  const kinds: ChangeKind[] = [];

  if (input.role === 'test') {
    kinds.push('test');
  }

  if (input.role === 'doc') {
    kinds.push('doc');
  }

  if (input.role === 'config') {
    kinds.push('config');
  }

  if (input.oldFile) {
    kinds.push('relocation');
    if (isStructuralMove(input.oldFile, input.file.path)) {
      kinds.push('structure');
    }
  }

  if (input.evidence.hasExportShapeChange) {
    kinds.push('contract');
  }

  if (input.evidence.hasCodeLogicChange && input.role === 'script') {
    kinds.push('behavior');
  }

  if (input.evidence.hasDependencyChange && !kinds.includes('structure')) {
    kinds.push('structure');
  }

  if (kinds.length === 0) {
    kinds.push('structure');
  }

  return Array.from(new Set(kinds));
}

/**
 * @description 推断动作描述。
 * @param {string} status 文件状态。
 * @return {string} 动作描述。
 */
function inferAction(status: string): string {
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
 * @description 判断路径变化是否属于结构性迁移。
 * @param {string} oldFile 旧路径。
 * @param {string} newFile 新路径。
 * @return {boolean} 是否为结构迁移。
 */
function isStructuralMove(oldFile: string, newFile: string): boolean {
  const oldParts = oldFile.split('/');
  const newParts = newFile.split('/');

  if (oldParts.length <= 2 || newParts.length <= 2) {
    return true;
  }

  return oldParts.slice(0, 2).join('/') !== newParts.slice(0, 2).join('/');
}

/**
 * @description 推断本次改动的主导意图。
 * @param {ChangeIRFile[]} changes 文件级变更。
 * @return {ChangeIR['overview']['primaryIntent']} 主导意图。
 */
function inferPrimaryIntent(changes: ChangeIRFile[]): ChangeIR['overview']['primaryIntent'] {
  const scores = {
    'architecture-restructure': 0,
    'behavior-change': 0,
    'contract-alignment': 0,
    tooling: 0,
    mixed: 0
  };

  changes.forEach((item) => {
    if (item.changeKinds.includes('behavior')) {
      scores['behavior-change'] += 3;
    }

    if (item.changeKinds.includes('contract')) {
      scores['contract-alignment'] += 2;
    }

    if (item.changeKinds.includes('structure') || item.changeKinds.includes('relocation')) {
      scores['architecture-restructure'] += item.evidence.hasPathOnlyMove ? 3 : 2;
    }

    if (item.changeKinds.includes('test') || item.changeKinds.includes('config') || item.changeKinds.includes('doc')) {
      scores.tooling += 1;
    }
  });

  const sorted = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  const [winner, winnerScore] = sorted[0];
  const runnerScore = sorted[1]?.[1] || 0;

  if (winnerScore === 0 || winnerScore === runnerScore) {
    return 'mixed';
  }

  return winner as ChangeIR['overview']['primaryIntent'];
}

/**
 * @description 构建风险提示。
 * @param {ChangeIR['changes']} changes 文件级变更列表。
 * @param {boolean} hasTests 是否包含测试文件。
 * @return {string[]} 风险提示列表。
 */
function buildRiskHints(changes: ChangeIR['changes'], hasTests: boolean): string[] {
  const risks = new Set<string>();

  if (changes.some((item) => item.role === 'config' || item.dependencyChanges.length > 0)) {
    risks.add('Configuration or dependency related changes may affect runtime behavior.');
  }

  if (changes.some((item) => item.role === 'type' || item.changeKinds.includes('contract'))) {
    risks.add('Type or contract changes should be reviewed for compatibility impact.');
  }

  if (changes.some((item) => item.total >= 80 && !item.evidence.hasPathOnlyMove)) {
    risks.add('Large file-level changes may hide behavior regressions across multiple code paths.');
  }

  if (!hasTests && changes.some((item) => item.role === 'script' && item.changeKinds.includes('behavior'))) {
    risks.add('Implementation changed without matching test file updates in the current workspace.');
  }

  return Array.from(risks).slice(0, 4);
}

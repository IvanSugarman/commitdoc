import {buildChangeIR} from '../change-analysis/ir-builder.js';
import {buildContextSummary} from '../change-analysis/context-extractor.js';
import {
  buildFileSummary,
  buildFilesOverview,
  buildGroupSummary,
  buildSemanticHints,
  isHighContextFile,
  isIgnoredFile,
  sortFilesByPriority
} from '../change-analysis/file-classifier.js';
import {buildPatchLineStats, compressPatchSections, optimizeRenameOnlyPatches, parseChangedFiles, splitPatchByFile} from '../change-analysis/patch-utils.js';
import type {FilePatch, SummaryChanges, SummaryStrategy} from '../change-analysis/types.js';
import {collectWorkspaceSnapshot, executeGit, isGitRepo} from '../git/workspace.js';
import {hashParts, readJsonCache, writeJsonCache, writePipelineLog} from '../infrastructure/model-log.js';

export {isGitRepo} from '../git/workspace.js';

/**
 * @description 统计摘要策略。
 * @param {ChangedFile[]} files 文件列表。
 * @param {string} patch 补丁文本。
 * @param {number} highContextCount 高上下文文件数。
 * @return {'incremental'|'contextual'|'compressed'} 策略名称。
 */
function decideStrategy(files: ReturnType<typeof parseChangedFiles>, patch: string, highContextCount: number): SummaryStrategy {
  if (files.length >= 10 || patch.length >= 16000) {
    return 'compressed';
  }

  if (highContextCount > 0 || files.length >= 4 || patch.length >= 6000) {
    return 'contextual';
  }

  return 'incremental';
}

/**
 * @description 根据策略选择最终补丁。
 * @param {FilePatch[]} patches 分文件补丁。
 * @param {'incremental'|'contextual'|'compressed'} strategy 策略名称。
 * @return {string} 最终补丁文本。
 */
function buildStrategyPatch(patches: FilePatch[], strategy: SummaryStrategy): string {
  if (strategy === 'incremental') {
    return compressPatchSections(patches, 2400, 6);
  }

  if (strategy === 'contextual') {
    return compressPatchSections(patches, 1600, 6);
  }

  return compressPatchSections(patches, 1200, 4);
}

/**
 * @description 获取用于 AI 总结的变更内容，优先暂存区，缺失时回退到工作区。
 * @return {Promise<SummaryChanges>} 结构化变更数据。
 */
export async function getChangesForSummary() {
  const snapshot = await collectWorkspaceSnapshot();
  const cacheKey = hashParts('summary-v1', snapshot.source, snapshot.nameStatus, snapshot.patch);
  await writePipelineLog('workspace.snapshot', {
    source: snapshot.source,
    files: snapshot.nameStatus ? snapshot.nameStatus.split('\n').filter(Boolean).length : 0,
    patchChars: snapshot.patch.length
  });

  const cached = await readJsonCache<SummaryChanges>('summary', cacheKey);
  if (cached) {
    await writePipelineLog('summary.cache', {
      hit: true,
      source: cached.source,
      strategy: cached.strategy,
      fileCount: cached.stats.fileCount,
      patchChars: cached.stats.patchChars
    });
    return cached;
  }

  const summary = await buildAdaptiveSummary(snapshot.source, snapshot.nameStatus, snapshot.patch);
  await writeJsonCache('summary', cacheKey, summary);
  await writePipelineLog('summary.cache', {
    hit: false,
    source: summary.source,
    strategy: summary.strategy,
    fileCount: summary.stats.fileCount,
    patchChars: summary.stats.patchChars
  });
  await writePipelineLog('summary.built', {
    source: summary.source,
    strategy: summary.strategy,
    fileCount: summary.stats.fileCount,
    ignoredFileCount: summary.stats.ignoredFileCount,
    highContextFileCount: summary.stats.highContextFileCount,
    irChanges: summary.ir.changes.length,
    irRisks: summary.ir.risks.length
  });
  return summary;
}

/**
 * @description 基于启发式策略构建摘要输入。
 * @param {'staged'|'working-tree'|'mixed-workspace'} source 变更来源。
 * @param {string} nameStatus 文件状态摘要。
 * @param {string} patch 补丁内容。
 * @return {Promise<SummaryChanges>} 结构化摘要输入。
 */
async function buildAdaptiveSummary(source: SummaryChanges['source'], nameStatus: string, patch: string): Promise<SummaryChanges> {
  const allFiles = parseChangedFiles(nameStatus);
  const filteredFiles = allFiles.filter((item) => !isIgnoredFile(item.path));
  const patchSections = splitPatchByFile(patch);
  const optimizedPatchSections = optimizeRenameOnlyPatches(patchSections);
  const filteredPatches = optimizedPatchSections.filter((item) => !isIgnoredFile(item.path));
  const lineStats = buildPatchLineStats(filteredPatches.length > 0 ? filteredPatches : optimizedPatchSections);
  const files = filteredFiles.length > 0 ? filteredFiles : allFiles;
  const patches = filteredPatches.length > 0 ? filteredPatches : patchSections;
  const filesWithStats = files.map((item) => {
    const currentStats = lineStats.get(item.path) || {added: 0, removed: 0, total: 0};
    return {
      ...item,
      ...currentStats
    };
  });
  const prioritizedFiles = sortFilesByPriority(filesWithStats);
  const highContextCount = files.filter((item) => isHighContextFile(item.path)).length;
  const strategy = decideStrategy(files, patch, highContextCount);
  const optimizedPatch = buildStrategyPatch(patches, strategy);
  const contextSummary = strategy === 'incremental' ? '' : await buildContextSummary(prioritizedFiles, strategy === 'compressed' ? 2 : 3);
  const ir = await buildChangeIR({
    source,
    strategy,
    files: prioritizedFiles,
    patches
  });

  return {
    source,
    strategy,
    nameStatus: prioritizedFiles.map((item) => `${item.status}\t${item.path}`).join('\n'),
    patch: optimizedPatch,
    fileSummary: buildFileSummary(prioritizedFiles),
    filesOverview: buildFilesOverview(prioritizedFiles),
    groupSummary: buildGroupSummary(prioritizedFiles),
    semanticHints: buildSemanticHints(prioritizedFiles),
    contextSummary,
    ir,
    stats: {
      fileCount: prioritizedFiles.length,
      ignoredFileCount: allFiles.length - prioritizedFiles.length,
      highContextFileCount: highContextCount,
      patchChars: optimizedPatch.length
    }
  };
}

/**
 * @description 执行 add、commit、push 的自动化流程。
 * @param {{title: string; bullets: string[]}} payload 提交信息。
 * @param {(step: {name: 'add'|'commit'|'push'; status: 'running'|'success'}) => void} [onProgress] 进度回调。
 * @return {Promise<void>} 流程执行完成。
 */
export async function applyCommitAndPush(payload, onProgress) {
  onProgress?.({name: 'add', status: 'running'});
  await executeGit(['add', '-A']);
  onProgress?.({name: 'add', status: 'success'});

  const args = ['commit', '-m', payload.title];
  if (payload.bullets.length > 0) {
    args.push('-m', payload.bullets.map((item) => `- ${item}`).join('\n'));
  }

  onProgress?.({name: 'commit', status: 'running'});
  await executeGit(args);
  onProgress?.({name: 'commit', status: 'success'});

  onProgress?.({name: 'push', status: 'running'});
  await executeGit(['push']);
  onProgress?.({name: 'push', status: 'success'});
}

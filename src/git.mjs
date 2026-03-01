import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';

/** @type {(file: string, args: string[]) => Promise<{stdout: string; stderr: string}>} */
const execFileAsync = promisify(execFile);

/** @type {RegExp[]} */
const IGNORED_FILE_PATTERNS = [
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)coverage\//,
  /(^|\/)node_modules\//,
  /package-lock\.json$/,
  /pnpm-lock\.ya?ml$/,
  /yarn\.lock$/,
  /bun\.lockb?$/,
  /\.min\./,
  /\.map$/,
  /\.snap$/
];

/** @type {Record<string, string>} */
const ENTITY_DISPLAY_NAME_MAP = {
  foooooot: '六只脚'
};

/**
 * @typedef {Object} ChangedFile
 * @property {string} status 文件状态。
 * @property {string} path 文件路径。
 * @property {string} [oldPath] 重命名前的文件路径。
 * @property {number} [added] 新增行数。
 * @property {number} [removed] 删除行数。
 * @property {number} [total] 变更总行数。
 */

/**
 * @typedef {Object} FilePatch
 * @property {string} path 文件路径。
 * @property {string} content 文件补丁内容。
 */

/**
 * @typedef {Object} SummaryStats
 * @property {number} fileCount 文件总数。
 * @property {number} ignoredFileCount 被忽略文件数。
 * @property {number} highContextFileCount 高上下文文件数。
 * @property {number} patchChars 补丁字符数。
 */

/**
 * @typedef {Object} SummaryChanges
 * @property {'staged'|'working-tree'} source 变更来源。
 * @property {'incremental'|'contextual'|'compressed'} strategy 摘要策略。
 * @property {string} nameStatus 文件状态摘要。
 * @property {string} patch 补丁内容。
 * @property {string} fileSummary 文件级摘要。
 * @property {string} filesOverview 文件结构概览。
 * @property {string} groupSummary 分组摘要。
 * @property {string} semanticHints 语义提示。
 * @property {string} contextSummary 上下文摘要。
 * @property {SummaryStats} stats 统计信息。
 */

/**
 * @description 执行 git 命令并返回输出。
 * @param {string[]} args git 参数列表。
 * @return {Promise<string>} 标准输出内容。
 */
async function runGit(args) {
  const {stdout} = await execFileAsync('git', args, {maxBuffer: 10 * 1024 * 1024});
  return stdout.trimEnd();
}

/**
 * @description 判断当前目录是否在 git 仓库内。
 * @return {Promise<boolean>} 是否为 git 仓库。
 */
export async function isGitRepo() {
  try {
    const value = await runGit(['rev-parse', '--is-inside-work-tree']);
    return value === 'true';
  } catch {
    return false;
  }
}

/**
 * @description 获取暂存区文件状态。
 * @return {Promise<string>} 暂存区文件状态文本。
 */
export async function getStagedNameStatus() {
  return runGit(['diff', '--cached', '--name-status']);
}

/**
 * @description 获取暂存区补丁内容。
 * @return {Promise<string>} 暂存区补丁文本。
 */
export async function getStagedPatch() {
  return runGit(['diff', '--cached', '--unified=3']);
}

/**
 * @description 获取工作区文件状态（包含未跟踪文件）。
 * @return {Promise<string>} 工作区文件状态文本。
 */
export async function getWorkingTreeNameStatus() {
  const porcelain = await runGit(['status', '--porcelain']);
  if (!porcelain) {
    return '';
  }

  /** @type {Set<string>} */
  const lines = new Set();
  porcelain.split('\n').forEach((line) => {
    if (!line || line.length < 4) {
      return;
    }

    const status = line.slice(0, 2);
    const filePath = line.slice(3).trim();
    if (!filePath) {
      return;
    }

    if (status === '??') {
      lines.add(`A\t${filePath}`);
      return;
    }

    const code = status[1] !== ' ' ? status[1] : status[0];
    if (code && code !== '?') {
      lines.add(`${code}\t${filePath}`);
    }
  });

  return Array.from(lines).join('\n');
}

/**
 * @description 获取工作区补丁内容（不含暂存区）。
 * @return {Promise<string>} 工作区补丁文本。
 */
export async function getWorkingTreePatch() {
  return runGit(['diff', '--unified=3']);
}

/**
 * @description 获取未跟踪文件列表。
 * @return {Promise<string[]>} 未跟踪文件路径数组。
 */
async function getUntrackedFiles() {
  const output = await runGit(['ls-files', '--others', '--exclude-standard']);
  if (!output) {
    return [];
  }

  return output
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * @description 为未跟踪文件构建伪补丁，便于模型理解新增内容。
 * @param {string[]} files 未跟踪文件路径列表。
 * @param {number} maxFiles 最大处理文件数。
 * @return {Promise<string>} 伪补丁内容。
 */
async function buildUntrackedPseudoPatch(files, maxFiles = 5) {
  /** @type {string[]} */
  const chunks = [];

  for (const file of files.slice(0, maxFiles)) {
    try {
      const content = await readFile(file, 'utf8');
      const lines = content.split('\n').slice(0, 120);
      const plusLines = lines.map((line) => `+${line}`).join('\n');
      chunks.push(
        [
          `diff --git a/${file} b/${file}`,
          'new file mode 100644',
          '--- /dev/null',
          `+++ b/${file}`,
          `@@ -0,0 +1,${lines.length} @@`,
          plusLines
        ].join('\n')
      );
    } catch {
      // 忽略无法读取的文件（例如二进制文件或权限不足）
    }
  }

  return chunks.join('\n\n');
}

/**
 * @description 解析文件状态文本。
 * @param {string} nameStatus 文件状态文本。
 * @return {ChangedFile[]} 结构化文件列表。
 */
function parseChangedFiles(nameStatus) {
  return nameStatus
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const status = parts[0]?.trim() || '';
      /** @type {string} */
      let filePath = '';
      /** @type {string | undefined} */
      let oldPath;

      if (/^[RC]/.test(status) && parts.length >= 3) {
        oldPath = parts[1]?.trim() || undefined;
        filePath = parts[2]?.trim() || '';
      } else {
        filePath = parts.slice(1).join('\t').trim();
      }

      return {
        status,
        path: filePath,
        oldPath
      };
    })
    .filter((item) => item.path);
}

/**
 * @description 统计每个补丁文件的增删行数。
 * @param {FilePatch[]} patches 分文件补丁。
 * @return {Map<string, {added: number; removed: number; total: number}>} 行数统计映射。
 */
function buildPatchLineStats(patches) {
  /** @type {Map<string, {added: number; removed: number; total: number}>} */
  const stats = new Map();

  patches.forEach((item) => {
    let added = 0;
    let removed = 0;

    item.content.split('\n').forEach((line) => {
      if (!line || /^(\+\+\+|---|@@|diff --git|index |similarity index |rename from |rename to )/.test(line)) {
        return;
      }

      if (line.startsWith('+')) {
        added += 1;
        return;
      }

      if (line.startsWith('-')) {
        removed += 1;
      }
    });

    stats.set(item.path, {
      added,
      removed,
      total: added + removed
    });
  });

  return stats;
}

/**
 * @description 判断文件是否属于低价值噪音文件。
 * @param {string} filePath 文件路径。
 * @return {boolean} 是否忽略。
 */
function isIgnoredFile(filePath) {
  return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * @description 判断文件是否需要额外上下文。
 * @param {string} filePath 文件路径。
 * @return {boolean} 是否为高上下文文件。
 */
function isHighContextFile(filePath) {
  return /(store|state|api|service|types|routes|router|schema|config|hook|hooks|provider|prompt|package\.json)/i.test(filePath);
}

/**
 * @description 获取文件分组键，用于保留多类变更的代表样本。
 * @param {string} filePath 文件路径。
 * @return {string} 分组键。
 */
function getGroupKey(filePath) {
  if (filePath === 'package.json') {
    return 'package.json';
  }

  const parts = filePath.split('/');
  if (parts.length <= 2) {
    return parts.join('/');
  }

  if (parts[0] === 'src' && parts[1] === 'crawler' && parts[2]) {
    return parts.slice(0, 3).join('/');
  }

  if (parts[0] === 'src' && parts[1]) {
    return parts.slice(0, 2).join('/');
  }

  if (parts[0] === 'lbl-resource' && parts[1] && parts[2]) {
    return parts.slice(0, 3).join('/');
  }

  return parts.slice(0, 2).join('/');
}

/**
 * @description 判断文件语义角色。
 * @param {string} filePath 文件路径。
 * @return {'script'|'request'|'doc'|'config'|'type'|'other'} 角色名称。
 */
function getFileRole(filePath) {
  if (filePath === 'package.json') {
    return 'config';
  }

  if (/\/curl\//.test(filePath)) {
    return 'request';
  }

  if (/\/prompt\//.test(filePath) || /\.(md|mdx)$/i.test(filePath)) {
    return 'doc';
  }

  if (/\/types\//.test(filePath) || /types?\.(ts|js)$/i.test(filePath)) {
    return 'type';
  }

  if (/\.(ts|js|tsx|jsx|mjs|cjs|mts|cts)$/i.test(filePath)) {
    return 'script';
  }

  return 'other';
}

/**
 * @description 将补丁按文件切分。
 * @param {string} patch 原始补丁。
 * @return {FilePatch[]} 分文件补丁。
 */
function splitPatchByFile(patch) {
  if (!patch) {
    return [];
  }

  /** @type {string[]} */
  const sections = patch.split(/^diff --git /m).filter(Boolean);
  return sections
    .map((section) => `diff --git ${section}`)
    .map((section) => {
      const match = section.match(/^\+\+\+ b\/(.+)$/m) || section.match(/^diff --git a\/(.+?) b\//m);
      return {
        path: match?.[1]?.trim() || '',
        content: section.trim()
      };
    })
    .filter((item) => item.path && item.content);
}

/**
 * @description 将纯重命名补丁压缩为单行说明，避免浪费 token。
 * @param {FilePatch[]} patches 分文件补丁。
 * @return {FilePatch[]} 优化后的补丁列表。
 */
function optimizeRenameOnlyPatches(patches) {
  return patches.map((item) => {
    if (!/rename from |rename to /m.test(item.content)) {
      return item;
    }

    const lines = item.content.split('\n');
    const hasContentChanges = lines.some((line) => {
      if (!line || /^(\+\+\+|---|@@|diff --git|index |similarity index |rename from |rename to )/.test(line)) {
        return false;
      }

      return line.startsWith('+') || line.startsWith('-');
    });

    if (hasContentChanges) {
      return item;
    }

    const oldPath = item.content.match(/^rename from (.+)$/m)?.[1]?.trim() || item.path;
    const newPath = item.content.match(/^rename to (.+)$/m)?.[1]?.trim() || item.path;

    return {
      ...item,
      content: [`diff --git a/${oldPath} b/${newPath}`, `rename only: ${oldPath} -> ${newPath}`].join('\n')
    };
  });
}

/**
 * @description 按语义分组选择代表性补丁，避免压缩后只保留前几个文件。
 * @param {FilePatch[]} patches 分文件补丁。
 * @param {number} maxFiles 最大保留文件数。
 * @return {FilePatch[]} 代表性补丁列表。
 */
function pickRepresentativePatches(patches, maxFiles) {
  if (patches.length <= maxFiles) {
    return patches;
  }

  /** @type {Map<string, FilePatch[]>} */
  const grouped = new Map();
  patches.forEach((patchItem) => {
    const key = `${getGroupKey(patchItem.path)}::${getFileRole(patchItem.path)}`;
    const current = grouped.get(key) || [];
    current.push(patchItem);
    grouped.set(key, current);
  });

  const prioritizedKeys = Array.from(grouped.keys()).sort((left, right) => {
    const leftRole = left.split('::')[1] || 'other';
    const rightRole = right.split('::')[1] || 'other';
    const order = {config: 0, script: 1, request: 2, doc: 3, type: 4, other: 5};
    return (order[leftRole] ?? 9) - (order[rightRole] ?? 9);
  });

  /** @type {FilePatch[]} */
  const selected = [];
  while (selected.length < maxFiles) {
    let appended = false;

    for (const key of prioritizedKeys) {
      const bucket = grouped.get(key);
      if (!bucket || bucket.length === 0) {
        continue;
      }

      selected.push(bucket.shift());
      appended = true;
      if (selected.length >= maxFiles) {
        break;
      }
    }

    if (!appended) {
      break;
    }
  }

  return selected.filter(Boolean);
}

/**
 * @description 按文件级别压缩补丁体积。
 * @param {FilePatch[]} patches 分文件补丁。
 * @param {number} perFileChars 单文件最大字符数。
 * @param {number} maxFiles 最大保留文件数。
 * @return {string} 压缩后的补丁文本。
 */
function compressPatchSections(patches, perFileChars = 1800, maxFiles = 8) {
  return pickRepresentativePatches(patches, maxFiles)
    .map((item) => {
      if (item.content.length <= perFileChars) {
        return item.content;
      }

      const head = item.content.slice(0, Math.floor(perFileChars * 0.75));
      const tail = item.content.slice(-Math.floor(perFileChars * 0.25));
      return `${head}\n\n...FILE_PATCH_TRUNCATED...\n\n${tail}`;
    })
    .join('\n\n');
}

/**
 * @description 构建分组摘要，帮助模型先理解多类变更的结构。
 * @param {ChangedFile[]} files 文件列表。
 * @return {string} 分组摘要文本。
 */
function buildGroupSummary(files) {
  /** @type {Map<string, {count: number; roles: Set<string>}>} */
  const groups = new Map();

  files.forEach((item) => {
    const key = getGroupKey(item.path);
    const current = groups.get(key) || {count: 0, roles: new Set()};
    current.count += 1;
    current.roles.add(getFileRole(item.path));
    groups.set(key, current);
  });

  return Array.from(groups.entries())
    .map(([group, meta]) => `${group}\tcount=${meta.count}\troles=${Array.from(meta.roles).join(',')}`)
    .join('\n');
}

/**
 * @description 从文件路径中推断实体标识。
 * @param {ChangedFile[]} files 文件列表。
 * @return {string} 实体标识。
 */
function inferEntityName(files) {
  const crawlerEntity = files
    .map((item) => item.path.match(/^src\/crawler\/([^/]+)\//)?.[1])
    .find(Boolean);

  if (crawlerEntity) {
    return crawlerEntity;
  }

  const resourceEntity = files
    .map((item) => item.path.match(/^lbl-resource\/([^/]+)\//)?.[1])
    .find(Boolean);

  return resourceEntity || '';
}

/**
 * @description 将路径实体名转换为更适合展示的名称。
 * @param {string} entity 实体标识。
 * @return {string} 展示名称。
 */
function getEntityDisplayName(entity) {
  return ENTITY_DISPLAY_NAME_MAP[entity] || entity;
}

/**
 * @description 构建语义提示，降低模型只盯实现细节的概率。
 * @param {ChangedFile[]} files 文件列表。
 * @return {string} 语义提示文本。
 */
function buildSemanticHints(files) {
  /** @type {string[]} */
  const hints = [];
  const entity = getEntityDisplayName(inferEntityName(files));
  const crawlerScripts = files.filter((item) => item.path.startsWith('src/crawler/') && getFileRole(item.path) === 'script');
  const requestFiles = files.filter((item) => getFileRole(item.path) === 'request');
  const promptDocs = files.filter((item) => getFileRole(item.path) === 'doc');
  const hasPackageJson = files.some((item) => item.path === 'package.json');

  if (crawlerScripts.length > 0) {
    hints.push(`新增${entity || '目标站点'}相关爬虫脚本`);
  }

  if (requestFiles.length > 0) {
    hints.push(`补充${entity || '目标站点'}请求文件或抓包样例`);
  }

  if (promptDocs.length > 0) {
    hints.push(`补充${entity || '目标站点'}技术方案或实现文档`);
  }

  if (hasPackageJson && crawlerScripts.length > 0) {
    hints.push(`新增对应爬虫启动命令`);
  }

  return hints.join('\n');
}

/**
 * @description 构建文件级摘要。
 * @param {ChangedFile[]} files 文件列表。
 * @param {number} limit 最大条目数。
 * @return {string} 文件级摘要文本。
 */
function buildFileSummary(files, limit = 12) {
  return files
    .slice(0, limit)
    .map((item) => {
      const kind = isHighContextFile(item.path) ? 'high-context' : 'normal';
      return `${item.status}\t${item.path}\t${kind}`;
    })
    .join('\n');
}

/**
 * @description 构建更适合模型快速理解的文件结构概览。
 * @param {ChangedFile[]} files 文件列表。
 * @param {number} limit 最大条目数。
 * @return {string} 文件结构概览文本。
 */
function buildFilesOverview(files, limit = 12) {
  return files
    .slice(0, limit)
    .map((item) => {
      const status = item.status.charAt(0) || 'M';
      const role = getFileRole(item.path);
      const lineInfo = typeof item.total === 'number' ? ` +${item.added || 0}/-${item.removed || 0}` : '';

      if (status === 'R' && item.oldPath) {
        return `${status}\t${item.oldPath} -> ${item.path}\t${role}${lineInfo}`;
      }

      return `${status}\t${item.path}\t${role}${lineInfo}`;
    })
    .join('\n');
}

/**
 * @description 读取单个文件的最小上下文片段。
 * @param {string} filePath 文件路径。
 * @return {Promise<string>} 上下文片段。
 */
async function readFileContext(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n').slice(0, 80);
    return [`[FILE] ${filePath}`, lines.join('\n')].join('\n');
  } catch {
    return '';
  }
}

/**
 * @description 构建高上下文文件摘要。
 * @param {ChangedFile[]} files 文件列表。
 * @param {number} limit 最大处理文件数。
 * @return {Promise<string>} 上下文摘要文本。
 */
async function buildContextSummary(files, limit = 3) {
  const targets = files.filter((item) => isHighContextFile(item.path)).slice(0, limit);
  const chunks = await Promise.all(targets.map((item) => readFileContext(item.path)));
  return chunks.filter(Boolean).join('\n\n');
}

/**
 * @description 统计摘要策略。
 * @param {ChangedFile[]} files 文件列表。
 * @param {string} patch 补丁文本。
 * @param {number} highContextCount 高上下文文件数。
 * @return {'incremental'|'contextual'|'compressed'} 策略名称。
 */
function decideStrategy(files, patch, highContextCount) {
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
function buildStrategyPatch(patches, strategy) {
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
  const [stagedNameStatus, stagedPatch] = await Promise.all([getStagedNameStatus(), getStagedPatch()]);
  if (stagedNameStatus && stagedPatch) {
    return buildAdaptiveSummary('staged', stagedNameStatus, stagedPatch);
  }

  const [workingNameStatus, workingPatch, untrackedFiles] = await Promise.all([getWorkingTreeNameStatus(), getWorkingTreePatch(), getUntrackedFiles()]);
  const untrackedPatch = await buildUntrackedPseudoPatch(untrackedFiles);
  const mergedPatch = [workingPatch, untrackedPatch].filter(Boolean).join('\n\n');

  return buildAdaptiveSummary('working-tree', workingNameStatus, mergedPatch);
}

/**
 * @description 基于启发式策略构建摘要输入。
 * @param {'staged'|'working-tree'} source 变更来源。
 * @param {string} nameStatus 文件状态摘要。
 * @param {string} patch 补丁内容。
 * @return {Promise<SummaryChanges>} 结构化摘要输入。
 */
async function buildAdaptiveSummary(source, nameStatus, patch) {
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
  const highContextCount = files.filter((item) => isHighContextFile(item.path)).length;
  const strategy = decideStrategy(files, patch, highContextCount);
  const optimizedPatch = buildStrategyPatch(patches, strategy);
  const contextSummary = strategy === 'incremental' ? '' : await buildContextSummary(filesWithStats, strategy === 'compressed' ? 2 : 3);

  return {
    source,
    strategy,
    nameStatus: filesWithStats.map((item) => `${item.status}\t${item.path}`).join('\n'),
    patch: optimizedPatch,
    fileSummary: buildFileSummary(filesWithStats),
    filesOverview: buildFilesOverview(filesWithStats),
    groupSummary: buildGroupSummary(filesWithStats),
    semanticHints: buildSemanticHints(filesWithStats),
    contextSummary,
    stats: {
      fileCount: filesWithStats.length,
      ignoredFileCount: allFiles.length - filesWithStats.length,
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
  await runGit(['add', '-A']);
  onProgress?.({name: 'add', status: 'success'});

  const args = ['commit', '-m', payload.title];
  if (payload.bullets.length > 0) {
    args.push('-m', payload.bullets.map((item) => `- ${item}`).join('\n'));
  }

  onProgress?.({name: 'commit', status: 'running'});
  await runGit(args);
  onProgress?.({name: 'commit', status: 'success'});

  onProgress?.({name: 'push', status: 'running'});
  await runGit(['push']);
  onProgress?.({name: 'push', status: 'success'});
}

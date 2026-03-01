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

/**
 * @typedef {Object} ChangedFile
 * @property {string} status 文件状态。
 * @property {string} path 文件路径。
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
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split(/\s+/);
      const filePath = rest.join(' ').split('->').at(-1)?.trim() || '';
      return {
        status,
        path: filePath
      };
    })
    .filter((item) => item.path);
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
  return /(store|state|api|service|types|routes|router|schema|config|hook|hooks|provider)/i.test(filePath);
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
 * @description 按文件级别压缩补丁体积。
 * @param {FilePatch[]} patches 分文件补丁。
 * @param {number} perFileChars 单文件最大字符数。
 * @param {number} maxFiles 最大保留文件数。
 * @return {string} 压缩后的补丁文本。
 */
function compressPatchSections(patches, perFileChars = 1800, maxFiles = 8) {
  return patches
    .slice(0, maxFiles)
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
  const stagedNameStatus = await getStagedNameStatus();
  const stagedPatch = await getStagedPatch();
  if (stagedNameStatus && stagedPatch) {
    return buildAdaptiveSummary('staged', stagedNameStatus, stagedPatch);
  }

  const workingNameStatus = await getWorkingTreeNameStatus();
  const workingPatch = await getWorkingTreePatch();
  const untrackedFiles = await getUntrackedFiles();
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
  const filteredPatches = splitPatchByFile(patch).filter((item) => !isIgnoredFile(item.path));
  const files = filteredFiles.length > 0 ? filteredFiles : allFiles;
  const patches = filteredPatches.length > 0 ? filteredPatches : splitPatchByFile(patch);
  const highContextCount = files.filter((item) => isHighContextFile(item.path)).length;
  const strategy = decideStrategy(files, patch, highContextCount);
  const optimizedPatch = buildStrategyPatch(patches, strategy);
  const contextSummary = strategy === 'incremental' ? '' : await buildContextSummary(files, strategy === 'compressed' ? 2 : 3);

  return {
    source,
    strategy,
    nameStatus: files.map((item) => `${item.status}\t${item.path}`).join('\n'),
    patch: optimizedPatch,
    fileSummary: buildFileSummary(files),
    contextSummary,
    stats: {
      fileCount: files.length,
      ignoredFileCount: allFiles.length - files.length,
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

import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';

/** @type {(file: string, args: string[]) => Promise<{stdout: string; stderr: string}>} */
const execFileAsync = promisify(execFile);

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
  /** @type {string} */
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

    /** @type {string} */
    const status = line.slice(0, 2);
    /** @type {string} */
    const path = line.slice(3).trim();
    if (!path) {
      return;
    }

    if (status === '??') {
      lines.add(`A\t${path}`);
      return;
    }

    /** @type {string} */
    const code = status[1] !== ' ' ? status[1] : status[0];
    if (code && code !== '?') {
      lines.add(`${code}\t${path}`);
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
  /** @type {string} */
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
      /** @type {string} */
      const content = await readFile(file, 'utf8');
      /** @type {string[]} */
      const lines = content.split('\n').slice(0, 120);
      /** @type {string} */
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
 * @typedef {Object} SummaryChanges
 * @property {'staged'|'working-tree'} source 变更来源。
 * @property {string} nameStatus 文件状态摘要。
 * @property {string} patch 补丁内容。
 */

/**
 * @description 获取用于 AI 总结的变更内容，优先暂存区，缺失时回退到工作区。
 * @return {Promise<SummaryChanges>} 结构化变更数据。
 */
export async function getChangesForSummary() {
  /** @type {string} */
  const stagedNameStatus = await getStagedNameStatus();
  /** @type {string} */
  const stagedPatch = await getStagedPatch();
  if (stagedNameStatus && stagedPatch) {
    return {
      source: 'staged',
      nameStatus: stagedNameStatus,
      patch: stagedPatch
    };
  }

  /** @type {string} */
  const workingNameStatus = await getWorkingTreeNameStatus();
  /** @type {string} */
  const workingPatch = await getWorkingTreePatch();
  /** @type {string[]} */
  const untrackedFiles = await getUntrackedFiles();
  /** @type {string} */
  const untrackedPatch = await buildUntrackedPseudoPatch(untrackedFiles);
  /** @type {string} */
  const mergedPatch = [workingPatch, untrackedPatch].filter(Boolean).join('\n\n');

  return {
    source: 'working-tree',
    nameStatus: workingNameStatus,
    patch: mergedPatch
  };
}

/**
 * @description 截断过长补丁以控制 token 规模。
 * @param {string} patch 原始补丁。
 * @param {number} maxChars 最大字符数。
 * @return {string} 截断后的补丁。
 */
export function clipPatch(patch, maxChars = 12000) {
  if (patch.length <= maxChars) {
    return patch;
  }

  const head = patch.slice(0, Math.floor(maxChars * 0.7));
  const tail = patch.slice(-Math.floor(maxChars * 0.3));
  return `${head}\n\n...PATCH_TRUNCATED...\n\n${tail}`;
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

  /** @type {string[]} */
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

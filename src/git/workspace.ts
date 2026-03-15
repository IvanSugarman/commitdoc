import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import {mergeNameStatusOutputs} from '../change-analysis/patch-utils.js';
import type {WorkspaceSnapshot} from '../change-analysis/types.js';

/** git 命令执行器 */
const execFileAsync = promisify(execFile);

/**
 * @description 执行 git 命令并返回输出。
 * @param {string[]} args git 参数列表。
 * @return {Promise<string>} 标准输出内容。
 */
export async function executeGit(args: string[]): Promise<string> {
  const {stdout} = await execFileAsync('git', args, {maxBuffer: 10 * 1024 * 1024});
  return stdout.trimEnd();
}

/**
 * @description 判断当前目录是否在 git 仓库内。
 * @return {Promise<boolean>} 是否为 git 仓库。
 */
export async function isGitRepo(): Promise<boolean> {
  try {
    const value = await executeGit(['rev-parse', '--is-inside-work-tree']);
    return value === 'true';
  } catch {
    return false;
  }
}

/**
 * @description 获取暂存区文件状态。
 * @return {Promise<string>} 暂存区文件状态文本。
 */
async function getStagedNameStatus(): Promise<string> {
  return executeGit(['diff', '--cached', '--name-status']);
}

/**
 * @description 获取暂存区补丁内容。
 * @return {Promise<string>} 暂存区补丁文本。
 */
async function getStagedPatch(): Promise<string> {
  return executeGit(['diff', '--cached', '--unified=3']);
}

/**
 * @description 获取工作区文件状态。
 * @return {Promise<string>} 工作区文件状态文本。
 */
async function getWorkingTreeNameStatus(): Promise<string> {
  const porcelain = await executeGit(['status', '--porcelain']);
  if (!porcelain) {
    return '';
  }

  const lines = new Set<string>();
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
 * @description 获取工作区补丁内容。
 * @return {Promise<string>} 工作区补丁文本。
 */
async function getWorkingTreePatch(): Promise<string> {
  return executeGit(['diff', '--unified=3']);
}

/**
 * @description 获取混合工作区文件状态。
 * @return {Promise<string>} 混合工作区文件状态文本。
 */
async function getWorkspaceNameStatus(): Promise<string> {
  try {
    return await executeGit(['diff', 'HEAD', '--name-status']);
  } catch {
    return mergeNameStatusOutputs([await getStagedNameStatus(), await getWorkingTreeNameStatus()]);
  }
}

/**
 * @description 获取混合工作区补丁内容。
 * @return {Promise<string>} 混合工作区补丁文本。
 */
async function getWorkspacePatch(): Promise<string> {
  try {
    return await executeGit(['diff', 'HEAD', '--unified=3']);
  } catch {
    return [await getStagedPatch(), await getWorkingTreePatch()].filter(Boolean).join('\n\n');
  }
}

/**
 * @description 获取未跟踪文件列表。
 * @return {Promise<string[]>} 未跟踪文件数组。
 */
async function getUntrackedFiles(): Promise<string[]> {
  const output = await executeGit(['ls-files', '--others', '--exclude-standard']);
  if (!output) {
    return [];
  }

  return output
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * @description 为未跟踪文件构建伪补丁。
 * @param {string[]} files 未跟踪文件列表。
 * @param {number} maxFiles 最大文件数。
 * @return {Promise<string>} 伪补丁内容。
 */
async function buildUntrackedPseudoPatch(files: string[], maxFiles = 5): Promise<string> {
  const chunks: string[] = [];

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
      // 忽略无法读取的文件
    }
  }

  return chunks.join('\n\n');
}

/**
 * @description 收集当前工作区快照。
 * @return {Promise<WorkspaceSnapshot>} 工作区快照。
 */
export async function collectWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const [stagedNameStatus, workingNameStatus, workspaceNameStatus, workspacePatch, untrackedFiles] = await Promise.all([
    getStagedNameStatus(),
    getWorkingTreeNameStatus(),
    getWorkspaceNameStatus(),
    getWorkspacePatch(),
    getUntrackedFiles()
  ]);

  const untrackedNameStatus = untrackedFiles.map((filePath) => `A\t${filePath}`).join('\n');
  const untrackedPatch = await buildUntrackedPseudoPatch(untrackedFiles);
  const mergedNameStatus = mergeNameStatusOutputs([workspaceNameStatus, untrackedNameStatus]);
  const mergedPatch = [workspacePatch, untrackedPatch].filter(Boolean).join('\n\n');
  const hasWorkingTreeChanges = Boolean(workingNameStatus) || untrackedFiles.length > 0;
  const source = stagedNameStatus && hasWorkingTreeChanges ? 'mixed-workspace' : stagedNameStatus ? 'staged' : 'working-tree';

  if (mergedNameStatus && mergedPatch) {
    return {
      source,
      nameStatus: mergedNameStatus,
      patch: mergedPatch
    };
  }

  if (stagedNameStatus) {
    return {
      source: 'staged',
      nameStatus: stagedNameStatus,
      patch: await getStagedPatch()
    };
  }

  return {
    source: 'working-tree',
    nameStatus: workingNameStatus || untrackedNameStatus,
    patch: untrackedPatch || await getWorkingTreePatch()
  };
}

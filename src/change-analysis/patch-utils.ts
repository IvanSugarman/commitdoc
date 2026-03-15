import {getFileRole, getGroupKey} from './file-classifier.js';
import type {ChangedFile, FilePatch, PatchLineStats} from './types.js';

/** 迁移识别结果 */
export interface RelocationDetection {
  /** 当前文件到原文件的映射 */
  movedFromByFile: Map<string, string>;
  /** 纯迁移文件集合 */
  pureRelocationFiles: Set<string>;
}

/**
 * @description 解析文件状态文本。
 * @param {string} nameStatus 文件状态文本。
 * @return {ChangedFile[]} 结构化文件列表。
 */
export function parseChangedFiles(nameStatus: string): ChangedFile[] {
  return nameStatus
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const status = parts[0]?.trim() || '';
      let filePath = '';
      let oldPath: string | undefined;

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
 * @description 将结构化文件状态恢复为 name-status 行。
 * @param {ChangedFile} item 文件信息。
 * @return {string} name-status 行。
 */
export function formatNameStatusLine(item: ChangedFile): string {
  if (/^[RC]/.test(item.status) && item.oldPath) {
    return `${item.status}\t${item.oldPath}\t${item.path}`;
  }

  return `${item.status}\t${item.path}`;
}

/**
 * @description 合并多份 name-status 文本。
 * @param {string[]} outputs name-status 文本列表。
 * @return {string} 合并后的 name-status 文本。
 */
export function mergeNameStatusOutputs(outputs: string[]): string {
  const merged = new Map<string, ChangedFile>();

  outputs
    .flatMap((output) => parseChangedFiles(output))
    .forEach((item) => {
      const previous = merged.get(item.path);
      const normalizedStatus = item.status === '??' ? 'A' : item.status.charAt(0) || 'M';
      merged.set(item.path, {
        ...previous,
        ...item,
        status: normalizedStatus
      });
    });

  return Array.from(merged.values()).map((item) => formatNameStatusLine(item)).join('\n');
}

/**
 * @description 将补丁按文件切分。
 * @param {string} patch 原始补丁。
 * @return {FilePatch[]} 分文件补丁。
 */
export function splitPatchByFile(patch: string): FilePatch[] {
  if (!patch) {
    return [];
  }

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
 * @description 将纯重命名补丁压缩为单行说明。
 * @param {FilePatch[]} patches 分文件补丁。
 * @return {FilePatch[]} 优化后的补丁列表。
 */
export function optimizeRenameOnlyPatches(patches: FilePatch[]): FilePatch[] {
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
 * @description 识别 rename-only 与 D/A 形式的纯迁移文件。
 * @param {ChangedFile[]} files 文件列表。
 * @param {FilePatch[]} patches 分文件补丁。
 * @return {RelocationDetection} 迁移识别结果。
 */
export function detectRelocatedFiles(files: ChangedFile[], patches: FilePatch[]): RelocationDetection {
  const movedFromByFile = new Map<string, string>();
  const pureRelocationFiles = new Set<string>();
  const patchMap = new Map(patches.map((item) => [item.path, item.content]));

  files.forEach((item) => {
    if (/^R/.test(item.status) && item.oldPath) {
      movedFromByFile.set(item.path, item.oldPath);
      pureRelocationFiles.add(item.path);
      pureRelocationFiles.add(item.oldPath);
    }
  });

  const deletedCandidates = files.filter((item) => item.status.startsWith('D'));
  const addedCandidates = files.filter((item) => item.status.startsWith('A'));
  const deletedBodies = deletedCandidates
    .map((item) => ({
      path: item.path,
      signature: buildPatchBodySignature(patchMap.get(item.path) || '', 'removed')
    }))
    .filter((item) => item.signature);

  addedCandidates.forEach((item) => {
    const signature = buildPatchBodySignature(patchMap.get(item.path) || '', 'added');
    if (!signature) {
      return;
    }

    const matched = deletedBodies.find((candidate) => candidate.signature === signature && !movedFromByFile.has(item.path));
    if (!matched) {
      return;
    }

    movedFromByFile.set(item.path, matched.path);
    pureRelocationFiles.add(item.path);
    pureRelocationFiles.add(matched.path);
  });

  return {
    movedFromByFile,
    pureRelocationFiles
  };
}

/**
 * @description 统计每个补丁文件的增删行数。
 * @param {FilePatch[]} patches 分文件补丁。
 * @return {Map<string, PatchLineStats>} 行数统计映射。
 */
export function buildPatchLineStats(patches: FilePatch[]): Map<string, PatchLineStats> {
  const stats = new Map<string, PatchLineStats>();

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
 * @description 构建补丁正文签名，用于识别 D/A 形式的纯迁移。
 * @param {string} patchContent 补丁内容。
 * @param {'added'|'removed'} mode 内容方向。
 * @return {string} 归一化后的正文签名。
 */
function buildPatchBodySignature(patchContent: string, mode: 'added' | 'removed'): string {
  const prefixes = mode === 'added' ? ['+'] : ['-'];
  return patchContent
    .split('\n')
    .filter((line) => {
      if (!line || /^(\+\+\+|---|@@|diff --git|index |similarity index |rename from |rename to )/.test(line)) {
        return false;
      }

      return prefixes.some((prefix) => line.startsWith(prefix));
    })
    .map((line) => line.slice(1).trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * @description 按语义分组选择代表性补丁。
 * @param {FilePatch[]} patches 分文件补丁。
 * @param {number} maxFiles 最大保留文件数。
 * @return {FilePatch[]} 代表性补丁列表。
 */
export function pickRepresentativePatches(patches: FilePatch[], maxFiles: number): FilePatch[] {
  if (patches.length <= maxFiles) {
    return patches;
  }

  const grouped = new Map<string, FilePatch[]>();
  patches.forEach((patchItem) => {
    const key = `${getGroupKey(patchItem.path)}::${getFileRole(patchItem.path)}`;
    const current = grouped.get(key) || [];
    current.push(patchItem);
    grouped.set(key, current);
  });

  const prioritizedKeys = Array.from(grouped.keys()).sort((left, right) => {
    const leftRole = left.split('::')[1] || 'other';
    const rightRole = right.split('::')[1] || 'other';
    const order = {config: 0, script: 1, request: 2, doc: 3, test: 4, type: 5, other: 6};
    return (order[leftRole as keyof typeof order] ?? 9) - (order[rightRole as keyof typeof order] ?? 9);
  });

  const selected: FilePatch[] = [];
  while (selected.length < maxFiles) {
    let appended = false;

    for (const key of prioritizedKeys) {
      const bucket = grouped.get(key);
      if (!bucket || bucket.length === 0) {
        continue;
      }

      const nextPatch = bucket.shift();
      if (nextPatch) {
        selected.push(nextPatch);
        appended = true;
      }
      if (selected.length >= maxFiles) {
        break;
      }
    }

    if (!appended) {
      break;
    }
  }

  return selected;
}

/**
 * @description 按文件级别压缩补丁体积。
 * @param {FilePatch[]} patches 分文件补丁。
 * @param {number} perFileChars 单文件最大字符数。
 * @param {number} maxFiles 最大保留文件数。
 * @return {string} 压缩后的补丁文本。
 */
export function compressPatchSections(patches: FilePatch[], perFileChars = 1800, maxFiles = 8): string {
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

import { getFileRole, getGroupKey } from './file-classifier.js';
/**
 * @description 解析文件状态文本。
 * @param {string} nameStatus 文件状态文本。
 * @return {ChangedFile[]} 结构化文件列表。
 */
export function parseChangedFiles(nameStatus) {
    return nameStatus
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
        const parts = line.split('\t');
        const status = parts[0]?.trim() || '';
        let filePath = '';
        let oldPath;
        if (/^[RC]/.test(status) && parts.length >= 3) {
            oldPath = parts[1]?.trim() || undefined;
            filePath = parts[2]?.trim() || '';
        }
        else {
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
export function formatNameStatusLine(item) {
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
export function mergeNameStatusOutputs(outputs) {
    const merged = new Map();
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
export function splitPatchByFile(patch) {
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
export function optimizeRenameOnlyPatches(patches) {
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
 * @description 统计每个补丁文件的增删行数。
 * @param {FilePatch[]} patches 分文件补丁。
 * @return {Map<string, PatchLineStats>} 行数统计映射。
 */
export function buildPatchLineStats(patches) {
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
 * @description 按语义分组选择代表性补丁。
 * @param {FilePatch[]} patches 分文件补丁。
 * @param {number} maxFiles 最大保留文件数。
 * @return {FilePatch[]} 代表性补丁列表。
 */
export function pickRepresentativePatches(patches, maxFiles) {
    if (patches.length <= maxFiles) {
        return patches;
    }
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
        const order = { config: 0, script: 1, request: 2, doc: 3, test: 4, type: 5, other: 6 };
        return (order[leftRole] ?? 9) - (order[rightRole] ?? 9);
    });
    const selected = [];
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
export function compressPatchSections(patches, perFileChars = 1800, maxFiles = 8) {
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

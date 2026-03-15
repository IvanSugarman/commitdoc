import type {ChangedFile, FileRole} from './types.js';

/** 低价值文件匹配规则 */
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

/** 高影响模块匹配规则 */
const HIGH_IMPACT_FILE_PATTERNS = [
  /(^|\/)src\/cli\.(ts|js|tsx|jsx|mjs|cjs|mts|cts)$/i,
  /(^|\/)src\/commands\.(ts|js|tsx|jsx|mjs|cjs|mts|cts)$/i,
  /(^|\/)src\/briefs\.(ts|js|tsx|jsx|mjs|cjs|mts|cts)$/i,
  /(^|\/)src\/git\//i,
  /(^|\/)src\/git\.(ts|js|tsx|jsx|mjs|cjs|mts|cts)$/i,
  /(^|\/)src\/change-analysis\//i,
  /(^|\/)src\/providers\//i,
  /(^|\/)src\/prompt\.(ts|js|tsx|jsx|mjs|cjs|mts|cts)$/i,
  /(^|\/)src\/fallback-suggestion\.(ts|js|tsx|jsx|mjs|cjs|mts|cts)$/i,
  /(^|\/)src\/model-log\.(ts|js|tsx|jsx|mjs|cjs|mts|cts)$/i,
  /(^|\/)package\.json$/i,
  /(^|\/)README\.md$/i
];

/**
 * @description 判断文件是否属于低价值噪音文件。
 * @param {string} filePath 文件路径。
 * @return {boolean} 是否忽略。
 */
export function isIgnoredFile(filePath: string): boolean {
  return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * @description 判断文件是否需要额外上下文。
 * @param {string} filePath 文件路径。
 * @return {boolean} 是否为高上下文文件。
 */
export function isHighContextFile(filePath: string): boolean {
  return /(store|state|api|service|types|routes|router|schema|config|hook|hooks|provider|prompt|package\.json)/i.test(filePath);
}

/**
 * @description 计算文件优先级分数，供摘要和提示词排序使用。
 * @param {ChangedFile} file 文件信息。
 * @return {number} 优先级分数。
 */
export function getFilePriorityScore(file: ChangedFile): number {
  const role = getFileRole(file.path);
  const roleScore = getRolePriority(role) * 100;
  const contextScore = isHighContextFile(file.path) ? 35 : 0;
  const impactScore = HIGH_IMPACT_FILE_PATTERNS.some((pattern) => pattern.test(file.path)) ? 55 : 0;
  const changeScore = Math.min(file.total || 0, 240) / 3;
  const statusScore = file.status.startsWith('A') || file.status.startsWith('R') ? 6 : 0;
  return roleScore + contextScore + impactScore + changeScore + statusScore;
}

/**
 * @description 按优先级对文件排序，优先保留高影响模块。
 * @param {ChangedFile[]} files 文件列表。
 * @return {ChangedFile[]} 排序后的文件列表。
 */
export function sortFilesByPriority(files: ChangedFile[]): ChangedFile[] {
  return [...files].sort((left, right) => {
    const scoreDiff = getFilePriorityScore(right) - getFilePriorityScore(left);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    const totalDiff = (right.total || 0) - (left.total || 0);
    if (totalDiff !== 0) {
      return totalDiff;
    }

    return left.path.localeCompare(right.path);
  });
}

/**
 * @description 获取文件分组键。
 * @param {string} filePath 文件路径。
 * @return {string} 分组键。
 */
export function getGroupKey(filePath: string): string {
  if (filePath === 'package.json') {
    return 'package.json';
  }

  const parts = filePath.split('/');
  if (parts.length <= 2) {
    return parts.join('/');
  }

  if (parts[0] === 'src' && parts[1]) {
    return parts.slice(0, 2).join('/');
  }

  return parts.slice(0, 2).join('/');
}

/**
 * @description 判断文件语义角色。
 * @param {string} filePath 文件路径。
 * @return {FileRole} 角色名称。
 */
export function getFileRole(filePath: string): FileRole {
  if (filePath === 'package.json') {
    return 'config';
  }

  if (/(^|\/)(__tests__|tests?)\//.test(filePath) || /(test|spec)\.(ts|js|tsx|jsx|mjs|cjs|mts|cts)$/i.test(filePath)) {
    return 'test';
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
 * @description 构建分组摘要。
 * @param {ChangedFile[]} files 文件列表。
 * @return {string} 分组摘要文本。
 */
export function buildGroupSummary(files: ChangedFile[]): string {
  const groups = new Map<string, {count: number; roles: Set<string>; total: number; score: number}>();

  files.forEach((item) => {
    const key = getGroupKey(item.path);
    const current = groups.get(key) || {count: 0, roles: new Set<string>(), total: 0, score: 0};
    current.count += 1;
    current.roles.add(getFileRole(item.path));
    current.total += item.total || 0;
    current.score += getFilePriorityScore(item);
    groups.set(key, current);
  });

  return Array.from(groups.entries())
    .sort((left, right) => {
      const scoreDiff = right[1].score - left[1].score;
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return right[1].total - left[1].total;
    })
    .map(([group, meta]) => `${group}\tcount=${meta.count}\troles=${Array.from(meta.roles).join(',')}\ttotal=${meta.total}`)
    .join('\n');
}

/**
 * @description 构建文件级摘要。
 * @param {ChangedFile[]} files 文件列表。
 * @param {number} limit 最大条目数。
 * @return {string} 文件级摘要文本。
 */
export function buildFileSummary(files: ChangedFile[], limit = 12): string {
  return sortFilesByPriority(files)
    .slice(0, limit)
    .map((item) => {
      const kind = isHighContextFile(item.path) ? 'high-context' : 'normal';
      return `${item.status}\t${item.path}\t${kind}`;
    })
    .join('\n');
}

/**
 * @description 构建文件结构概览。
 * @param {ChangedFile[]} files 文件列表。
 * @param {number} limit 最大条目数。
 * @return {string} 文件结构概览文本。
 */
export function buildFilesOverview(files: ChangedFile[], limit = 12): string {
  return sortFilesByPriority(files)
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
 * @description 构建更通用的语义提示。
 * @param {ChangedFile[]} files 文件列表。
 * @return {string} 语义提示文本。
 */
export function buildSemanticHints(files: ChangedFile[]): string {
  const hints: string[] = [];
  const roles = files.reduce<Record<FileRole, number>>(
    (current, item) => {
      const role = getFileRole(item.path);
      current[role] += 1;
      return current;
    },
    {script: 0, request: 0, doc: 0, config: 0, type: 0, test: 0, other: 0}
  );
  const prioritizedFiles = sortFilesByPriority(files);
  const groups = Array.from(new Set(prioritizedFiles.map((item) => getGroupKey(item.path)))).slice(0, 4);

  if (groups.length > 0) {
    hints.push(`高影响模块: ${groups.join(', ')}`);
  }

  if (groups.some((item) => /^src\/(cli|commands|briefs)/.test(item))) {
    hints.push('命令入口与 brief 渲染链路发生调整');
  }

  if (groups.some((item) => /^src\/(git|change-analysis)/.test(item))) {
    hints.push('变更分析与摘要压缩链路发生重构');
  }

  if (groups.some((item) => /^src\/providers/.test(item)) || groups.includes('src/prompt') || groups.includes('src/model-log')) {
    hints.push('模型调用、提示词或诊断日志相关能力发生调整');
  }

  if (groups.includes('src/model-log')) {
    hints.push('缓存结构与中间态日志能力发生调整');
  }

  if (roles.script > 0 && hints.length === 0) {
    hints.push('核心实现逻辑发生调整');
  }

  if (roles.type > 0) {
    hints.push('涉及类型定义或接口契约变化');
  }

  if (roles.config > 0) {
    hints.push('包含配置或依赖相关调整');
  }

  if (roles.test > 0) {
    hints.push('包含测试覆盖或验证逻辑调整');
  }

  if (roles.doc > 0) {
    hints.push('包含文档或说明更新');
  }

  if (roles.request > 0) {
    hints.push('包含请求样例或接口调用相关调整');
  }

  return hints.join('\n');
}

/**
 * @description 获取角色优先级。
 * @param {FileRole} role 文件角色。
 * @return {number} 优先级。
 */
function getRolePriority(role: FileRole): number {
  const priorities: Record<FileRole, number> = {
    script: 7,
    type: 6,
    config: 5,
    test: 4,
    request: 3,
    doc: 2,
    other: 1
  };

  return priorities[role] || 0;
}

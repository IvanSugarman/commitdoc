/**
 * @typedef {Object} CommitSuggestion
 * @property {'feat'|'fix'|'chore'} type 提交类型。
 * @property {string} subject 提交标题主体。
 * @property {string[]} bullets 提交摘要要点。
 */

/**
 * @typedef {Object} FileSummaryItem
 * @property {string} status 文件状态。
 * @property {string} path 文件路径。
 * @property {string} kind 文件类别。
 */

/** @type {Set<string>} */
const ALLOWED_TYPES = new Set(['feat', 'fix', 'chore']);

/** @type {Set<string>} */
const PATCH_STOP_WORDS = new Set([
  'const',
  'return',
  'import',
  'from',
  'export',
  'default',
  'function',
  'class',
  'await',
  'async',
  'true',
  'false',
  'null',
  'undefined',
  'string',
  'number',
  'object',
  'array',
  'value',
  'props',
  'state',
  'title',
  'subject',
  'bullets',
  'json',
  'prompt',
  'patch',
  'line',
  'lines',
  'color',
  'margin',
  'padding'
]);

/**
 * @description 解析模型返回 JSON。
 * @param {string} raw 模型原始文本。
 * @return {CommitSuggestion} 结构化提交建议。
 */
export function parseSuggestion(raw) {
  const normalized = normalizeRawResponse(raw);
  const candidate = extractJsonCandidate(normalized);
  const parsed = JSON.parse(candidate);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid model response: not an object');
  }

  const data = /** @type {Record<string, unknown>} */ (parsed);

  if (!ALLOWED_TYPES.has(String(data.type))) {
    throw new Error('Invalid model response: unsupported type');
  }

  if (typeof data.subject !== 'string' || data.subject.trim().length === 0) {
    throw new Error('Invalid model response: missing subject');
  }

  if (!Array.isArray(data.bullets)) {
    throw new Error('Invalid model response: bullets must be array');
  }

  const bullets = data.bullets
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);

  return {
    type: /** @type {'feat'|'fix'|'chore'} */ (data.type),
    subject: data.subject.trim().slice(0, 50),
    bullets
  };
}

/**
 * @description 清理模型原始文本中的围栏与多余空白。
 * @param {string} raw 模型原始文本。
 * @return {string} 归一化后的文本。
 */
function normalizeRawResponse(raw) {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * @description 从自由文本中提取最后一个完整 JSON 对象。
 * @param {string} text 归一化后的模型文本。
 * @return {string} JSON 字符串。
 */
function extractJsonCandidate(text) {
  if (text.startsWith('{') && text.endsWith('}')) {
    return text;
  }

  /** @type {string[]} */
  const candidates = [];
  let depth = 0;
  let start = -1;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth === 0) {
        continue;
      }

      depth -= 1;
      if (depth === 0 && start !== -1) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  if (candidates.length > 0) {
    return candidates.at(-1) || '';
  }

  throw new Error('Invalid model response: JSON object not found');
}

/**
 * @description 从 prompt 中提取指定段落。
 * @param {string} prompt 完整提示词。
 * @param {string} section 段落名称。
 * @return {string} 对应段落内容。
 */
function extractSection(prompt, section) {
  const pattern = new RegExp(`\\[${section}\\]\\n([\\s\\S]*?)(?=\\n\\[[A-Z_]+\\]\\n|$)`);
  const matched = prompt.match(pattern);
  return matched?.[1]?.trim() || '';
}

/**
 * @description 解析文件级摘要。
 * @param {string} summary 文件级摘要文本。
 * @return {FileSummaryItem[]} 结构化文件摘要。
 */
function parseFileSummary(summary) {
  return summary
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, filePath, kind] = line.split('\t');
      return {
        status: status || 'M',
        path: filePath || '',
        kind: kind || 'normal'
      };
    })
    .filter((item) => item.path);
}

/**
 * @description 判断文本中是否更偏向修复语义。
 * @param {string} text 综合分析文本。
 * @return {'feat'|'fix'|'chore'} 推断后的提交类型。
 */
function inferType(text) {
  if (/(fix|bug|error|fail|crash|兼容|修复|兜底|fallback|异常|回退|cache invalidation)/i.test(text)) {
    return 'fix';
  }

  if (/(add|implement|support|introduce|新增|实现|支持|引入|增强|优化|cache|timing|profile|provider|token|doctor|config|install|plugin)/i.test(text)) {
    return 'feat';
  }

  return 'chore';
}

/**
 * @description 从补丁中提取有效变更行。
 * @param {string} patch 补丁文本。
 * @return {string[]} 变更行数组。
 */
function getMeaningfulPatchLines(patch) {
  return patch
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^[+-]/.test(line))
    .filter((line) => !/^\+\+\+|^---|^@@/.test(line))
    .map((line) => line.slice(1).trim())
    .filter(Boolean)
    .slice(0, 240);
}

/**
 * @description 从变更行中提取关键词频次。
 * @param {string[]} lines 变更行数组。
 * @return {Map<string, {count: number; label: string}>} 关键词频次表。
 */
function collectPatchKeywords(lines) {
  /** @type {Map<string, {count: number; label: string}>} */
  const frequency = new Map();

  lines.forEach((line) => {
    const words = line.match(/[A-Za-z][A-Za-z0-9._/-]{2,}/g) || [];
    words.forEach((word) => {
      const normalized = word.toLowerCase();
      if (PATCH_STOP_WORDS.has(normalized)) {
        return;
      }

      const current = frequency.get(normalized);
      if (current) {
        current.count += 1;
        return;
      }

      frequency.set(normalized, {count: 1, label: word});
    });
  });

  return frequency;
}

/**
 * @description 获取高频关键词列表。
 * @param {Map<string, {count: number; label: string}>} frequency 关键词频次表。
 * @param {number} limit 最大数量。
 * @return {string[]} 关键词数组。
 */
function getTopKeywords(frequency, limit = 4) {
  return Array.from(frequency.entries())
    .sort((left, right) => {
      if (right[1].count !== left[1].count) {
        return right[1].count - left[1].count;
      }

      return left[0].localeCompare(right[0]);
    })
    .map(([, value]) => value.label)
    .slice(0, limit);
}

/**
 * @description 提取最具代表性的文件名。
 * @param {FileSummaryItem[]} files 文件摘要列表。
 * @param {number} limit 最大数量。
 * @return {string[]} 文件名数组。
 */
function getTopFileNames(files, limit = 2) {
  return files
    .map((item) => item.path.split('/').at(-1) || item.path)
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * @description 基于路径与关键词判断主题焦点。
 * @param {FileSummaryItem[]} files 文件摘要列表。
 * @param {string[]} keywords 关键词列表。
 * @return {string} 主题焦点。
 */
function inferFocus(files, keywords) {
  const joinedPaths = files.map((item) => item.path.toLowerCase()).join(' ');
  const joinedKeywords = keywords.join(' ');

  if (/(timing|duration|performance|latency|slow|cache)/.test(joinedKeywords)) {
    return '生成性能';
  }

  if (/(provider|model|openai|zhipu|glm)/.test(joinedPaths + joinedKeywords)) {
    return '模型调用流程';
  }

  if (/(doctor|token)/.test(joinedPaths + joinedKeywords)) {
    return '诊断与统计输出';
  }

  if (/(config|profile|zshrc|\.env)/.test(joinedPaths + joinedKeywords)) {
    return '配置切换流程';
  }

  if (/(commit|push|stage|git)/.test(joinedPaths + joinedKeywords)) {
    return '提交流程';
  }

  if (/(prompt|summary|fallback|parser|json)/.test(joinedPaths + joinedKeywords)) {
    return '摘要生成逻辑';
  }

  if (/(cli|ink)/.test(joinedPaths)) {
    return '终端交互体验';
  }

  return '代码变更总结';
}

/**
 * @description 生成更细粒度的中文主题。
 * @param {FileSummaryItem[]} files 文件摘要列表。
 * @param {string[]} keywords 关键词列表。
 * @param {'feat'|'fix'|'chore'} type 提交类型。
 * @return {string} 中文主题。
 */
function inferSubject(files, keywords, type) {
  const focus = inferFocus(files, keywords);
  const fileNames = getTopFileNames(files);
  /** @type {string} */
  let subject = '';

  if (keywords.length > 0) {
    const keywordText = keywords.slice(0, 2).join(' / ');
    subject = `${type === 'fix' ? '修正' : type === 'feat' ? '优化' : '调整'}${focus}中的 ${keywordText}`;
  } else if (fileNames.length > 0) {
    subject = `${type === 'fix' ? '修正' : type === 'feat' ? '优化' : '调整'}${fileNames.join('、')} 相关逻辑`;
  } else {
    subject = `更新 gai ${focus}`;
  }

  return subject.slice(0, 30);
}

/**
 * @description 根据文件与补丁生成更动态的要点。
 * @param {FileSummaryItem[]} files 文件摘要列表。
 * @param {string[]} lines 变更行数组。
 * @param {string[]} keywords 关键词列表。
 * @param {string} focus 主题焦点。
 * @return {string[]} 中文摘要要点。
 */
function inferBullets(files, lines, keywords, focus) {
  /** @type {string[]} */
  const bullets = [];
  const fileNames = getTopFileNames(files, 3);

  if (fileNames.length > 0) {
    bullets.push(`调整 ${fileNames.join('、')} 的实现细节`);
  }

  if (keywords.length > 0) {
    bullets.push(`补充 ${keywords.slice(0, 3).join(' / ')} 相关处理逻辑`);
  }

  if (lines.length > 0) {
    const sample = lines
      .find((line) => !/^\s*(import|export)\b/.test(line))
      ?.replace(/\s+/g, ' ')
      .slice(0, 36);

    if (sample) {
      bullets.push(`围绕 ${sample} 调整 ${focus}`);
    }
  }

  const statusSummary = files.map((item) => item.status).join('');
  if (/A/.test(statusSummary)) {
    bullets.push(`新增与 ${focus} 相关的补充逻辑`);
  } else if (/D/.test(statusSummary)) {
    bullets.push(`清理与 ${focus} 相关的冗余实现`);
  } else {
    bullets.push(`细化 ${focus} 的边界处理`);
  }

  return Array.from(new Set(bullets)).slice(0, 4);
}

/**
 * @description 构建本地兜底提交建议。
 * @param {string} prompt 完整提示词。
 * @param {string} reasoning 模型 reasoning 文本。
 * @return {CommitSuggestion} 本地推断的提交建议。
 */
export function buildFallbackSuggestion(prompt, reasoning) {
  const files = parseFileSummary(extractSection(prompt, 'FILE_SUMMARY'));
  const patch = extractSection(prompt, 'PATCH');
  const lines = getMeaningfulPatchLines(patch);
  const keywords = getTopKeywords(collectPatchKeywords(lines));
  const sourceText = `${prompt}\n${reasoning}\n${lines.join('\n')}`;
  const type = inferType(sourceText);
  const focus = inferFocus(files, keywords);
  const bullets = inferBullets(files, lines, keywords, focus);

  return {
    type,
    subject: inferSubject(files, keywords, type),
    bullets: bullets.length > 0 ? bullets : [`调整 gai ${focus}`]
  };
}

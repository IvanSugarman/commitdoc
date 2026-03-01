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

/**
 * @description 解析模型返回 JSON。
 * @param {string} raw 模型原始文本。
 * @return {CommitSuggestion} 结构化提交建议。
 */
export function parseSuggestion(raw) {
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid model response: not an object');
  }

  const data = /** @type {Record<string, unknown>} */ (parsed);
  const allowedTypes = new Set(['feat', 'fix', 'chore']);

  if (!allowedTypes.has(String(data.type))) {
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
  if (/(fix|bug|error|兼容|修复|兜底|fallback|empty model output|异常)/i.test(text)) {
    return 'fix';
  }

  if (/(add|implement|support|introduce|新增|实现|支持|引入|增强|优化|adaptive|strategy|doctor|config|install|provider|plugin)/i.test(text)) {
    return 'feat';
  }

  return 'chore';
}

/**
 * @description 根据文件特征挑选主题。
 * @param {FileSummaryItem[]} files 文件摘要列表。
 * @return {string} 中文主题。
 */
function inferSubject(files) {
  const joined = files.map((item) => item.path.toLowerCase()).join(' ');

  if (/(provider|providers)/.test(joined)) {
    return '重构 gai 模型 Provider 架构';
  }

  if (/(doctor|config|install|zshrc|\.env)/.test(joined)) {
    return '完善 gai 配置与安装流程';
  }

  if (/(git\.mjs|prompt\.mjs|openai\.mjs|cli\.mjs)/.test(joined)) {
    return '实现 gai 自适应摘要策略';
  }

  if (/(openai|model|prompt)/.test(joined)) {
    return '优化 gai 模型摘要流程';
  }

  if (/(cli|ink)/.test(joined)) {
    return '增强 gai 终端交互体验';
  }

  if (/(readme|docs?)/.test(joined)) {
    return '更新 gai 文档说明';
  }

  return '更新 gai 提交流程';
}

/**
 * @description 根据文件摘要生成要点。
 * @param {FileSummaryItem[]} files 文件摘要列表。
 * @return {string[]} 中文摘要要点。
 */
function inferBullets(files) {
  const bullets = [];
  const joined = files.map((item) => item.path.toLowerCase()).join(' ');

  if (/(providers|openai-compatible|zhipu|openai)/.test(joined)) {
    bullets.push('拆分模型 Provider 适配层，支持后续扩展更多模型服务');
  }

  if (/(git\.mjs)/.test(joined)) {
    bullets.push('优化 Git 改动提取、过滤与压缩策略');
  }

  if (/(prompt\.mjs)/.test(joined)) {
    bullets.push('调整 Prompt 结构，突出文件摘要与上下文信息');
  }

  if (/(fallback|openai\.mjs|model)/.test(joined)) {
    bullets.push('增强模型调用兼容处理与输出兜底能力');
  }

  if (/(cli\.mjs)/.test(joined)) {
    bullets.push('在 CLI 中接入 Provider 配置与诊断展示');
  }

  if (/(readme|docs?)/.test(joined)) {
    bullets.push('同步更新文档，说明多 Provider 配置方式');
  }

  return bullets.slice(0, 4).filter(Boolean);
}

/**
 * @description 构建本地兜底提交建议。
 * @param {string} prompt 完整提示词。
 * @param {string} reasoning 模型 reasoning 文本。
 * @return {CommitSuggestion} 本地推断的提交建议。
 */
export function buildFallbackSuggestion(prompt, reasoning) {
  const files = parseFileSummary(extractSection(prompt, 'FILE_SUMMARY'));
  const sourceText = `${prompt}\n${reasoning}`;
  const bullets = inferBullets(files);

  return {
    type: inferType(sourceText),
    subject: inferSubject(files),
    bullets: bullets.length > 0 ? bullets : ['调整 gai 摘要与提交流程']
  };
}

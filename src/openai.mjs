import OpenAI from 'openai';

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
function parseSuggestion(raw) {
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
 * @description 读取模型接入配置，默认使用智谱 GLM 4.7 Coding 端点。
 * @return {{apiKey: string; baseURL: string; model: string; formatModel: string}} 运行时配置。
 */
function getModelConfig() {
  const apiKey = process.env.GAI_API_KEY || process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('GAI_API_KEY is required for the configured model provider');
  }

  return {
    apiKey,
    baseURL: process.env.GAI_BASE_URL || 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: process.env.GAI_MODEL || 'glm-4.7',
    formatModel: process.env.GAI_FORMAT_MODEL || 'glm-4.7-flash'
  };
}

/**
 * @description 发起一次 chat completion 请求。
 * @param {OpenAI} client OpenAI 兼容客户端。
 * @param {string} model 模型名称。
 * @param {string} prompt 输入提示词。
 * @param {number} maxTokens 最大输出 token 数。
 * @return {Promise<{content?: unknown; reasoning_content?: unknown}>} 模型消息对象。
 */
async function requestMessage(client, model, prompt, maxTokens) {
  const response = await client.chat.completions.create({
    model,
    temperature: 0.1,
    max_tokens: maxTokens,
    extra_body: {
      thinking: {
        type: 'disabled'
      }
    },
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  return response.choices?.[0]?.message || {};
}

/**
 * @description 从兼容层消息结构中提取最终文本。
 * @param {{content?: unknown; reasoning_content?: unknown}} message 模型消息对象。
 * @return {string} 提取后的文本。
 */
function extractMessageText(message) {
  if (typeof message.content === 'string' && message.content.trim()) {
    return message.content.trim();
  }

  if (Array.isArray(message.content)) {
    const text = message.content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
          return item.text;
        }

        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();

    if (text) {
      return text;
    }
  }

  if (typeof message.reasoning_content === 'string') {
    const jsonMatches = message.reasoning_content.match(/\{[\s\S]*?\}/g);
    if (jsonMatches && jsonMatches.length > 0) {
      return jsonMatches.at(-1)?.trim() || '';
    }
  }

  return '';
}

/**
 * @description 基于 reasoning 内容做二次格式化，避免思维链吞掉最终答案。
 * @param {OpenAI} client OpenAI 兼容客户端。
 * @param {string} model 模型名称。
 * @param {string} reasoning 模型 reasoning 文本。
 * @return {Promise<string>} 二次格式化后的 JSON 文本。
 */
async function formatFromReasoning(client, model, reasoning) {
  const prompt = [
    'Convert the analysis below into strict JSON only.',
    'Return exactly one JSON object with keys: type, subject, bullets.',
    'type must be one of feat, fix, chore.',
    'subject must be concise Chinese, max 30 Chinese characters.',
    'bullets must be 2-4 short Chinese items.',
    'Do not include markdown fences or any extra text.',
    '',
    '[ANALYSIS]',
    reasoning.slice(-6000)
  ].join('\n');

  const message = await requestMessage(client, model, prompt, 220);
  return extractMessageText(message);
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

  if (/(add|implement|support|introduce|新增|实现|支持|引入|增强|优化|adaptive|strategy|doctor|config|install)/i.test(text)) {
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
  /** @type {string[]} */
  const bullets = [];
  const joined = files.map((item) => item.path.toLowerCase()).join(' ');

  if (/(git\.mjs)/.test(joined)) {
    bullets.push('优化 Git 改动提取、过滤与压缩策略');
  }

  if (/(prompt\.mjs)/.test(joined)) {
    bullets.push('调整 Prompt 结构，突出文件摘要与上下文信息');
  }

  if (/(openai\.mjs)/.test(joined)) {
    bullets.push('增强模型调用兼容处理与输出兜底能力');
  }

  if (/(cli\.mjs)/.test(joined)) {
    bullets.push('在 CLI 中展示当前摘要策略与执行反馈');
  }

  if (/(readme|docs?)/.test(joined)) {
    bullets.push('同步更新文档，说明自适应 token 控制策略');
  }

  if (/(doctor|config|install|zshrc|\.env)/.test(joined)) {
    bullets.push('补充配置、诊断与安装相关命令');
  }

  return bullets.slice(0, 4).filter(Boolean);
}

/**
 * @description 构建本地兜底提交建议。
 * @param {string} prompt 完整提示词。
 * @param {string} reasoning 模型 reasoning 文本。
 * @return {CommitSuggestion} 本地推断的提交建议。
 */
function buildFallbackSuggestion(prompt, reasoning) {
  const files = parseFileSummary(extractSection(prompt, 'FILE_SUMMARY'));
  const sourceText = `${prompt}\n${reasoning}`;
  const bullets = inferBullets(files);

  return {
    type: inferType(sourceText),
    subject: inferSubject(files),
    bullets: bullets.length > 0 ? bullets : ['调整 gai 摘要与提交流程']
  };
}

/**
 * @description 调用模型生成提交建议。
 * @param {string} prompt 输入提示词。
 * @return {Promise<CommitSuggestion>} 返回结构化提交建议。
 */
export async function generateSuggestion(prompt) {
  const config = getModelConfig();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });

  try {
    const message = await requestMessage(client, config.model, prompt, 800);
    let text = extractMessageText(message);

    if (!text && typeof message.reasoning_content === 'string' && message.reasoning_content.trim()) {
      text = await formatFromReasoning(client, config.formatModel, message.reasoning_content.trim());
    }

    if (text) {
      try {
        return parseSuggestion(text);
      } catch {
        return buildFallbackSuggestion(prompt, typeof message.reasoning_content === 'string' ? message.reasoning_content : '');
      }
    }

    return buildFallbackSuggestion(prompt, typeof message.reasoning_content === 'string' ? message.reasoning_content : '');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Model request failed: ${message}`);
  }
}

import OpenAI from 'openai';

/**
 * @typedef {Object} CommitSuggestion
 * @property {'feat'|'fix'|'chore'} type 提交类型。
 * @property {string} subject 提交标题主体。
 * @property {string[]} bullets 提交摘要要点。
 */

/**
 * @description 解析模型返回 JSON。
 * @param {string} raw 模型原始文本。
 * @return {CommitSuggestion} 结构化提交建议。
 */
function parseSuggestion(raw) {
  /** @type {unknown} */
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid model response: not an object');
  }

  /** @type {Record<string, unknown>} */
  const data = parsed;
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

  /** @type {string[]} */
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
 * @return {{apiKey: string; baseURL: string; model: string}} 运行时配置。
 */
function getModelConfig() {
  /** @type {string | undefined} */
  const apiKey = process.env.GAI_API_KEY || process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('GAI_API_KEY is required for the configured model provider');
  }

  return {
    apiKey,
    baseURL: process.env.GAI_BASE_URL || 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: process.env.GAI_MODEL || 'glm-4.7'
  };
}

/**
 * @description 调用模型生成提交建议。
 * @param {string} prompt 输入提示词。
 * @return {Promise<CommitSuggestion>} 返回结构化提交建议。
 */
export async function generateSuggestion(prompt) {
  const config = getModelConfig();

  /** @type {OpenAI} */
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });

  const response = await client.chat.completions.create({
    model: config.model,
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  const text = response.choices?.[0]?.message?.content?.trim();
  if (typeof text !== 'string' || !text) {
    throw new Error('Empty model output');
  }

  return parseSuggestion(text);
}

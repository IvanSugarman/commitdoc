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
 * @description 调用模型生成提交建议。
 * @param {string} prompt 输入提示词。
 * @return {Promise<CommitSuggestion>} 返回结构化提交建议。
 */
export async function generateSuggestion(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required');
  }

  /** @type {OpenAI} */
  const client = new OpenAI({apiKey});

  const response = await client.responses.create({
    model: process.env.GAI_MODEL || 'gpt-4.1-mini',
    input: [
      {
        role: 'user',
        content: [{type: 'input_text', text: prompt}]
      }
    ]
  });

  const text = response.output_text?.trim();
  if (!text) {
    throw new Error('Empty model output');
  }

  return parseSuggestion(text);
}

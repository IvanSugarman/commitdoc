import OpenAI from 'openai';
import {buildFallbackSuggestion, parseSuggestion} from '../fallback-suggestion.js';
import {serializeModelResponse, writeModelLog} from '../model-log.js';

/**
 * @typedef {Object} ProviderConfig
 * @property {string} provider Provider 名称。
 * @property {string} apiKey API Key。
 * @property {string} baseURL 基础地址。
 * @property {string} model 主模型。
 * @property {string} formatModel 二次格式化模型。
 * @property {boolean} enableThinking 是否启用 thinking。
 * @property {boolean} enableFormatFallback 是否启用二次格式化请求。
 */

/**
 * @typedef {Object} ProviderMessage
 * @property {unknown} [content] 模型输出内容。
 * @property {unknown} [reasoning_content] 推理内容。
 */

/**
 * @typedef {'model'|'zhipu-reasoning'|'fallback-empty-response'|'fallback-parse-failed'} GenerationMode
 */

/**
 * @typedef {Object} GenerationResult
 * @property {import('../fallback-suggestion.js').CommitSuggestion} suggestion 提交建议。
 * @property {GenerationMode} mode 生成模式。
 */

/**
 * @description 构建 OpenAI 兼容 Provider 配置。
 * @param {Partial<ProviderConfig>} overrides 覆盖配置。
 * @return {ProviderConfig} 最终配置。
 */
export function createOpenAICompatibleConfig(overrides) {
  const apiKey = overrides.apiKey || process.env.GAI_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!apiKey) {
    throw new Error('GAI_API_KEY is required for the configured model provider');
  }

  const enableThinking = overrides.enableThinking ?? (process.env.GAI_ENABLE_THINKING === 'true' || process.env.GAI_DISABLE_THINKING === 'false');

  return {
    provider: overrides.provider || 'openai-compatible',
    apiKey,
    baseURL: overrides.baseURL || process.env.GAI_BASE_URL || 'https://api.openai.com/v1',
    model: overrides.model || process.env.GAI_MODEL || 'gpt-4.1-mini',
    formatModel: overrides.formatModel || process.env.GAI_FORMAT_MODEL || overrides.model || process.env.GAI_MODEL || 'gpt-4.1-mini',
    enableThinking,
    enableFormatFallback: overrides.enableFormatFallback ?? (process.env.GAI_ENABLE_FORMAT_FALLBACK === 'true')
  };
}

/**
 * @description 发起一次 chat completion 请求。
 * @param {OpenAI} client OpenAI 兼容客户端。
 * @param {ProviderConfig} config Provider 配置。
 * @param {string} model 模型名称。
 * @param {string} prompt 输入提示词。
 * @param {number} maxTokens 最大输出 token 数。
 * @return {Promise<ProviderMessage>} 模型消息对象。
 */
async function requestMessage(client, config, model, prompt, maxTokens) {
  const requestBody = {
    model,
    temperature: 0.1,
    max_tokens: maxTokens,
    response_format: {
      type: 'json_object'
    },
    ...(config.enableThinking
      ? {
          extra_body: {
            thinking: {
              type: 'enabled'
            }
          }
        }
      : {}),
    messages: [
      {
        role: 'system',
        content: [
          'You are generating a git commit summary.',
          'Return exactly one valid JSON object.',
          'The JSON object must contain keys: type, subject, bullets.',
          'type must be one of feat, fix, chore.',
          'subject must be concise Chinese.',
          'bullets must be an array of 2-4 short Chinese strings.',
          'Do not wrap JSON in markdown fences.',
          'Do not output any extra explanation.'
        ].join('\n')
      },
      {
        role: 'user',
        content: prompt
      }
    ]
  };

  try {
    const response = await client.chat.completions.create(requestBody);
    await writeModelLog({
      provider: config.provider,
      baseURL: config.baseURL,
      request: requestBody,
      response: serializeModelResponse(response)
    });

    return response.choices?.[0]?.message || {};
  } catch (error) {
    await writeModelLog({
      provider: config.provider,
      baseURL: config.baseURL,
      request: requestBody,
      error: error instanceof Error ? {message: error.message, stack: error.stack || ''} : {message: String(error)}
    });
    throw error;
  }
}

/**
 * @description 从兼容层消息结构中提取最终文本。
 * @param {ProviderMessage} message 模型消息对象。
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
 * @param {ProviderConfig} config Provider 配置。
 * @param {string} reasoning 模型 reasoning 文本。
 * @return {Promise<string>} 二次格式化后的 JSON 文本。
 */
async function formatFromReasoning(client, config, reasoning) {
  const prompt = [
    'Convert the analysis below into strict JSON only.',
    'Return exactly one JSON object with keys: type, subject, bullets.',
    'type must be one of feat, fix, chore.',
    'subject must be concise Chinese, max 30 Chinese characters.',
    'subject must summarize the main intent or outcome, not low-level edits.',
    'bullets must be 2-4 short Chinese items with semantic value.',
    'Prefer module-level or behavior-level language such as capability, stability, performance, maintainability, diagnosis, or flow changes.',
    'Avoid changelog-style trivial actions like adding variables, moving lines, or updating imports.',
    'Do not include markdown fences or any extra text.',
    '',
    '[ANALYSIS]',
    reasoning.slice(-6000)
  ].join('\n');

  const message = await requestMessage(client, config, config.formatModel, prompt, 220);
  return extractMessageText(message);
}

/**
 * @description 使用 OpenAI 兼容协议生成提交建议。
 * @param {ProviderConfig} config Provider 配置。
 * @param {string} prompt 输入提示词。
 * @return {Promise<GenerationResult>} 提交建议与生成模式。
 */
export async function generateWithOpenAICompatible(config, prompt) {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });

  try {
    const message = await requestMessage(client, config, config.model, prompt, 800);
    let text = extractMessageText(message);

    if (config.enableFormatFallback && !text && typeof message.reasoning_content === 'string' && message.reasoning_content.trim()) {
      text = await formatFromReasoning(client, config, message.reasoning_content.trim());
    }

    if (text) {
      try {
        return {
          suggestion: parseSuggestion(text),
          mode: 'model'
        };
      } catch {
        return {
          suggestion: buildFallbackSuggestion(prompt, typeof message.reasoning_content === 'string' ? message.reasoning_content : ''),
          mode: 'fallback-parse-failed'
        };
      }
    }

    return {
      suggestion: buildFallbackSuggestion(prompt, typeof message.reasoning_content === 'string' ? message.reasoning_content : ''),
      mode: 'fallback-empty-response'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Model request failed: ${message}`);
  }
}

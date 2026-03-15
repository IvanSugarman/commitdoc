import OpenAI from 'openai';
import type {BriefType} from '../commands.js';
import type {GeneratedBrief} from '../briefs.js';
import {buildBriefFromReasoning, buildFallbackBrief, parseGeneratedBrief} from '../fallback-suggestion.js';
import {hashParts, readJsonCache, serializeModelResponse, writeJsonCache, writeModelLog, writePipelineLog} from '../model-log.js';
import {BASE_SYSTEM_PROMPT} from '../prompt.js';

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

/** 生成模式 */
export type GenerationMode = 'model' | 'zhipu-reasoning' | 'fallback-empty-response' | 'fallback-parse-failed';

/** Provider 生成结果 */
export interface GenerationResult {
  /** brief 输出 */
  brief: GeneratedBrief;
  /** 生成模式 */
  mode: GenerationMode;
}

/** 生成选项 */
export interface GenerationOptions {
  /** 是否跳过 brief 结果缓存 */
  bypassCache?: boolean;
}

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
          BASE_SYSTEM_PROMPT,
          '请严格按照用户提示中声明的 brief 类型和 JSON 结构输出。',
          '只返回一个合法的 JSON 对象。',
          '不要输出 Markdown 代码块。',
          '不要输出任何额外解释。'
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
async function formatFromReasoning(client, config, reasoning, briefType) {
  const prompt = [
    '请将下面的分析结果整理为严格 JSON。',
    ...buildFormatRules(briefType),
    '不要输出 Markdown 代码块，也不要输出任何额外文本。',
    '',
    '[分析内容]',
    reasoning.slice(-6000)
  ].join('\n');

  const message = await requestMessage(client, config, config.formatModel, prompt, 220);
  return extractMessageText(message);
}

/**
 * @description 使用 OpenAI 兼容协议生成提交建议。
 * @param {ProviderConfig} config Provider 配置。
 * @param {string} prompt 输入提示词。
 * @param {BriefType} briefType brief 类型。
 * @return {Promise<GenerationResult>} 提交建议与生成模式。
 */
export async function generateWithOpenAICompatible(config, prompt, briefType, options: GenerationOptions = {}) {
  const cacheKey = hashParts(
    'brief-v1',
    config.provider,
    config.baseURL,
    config.model,
    config.formatModel,
    String(config.enableThinking),
    String(config.enableFormatFallback),
    briefType,
    prompt
  );
  const cached = options.bypassCache ? null : await readJsonCache<GenerationResult>('brief', cacheKey);
  const shouldIgnoreCachedParseFailure = briefType === 'commit' && cached?.mode === 'fallback-parse-failed';

  if (cached && !shouldIgnoreCachedParseFailure) {
    await writePipelineLog('brief.cache', {
      provider: config.provider,
      model: config.model,
      briefType,
      hit: true,
      mode: cached.mode,
      bypassCache: false
    });
    return cached;
  }

  if (shouldIgnoreCachedParseFailure) {
    await writePipelineLog('brief.cache', {
      provider: config.provider,
      model: config.model,
      briefType,
      hit: false,
      mode: 'stale-parse-failed',
      bypassCache: false
    });
  } else if (options.bypassCache) {
    await writePipelineLog('brief.cache', {
      provider: config.provider,
      model: config.model,
      briefType,
      hit: false,
      mode: 'bypass',
      bypassCache: true
    });
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });

  try {
    const message = await requestMessage(client, config, config.model, prompt, 800);
    let text = extractMessageText(message);

    if (config.enableFormatFallback && !text && typeof message.reasoning_content === 'string' && message.reasoning_content.trim()) {
      text = await formatFromReasoning(client, config, message.reasoning_content.trim(), briefType);
    }

    if (text) {
      try {
        const result = {
          brief: parseGeneratedBrief(text, briefType),
          mode: 'model'
        };
        await writeJsonCache('brief', cacheKey, result);
        await writePipelineLog('brief.cache', {
          provider: config.provider,
          model: config.model,
          briefType,
          hit: false,
          mode: result.mode,
          bypassCache: Boolean(options.bypassCache)
        });
        return result;
      } catch {
        const result = {
          brief: buildFallbackBrief(prompt, typeof message.reasoning_content === 'string' ? message.reasoning_content : '', briefType),
          mode: 'fallback-parse-failed'
        };
        await writeJsonCache('brief', cacheKey, result);
        await writePipelineLog('brief.cache', {
          provider: config.provider,
          model: config.model,
          briefType,
          hit: false,
          mode: result.mode,
          bypassCache: Boolean(options.bypassCache)
        });
        return result;
      }
    }

    const result = {
      brief: buildFallbackBrief(prompt, typeof message.reasoning_content === 'string' ? message.reasoning_content : '', briefType),
      mode: 'fallback-empty-response'
    };
    await writeJsonCache('brief', cacheKey, result);
    await writePipelineLog('brief.cache', {
      provider: config.provider,
      model: config.model,
      briefType,
      hit: false,
      mode: result.mode,
      bypassCache: Boolean(options.bypassCache)
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Model request failed: ${message}`);
  }
}

/**
 * @description 构建格式化阶段规则。
 * @param {BriefType} briefType brief 类型。
 * @return {string[]} 规则列表。
 */
function buildFormatRules(briefType) {
  if (briefType === 'commit') {
    return [
      '请返回一个 JSON 对象，字段为：title、bullets。',
      'title 必须是一行简洁的 conventional commit 标题，内容使用中文。',
      'bullets 必须是 2 到 6 条有语义价值的中文短句。'
    ];
  }

  if (briefType === 'commit-title') {
    return [
      '请返回一个 JSON 对象，字段只有：title。',
      'title 必须是一行简洁的 conventional commit 标题，内容使用中文。'
    ];
  }

  if (briefType === 'commit-summary') {
    return [
      '请返回一个 JSON 对象，字段只有：bullets。',
      'bullets 必须是 2 到 6 条有语义价值的中文短句。'
    ];
  }

  return [
    '请返回一个 JSON 对象，字段为：changePurpose、keyChanges、impactScope、reviewerFocus、testingValidation。',
    '字段名保持英文，但字段内容使用简体中文。',
    'changePurpose 必须是一句到两句简洁中文。',
    'keyChanges 和 impactScope 必须是 2 到 6 条中文短句数组。'
  ];
}

import OpenAI from 'openai';
import { buildBriefFromReasoning, buildFallbackBrief, parseGeneratedBrief } from '../fallback-suggestion.js';
import { hashParts, readJsonCache, serializeModelResponse, writeJsonCache, writeModelLog, writePipelineLog } from '../model-log.js';
import { BASE_SYSTEM_PROMPT } from '../prompt.js';
import { createOpenAICompatibleConfig } from './openai-compatible.js';
/**
 * @description 构建智谱 Provider 配置。
 * @return {import('./openai-compatible.js').ProviderConfig} Provider 配置。
 */
export function getZhipuConfig() {
    return createOpenAICompatibleConfig({
        provider: 'zhipu',
        apiKey: process.env.GAI_API_KEY || process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY || '',
        baseURL: process.env.GAI_BASE_URL || 'https://open.bigmodel.cn/api/coding/paas/v4',
        model: process.env.GAI_MODEL || 'glm-4.7',
        formatModel: process.env.GAI_FORMAT_MODEL || 'glm-4.7-flash',
        enableThinking: process.env.GAI_ENABLE_THINKING === 'true',
        enableFormatFallback: process.env.GAI_ENABLE_FORMAT_FALLBACK === 'true'
    });
}
/**
 * @description 使用智谱模型生成提交建议。
 * @param {string} prompt 输入提示词。
 * @param {BriefType} briefType brief 类型。
 * @param {import('./openai-compatible.js').GenerationOptions} [options] 生成选项。
 * @return {Promise<import('./openai-compatible.js').GenerationResult>} 提交建议与生成模式。
 */
export async function generateSuggestion(prompt, briefType, options = {}) {
    const config = getZhipuConfig();
    const cacheKey = hashParts('brief-v1', config.provider, config.baseURL, config.model, config.formatModel, String(config.enableThinking), String(config.enableFormatFallback), briefType, prompt);
    const cached = options.bypassCache ? null : await readJsonCache('brief', cacheKey);
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
    }
    else if (options.bypassCache) {
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
    const requestBody = {
        model: config.model,
        temperature: 0.1,
        max_tokens: 10000,
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
        const message = response.choices?.[0]?.message || {};
        const content = typeof message.content === 'string' ? message.content.trim() : '';
        const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content.trim() : '';
        if (content) {
            try {
                const result = {
                    brief: parseGeneratedBrief(content, briefType),
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
            }
            catch {
                if (reasoning) {
                    const result = {
                        brief: buildBriefFromReasoning(prompt, reasoning, briefType),
                        mode: 'zhipu-reasoning'
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
                const result = {
                    brief: buildFallbackBrief(prompt, content, briefType),
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
        if (reasoning) {
            const result = {
                brief: buildBriefFromReasoning(prompt, reasoning, briefType),
                mode: 'zhipu-reasoning'
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
        const result = {
            brief: buildFallbackBrief(prompt, '', briefType),
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
    }
    catch (error) {
        await writeModelLog({
            provider: config.provider,
            baseURL: config.baseURL,
            request: requestBody,
            error: error instanceof Error ? { message: error.message, stack: error.stack || '' } : { message: String(error) }
        });
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Model request failed: ${message}`);
    }
}

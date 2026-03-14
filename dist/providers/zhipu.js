import OpenAI from 'openai';
import { buildFallbackSuggestion, buildSuggestionFromReasoning, parseSuggestion } from '../fallback-suggestion.js';
import { serializeModelResponse, writeModelLog } from '../model-log.js';
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
 * @return {Promise<import('./openai-compatible.js').GenerationResult>} 提交建议与生成模式。
 */
export async function generateSuggestion(prompt) {
    const config = getZhipuConfig();
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
        const message = response.choices?.[0]?.message || {};
        const content = typeof message.content === 'string' ? message.content.trim() : '';
        const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content.trim() : '';
        if (content) {
            try {
                return {
                    suggestion: parseSuggestion(content),
                    mode: 'model'
                };
            }
            catch {
                if (reasoning) {
                    return {
                        suggestion: buildSuggestionFromReasoning(prompt, reasoning),
                        mode: 'zhipu-reasoning'
                    };
                }
                return {
                    suggestion: buildFallbackSuggestion(prompt, content),
                    mode: 'fallback-parse-failed'
                };
            }
        }
        if (reasoning) {
            return {
                suggestion: buildSuggestionFromReasoning(prompt, reasoning),
                mode: 'zhipu-reasoning'
            };
        }
        return {
            suggestion: buildFallbackSuggestion(prompt, ''),
            mode: 'fallback-empty-response'
        };
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

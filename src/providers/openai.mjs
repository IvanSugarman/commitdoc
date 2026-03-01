import {createOpenAICompatibleConfig, generateWithOpenAICompatible} from './openai-compatible.mjs';

/**
 * @description 构建 OpenAI Provider 配置。
 * @return {import('./openai-compatible.mjs').ProviderConfig} Provider 配置。
 */
export function getOpenAIConfig() {
  return createOpenAICompatibleConfig({
    provider: 'openai',
    apiKey: process.env.GAI_API_KEY || process.env.OPENAI_API_KEY || '',
    baseURL: process.env.GAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.GAI_MODEL || 'gpt-4.1-mini',
    formatModel: process.env.GAI_FORMAT_MODEL || process.env.GAI_MODEL || 'gpt-4.1-mini',
    enableThinking: process.env.GAI_ENABLE_THINKING === 'true',
    enableFormatFallback: process.env.GAI_ENABLE_FORMAT_FALLBACK === 'true'
  });
}

/**
 * @description 使用 OpenAI 模型生成提交建议。
 * @param {string} prompt 输入提示词。
 * @return {Promise<import('./openai-compatible.mjs').GenerationResult>} 提交建议与生成模式。
 */
export async function generateSuggestion(prompt) {
  return generateWithOpenAICompatible(getOpenAIConfig(), prompt);
}
